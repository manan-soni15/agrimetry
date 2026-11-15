/**
 * Water Stress Analysis & Evidence-Based Synthesis for Agrimetry.
 *
 * Implements:
 * 1. Climatic Water Balance (CWB = P - ET0)
 * 2. Explainable Water-Stress Evidence Classification
 *
 * CRITICAL SCIENTIFIC DISTINCTIONS:
 * - Climatic Water Balance (P - ET0) measures atmospheric demand vs supply.
 *   Negative values indicate reference evaporative demand exceeded precipitation.
 *   It is NOT root-zone water deficit, actual crop water deficit, irrigation requirement,
 *   or measured soil water loss.
 * - Water-stress evidence is NOT a calibrated drought index or yield prediction.
 *   It synthesizes multiple independent remote-sensing and meteorological indicators
 *   with transparent rule triggers.
 */

/**
 * Calculates daily and cumulative Climatic Water Balance (CWB = P - ET0).
 *
 * @param {Array<Object>} dailyRecords - Array of objects with precipitation (mm) and et0 (mm)
 * @returns {Object} CWB series and accumulated totals
 */
export function calculateClimaticWaterBalance(dailyRecords = []) {
  if (!Array.isArray(dailyRecords) || dailyRecords.length === 0) {
    return {
      dailySeries: [],
      cumulative7dMm: null,
      cumulative14dMm: null,
      cumulative30dMm: null,
      status: "insufficient_data",
      note: "No daily precipitation and ET0 records available.",
    };
  }

  const series = dailyRecords.map((d) => {
    const p = d.precipitation != null && Number.isFinite(d.precipitation) ? d.precipitation : null;
    const et0 = d.et0 != null && Number.isFinite(d.et0) ? d.et0 : null;
    const cwb = p !== null && et0 !== null ? Number((p - et0).toFixed(2)) : null;

    return {
      date: d.date,
      precipitationMm: p,
      et0Mm: et0,
      cwbMm: cwb,
    };
  });

  const validCwb = series.map((s) => s.cwbMm).filter((v) => v !== null);

  if (validCwb.length === 0) {
    return {
      dailySeries: series,
      cumulative7dMm: null,
      cumulative14dMm: null,
      cumulative30dMm: null,
      status: "unavailable",
      note: "Inputs were insufficient to compute daily CWB.",
    };
  }

  const sumLastN = (n) => {
    const slice = validCwb.slice(-n);
    if (slice.length < Math.min(n, 3)) return null;
    const sum = slice.reduce((acc, v) => acc + v, 0);
    return Number(sum.toFixed(1));
  };

  const cumulative7dMm = sumLastN(7);
  const cumulative14dMm = sumLastN(14);
  const cumulative30dMm = sumLastN(30);

  return {
    dailySeries: series,
    cumulative7dMm,
    cumulative14dMm,
    cumulative30dMm,
    status: "computed",
    definition: "Climatic water balance (precipitation − reference ET0)",
    note: "Negative values signify atmospheric demand exceeded precipitation over the period. This is an atmospheric water balance, not a soil or crop water balance.",
  };
}

/**
 * Classifies explainable water-stress evidence from converging environmental signals.
 *
 * @param {Object} params
 * @param {Object} params.soilMoisture - SMAP surface and root-zone metrics
 * @param {Object} params.rainfall - Recent rainfall accumulation and anomaly
 * @param {Object} params.climaticWaterBalance - 14d and 30d CWB
 * @param {Object} params.quality - Data completeness and representativeness
 * @returns {Object} Evidence-based classification
 */
