import test from "node:test";
import assert from "node:assert/strict";

import {
  calculatePenmanMonteith,
  calculateHargreavesSamani,
  convertWindTo2m,
  saturationVapourPressure,
  meanSaturationVapourPressure,
  actualVapourPressure,
  vapourPressureDeficit,
  slopeVapourPressureCurve,
  psychrometricConstant,
  extraterrestrialRadiation,
  computeDailyEt0,
} from "../lib/water/et0.js";

import {
  IMERG_CONFIG,
  latLonToImergGrid,
  decodeImergHdf5GridPoint,
  convertRateToHalfHourRainfall,
  aggregateDailyImergRainfall,
  calculateAccumulatedRainfall,
} from "../lib/water/imerg-client.js";

import {
  SMAP_VARIABLES,
  EASE2_GRID_CONFIG,
  latLonToEase2Grid,
  decodeSmapHdf5GridPoint,
  evaluateSmapSpatialRepresentativeness,
  filterSmapMoisture,
} from "../lib/water/smap-client.js";

import {
  CLIMATOLOGY_CONFIG,
  computeHistoricalBaseline,
  calculateRainfallAnomaly,
  calculateSoilMoistureAnomaly,
} from "../lib/water/climatology.js";

import {
  calculateClimaticWaterBalance,
  classifyWaterStressEvidence,
} from "../lib/water/water-analysis.js";

import {
  validateGeometry,
  validateDateRange,
  createBoxPolygonFromPoint,
} from "../lib/water/validation.js";

import { normalizeWaterResponse } from "../lib/water/normalize-response.js";

// =========================================================================
// 1. SMAP L4 HDF5 METADATA & SCIENTIFIC DISTINCTIONS
// =========================================================================
test("1. SMAP HDF5 Metadata & Root-Zone Model Nature", () => {
  assert.equal(SMAP_VARIABLES.sm_surface.unit, "m³/m³");
  assert.equal(SMAP_VARIABLES.sm_surface.hdfPath, "Geophysical_Data/sm_surface");
  assert.equal(SMAP_VARIABLES.sm_surface.fillValue, -9999.0);

  // Surface vs root-zone distinct layer depths
  assert.ok(SMAP_VARIABLES.sm_surface.layer.includes("0–5 cm"));
  assert.ok(SMAP_VARIABLES.sm_rootzone.layer.includes("0–100 cm"));

  // Critical scientific requirement: Root zone is model-assimilated estimate
  assert.ok(SMAP_VARIABLES.sm_rootzone.nature.includes("Model-assimilated estimate"));
  assert.ok(SMAP_VARIABLES.sm_rootzone.nature.includes("NOT a direct satellite measurement"));
});

// =========================================================================
// 2. SMAP EASE-GRID 2.0 COORDINATE CONVERSION & INDEXING
// =========================================================================
test("2. SMAP EASE-Grid 2.0 Coordinate Projection (EPSG:6933, M09)", () => {
  // Center of grid: Equator and Prime Meridian (0, 0)
  const center = latLonToEase2Grid(0, 0);
  assert.equal(center.inBounds, true);
  assert.equal(center.x, 0);
  assert.equal(center.y, 0);
  // Center column is 3856 / 2 = 1928, center row is 1624 / 2 = 812
  assert.equal(center.col, 1928);
  assert.equal(center.row, 812);

  // Jaipur farm site (26.9124° N, 75.7873° E)
  const jaipur = latLonToEase2Grid(26.9124, 75.7873);
  assert.equal(jaipur.inBounds, true);
  assert.ok(jaipur.col > 1928 && jaipur.col < 3856);
  assert.ok(jaipur.row < 812 && jaipur.row > 0);

  // Invalid coordinates: out of range, non-finite, null
  assert.equal(latLonToEase2Grid(95.0, 0).inBounds, false);
  assert.equal(latLonToEase2Grid(0, -190.0).inBounds, false);
  assert.equal(latLonToEase2Grid(null, 75.0).inBounds, false);
  assert.equal(latLonToEase2Grid(NaN, 75.0).inBounds, false);
});

