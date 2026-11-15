import test from "node:test";
import assert from "node:assert/strict";

import { calculatePixelNdvi, isSclEligible, getSclMetadata } from "../lib/vegetation/ndvi.js";
import {
  calculateLinearTrend,
  calculateNdviAnomaly,
  classifyVegetationCondition,
  compileQualityReport,
} from "../lib/vegetation/vegetation-analysis.js";
import {
  validateGeometry,
  createBoxPolygonFromPoint,
  validateDateRange,
} from "../lib/vegetation/validation.js";
import { normalizeVegetationResponse } from "../lib/vegetation/normalize-response.js";
import { buildNdviStatisticalEvalscript } from "../lib/vegetation/evalscripts.js";

test("NDVI Formula & Bounds", () => {
  // Typical healthy vegetation: B04=0.05, B08=0.45 -> NDVI = 0.4 / 0.5 = 0.8
  const vegNdvi = calculatePixelNdvi(0.05, 0.45);
  assert.ok(vegNdvi !== null);
  assert.equal(vegNdvi.toFixed(4), "0.8000");

  // Bare soil: B04=0.20, B08=0.25 -> NDVI = 0.05 / 0.45 ≈ 0.1111
  const soilNdvi = calculatePixelNdvi(0.20, 0.25);
  assert.ok(soilNdvi !== null);
  assert.equal(soilNdvi.toFixed(4), "0.1111");

  // Water: B04=0.08, B08=0.02 -> NDVI = -0.06 / 0.10 = -0.6
  const waterNdvi = calculatePixelNdvi(0.08, 0.02);
  assert.ok(waterNdvi !== null);
  assert.equal(waterNdvi.toFixed(4), "-0.6000");

  // Edge cases: division by zero
  assert.equal(calculatePixelNdvi(0, 0), null);

  // Negative reflectance (sensor error)
  assert.equal(calculatePixelNdvi(-0.02, 0.4), null);

  // Non-finite values
  assert.equal(calculatePixelNdvi(NaN, 0.4), null);
  assert.equal(calculatePixelNdvi(0.1, Infinity), null);
});

test("Scene Classification Layer (SCL) Masking Rules", () => {
  // Vegetation (4) and Bare Soil (5) must be eligible
  assert.equal(isSclEligible(4), true);
  assert.equal(isSclEligible(5), true);

  // Clouds, shadows, cirrus, snow, defective must be excluded
  assert.equal(isSclEligible(0), false); // No data
  assert.equal(isSclEligible(1), false); // Saturated
  assert.equal(isSclEligible(3), false); // Cloud shadow
  assert.equal(isSclEligible(7), false); // Low-prob cloud
  assert.equal(isSclEligible(8), false); // Med-prob cloud
  assert.equal(isSclEligible(9), false); // High-prob cloud
  assert.equal(isSclEligible(10), false); // Thin cirrus
  assert.equal(isSclEligible(11), false); // Snow/ice

  // Water (6) is excluded by default, configurable
  assert.equal(isSclEligible(6), false);
  assert.equal(isSclEligible(6, { includeWater: true }), true);

  // Cast shadow (2) is excluded by default, configurable
  assert.equal(isSclEligible(2), false);
  assert.equal(isSclEligible(2, { includeCastShadow: true }), true);

  // Metadata retrieval
  const meta = getSclMetadata(4);
  assert.equal(meta.label, "Vegetation");
  assert.equal(meta.eligible, true);
});

