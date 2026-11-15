/**
 * Scientific NDVI and Scene Classification Layer (SCL) Utilities.
 *
 * Implements the Normalized Difference Vegetation Index (Rouse et al., 1974)
 * and Copernicus Sentinel-2 SCL categorical definitions.
 */

/**
 * Standard SCL categorical dictionary with scientific classifications and default treatment.
 */
export const SCL_CLASSES = {
  0: { code: 0, label: "No data", description: "Missing or corrupted pixel values", eligible: false },
  1: { code: 1, label: "Saturated or defective", description: "Optical sensor saturation or corrupted pixel", eligible: false },
  2: { code: 2, label: "Dark feature / Cast shadow", description: "Topographic or high cloud cast shadow", eligible: false },
  3: { code: 3, label: "Cloud shadow", description: "Confirmed ground shadow from clouds", eligible: false },
  4: { code: 4, label: "Vegetation", description: "Photosynthetically active green canopy", eligible: true },
  5: { code: 5, label: "Not vegetated / Bare soil", description: "Bare agricultural soil, fallow, or non-vegetated ground", eligible: true },
  6: { code: 6, label: "Water", description: "Open water body, flooded field, or canal", eligible: false }, // Configurable for flooded rice
  7: { code: 7, label: "Unclassified / Low-probability cloud", description: "Ambiguous pixels with low-probability cloud contamination", eligible: false },
  8: { code: 8, label: "Medium-probability cloud", description: "Opaque or semi-transparent cloud cover", eligible: false },
  9: { code: 9, label: "High-probability cloud", description: "Dense opaque cloud cover", eligible: false },
  10: { code: 10, label: "Thin cirrus", description: "High-altitude ice cloud altering reflectance", eligible: false },
  11: { code: 11, label: "Snow or ice", description: "Frozen ground, snowpack or glacier surface", eligible: false },
};

/**
 * Computes the Normalized Difference Vegetation Index (NDVI) for a single pixel or scalar values.
 *
 * Formula:
 *   NDVI = (NIR - RED) / (NIR + RED)
 *   For Sentinel-2: NIR = Band 8 (842 nm), RED = Band 4 (665 nm)
 *
 * @param {number} red - Red surface reflectance (Band 4)
 * @param {number} nir - Near-infrared surface reflectance (Band 8)
 * @returns {number|null} Calculated NDVI in [-1.0, 1.0], or null if invalid/unstable
 */
export function calculatePixelNdvi(red, nir) {
  if (
    red == null ||
    nir == null ||
    !Number.isFinite(red) ||
    !Number.isFinite(nir) ||
    red < 0 ||
    nir < 0
  ) {
    return null;
  }

  const denominator = nir + red;
  // Guard against division by zero and near-zero sensor noise
  if (denominator <= 0.00001) {
    return null;
  }

  const ndvi = (nir - red) / denominator;

  // Verify numerical boundary [-1.0, 1.0]
  if (!Number.isFinite(ndvi) || ndvi < -1.0 || ndvi > 1.0) {
    return null;
  }

  return ndvi;
}

/**
 * Determines whether an SCL pixel is eligible for agricultural vegetation analysis.
 *
 * @param {number} sclCode - The integer SCL classification (0-11)
 * @param {Object} [options]
 * @param {boolean} [options.includeWater=false] - Treat water/flooded paddy as eligible
 * @param {boolean} [options.includeCastShadow=false] - Treat cast shadows as eligible
 * @returns {boolean}
 */
export function isSclEligible(sclCode, options = {}) {
  const code = Number(sclCode);
  if (!Number.isInteger(code) || code < 0 || code > 11) return false;

  if (code === 4 || code === 5) return true;
  if (code === 6 && options.includeWater) return true;
  if (code === 2 && options.includeCastShadow) return true;

  return false;
}

/**
 * Returns human-readable label and scientific description for an SCL code.
 *
 * @param {number} sclCode
 * @returns {{ code: number, label: string, description: string, eligible: boolean }}
 */
export function getSclMetadata(sclCode) {
  return SCL_CLASSES[sclCode] || {
    code: sclCode,
    label: "Unknown class",
    description: "Unrecognized SCL class identifier",
    eligible: false,
  };
}