// =========================================================================
// 3. SMAP HDF5 GRID POINT DECODER & QUALITY FLAGS
// =========================================================================
test("3. SMAP HDF5 Grid Point Decoder & Fill Value Filtering", () => {
  // Valid nominal surface reading
  const nominal = decodeSmapHdf5GridPoint({
    variableKey: "sm_surface",
    value: 0.2458,
    qflag: 0,
  });
  assert.equal(nominal.valid, true);
  assert.equal(nominal.value, 0.2458);
  assert.equal(nominal.status, "nominal");
  assert.equal(nominal.quality, "good");

  // Degraded quality flag (non-zero)
  const degraded = decodeSmapHdf5GridPoint({
    variableKey: "sm_rootzone",
    value: 0.3125,
    qflag: 1,
  });
  assert.equal(degraded.valid, true);
  assert.equal(degraded.status, "quality_degraded");
  assert.equal(degraded.quality, "degraded");

  // Fill value (-9999.0)
  const fill = decodeSmapHdf5GridPoint({
    variableKey: "sm_surface",
    value: -9999.0,
  });
  assert.equal(fill.valid, false);
  assert.equal(fill.value, null);
  assert.equal(fill.fillValue, true);
  assert.equal(fill.status, "fill_value");

  // Out of physical bounds (< 0.0 or > 0.90 m3/m3)
  const negative = decodeSmapHdf5GridPoint({
    variableKey: "sm_surface",
    value: -0.05,
  });
  assert.equal(negative.valid, false);
  assert.equal(negative.status, "out_of_bounds");

  const supersat = decodeSmapHdf5GridPoint({
    variableKey: "sm_surface",
    value: 1.15,
  });
  assert.equal(supersat.valid, false);
  assert.equal(supersat.status, "out_of_bounds");

  // Missing / NaN
  const missing = decodeSmapHdf5GridPoint({
    variableKey: "sm_surface",
    value: null,
  });
  assert.equal(missing.valid, false);
  assert.equal(missing.status, "missing");
});

// =========================================================================
// 4. SPATIAL REPRESENTATIVENESS & SCALE TRANSPARENCY
// =========================================================================
test("4. SMAP Spatial Representativeness & Scale Warning", () => {
  // A 5 ha field in a 9 km (8,100 ha) SMAP cell occupies ~0.06% of the cell
  const repSmall = evaluateSmapSpatialRepresentativeness(5);
  assert.equal(repSmall.contributingCells, 1);
  assert.equal(repSmall.spatialRepresentativeness, "coarse_regional");
  assert.ok(repSmall.warning !== null);
  assert.ok(repSmall.warning.includes("occupies approximately"));
  assert.ok(repSmall.warning.includes("reflect regional landscape soil moisture"));

  // A large regional watershed (6,000 ha)
  const repLarge = evaluateSmapSpatialRepresentativeness(6000);
  assert.equal(repLarge.spatialRepresentativeness, "moderate");
});

// =========================================================================
// 5. GPM IMERG 0.1° GRID PROJECTION & HDF5 DATASET ARCHITECTURE
// =========================================================================
test("5. GPM IMERG Grid Projection & HDF5 Dataset Paths", () => {
  assert.equal(IMERG_CONFIG.datasets.earlyPrecipitation, "Grid/precipitation");
  assert.equal(IMERG_CONFIG.datasets.finalPrecipitation, "Grid/precipitationCal");
  assert.equal(IMERG_CONFIG.fillValue, -9999.9);

  // Coordinate mapping to 0.1° grid
  const origin = latLonToImergGrid(-90.0, -180.0);
  assert.equal(origin.inBounds, true);
  assert.equal(origin.col, 0);
  assert.equal(origin.row, 0);

  const equatorPrime = latLonToImergGrid(0.0, 0.0);
  assert.equal(equatorPrime.inBounds, true);
  assert.equal(equatorPrime.col, 1800);
  assert.equal(equatorPrime.row, 900);

  // Out of bounds
  assert.equal(latLonToImergGrid(95.0, 0).inBounds, false);
  assert.equal(latLonToImergGrid(0, -195.0).inBounds, false);
});

