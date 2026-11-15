// Server-side SoilGrids (ISRIC) point query. Public, no key. The REST service is
// described by ISRIC as a prototype with a low rate limit, and it answers layer by
// layer (roughly one second per property-depth-statistic, slower under load), so
// requests are split into small stages and stop as soon as the time budget is spent.

import { DEPTHS, SOIL_PROPERTIES } from "./interpret.js";

export const SOILGRIDS_ENDPOINT = "https://rest.isric.org/soilgrids/v2.0/properties/query";
const TOTAL_BUDGET_MS = 54_000;
const MAX_ATTEMPTS = 3;
const RING_METRES = 300;
const TOPSOIL = DEPTHS.slice(0, 3);
const DEEP = DEPTHS.slice(3);
const ALL_PROPERTIES = SOIL_PROPERTIES.map((p) => p.key);

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

// Candidate sample points: inside the field first (nearest the middle), then a
// second inside point far from the first, then points just outside the boundary.
export function chooseSamplePoints(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const ring = polygons.flatMap((polygon) => polygon[0] || []);
  const lons = ring.map((p) => Number(p[0]));
  const lats = ring.map((p) => Number(p[1]));
  const [minX, maxX, minY, maxY] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const centre = [(minX + maxX) / 2, (minY + maxY) / 2];

  const inside = [];
  const steps = 8;
  for (let i = 0; i <= steps; i += 1) {
    for (let j = 0; j <= steps; j += 1) {
      const point = [minX + ((maxX - minX) * i) / steps, minY + ((maxY - minY) * j) / steps];
      if (pointInGeometry(point, geometry)) inside.push(point);
    }
  }
  inside.sort((a, b) => metresBetween(a, centre) - metresBetween(b, centre));

  const candidates = [];
  if (inside.length) {
    candidates.push({ point: inside[0], where: "inside" });
    const far = inside.find((p) => metresBetween(p, inside[0]) >= RING_METRES);
    if (far) candidates.push({ point: far, where: "inside" });
  } else {
    candidates.push({ point: centre, where: "centre" });
  }
  const base = candidates[0].point;
  const dLat = RING_METRES / 110540;
  const dLon = RING_METRES / (111320 * Math.max(0.2, Math.cos((base[1] * Math.PI) / 180)));
  for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
    candidates.push({ point: [base[0] + dx * dLon, base[1] + dy * dLat], where: "nearby" });
  }
  return candidates.slice(0, MAX_ATTEMPTS);
}

function httpError(response) {
  if (response.status === 429) {
    const error = new Error("SoilGrids is rate-limiting requests right now. Wait a minute and try again.");
    error.status = 429;
    return error;
  }
  return new Error(`SoilGrids returned HTTP ${response.status}.`);
}

async function queryPoint([longitude, latitude], { properties, depths, values, timeoutMs }) {
  const params = new URLSearchParams();
  params.set("lon", longitude.toFixed(5));
  params.set("lat", latitude.toFixed(5));
  for (const key of properties) params.append("property", key);
  for (const depth of depths) params.append("depth", depth.label);
  for (const value of values) params.append("value", value);

  const response = await fetch(`${SOILGRIDS_ENDPOINT}?${params}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 604800 },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw httpError(response);
  const payload = await response.json();
  const rawLayers = payload?.properties?.layers;
  if (!Array.isArray(rawLayers)) throw new Error("SoilGrids returned an unexpected response.");

  const layers = {};
  let valid = 0;
  for (const layer of rawLayers) {
    const factor = Number(layer?.unit_measure?.d_factor) || 1;
    const convert = (value) => (Number.isFinite(value) ? value / factor : null);
    layers[layer.name] = {};
    for (const depth of layer.depths || []) {
      const mean = convert(depth?.values?.mean);
      layers[layer.name][depth.label] = { mean, low: convert(depth?.values?.["Q0.05"]), high: convert(depth?.values?.["Q0.95"]) };
      if (mean !== null || layers[layer.name][depth.label].low !== null) valid += 1;
    }
  }
  return { layers, valid };
}

const errorText = (error) => (error?.name === "TimeoutError" ? "timed out" : String(error?.message || error).slice(0, 120));

// Modes (each is one small stage so it fits the time budget):
//   "topsoil"   probe for a sample point with data, then 0-30 cm means (the profile)
//   "deep"      30-200 cm means at the sample point from an earlier topsoil call
//   "intervals" 90% prediction-interval bounds for 0-30 cm at that sample point
// SoilGrids takes roughly one second per property-depth-statistic, so intervals
// (two statistics for every layer) are requested separately rather than by default.
export async function fetchSoilGrids(geometry, { mode = "topsoil", samplePoint = null } = {}) {
  const started = Date.now();
  const remainingMs = () => TOTAL_BUDGET_MS - (Date.now() - started);
  const attempts = [];

  if (mode === "deep" || mode === "intervals") {
    if (!samplePoint) throw new Error("A sample point from the topsoil lookup is needed for this request.");
    const point = [Number(samplePoint.longitude), Number(samplePoint.latitude)];
    const options = mode === "deep"
      ? { properties: ALL_PROPERTIES, depths: DEEP, values: ["mean"] }
      : { properties: ALL_PROPERTIES, depths: TOPSOIL, values: ["Q0.05", "Q0.95"] };
    try {
      const { layers } = await queryPoint(point, { ...options, timeoutMs: remainingMs() - 1_000 });
      return { layers, sample: samplePoint, attempts };
    } catch (error) {
      if (error?.status === 429) throw error;
      attempts.push({ longitude: point[0], latitude: point[1], where: samplePoint.where, hasData: false, error: errorText(error) });
      return { layers: null, sample: null, attempts };
    }
  }

  for (const candidate of chooseSamplePoints(geometry)) {
    if (remainingMs() < 6_000) break;
    const record = { longitude: candidate.point[0], latitude: candidate.point[1], where: candidate.where };
    try {
      // Cheap one-layer probe: tells us quickly whether this 250 m cell has data.
      const probe = await queryPoint(candidate.point, { properties: ["soc"], depths: [TOPSOIL[0]], values: ["mean"], timeoutMs: Math.min(20_000, remainingMs()) });
      if (probe.valid === 0) { attempts.push({ ...record, hasData: false }); continue; }
      const { layers } = await queryPoint(candidate.point, { properties: ALL_PROPERTIES, depths: TOPSOIL, values: ["mean"], timeoutMs: Math.min(45_000, remainingMs()) });
      attempts.push({ ...record, hasData: true });
      return { layers, sample: attempts[attempts.length - 1], attempts };
    } catch (error) {
      attempts.push({ ...record, hasData: false, error: errorText(error) });
      if (error?.status === 429) throw error;
      break; // a slow or failing service will not answer a nearby point faster
    }
  }
  return { layers: null, sample: null, attempts };
}
