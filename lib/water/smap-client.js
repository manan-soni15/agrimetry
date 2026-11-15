/**
 * NASA SMAP L4 Soil Moisture Client (SPL4SMGP V008).
 *
 * Provider: NASA NSIDC DAAC
 * Mission: Soil Moisture Active Passive (SMAP)
 * Product: SPL4SMGP V008 (SMAP L4 Global 3-hourly 9 km EASE-Grid Surface and Root Zone Soil Moisture Geophysical Data)
 * Native Resolution: ~9 km (EASE-Grid 2.0 M09)
 * Format: HDF5
 *
 * CRITICAL SCIENTIFIC DISTINCTION:
 * SMAP L4 root-zone soil moisture is a model-assimilated estimate informed by SMAP observations
 * and the NASA Catchment Land Surface Model. It is NOT a direct satellite measurement throughout
 * the 0-100 cm soil column.
 */

const CMR_GRANULE_ENDPOINT = "https://cmr.earthdata.nasa.gov/search/granules.json";

// EASE-Grid 2.0 Global Cylindrical Equal-Area (EPSG:6933, M09 9km nominal grid)
// Reference: Brodzik, M.J., Billingsley, B., Haran, T., Raup, B., Savoie, M.H. (2012, 2014)
const WGS84_A = 6378137.0; // semi-major axis in meters
const WGS84_F = 1 / 298.257223563; // flattening
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F; // eccentricity squared ~ 0.00669437999014
const WGS84_E = Math.sqrt(WGS84_E2); // eccentricity ~ 0.0818191908426
const PHI_0 = (30 * Math.PI) / 180; // standard parallel 30°
const K0 = Math.cos(PHI_0) / Math.sqrt(1 - WGS84_E2 * Math.sin(PHI_0) * Math.sin(PHI_0));

export const EASE2_GRID_CONFIG = {
  gridName: "EASE-Grid 2.0 M09",
  epsgCode: 6933,
  standardParallelDeg: 30.0,
  nominalResolutionKm: 9.00805,
  cellSizeMeters: 9008.0545239,
  columns: 3856,
  rows: 1624,
  xMinMeters: -(3856 * 9008.0545239) / 2, // ~ -17367529.1 m
  yMaxMeters: (1624 * 9008.0545239) / 2, // ~ 7314540.3 m
};

export const SMAP_VARIABLES = {
  sm_surface: {
    name: "sm_surface",
    hdfPath: "Geophysical_Data/sm_surface",
    layer: "Surface soil moisture (top 0–5 cm)",
    unit: "m³/m³",
    nature: "Assimilated / SMAP-informed surface layer",
    fillValue: -9999.0,
    validMin: 0.0,
    validMax: 0.9,
  },
  sm_rootzone: {
    name: "sm_rootzone",
    hdfPath: "Geophysical_Data/sm_rootzone",
    layer: "Root-zone soil moisture (top 0–100 cm)",
    unit: "m³/m³",
    nature: "Model-assimilated estimate (Catchment Land Surface Model informed by SMAP). NOT a direct satellite measurement.",
    fillValue: -9999.0,
    validMin: 0.0,
    validMax: 0.9,
  },
  sm_surface_wetness: {
    name: "sm_surface_wetness",
    hdfPath: "Geophysical_Data/sm_surface_wetness",
    layer: "Surface wetness indicator",
    unit: "dimensionless",
    nature: "Relative wetness fraction between residual and saturation moisture",
    fillValue: -9999.0,
    validMin: 0.0,
    validMax: 1.0,
  },
  sm_rootzone_wetness: {
    name: "sm_rootzone_wetness",
    hdfPath: "Geophysical_Data/sm_rootzone_wetness",
    layer: "Root-zone wetness indicator",
    unit: "dimensionless",
    nature: "Relative wetness fraction in root-zone column",
    fillValue: -9999.0,
    validMin: 0.0,
    validMax: 1.0,
  },
  sm_rootzone_pctl: {
    name: "sm_rootzone_pctl",
    hdfPath: "Geophysical_Data/sm_rootzone_pctl",
    layer: "Product-derived root-zone percentile",
    unit: "%",
    nature: "Climatological percentile within SMAP L4 Nature Run baseline",
    fillValue: -9999.0,
    validMin: 0.0,
    validMax: 100.0,
  },
};

