// Soil-moisture and water-stress analysis built on NASA POWER (MERRA-2 based)
// daily and monthly point data. No credentials are required.
//
// Important: the soil wetness values here (GWETTOP / GWETROOT) are MERRA-2
// model estimates distributed by NASA POWER. They are not SMAP retrievals and
// not field measurements. SMAP and IMERG are shown as NASA GIBS map layers.

import { aridityClass, monthlyEt0PerDay, spiClass, standardizedIndex } from "../climate/hydro.js";

export const POWER_DAILY = "https://power.larc.nasa.gov/api/temporal/daily/point";
export const POWER_MONTHLY = "https://power.larc.nasa.gov/api/temporal/monthly/point";
export const BASELINE_START_YEAR = 2001;
export const POWER_LAG_DAYS = 2;

const DAILY_PARAMETERS = ["GWETROOT", "GWETTOP", "PRECTOTCORR", "T2M_MAX", "T2M_MIN"];
const MIN_NORMAL_RAIN_MM = 5; // below this the rainfall ratio is too unstable to use
const DRY_DAY_MM = 1;
const MIN_BASELINE_YEARS = 10;

const isValid = (value) => Number.isFinite(value) && value > -900;
const pad = (value) => String(value).padStart(2, "0");
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const toPowerDate = (date) => date.toISOString().slice(0, 10).replaceAll("-", "");
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

function stdDev(values) {
  if (values.length < 3) return null;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1));
}

