// Historical Climate Replay: runs each crop's growing season against every past
// year of NASA POWER monthly climate, flags unfavourable seasons, and re-runs the
// history under simple rainfall / temperature scenarios.
//
// Monthly resolution is coarse: it cannot see heat waves, dry spells or storms
// inside a month. Outcomes rank how favourable a season was; they are not yield
// estimates. Crop values come from the approximate database in lib/rotation.

import { CROP_BY_ID } from "../rotation/crops.js";
import { effectiveSeasonRain, FULL_WATER_COVERAGE, IRRIGATION_MM, PRE_SEASON_RAIN_SHARE, seasonTemperatureFit } from "../rotation/engine.js";

export const FAVOURABLE = 0.75;
export const UNFAVOURABLE = 0.5;
export const RATINGS = ["Unfavourable", "Marginal", "Favourable"];
export const LONG_DRY_SPELL_DAYS = 15; // flagged only in a season that normally has rain
export const RAINY_SEASON_MM = 150;
export const DRY_DAY_MM = 1;
export const SUBSTANTIAL_RAIN_MM = 5;
// Daytime maximum above which this crop is likely to suffer heat stress (rule of thumb: 8°C above the top of its optimum).
export const heatThresholdFor = (crop) => Math.min(42, Math.max(30, crop.tempOpt[1] + 8));
export const SCENARIO_PRESETS = [
  { key: "baseline", label: "History as observed", rainPct: 0, tempDelta: 0 },
  { key: "drier", label: "20% less rain", rainPct: -20, tempDelta: 0 },
  { key: "warmer", label: "2°C warmer", rainPct: 0, tempDelta: 2 },
  { key: "hotDry", label: "Warmer and drier (+2°C, −20% rain)", rainPct: -20, tempDelta: 2 },
];

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const clamp = (value, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, value));
const finite = (value) => Number.isFinite(value) && value > -900;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// parameter: { T2M, T2M_MAX, PRECTOTCORR, GWETROOT } keyed YYYYMM (monthly means; rain in mm/day).
export function buildSeries(parameter, startYear, endYear, daily = null) {
  const days = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
  const months = [];
  for (let year = startYear; year <= endYear; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const key = `${year}${String(month).padStart(2, "0")}`;
      const t = parameter?.T2M?.[key];
      const r = parameter?.PRECTOTCORR?.[key];
      const w = parameter?.GWETROOT?.[key];
      months.push({
        year, month,
        temp: finite(t) ? t : null,
        rain: finite(r) ? r * days(year, month) : null,
        wet: finite(w) ? w : null,
      });
    }
  }
  // Calendar-month normals for wetness anomalies.
  const wetNormal = Array.from({ length: 12 }, (_, m) => mean(months.filter((x) => x.month === m + 1 && x.wet !== null).map((x) => x.wet)));
  return { startYear, endYear, months, wetNormal, daily: daily && daily.tmax?.length ? daily : null };
}

// Day-by-day extremes inside a crop season: hot days and the longest dry spell.
// daily: { startYear, tmax: [], rain: [] } aligned from 1 January of startYear.
export function seasonExtremes(daily, crop, sowMonth, year) {
  if (!daily) return null;
  const dayIndex = (y, m, d) => Math.round((Date.UTC(y, m, d) - Date.UTC(daily.startYear, 0, 1)) / 86400000);
  const startDay = dayIndex(year, sowMonth, 1);
  const endDay = dayIndex(year, sowMonth + crop.months, 1); // exclusive; Date.UTC rolls into the next year
  if (startDay < 0 || endDay > daily.tmax.length) return null;
  const threshold = heatThresholdFor(crop);
  let hotDays = 0;
  let valid = 0;
  let longest = 0;
  let run = 0;
  let seasonRain = 0;
  // A dry spell only matters between rain events. Dry days before the first and after
  // the last substantial rain (>= 5 mm) are the normal start or end of the rainy season.
  let firstRain = -1;
  let lastRain = -1;
  for (let i = startDay; i < endDay; i += 1) {
    if (daily.rain[i] !== null && daily.rain[i] >= SUBSTANTIAL_RAIN_MM) {
      if (firstRain < 0) firstRain = i;
      lastRain = i;
    }
  }
  for (let i = startDay; i < endDay; i += 1) {
    const t = daily.tmax[i];
    const r = daily.rain[i];
    if (t !== null && t >= threshold) hotDays += 1;
    if (r === null) { run = 0; continue; }
    valid += 1;
    seasonRain += r;
    if (i < firstRain || i > lastRain) { run = 0; continue; }
    if (r < DRY_DAY_MM) { run += 1; if (run > longest) longest = run; } else run = 0;
  }
  if (valid < (endDay - startDay) * 0.8) return null;
  return {
    heatThreshold: threshold,
    hotDays,
    longestDrySpell: longest,
    seasonRain,
    longDrySpell: seasonRain >= RAINY_SEASON_MM && longest >= LONG_DRY_SPELL_DAYS,
  };
}

