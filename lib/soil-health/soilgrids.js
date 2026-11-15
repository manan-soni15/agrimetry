// SoilGrids access layer.
// ISRIC has paused the beta REST API; WCS is therefore tried first. The REST
// client remains as a secondary path in case ISRIC restores it or WCS is down.
// WCS returns small GeoTIFF windows in the supported World Mollweide grid (ESRI/EPSG:54009).

import { fromArrayBuffer } from "geotiff";
import proj4 from "proj4";
import { DEPTHS, SOIL_PROPERTIES } from "./interpret.js";

export const SOILGRIDS_WCS_ENDPOINT = "https://maps.isric.org/mapserv";
export const SOILGRIDS_REST_ENDPOINT = "https://rest.isric.org/soilgrids/v2.0/properties/query";
// ISRIC also publishes SoilGrids in ESRI:54009 (World Mollweide). Proj4js
// supports +proj=moll, while its build does not guarantee the +proj=igh
// implementation required by the interrupted Homolosine grid.
const MOLLWEIDE = "+proj=moll +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";
const SOILGRIDS_CRS_URI = "http://www.opengis.net/def/crs/EPSG/0/54009";
const TOTAL_BUDGET_MS = 36_000;
const REST_BUDGET_MS = 6_000;
const TOPSOIL_WCS_BUDGET_MS = TOTAL_BUDGET_MS - REST_BUDGET_MS;
const WCS_TIMEOUT_MS = 12_000;
const WCS_CONCURRENCY = 5;
const RING_METRES = 300;
const WINDOW_RADIUS_METRES = 800;
const TOPSOIL = DEPTHS.slice(0, 3);
const DEEP = DEPTHS.slice(3);
const ALL_PROPERTIES = SOIL_PROPERTIES.map((p) => p.key);
const SCALE_FACTORS = { soc: 10, phh2o: 10, sand: 10, silt: 10, clay: 10, bdod: 100 };

proj4.defs("EPSG:54009", MOLLWEIDE);

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi) inside = !inside;
  }
  return inside;
}

function pointInGeometry(point, geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((rings) => rings.length && pointInRing(point, rings[0]) && !rings.slice(1).some((hole) => pointInRing(point, hole)));
}

function metresBetween(a, b) {
  const dx = (a[0] - b[0]) * 111320 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const dy = (a[1] - b[1]) * 110540;
  return Math.hypot(dx, dy);
}

export function chooseSamplePoints(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const ring = polygons.flatMap((polygon) => polygon[0] || []);
  const lons = ring.map((p) => Number(p[0]));
  const lats = ring.map((p) => Number(p[1]));
  const [minX, maxX, minY, maxY] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const centre = [(minX + maxX) / 2, (minY + maxY) / 2];
  const inside = [];
  for (let i = 0; i <= 8; i += 1) {
    for (let j = 0; j <= 8; j += 1) {
      const point = [minX + ((maxX - minX) * i) / 8, minY + ((maxY - minY) * j) / 8];
      if (pointInGeometry(point, geometry)) inside.push(point);
    }
  }
  inside.sort((a, b) => metresBetween(a, centre) - metresBetween(b, centre));
  const candidates = [];
  if (inside.length) {
    candidates.push({ point: inside[0], where: "inside" });
    const far = inside.find((p) => metresBetween(p, inside[0]) >= RING_METRES);
    if (far) candidates.push({ point: far, where: "inside" });
  } else candidates.push({ point: centre, where: "centre" });
  const base = candidates[0].point;
  const dLat = RING_METRES / 110540;
  const dLon = RING_METRES / (111320 * Math.max(0.2, Math.cos((base[1] * Math.PI) / 180)));
  for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) candidates.push({ point: [base[0] + dx * dLon, base[1] + dy * dLat], where: "nearby" });
  return candidates.slice(0, 3);
}

function isValidRasterValue(value, noData) {
  return Number.isFinite(value) && value !== noData && value !== -32768 && value !== -9999 && value !== -999 && value > -32000;
}

function buildCoverageUrl(property, depth, statistic, point) {
  const [x, y] = proj4("EPSG:4326", "EPSG:54009", point);
  const params = new URLSearchParams({
    map: `/map/${property}.map`,
    SERVICE: "WCS",
    VERSION: "2.0.1",
    REQUEST: "GetCoverage",
    COVERAGEID: `${property}_${depth.label}_${statistic}`,
    FORMAT: "GEOTIFF_INT16",
    SUBSETTINGCRS: SOILGRIDS_CRS_URI,
    OUTPUTCRS: SOILGRIDS_CRS_URI,
  });
  params.append("SUBSET", `X(${(x - WINDOW_RADIUS_METRES).toFixed(2)},${(x + WINDOW_RADIUS_METRES).toFixed(2)})`);
  params.append("SUBSET", `Y(${(y - WINDOW_RADIUS_METRES).toFixed(2)},${(y + WINDOW_RADIUS_METRES).toFixed(2)})`);
  return `${SOILGRIDS_WCS_ENDPOINT}?${params.toString()}`;
}

