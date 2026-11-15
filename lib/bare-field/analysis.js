// Bare-field / low-vegetation detection from a monthly NDVI series.
//
// Pure functions: no network access. Inputs are the monthly records produced by
// the vegetation analysis (month, meanNdvi, validPixelFraction) and, optionally,
// monthly rainfall records from the water-stress analysis.
//
// NDVI cannot distinguish bare soil, stubble, fallow, water or a very young
// crop on its own. Every result here is a screening aid to be checked in the
// field and against the farmer's crop calendar.

export const BARE_NDVI = 0.2; // below this: little or no green cover
export const SPARSE_NDVI = 0.35; // below this (but not bare): sparse / partial cover
export const CROP_PEAK_NDVI = 0.45; // a vegetated stretch peaking above this counts as a crop cycle
export const MIN_COVER_GAP_MONTHS = 2; // shortest gap worth a cover-crop suggestion
export const MIN_VALID_FRACTION = 0.3; // months seen through clouds this poorly are treated as unknown

export const COVER_STATES = ["unknown", "bare", "sparse", "vegetated"];

export function classifyMonth(record) {
  const ndvi = record?.meanNdvi;
  if (!Number.isFinite(ndvi)) return "unknown";
  if (Number.isFinite(record.validPixelFraction) && record.validPixelFraction < MIN_VALID_FRACTION) return "unknown";
  if (ndvi < BARE_NDVI) return "bare";
  if (ndvi < SPARSE_NDVI) return "sparse";
  return "vegetated";
}

const isLow = (state) => state === "bare" || state === "sparse";

function monthsBetween(a, b) {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am) + 1;
}