test("Linear Trend Regression", () => {
  // Insufficient data (< 3 observations)
  const insufficient = calculateLinearTrend([
    { from: "2024-01-01", hasValidObservations: true, mean: 0.3 },
    { from: "2024-01-10", hasValidObservations: true, mean: 0.4 },
  ]);
  assert.equal(insufficient.status, "insufficient_data");

  // Steady greening trend: 0.30 -> 0.40 -> 0.50 -> 0.60
  const series = [
    { from: "2024-01-01", hasValidObservations: true, mean: 0.30 },
    { from: "2024-04-01", hasValidObservations: true, mean: 0.40 },
    { from: "2024-07-01", hasValidObservations: true, mean: 0.50 },
    { from: "2024-10-01", hasValidObservations: true, mean: 0.60 },
  ];
  const trend = calculateLinearTrend(series);
  assert.equal(trend.status, "computed");
  assert.ok(trend.slopePerYear > 0.35 && trend.slopePerYear < 0.45);
  assert.equal(trend.direction, "greening");
  assert.ok(trend.rSquared > 0.95);
});

test("NDVI Anomaly & Z-Score", () => {
  // Current 0.65, Baseline 0.50, StDev 0.10 -> Anomaly = +0.15, Z = 1.50
  const anomaly = calculateNdviAnomaly(0.65, 0.50, 0.10);
  assert.equal(anomaly.status, "computed");
  assert.equal(anomaly.anomaly, 0.15);
  assert.equal(anomaly.zScore, 1.5);
  assert.equal(anomaly.classification, "above_average");

  // Zero standard deviation guard
  const zeroStDev = calculateNdviAnomaly(0.55, 0.50, 0);
  assert.equal(zeroStDev.status, "computed");
  assert.equal(zeroStDev.zScore, null);
});

test("Descriptive Vegetation Condition Categorization", () => {
  assert.equal(classifyVegetationCondition(null).category, "no_data");
  assert.equal(classifyVegetationCondition(0.05).category, "water_or_non_vegetated");
  assert.equal(classifyVegetationCondition(0.18).category, "bare_soil_or_fallow");
  assert.equal(classifyVegetationCondition(0.35).category, "sparse_or_emerging");
  assert.equal(classifyVegetationCondition(0.55).category, "moderate_canopy");
  assert.equal(classifyVegetationCondition(0.72).category, "dense_vegetation");
  assert.equal(classifyVegetationCondition(0.85).category, "very_dense_saturated");
});

test("Geometry Validation", () => {
  // Valid closed polygon
  const validPoly = {
    type: "Polygon",
    coordinates: [[
      [75.78, 26.91],
      [75.80, 26.91],
      [75.80, 26.93],
      [75.78, 26.93],
      [75.78, 26.91],
    ]],
  };
  const res1 = validateGeometry(validPoly);
  assert.equal(res1.valid, true);

  // Unclosed ring
  const unclosed = {
    type: "Polygon",
    coordinates: [[
      [75.78, 26.91],
      [75.80, 26.91],
      [75.80, 26.93],
      [75.78, 26.92], // does not match start
    ]],
  };
  assert.equal(validateGeometry(unclosed).valid, false);

  // Out of bounds coordinate (latitude 95)
  const outOfBounds = {
    type: "Polygon",
    coordinates: [[
      [75.78, 95.0],
      [75.80, 95.0],
      [75.80, 95.1],
      [75.78, 95.1],
      [75.78, 95.0],
    ]],
  };
  assert.equal(validateGeometry(outOfBounds).valid, false);

  // createBoxPolygonFromPoint
  const box = createBoxPolygonFromPoint(26.91, 75.78, 5);
  assert.equal(box.type, "Polygon");
  assert.equal(validateGeometry(box).valid, true);
});

test("Date Range Validation", () => {
  // Valid 90 day window
  const v1 = validateDateRange("2024-01-01", "2024-03-31");
  assert.equal(v1.valid, true);

  // Start after end
  const v2 = validateDateRange("2024-05-01", "2024-01-01");
  assert.equal(v2.valid, false);

  // Exceeds max days (400 days with maxDays=366)
  const v3 = validateDateRange("2023-01-01", "2024-03-01", 366);
  assert.equal(v3.valid, false);
});