// =========================================================================
// 6. GPM IMERG GRID POINT DECODER & 30-MIN CONVERSION
// =========================================================================
test("6. GPM IMERG Grid Point Decoder & Rate Conversion", () => {
  // Valid 10 mm/hr rate -> 5.0 mm half-hour accumulation
  const decoded = decodeImergHdf5GridPoint({ rateMmPerHour: 10.0, qualityIndex: 0.95 });
  assert.equal(decoded.valid, true);
  assert.equal(decoded.precipitationMmPerHr, 10.0);
  assert.equal(decoded.halfHourRainfallMm, 5.0);

  // Fill value (-9999.9)
  const fill = decodeImergHdf5GridPoint({ rateMmPerHour: -9999.9 });
  assert.equal(fill.valid, false);
  assert.equal(fill.status, "fill_value");
  assert.equal(fill.halfHourRainfallMm, null);

  // Extreme meteorological outlier (> 500 mm/hr)
  const outlier = decodeImergHdf5GridPoint({ rateMmPerHour: 800.0 });
  assert.equal(outlier.valid, false);
  assert.equal(outlier.status, "extreme_meteorological_outlier");

  // Missing
  const missing = decodeImergHdf5GridPoint({ rateMmPerHour: null });
  assert.equal(missing.valid, false);
  assert.equal(missing.status, "missing");
});

// =========================================================================
// 7. DAILY IMERG RAINFALL AGGREGATION & COMPLETENESS TRACKING
// =========================================================================
test("7. Daily IMERG Rainfall Accumulation & Missing Interval Accounting", () => {
  // 48 valid intervals of 0.5 mm = 24.0 mm daily accumulation
  const fullDay = Array(48).fill(0.5);
  const resultFull = aggregateDailyImergRainfall(fullDay);
  assert.equal(resultFull.status, "complete");
  assert.equal(resultFull.dailyTotalMm, 24.0);
  assert.equal(resultFull.validIntervalCount, 48);
  assert.equal(resultFull.missingIntervalCount, 0);

  // Incomplete day: 30 valid intervals (0.5 mm), 18 missing (null) -> 62.5% coverage (< 80%)
  const incompleteDay = [...Array(30).fill(0.5), ...Array(18).fill(null)];
  const resultIncomplete = aggregateDailyImergRainfall(incompleteDay);
  assert.equal(resultIncomplete.status, "incomplete");
  assert.equal(resultIncomplete.dailyTotalMm, 15.0);
  assert.equal(resultIncomplete.validIntervalCount, 30);
  assert.equal(resultIncomplete.missingIntervalCount, 18);
  assert.ok(resultIncomplete.qualityWarning.includes("Incomplete daily coverage"));

  // Completely missing day
  const emptyDay = Array(48).fill(null);
  const resultEmpty = aggregateDailyImergRainfall(emptyDay);
  assert.equal(resultEmpty.status, "missing");
  assert.equal(resultEmpty.dailyTotalMm, null);
  assert.equal(resultEmpty.validIntervalCount, 0);
});

// =========================================================================
// 8. MULTI-DAY RAINFALL ACCUMULATION
// =========================================================================
test("8. Multi-Day Rainfall Accumulation", () => {
  const dailyRecords = [
    { date: "2024-05-01", precipitation: 10.5 },
    { date: "2024-05-02", precipitation: 0.0 },
    { date: "2024-05-03", precipitation: 5.2 },
    { date: "2024-05-04", precipitation: null },
    { date: "2024-05-05", precipitation: 8.3 },
  ];

  const acc = calculateAccumulatedRainfall(dailyRecords, 5);
  assert.equal(acc.totalMm, 24.0);
  assert.equal(acc.validDays, 4);
  assert.equal(acc.isComplete, false); // 4 of 5 valid
});

