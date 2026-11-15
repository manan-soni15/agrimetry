/**
 * NASA GPM IMERG Precipitation Client (Version 07).
 *
 * Provider: NASA GES DISC / GPM Science Team
 * Products:
 *   - Early Run (Near-real-time): GPM_3IMERGHHE_07 (V07B)
 *   - Final Run (Research quality): GPM_3IMERGHH_07 (V07B)
 * Native Resolution: 0.1° x 0.1° (~10 km)
 * Native Temporal Resolution: 30 minutes (half-hourly)
 *
 * HDF5 DATASET ARCHITECTURE:
 *   - Early Run: /Grid/precipitation (mm/hour)
 *   - Final Run: /Grid/precipitationCal (mm/hour)
 *   - Microwave-Only: /Grid/HQprecipitation (mm/hour)
 *   - Quality Metric: /Grid/precipitationQualityIndex
 *   - Fill Value: -9999.9
 */

import { extractPolygonBoundingBox } from "./smap-client.js";

const CMR_GRANULE_ENDPOINT = "https://cmr.earthdata.nasa.gov/search/granules.json";

export const IMERG_CONFIG = {
  version: "07",
  products: {
    early: "GPM_3IMERGHHE",
    final: "GPM_3IMERGHH",
  },
  datasets: {
    earlyPrecipitation: "Grid/precipitation",
    finalPrecipitation: "Grid/precipitationCal",
    hqPrecipitation: "Grid/HQprecipitation",
    qualityIndex: "Grid/precipitationQualityIndex",
  },
  variableUnits: "mm/hour",
  fillValue: -9999.9,
  intervalDurationHours: 0.5,
  intervalsPerDay: 48,
  nativeResolutionDegrees: 0.1,
  nativeResolutionKm: 10.0,
  grid: {
    lonMin: -180.0,
    lonMax: 180.0,
    latMin: -90.0,
    latMax: 90.0,
    columns: 3600,
    rows: 1800,
  },
};

/**
 * Projects latitude/longitude to GPM IMERG 0.1° grid coordinates.
 *
 * @param {number} latitude - [-90, 90]
 * @param {number} longitude - [-180, 180]
 * @returns {{ col: number|null, row: number|null, inBounds: boolean }}
 */
export function latLonToImergGrid(latitude, longitude) {
  if (
    latitude == null ||
    longitude == null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return { col: null, row: null, inBounds: false };
  }

  // IMERG V07 0.1° grid spans -180 to 180 lon (3600 cols) and -90 to 90 lat (1800 rows)
  const col = Math.min(3599, Math.max(0, Math.floor((longitude + 180.0) / 0.1)));
  const row = Math.min(1799, Math.max(0, Math.floor((latitude + 90.0) / 0.1)));

  return { col, row, inBounds: true };
}

/**
 * Decodes and validates a single half-hourly IMERG grid observation.
 *
 * @param {Object} params
 * @param {number} params.rateMmPerHour - Precipitation rate from HDF5 array (mm/hr)
 * @param {number} [params.qualityIndex=1] - Quality index
 * @returns {Object} Decoded result with status and converted 30-min accumulation
 */
export function decodeImergHdf5GridPoint({ rateMmPerHour, qualityIndex = 1 }) {
  if (rateMmPerHour == null || !Number.isFinite(rateMmPerHour)) {
    return {
      precipitationMmPerHr: null,
      halfHourRainfallMm: null,
      status: "missing",
      qualityIndex: null,
      valid: false,
    };
  }

  if (rateMmPerHour < 0 || rateMmPerHour === IMERG_CONFIG.fillValue) {
    return {
      precipitationMmPerHr: null,
      halfHourRainfallMm: null,
      status: "fill_value",
      qualityIndex,
      valid: false,
    };
  }

  if (rateMmPerHour > 500) {
    return {
      precipitationMmPerHr: null,
      halfHourRainfallMm: null,
      status: "extreme_meteorological_outlier",
      qualityIndex,
      valid: false,
    };
  }

  const halfHourRainfallMm = Number((rateMmPerHour * 0.5).toFixed(3));
  return {
    precipitationMmPerHr: Number(rateMmPerHour.toFixed(2)),
    halfHourRainfallMm,
    status: "valid",
    qualityIndex,
    valid: true,
  };
}

/**
 * Discovers GPM IMERG Version 07 granules from NASA CMR for a given bounding box.
 *
 * @param {Object} params
 * @param {Object} params.geometry - GeoJSON Polygon
 * @param {Date} params.from - Start date
 * @param {Date} params.to - End date
 * @param {string} [params.runType="Early"] - "Early" or "Final"
 * @param {number} [params.limit=20] - Maximum granules to retrieve
 * @returns {Promise<Array<Object>>} List of discovered granules
 */