// Shift rainfall by a percentage and temperature by a number of degrees.
export function applyScenario(series, { rainPct = 0, tempDelta = 0 } = {}) {
  if (!rainPct && !tempDelta) return series;
  return {
    ...series,
    daily: series.daily ? {
      ...series.daily,
      tmax: tempDelta ? series.daily.tmax.map((t) => (t === null ? null : t + tempDelta)) : series.daily.tmax,
      rain: rainPct ? series.daily.rain.map((r) => (r === null ? null : r * (1 + rainPct / 100))) : series.daily.rain,
    } : null,
    months: series.months.map((m) => ({
      ...m,
      temp: m.temp === null ? null : m.temp + tempDelta,
      rain: m.rain === null ? null : m.rain * (1 + rainPct / 100),
    })),
  };
}

// Outcome of one crop season that starts in calendar month `sowMonth` (0-11) of `year`.
export function seasonOutcome(crop, sowMonth, year, series, irrigationLevel = "rainfed") {
  const base = (year - series.startYear) * 12 + sowMonth;
  const window = Array.from({ length: crop.months }, (_, k) => series.months[base + k]);
  const before = [1, 2].map((k) => series.months[base - k]);
  if (window.some((m) => !m || m.temp === null || m.rain === null)) return null; // season runs past the data
  const havePre = before.every((m) => m && m.rain !== null);
  const tempFit = seasonTemperatureFit(crop, window.map((m) => m.temp));
  const rain = window.reduce((sum, m) => sum + m.rain, 0);
  const effectiveRain = effectiveSeasonRain(crop, window.map((m) => ({ temp: m.temp, rain: m.rain })));
  const stored = havePre ? PRE_SEASON_RAIN_SHARE * (before[0].rain + before[1].rain) : null;
  const need = (crop.waterMm[0] + crop.waterMm[1]) / 2;
  const irrigation = IRRIGATION_MM[irrigationLevel] ?? 0;
  // Without the two earlier months (first sowing months of the record) use the average stored share.
  const storedUsed = stored ?? PRE_SEASON_RAIN_SHARE * 2 * (rain / crop.months) * 0.5;
  const supply = effectiveRain + storedUsed + irrigation;
  const coverage = supply / need;
  const waterFit = clamp(supply / (need * FULL_WATER_COVERAGE));
  const fit = Math.sqrt(tempFit * waterFit);

  const wetValues = window.map((m) => m.wet).filter((v) => v !== null);
  const wetness = wetValues.length ? mean(wetValues) : null;
  const wetNormals = window.map((m) => series.wetNormal[m.month - 1]).filter((v) => v !== null);
  const wetnessNormal = wetNormals.length ? mean(wetNormals) : null;

  const hotMonths = window.filter((m) => m.temp > crop.tempOpt[1] + 2).length;
  // For a winter-hardy crop only months colder than it can survive count as cold damage; dormancy is normal.
  const coldLimit = crop.dormantMin !== undefined ? crop.dormantMin : crop.tempOpt[0] - 2;
  const coldMonths = window.filter((m) => m.temp < coldLimit).length;
  const rating = fit >= FAVOURABLE ? 2 : fit >= UNFAVOURABLE ? 1 : 0;
  const causes = [];
  if (waterFit < 0.7) causes.push(`rain and stored water covered only ${Math.round(clamp(coverage, 0, 9) * 100)}% of the ~${Math.round(need)} mm need`);
  if (tempFit < 0.7) causes.push(hotMonths >= coldMonths ? `${hotMonths || "several"} month(s) hotter than comfortable` : `${coldMonths} month(s) colder than comfortable`);

  const last = window[window.length - 1];
  const extremes = seasonExtremes(series.daily, crop, sowMonth, year);
  if (extremes && extremes.hotDays >= 5) causes.push(`${extremes.hotDays} days at or above ${extremes.heatThreshold}°C`);
  if (extremes?.longDrySpell) causes.push(`a dry spell of ${extremes.longestDrySpell} days during the rainy season`);
  return {
    extremes,
    year,
    sowMonth,
    label: `${MONTHS[sowMonth]} ${year} – ${MONTHS[last.month - 1]} ${last.year}`,
    tempFit, waterFit, fit, rating,
    rating_label: RATINGS[rating],
    rainMm: rain,
    supplyMm: supply,
    needMm: need,
    coverage,
    tempMean: mean(window.map((m) => m.temp)),
    wetness,
    wetnessNormal,
    wetnessAnomaly: wetness !== null && wetnessNormal !== null ? wetness - wetnessNormal : null,
    hotMonths,
    coldMonths,
    limiter: causes.length ? (waterFit <= tempFit ? "water" : hotMonths >= coldMonths ? "heat" : "cold") : null,
    causes,
  };
}

