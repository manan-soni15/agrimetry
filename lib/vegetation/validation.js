/**
 * Geometry and Query Validation Utilities for Satellite Processing.
 */

/**
 * Validates coordinate pair [lon, lat].
 * @param {any} point - [longitude, latitude]
 * @returns {boolean}
 */
export function isValidCoordinate(point) {
  if (!Array.isArray(point) || point.length < 2) return false;
  const lon = Number(point[0]);
  const lat = Number(point[1]);
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= -180 &&
    lon <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

/**
 * Validates that a GeoJSON geometry is a valid Polygon or MultiPolygon.
 *
 * @param {any} geometry - GeoJSON geometry object
 * @returns {{ valid: boolean, error?: string, normalized?: Object }}
 */
export function validateGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") {
    return { valid: false, error: "Geometry must be a valid GeoJSON object." };
  }

  const type = geometry.type;
  if (type !== "Polygon" && type !== "MultiPolygon") {
    return { valid: false, error: `Unsupported geometry type "${type}". Only Polygon and MultiPolygon are supported.` };
  }

  const coordinates = geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return { valid: false, error: "Geometry coordinates must be a non-empty array." };
  }

  const polygons = type === "Polygon" ? [coordinates] : coordinates;
  let totalVertices = 0;

  for (const poly of polygons) {
    if (!Array.isArray(poly) || poly.length === 0) {
      return { valid: false, error: "Polygon must contain at least an exterior linear ring." };
    }

    const exteriorRing = poly[0];
    if (!Array.isArray(exteriorRing) || exteriorRing.length < 4) {
      return { valid: false, error: "Exterior ring must contain at least 4 coordinate positions." };
    }

    // Check first and last point match (closed ring)
    const first = exteriorRing[0];
    const last = exteriorRing[exteriorRing.length - 1];
    if (
      !first ||
      !last ||
      Math.abs(first[0] - last[0]) > 1e-7 ||
      Math.abs(first[1] - last[1]) > 1e-7
    ) {
      return { valid: false, error: "Linear ring is not closed: first and last coordinates must match." };
    }

    for (const point of exteriorRing) {
      if (!isValidCoordinate(point)) {
        return { valid: false, error: `Invalid coordinate [${point}]. Coordinates must be [longitude, latitude] within [-180, 180] and [-90, 90].` };
      }
      totalVertices += 1;
    }
  }

  // Guard against excessively complex polygons (e.g. > 1000 vertices) that overwhelm the API
  if (totalVertices > 1500) {
    return { valid: false, error: `Geometry is too complex (${totalVertices} vertices). Maximum supported is 1500 vertices.` };
  }

  return {
    valid: true,
    normalized: {
      type,
      coordinates,
    },
  };
}

/**
 * Creates a rectangular GeoJSON Polygon around a center coordinate.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @param {number} [areaHectares=2] - Target area in hectares
 * @returns {Object} GeoJSON Polygon geometry
 */
export function createBoxPolygonFromPoint(latitude, longitude, areaHectares = 2) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  const ha = Math.max(0.1, Math.min(Number(areaHectares) || 2, 500));

  // 1 hectare = 10,000 m^2 (~100m x 100m)
  // 1 deg latitude ≈ 111,320 m
  const sideMeters = Math.sqrt(ha * 10000);
  const halfSideMeters = sideMeters / 2;

  const latDelta = halfSideMeters / 111320;
  const metersPerLonDeg = 111320 * Math.cos((lat * Math.PI) / 180);
  const lonDelta = halfSideMeters / (metersPerLonDeg > 100 ? metersPerLonDeg : 111320);

  const minLat = Math.max(-90, lat - latDelta);
  const maxLat = Math.min(90, lat + latDelta);
  const minLon = Math.max(-180, lon - lonDelta);
  const maxLon = Math.min(180, lon + lonDelta);

  return {
    type: "Polygon",
    coordinates: [[
      [minLon, minLat],
      [maxLon, minLat],
      [maxLon, maxLat],
      [minLon, maxLat],
      [minLon, minLat],
    ]],
  };
}

/**
 * Computes bounding box [minLon, minLat, maxLon, maxLat] of a Polygon or MultiPolygon.
 * @param {Object} geometry
 * @returns {[number, number, number, number]}
 */
export function getGeometryBBox(geometry) {
  let minLon = 180;
  let maxLon = -180;
  let minLat = 90;
  let maxLat = -90;

  const type = geometry.type;
  const polygons = type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;

  for (const poly of polygons) {
    const ring = poly[0];
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Validates and normalizes date ranges.
 *
 * @param {string} from - ISO date string
 * @param {string} to - ISO date string
 * @param {number} [maxDays=366] - Maximum allowed range span
 * @returns {{ valid: boolean, fromDate?: Date, toDate?: Date, error?: string }}
 */
export function validateDateRange(from, to, maxDays = 366) {
  const fromDate = from ? new Date(from) : new Date(Date.now() - 90 * 86400000);
  const toDate = to ? new Date(to) : new Date();

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return { valid: false, error: "Dates must be valid ISO 8601 strings (e.g. YYYY-MM-DD)." };
  }

  if (fromDate > toDate) {
    return { valid: false, error: `Start date (${from}) cannot be after end date (${to}).` };
  }

  const diffDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays > maxDays) {
    return { valid: false, error: `Requested date range (${Math.round(diffDays)} days) exceeds maximum limit of ${maxDays} days.` };
  }

  return { valid: true, fromDate, toDate };
}