function mean(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

// Rain context for a set of months: average monthly rainfall and ratio to normal.
function rainContext(months, rainByMonth) {
  const rows = months.map((m) => rainByMonth.get(m.month)).filter(Boolean);
  if (!rows.length) return null;
  const rain = mean(rows.map((r) => r.rainMm));
  const ratios = rows.map((r) => r.rainRatio).filter(Number.isFinite);
  return {
    averageMonthlyRainMm: rain,
    averageRainRatio: ratios.length ? mean(ratios) : null,
    monthsWithRain: rows.length,
  };
}

function erosionLevel(state, rainMm, rainRatio) {
  if (!isLow(state) || !Number.isFinite(rainMm)) return null;
  let score = state === "bare" ? 2 : 1;
  if (rainMm >= 100) score += 2;
  else if (rainMm >= 50) score += 1;
  if (Number.isFinite(rainRatio) && rainRatio >= 1.3 && rainMm >= 30) score += 1;
  if (rainMm < 20) score = Math.min(score, 1);
  return score >= 4 ? "High" : score >= 3 ? "Moderate" : "Low";
}

export function detectBareFieldPeriods(monthly, rainMonthly = []) {
  const rainByMonth = new Map((rainMonthly || []).map((r) => [r.month, r]));
  const months = (monthly || []).map((record) => ({
    month: record.month,
    ndvi: Number.isFinite(record.meanNdvi) ? record.meanNdvi : null,
    validPixelFraction: record.validPixelFraction ?? null,
    state: classifyMonth(record),
  }));

  // Pass 1: group consecutive low months. Unknown months inside a low stretch do
  // not end it (the field was not seen to turn green), but are recorded so the
  // period can be labelled "partly observed".
  const raw = [];
  let current = null;
  let pendingUnknown = [];
  for (const m of months) {
    if (isLow(m.state)) {
      if (!current) current = { items: [], unknownInside: 0 };
      current.unknownInside += pendingUnknown.length;
      current.items.push(...pendingUnknown, m);
      pendingUnknown = [];
    } else if (m.state === "unknown") {
      if (current) pendingUnknown.push(m);
    } else {
      if (current) { raw.push(current); current = null; }
      pendingUnknown = [];
    }
  }
  if (current) raw.push(current);

  const firstMonth = months[0]?.month;
  const lastMonth = months[months.length - 1]?.month;
  const vegetatedBefore = (month) => months.some((m) => m.month < month && m.state === "vegetated" && m.ndvi >= CROP_PEAK_NDVI);
  const vegetatedAfter = (month) => months.some((m) => m.month > month && m.state === "vegetated" && m.ndvi >= CROP_PEAK_NDVI);

  const periods = raw.map((group) => {
    const observed = group.items.filter((m) => m.ndvi !== null);
    const start = group.items[0].month;
    const end = group.items[group.items.length - 1].month;
    const length = monthsBetween(start, end);
    const min = Math.min(...observed.map((m) => m.ndvi));
    const states = observed.map((m) => m.state);
    const before = vegetatedBefore(start);
    const after = vegetatedAfter(end);
    let kind = "gap";
    if (start === firstMonth && !before) kind = "starts-window";
    else if (end === lastMonth && !after) kind = "ends-window";
    if (start === firstMonth && end === lastMonth) kind = "whole-window";
    const bareMonths = states.filter((s) => s === "bare").length;
    return {
      startMonth: start,
      endMonth: end,
      lengthMonths: length,
      minNdvi: min,
      meanNdvi: mean(observed.map((m) => m.ndvi)),
      bareMonths,
      sparseMonths: states.length - bareMonths,
      unobservedMonths: group.unknownInside,
      observation: group.unknownInside ? "partly-observed" : "fully-observed",
      kind,
      betweenCropCycles: kind === "gap" && before && after,
      months: group.items.map((m) => m.month),
    };
  });

  // Crop cycles: vegetated stretches whose peak NDVI reaches CROP_PEAK_NDVI.
  const cycles = [];
  let stretch = [];
  const closeStretch = () => {
    const peak = Math.max(...stretch.map((m) => m.ndvi));
    if (stretch.length && peak >= CROP_PEAK_NDVI) {
      cycles.push({ startMonth: stretch[0].month, endMonth: stretch[stretch.length - 1].month, peakNdvi: peak, peakMonth: stretch.find((m) => m.ndvi === peak).month });
    }
    stretch = [];
  };
  for (const m of months) {
    if (m.state === "vegetated") stretch.push(m);
    else if (m.state === "unknown") continue; // do not split a cycle on a cloudy month
    else if (stretch.length) closeStretch();
  }
  if (stretch.length) closeStretch();

  // Erosion exposure and cover-crop windows for each low period.
  const erosion = months
    .filter((m) => isLow(m.state))
    .map((m) => {
      const rain = rainByMonth.get(m.month);
      const level = erosionLevel(m.state, rain?.rainMm, rain?.rainRatio);
      return { month: m.month, state: m.state, ndvi: m.ndvi, rainMm: rain?.rainMm ?? null, rainRatio: rain?.rainRatio ?? null, level };
    });
  const levelRank = { Low: 1, Moderate: 2, High: 3 };

  for (const period of periods) {
    const rows = erosion.filter((e) => period.months.includes(e.month));
    const ranked = rows.filter((r) => r.level).sort((a, b) => levelRank[b.level] - levelRank[a.level]);
    period.erosionRisk = ranked[0]?.level ?? null;
    period.highRiskMonths = rows.filter((r) => r.level === "High").map((r) => r.month);
    period.rain = rainContext(period.months.map((month) => ({ month })), rainByMonth);
  }

  const opportunities = periods
    .filter((p) => p.betweenCropCycles && p.lengthMonths >= MIN_COVER_GAP_MONTHS)
    .map((p) => {
      const rain = p.rain?.averageMonthlyRainMm;
      let moisture = "unknown";
      let advice;
      if (Number.isFinite(rain)) {
        if (rain >= 40) {
          moisture = "adequate";
          advice = "Rainfall during this gap looks sufficient to establish a fast-growing cover crop without irrigation. Sowing right after harvest gives the most cover before the next crop.";
        } else if (rain >= 15) {
          moisture = "limited";
          advice = "Rainfall during this gap is limited. A drought-tolerant or low-biomass cover, or leaving crop residue as mulch, may be more realistic than a full cover crop unless irrigation is available.";
        } else {
          moisture = "very-limited";
          advice = "Very little rain falls during this gap, so a rainfed cover crop is unlikely to establish. Keep crop residue on the surface and avoid unnecessary tillage to protect the soil.";
        }
      } else {
        advice = "No rainfall context was available for this gap. Check local moisture before choosing between a cover crop and residue mulch.";
      }
      return {
        startMonth: p.startMonth,
        endMonth: p.endMonth,
        lengthMonths: p.lengthMonths,
        moisture,
        erosionRisk: p.erosionRisk,
        priority: p.erosionRisk === "High" ? "High" : p.erosionRisk === "Moderate" || p.lengthMonths >= 3 ? "Medium" : "Normal",
        advice,
        partlyObserved: p.observation === "partly-observed",
      };
    });

  const observedCount = months.filter((m) => m.state !== "unknown").length;
  const lowCount = months.filter((m) => isLow(m.state)).length;
  return {
    monthly: months.map((m) => ({ ...m, erosionLevel: erosion.find((e) => e.month === m.month)?.level ?? null })),
    periods,
    cropCycles: cycles,
    coverCropOpportunities: opportunities,
    erosion,
    summary: {
      totalMonths: months.length,
      observedMonths: observedCount,
      lowCoverMonths: lowCount,
      bareMonths: months.filter((m) => m.state === "bare").length,
      lowCoverShare: observedCount ? lowCount / observedCount : null,
      periodCount: periods.length,
      cropCycleCount: cycles.length,
      gapBetweenCyclesCount: periods.filter((p) => p.betweenCropCycles).length,
      highErosionMonths: erosion.filter((e) => e.level === "High").length,
      rainContextAvailable: rainByMonth.size > 0,
    },
    thresholds: { bare: BARE_NDVI, sparse: SPARSE_NDVI, cropPeak: CROP_PEAK_NDVI, minValidFraction: MIN_VALID_FRACTION },
  };
}