// Replays every crop of a rotation over all years. `schedule` comes from
// evaluateRotation(): [{ cropId, sowIndex }].
export function replayRotation(schedule, series, irrigationLevel) {
  const crops = [];
  const seen = new Set();
  for (const slot of schedule) {
    if (slot.sowIndex === null || slot.sowIndex === undefined) continue;
    const key = `${slot.cropId}:${slot.sowIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const crop = CROP_BY_ID[slot.cropId];
    const seasons = [];
    for (let year = series.startYear; year <= series.endYear; year += 1) {
      const outcome = seasonOutcome(crop, slot.sowIndex, year, series, irrigationLevel);
      if (outcome) seasons.push(outcome);
    }
    crops.push({ cropId: crop.id, name: crop.name, sowMonth: slot.sowIndex, seasons });
  }
  const all = crops.flatMap((c) => c.seasons);
  const unfavourable = all.filter((s) => s.rating === 0);
  const byYear = new Map();
  for (const crop of crops) for (const s of crop.seasons) {
    if (!byYear.has(s.year)) byYear.set(s.year, []);
    byYear.get(s.year).push({ crop: crop.name, ...s });
  }
  const badYears = [...byYear.entries()]
    .filter(([, list]) => list.filter((s) => s.rating === 0).length >= Math.max(1, Math.ceil(crops.length / 2)))
    .map(([year]) => year)
    .sort();
  const perCrop = crops.map((c) => ({
    cropId: c.cropId, name: c.name,
    meanFit: mean(c.seasons.map((s) => s.fit)),
    unfavourableShare: c.seasons.length ? c.seasons.filter((s) => s.rating === 0).length / c.seasons.length : null,
    favourableShare: c.seasons.length ? c.seasons.filter((s) => s.rating === 2).length / c.seasons.length : null,
    seasons: c.seasons.length,
  }));
  const worst = [...perCrop].sort((a, b) => (b.unfavourableShare ?? 0) - (a.unfavourableShare ?? 0))[0] || null;
  const fits = all.map((s) => s.fit).sort((a, b) => a - b);
  return {
    crops,
    summary: {
      seasonsAnalysed: all.length,
      meanFit: mean(all.map((s) => s.fit)),
      worstDecileFit: fits.length ? fits[Math.floor(fits.length * 0.1)] : null,
      unfavourableShare: all.length ? unfavourable.length / all.length : null,
      favourableShare: all.length ? all.filter((s) => s.rating === 2).length / all.length : null,
      notFavourableShare: all.length ? all.filter((s) => s.rating < 2).length / all.length : null,
      badYears,
      worstCrop: worst && worst.unfavourableShare > 0 ? worst : null,
      perCrop,
    },
  };
}

// Annual rainfall / temperature with a linear trend (per decade), complete years only.
export function climateTrends(series) {
  const years = [];
  for (let year = series.startYear; year <= series.endYear; year += 1) {
    const rows = series.months.filter((m) => m.year === year);
    if (rows.length !== 12 || rows.some((m) => m.temp === null || m.rain === null)) continue;
    years.push({ year, rain: rows.reduce((s, m) => s + m.rain, 0), temp: mean(rows.map((m) => m.temp)) });
  }
  const slope = (key) => {
    if (years.length < 8) return null;
    const mx = mean(years.map((y) => y.year));
    const my = mean(years.map((y) => y[key]));
    const num = years.reduce((s, y) => s + (y.year - mx) * (y[key] - my), 0);
    const den = years.reduce((s, y) => s + (y.year - mx) ** 2, 0);
    return den ? (num / den) * 10 : null;
  };
  return { years, rainPerDecade: slope("rain"), tempPerDecade: slope("temp"), meanRain: mean(years.map((y) => y.rain)), meanTemp: mean(years.map((y) => y.temp)) };
}

// Unfavourable-season share and mean fit for every rotation under every scenario.
export function scenarioMatrix(rotations, series, irrigationLevel, presets = SCENARIO_PRESETS) {
  return rotations.map((rotation) => ({
    label: rotation.label,
    cells: presets.map((preset) => {
      const replay = replayRotation(rotation.schedule, applyScenario(series, preset), irrigationLevel);
      return { key: preset.key, meanFit: replay.summary.meanFit, unfavourableShare: replay.summary.unfavourableShare, notFavourableShare: replay.summary.notFavourableShare, badYears: replay.summary.badYears.length };
    }),
  }));
}