// =========================================================================
// 9. HISTORICAL BASELINE COMPUTATION & CURRENT-YEAR EXCLUSION
// =========================================================================
test("9. Historical Baseline: Current-Year Exclusion & Leap-Year Handling", () => {
  // Test dataset with 6 historical years (2018-2023) and current observation year (2024)
  const currentObsYear = 2024;
  const series = [
    { year: 2018, dayOfYear: 196, value: 0.22 },
    { year: 2019, dayOfYear: 196, value: 0.24 },
    { year: 2020, dayOfYear: 196, value: 0.26 }, // leap year
    { year: 2021, dayOfYear: 196, value: 0.25 },
    { year: 2022, dayOfYear: 196, value: 0.23 },
    { year: 2023, dayOfYear: 196, value: 0.28 },
    { year: 2024, dayOfYear: 196, value: 0.12 }, // CURRENT OBSERVATION - MUST BE EXCLUDED!
  ];

  const baseline = computeHistoricalBaseline({
    multiYearSeries: series,
    currentYear: currentObsYear,
    targetDayOfYear: 196,
  });

  assert.equal(baseline.status, "computed");
  assert.equal(baseline.baselineYearsCount, 6);
  // Verify 2024 (value 0.12) was NOT included in values
  assert.ok(!baseline.values.includes(0.12));
  // Mean of [0.22, 0.24, 0.26, 0.25, 0.23, 0.28] = 1.48 / 6 = 0.2467
  assert.equal(baseline.mean, 0.2467);
  assert.equal(baseline.zeroVariance, false);

  // Insufficient historical years (< 5 years)
  const shortSeries = [
    { year: 2022, dayOfYear: 196, value: 0.25 },
    { year: 2023, dayOfYear: 196, value: 0.24 },
    { year: 2024, dayOfYear: 196, value: 0.15 },
  ];
  const unavail = computeHistoricalBaseline({
    multiYearSeries: shortSeries,
    currentYear: 2024,
    targetDayOfYear: 196,
  });
  assert.equal(unavail.status, "historical_baseline_unavailable");
  assert.equal(unavail.mean, null);

  // Zero-variance historical baseline (e.g. constant hyper-arid values)
  const constantSeries = [
    { year: 2018, dayOfYear: 100, value: 0.05 },
    { year: 2019, dayOfYear: 100, value: 0.05 },
    { year: 2020, dayOfYear: 100, value: 0.05 },
    { year: 2021, dayOfYear: 100, value: 0.05 },
    { year: 2022, dayOfYear: 100, value: 0.05 },
  ];
  const zeroVar = computeHistoricalBaseline({
    multiYearSeries: constantSeries,
    currentYear: 2024,
    targetDayOfYear: 100,
  });
  assert.equal(zeroVar.status, "computed");
  assert.equal(zeroVar.zeroVariance, true);
  assert.equal(zeroVar.stDev, 0);
});

// =========================================================================
// 10. CLIMATOLOGY ANOMALIES & DIVISION BY ZERO GUARDS
// =========================================================================
test("10. Climatological Anomalies & Zero Guards", () => {
  // Rainfall anomaly with zero baseline
  const zeroRainBase = calculateRainfallAnomaly({
    currentTotalMm: 15.0,
    historicalMeanMm: 0.0,
    baselineYearsCount: 8,
  });
  assert.equal(zeroRainBase.status, "computed");
  assert.equal(zeroRainBase.anomalyMm, 15.0);
  assert.equal(zeroRainBase.anomalyPercent, 100.0);

  // Soil moisture anomaly with zero-variance standard deviation guard
  const zeroVarSm = calculateSoilMoistureAnomaly({
    currentSm: 0.18,
    baselineMean: 0.20,
    baselineStDev: 0.0, // Zero variance
    baselineYearsCount: 7,
  });
  assert.equal(zeroVarSm.status, "computed");
  assert.equal(zeroVarSm.anomaly, -0.02);
  assert.equal(zeroVarSm.zScore, 0.0); // Guarded against Infinity / NaN
});

