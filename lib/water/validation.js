/**
 * Spatial and Temporal Input Validation for Water Stress Intelligence.
 */

/**
 * Validates GeoJSON Polygon or MultiPolygon geometry.
 *
 * @param {Object} geometry
 * @returns {{ valid: boolean, error?: string, normalized?: Object }}
 */
export function validateGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") {
    return { valid: false, error: "Missing geometry object." };
  }

  const { type, coordinates } = geometry;

  if (type !== "Polygon" && type !== "MultiPolygon") {
    return {
      valid: false,
      error: `Unsupported geometry type "${type}". Only Polygon and MultiPolygon are supported.`,
    };
  }

  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return { valid: false, error: "Geometry coordinates must be a non-empty array." };
  }

  function validateLinearRing(ring) {
    if (!Array.isArray(ring) || ring.length < 4) {
      return "Exterior ring must contain at least 4 coordinate positions.";
    }

    const first = ring[0];
    const last = ring[ring.length - 1];

    if (!Array.isArray(first) || !Array.isArray(last) || first.length < 2 || last.length < 2) {
      return "Each coordinate must be a [longitude, latitude] pair.";
    }

    const lonDiff = Math.abs(first[0] - last[0]);
    const latDiff = Math.abs(first[1] - last[1]);
    if (lonDiff > 1e-6 || latDiff > 1e-6) {
      return "Polygon ring is unclosed: first and last coordinates must match.";
    }

    for (const pt of ring) {
      const lon = Number(pt[0]);
      const lat = Number(pt[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        return "Coordinate values must be finite numbers.";
      }
      if (lon < -180 || lon > 180) {
        return `Longitude ${lon} out of valid bounds [-180, 180].`;
      }
      if (lat < -90 || lat > 90) {
        return `Latitude ${lat} out of valid bounds [-90, 90].`;
      }
    }

    return null;
  }

  if (type === "Polygon") {
    const ringError = validateLinearRing(coordinates[0]);
    if (ringError) return { valid: false, error: ringError };
  } else if (type === "MultiPolygon") {
    for (const poly of coordinates) {
      if (!Array.isArray(poly) || poly.length === 0) {
        return { valid: false, error: "MultiPolygon contains an empty polygon." };
      }
      const ringError = validateLinearRing(poly[0]);
      if (ringError) return { valid: false, error: ringError };
    }
  }

  return { valid: true, normalized: geometry };
}

/**
 * Creates a bounding box Polygon centered at a lat/lon point with approximate area.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @param {number} [areaHectares=5]
 * @returns {Object} GeoJSON Polygon
 */
export function createBoxPolygonFromPoint(latitude, longitude, areaHectares = 5) {
  const sideMeters = Math.max(50, Math.sqrt(areaHectares * 10000));
  const halfSideMeters = sideMeters / 2;

  const latDelta = halfSideMeters / 111320;
  const lonDelta = halfSideMeters / (111320 * Math.max(0.1, Math.cos((latitude * Math.PI) / 180)));

  const minLat = Number((latitude - latDelta).toFixed(6));
  const maxLat = Number((latitude + latDelta).toFixed(6));
  const minLon = Number((longitude - lonDelta).toFixed(6));
  const maxLon = Number((longitude + lonDelta).toFixed(6));

  return {
    type: "Polygon",
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
      ],
    ],
  };
}

/**
 * Validates temporal query range.
 *
 * @param {string} fromStr - YYYY-MM-DD
 * @param {string} toStr - YYYY-MM-DD
 * @param {number} [maxDays=730]
 * @returns {{ valid: boolean, error?: string, fromDate?: Date, toDate?: Date }}
 */
export function validateDateRange(fromStr, toStr, maxDays = 730) {
  if (!fromStr || !toStr) {
    return { valid: false, error: "Both 'from' and 'to' date parameters are required (YYYY-MM-DD)." };
  }

  const fromDate = new Date(`${fromStr}T00:00:00Z`);
  const toDate = new Date(`${toStr}T23:59:59Z`);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return { valid: false, error: "Invalid date format. Use ISO format YYYY-MM-DD." };
  }

  if (fromDate > toDate) {
    return { valid: false, error: `Start date (${fromStr}) cannot be after end date (${toStr}).` };
  }

  const diffDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays > maxDays) {
    return { valid: false, error: `Date range (${diffDays} days) exceeds maximum allowable window (${maxDays} days).` };
  }

  return { valid: true, fromDate, toDate, diffDays };
}