export async function discoverImergGranules({
  geometry,
  from,
  to,
  runType = "Early",
  limit = 20,
}) {
  const shortName = runType === "Final" ? IMERG_CONFIG.products.final : IMERG_CONFIG.products.early;
  const bbox = extractPolygonBoundingBox(geometry);
  const boundingBoxStr = `${bbox.minLon.toFixed(4)},${bbox.minLat.toFixed(4)},${bbox.maxLon.toFixed(4)},${bbox.maxLat.toFixed(4)}`;
  const temporalStr = `${from.toISOString().slice(0, 19)}Z,${to.toISOString().slice(0, 19)}Z`;

  const searchParams = new URLSearchParams({
    short_name: shortName,
    version: "07",
    bounding_box: boundingBoxStr,
    temporal: temporalStr,
    page_size: String(Math.min(limit, 50)),
    sort_key: "-start_date",
  });

  try {
    const response = await fetch(`${CMR_GRANULE_ENDPOINT}?${searchParams.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn(`NASA CMR GPM IMERG query returned status ${response.status}`);
      return [];
    }

    const payload = await response.json();
    const entries = payload?.feed?.entry || [];

    return entries.map((entry) => {
      const dataLinks = (entry.links || []).filter((l) => l.href && !l.inherited);
      const downloadLink = dataLinks.find((l) => l.href.endsWith(".HDF5") || l.href.endsWith(".nc4"))?.href || dataLinks[0]?.href || null;

      return {
        id: entry.id,
        title: entry.title,
        runType,
        version: "07",
        timeStart: entry.time_start,
        timeEnd: entry.time_end,
        granuleSizeMb: entry.granule_size ? Number(entry.granule_size).toFixed(1) : null,
        downloadUrl: downloadLink,
      };
    });
  } catch (error) {
    console.error("NASA CMR GPM IMERG discovery error:", error);
    return [];
  }
}

/**
 * Converts a 30-minute precipitation rate (mm/hr) to accumulated rainfall (mm).
 *
 * Formula:
 *   rainfall_mm = rate_mm_per_hour * 0.5 hours
 *
 * @param {number} rateMmPerHour - Precipitation rate in mm/hour
 * @returns {number|null} Rainfall in mm for the 30-minute window
 */
export function convertRateToHalfHourRainfall(rateMmPerHour) {
  if (rateMmPerHour == null || !Number.isFinite(rateMmPerHour) || rateMmPerHour < 0) {
    return null;
  }
  // Filter fill values (-9999.9 or similar negative values)
  if (rateMmPerHour > 500) {
    return null; // Exceeds extreme meteorological threshold
  }
  return Number((rateMmPerHour * 0.5).toFixed(3));
}

/**
 * Integrates half-hourly IMERG precipitation readings into a daily total.
 * Tracks data completeness and refuses to silently replace missing intervals with zero.
 *
 * @param {Array<number|null>} intervals - 48 half-hour precipitation values in mm
 * @returns {Object} Daily accumulation result
 */
export function aggregateDailyImergRainfall(intervals = []) {
  const expected = 48; // 24 hours * 2 intervals per hour
  const valid = [];
  let missingCount = 0;

  for (const item of intervals) {
    if (item != null && Number.isFinite(item) && item >= 0) {
      valid.push(item);
    } else {
      missingCount++;
    }
  }

  const validCount = valid.length;
  const coveragePercent = Number(((validCount / expected) * 100).toFixed(1));

  if (validCount === 0) {
    return {
      dailyTotalMm: null,
      expectedIntervals: expected,
      validIntervalCount: 0,
      missingIntervalCount: expected,
      coveragePercent: 0,
      status: "missing",
      qualityWarning: "All 48 half-hourly observation intervals were missing.",
    };
  }

  // Calculate sum of valid intervals
  const rawSum = valid.reduce((acc, val) => acc + val, 0);

  if (coveragePercent < 80.0) {
    return {
      dailyTotalMm: Number(rawSum.toFixed(2)),
      expectedIntervals: expected,
      validIntervalCount: validCount,
      missingIntervalCount: missingCount,
      coveragePercent,
      status: "incomplete",
      qualityWarning: `Incomplete daily coverage (${validCount}/48 intervals valid, ${coveragePercent}%). Total may underestimate daily rainfall.`,
    };
  }

  return {
    dailyTotalMm: Number(rawSum.toFixed(2)),
    expectedIntervals: expected,
    validIntervalCount: validCount,
    missingIntervalCount: missingCount,
    coveragePercent,
    status: "complete",
    qualityWarning: null,
  };
}

/**
 * Calculates accumulated rainfall over multiple days (e.g. 7-day, 14-day, 30-day).
 *
 * @param {Array<Object>} dailyRecords - List of daily records with date and precipitation (mm)
 * @param {number} days - Number of recent days to accumulate
 * @returns {{ totalMm: number|null, validDays: number, requestedDays: number, isComplete: boolean }}
 */
export function calculateAccumulatedRainfall(dailyRecords = [], days = 30) {
  const slice = dailyRecords.slice(-days);
  const valid = slice.filter((d) => d.precipitation != null && Number.isFinite(d.precipitation));

  if (valid.length === 0) {
    return {
      totalMm: null,
      validDays: 0,
      requestedDays: days,
      isComplete: false,
    };
  }

  const total = valid.reduce((acc, d) => acc + d.precipitation, 0);
  return {
    totalMm: Number(total.toFixed(1)),
    validDays: valid.length,
    requestedDays: days,
    isComplete: valid.length === days,
  };
}