async function fetchWcsPixel(property, depth, statistic, point, timeoutMs) {
  const url = buildCoverageUrl(property, depth, statistic, point);
  const response = await fetch(url, {
    headers: { Accept: "image/tiff, application/octet-stream" },
    next: { revalidate: 2_592_000 },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`SoilGrids WCS ${property}/${depth.label} returned HTTP ${response.status}.`);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  const isTiff = (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00)
    || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a);
  if (!isTiff) throw new Error(`SoilGrids WCS did not return a GeoTIFF for ${property}/${depth.label}.`);

  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const raster = await image.readRasters({ interleave: true });
  const width = image.getWidth();
  const height = image.getHeight();
  const origin = image.getOrigin();
  const resolution = image.getResolution();
  const target = proj4("EPSG:4326", "EPSG:54009", point);
  const centreX = Math.floor((target[0] - origin[0]) / resolution[0]);
  const centreY = Math.floor((target[1] - origin[1]) / resolution[1]);
  const noData = image.getGDALNoData?.();
  let nearest = null;
  let nearestDistance = Infinity;
  // Search a 5x5 neighbourhood around the representative farm point. This
  // handles pixel-edge rounding without silently sampling a distant cell.
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const px = centreX + dx;
      const py = centreY + dy;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const raw = Number(raster[py * width + px]);
      if (!isValidRasterValue(raw, noData)) continue;
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) { nearest = raw; nearestDistance = distance; }
    }
  }
  if (nearest === null) return null;
  return nearest / SCALE_FACTORS[property];
}

async function mapWithConcurrency(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try { output[index] = { status: "fulfilled", value: await worker(items[index], index) }; }
      catch (reason) { output[index] = { status: "rejected", reason }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return output;
}

async function fetchWcsAtPoint(point, { mode, timeoutMs }) {
  const depths = mode === "deep" ? DEEP : TOPSOIL;
  const statistics = mode === "intervals" ? ["Q0.05", "Q0.95"] : ["mean"];
  const tasks = [];
  for (const property of ALL_PROPERTIES) for (const depth of (mode === "intervals" ? TOPSOIL : depths)) {
    for (const statistic of statistics) tasks.push({ property, depth, statistic });
  }
  const started = Date.now();
  const settled = await mapWithConcurrency(tasks, WCS_CONCURRENCY, async ({ property, depth, statistic }) => {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining < 1_000) throw new Error("WCS request budget exhausted.");
    return fetchWcsPixel(property, depth, statistic, point, Math.min(WCS_TIMEOUT_MS, remaining));
  });

  const layers = {};
  let valid = 0;
  settled.forEach((result, index) => {
    if (result?.status !== "fulfilled" || result.value === null) return;
    const { property, depth, statistic } = tasks[index];
    layers[property] ||= {};
    layers[property][depth.label] ||= { mean: null, low: null, high: null };
    if (statistic === "mean") layers[property][depth.label].mean = result.value;
    if (statistic === "Q0.05") layers[property][depth.label].low = result.value;
    if (statistic === "Q0.95") layers[property][depth.label].high = result.value;
    valid += 1;
  });
  return {
    layers: valid ? layers : null,
    valid,
    requested: tasks.length,
    failures: settled.filter((r) => r?.status === "rejected").length,
  };
}