export function classifyWaterStressEvidence({
  soilMoisture = {},
  rainfall = {},
  climaticWaterBalance = {},
  quality = {},
}) {
  const evidence = [];
  const warnings = [];

  const rootZoneSm = soilMoisture.rootZone?.latest ?? null;
  const rootZonePctl = soilMoisture.rootZone?.percentile ?? null;
  const rootZoneZ = soilMoisture.rootZone?.zScore ?? null;
  const surfaceSm = soilMoisture.surface?.latest ?? null;

  const rain30d = rainfall.recentAccumulation30dMm ?? null;
  const rainAnomalyPct = rainfall.anomalyPercent ?? null;

  const cwb30d = climaticWaterBalance.cumulative30dMm ?? null;

  let stressPoints = 0;
  let hasCriticalData = false;

  // 1. Root-zone soil moisture signal
  if (rootZonePctl != null) {
    hasCriticalData = true;
    if (rootZonePctl < 10) {
      stressPoints += 3;
      evidence.push(`SMAP root-zone moisture is severely depleted (empirical percentile ${rootZonePctl}th pctl).`);
    } else if (rootZonePctl < 25) {
      stressPoints += 2;
      evidence.push(`SMAP root-zone moisture is low (empirical percentile ${rootZonePctl}th pctl).`);
    } else if (rootZonePctl > 60) {
      stressPoints -= 1;
      evidence.push(`SMAP root-zone moisture is favorable (${rootZonePctl}th pctl), providing an active soil water buffer.`);
    }
  } else if (rootZoneZ != null) {
    hasCriticalData = true;
    if (rootZoneZ < -1.5) {
      stressPoints += 3;
      evidence.push(`SMAP root-zone moisture is severely below average (Z-score: ${rootZoneZ}).`);
    } else if (rootZoneZ < -0.8) {
      stressPoints += 2;
      evidence.push(`SMAP root-zone moisture is below normal (Z-score: ${rootZoneZ}).`);
    }
  } else if (rootZoneSm != null) {
    hasCriticalData = true;
    const rzFmt = Number(rootZoneSm.toFixed(3));
    if (rootZoneSm < 0.12) {
      stressPoints += 2;
      evidence.push(`SMAP root-zone soil moisture is low (${rzFmt} m³/m³).`);
    } else if (rootZoneSm > 0.28) {
      evidence.push(`SMAP root-zone soil moisture is moderate to high (${rzFmt} m³/m³).`);
    }
  }

  // 2. Surface soil moisture signal
  if (surfaceSm != null) {
    if (surfaceSm < 0.1) {
      stressPoints += 1;
      const surfFmt = Number(surfaceSm.toFixed(3));
      evidence.push(`Surface topsoil (0–5 cm) is desiccated (${surfFmt} m³/m³), restricting germination and shallow rooting.`);
    }
  }

  // 3. Rainfall anomaly and recent accumulation
  if (rainAnomalyPct != null) {
    hasCriticalData = true;
    const anomFmt = Number(rainAnomalyPct.toFixed(1));
    if (rainAnomalyPct < -50) {
      stressPoints += 2;
      evidence.push(`Precipitation is in severe deficit (${anomFmt}% relative to historical baseline).`);
    } else if (rainAnomalyPct < -25) {
      stressPoints += 1;
      evidence.push(`Precipitation is moderately below average (${anomFmt}%).`);
    } else if (rainAnomalyPct > 20) {
      stressPoints -= 1;
      evidence.push(`Precipitation is above seasonal average (+${anomFmt}%).`);
    }
  }

  if (rain30d != null) {
    hasCriticalData = true;
    const r30Fmt = Number(rain30d.toFixed(1));
    if (rain30d < 10) {
      stressPoints += 1;
      evidence.push(`Very low 30-day rainfall accumulation (${r30Fmt} mm).`);
    } else if (rain30d > 80) {
      stressPoints -= 1;
      evidence.push(`Substantial 30-day rainfall received (${r30Fmt} mm).`);
    }
  }

  // 4. Climatic Water Balance (P - ET0)
  if (cwb30d != null) {
    hasCriticalData = true;
    const cwbFmt = Number(cwb30d.toFixed(1));
    if (cwb30d < -80) {
      stressPoints += 2;
      evidence.push(`Strong cumulative moisture deficit over 30 days: reference ET0 exceeded precipitation by ${Math.abs(cwbFmt)} mm.`);
    } else if (cwb30d < -30) {
      stressPoints += 1;
      evidence.push(`Negative 30-day climatic water balance (${cwbFmt} mm); evaporative demand is running ahead of rainfall.`);
    } else if (cwb30d > 10) {
      stressPoints -= 1;
      evidence.push(`Positive 30-day climatic water balance (+${cwbFmt} mm); precipitation exceeded reference demand.`);
    }
  }

  // Check for mixed / contradictory evidence
  const hasLowRain = (rainAnomalyPct != null && rainAnomalyPct < -25) || (rain30d != null && rain30d < 20);
  const hasGoodSoil = (rootZonePctl != null && rootZonePctl > 40) || (rootZoneSm != null && rootZoneSm > 0.22);
  const isMixed = hasLowRain && hasGoodSoil;

  if (isMixed) {
    warnings.push("Mixed evidence: Recent rainfall is low, but root-zone moisture remains buffered by prior storage or irrigation. Do not interpret as severe drought.");
  }

  if (!hasCriticalData) {
    return {
      category: "insufficient_data",
      label: "Insufficient data",
      severityLevel: 0,
      confidence: "low",
      evidence: ["Essential remote-sensing or meteorological observations are not available for this period."],
      warnings: ["Unable to establish water stress classification."],
      limitations: [
        "Classification requires at least one verified soil moisture or precipitation series.",
        "Regional satellite products (SMAP 9 km, IMERG 10 km) cannot detect localized micro-irrigation.",
      ],
    };
  }

  let category = "no_stress";
  let label = "No clear regional water-stress signal";
  let severityLevel = 1;

  if (isMixed) {
    category = "watch";
    label = "Watch (Mixed Evidence — Soil Buffered)";
    severityLevel = 2;
  } else if (stressPoints >= 5) {
    category = "severe_stress";
    label = "Severe water-stress evidence";
    severityLevel = 4;
  } else if (stressPoints >= 3) {
    category = "elevated_stress";
    label = "Elevated water-stress evidence";
    severityLevel = 3;
  } else if (stressPoints >= 1) {
    category = "watch";
    label = "Watch";
    severityLevel = 2;
  }

  return {
    category,
    label,
    severityLevel,
    confidence: quality.spatialRepresentativeness === "coarse_regional" ? "moderate" : "high",
    evidence,
    warnings,
    limitations: [
      "Climatic Water Balance (P − ET0) reflects atmospheric supply vs demand and does not measure actual root-zone soil water loss or crop canopy water deficit.",
      "SMAP (~9 km) and IMERG (~10 km) grids are regional landscape products and cannot distinguish micro-irrigation within individual fields.",
      "SMAP L4 root zone is a Catchment Land Surface Model assimilation estimate informed by SMAP observations, not a direct measurement through the 0–100 cm column.",
    ],
  };
}
