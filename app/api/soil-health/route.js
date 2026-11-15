import { NextResponse } from "next/server";
import { validateFarmGeometry } from "@/lib/vegetation/earth-search";
import { fetchSoilGrids } from "@/lib/soil-health/soilgrids";
import { buildSoilProfile, DEPTHS, SOIL_PROPERTIES } from "@/lib/soil-health/interpret";

export const maxDuration = 60;

const SOURCE = {
  name: "ISRIC SoilGrids 2.0",
  endpoint: "rest.isric.org/soilgrids/v2.0",
  resolutionMetres: 250,
  note: "Machine-learning predictions on a global 250 m grid, not measurements from your field. Values are the mean prediction; the range is the 90% prediction interval (5th to 95th percentile).",
  license: "CC BY 4.0, ISRIC – World Soil Information",
};

export async function POST(request) {
  if (Number(request.headers.get("content-length") || 0) > 1_500_000) {
    return NextResponse.json({ error: "The farm boundary payload is too large. Simplify the polygon and try again." }, { status: 413 });
  }
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Send a valid JSON request containing the selected farm boundary." }, { status: 400 });
  }
  let geometry;
  try { geometry = validateFarmGeometry(body?.field?.geometry || body?.geometry); } catch (validationError) {
    return NextResponse.json({ error: validationError.message || "Invalid farm boundary." }, { status: 400 });
  }
  const mode = ["deep", "intervals"].includes(body?.mode) ? body.mode : "topsoil";

  try {
    const { layers, sample, attempts } = await fetchSoilGrids(geometry, { mode, samplePoint: body?.samplePoint });
    if (!layers) {
      const timedOut = attempts.some((a) => a.error === "timed out");
      return NextResponse.json({
        error: timedOut
          ? "SoilGrids was too slow to respond. It is a free research service and is sometimes overloaded; please try again in a minute."
          : "SoilGrids has no soil estimate at this location or just around it. This happens in built-up areas, water bodies and a few masked cells. You can still enter your own soil-test results.",
        code: timedOut ? "SOILGRIDS_TIMEOUT" : "NO_SOILGRIDS_DATA",
        attempts,
      }, { status: timedOut ? 504 : 404 });
    }
    const topsoilProfile = mode === "topsoil" ? buildSoilProfile(layers, null) : null;
    return NextResponse.json({
      source: SOURCE,
      mode,
      sample,
      attempts,
      properties: SOIL_PROPERTIES,
      depths: DEPTHS,
      layers,
      profile: topsoilProfile,
      caveats: [
        "SoilGrids predictions are made for 250 m cells. A small field may sit in one cell and its soil can differ from the cell average, especially near rivers, slopes or old field boundaries.",
        "The range shown is a statistical prediction interval. Wide ranges, common for organic carbon, mean the model is unsure.",
        "Bulk density here is the fine-earth fraction and does not capture compaction caused by machinery or recent field work.",
        "Interpretations (ratings and limitations) are general guidance. Crop response depends on climate, management, crop and local soil tests.",
      ],
      generatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000" } });
  } catch (error) {
    console.error("Agrimetry soil-health request failed:", error);
    const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 502;
    return NextResponse.json({ error: String(error?.message || "Unable to retrieve soil information right now.").slice(0, 400) }, { status });
  }
}