// The paused REST API is retained as a short-budget fallback for future service
// recovery. Its values are already converted using ISRIC's d_factor metadata.
async function queryRestPoint([longitude, latitude], { properties, depths, values, timeoutMs }) {
  const params = new URLSearchParams();
  params.set("lon", longitude.toFixed(5));
  params.set("lat", latitude.toFixed(5));
  for (const key of properties) params.append("property", key);
  for (const depth of depths) params.append("depth", depth.label);
  for (const value of values) params.append("value", value);
  const response = await fetch(`${SOILGRIDS_REST_ENDPOINT}?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`SoilGrids REST returned HTTP ${response.status}.`);
  const payload = await response.json();
  const rawLayers = payload?.properties?.layers;
  if (!Array.isArray(rawLayers)) throw new Error("SoilGrids REST returned an unexpected response.");
  const layers = {};
  for (const layer of rawLayers) {
    const factor = Number(layer?.unit_measure?.d_factor) || 1;
    const convert = (value) => (Number.isFinite(value) ? value / factor : null);
    layers[layer.name] = {};
    for (const depth of layer.depths || []) {
      layers[layer.name][depth.label] = {
        mean: convert(depth?.values?.mean),
        low: convert(depth?.values?.["Q0.05"]),
        high: convert(depth?.values?.["Q0.95"]),
      };
    }
  }
  return layers;
}

const errorText = (error) => (error?.name === "TimeoutError" ? "timed out" : String(error?.message || error).slice(0, 140));

function countMeanValues(layers) {
  return Object.values(layers || {}).reduce((count, depths) => count + Object.values(depths || {}).filter((entry) => Number.isFinite(entry?.mean)).length, 0);
}

function mergeSoilLayers(primary, secondary) {
  const merged = structuredClone(primary || {});
  for (const [property, depths] of Object.entries(secondary || {})) {
    merged[property] ||= {};
    for (const [depth, values] of Object.entries(depths || {})) {
      merged[property][depth] ||= { mean: null, low: null, high: null };
      for (const key of ["mean", "low", "high"]) {
        if (!Number.isFinite(merged[property][depth][key]) && Number.isFinite(values?.[key])) merged[property][depth][key] = values[key];
      }
    }
  }
  return merged;
}

export async function fetchSoilGrids(geometry, { mode = "topsoil", samplePoint = null } = {}) {
  const started = Date.now();
  const attempts = [];
  const requestedMode = ["deep", "intervals"].includes(mode) ? mode : "topsoil";
  const candidates = requestedMode === "topsoil"
    ? chooseSamplePoints(geometry)
    : samplePoint ? [{ point: [Number(samplePoint.longitude), Number(samplePoint.latitude)], where: samplePoint.where || "inside" }] : [];
  if (!candidates.length || candidates.some((c) => !c.point.every(Number.isFinite))) {
    throw new Error("A valid sample point is required for this SoilGrids request.");
  }

  let lastError = null;
  let partialWcs = null;
  // Reserve time for the REST secondary attempt. Without this reserve, slow WCS
  // timeouts could consume the whole request budget before the backup is tried.
  const wcsBudget = requestedMode === "topsoil" ? TOPSOIL_WCS_BUDGET_MS : TOTAL_BUDGET_MS;
  for (const candidate of candidates) {
    const remaining = wcsBudget - (Date.now() - started);
    if (remaining < 3_000) break;
    const record = { longitude: candidate.point[0], latitude: candidate.point[1], where: candidate.where };
    try {
      const wcs = await fetchWcsAtPoint(candidate.point, { mode: requestedMode, timeoutMs: remaining });
      attempts.push({ ...record, hasData: Boolean(wcs.layers), service: "WCS", failedLayers: wcs.failures, validLayers: wcs.valid, requestedLayers: wcs.requested });
      if (wcs.layers) {
        // A complete WCS response can return immediately. If only some coverages
        // arrived, keep them and try the REST backup so one broken layer does not
        // erase the usable properties already retrieved.
        const bestWcs = { layers: wcs.layers, valid: wcs.valid, requested: wcs.requested, sample: record };
        if (wcs.valid >= wcs.requested) {
          return { layers: wcs.layers, sample: { ...record, service: "WCS" }, attempts, service: "WCS", coverage: { returned: wcs.valid, requested: wcs.requested } };
        }
        if (!partialWcs || wcs.valid > partialWcs.valid) partialWcs = bestWcs;
      }
    } catch (error) {
      lastError = error;
      attempts.push({ ...record, hasData: false, service: "WCS", error: errorText(error) });
      // A transport or format failure is unlikely to improve at another point.
      break;
    }
  }

  const remaining = Math.min(REST_BUDGET_MS, TOTAL_BUDGET_MS - (Date.now() - started));
  if (requestedMode === "topsoil" && remaining > 1_000) {
    const fallbackSample = partialWcs?.sample || { longitude: candidates[0].point[0], latitude: candidates[0].point[1], where: candidates[0].where };
    const point = [fallbackSample.longitude, fallbackSample.latitude];
    try {
      const layers = await queryRestPoint(point, {
        properties: ALL_PROPERTIES,
        depths: TOPSOIL,
        values: ["mean"],
        timeoutMs: remaining,
      });
      const valid = countMeanValues(layers);
      const requested = ALL_PROPERTIES.length * TOPSOIL.length;
      attempts.push({ longitude: point[0], latitude: point[1], where: fallbackSample.where, hasData: valid > 0, service: "REST", validLayers: valid, requestedLayers: requested });
      if (valid > 0) {
        const merged = mergeSoilLayers(partialWcs?.layers, layers);
        const mergedCount = countMeanValues(merged);
        const service = partialWcs ? "WCS+REST" : "REST";
        const sample = { longitude: point[0], latitude: point[1], where: fallbackSample.where, service };
        return { layers: merged, sample, attempts, service, coverage: { returned: mergedCount, requested, wcsReturned: partialWcs?.valid ?? 0, restReturned: valid } };
      }
    } catch (error) {
      lastError = error;
      attempts.push({ longitude: point[0], latitude: point[1], where: fallbackSample.where, hasData: false, service: "REST", error: errorText(error) });
    }
  }

  if (partialWcs?.layers) {
    return {
      layers: partialWcs.layers,
      sample: { ...partialWcs.sample, service: "WCS" },
      attempts,
      service: "WCS",
      coverage: { returned: partialWcs.valid, requested: partialWcs.requested },
      error: "Some SoilGrids coverages did not respond; only the available properties are included.",
    };
  }
  return { layers: null, sample: null, attempts, service: null, coverage: null, error: errorText(lastError || new Error("SoilGrids maps did not return a usable estimate.")) };
}