test("Evalscript Generation", () => {
  const evalscript = buildNdviStatisticalEvalscript({ includeWater: false });
  assert.ok(evalscript.includes("//VERSION=3"));
  assert.ok(evalscript.includes('bands: ["B04", "B08", "SCL", "dataMask"]'));
  assert.ok(evalscript.includes('units: ["REFLECTANCE", "REFLECTANCE", "DN", "DN"]'));
  assert.ok(evalscript.includes("(nir - red) / denom"));
  assert.ok(evalscript.includes("scl === 3")); // Cloud shadow check
  assert.ok(evalscript.includes("scl === 6")); // Water excluded
});

test("Sentinel-2 SCL & Optical Band Units Regression Test", () => {
  const evalscript = buildNdviStatisticalEvalscript();

  // 1. Must use VERSION=3
  assert.ok(evalscript.includes("//VERSION=3"));

  // 2. Extract input configuration from evalscript
  assert.ok(evalscript.includes('bands: ["B04", "B08", "SCL", "dataMask"]'));
  assert.ok(evalscript.includes('units: ["REFLECTANCE", "REFLECTANCE", "DN", "DN"]'));

  // 3. Confirm SCL is NOT assigned REFLECTANCE anywhere in evalscript
  assert.equal(evalscript.includes('units: "REFLECTANCE"'), false, "Must not set global units: 'REFLECTANCE'");

  // 4. Verify band-to-unit mapping explicitly
  const bandsMatch = evalscript.match(/bands:\s*\[([^\]]+)\]/);
  const unitsMatch = evalscript.match(/units:\s*\[([^\]]+)\]/);
  assert.ok(bandsMatch, "Evalscript must specify bands array");
  assert.ok(unitsMatch, "Evalscript must specify units array");

  const bands = JSON.parse(`[${bandsMatch[1]}]`);
  const units = JSON.parse(`[${unitsMatch[1]}]`);

  assert.equal(bands.length, units.length, "Bands and units arrays must be aligned 1:1");

  const b04Idx = bands.indexOf("B04");
  const b08Idx = bands.indexOf("B08");
  const sclIdx = bands.indexOf("SCL");
  const dataMaskIdx = bands.indexOf("dataMask");

  assert.ok(b04Idx !== -1, "B04 must be present in input bands");
  assert.ok(b08Idx !== -1, "B08 must be present in input bands");
  assert.ok(sclIdx !== -1, "SCL must be present in input bands");
  assert.ok(dataMaskIdx !== -1, "dataMask must be present in input bands");

  assert.equal(units[b04Idx], "REFLECTANCE", "B04 (Red) must be requested in REFLECTANCE units");
  assert.equal(units[b08Idx], "REFLECTANCE", "B08 (NIR) must be requested in REFLECTANCE units");
  assert.equal(units[sclIdx], "DN", "SCL (Scene Classification) must be requested in DN units");
  assert.equal(units[dataMaskIdx], "DN", "dataMask must be requested in DN units");

  // 5. Scientific NDVI formula preservation: (NIR - Red) / (NIR + Red)
  assert.ok(evalscript.includes("(nir - red) / denom"));
  assert.ok(evalscript.includes("denom <= 0.00001"));

  // 6. SCL cloud, cloud-shadow, and invalid pixel masking preservation
  assert.ok(evalscript.includes("scl === 0")); // NO_DATA
  assert.ok(evalscript.includes("scl === 1")); // SATURATED_OR_DEFECTIVE
  assert.ok(evalscript.includes("scl === 3")); // CLOUD_SHADOWS
  assert.ok(evalscript.includes("scl === 7")); // UNCLASSIFIED / LOW_PROB_CLOUD
  assert.ok(evalscript.includes("scl === 8")); // CLOUD_MEDIUM_PROBABILITY
  assert.ok(evalscript.includes("scl === 9")); // CLOUD_HIGH_PROBABILITY
  assert.ok(evalscript.includes("scl === 10")); // THIN_CIRRUS
  assert.ok(evalscript.includes("scl === 11")); // SNOW_OR_ICE
  assert.ok(evalscript.includes("if (!samples.dataMask)"));
});