// =========================================================================
// 11. FAO-56 BENCHMARK 1 (EXAMPLE 18 — SUBTROPICAL SITE)
// =========================================================================
test("11. FAO-56 Penman-Monteith Benchmark 1 (Example 18)", () => {
  // FAO-56 Example 18:
  // Location: 16.22° N, Day: 274 (1 October), Elevation: 2 m
  // Tmax = 24.5 °C, Tmin = 15.0 °C, Tmean = 19.75 °C, RHmean = 67%
  // u2 = 2.07 m/s, Rs = 18.0 MJ/m2/day
  const et0 = calculatePenmanMonteith({
    tMean: 19.75,
    tMax: 24.5,
    tMin: 15.0,
    rhMean: 67,
    solarRadiation: 18.0,
    windSpeed2m: 2.07,
    latitude: 16.22,
    dayOfYear: 274,
    pressureKpa: 101.3,
    elevationMeters: 2,
  });

  assert.ok(et0 !== null);
  // Expected FAO-56 reference result is ~3.8 - 4.0 mm/day
  assert.ok(et0 >= 3.6 && et0 <= 4.2, `Expected ET0 between 3.6 and 4.2, got ${et0}`);
});

// =========================================================================
// 12. FAO-56 BENCHMARK 2 (EXAMPLE 19 — ARID HIGH-WIND SITE)
// =========================================================================
test("12. FAO-56 Penman-Monteith Benchmark 2 (Example 19 — Arid High-Wind)", () => {
  // FAO-56 Example 19:
  // Grand Junction, Colorado (39.1° N, Elevation: 1475 m, P ~ 84.8 kPa)
  // Day: 196 (15 July), Tmax = 34.4 °C, Tmin = 18.9 °C, Tmean = 26.65 °C
  // RHmean = 28%, u2 = 3.6 m/s (high wind), Rs = 28.5 MJ/m2/day
  const et0 = calculatePenmanMonteith({
    tMean: 26.65,
    tMax: 34.4,
    tMin: 18.9,
    rhMean: 28,
    solarRadiation: 28.5,
    windSpeed2m: 3.6,
    latitude: 39.1,
    dayOfYear: 196,
    pressureKpa: 84.8,
    elevationMeters: 1475,
  });

  assert.ok(et0 !== null);
  // FAO-56 benchmark Table 18 gives ET0 ~ 8.9 mm/day
  assert.ok(et0 >= 8.7 && et0 <= 9.2, `Expected ET0 between 8.7 and 9.2, got ${et0}`);
});

// =========================================================================
// 13. FAO-56 COMPONENT EQUATIONS: VPD, WIND HEIGHT & PSYCHROMETRIC CONSTANT
// =========================================================================
test("13. FAO-56 Component Equations: VPD, Wind Height & Psychrometric Constant", () => {
  // Vapour pressure deficit (es - ea)
  const es = 3.60;
  const ea = 1.87;
  const vpd = vapourPressureDeficit(es, ea);
  assert.equal(vpd, 1.73);

  // Psychrometric constant at sea level (101.3 kPa) and high elevation (84.8 kPa)
  assert.equal(Number(psychrometricConstant(101.3).toFixed(5)), 0.06736);
  assert.equal(Number(psychrometricConstant(84.8).toFixed(5)), 0.05639);

  // Wind speed conversion from 10m to 2m (FAO-56 Eq. 47)
  const u2 = convertWindTo2m(4.0, 10);
  assert.ok(u2 > 2.9 && u2 < 3.1);
});

