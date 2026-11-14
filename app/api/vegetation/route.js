import { NextResponse } from "next/server";
import { analyzeSentinelVegetation, SENTINEL_START_DATE, validateFarmGeometry } from "@/lib/vegetation/earth-search";

// Next.js Cache Components requires the default Node.js runtime.
// Do not export `runtime` or `dynamic` from this route.
export const maxDuration = 60;

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function POST(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 1_500_000) {
    return NextResponse.json({ error: "The farm boundary payload is too large. Simplify the polygon and try again." }, { status: 413 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a valid JSON request containing the selected farm boundary and observation dates." }, { status: 400 });
  }

  try {
    let geometry;
    try {
      geometry = validateFarmGeometry(body?.field?.geometry || body?.geometry);
    } catch (validationError) {
      return NextResponse.json({ error: validationError.message || "Invalid farm boundary." }, { status: 400 });
    }

    const startDate = body?.startDate;
    const endDate = body?.endDate;
    const cloudLimit = Number(body?.cloudLimit ?? 70);

    if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
      return NextResponse.json({ error: "Choose a valid start date and end date." }, { status: 400 });
    }
    if (startDate < SENTINEL_START_DATE) {
      return NextResponse.json({ error: `The selected Earth Search Sentinel-2 collection begins on ${SENTINEL_START_DATE}. Choose a later start date.` }, { status: 400 });
    }
    if (endDate > new Date().toISOString().slice(0, 10)) {
      return NextResponse.json({ error: "The end date cannot be in the future." }, { status: 400 });
    }
    if ((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000 > 370) {
      return NextResponse.json({ error: "For this release, choose a date range of 12 months or less. Shorter windows usually return faster." }, { status: 400 });
    }
    if (!Number.isFinite(cloudLimit) || cloudLimit < 0 || cloudLimit > 100) {
      return NextResponse.json({ error: "Scene cloud percentage must be between 0 and 100." }, { status: 400 });
    }

    const result = await analyzeSentinelVegetation({ geometry, startDate, endDate, cloudLimit });
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "X-Agrimetry-Data-Source": "Element84-Earth-Search-Sentinel-2-C1-L2A",
      },
    });
  } catch (error) {
    console.error("Agrimetry public Sentinel-2 analysis failed:", error);
    const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 502;
    const knownCode = error?.code || (status === 422 ? "NO_SUITABLE_SCENES" : "SENTINEL_DATA_ERROR");
    const safeMessage = String(error?.message || "The public Sentinel-2 data service could not complete this analysis.").slice(0, 650);
    return NextResponse.json({ error: safeMessage, code: knownCode }, { status });
  }
}
