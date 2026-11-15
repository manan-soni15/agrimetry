/**
 * Soil Moisture & Water Stress Intelligence API Route.
 *
 * Implements:
 * - NASA SMAP L4 Global 9 km Soil Moisture (SPL4SMGP V008)
 * - NASA GPM IMERG V07 Precipitation
 * - NASA POWER Agroclimatology (AG) daily meteorology
 * - FAO-56 Penman-Monteith Reference Evapotranspiration (ET0)
 * - Climatic Water Balance (CWB = P - ET0)
 * - Explainable Water-Stress Evidence Synthesis
 */

import { discoverSmapGranules, hasEarthdataCredentials } from "../../../lib/water/smap-client.js";
import { discoverImergGranules } from "../../../lib/water/imerg-client.js";
import { computeDailyEt0 } from "../../../lib/water/et0.js";
import { calculateRainfallAnomaly } from "../../../lib/water/climatology.js";
import { normalizeWaterResponse } from "../../../lib/water/normalize-response.js";
import {
  createBoxPolygonFromPoint,
  validateDateRange,
  validateGeometry,
} from "../../../lib/water/validation.js";

const POWER_ENDPOINT = "https://power.larc.nasa.gov/api/temporal/daily/point";
const POWER_PARAMETERS = [
  "T2M",
  "T2M_MAX",
  "T2M_MIN",
  "RH2M",
  "WS2M",
  "ALLSKY_SFC_SW_DWN",
  "PRECTOTCORR",
  "PS",
];

// In-memory cache for water stress queries (30-minute TTL)
const responseCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

export function getCacheKey(geometry, fromStr, toStr) {
  const coordSample = JSON.stringify(geometry?.coordinates?.[0]?.[0] || "");
  return `water_${coordSample}_${fromStr}_${toStr}`;
}

function getFromCache(key) {
  const item = responseCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return item.data;
}