// =========================================================================
// 14. HARGREAVES-SAMANI FALLBACK & QUALITY STATUS
// =========================================================================
test("14. Hargreaves-Samani Fallback & Metadata Tracking", () => {
  // When humidity is missing, Penman-Monteith returns null
  const pmMissing = calculatePenmanMonteith({
    tMean: 22.0,
    tMax: 28.0,
    tMin: 16.0,
    rhMean: null,
    solarRadiation: 20.0,
    windSpeed2m: 2.0,
    latitude: 26.9,
    dayOfYear: 150,
  });
  assert.equal(pmMissing, null);

  // computeDailyEt0 automated fallback routing with qualityStatus tracking
  const dayWithoutHumidity = {
    date: "2024-05-15",
    temperature: 22.0,
    maximumTemperature: 28.0,
    minimumTemperature: 16.0,
    humidity: null,
    solarRadiation: null,
    windSpeed: null,
  };
  const res = computeDailyEt0(dayWithoutHumidity, 26.9);
  assert.equal(res.method, "Estimated ET0 — Hargreaves–Samani");
  assert.equal(res.isFallback, true);
  assert.equal(res.qualityStatus, "estimated_fallback");
  assert.ok(res.reason !== null);
  assert.ok(res.et0 > 0);
});

// =========================================================================
// 15. CLIMATIC WATER BALANCE (P - ET0)
// =========================================================================
test("15. Climatic Water Balance (P - ET0)", () => {
  const dailyRecords = [
    { date: "2024-05-01", precipitation: 2.0, et0: 5.5 }, // CWB = -3.5
    { date: "2024-05-02", precipitation: 12.0, et0: 4.0 }, // CWB = +8.0
    { date: "2024-05-03", precipitation: 0.0, et0: 6.0 }, // CWB = -6.0
  ];

  const cwb = calculateClimaticWaterBalance(dailyRecords);
  assert.equal(cwb.status, "computed");
  assert.equal(cwb.dailySeries.length, 3);
  assert.equal(cwb.dailySeries[0].cwbMm, -3.5);
  assert.equal(cwb.dailySeries[1].cwbMm, 8.0);
  assert.equal(cwb.dailySeries[2].cwbMm, -6.0);
  assert.equal(cwb.cumulative7dMm, -1.5);
  assert.ok(cwb.note.includes("atmospheric demand exceeded precipitation"));
});

// =========================================================================
// 16. EXPLAINABLE WATER-STRESS EVIDENCE SYNTHESIS & LABELS
// =========================================================================
test("16. Explainable Water-Stress Evidence & Canonical Labels", () => {
  // Scenario A: Severe Water Stress
  const severe = classifyWaterStressEvidence({
    soilMoisture: {
      rootZone: { latest: 0.09, percentile: 5, zScore: -2.2 },
      surface: { latest: 0.06 },
    },
    rainfall: { recentAccumulation30dMm: 4.0, anomalyPercent: -65.0 },
    climaticWaterBalance: { cumulative30dMm: -95.0 },
    quality: { spatialRepresentativeness: "moderate" },
  });
  assert.equal(severe.category, "severe_stress");
  assert.equal(severe.label, "Severe water-stress evidence");
  assert.equal(severe.severityLevel, 4);

  // Scenario B: Conflicting / Mixed Evidence (dry spell with buffered root zone)
  const mixed = classifyWaterStressEvidence({
    soilMoisture: {
      rootZone: { latest: 0.24, percentile: 45, zScore: 0.1 },
      surface: { latest: 0.08 },
    },
    rainfall: { recentAccumulation30dMm: 8.0, anomalyPercent: -45.0 },
    climaticWaterBalance: { cumulative30dMm: -45.0 },
    quality: { spatialRepresentativeness: "coarse_regional" },
  });
  assert.equal(mixed.category, "watch");
  assert.ok(mixed.label.includes("Mixed Evidence"));
  assert.ok(mixed.warnings.some((w) => w.includes("root-zone moisture remains buffered")));

  // Scenario C: No Clear Regional Water-Stress Signal (favorable moisture & rain)
  const favorable = classifyWaterStressEvidence({
    soilMoisture: {
      rootZone: { latest: 0.32, percentile: 75, zScore: 0.8 },
      surface: { latest: 0.24 },
    },
    rainfall: { recentAccumulation30dMm: 95.0, anomalyPercent: 25.0 },
    climaticWaterBalance: { cumulative30dMm: 15.0 },
    quality: { spatialRepresentativeness: "moderate" },
  });
  assert.equal(favorable.category, "no_stress");
  assert.equal(favorable.label, "No clear regional water-stress signal");

  // Scenario D: Insufficient Data
  const empty = classifyWaterStressEvidence({});
  assert.equal(empty.category, "insufficient_data");
  assert.equal(empty.label, "Insufficient data");
  assert.equal(empty.severityLevel, 0);
});

