/**
 * Scientific Vegetation Time-Series Analysis.
 *
 * Implements linear trend regression, anomaly benchmarking, descriptive
 * condition categorization, and data quality metrics.
 */

/**
 * Calculates the ordinary least-squares linear trend of NDVI over time.
 * Slope is expressed as NDVI change per year.
 *
 * Formula:
 *   slope = Cov(time, NDVI) / Var(time)
 *
 * @param {Array<Object>} observations - List of observation intervals with valid `mean` and `from`
 * @returns {Object} Trend analysis summary
 */
export function calculateLinearTrend(observations) {
  const valid = (observations || []).filter(
    (item) => item.hasValidObservations && typeof item.mean === "number" && Number.isFinite(item.mean) && item.from,
  );

  if (valid.length < 3) {
    return {
      status: "insufficient_data",
      slopePerYear: null,
      rSquared: null,
      observationCount: valid.length,
      note: "At least 3 valid satellite observations are required to calculate a linear trend.",
    };
  }

  // Convert timestamps to decimal years relative to first observation
  const t0 = new Date(valid[0].from).getTime();
  const msPerYear = 365.25 * 86400 * 1000;

  const points = valid.map((item) => {
    const t = (new Date(item.from).getTime() - t0) / msPerYear;
    return { t, y: item.mean };
  });

  const n = points.length;
  const meanT = points.reduce((acc, p) => acc + p.t, 0) / n;
  const meanY = points.reduce((acc, p) => acc + p.y, 0) / n;

  let cov = 0;
  let varT = 0;
  let ssTotal = 0;

  for (const p of points) {
    const dt = p.t - meanT;
    const dy = p.y - meanY;
    cov += dt * dy;
    varT += dt * dt;
    ssTotal += dy * dy;
  }

  if (varT < 1e-9) {
    return {
      status: "zero_variance",
      slopePerYear: 0,
      rSquared: 0,
      observationCount: n,
      note: "Observations occurred at identical timestamps.",
    };
  }

  const slope = cov / varT;
  const intercept = meanY - slope * meanT;

  let ssRes = 0;
  for (const p of points) {
    const yPred = intercept + slope * p.t;
    const res = p.y - yPred;
    ssRes += res * res;
  }

  const rSquared = ssTotal > 1e-9 ? Math.max(0, Math.min(1, 1 - (ssRes / ssTotal))) : 0;
  const lastTime = new Date(valid[valid.length - 1].to || valid[valid.length - 1].from).getTime();
  const timeSpanDays = Math.round((lastTime - t0) / (86400 * 1000));

  return {
    status: "computed",
    slopePerYear: Number(slope.toFixed(4)),
    rSquared: Number(rSquared.toFixed(3)),
    observationCount: n,
    timeSpanDays,
    direction: slope > 0.05 ? "greening" : slope < -0.05 ? "browning" : "stable",
    note: "Linear trend is descriptive of the observed period. It must be interpreted in the context of seasonal planting and harvesting cycles.",
  };
}

/**
 * Calculates NDVI anomaly relative to a baseline period.
 *
 * @param {number} currentMean - Current mean NDVI
 * @param {number} baselineMean - Baseline historical mean NDVI
 * @param {number} baselineStDev - Baseline historical standard deviation
 * @returns {Object} Anomaly indicators
 */
export function calculateNdviAnomaly(currentMean, baselineMean, baselineStDev) {
  if (
    currentMean == null ||
    baselineMean == null ||
    !Number.isFinite(currentMean) ||
    !Number.isFinite(baselineMean)
  ) {
    return {
      status: "unavailable",
      anomaly: null,
      zScore: null,
      note: "Historical climatological baseline unavailable (requires multi-year seasonal reference data).",
    };
  }

  const anomaly = Number((currentMean - baselineMean).toFixed(4));
  let zScore = null;

  if (baselineStDev != null && Number.isFinite(baselineStDev) && baselineStDev > 0.001) {
    zScore = Number((anomaly / baselineStDev).toFixed(2));
  }

  return {
    status: "computed",
    anomaly,
    zScore,
    classification:
      zScore != null
        ? zScore > 1.5
          ? "much_above_average"
          : zScore > 0.5
          ? "above_average"
          : zScore >= -0.5
          ? "near_average"
          : zScore >= -1.5
          ? "below_average"
          : "much_below_average"
        : anomaly > 0.05
        ? "above_average"
        : anomaly < -0.05
        ? "below_average"
        : "near_average",
    note: "Comparison is descriptive of current conditions relative to the provided baseline.",
  };
}

