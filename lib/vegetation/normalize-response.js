/**
 * Standardized Response Normalizer for Field Vegetation Intelligence.
 */

import {
  calculateLinearTrend,
  calculateNdviAnomaly,
  classifyVegetationCondition,
  compileQualityReport,
} from "./vegetation-analysis.js";

/**
 * Normalizes field vegetation intelligence into the standard Agrimetry schema.
 *
 * @param {Object} params
 * @param {string} [params.fieldId]
 * @param {string} [params.fieldName]
 * @param {number} [params.areaHectares]
 * @param {Object} params.geometry
 * @param {string} params.from
 * @param {string} params.to
 * @param {string} params.interval
 * @param {Array<Object>} [params.timeseries=[]]
 * @param {Array<Object>} [params.stacScenes=[]]
 * @param {Object} [params.options={}]
 * @param {number|null} [params.baselineMean=null]
 * @param {number|null} [params.baselineStDev=null]
 * @param {string} [params.authStatus="configured"]
 * @param {string} [params.authMessage]
 * @returns {Object} Normalized JSON response
 */
export function normalizeVegetationResponse({
  fieldId = "field-selected",
  fieldName = "Field area",
  areaHectares = null,
  geometry,
  from,
  to,
  interval,
  timeseries = [],
  stacScenes = [],
  options = {},
  baselineMean = null,
  baselineStDev = null,
  authStatus = "configured",
  authMessage = null,
}) {
  // Find the latest valid observation
  const validObservations = timeseries.filter((item) => item.hasValidObservations);
  const latestObservation = validObservations.length > 0 ? validObservations[validObservations.length - 1] : null;

  const trend = calculateLinearTrend(timeseries);
  const condition = classifyVegetationCondition(latestObservation?.mean ?? null);
  const anomaly = calculateNdviAnomaly(latestObservation?.mean ?? null, baselineMean, baselineStDev);
  const quality = compileQualityReport(timeseries, stacScenes, options);

  const excludedList = quality.sclClassesExcluded.join(", ");

  const isAuth = authStatus === "configured";
  const hasStats = timeseries.length > 0;
  const validObs = timeseries.filter((item) => item.hasValidObservations);

  const pipelineStatus = {
    tier1_sceneDiscovery: {
      status: stacScenes.length > 0 ? "succeeded" : "partial_or_pending",
      scenesFound: stacScenes.length,
      provider: "Copernicus Data Space Ecosystem (CDSE) STAC",
      collection: "sentinel-2-l2a",
    },
    tier2_statisticalRequest: {
      status: isAuth ? "succeeded" : "credentials_required",
      api: "Sentinel Hub Statistical API v1",
      aggregationInterval: interval,
      authMethod: "Copernicus OAuth2 Client Credentials",
    },
    tier3_processingResponse: {
      status: isAuth && hasStats ? "succeeded" : isAuth ? "pending_or_empty" : "pending_auth",
      intervalsReceived: timeseries.length,
    },
    tier4_validPixelExtraction: {
      status: validObs.length > 0 ? "succeeded" : isAuth ? "masked_or_cloudy" : "pending_auth",
      validIntervalsCount: validObs.length,
      nativeResolutionMeters: 10,
      sclMaskApplied: true,
    },
    tier5_derivedNdviAnalysis: {
      status: latestObservation?.mean != null ? "succeeded" : "pending_valid_observation",
      trendCalculated: trend.status === "computed",
      conditionClassified: condition.category !== "unknown",
    },
  };

  return {
    feature: "field-vegetation-intelligence",
    pipelineStatus,
    source: {
      mission: "Copernicus Sentinel-2",
      constellation: ["Sentinel-2A", "Sentinel-2B"],
      product: "Level-2A Surface Reflectance (Bottom-of-Atmosphere)",
      collection: "sentinel-2-l2a",
      bands: ["B04 (Red, 665 nm, 10 m)", "B08 (NIR, 842 nm, 10 m)", "SCL (Scene Classification, 20 m)"],
      processingMethod: "Pixel-level NDVI with SCL categorical cloud, shadow, and snow masking",
      nativeResolutionMeters: 10,
    },
    field: {
      id: fieldId,
      name: fieldName,
      areaHectares: areaHectares !== null ? Number(Number(areaHectares).toFixed(2)) : null,
      geometryType: geometry?.type || "Polygon",
    },
    period: {
      from,
      to,
      aggregationInterval: interval,
    },
    latest: latestObservation
      ? {
          intervalStart: latestObservation.from,
          intervalEnd: latestObservation.to,
          meanNdvi: latestObservation.mean,
          medianNdvi: latestObservation.median,
          minNdvi: latestObservation.min,
          maxNdvi: latestObservation.max,
          stdDev: latestObservation.stDev,
          percentiles: latestObservation.percentiles,
          validPixelCount: latestObservation.validPixelCount,
          noDataPixelCount: latestObservation.noDataPixelCount,
          validSampleRatio: latestObservation.validSampleRatio ?? latestObservation.validCoveragePercent,
          validCoveragePercent: latestObservation.validCoveragePercent,
        }
      : {
          intervalStart: null,
          intervalEnd: null,
          meanNdvi: null,
          medianNdvi: null,
          minNdvi: null,
          maxNdvi: null,
          stdDev: null,
          percentiles: null,
          validPixelCount: 0,
          noDataPixelCount: 0,
          validSampleRatio: 0,
          validCoveragePercent: 0,
        },
    condition,
    trend,
    anomaly,
    quality,
    timeseries,
    scenes: stacScenes.slice(0, 30),
    authStatus,
    authMessage,
    scientificNotes: [
      "NDVI measures photosynthetic active green biomass, not crop yield, soil moisture, or fertilizer status.",
      `Excluded SCL classes: [${excludedList}] (nearest-neighbour categorical sampling applied).`,
      "Water (class 6) and Cast Shadow (class 2) exclusion is configurable based on cropping system (e.g. flooded paddy).",
      "High NDVI values (> 0.8) may saturate and underestimate incremental canopy growth in dense crop stages.",
      "Valid Sample Ratio represents valid in-field pixels over total raster cells evaluated; bounding-box padding cells around irregular polygons may contribute to noDataCount.",
      "P10D composites are temporal mosaics selecting the most recent valid pixel per 10-day window; adjacent pixels in a single composite may originate from different overpasses.",
    ],
    provenance: {
      provider: "Copernicus Data Space Ecosystem (CDSE)",
      tokenEndpoint: "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token",
      stacEndpoint: "https://stac.dataspace.copernicus.eu/v1",
      statisticsEndpoint: "https://sh.dataspace.copernicus.eu/statistics/v1",
      retrievedAt: new Date().toISOString(),
      version: "1.0",
    },
  };
}