/**
 * Projects latitude/longitude (WGS84) to EASE-Grid 2.0 Global Cylindrical Equal-Area (EPSG:6933).
 *
 * @param {number} latitude - Decimal degrees [-90, 90]
 * @param {number} longitude - Decimal degrees [-180, 180]
 * @returns {{ x: number, y: number, col: number, row: number, inBounds: boolean }}
 */
export function latLonToEase2Grid(latitude, longitude) {
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
    return { x: null, y: null, col: null, row: null, inBounds: false };
  }

  const phi = (latitude * Math.PI) / 180;
  const lam = (longitude * Math.PI) / 180;

  const sinPhi = Math.sin(phi);
  const x = WGS84_A * K0 * lam;

  const q =
    (1 - WGS84_E2) *
    (sinPhi / (1 - WGS84_E2 * sinPhi * sinPhi) -
      (1 / (2 * WGS84_E)) * Math.log((1 - WGS84_E * sinPhi) / (1 + WGS84_E * sinPhi)));
  const y = (WGS84_A * q) / (2 * K0);

  const col = Math.floor((x - EASE2_GRID_CONFIG.xMinMeters) / EASE2_GRID_CONFIG.cellSizeMeters);
  const row = Math.floor((EASE2_GRID_CONFIG.yMaxMeters - y) / EASE2_GRID_CONFIG.cellSizeMeters);

  const inBounds =
    col >= 0 &&
    col < EASE2_GRID_CONFIG.columns &&
    row >= 0 &&
    row < EASE2_GRID_CONFIG.rows;

  return {
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
    col: inBounds ? col : null,
    row: inBounds ? row : null,
    inBounds,
  };
}

/**
 * Checks if NASA Earthdata credentials are configured.
 *
 * @returns {boolean}
 */
export function hasEarthdataCredentials() {
  const token = process.env.EARTHDATA_TOKEN?.trim();
  const user = process.env.EARTHDATA_USERNAME?.trim();
  const pass = process.env.EARTHDATA_PASSWORD?.trim();
  return Boolean(token || (user && pass));
}

/**
 * Extracts bounding box coordinates from a GeoJSON Polygon or MultiPolygon.
 *
 * @param {Object} geometry
 * @returns {{ minLon: number, minLat: number, maxLon: number, maxLat: number }}
 */
export function extractPolygonBoundingBox(geometry) {
  if (!geometry || !geometry.coordinates) {
    return { minLon: 0, minLat: 0, maxLon: 0, maxLat: 0 };
  }
  const coords = geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0][0];
  let minLon = 180,
    maxLon = -180,
    minLat = 90,
    maxLat = -90;

  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  return { minLon, minLat, maxLon, maxLat };
}

/**
 * Discovers real SMAP L4 SPL4SMGP V008 granules from NASA CMR for a given bounding box.
 *
 * @param {Object} params
 * @param {Object} params.geometry - GeoJSON Polygon
 * @param {Date} params.from - Start date
 * @param {Date} params.to - End date
 * @param {number} [params.limit=20] - Maximum granules to retrieve
 * @returns {Promise<Array<Object>>} List of discovered granules
 */
export async function discoverSmapGranules({ geometry, from, to, limit = 20 }) {
  const bbox = extractPolygonBoundingBox(geometry);
  const boundingBoxStr = `${bbox.minLon.toFixed(4)},${bbox.minLat.toFixed(4)},${bbox.maxLon.toFixed(4)},${bbox.maxLat.toFixed(4)}`;
  const temporalStr = `${from.toISOString().slice(0, 19)}Z,${to.toISOString().slice(0, 19)}Z`;

  const searchParams = new URLSearchParams({
    short_name: "SPL4SMGP",
    version: "008",
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
      console.warn(`NASA CMR SMAP query returned status ${response.status}`);
      return [];
    }

    const payload = await response.json();
    const entries = payload?.feed?.entry || [];

    return entries.map((entry) => {
      const dataLinks = (entry.links || []).filter((l) => l.href && !l.inherited);
      const downloadLink = dataLinks.find((l) => l.href.endsWith(".h5"))?.href || dataLinks[0]?.href || null;

      return {
        id: entry.id,
        title: entry.title,
        timeStart: entry.time_start,
        timeEnd: entry.time_end,
        granuleSizeMb: entry.granule_size ? Number(entry.granule_size).toFixed(1) : null,
        downloadUrl: downloadLink,
      };
    });
  } catch (error) {
    console.error("NASA CMR SMAP discovery error:", error);
    return [];
  }
}

