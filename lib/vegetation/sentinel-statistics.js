/**
 * Sentinel Hub Statistical API Client for Copernicus Data Space Ecosystem.
 *
 * Documentation:
 * https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Statistical.html
 * Endpoint:
 * https://sh.dataspace.copernicus.eu/statistics/v1
 */

import { getCopernicusAccessToken, invalidateCopernicusToken } from "./copernicus-auth.js";
import { buildNdviStatisticalEvalscript } from "./evalscripts.js";

const STATISTICAL_ENDPOINT = "https://sh.dataspace.copernicus.eu/statistics/v1";

/**
 * Queries the Sentinel Hub Statistical API for field-level NDVI statistics.
 *
 * @param {Object} params
 * @param {Object} params.geometry - GeoJSON Polygon or MultiPolygon in WGS84 (EPSG:4326)
 * @param {Date} params.from - Start date
 * @param {Date} params.to - End date
 * @param {string} [params.interval="P10D"] - Aggregation interval string (e.g. "P5D", "P10D", "P15D", "P1M")
 * @param {Object} [params.options] - Custom options for evalscript (includeWater, includeCastShadow)
 * @returns {Promise<Array<Object>>} Formatted list of interval statistics
 */
export async function querySentinelStatistics({
  geometry,
  from,
  to,
  interval = "P10D",
  options = {},
}) {
  const evalscript = buildNdviStatisticalEvalscript(options);

  const requestBody = {
    input: {
      bounds: {
        geometry,
        properties: {
          crs: "http://www.opengis.net/def/crs/EPSG/0/4326",
        },
      },
      data: [
        {
          type: "sentinel-2-l2a",
          dataFilter: {
            mosaickingOrder: "mostRecent",
          },
          processing: {
            upsampling: "NEAREST",
            downsampling: "NEAREST",
          },
        },
      ],
    },
    aggregation: {
      timeRange: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      aggregationInterval: {
        of: interval,
      },
      evalscript,
      resx: 0.0001,
      resy: 0.0001,
    },
    calculations: {
      ndvi: {
        statistics: {
          default: {
            percentiles: {
              k: [10, 25, 50, 75, 90],
            },
          },
        },
      },
    },
  };

  async function executeRequest(attempt = 1) {
    const { token } = await getCopernicusAccessToken();

    const response = await fetch(STATISTICAL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(45000),
    });

    if (response.status === 401 && attempt === 1) {
      // Invalidate cached token and retry once
      invalidateCopernicusToken();
      return executeRequest(2);
    }

    if (!response.ok) {
      let errMsg = `Statistical API failed with HTTP ${response.status}`;
      try {
        const errorJson = await response.json();
        errMsg += `: ${JSON.stringify(errorJson)}`;
      } catch {
        errMsg += `: ${await response.text()}`;
      }
      const error = new Error(errMsg);
      error.status = response.status;
      throw error;
    }

    return response.json();
  }

  const rawResult = await executeRequest();
  return parseStatisticalResponse(rawResult);
}

/**
 * Safely formats a numeric metric to fixed decimal precision.
 * Handles strings, numbers, nulls, and undefined gracefully without throwing.
 *
 * @param {any} val - Input value
 * @param {number} [digits=4] - Decimal digits
 * @returns {number|null} Formatted float or null
 */
function formatMetric(val, digits = 4) {
  if (val === null || val === undefined) return null;
  const num = typeof val === "number" ? val : Number(val);
  return Number.isFinite(num) ? Number(num.toFixed(digits)) : null;
}

/**
 * Extracts and safely parses a percentile value from Sentinel Hub response.
 * Handles float keys ("10.0"), integer keys ("10" / 10), and string/number values.
 *
 * @param {Object} percentilesObj
 * @param {number} key - E.g. 10, 25, 50, 75, 90
 * @returns {number|null}
 */
function extractPercentile(percentilesObj, key) {
  if (!percentilesObj || typeof percentilesObj !== "object") return null;
  const raw = percentilesObj[`${key}.0`] ?? percentilesObj[`${key}`] ?? percentilesObj[key] ?? null;
  return formatMetric(raw, 4);
}

/**
 * Parses raw Sentinel Hub Statistical API JSON response into normalized interval records.
 *
 * @param {Object} raw - Raw API response
 * @returns {Array<Object>} Normalized interval records
 */
export function parseStatisticalResponse(raw) {
  const intervals = raw?.data || [];

  return intervals.map((entry) => {
    const interval = entry.interval || {};
    const ndviBandStats = entry.outputs?.ndvi?.bands?.B0?.stats || entry.outputs?.ndvi?.bands?.ndvi?.stats || null;

    if (!ndviBandStats) {
      return {
        from: interval.from,
        to: interval.to,
        status: "no_data",
        hasValidObservations: false,
        validPixelCount: 0,
        noDataPixelCount: 0,
        validCoveragePercent: 0,
        mean: null,
        median: null,
        min: null,
        max: null,
        stDev: null,
        percentiles: null,
      };
    }

    const sampleCount = Number(ndviBandStats.sampleCount) || 0;
    const noDataCount = Number(ndviBandStats.noDataCount) || 0;
    const totalCount = sampleCount + noDataCount;
    const coverage = totalCount > 0 ? (sampleCount / totalCount) * 100 : 0;
    const hasValidObservations = sampleCount > 0 && ndviBandStats.mean !== null;

    const percentiles = ndviBandStats.percentiles || {};
    const median = extractPercentile(percentiles, 50);

    return {
      from: interval.from,
      to: interval.to,
      status: hasValidObservations ? "valid" : "masked_or_empty",
      hasValidObservations,
      validPixelCount: sampleCount,
      noDataPixelCount: noDataCount,
      totalPixelCount: totalCount,
      validSampleRatio: formatMetric(coverage, 1),
      validCoveragePercent: formatMetric(coverage, 1),
      coverageDescription: "Ratio of valid pixels (dataMask=1) to total evaluated grid cells. Bounding-box padding outside irregular polygons is counted in noDataCount.",
      mean: formatMetric(ndviBandStats.mean, 4),
      median: median,
      min: formatMetric(ndviBandStats.min, 4),
      max: formatMetric(ndviBandStats.max, 4),
      stDev: formatMetric(ndviBandStats.stDev, 4),
      percentiles: {
        p10: extractPercentile(percentiles, 10),
        p25: extractPercentile(percentiles, 25),
        p50: median,
        p75: extractPercentile(percentiles, 75),
        p90: extractPercentile(percentiles, 90),
      },
    };
  });
}
