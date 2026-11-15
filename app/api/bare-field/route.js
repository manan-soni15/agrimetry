import { NextResponse } from "next/server";
import { analyzeSentinelVegetation, SENTINEL_START_DATE, validateFarmGeometry } from "@/lib/vegetation/earth-search";
import { analyzeWaterStress } from "@/lib/water-stress/analysis";
import { detectBareFieldPeriods } from "@/lib/bare-field/analysis";

export const maxDuration = 60;

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function centreOf(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const points = polygons.flatMap((polygon) => polygon[0] || []);
  const lons = points.map((p) => Number(p[0]));
  const lats = points.map((p) => Number(p[1]));
  return { longitude: (Math.min(...lons) + Math.max(...lons)) / 2, latitude: (Math.min(...lats) + Math.max(...lats)) / 2 };
}

// Number of calendar months from the start month to the current month, which is
// how far back the water-stress window must reach to cover the NDVI period.
function monthsToNow(startDate) {
  const now = new Date();
  const [year, month] = startDate.split("-").map(Number);
  return (now.getUTCFullYear() - year) * 12 + (now.getUTCMonth() + 1 - month) + 1;
}

export async function POST(request) {
  if (Number(request.headers.get("content-length") || 0) > 1_500_000) {
    return NextResponse.json({ error: "The farm boundary payload is too large. Simplify the polygon and try again." }, { status: 413 });
  }
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Send a valid JSON request containing the selected farm boundary and dates." }, { status: 400 });
  }

  let geometry;
  try { geometry = validateFarmGeometry(body?.field?.geometry || body?.geometry); } catch (validationError) {
    return NextResponse.json({ error: validationError.message || "Invalid farm boundary." }, { status: 400 });
  }
  const { startDate, endDate } = body || {};
  const cloudLimit = Number(body?.cloudLimit ?? 70);
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
    return NextResponse.json({ error: "Choose a valid start date and end date." }, { status: 400 });
  }
  if (startDate < SENTINEL_START_DATE) {
    return NextResponse.json({ error: `Sentinel-2 data begins on ${SENTINEL_START_DATE}. Choose a later start date.` }, { status: 400 });
  }
  if (endDate > new Date().toISOString().slice(0, 10)) {
    return NextResponse.json({ error: "The end date cannot be in the future." }, { status: 400 });
  }
  if ((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000 > 370) {
    return NextResponse.json({ error: "Choose a date range of 12 months or less." }, { status: 400 });
  }
  if (!Number.isFinite(cloudLimit) || cloudLimit < 0 || cloudLimit > 100) {
    return NextResponse.json({ error: "Scene cloud percentage must be between 0 and 100." }, { status: 400 });
  }

  try {
    const centre = centreOf(geometry);
    // POWER window is capped at 12 months; older NDVI months simply get no rain rating.
    const waterMonths = Math.min(12, monthsToNow(startDate));
    // Rainfall is optional context. If POWER is slow or unavailable, the bare-field
    // result is still returned, just without rainfall-based erosion ratings.
    const rainPromise = waterMonths >= 3 && waterMonths <= 12
      ? analyzeWaterStress({ ...centre, months: waterMonths }).catch((rainError) => {
          console.warn("Bare-field rainfall context unavailable:", rainError?.message);
          return null;
        })
      : Promise.resolve(null);

    const [vegetation, water] = await Promise.all([
      analyzeSentinelVegetation({ geometry, startDate, endDate, cloudLimit }),
      rainPromise,
    ]);

    const rainMonthly = (water?.monthly || []).map((m) => ({ month: m.month, rainMm: m.rainMm, rainRatio: m.rainRatio, partial: m.partial }));
    const detection = detectBareFieldPeriods(vegetation.monthly, rainMonthly);

    return NextResponse.json({
      period: vegetation.period,
      location: centre,
      ...detection,
      rainfall: {
        available: rainMonthly.length > 0,
        source: water ? "NASA POWER (MERRA-2 based) PRECTOTCORR" : null,
        baselineYears: water?.baseline?.yearsUsed ?? null,
        note: water ? null : "Rainfall context could not be loaded for this period, so erosion exposure is not rated.",
      },
      ndviSource: { name: vegetation.source.name, attribution: vegetation.source.attribution, validMonths: vegetation.summary.validMonths, totalMonths: vegetation.summary.totalMonths },
      caveats: [
        "Bare-field periods are inferred from low NDVI in Sentinel-2 images. NDVI cannot tell bare soil from crop stubble, fallow, water, a newly sown crop or a dormant crop, so check each flagged period against your crop calendar and in the field.",
        "Each month is represented by one clear Sentinel-2 observation. A short bare window between two observations can be missed, and the exact start and end dates are only known to the month.",
        "Months without a clear observation are shown as unknown, never as bare. A period containing unknown months is labelled partly observed.",
        "Erosion exposure combines low cover with monthly rainfall totals only. It does not know rainfall intensity, slope, soil type or tillage, so treat it as a prompt to look at the field, not a measured erosion risk.",
        "Cover-crop suggestions are general guidance based on the length of the gap and average rainfall. They are not species recommendations; choose with local agronomic advice. Soil and crop-specific scoring is planned in later features.",
        "A period that touches the start or end of the chosen window may be part of a longer bare period or a normal season boundary; widen the window to check.",
      ],
      generatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Agrimetry bare-field analysis failed:", error);
    const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 502;
    return NextResponse.json({ error: String(error?.message || "The bare-field analysis could not be completed.").slice(0, 600), code: error?.code }, { status });
  }
}
