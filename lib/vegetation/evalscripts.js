/**
 * Sentinel Hub Version 3 Evalscripts for Field Vegetation Intelligence.
 *
 * Designed for Sentinel-2 MSI Level-2A Surface Reflectance (`sentinel-2-l2a`).
 * Computes pixel-level Normalized Difference Vegetation Index (NDVI) with
 * rigorous Scene Classification Layer (SCL) pixel masking.
 */

/**
 * Builds a Sentinel Hub Statistical API Evalscript (Version 3).
 *
 * @param {Object} [options]
 * @param {boolean} [options.includeWater=false] - Whether to allow SCL=6 (water bodies/flooded fields)
 * @param {boolean} [options.includeCastShadow=false] - Whether to allow SCL=2 (topographic/cast shadows)
 * @returns {string} Version 3 JavaScript evalscript string
 */
export function buildNdviStatisticalEvalscript(options = {}) {
  const includeWater = Boolean(options.includeWater);
  const includeCastShadow = Boolean(options.includeCastShadow);

  return `//VERSION=3
function setup() {
  return {
    input: [{
      bands: ["B04", "B08", "SCL", "dataMask"],
      units: ["REFLECTANCE", "REFLECTANCE", "DN", "DN"]
    }],
    output: [
      {
        id: "ndvi",
        bands: 1,
        sampleType: "FLOAT32"
      },
      {
        id: "dataMask",
        bands: 1
      }
    ]
  };
}

function evaluatePixel(samples) {
  // 1. Boundary & polygon dataMask check
  if (!samples.dataMask) {
    return { ndvi: [0], dataMask: [0] };
  }

  // 2. Scene Classification Layer (SCL) masking
  // SCL Classes:
  // 0 = NO_DATA
  // 1 = SATURATED_OR_DEFECTIVE
  // 2 = DARK_AREA_PIXELS (cast shadow)
  // 3 = CLOUD_SHADOWS
  // 4 = VEGETATION
  // 5 = NOT_VEGETATED (bare soil / fallow)
  // 6 = WATER
  // 7 = UNCLASSIFIED / LOW_PROBABILITY_CLOUD
  // 8 = CLOUD_MEDIUM_PROBABILITY
  // 9 = CLOUD_HIGH_PROBABILITY
  // 10 = THIN_CIRRUS
  // 11 = SNOW_OR_ICE
  var scl = samples.SCL;

  var isCloudOrShadow = (
    scl === 0 ||
    scl === 1 ||
    scl === 3 ||
    scl === 7 ||
    scl === 8 ||
    scl === 9 ||
    scl === 10 ||
    scl === 11
  );

  if (isCloudOrShadow) {
    return { ndvi: [0], dataMask: [0] };
  }

  ${!includeCastShadow ? 'if (scl === 2) { return { ndvi: [0], dataMask: [0] }; }' : ''}
  ${!includeWater ? 'if (scl === 6) { return { ndvi: [0], dataMask: [0] }; }' : ''}

  // 3. Band valid-reflectance validation
  var red = samples.B04;
  var nir = samples.B08;

  if (red == null || nir == null || isNaN(red) || isNaN(nir) || red < 0 || nir < 0) {
    return { ndvi: [0], dataMask: [0] };
  }

  var denom = nir + red;
  // Guard against division by zero or near-zero sensor noise
  if (denom <= 0.00001) {
    return { ndvi: [0], dataMask: [0] };
  }

  var ndviVal = (nir - red) / denom;

  // Strict mathematical range validation [-1, 1]
  if (isNaN(ndviVal) || ndviVal < -1.0 || ndviVal > 1.0) {
    return { ndvi: [0], dataMask: [0] };
  }

  return {
    ndvi: [ndviVal],
    dataMask: [1]
  };
}
`;
}