/**
 * Decodes and validates a single grid point from an SMAP L4 HDF5 dataset.
 *
 * @param {Object} params
 * @param {string} [params.variableKey="sm_surface"]
 * @param {number} params.value - Raw value from HDF5 array
 * @param {number} [params.qflag=0] - Quality flag integer (0 = nominal)
 * @returns {Object} Decoded result with scientific metadata and validation status
 */
export function decodeSmapHdf5GridPoint({
  variableKey = "sm_surface",
  value,
  qflag = 0,
}) {
  const meta = SMAP_VARIABLES[variableKey] || SMAP_VARIABLES.sm_surface;

  if (value == null || !Number.isFinite(value)) {
    return {
      variable: meta.name,
      value: null,
      unit: meta.unit,
      status: "missing",
      quality: "missing",
      fillValue: false,
      valid: false,
    };
  }

  if (value === meta.fillValue || value < meta.validMin || value > meta.validMax) {
    return {
      variable: meta.name,
      value: null,
      unit: meta.unit,
      status: value === meta.fillValue ? "fill_value" : "out_of_bounds",
      quality: "invalid",
      fillValue: value === meta.fillValue,
      valid: false,
    };
  }

  // Quality flag handling (bit 0 = nominal)
  const isNominal = qflag === 0;

  return {
    variable: meta.name,
    value: Number(value.toFixed(4)),
    unit: meta.unit,
    status: isNominal ? "nominal" : "quality_degraded",
    quality: isNominal ? "good" : "degraded",
    qualityFlag: qflag,
    fillValue: false,
    valid: true,
  };
}

/**
 * Evaluates spatial representativeness of the ~9 km SMAP grid for a specific farm field.
 *
 * @param {number} areaHectares - Farm area in hectares
 * @returns {Object} Spatial representativeness metrics and warnings
 */
export function evaluateSmapSpatialRepresentativeness(areaHectares) {
  // 9 km EASE-Grid cell is ~81 km2 = 8,100 hectares
  const smapCellAreaHectares = 8100;
  const ha = Number.isFinite(Number(areaHectares)) && Number(areaHectares) > 0 ? Number(areaHectares) : 5;
  const ratio = (ha / smapCellAreaHectares) * 100;

  const isCoarse = ha < smapCellAreaHectares;
  const warning = isCoarse
    ? `Farm area (${ha} ha) occupies approximately ${ratio < 0.1 ? "<0.1%" : ratio.toFixed(2) + "%"} of a single 9 km SMAP EASE-Grid cell. Measurements reflect regional landscape soil moisture and cannot resolve intra-field or micro-topographic moisture variations.`
    : null;

  return {
    nativeGridResolutionKm: 9.0,
    nativeGridType: "EASE-Grid 2.0 (M09, EPSG:6933)",
    contributingCells: 1,
    fieldFractionOfCellPercent: Number(ratio.toFixed(3)),
    spatialRepresentativeness: ha > 5000 ? "moderate" : "coarse_regional",
    warning,
  };
}

/**
 * Validates and filters an SMAP raw volumetric soil moisture reading.
 *
 * @param {number} rawValue
 * @param {string} variableKey - "sm_surface" or "sm_rootzone"
 * @returns {number|null}
 */
export function filterSmapMoisture(rawValue, variableKey = "sm_surface") {
  if (rawValue == null || !Number.isFinite(rawValue)) return null;
  const meta = SMAP_VARIABLES[variableKey] || SMAP_VARIABLES.sm_surface;
  if (rawValue === meta.fillValue || rawValue < meta.validMin || rawValue > meta.validMax) {
    return null;
  }
  return Number(rawValue.toFixed(4));
}