test("Response Normalization & Quality Report", () => {
  const timeseries = [
    { from: "2024-01-01", to: "2024-01-10", hasValidObservations: true, mean: 0.45, median: 0.44, min: 0.2, max: 0.7, stDev: 0.1, validPixelCount: 100, noDataPixelCount: 20, validCoveragePercent: 83.3, percentiles: { p10: 0.3, p50: 0.44, p90: 0.6 } },
    { from: "2024-01-11", to: "2024-01-20", hasValidObservations: false, mean: null, validPixelCount: 0, noDataPixelCount: 120, validCoveragePercent: 0 },
  ];

  // Default exclusions
  const quality = compileQualityReport(timeseries, [{ id: "S2A_TEST" }]);
  assert.equal(quality.totalIntervals, 2);
  assert.equal(quality.validIntervals, 1);
  assert.equal(quality.maskedIntervals, 1);
  assert.deepEqual(quality.sclClassesExcluded, [0, 1, 2, 3, 6, 7, 8, 9, 10, 11]);

  // Configurable exclusions: include cast shadow and water
  const qualityConfigured = compileQualityReport(timeseries, [{ id: "S2A_TEST" }], { includeCastShadow: true, includeWater: true });
  assert.deepEqual(qualityConfigured.sclClassesExcluded, [0, 1, 3, 7, 8, 9, 10, 11]);

  const normalized = normalizeVegetationResponse({
    fieldId: "test-1",
    fieldName: "North Field",
    areaHectares: 3.5,
    geometry: { type: "Polygon", coordinates: [] },
    from: "2024-01-01",
    to: "2024-01-20",
    interval: "P10D",
    timeseries,
    stacScenes: [{ id: "S2A_TEST" }],
  });

  assert.equal(normalized.feature, "field-vegetation-intelligence");
  assert.equal(normalized.field.name, "North Field");
  assert.equal(normalized.latest.meanNdvi, 0.45);
  assert.equal(normalized.latest.validSampleRatio, 83.3);
  assert.equal(normalized.condition.category, "moderate_canopy");
  assert.equal(normalized.anomaly.status, "unavailable");
  assert.ok(normalized.anomaly.note.includes("Historical climatological baseline unavailable"));
  assert.equal(normalized.provenance.provider, "Copernicus Data Space Ecosystem (CDSE)");
});