function setToCache(key, data) {
  if (responseCache.size > 200) {
    const oldestKey = responseCache.keys().next().value;
    responseCache.delete(oldestKey);
  }
  responseCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

function toPowerDate(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function isValidNumber(value) {
  return Number.isFinite(value) && value > -900;
}

async function fetchNasaPowerDaily(latitude, longitude, fromDate, toDate) {
  const startStr = toPowerDate(fromDate);
  const endStr = toPowerDate(toDate);

  const params = new URLSearchParams({
    parameters: POWER_PARAMETERS.join(","),
    community: "AG",
    longitude: longitude.toFixed(4),
    latitude: latitude.toFixed(4),
    start: startStr,
    end: endStr,
    format: "JSON",
    "time-standard": "UTC",
  });

  const response = await fetch(`${POWER_ENDPOINT}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 21600 },
    signal: AbortSignal.timeout(35000),
  });

  if (!response.ok) {
    throw new Error(`NASA POWER request failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  const parameterData = payload?.properties?.parameter;
  if (!parameterData?.T2M || !parameterData?.PRECTOTCORR) {
    throw new Error("NASA POWER returned missing parameter data.");
  }

  const dates = Object.keys(parameterData.T2M).sort();
  return dates.map((dateStr) => {
    const read = (key) => {
      const v = parameterData[key]?.[dateStr];
      return isValidNumber(v) ? v : null;
    };

    const isoDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;

    return {
      date: isoDate,
      temperature: read("T2M"),
      maximumTemperature: read("T2M_MAX"),
      minimumTemperature: read("T2M_MIN"),
      humidity: read("RH2M"),
      windSpeed2m: read("WS2M"),
      solarRadiation: read("ALLSKY_SFC_SW_DWN"),
      precipitation: read("PRECTOTCORR"),
      pressure: read("PS"),
    };
  });
}

async function handleWaterRequest(params) {
  const {
    geometry: rawGeometry,
    latitude: rawLat,
    longitude: rawLon,
    areaHectares = 5,
    fieldId = "field-selected",
    fieldName = "Field area",
    from: fromInput,
    to: toInput,
    refresh = false,
  } = params;

  let geometry = rawGeometry;

  const hasLatLon =
    rawLat !== null &&
    rawLat !== undefined &&
    rawLat !== "" &&
    rawLon !== null &&
    rawLon !== undefined &&
    rawLon !== "" &&
    Number.isFinite(Number(rawLat)) &&
    Number.isFinite(Number(rawLon)) &&
    Number(rawLat) >= -90 &&
    Number(rawLat) <= 90 &&
    Number(rawLon) >= -180 &&
    Number(rawLon) <= 180;

  let latitude = hasLatLon ? Number(rawLat) : NaN;
  let longitude = hasLatLon ? Number(rawLon) : NaN;

  // Derive centroid if geometry is present but lat/lon are missing
  if (geometry && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
    const coords = geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0][0];
    if (coords && coords.length > 0) {
      longitude = coords.reduce((acc, c) => acc + c[0], 0) / coords.length;
      latitude = coords.reduce((acc, c) => acc + c[1], 0) / coords.length;
    }
  }

  // Derive bounding geometry if geometry is missing but lat/lon are given
  if (!geometry && hasLatLon) {
    geometry = createBoxPolygonFromPoint(latitude, longitude, Number(areaHectares) || 5);
  }

  const geomValidation = validateGeometry(geometry);
  if (!geomValidation.valid) {
    return Response.json({ error: geomValidation.error || "Invalid field geometry." }, { status: 400 });
  }
  const validGeometry = geomValidation.normalized;

  // Default to latest 90-day window if date range not specified
  let fromDate;
  let toDate;
  if (!fromInput || !toInput) {
    toDate = new Date();
    toDate.setUTCDate(toDate.getUTCDate() - 2); // 2-day operational latency buffer
    fromDate = new Date(toDate);
    fromDate.setUTCDate(fromDate.getUTCDate() - 90);
  } else {
    const dateValidation = validateDateRange(fromInput, toInput, 730);
    if (!dateValidation.valid) {
      return Response.json({ error: dateValidation.error || "Invalid date range." }, { status: 400 });
    }
    fromDate = dateValidation.fromDate;
    toDate = dateValidation.toDate;
  }

  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr = toDate.toISOString().slice(0, 10);

  // Cache lookup (bypassed if explicit refresh requested)
  const cacheKey = getCacheKey(validGeometry, fromStr, toStr);
  const cached = getFromCache(cacheKey);
  if (!refresh && cached) {
    return Response.json(cached, {
      headers: { "X-Cache": "HIT", "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400" },
    });
  }

  // 1. Discover actual NASA SMAP L4 and GPM IMERG granules via open NASA CMR
  const [smapGranules, imergGranules] = await Promise.all([
    discoverSmapGranules({ geometry: validGeometry, from: fromDate, to: toDate, limit: 15 }),
    discoverImergGranules({ geometry: validGeometry, from: fromDate, to: toDate, runType: "Early", limit: 15 }),
  ]);

  // 2. Fetch daily meteorological inputs from NASA POWER
  let powerRecords = [];
  try {
    powerRecords = await fetchNasaPowerDaily(latitude, longitude, fromDate, toDate);
  } catch (powerErr) {
    console.warn("NASA POWER fetch failed in /api/water:", powerErr);
  }

  // 3. Compute daily reference evapotranspiration (ET0)
  const et0Records = powerRecords.map((day) => computeDailyEt0(day, latitude));

  // Determine overall primary method used
  const hasFallback = et0Records.some((e) => e.isFallback);
  const et0Method = hasFallback
    ? "FAO-56 Penman-Monteith (with Hargreaves-Samani fallback on missing wind/humidity days)"
    : "FAO-56 Penman-Monteith";

  // 4. Check NASA Earthdata credentials status for direct HDF5 extraction
  const authConfigured = hasEarthdataCredentials();
  const authStatus = authConfigured ? "configured" : "credentials_required";
  const authMessage = authConfigured
    ? null
    : "NASA Earthdata Login credentials (EARTHDATA_TOKEN or EARTHDATA_USERNAME/PASSWORD) are not configured. Actual SMAP L4 V008 and GPM IMERG V07 granules were discovered via open NASA CMR below, but direct binary HDF5 extraction requires NASA Earthdata Login.";

  // 5. Climatology: Compare current precipitation total to historical normal if multi-year data exists
  const totalRain = powerRecords.reduce((acc, r) => acc + (r.precipitation || 0), 0);
  const rainfallAnomalyData = calculateRainfallAnomaly({
    currentTotalMm: totalRain,
    historicalMeanMm: null, // Requires multi-year archive
    baselineYearsCount: 0,
  });

  const normalized = normalizeWaterResponse({
    fieldId,
    fieldName,
    areaHectares: Number(areaHectares) || 5,
    geometry: validGeometry,
    from: fromStr,
    to: toStr,
    timeStandard: "UTC",
    smapGranules,
    imergGranules,
    powerRecords,
    et0Records,
    et0Method,
    soilMoistureData: null, // Populated via SMAP HDF5 when authenticated
    rainfallAnomalyData,
    authStatus,
    authMessage,
  });

  setToCache(cacheKey, normalized);

  return Response.json(normalized, {
    headers: {
      "X-Cache": "MISS",
      "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400",
    },
  });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const params = {
      latitude: searchParams.get("lat"),
      longitude: searchParams.get("lon"),
      areaHectares: searchParams.get("area"),
      fieldId: searchParams.get("fieldId") || "field-selected",
      fieldName: searchParams.get("fieldName") || "Field area",
      from: searchParams.get("from"),
      to: searchParams.get("to"),
    };

    return await handleWaterRequest(params);
  } catch (error) {
    console.error("GET /api/water error:", error);
    return Response.json({ error: error.message || "Failed to process water stress intelligence." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    return await handleWaterRequest(body);
  } catch (error) {
    console.error("POST /api/water error:", error);
    return Response.json({ error: error.message || "Invalid JSON request body." }, { status: 400 });
  }
}

