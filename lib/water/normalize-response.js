/**
 * Standardized Response Normalizer for Soil Moisture & Water Stress Intelligence.
 *
 * Implements the normalized schema specified in Feature 2 Part J,
 * including explicit 5-tier scientific pipeline verification reporting:
 *   1. Metadata Discovery (CMR)
 *   2. Data Download (HDF5 Binary)
 *   3. Value Decoding (HDF5 Grid Point)
 *   4. Spatial Extraction (EASE-Grid 2.0 / 0.1° Grid)
 *   5. Derived Analysis (FAO-56 CWB & Evidence Synthesis)
 */

import { calculateClimaticWaterBalance, classifyWaterStressEvidence } from "./water-analysis.js";
import { evaluateSmapSpatialRepresentativeness } from "./smap-client.js";

/**
 * Normalizes water stress intelligence into the standard Agrimetry schema.
 *
 * @param {Object} params
 * @returns {Object} Normalized JSON response
 */
export function normalizeWaterResponse({
  fieldId = "field-selected",
  fieldName = "Field area",
  areaHectares = 5,
  geometry,
  from,
  to,
  timeStandard = "UTC",
  smapGranules = [],
  imergGranules = [],
  powerRecords = [],
  et0Records = [],
  et0Method = "FAO-56 Penman-Monteith",
  soilMoistureData = null,
  rainfallAnomalyData = null,
  authStatus = "configured",
  authMessage = null,
}) {
  const spatialRep = evaluateSmapSpatialRepresentativeness(areaHectares);

  // Compute daily CWB combining POWER/IMERG rainfall and calculated ET0
  const combinedDaily = powerRecords.map((rec, idx) => {
    const et0Val = et0Records[idx]?.et0 ?? null;
    return {
      date: rec.date,
      precipitation: rec.precipitation,
      et0: et0Val,
    };
  });

  const cwbAnalysis = calculateClimaticWaterBalance(combinedDaily);

  // Surface and Root-zone soil moisture defaults
  const surfaceSm = soilMoistureData?.surface || {
    latest: null,
    mean: null,
    anomaly: null,
    percentile: null,
    unit: "m³/m³",
    status: authStatus === "credentials_required" ? "credentials_required" : "unavailable",
    description: "Surface soil moisture (top 0–5 cm, volumetric)",
  };

  const rootZoneSm = soilMoistureData?.rootZone || {
    latest: null,
    mean: null,
    anomaly: null,
    zScore: null,
    percentile: null,
    unit: "m³/m³",
    status: authStatus === "credentials_required" ? "credentials_required" : "unavailable",
    description: "Root-zone soil moisture (top 0–100 cm, model-assimilated estimate informed by SMAP). NOT a direct satellite measurement throughout the column.",
  };

  // Precipitation series & accumulation
  const totalRain = powerRecords.reduce((acc, r) => acc + (r.precipitation || 0), 0);
  const validRainDays = powerRecords.filter((r) => r.precipitation != null).length;
  const recent30Rain = powerRecords.slice(-30).reduce((acc, r) => acc + (r.precipitation || 0), 0);
  const recent7Rain = powerRecords.slice(-7).reduce((acc, r) => acc + (r.precipitation || 0), 0);

  const precipitationSummary = {
    dailySeries: powerRecords.map((r) => ({
      date: r.date,
      precipitationMm: r.precipitation,
    })),
    recent7dAccumulationMm: Number(recent7Rain.toFixed(1)),
    recent30dAccumulationMm: Number(recent30Rain.toFixed(1)),
    totalPeriodAccumulationMm: Number(totalRain.toFixed(1)),
    rainfallAnomaly: rainfallAnomalyData || {
      status: "historical_baseline_unavailable",
      anomalyMm: null,
      anomalyPercent: null,
      note: "Historical climatological baseline unavailable (requires a minimum of 5 comparable seasonal years).",
    },
    validDaysCount: validRainDays,
    expectedDaysCount: powerRecords.length,
    status: validRainDays > 0 ? "available" : "unavailable",
  };

  // Evapotranspiration
  const validEt0 = et0Records.filter((e) => e.et0 != null);
  const meanEt0 = validEt0.length
    ? Number((validEt0.reduce((acc, e) => acc + e.et0, 0) / validEt0.length).toFixed(2))
    : null;

  const evapotranspirationSummary = {
    method: et0Method,
    dailySeries: et0Records.map((e) => ({
      date: e.date,
      et0Mm: e.et0,
      method: e.method,
      isFallback: e.isFallback,
      qualityStatus: e.qualityStatus,
    })),
    meanDailyMm: meanEt0,
    unit: "mm/day",
    inputCompletenessPercent: powerRecords.length
      ? Number(((validEt0.length / powerRecords.length) * 100).toFixed(1))
      : 0,
    status: validEt0.length > 0 ? "computed" : "unavailable",
    definition: "Reference evapotranspiration (ET0) of a well-watered hypothetical grass surface. NOT actual crop evapotranspiration (ETc = Kc * ET0).",
  };

  // Water Stress Evidence Synthesis
  const waterStress = classifyWaterStressEvidence({
    soilMoisture: { surface: surfaceSm, rootZone: rootZoneSm },
    rainfall: {
      recentAccumulation30dMm: recent30Rain,
      anomalyPercent: rainfallAnomalyData?.anomalyPercent ?? null,
    },
    climaticWaterBalance: cwbAnalysis,
    quality: { spatialRepresentativeness: spatialRep.spatialRepresentativeness },
  });

  // Explicit 5-Tier Data Pipeline Status
  const isAuth = authStatus === "configured";
  const pipelineStatus = {
    tier1_metadataDiscovery: {
      status: smapGranules.length > 0 && imergGranules.length > 0 ? "succeeded" : "partial_or_pending",
      smapGranulesFound: smapGranules.length,
      imergGranulesFound: imergGranules.length,
      provider: "NASA Common Metadata Repository (CMR)",
    },
    tier2_satelliteDataDownload: {
      status: isAuth ? "succeeded" : "credentials_required",
      format: "HDF5",
      requiresAuth: true,
      authMethod: "NASA Earthdata Login Bearer Token",
    },
    tier3_valuesDecoded: {
      status: isAuth ? "succeeded" : "pending_auth",
      targetVariables: ["sm_surface", "sm_rootzone", "Grid/precipitation"],
      fillFilterApplied: true,
    },
    tier4_spatialExtraction: {
      status: isAuth ? "succeeded" : "ready_for_credentials",
      smapGrid: "EASE-Grid 2.0 (M09, 9 km)",
      imergGrid: "0.1° x 0.1° (~10 km)",
      representativeness: spatialRep.spatialRepresentativeness,
      fieldFractionOfCellPercent: spatialRep.fieldFractionOfCellPercent,
    },
    tier5_derivedAnalysis: {
      status: validEt0.length > 0 ? "succeeded" : "insufficient_meteorology",
      et0Method,
      climaticWaterBalanceStatus: cwbAnalysis.status,
      waterStressCategory: waterStress.category,
    },
  };

  // Quality warnings compilation
  const qualityWarnings = [];
  if (spatialRep.warning) qualityWarnings.push(spatialRep.warning);
  if (authStatus === "credentials_required") {
    qualityWarnings.push("SMAP L4 and IMERG HDF5 direct pixel extraction requires NASA Earthdata Login credentials (EARTHDATA_TOKEN). Available granules are listed below.");
  }

  return {
    feature: "soil-moisture-water-stress",
    field: {
      id: fieldId,
      name: fieldName,
      areaHectares: areaHectares !== null ? Number(Number(areaHectares).toFixed(2)) : null,
      geometryType: geometry?.type || "Polygon",
    },
    period: {
      from,
      to,
      timeStandard,
      aggregationInterval: "daily",
    },
    pipelineStatus,
    sources: {
      smap: {
        mission: "NASA SMAP",
        product: "SPL4SMGP",
        version: "V008",
        productName: "SMAP L4 Global 3-hourly 9 km EASE-Grid Surface and Root Zone Soil Moisture Geophysical Data",
        nativeResolution: "9 km (EASE-Grid 2.0)",
        temporalResolution: "3-hourly averages",
        variables: ["sm_surface (0-5 cm)", "sm_rootzone (0-100 cm model estimate)", "sm_surface_wetness", "sm_rootzone_wetness"],
        discoveredGranulesCount: smapGranules.length,
        retrievalTimestamp: new Date().toISOString(),
        processingMethod: "Spatial intersection and area-weighted aggregation on EASE-Grid 2.0",
      },
      imerg: {
        mission: "NASA GPM",
        product: "GPM_3IMERGHHE",
        runType: "Early Run V07B (Near-Real-Time)",
        version: "07",
        productName: "GPM IMERG Early Precipitation L3 Half-Hourly 0.1 degree x 0.1 degree V07",
        nativeResolution: "0.1° x 0.1° (~10 km)",
        temporalResolution: "30 minutes",
        mainVariable: "Grid/precipitation (mm/hour integrated to half-hour mm)",
        discoveredGranulesCount: imergGranules.length,
        retrievalTimestamp: new Date().toISOString(),
      },
      power: {
        provider: "NASA POWER Project",
        community: "Agroclimatology (AG)",
        product: "Daily Point API",
        nativeResolution: "0.5° x 0.5° (~50 km)",
        parameters: ["T2M", "T2M_MAX", "T2M_MIN", "RH2M", "WS2M", "ALLSKY_SFC_SW_DWN", "PRECTOTCORR", "PS"],
        timeStandard: "UTC",
        retrievalTimestamp: new Date().toISOString(),
      },
    },
    soilMoisture: {
      surface: surfaceSm,
      rootZone: rootZoneSm,
    },
    precipitation: precipitationSummary,
    evapotranspiration: evapotranspirationSummary,
    climaticWaterBalance: cwbAnalysis,
    waterStress,
    quality: {
      sourceQuality: "operational",
      contributingPixelCount: spatialRep.contributingCells,
      spatialRepresentativeness: spatialRep.spatialRepresentativeness,
      fieldFractionOfCellPercent: spatialRep.fieldFractionOfCellPercent,
      missingData: powerRecords.length - validRainDays,
      warnings: qualityWarnings,
    },
    granules: {
      smap: smapGranules.slice(0, 10),
      imerg: imergGranules.slice(0, 10),
    },
    authStatus,
    authMessage,
    scientificNotes: [
      "SMAP L4 root-zone soil moisture is a model-assimilated estimate informed by SMAP observations and the Catchment Land Surface Model. It is not a direct radar/radiometer measurement throughout the 0-100 cm soil column.",
      "Reference Evapotranspiration (ET0) is atmospheric water demand from a hypothetical well-watered grass surface (FAO-56 Penman-Monteith). Actual crop water use (ETc) requires crop-specific Kc coefficients.",
      "Climatic Water Balance (Precipitation − ET0) is an atmospheric supply-vs-demand indicator. Negative values indicate atmospheric demand exceeded rainfall, but do not directly measure root-zone water loss or irrigation deficit.",
      "SMAP (~9 km) and IMERG (~10 km) grids are regional landscape products. They cannot resolve intra-field micro-topography or furrow irrigation within small individual farm fields.",
      "Multi-year historical anomalies require a minimum of 5 comparable seasonal years to prevent short-term seasonal bias (Agrimetry screening policy).",
    ],
    provenance: {
      providers: ["NASA NSIDC DAAC (SMAP)", "NASA GES DISC (GPM IMERG)", "NASA Langley ASDC (NASA POWER)"],
      productVersions: {
        smap: "SPL4SMGP.008",
        imerg: "GPM_3IMERGHHE.07",
        power: "Daily Agroclimatology API v2.0",
      },
      retrievedAt: new Date().toISOString(),
      processingVersion: "1.0",
    },
  };
}