test("Parse Statistical API Response with Percentiles and Masking", async () => {
  const { parseStatisticalResponse } = await import("../lib/vegetation/sentinel-statistics.js");
  const rawApiData = {
    data: [
      {
        interval: { from: "2024-05-01T00:00:00Z", to: "2024-05-10T23:59:59Z" },
        outputs: {
          ndvi: {
            bands: {
              B0: {
                stats: {
                  min: 0.15,
                  max: 0.82,
                  mean: 0.6123,
                  stDev: 0.0841,
                  sampleCount: 420,
                  noDataCount: 80,
                  percentiles: {
                    "10.0": 0.35,
                    "25.0": 0.48,
                    "50.0": 0.62,
                    "75.0": 0.74,
                    "90.0": 0.79,
                  },
                },
              },
            },
          },
        },
      },
      {
        interval: { from: "2024-05-11T00:00:00Z", to: "2024-05-20T23:59:59Z" },
        outputs: {
          ndvi: {
            bands: {
              B0: {
                stats: {
                  min: null,
                  max: null,
                  mean: null,
                  stDev: null,
                  sampleCount: 0,
                  noDataCount: 500,
                  percentiles: {},
                },
              },
            },
          },
        },
      },
    ],
  };

  const parsed = parseStatisticalResponse(rawApiData);
  assert.equal(parsed.length, 2);

  // Interval 1: valid
  assert.equal(parsed[0].hasValidObservations, true);
  assert.equal(parsed[0].mean, 0.6123);
  assert.equal(parsed[0].median, 0.62);
  assert.equal(parsed[0].validCoveragePercent, 84); // 420 / 500 * 100 = 84%
  assert.equal(parsed[0].percentiles.p10, 0.35);
  assert.equal(parsed[0].percentiles.p50, 0.62);
  assert.equal(parsed[0].percentiles.p90, 0.79);

  // Interval 2: completely masked (cloud/shadow)
  assert.equal(parsed[1].hasValidObservations, false);
  assert.equal(parsed[1].mean, null);
  assert.equal(parsed[1].validPixelCount, 0);
  assert.equal(parsed[1].noDataPixelCount, 500);

  // Interval 3: edge case with string values, integer keys, and invalid values (regression test for .toFixed is not a function)
  const edgeCaseRaw = {
    data: [
      {
        interval: { from: "2024-06-01T00:00:00Z", to: "2024-06-10T23:59:59Z" },
        outputs: {
          ndvi: {
            bands: {
              B0: {
                stats: {
                  min: "0.12345",
                  max: "0.78901",
                  mean: "0.45678",
                  stDev: "0.10101",
                  sampleCount: 100,
                  noDataCount: 0,
                  percentiles: {
                    "10.0": "0.15",     // string value
                    "25": 0.25,         // integer key
                    "50.0": "0.45",     // string median
                    "75": "0.65",       // integer key + string value
                    "90.0": "NaN",      // invalid numeric string
                  },
                },
              },
            },
          },
        },
      },
    ],
  };

  const edgeParsed = parseStatisticalResponse(edgeCaseRaw);
  assert.equal(edgeParsed.length, 1);
  assert.equal(edgeParsed[0].mean, 0.4568);
  assert.equal(edgeParsed[0].median, 0.45);
  assert.equal(edgeParsed[0].percentiles.p10, 0.15);
  assert.equal(edgeParsed[0].percentiles.p25, 0.25);
  assert.equal(edgeParsed[0].percentiles.p50, 0.45);
  assert.equal(edgeParsed[0].percentiles.p75, 0.65);
  assert.equal(edgeParsed[0].percentiles.p90, null); // "NaN" safely coerced to null
});

test("dataMask & NDVI Edge Cases (Zero NDVI, Denominators, and Missing Values)", async () => {
  const { parseStatisticalResponse } = await import("../lib/vegetation/sentinel-statistics.js");

  // 1. Valid NDVI equal to exactly zero (NIR === Red)
  const zeroNdvi = calculatePixelNdvi(0.20, 0.20);
  assert.equal(zeroNdvi, 0);
  assert.notEqual(zeroNdvi, null);

  // 2. Missing reflectance
  assert.equal(calculatePixelNdvi(null, 0.35), null);
  assert.equal(calculatePixelNdvi(0.25, undefined), null);
  assert.equal(calculatePixelNdvi(NaN, 0.35), null);

  // 3. Negative reflectance
  assert.equal(calculatePixelNdvi(-0.01, 0.25), null);
  assert.equal(calculatePixelNdvi(0.25, -0.05), null);

  // 4. Zero and near-zero denominator (<= 0.00001)
  assert.equal(calculatePixelNdvi(0, 0), null);
  assert.equal(calculatePixelNdvi(0.000004, 0.000005), null); // sum = 0.000009 <= 0.00001

  // 5. Valid zero NDVI in Statistical API response (must not be mistaken for no-data)
  const zeroMeanData = {
    data: [
      {
        interval: { from: "2024-06-01T00:00:00Z", to: "2024-06-10T23:59:59Z" },
        outputs: {
          ndvi: {
            bands: {
              B0: {
                stats: {
                  min: -0.05,
                  max: 0.05,
                  mean: 0.0,
                  stDev: 0.01,
                  sampleCount: 200,
                  noDataCount: 50,
                  percentiles: { "50.0": 0.0 },
                },
              },
            },
          },
        },
      },
    ],
  };

  const parsedZero = parseStatisticalResponse(zeroMeanData);
  assert.equal(parsedZero[0].hasValidObservations, true);
  assert.equal(parsedZero[0].mean, 0.0);
  assert.equal(parsedZero[0].status, "valid");
  assert.equal(parsedZero[0].validSampleRatio, 80.0); // 200 / 250 = 80%

  // 6. Evalscript string verification for dataMask === 0 and invalid reflectance
  const evalscript = buildNdviStatisticalEvalscript({ includeWater: false, includeCastShadow: false });
  // Verify polygon dataMask check
  assert.ok(evalscript.includes("if (!samples.dataMask)"));
  // Verify SCL masking for cloud (8, 9), shadow (3), defective (1), no data (0)
  assert.ok(evalscript.includes("scl === 3"));
  assert.ok(evalscript.includes("scl === 8"));
  assert.ok(evalscript.includes("scl === 9"));
  // Verify cast shadow and water exclusions
  assert.ok(evalscript.includes("scl === 2"));
  assert.ok(evalscript.includes("scl === 6"));
  // Verify denominator zero protection
  assert.ok(evalscript.includes("denom <= 0.00001"));
});