// =========================================================================
// 17. GEOMETRY & DATE RANGE INPUT VALIDATION
// =========================================================================
test("17. Geometry & Date Range Validation", () => {
  const box = createBoxPolygonFromPoint(26.9124, 75.7873, 5);
  assert.equal(validateGeometry(box).valid, true);

  // Unclosed polygon
  const unclosed = {
    type: "Polygon",
    coordinates: [
      [
        [75.0, 26.0],
        [76.0, 26.0],
        [76.0, 27.0],
        [75.0, 27.0], // missing closing vertex [75.0, 26.0]
      ],
    ],
  };
  assert.equal(validateGeometry(unclosed).valid, false);

  // Date range validation
  const validDates = validateDateRange("2024-01-01", "2024-03-01", 365);
  assert.equal(validDates.valid, true);
  assert.equal(validateDateRange("2024-05-01", "2024-01-01").valid, false);
});

// =========================================================================
// 18. RESPONSE NORMALIZATION & 5-TIER PIPELINE VERIFICATION
// =========================================================================
test("18. Normalized Response Schema & 5-Tier Verification Reporting", () => {
  const normalized = normalizeWaterResponse({
    fieldId: "field-101",
    fieldName: "South Field",
    areaHectares: 6.5,
    geometry: createBoxPolygonFromPoint(26.9, 75.8, 6.5),
    from: "2024-05-01",
    to: "2024-05-31",
    timeStandard: "UTC",
    smapGranules: [{ id: "G_SMAP_1" }],
    imergGranules: [{ id: "G_IMERG_1" }],
    powerRecords: [
      { date: "2024-05-01", precipitation: 5.0 },
      { date: "2024-05-02", precipitation: 0.0 },
    ],
    et0Records: [
      { date: "2024-05-01", et0: 4.5, method: "FAO-56 Penman-Monteith", isFallback: false },
      { date: "2024-05-02", et0: 4.8, method: "FAO-56 Penman-Monteith", isFallback: false },
    ],
    et0Method: "FAO-56 Penman-Monteith",
    authStatus: "credentials_required",
  });

  assert.equal(normalized.feature, "soil-moisture-water-stress");
  assert.equal(normalized.field.name, "South Field");

  // Verify 5-tier pipeline reporting
  const p = normalized.pipelineStatus;
  assert.ok(p !== undefined);
  assert.equal(p.tier1_metadataDiscovery.status, "succeeded");
  assert.equal(p.tier2_satelliteDataDownload.status, "credentials_required");
  assert.equal(p.tier3_valuesDecoded.status, "pending_auth");
  assert.equal(p.tier4_spatialExtraction.smapGrid, "EASE-Grid 2.0 (M09, 9 km)");
  assert.equal(p.tier5_derivedAnalysis.status, "succeeded");

  // Verify scientific limitations are transparently included
  assert.ok(normalized.scientificNotes.length >= 4);
});
