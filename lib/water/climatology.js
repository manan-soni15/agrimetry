/**
 * Climatology and Historical Baseline Analysis for Water Stress Intelligence.
 *
 * Implements:
 * 1. Multi-year rainfall anomaly calculations (mm and %).
 * 2. Multi-year soil moisture anomaly, Z-score, and empirical percentile calculations.
 * 3. Historical baseline computation with current-year exclusion.
 *
 * RIGOROUS SCIENTIFIC CONSTRAINTS:
 * - A minimum of 5 valid comparable seasonal years is the Agrimetry operational screening baseline policy.
 *   This is NOT a universal 30-year climatological normal (World Meteorological Organization standard).
 * - Current 30-, 90-, or 365-day observations ALONE cannot serve as a climatological normal.
 * - When baseline criteria are unmet, anomalies and percentiles MUST remain null with an
 *   explicit status of "historical_baseline_unavailable".
 * - When computing historical statistics, the current observation year MUST strictly be
 *   excluded from its own baseline reference distribution.
 */

export const CLIMATOLOGY_CONFIG = {
  minBaselineYears: 5, // Agrimetry minimum operational baseline policy
  wmoStandardYears: 30, // WMO reference climatological standard
  policyNotice:
    "Agrimetry adopts a minimum 5-year operational screening baseline policy when full 30-year WMO normals are unavailable.",
};

/**
 * Computes historical baseline metrics from a multi-year series, explicitly excluding the current year.
 *
 * @param {Object} params
 * @param {Array<Object>} params.multiYearSeries - Array of { year: number, dayOfYear: number, value: number }
 * @param {number} params.currentYear - The observation year to EXCLUDE from baseline
 * @param {number} [params.targetDayOfYear] - Specific day of year (1-366) to match (with leap-year handling)
 * @param {number} [params.dayWindow=3] - Temporal matching window in days (± window)
 * @returns {Object} Baseline summary metrics
 */
export function computeHistoricalBaseline({
  multiYearSeries = [],
  currentYear,
  targetDayOfYear = null,
  dayWindow = 3,
}) {
  if (!Array.isArray(multiYearSeries) || multiYearSeries.length === 0) {
    return {
      status: "insufficient_data",
      baselineYearsCount: 0,
      mean: null,
      stDev: null,
      values: [],
      note: "No historical records provided.",
    };
  }

  // 1. Strictly exclude current observation year from its own historical baseline
  const historicalOnly = multiYearSeries.filter((item) => {
    if (item.year == null || item.value == null || !Number.isFinite(item.value)) return false;
    return item.year !== currentYear;
  });

  // 2. Day-of-year filtering with leap-year handling
  let matchingRecords = historicalOnly;
  if (targetDayOfYear != null && Number.isFinite(targetDayOfYear)) {
    // In leap years, map DOY 366 to 365 for seasonal alignment
    const normalizedTarget = targetDayOfYear === 366 ? 365 : targetDayOfYear;

    matchingRecords = historicalOnly.filter((item) => {
      const itemDoy = item.dayOfYear === 366 ? 365 : item.dayOfYear;
      return Math.abs(itemDoy - normalizedTarget) <= dayWindow;
    });
  }

  // Extract unique years present in matching records
  const uniqueYears = Array.from(new Set(matchingRecords.map((r) => r.year)));
  const baselineYearsCount = uniqueYears.length;

  if (baselineYearsCount < CLIMATOLOGY_CONFIG.minBaselineYears) {
    return {
      status: "historical_baseline_unavailable",
      baselineYearsCount,
      mean: null,
      stDev: null,
      values: [],
      note: `Historical baseline requires a minimum of ${CLIMATOLOGY_CONFIG.minBaselineYears} comparable seasonal years (excluding current observation year ${currentYear}; found ${baselineYearsCount}).`,
    };
  }

  const values = matchingRecords.map((r) => r.value);
  const n = values.length;
  const mean = values.reduce((acc, v) => acc + v, 0) / n;

  // Sample standard deviation: s = sqrt(sum((x - mean)^2) / (n - 1))
  const variance =
    n > 1
      ? values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (n - 1)
      : 0;
  const stDev = Math.sqrt(variance);

  return {
    status: "computed",
    baselineYearsCount,
    mean: Number(mean.toFixed(4)),
    stDev: Number(stDev.toFixed(4)),
    zeroVariance: stDev < 0.0001,
    sampleCount: n,
    values,
    note: `Calculated from ${baselineYearsCount} unique historical years (excluding current observation year ${currentYear}).`,
  };
}

/**
 * Calculates historical rainfall anomaly relative to a multi-year climatological normal.
 *
 * @param {Object} params
 * @param {number} params.currentTotalMm - Current period rainfall accumulation in mm
 * @param {number|null} params.historicalMeanMm - Multi-year historical mean for the same period in mm
 * @param {number} [params.baselineYearsCount=0] - Number of valid historical years available
 * @returns {Object} Anomaly metrics and classification
 */
