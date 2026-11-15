/**
 * Field Vegetation Intelligence API Route.
 *
 * Implements Sentinel-2 L2A Surface Reflectance vegetation analysis
 * via Copernicus Data Space Ecosystem (CDSE) APIs.
 */

import { hasCopernicusCredentials } from "../../../lib/vegetation/copernicus-auth.js";
import { discoverSentinelScenes } from "../../../lib/vegetation/sentinel-stac.js";
import { querySentinelStatistics } from "../../../lib/vegetation/sentinel-statistics.js";
import { normalizeVegetationResponse } from "../../../lib/vegetation/normalize-response.js";
import {
  createBoxPolygonFromPoint,
  validateDateRange,
  validateGeometry,
} from "../../../lib/vegetation/validation.js";

// Simple in-memory response cache with TTL (30 minutes)
const responseCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

export function getCacheKey(geometry, fromStr, toStr, interval) {
  const coordSample = JSON.stringify(geometry?.coordinates?.[0]?.[0] || "");
  return `${coordSample}_${fromStr}_${toStr}_${interval}`;
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
  // Cap cache size
  if (responseCache.size > 200) {
    const oldestKey = responseCache.keys().next().value;
    responseCache.delete(oldestKey);
  }
  responseCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function handleVegetationRequest(params) {
  const {
    geometry: rawGeometry,
    latitude,
    longitude,
    areaHectares = 2,
    fieldId = "field-selected",
    fieldName = "Field area",
    from: fromInput,
    to: toInput,
    interval = "P10D",
    includeWater = false,
    includeCastShadow = false,
    refresh = false,
  } = params;

  let geometry = rawGeometry;

  const hasLatLon =
    latitude !== null &&
    latitude !== undefined &&
    latitude !== "" &&
    longitude !== null &&
    longitude !== undefined &&
    longitude !== "" &&
    Number.isFinite(Number(latitude)) &&
    Number.isFinite(Number(longitude)) &&
    Number(latitude) >= -90 &&
    Number(latitude) <= 90 &&
    Number(longitude) >= -180 &&
    Number(longitude) <= 180;

  // If no geometry was supplied, but valid latitude and longitude are provided, create bounding polygon
  if (!geometry && hasLatLon) {
    geometry = createBoxPolygonFromPoint(Number(latitude), Number(longitude), Number(areaHectares) || 2);
  }

  const geomValidation = validateGeometry(geometry);
  if (!geomValidation.valid) {
    return Response.json(
      { error: geomValidation.error || "Invalid field geometry." },
      { status: 400 },
    );
  }
  const validGeometry = geomValidation.normalized;

  const dateValidation = validateDateRange(fromInput, toInput, 366);
  if (!dateValidation.valid) {
    return Response.json(
      { error: dateValidation.error || "Invalid date range." },
      { status: 400 },
    );
  }
  const { fromDate, toDate } = dateValidation;
  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr = toDate.toISOString().slice(0, 10);

  // Check cache (bypassed if explicit refresh requested)
  const cacheKey = getCacheKey(validGeometry, fromStr, toStr, interval);
  const cached = getFromCache(cacheKey);
  if (!refresh && cached) {
    return Response.json(cached, {
      headers: { "X-Cache": "HIT", "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400" },
    });
  }

  // 1. Discover actual Sentinel-2 L2A scene acquisitions via CDSE STAC (Open metadata API)
  const stacScenes = await discoverSentinelScenes({
    geometry: validGeometry,
    from: fromDate,
    to: toDate,
  });

  // 2. Query Sentinel Hub Statistical API if credentials are configured
  let timeseries = [];
  let authStatus = "configured";
  let authMessage = null;

  if (hasCopernicusCredentials()) {
    try {
      timeseries = await querySentinelStatistics({
        geometry: validGeometry,
        from: fromDate,
        to: toDate,
        interval,
        options: { includeWater, includeCastShadow },
      });
    } catch (statError) {
      console.error("Sentinel Hub Statistical API error:", statError);
      if (statError.code === "AUTH_FAILED" || statError.status === 401) {
        authStatus = "auth_failed";
        authMessage = "Copernicus authentication failed. Verify CDSE_CLIENT_ID and CDSE_CLIENT_SECRET in .env.local.";
      } else {
        return Response.json(
          {
            error: `Copernicus Sentinel Hub API error: ${statError.message}`,
            discoveredScenes: stacScenes.length,
          },
          { status: statError.status || 502 },
        );
      }
    }
  } else {
    authStatus = "credentials_required";
    authMessage =
      "Copernicus Data Space Ecosystem credentials (CDSE_CLIENT_ID and CDSE_CLIENT_SECRET) are not configured. Actual Sentinel-2 L2A scenes for this field were discovered via open STAC metadata below, but pixel-level statistics calculation requires CDSE credentials.";
  }

  const normalized = normalizeVegetationResponse({
    fieldId,
    fieldName,
    areaHectares,
    geometry: validGeometry,
    from: fromStr,
    to: toStr,
    interval,
    timeseries,
    stacScenes,
    options: { includeWater, includeCastShadow },
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
      interval: searchParams.get("interval") || "P10D",
      includeWater: searchParams.get("includeWater") === "true",
      includeCastShadow: searchParams.get("includeCastShadow") === "true",
    };

    return await handleVegetationRequest(params);
  } catch (error) {
    console.error("GET /api/vegetation uncaught error:", error);
    return Response.json({ error: error.message || "Failed to process vegetation request." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    return await handleVegetationRequest(body);
  } catch (error) {
    console.error("POST /api/vegetation uncaught error:", error);
    return Response.json({ error: error.message || "Invalid JSON request body." }, { status: 400 });
  }
}