/**
 * Provides a descriptive categorization of mean NDVI values.
 *
 * NOTE: NDVI reflects spectral greenness. It is NOT a universal measure of crop yield
 * or soil moisture and is influenced by soil background and canopy saturation.
 *
 * @param {number|null} ndvi - Mean NDVI value
 * @returns {Object}
 */
export function classifyVegetationCondition(ndvi) {
  if (ndvi == null || !Number.isFinite(ndvi)) {
    return {
      category: "no_data",
      label: "No valid data",
      description: "No cloud-free surface reflectance observation is available for this interval.",
      color: "neutral",
    };
  }

  if (ndvi < 0.1) {
    return {
      category: "water_or_non_vegetated",
      label: "Water / Non-vegetated",
      description: "Low green reflectance characteristic of water, rock, or dense cloud shadow.",
      color: "blue",
    };
  }

  if (ndvi < 0.22) {
    return {
      category: "bare_soil_or_fallow",
      label: "Bare soil / Fallow",
      description: "Spectral signature dominated by soil background, recently tilled field, or stubble residue.",
      color: "amber",
    };
  }

  if (ndvi < 0.42) {
    return {
      category: "sparse_or_emerging",
      label: "Sparse / Emerging vegetation",
      description: "Early crop emergence, dryland pasture, or sparse canopy cover.",
      color: "sage",
    };
  }

  if (ndvi < 0.65) {
    return {
      category: "moderate_canopy",
      label: "Moderate canopy cover",
      description: "Actively growing crop with established leaf area and photosynthetically active biomass.",
      color: "green",
    };
  }

  if (ndvi < 0.82) {
    return {
      category: "dense_vegetation",
      label: "Dense green canopy",
      description: "Peak vegetative development or closed crop canopy with high chlorophyll absorption.",
      color: "forest",
    };
  }

  return {
    category: "very_dense_saturated",
    label: "Very dense canopy (Saturation range)",
    description: "Extremely dense canopy cover. Note: NDVI tends to saturate at high biomass levels.",
    color: "emerald",
  };
}

/**
 * Compiles a comprehensive quality-control report.
 *
 * @param {Array<Object>} timeseries - Normalized interval records
 * @param {Array<Object>} stacScenes - Discovered STAC scene metadata
 * @param {Object} [options] - Evalscript configuration options (includeWater, includeCastShadow)
 * @returns {Object} Quality indicators and warnings
 */
export function compileQualityReport(timeseries = [], stacScenes = [], options = {}) {
  const totalIntervals = timeseries.length;
  const validIntervals = timeseries.filter((item) => item.hasValidObservations).length;
  const maskedIntervals = totalIntervals - validIntervals;
  const warnings = [];

  if (totalIntervals > 0 && validIntervals === 0) {
    warnings.push("All satellite observations in the requested period were masked due to heavy cloud cover, cloud shadows, or no data.");
  } else if (totalIntervals > 0 && (validIntervals / totalIntervals) < 0.4) {
    warnings.push("More than 60% of observation intervals were contaminated by cloud or shadow. Interpret trends with caution.");
  }

  const lowCoverage = timeseries.filter((item) => item.hasValidObservations && item.validCoveragePercent < 50);
  if (lowCoverage.length > 0) {
    warnings.push(`${lowCoverage.length} observation interval(s) had less than 50% valid pixel coverage inside the field polygon.`);
  }

  const sclClassesExcluded = [0, 1];
  if (!options.includeCastShadow) {
    sclClassesExcluded.push(2);
  }
  sclClassesExcluded.push(3);
  if (!options.includeWater) {
    sclClassesExcluded.push(6);
  }
  sclClassesExcluded.push(7, 8, 9, 10, 11);

  return {
    totalIntervals,
    validIntervals,
    maskedIntervals,
    discoveredScenes: stacScenes.length,
    cloudMaskingApplied: true,
    sclClassesExcluded,
    warnings,
  };
}