export function calculateRainfallAnomaly({
  currentTotalMm,
  historicalMeanMm,
  baselineYearsCount = 0,
}) {
  if (currentTotalMm == null || !Number.isFinite(currentTotalMm)) {
    return {
      status: "unavailable",
      anomalyMm: null,
      anomalyPercent: null,
      classification: "insufficient_data",
      baselineYears: baselineYearsCount,
      note: "Current period rainfall accumulation is missing.",
    };
  }

  if (
    historicalMeanMm == null ||
    !Number.isFinite(historicalMeanMm) ||
    baselineYearsCount < CLIMATOLOGY_CONFIG.minBaselineYears
  ) {
    return {
      status: "historical_baseline_unavailable",
      anomalyMm: null,
      anomalyPercent: null,
      classification: "historical_baseline_unavailable",
      baselineYears: baselineYearsCount,
      note: `Historical baseline unavailable. A minimum of ${CLIMATOLOGY_CONFIG.minBaselineYears} comparable seasonal years is required to calculate rainfall anomalies (${baselineYearsCount} provided).`,
    };
  }

  const anomalyMm = Number((currentTotalMm - historicalMeanMm).toFixed(1));
  let anomalyPercent = null;

  if (historicalMeanMm > 0.1) {
    anomalyPercent = Number((((currentTotalMm - historicalMeanMm) / historicalMeanMm) * 100).toFixed(1));
  } else if (currentTotalMm > 0.1) {
    anomalyPercent = 100.0; // From ~0 to positive rainfall
  } else {
    anomalyPercent = 0.0; // Both ~0
  }

  let classification = "near_historical_average";
  if (anomalyPercent != null) {
    if (anomalyPercent < -25.0) {
      classification = "below_historical_average";
    } else if (anomalyPercent > 25.0) {
      classification = "above_historical_average";
    }
  }

  return {
    status: "computed",
    currentTotalMm: Number(currentTotalMm.toFixed(1)),
    historicalMeanMm: Number(historicalMeanMm.toFixed(1)),
    anomalyMm,
    anomalyPercent,
    classification,
    baselineYears: baselineYearsCount,
    note: `Calculated relative to a ${baselineYearsCount}-year historical baseline for the matching seasonal period.`,
  };
}

/**
 * Calculates soil moisture anomaly, Z-score, and empirical percentile against a multi-year baseline.
 *
 * @param {Object} params
 * @param {number} params.currentSm - Current volumetric soil moisture (m³/m³)
 * @param {number|null} params.baselineMean - Multi-year mean soil moisture (m³/m³)
 * @param {number|null} params.baselineStDev - Multi-year standard deviation
 * @param {Array<number>} [params.baselineValues=[]] - Multi-year sample array for empirical percentile
 * @param {number} [params.baselineYearsCount=0]
 * @returns {Object}
 */
export function calculateSoilMoistureAnomaly({
  currentSm,
  baselineMean,
  baselineStDev,
  baselineValues = [],
  baselineYearsCount = 0,
}) {
  if (currentSm == null || !Number.isFinite(currentSm)) {
    return {
      status: "unavailable",
      anomaly: null,
      zScore: null,
      percentile: null,
      classification: "insufficient_data",
      baselineYears: baselineYearsCount,
      note: "Current soil moisture observation is missing.",
    };
  }

  if (
    baselineMean == null ||
    !Number.isFinite(baselineMean) ||
    baselineYearsCount < CLIMATOLOGY_CONFIG.minBaselineYears
  ) {
    return {
      status: "historical_baseline_unavailable",
      anomaly: null,
      zScore: null,
      percentile: null,
      classification: "historical_baseline_unavailable",
      baselineYears: baselineYearsCount,
      note: `Historical baseline unavailable. A minimum of ${CLIMATOLOGY_CONFIG.minBaselineYears} comparable seasonal years is required for soil moisture anomalies (${baselineYearsCount} provided).`,
    };
  }

  const anomaly = Number((currentSm - baselineMean).toFixed(4));
  let zScore = null;

  if (baselineStDev != null && Number.isFinite(baselineStDev) && baselineStDev > 0.001) {
    zScore = Number((anomaly / baselineStDev).toFixed(2));
  } else if (baselineStDev != null && baselineStDev <= 0.001) {
    // Zero-variance guard: do not divide by near-zero standard deviation
    zScore = 0.0;
  }

  let percentile = null;
  if (Array.isArray(baselineValues) && baselineValues.length >= 5) {
    const validBaseline = baselineValues.filter((v) => Number.isFinite(v));
    if (validBaseline.length >= 5) {
      const countLte = validBaseline.filter((v) => v <= currentSm).length;
      percentile = Number(((countLte / validBaseline.length) * 100).toFixed(1));
    }
  }

  let classification = "near_historical_average";
  if (zScore != null) {
    if (zScore < -1.5 || (percentile != null && percentile < 10)) {
      classification = "severely_below_average";
    } else if (zScore < -0.5 || (percentile != null && percentile < 30)) {
      classification = "below_historical_average";
    } else if (zScore > 1.5 || (percentile != null && percentile > 90)) {
      classification = "severely_above_average";
    } else if (zScore > 0.5 || (percentile != null && percentile > 70)) {
      classification = "above_historical_average";
    }
  } else if (anomaly < -0.05) {
    classification = "below_historical_average";
  } else if (anomaly > 0.05) {
    classification = "above_historical_average";
  }

  return {
    status: "computed",
    currentSm: Number(currentSm.toFixed(4)),
    baselineMean: Number(baselineMean.toFixed(4)),
    anomaly,
    zScore,
    percentile,
    classification,
    baselineYears: baselineYearsCount,
    note: `Comparison is descriptive relative to the ${baselineYearsCount}-year seasonal reference archive.`,
  };
}
