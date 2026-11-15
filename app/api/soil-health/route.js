import { NextResponse } from "next/server";
import { validateFarmGeometry } from "@/lib/vegetation/earth-search";
import { chooseSamplePoints, fetchSoilGrids } from "@/lib/soil-health/soilgrids";
import { fetchNasaSmapSoilMoisture } from "@/lib/soil-health/nasa-smap";
import { buildSoilProfile, DEPTHS, SOIL_PROPERTIES } from "@/lib/soil-health/interpret";

export const maxDuration = 60;

const BASE_CAVEATS = [
  "SoilGrids predictions describe a 250 m model cell, not a laboratory sample from your exact field. Small fields and mixed landscapes can differ from the mapped cell.",
  "SoilGrids uncertainty ranges are prediction intervals, not measurement error bars. Wider ranges mean the model is less certain.",
  "Bulk density represents the mapped fine-earth fraction and does not detect recent machinery compaction in your field.",
  "NASA soil-water products describe gridded landscape conditions, not a precise field irrigation reading. SMAP L4 is about 9 km native resolution; standard MERRA-2 wetness context is coarser.",
  "Satellite/model soil-water context does not replace soil pH, texture, organic-carbon concentration, nutrient tests or bulk density.",
  "Interpretations are prompts for investigation. Crop response depends on crop stage, local management, climate and field conditions.",
];

function safeMessage(error) {
  return String(error?.message || "The upstream soil-data service is temporarily unavailable.").slice(0, 260);
}

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
  if (mode !== "topsoil") {
    try {
      const soil = await fetchSoilGrids(geometry, { mode, samplePoint: body?.samplePoint });
      return NextResponse.json({
        mode,
        layers: soil.layers,
        sample: soil.sample,
        soilGrids: { available: Boolean(soil.layers), service: soil.service, coverage: soil.coverage || null, attempts: soil.attempts, error: soil.error || null },
      }, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
    } catch (error) {
      return NextResponse.json({ error: safeMessage(error), code: "SOIL_LAYER_UNAVAILABLE" }, { status: 200 });
    }
  }

  const sampleCandidates = chooseSamplePoints(geometry);
  const representative = sampleCandidates[0];
  const [soilOutcome, smapOutcome] = await Promise.allSettled([
    fetchSoilGrids(geometry, { mode: "topsoil" }),
    fetchNasaSmapSoilMoisture(representative.point),
  ]);

  const soilResult = soilOutcome.status === "fulfilled"
    ? soilOutcome.value
    : { layers: null, sample: null, attempts: [], service: null, error: safeMessage(soilOutcome.reason) };
  const soilMoisture = smapOutcome.status === "fulfilled"
    ? { ...smapOutcome.value, samplePoint: { ...smapOutcome.value.samplePoint, where: representative.where } }
    : { available: false, error: safeMessage(smapOutcome.reason), source: { name: "NASA SMAP via NASA POWER", nativeResolutionMetres: 9_000 }, summary: null, story: null, records: [] };

  const layers = soilResult.layers || null;
  const soilAvailable = Boolean(layers);
  const waterAvailable = Boolean(soilMoisture.available);
  const status = soilAvailable && waterAvailable ? "ready" : soilAvailable || waterAvailable ? "partial" : "degraded";
  const warnings = [];
  if (!soilAvailable) warnings.push(`SoilGrids is unavailable right now. ${soilResult.error || "Its WCS and REST access paths did not return usable values."} You can still use NASA soil-water context and enter your own laboratory soil-test values.`);
  else if (soilResult.coverage && soilResult.coverage.returned < soilResult.coverage.requested) warnings.push(`SoilGrids returned ${soilResult.coverage.returned} of ${soilResult.coverage.requested} requested topsoil values. Missing properties remain unknown; the available values can still be used.`);
  if (!waterAvailable) warnings.push(`NASA soil-water history is unavailable right now. ${soilMoisture.error || "The POWER endpoint did not return a valid time series."} Soil profile lookup and farmer soil tests can still be used.`);
  else if (soilMoisture.kind === "wetness") warnings.push("The higher-resolution SMAP request was not accepted by NASA POWER, so Agrimetry is showing the coarser MERRA-2 wetness series instead. This is clearly labelled and is not presented as SMAP.");

  const soilGridSource = {
    name: "ISRIC SoilGrids 2.0",
    provider: "ISRIC – World Soil Information (not NASA)",
    accessMethod: soilResult.service || null,
    endpoint: soilResult.service === "WCS" ? "maps.isric.org · OGC Web Coverage Service" : soilResult.service === "REST" ? "rest.isric.org · REST API" : soilResult.service === "WCS+REST" ? "ISRIC WCS + REST fallback" : null,
    available: soilAvailable,
    resolutionMetres: 250,
    note: soilAvailable
      ? `250 m machine-learning soil-property predictions obtained through ${soilResult.service || "ISRIC map services"}.`
      : "The SoilGrids service did not return a usable profile for this request.",
    license: "CC BY 4.0, ISRIC – World Soil Information",
  };

  return NextResponse.json({
    mode,
    status,
    source: soilGridSource,
    soilGrids: { available: soilAvailable, service: soilResult.service, coverage: soilResult.coverage || null, attempts: soilResult.attempts || [], error: soilResult.error || null },
    sample: soilResult.sample || null,
    properties: SOIL_PROPERTIES,
    depths: DEPTHS,
    layers,
    profile: layers ? buildSoilProfile(layers, null) : null,
    soilMoisture,
    warnings,
    caveats: BASE_CAVEATS,
    generatedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } });
}
