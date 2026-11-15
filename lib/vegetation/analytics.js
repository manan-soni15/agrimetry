// Within-field variability (management zones) and seasonal pattern (phenology)
// derived from NDVI. Pure functions with no network access.
//
// NDVI shows relative greenness only. Zones are a prompt for field scouting and
// soil sampling; they do not say why one part of the field differs.

export const ABSOLUTE_CLASSES = [
  { key: "bare", label: "Bare or very sparse", min: -1, max: 0.2, color: "#8f552e" },
  { key: "sparse", label: "Sparse cover", min: 0.2, max: 0.4, color: "#d6b04a" },
  { key: "moderate", label: "Moderate cover", min: 0.4, max: 0.6, color: "#a8bd75" },
  { key: "dense", label: "Dense green cover", min: 0.6, max: 1.01, color: "#245b38" },
];
export const ZONE_COLORS = ["#c2412f", "#e0b43a", "#2f6b3a"]; // low, medium, high (relative)
export const ZONE_LABELS = ["Lower-than-field zone", "Typical zone", "Higher-than-field zone"];
const MIN_PIXELS = 30;

const finite = Number.isFinite;

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

// values: Float32Array of NDVI with NaN outside the field or where masked.
// grid: { pixelWidth, pixelHeight } in metres.
export function computeFieldVariability(values, grid) {
  const valid = [];
  for (const value of values) if (finite(value)) valid.push(value);
  if (valid.length < MIN_PIXELS) {
    return { available: false, reason: "Too few clear pixels inside the field to describe variation within it." };
  }
  const sorted = [...valid].sort((a, b) => a - b);
  const pixelHectares = (grid.pixelWidth * grid.pixelHeight) / 10000;
  const average = mean(valid);
  const sd = Math.sqrt(valid.reduce((s, v) => s + (v - average) ** 2, 0) / (valid.length - 1));
  const p10 = quantile(sorted, 0.1);
  const p33 = quantile(sorted, 1 / 3);
  const p67 = quantile(sorted, 2 / 3);
  const p90 = quantile(sorted, 0.9);

  const absolute = ABSOLUTE_CLASSES.map((cls) => {
    const members = valid.filter((v) => v >= cls.min && v < cls.max);
    return { key: cls.key, label: cls.label, color: cls.color, min: Math.max(cls.min, -0.1), max: Math.min(cls.max, 1), pixelCount: members.length, areaHectares: members.length * pixelHectares, share: members.length / valid.length };
  });

  // Relative zones: thirds of this field's own NDVI distribution.
  const zoneOf = (v) => (v < p33 ? 0 : v < p67 ? 1 : 2);
  const buckets = [[], [], []];
  for (const v of valid) buckets[zoneOf(v)].push(v);
  const relative = {
    thresholds: [p33, p67],
    zones: buckets.map((members, index) => ({
      index,
      label: ZONE_LABELS[index],
      color: ZONE_COLORS[index],
      pixelCount: members.length,
      areaHectares: members.length * pixelHectares,
      share: members.length / valid.length,
      meanNdvi: mean(members),
    })),
  };

  const cv = average > 0.05 ? sd / average : null;
  const spread = p90 - p10;
  let uniformity;
  let guidance;
  if (spread < 0.08 || (cv !== null && cv < 0.08)) {
    uniformity = "very uniform";
    guidance = "Greenness is almost the same across the field. Management zones would add little; treat the field as one unit.";
  } else if (spread < 0.18) {
    uniformity = "fairly uniform";
    guidance = "There is modest variation. Walk the lower zone once to see whether it has a visible cause, but separate management is probably not needed.";
  } else if (spread < 0.3) {
    uniformity = "variable";
    guidance = "Clear differences exist within the field. Scout the lower-than-field zone and consider soil sampling there and in the higher zone to compare.";
  } else {
    uniformity = "highly variable";
    guidance = "Greenness differs strongly across the field. Different soil, drainage, planting dates or crops may be involved; scouting and zone-based soil sampling are worthwhile.";
  }

  return {
    available: true,
    validPixelCount: valid.length,
    areaHectares: valid.length * pixelHectares,
    meanNdvi: average,
    stdDev: sd,
    coefficientOfVariation: cv,
    p10, p90, spread,
    uniformity,
    guidance,
    absolute,
    relative,
    method: "Relative zones split the field into thirds of its own NDVI distribution (below the 33rd percentile, middle, above the 67th). Absolute classes use fixed NDVI bands. Areas are clear-pixel areas, so cloudy gaps are not counted.",
  };
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (key) => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

// Seasonal pattern from the monthly NDVI series (one clear observation per month).
export function derivePhenology(monthly) {
  const observed = (monthly || []).filter((m) => finite(m.meanNdvi));
  if (observed.length < 4) {
    return { available: false, reason: "At least four months with clear observations are needed to describe the seasonal pattern." };
  }
  const peak = observed.reduce((a, b) => (b.meanNdvi > a.meanNdvi ? b : a));
  const trough = observed.reduce((a, b) => (b.meanNdvi < a.meanNdvi ? b : a));
  const amplitude = peak.meanNdvi - trough.meanNdvi;
  const half = trough.meanNdvi + amplitude / 2;
  const above = observed.filter((m) => m.meanNdvi >= half);
  const greenMonths = observed.filter((m) => m.meanNdvi >= 0.35).length;

  let pattern;
  if (amplitude < 0.12) pattern = peak.meanNdvi >= 0.5 ? "steady green cover" : "steady low cover";
  else {
    // Count separate rises: months crossing the half-amplitude level from below.
    let cycles = 0;
    let wasAbove = false;
    for (const m of observed) {
      const isAbove = m.meanNdvi >= half && m.meanNdvi >= 0.35;
      if (isAbove && !wasAbove) cycles += 1;
      wasAbove = isAbove;
    }
    pattern = cycles >= 2 ? `${cycles} green periods in the window` : cycles === 1 ? "one clear green period" : "weak seasonal rise";
  }

  // Green-up and senescence rates between consecutive observed months.
  let fastestRise = null;
  let fastestFall = null;
  for (let i = 1; i < observed.length; i += 1) {
    const change = observed[i].meanNdvi - observed[i - 1].meanNdvi;
    const gap = (Number(observed[i].month.slice(0, 4)) - Number(observed[i - 1].month.slice(0, 4))) * 12 + Number(observed[i].month.slice(5, 7)) - Number(observed[i - 1].month.slice(5, 7));
    if (gap !== 1) continue; // only compare directly consecutive months
    if (!fastestRise || change > fastestRise.change) fastestRise = { from: observed[i - 1].month, to: observed[i].month, change };
    if (!fastestFall || change < fastestFall.change) fastestFall = { from: observed[i - 1].month, to: observed[i].month, change };
  }

  return {
    available: true,
    observedMonths: observed.length,
    peak: { month: peak.month, label: monthName(peak.month), ndvi: peak.meanNdvi },
    trough: { month: trough.month, label: monthName(trough.month), ndvi: trough.meanNdvi },
    amplitude,
    greenMonths,
    activeFrom: above.length ? above[0].month : null,
    activeTo: above.length ? above[above.length - 1].month : null,
    pattern,
    fastestRise: fastestRise && fastestRise.change > 0.05 ? fastestRise : null,
    fastestFall: fastestFall && fastestFall.change < -0.05 ? fastestFall : null,
    note: "Based on one clear observation per month, so peaks and dips can be missed or shifted by up to a few weeks.",
  };
}