test("Feature 1: 5-Tier Scientific Pipeline Verification Reporting", () => {
  const timeseries = [
    {
      from: "2024-05-01T00:00:00Z",
      to: "2024-05-10T23:59:59Z",
      hasValidObservations: true,
      mean: 0.65,
      median: 0.66,
      min: 0.2,
      max: 0.85,
      stDev: 0.08,
      validPixelCount: 420,
      noDataPixelCount: 80,
      validCoveragePercent: 84.0,
      percentiles: { p10: 0.35, p50: 0.66, p90: 0.79 },
    },
  ];

  const stacScenes = [
    { id: "S2A_MSIL2A_20240502", datetime: "2024-05-02T10:30:00Z", cloudCoverPercent: 12.5 },
  ];

  const normalized = normalizeVegetationResponse({
    fieldId: "field-s2-test",
    fieldName: "Central Pivot",
    areaHectares: 12.0,
    geometry: { type: "Polygon", coordinates: [] },
    from: "2024-05-01",
    to: "2024-05-10",
    interval: "P10D",
    timeseries,
    stacScenes,
    authStatus: "configured",
  });

  const p = normalized.pipelineStatus;
  assert.ok(p !== undefined);
  assert.equal(p.tier1_sceneDiscovery.status, "succeeded");
  assert.equal(p.tier1_sceneDiscovery.scenesFound, 1);
  assert.equal(p.tier2_statisticalRequest.status, "succeeded");
  assert.equal(p.tier3_processingResponse.status, "succeeded");
  assert.equal(p.tier4_validPixelExtraction.status, "succeeded");
  assert.equal(p.tier5_derivedNdviAnalysis.status, "succeeded");

  // Test unauthenticated credentials_required state
  const unauth = normalizeVegetationResponse({
    fieldId: "field-s2-test",
    fieldName: "Central Pivot",
    areaHectares: 12.0,
    geometry: { type: "Polygon", coordinates: [] },
    from: "2024-05-01",
    to: "2024-05-10",
    interval: "P10D",
    timeseries: [],
    stacScenes,
    authStatus: "credentials_required",
  });

  const unauthP = unauth.pipelineStatus;
  assert.equal(unauthP.tier1_sceneDiscovery.status, "succeeded");
  assert.equal(unauthP.tier2_statisticalRequest.status, "credentials_required");
  assert.equal(unauthP.tier3_processingResponse.status, "pending_auth");
  assert.equal(unauthP.tier4_validPixelExtraction.status, "pending_auth");
  assert.equal(unauthP.tier5_derivedNdviAnalysis.status, "pending_valid_observation");
});