async function fetchPower(url, params, timeoutMs) {
  const response = await fetch(`${url}?${new URLSearchParams(params)}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 21600 },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`NASA POWER could not complete the request (HTTP ${response.status}).`);
  const payload = await response.json();
  const parameter = payload?.properties?.parameter;
  if (!parameter) throw new Error("NASA POWER returned an unexpected response.");
  return { parameter, payload };
}

export function getWindow(months, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - POWER_LAG_DAYS);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (months - 1), 1));
  return { start, end };
}

// Monthly means from daily records. Only months with enough valid days count.
function aggregateMonths(dailyRecords) {
  const groups = new Map();
  for (const d of dailyRecords) {
    const key = d.date.slice(0, 6);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  const aggregates = new Map();
  for (const [key, days] of groups) {
    const year = Number(key.slice(0, 4));
    const month = Number(key.slice(4, 6));
    const rainDays = days.filter((d) => d.rain !== null);
    if (rainDays.length < daysInMonth(year, month) - 3) continue; // skip incomplete months
    aggregates.set(key, {
      year, month,
      rainPerDay: mean(rainDays.map((d) => d.rain)),
      tmax: mean(days.filter((d) => d.tmax !== null).map((d) => d.tmax)),
      tmin: mean(days.filter((d) => d.tmin !== null).map((d) => d.tmin)),
      root: mean(days.filter((d) => d.root !== null).map((d) => d.root)),
      top: mean(days.filter((d) => d.top !== null).map((d) => d.top)),
    });
  }
  return aggregates;
}

// Calendar-month climatology (2001 to last complete year) from the daily record.
// Also keeps every baseline month's rain total (for SPI) and ET0 (Hargreaves-Samani).
function buildClimatology(aggregates, lastYear, latitude) {
  const climatology = [];
  const rainTotals = new Map(); // "YYYYMM" -> mm for the whole month
  const annualRain = [];
  const annualEt0 = [];
  for (let month = 1; month <= 12; month += 1) {
    const rain = [];
    const rainTotal = [];
    const wetRoot = [];
    const wetTop = [];
    const tmax = [];
    const et0 = [];
    for (let year = BASELINE_START_YEAR; year <= lastYear; year += 1) {
      const key = `${year}${pad(month)}`;
      const a = aggregates.get(key);
      if (!a) continue;
      if (isValid(a.rainPerDay)) { rain.push(a.rainPerDay); rainTotal.push(a.rainPerDay * daysInMonth(year, month)); rainTotals.set(key, a.rainPerDay * daysInMonth(year, month)); }
      if (a.root !== null) wetRoot.push(a.root);
      if (a.top !== null) wetTop.push(a.top);
      if (a.tmax !== null) tmax.push(a.tmax);
      if (a.tmax !== null && a.tmin !== null) {
        const e = monthlyEt0PerDay(a.tmax, a.tmin, latitude, year, month);
        if (e !== null) et0.push(e);
      }
    }
    climatology.push({
      month,
      years: Math.min(rain.length, wetRoot.length),
      rainMmPerDay: mean(rain),
      rainSamples: rain,
      rainTotalSamples: rainTotal,
      et0MmPerDay: mean(et0),
      rootWetnessMean: mean(wetRoot),
      rootWetnessSd: stdDev(wetRoot),
      topWetnessMean: mean(wetTop),
      tmaxMean: mean(tmax),
      tmaxSd: stdDev(tmax),
    });
    if (mean(rainTotal) !== null) annualRain.push(mean(rainTotal));
    if (mean(et0) !== null) annualEt0.push(mean(et0) * daysInMonth(2001, month));
  }
  const rainYear = annualRain.length === 12 ? annualRain.reduce((a, b) => a + b, 0) : null;
  const et0Year = annualEt0.length === 12 ? annualEt0.reduce((a, b) => a + b, 0) : null;
  return { climatology, rainTotals, annualRainMm: rainYear, annualEt0Mm: et0Year, aridityIndex: rainYear !== null && et0Year ? rainYear / et0Year : null };
}

function percentileOf(value, samples) {
  if (!samples.length) return null;
  const below = samples.filter((sample) => sample < value).length;
  const equal = samples.filter((sample) => sample === value).length;
  return ((below + equal / 2) / samples.length) * 100;
}

function previousKey(key, back) {
  let year = Number(key.slice(0, 4));
  let month = Number(key.slice(4, 6)) - back;
  while (month < 1) { month += 12; year -= 1; }
  return `${year}${pad(month)}`;
}

// Baseline totals of the three months ending in calendar month m, one per year.
function baselineThreeMonthSums(rainTotals, month, lastYear) {
  const sums = [];
  for (let year = BASELINE_START_YEAR; year <= lastYear; year += 1) {
    const end = `${year}${pad(month)}`;
    const keys = [end, previousKey(end, 1), previousKey(end, 2)];
    if (keys.every((k) => rainTotals.has(k))) sums.push(keys.reduce((total, k) => total + rainTotals.get(k), 0));
  }
  return sums;
}

export const STRESS_LEVELS = ["Normal", "Watch", "Moderate", "Severe"];

function classify(score) {
  if (score >= 4) return 3;
  if (score >= 2) return 2;
  if (score >= 1) return 1;
  return 0;
}

function buildMonths(daily, climatology, { latitude, rainTotals, lastBaselineYear }) {
  const buckets = new Map();
  for (const day of daily) {
    const key = day.date.slice(0, 6);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(day);
  }

  // Whole-month rain equivalents (partial months are prorated) for SPI-3.
  const monthTotals = new Map();
  for (const [key, days] of buckets) {
    const rainDays = days.filter((d) => d.rain !== null);
    if (rainDays.length >= 10) {
      const year = Number(key.slice(0, 4));
      const month = Number(key.slice(4, 6));
      monthTotals.set(key, (rainDays.reduce((s, d) => s + d.rain, 0) / rainDays.length) * daysInMonth(year, month));
    }
  }

  return [...buckets.entries()].map(([key, days]) => {
    const year = Number(key.slice(0, 4));
    const month = Number(key.slice(4, 6));
    const clim = climatology[month - 1];
    const rainDays = days.filter((d) => d.rain !== null);
    const rain = rainDays.length ? rainDays.reduce((s, d) => s + d.rain, 0) : null;
    const observedDays = rainDays.length;
    const normalRain = clim.rainMmPerDay !== null && observedDays ? clim.rainMmPerDay * observedDays : null;
    const rainRatio = rain !== null && normalRain !== null && normalRain >= MIN_NORMAL_RAIN_MM ? rain / normalRain : null;
    const rootWetness = mean(days.filter((d) => d.root !== null).map((d) => d.root));
    const topWetness = mean(days.filter((d) => d.top !== null).map((d) => d.top));
    const tmax = mean(days.filter((d) => d.tmax !== null).map((d) => d.tmax));
    const tmin = mean(days.filter((d) => d.tmin !== null).map((d) => d.tmin));
    const rainPercentile = rain !== null && observedDays ? percentileOf(rain / observedDays, clim.rainSamples) : null;
    const enough = clim.years >= MIN_BASELINE_YEARS;

    // Evaporative demand (Hargreaves-Samani ET0) and the climatic water balance.
    const et0PerDay = tmax !== null && tmin !== null ? monthlyEt0PerDay(tmax, tmin, latitude, year, month) : null;
    const et0 = et0PerDay !== null && observedDays ? et0PerDay * observedDays : null;
    const normalEt0 = clim.et0MmPerDay !== null && observedDays ? clim.et0MmPerDay * observedDays : null;
    const et0Ratio = et0 !== null && normalEt0 ? et0 / normalEt0 : null;
    const waterBalance = rain !== null && et0 !== null ? rain - et0 : null;
    const normalWaterBalance = normalRain !== null && normalEt0 !== null ? normalRain - normalEt0 : null;

    // Standardized rainfall index over one and three months (SPI-style, empirical).
    const spi1 = rain !== null && observedDays >= 10 && enough ? standardizedIndex((rain / observedDays) * daysInMonth(year, month), clim.rainTotalSamples) : null;
    const keys3 = [key, previousKey(key, 1), previousKey(key, 2)];
    const spi3 = enough && keys3.every((k) => monthTotals.has(k))
      ? standardizedIndex(keys3.reduce((total, k) => total + monthTotals.get(k), 0), baselineThreeMonthSums(rainTotals, month, lastBaselineYear))
      : null;

    const soilZ = enough && rootWetness !== null && clim.rootWetnessMean !== null
      ? (rootWetness - clim.rootWetnessMean) / Math.max(clim.rootWetnessSd ?? 0, 0.02)
      : null;
    const tmaxAnomaly = tmax !== null && clim.tmaxMean !== null ? tmax - clim.tmaxMean : null;

    let score = 0;
    const reasons = [];
    if (soilZ !== null) {
      if (soilZ <= -1.5) { score += 2; reasons.push("root-zone wetness is far below its usual level for this month"); }
      else if (soilZ <= -1) { score += 1; reasons.push("root-zone wetness is below its usual level for this month"); }
    }
    // Rainfall points come from whichever of the ratio and the 3-month index is more severe, so one dry spell is not counted twice.
    let ratioPoints = 0;
    let ratioReason = null;
    if (rainRatio !== null && enough) {
      if (rainRatio < 0.5) { ratioPoints = 2; ratioReason = `rainfall was only ${Math.round(rainRatio * 100)}% of normal`; }
      else if (rainRatio < 0.75) { ratioPoints = 1; ratioReason = `rainfall was ${Math.round(rainRatio * 100)}% of normal`; }
    }
    let spiPoints = 0;
    let spiReason = null;
    if (spi3 !== null) {
      if (spi3 <= -1.5) { spiPoints = 2; spiReason = `the last three months were ${spiClass(spi3).label.toLowerCase()} for rainfall (index ${spi3.toFixed(1)})`; }
      else if (spi3 <= -1) { spiPoints = 1; spiReason = `the last three months were drier than usual (index ${spi3.toFixed(1)})`; }
    }
    score += Math.max(ratioPoints, spiPoints);
    if (spiReason && spiPoints >= ratioPoints) reasons.push(spiReason);
    if (ratioReason && ratioPoints >= 1) reasons.push(ratioReason);
    if (rootWetness !== null && rootWetness < 0.25) { score += 1; reasons.push("root-zone wetness is low in absolute terms"); }
    // Heat and a thirstier atmosphere both compound dryness; count them once.
    const compounding = [];
    if (tmaxAnomaly !== null && tmaxAnomaly >= 2) compounding.push(`daytime temperatures ran ${tmaxAnomaly.toFixed(1)}°C above normal`);
    if (et0Ratio !== null && et0Ratio >= 1.1) compounding.push(`evaporative demand was ${Math.round((et0Ratio - 1) * 100)}% above normal`);
    if (score >= 1 && compounding.length) { score += 1; reasons.push(compounding.join(" and ")); }

    return {
      month: `${year}-${pad(month)}`,
      observedDays,
      daysInMonth: daysInMonth(year, month),
      partial: observedDays < daysInMonth(year, month),
      rainMm: rain,
      normalRainMm: normalRain,
      rainRatio,
      rainPercentile,
      et0Mm: et0,
      normalEt0Mm: normalEt0,
      et0Ratio,
      waterBalanceMm: waterBalance,
      normalWaterBalanceMm: normalWaterBalance,
      spi1,
      spi3,
      spiLabel: spi3 !== null ? spiClass(spi3).label : null,
      rootWetness,
      rootWetnessNormal: clim.rootWetnessMean,
      rootWetnessZ: soilZ,
      topWetness,
      topWetnessNormal: clim.topWetnessMean,
      tmax,
      tmaxAnomaly,
      stressScore: score,
      stressLevel: classify(score),
      stressLabel: STRESS_LEVELS[classify(score)],
      reasons,
      baselineYears: clim.years,
    };
  });
}

// Weekly root-zone wetness, then runs of consecutive weekly declines.
function findDecliningPeriods(daily) {
  const weeks = [];
  for (let i = 0; i < daily.length; i += 7) {
    const chunk = daily.slice(i, i + 7);
    const values = chunk.filter((d) => d.root !== null).map((d) => d.root);
    if (values.length < 4) { weeks.push(null); continue; }
    weeks.push({
      start: chunk[0].date,
      end: chunk[chunk.length - 1].date,
      root: mean(values),
      rain: chunk.reduce((s, d) => s + (d.rain ?? 0), 0),
    });
  }

  const periods = [];
  let run = null;
  const close = () => {
    if (run && run.declines >= 3 && run.startValue - run.endValue >= 0.06) {
      periods.push({
        startDate: run.startDate,
        endDate: run.endDate,
        weeks: run.declines,
        startWetness: run.startValue,
        endWetness: run.endValue,
        drop: run.startValue - run.endValue,
        rainMm: run.rain,
      });
    }
    run = null;
  };
  for (let i = 1; i < weeks.length; i += 1) {
    const prev = weeks[i - 1];
    const curr = weeks[i];
    if (!prev || !curr) { close(); continue; }
    if (curr.root - prev.root <= -0.005) {
      if (!run) run = { startDate: prev.start, startValue: prev.root, declines: 0, rain: 0 };
      run.declines += 1;
      run.endDate = curr.end;
      run.endValue = curr.root;
      run.rain += curr.rain;
    } else close();
  }
  close();
  return periods;
}

function dryStats(daily) {
  let longest = { days: 0, startDate: null, endDate: null };
  let run = 0;
  let runStart = null;
  for (const day of daily) {
    if (day.rain !== null && day.rain < DRY_DAY_MM) {
      if (!run) runStart = day.date;
      run += 1;
      if (run > longest.days) longest = { days: run, startDate: runStart, endDate: day.date };
    } else run = 0;
  }
  let current = 0;
  for (let i = daily.length - 1; i >= 0; i -= 1) {
    if (daily[i].rain === null) continue;
    if (daily[i].rain < DRY_DAY_MM) current += 1; else break;
  }
  return { longest, currentDrySpellDays: current };
}

function last30(daily, climatology) {
  const recent = daily.filter((d) => d.rain !== null).slice(-30);
  if (recent.length < 20) return null;
  const rain = recent.reduce((s, d) => s + d.rain, 0);
  const normal = recent.reduce((s, d) => s + (climatology[Number(d.date.slice(4, 6)) - 1].rainMmPerDay ?? 0), 0);
  return {
    days: recent.length,
    startDate: recent[0].date,
    endDate: recent[recent.length - 1].date,
    rainMm: rain,
    normalRainMm: normal,
    rainRatio: normal >= MIN_NORMAL_RAIN_MM ? rain / normal : null,
  };
}

export async function analyzeWaterStress({ latitude, longitude, months }) {
  const { start, end } = getWindow(months);
  const lastBaselineYear = new Date().getUTCFullYear() - 1;
  const common = { community: "AG", longitude: longitude.toFixed(4), latitude: latitude.toFixed(4), format: "JSON" };

  // One daily request covers both the 2001-onward baseline and the analysis window, so
  // normals and observations are built the same way (POWER's monthly Tmax/Tmin are
  // absolute extremes and would not be comparable).
  const dailyResult = await fetchPower(POWER_DAILY, { ...common, parameters: DAILY_PARAMETERS.join(","), start: `${BASELINE_START_YEAR}0101`, end: toPowerDate(end), "time-standard": "UTC" }, 55000);

  const p = dailyResult.parameter;
  const dates = Object.keys(p.PRECTOTCORR || {}).sort();
  const read = (name, date) => (isValid(p[name]?.[date]) ? p[name][date] : null);
  const dailyEvery = dates.map((date) => ({
    date,
    root: read("GWETROOT", date),
    top: read("GWETTOP", date),
    rain: read("PRECTOTCORR", date),
    tmax: read("T2M_MAX", date),
    tmin: read("T2M_MIN", date),
  })).filter((d) => d.root !== null || d.rain !== null);
  const windowStart = toPowerDate(start);
  // Two lead months before the window feed the three-month rainfall index.
  const leadStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 2, 1));
  const dailyAll = dailyEvery.filter((d) => d.date >= toPowerDate(leadStart));
  const daily = dailyEvery.filter((d) => d.date >= windowStart);

  if (!daily.length) {
    const error = new Error("NASA POWER returned no valid soil-moisture or rainfall values for this location.");
    error.status = 404;
    throw error;
  }

  const baseline = buildClimatology(aggregateMonths(dailyEvery), lastBaselineYear, latitude);
  const climatology = baseline.climatology;
  if (Math.max(...climatology.map((c) => c.years)) < MIN_BASELINE_YEARS) {
    const error = new Error("NASA POWER returned too little history to build a seasonal baseline for this location.");
    error.status = 502;
    throw error;
  }

  const windowKey = windowStart.slice(0, 6);
  const monthly = buildMonths(dailyAll, climatology, { latitude, rainTotals: baseline.rainTotals, lastBaselineYear }).filter((m) => m.month.replace("-", "") >= windowKey);
  const decliningPeriods = findDecliningPeriods(daily);
  const dry = dryStats(daily);
  const recent = last30(daily, climatology);
  const stressMonths = monthly.filter((m) => m.stressLevel >= 2);
  const latest = monthly[monthly.length - 1];
  const sources = dailyResult.payload?.header?.sources || ["MERRA2"];

  return {
    source: {
      name: "NASA POWER Daily and Monthly Point APIs (MERRA-2 based)",
      parameters: {
        GWETROOT: "Root-zone soil wetness (fraction 0–1)",
        GWETTOP: "Surface soil wetness (fraction 0–1)",
        PRECTOTCORR: "Precipitation, corrected (mm/day)",
        T2M_MAX: "Daily maximum temperature at 2 m (°C)",
        T2M_MIN: "Daily minimum temperature at 2 m (°C)",
      },
      derived: {
        ET0: "Reference evapotranspiration, Hargreaves-Samani (FAO-56) from daily temperature range and latitude",
        SPI3: "Three-month standardized rainfall index (SPI-style, empirical ranking against 2001 onward)",
        waterBalance: "Rainfall minus ET0",
        aridityIndex: "UNEP aridity index: annual rainfall / annual ET0",
      },
      sources,
      gridNote: "POWER values are gridded estimates for the cell containing the field centre, not measurements on the farm.",
    },
    location: { latitude, longitude },
    period: { start: toPowerDate(start), end: toPowerDate(end), months },
    baseline: {
      startYear: BASELINE_START_YEAR,
      endYear: lastBaselineYear,
      yearsUsed: Math.max(...climatology.map((c) => c.years)),
      annualRainMm: baseline.annualRainMm,
      annualEt0Mm: baseline.annualEt0Mm,
      aridityIndex: baseline.aridityIndex,
      aridityClass: aridityClass(baseline.aridityIndex),
      note: "Seasonal normals are the average of the same calendar month across all complete baseline years. The baseline includes the analysis period's earlier years, which has a small effect over 20+ years.",
    },
    summary: {
      latestMonth: latest?.month || null,
      latestLevel: latest?.stressLevel ?? null,
      latestLabel: latest?.stressLabel ?? null,
      latestReasons: latest?.reasons || [],
      latestSpi3: latest?.spi3 ?? null,
      latestSpiLabel: latest?.spiLabel ?? null,
      latestWaterBalanceMm: latest?.waterBalanceMm ?? null,
      deficitMonths: monthly.filter((m) => m.waterBalanceMm !== null && m.normalWaterBalanceMm !== null && m.waterBalanceMm < m.normalWaterBalanceMm - 20).length,
      stressMonthCount: stressMonths.length,
      totalMonths: monthly.length,
      decliningPeriodCount: decliningPeriods.length,
      latestRootWetness: [...daily].reverse().find((d) => d.root !== null)?.root ?? null,
      latestRootWetnessDate: [...daily].reverse().find((d) => d.root !== null)?.date ?? null,
      last30: recent,
      currentDrySpellDays: dry.currentDrySpellDays,
      longestDrySpell: dry.longest,
    },
    monthly,
    decliningPeriods,
    daily: daily.map((d) => ({ date: d.date, root: d.root, top: d.top, rain: d.rain })),
    caveats: [
      "Soil wetness here is a MERRA-2 model estimate distributed through NASA POWER. It is not a SMAP retrieval and not a measurement taken in your field. SMAP and IMERG layers on the map are shown for visual context.",
      "Water-stress levels are a screening indicator built from rainfall, root-zone wetness and temperature compared with this location's own history. They are not an official drought declaration and do not consider irrigation, soil type, crop or growth stage.",
      "POWER cells are roughly 50 km wide, so local rainfall and soil differences inside the cell are not captured. Compare with rain gauges and field observations where possible.",
      "ET0 is a temperature-based (Hargreaves-Samani) estimate. It is less accurate than Penman-Monteith in very humid or windy places, and the water balance (rain minus ET0) ignores runoff, irrigation and soil storage. The standardized rainfall index ranks each period against 2001 onward rather than fitting the official gamma distribution.",
      "Rainfall ratios are only computed where the normal rainfall for the observed days is at least 5 mm. In very dry seasons the ratio is left blank rather than exaggerated.",
      "Recent days can be missing because POWER publishes near-real-time data with a lag of about two days.",
    ],
    generatedAt: new Date().toISOString(),
  };
}
