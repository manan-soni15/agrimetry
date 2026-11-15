// Crop Rotation Intelligence Engine: multi-criteria, explainable, pure functions.
//
// It ranks crop sequences against local climate, soil, nitrogen balance, sequence
// compatibility, erosion protection, organic matter, water use, market and
// equipment, then explains each score. It does not predict yield or profit.
// Crop values are approximate (see crops.js) and need local validation.

import { CROPS, CROP_BY_ID } from "./crops.js";

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DEFAULT_PRIORITIES = { water: 3, soilHealth: 3, market: 3, forage: 2, equipment: 3 };
export const IRRIGATION_MM = { rainfed: 0, limited: 200, good: 600 };
export const MIN_CLIMATE_FIT = 0.35;
export const MIN_TEMP_FIT = 0.6;
export const RAIN_EFFICIENCY = 0.8; // share of in-season rain that is useful to the crop
export const PRE_SEASON_RAIN_SHARE = 0.3; // share of the previous two months' rain stored in the soil
export const FULL_WATER_COVERAGE = 0.85;
export const MAX_NON_CASH_CROPS = 1; // green-manure / cover crops per rotation cycle
export const CRITERIA = [
  { key: "climate", label: "Climate & water fit" },
  { key: "soil", label: "Soil compatibility" },
  { key: "nitrogen", label: "Nitrogen balance" },
  { key: "sequence", label: "Sequence compatibility" },
  { key: "erosion", label: "Erosion protection" },
  { key: "organicMatter", label: "Organic matter" },
  { key: "waterSaving", label: "Water saving" },
  { key: "market", label: "Market fit" },
  { key: "forage", label: "Forage potential" },
  { key: "equipment", label: "Equipment fit" },
];
const BASE_WEIGHTS = { climate: 22, soil: 14, nitrogen: 14, sequence: 14, erosion: 8, organicMatter: 8, waterSaving: 6, market: 8, forage: 3, equipment: 5 };
const NEUTRAL = 0.6; // score used when a criterion cannot be assessed (and flagged as missing)

const clamp = (value, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, value));
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const mid = (range) => (range[0] + range[1]) / 2;
const monthLabel = (index) => MONTH_NAMES[((index % 12) + 12) % 12];

// ---------------------------------------------------------------- climate

// monthly: { T2M: {YYYYMM: C}, T2M_MAX: {...}, PRECTOTCORR: {YYYYMM: mm/day} } from POWER.
export function buildClimate(monthly, startYear, endYear) {
  const days = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
  const months = [];
  for (let m = 1; m <= 12; m += 1) {
    const temps = [];
    const rain = [];
    for (let year = startYear; year <= endYear; year += 1) {
      const key = `${year}${String(m).padStart(2, "0")}`;
      const t = monthly?.T2M?.[key];
      const r = monthly?.PRECTOTCORR?.[key];
      if (Number.isFinite(t) && t > -900) temps.push(t);
      if (Number.isFinite(r) && r > -900) rain.push(r * days(year, m));
    }
    months.push({ index: m - 1, tempMean: mean(temps), rainMm: mean(rain), years: temps.length });
  }
  if (months.some((m) => m.years < 5)) return null;
  // Warmest six consecutive months define the "warm season"; the rest is the "cool season".
  let warmStart = 0;
  let best = -Infinity;
  for (let s = 0; s < 12; s += 1) {
    const total = mean(Array.from({ length: 6 }, (_, k) => months[(s + k) % 12].tempMean));
    if (total > best) { best = total; warmStart = s; }
  }
  const coldestMonth = Math.min(...months.map((m) => m.tempMean));
  return { months, warmStart, startYear, endYear, annualRainMm: months.reduce((s, m) => s + m.rainMm, 0), coldestMonth, coldWinter: coldestMonth < 0 };
}

export function monthTempScore(temp, crop) {
  const [oLo, oHi] = crop.tempOpt;
  const [tLo, tHi] = crop.tempTol;
  if (temp >= oLo && temp <= oHi) return 1;
  if (temp < tLo || temp > tHi) return 0;
  if (temp < oLo) return 0.2 + 0.8 * ((temp - tLo) / (oLo - tLo));
  return 0.2 + 0.8 * ((tHi - temp) / (tHi - oHi));
}

const VERNALISATION_MAX = 10; // a winter crop needs at least one month this cold (rough vernalisation proxy), °C
const DORMANCY_SCORE = 0.8; // a hardy crop that is alive but not growing
const DORMANT_RAIN_EFFICIENCY = 0.5; // winter rain and snowmelt help less than growing-season rain

// Temperature fit over a season. Most crops are scored month by month. Winter-hardy crops
// (dormantMin set) are dormant below their growth threshold: they fail only if a month is
// colder than they can survive or too little of the season is warm enough to grow.
export function seasonTemperatureFit(crop, temps) {
  if (crop.dormantMin === undefined) {
    const scores = temps.map((t) => monthTempScore(t, crop));
    return 0.6 * mean(scores) + 0.4 * Math.min(...scores);
  }
  const growth = temps.filter((t) => t >= crop.tempTol[0]);
  const dormant = temps.filter((t) => t < crop.tempTol[0]);
  if (dormant.some((t) => t < crop.dormantMin)) return 0; // would not survive the winter
  if (Math.min(...temps) > VERNALISATION_MAX) return 0.1; // no cold spell, so a winter crop would not mature
  if (growth.length < Math.max(3, Math.ceil(crop.months * 0.4))) return 0.1; // too little growing time
  const growthScores = growth.map((t) => monthTempScore(t, crop));
  const all = [...growthScores, ...dormant.map(() => DORMANCY_SCORE)];
  return 0.6 * mean(all) + 0.4 * Math.min(...growthScores);
}

// Usable rain over a season: dormant months of a winter-hardy crop count at a lower efficiency.
export function effectiveSeasonRain(crop, months) {
  return months.reduce((sum, m) => {
    const dormant = crop.dormantMin !== undefined && m.temp < crop.tempTol[0];
    return sum + m.rain * (dormant ? DORMANT_RAIN_EFFICIENCY : RAIN_EFFICIENCY);
  }, 0);
}

function fitAt(crop, start, ctx) {
  const window = Array.from({ length: crop.months }, (_, k) => ctx.climate.months[(start + k) % 12]);
  const tempFit = seasonTemperatureFit(crop, window.map((m) => m.tempMean));
  const rain = window.reduce((s, m) => s + m.rainMm, 0);
  const irrigation = crop.needs.includes("irrigation") ? Math.max(IRRIGATION_MM[ctx.irrigation], 0) : IRRIGATION_MM[ctx.irrigation];
  const need = mid(crop.waterMm);
  // Soil stores some of the rain that falls just before sowing, so count a share of it.
  const before = [1, 2].map((k) => ctx.climate.months[(start - k + 12) % 12].rainMm);
  const stored = PRE_SEASON_RAIN_SHARE * (before[0] + before[1]);
  const supplied = effectiveSeasonRain(crop, window.map((m) => ({ temp: m.tempMean, rain: m.rainMm }))) + stored + irrigation;
  // Crops rarely need 100% of potential water use to do well, so 85% coverage counts as a full score.
  const waterFit = clamp(supplied / (need * FULL_WATER_COVERAGE));
  return {
    start,
    end: (start + crop.months - 1) % 12,
    tempFit,
    waterFit,
    fit: Math.sqrt(tempFit * waterFit),
    rainMm: rain,
    storedMm: stored,
    supplyMm: supplied,
    irrigationMm: irrigation,
    needMm: need,
    tempMean: mean(window.map((m) => m.tempMean)),
  };
}

function slotKind(index, seasonsPerYear) {
  if (seasonsPerYear === 1) return "year";
  return index % 2 === 0 ? "warm" : "cool";
}

function allowedStarts(crop, kind, ctx) {
  if (kind === "year" && crop.dormantMin !== undefined) {
    // Winter crops are sown in autumn: temperatures are falling and inside the crop's sowing range.
    const months = ctx.climate.months;
    return Array.from({ length: 12 }, (_, i) => i).filter((i) => months[(i + 1) % 12].tempMean < months[i].tempMean && months[i].tempMean >= crop.sowTemp[0] && months[i].tempMean <= crop.sowTemp[1]);
  }
  if (kind === "year") return Array.from({ length: 12 }, (_, i) => i);
  if (crop.months > 6) return [];
  const windowStart = kind === "warm" ? ctx.climate.warmStart : (ctx.climate.warmStart + 6) % 12;
  return Array.from({ length: 7 - crop.months }, (_, k) => (windowStart + k) % 12);
}

function bestFit(crop, kind, ctx) {
  const key = `fit:${crop.id}:${kind}`;
  if (ctx._cache.has(key)) return ctx._cache.get(key);
  const starts = allowedStarts(crop, kind, ctx);
  const results = starts.map((start) => fitAt(crop, start, ctx));
  // Temperature is a hard condition: water cannot make up for sowing a crop in the
  // wrong season. Only windows with an acceptable temperature fit are considered;
  // if none exists, keep the warmest-fit window so the crop is reported as unsuitable.
  const workable = results.filter((r) => r.tempFit >= MIN_TEMP_FIT);
  const pool = workable.length ? workable : results;
  let best = null;
  for (const result of pool) {
    const score = workable.length ? result.fit : result.tempFit;
    if (!best || score > best.score) best = { score, result };
  }
  best = best ? best.result : null;
  ctx._cache.set(key, best);
  return best;
}

// ---------------------------------------------------------------- soil

export function soilForEngine(profile) {
  if (!profile) return null;
  const texture = profile.texture;
  const light = ["Sand", "Loamy sand", "Sandy loam"];
  const heavy = ["Clay", "Silty clay", "Sandy clay", "Clay loam", "Silty clay loam"];
  const textureGroup = !texture ? null : light.includes(texture) ? "light" : heavy.includes(texture) ? "heavy" : "medium";
  const ph = profile.effective?.phh2o;
  const soc = profile.effective?.soc;
  const out = {
    ph: Number.isFinite(ph) ? ph : null,
    texture: texture || null,
    textureGroup,
    bdodLevel: profile.ratings?.bulkDensity?.level ?? null,
    socGkg: Number.isFinite(soc) ? soc : null,
    origin: profile.origin || {},
  };
  return out.ph === null && !textureGroup && !out.bdodLevel ? null : out;
}

function soilFit(crop, soil) {
  const parts = [];
  const missing = [];
  if (soil?.ph != null) {
    const ph = soil.ph;
    const [oLo, oHi] = crop.phOpt;
    const [tLo, tHi] = crop.phTol;
    let value;
    if (ph >= oLo && ph <= oHi) value = 1;
    else if (ph >= tLo && ph <= tHi) value = ph < oLo ? 0.35 + 0.65 * ((ph - tLo) / (oLo - tLo)) : 0.35 + 0.65 * ((tHi - ph) / (tHi - oHi));
    else value = Math.max(0, 0.35 - 0.15 * (ph < tLo ? tLo - ph : ph - tHi));
    parts.push({ key: "ph", value, weight: 0.45 });
  } else missing.push("pH");
  if (soil?.textureGroup) {
    const index = { light: 0, medium: 1, heavy: 2 }[soil.textureGroup];
    parts.push({ key: "texture", value: crop.texture[index], weight: 0.4 });
  } else missing.push("texture");
  if (soil?.bdodLevel) {
    const penalty = soil.bdodLevel === "limiting" ? 0.6 : soil.bdodLevel === "watch" ? 0.25 : 0;
    parts.push({ key: "compaction", value: 1 - penalty * crop.compaction, weight: 0.15 });
  } else missing.push("bulk density");
  if (!parts.length) return { fit: null, parts, missing };
  const total = parts.reduce((s, p) => s + p.weight, 0);
  return { fit: parts.reduce((s, p) => s + p.value * p.weight, 0) / total, parts, missing };
}

// ---------------------------------------------------------------- weights

const factor = (p) => 0.4 + 0.3 * (clamp(Number(p) || 3, 1, 5) - 1);

export function buildWeights(priorities = DEFAULT_PRIORITIES) {
  const p = { ...DEFAULT_PRIORITIES, ...priorities };
  const raw = {
    climate: BASE_WEIGHTS.climate * factor(p.water),
    soil: BASE_WEIGHTS.soil,
    nitrogen: BASE_WEIGHTS.nitrogen * factor(p.soilHealth),
    sequence: BASE_WEIGHTS.sequence,
    erosion: BASE_WEIGHTS.erosion * factor(p.soilHealth),
    organicMatter: BASE_WEIGHTS.organicMatter * factor(p.soilHealth),
    waterSaving: BASE_WEIGHTS.waterSaving * factor(p.water),
    market: BASE_WEIGHTS.market * factor(p.market),
    forage: BASE_WEIGHTS.forage * factor(p.forage),
    equipment: BASE_WEIGHTS.equipment * factor(p.equipment),
  };
  const total = Object.values(raw).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, (v / total) * 100]));
}

// ---------------------------------------------------------------- scoring

function pairScore(prev, crop) {
  if (prev.id === crop.id) return { score: 0, note: `${crop.name} follows itself, which builds up pests and diseases` };
  if (prev.family === crop.family) return { score: 0.25, note: `${prev.name} and ${crop.name} are in the same plant family (${crop.family}), so shared diseases and pests can carry over` };
  let score = 0.8;
  if ((prev.group === "legume") !== (crop.group === "legume")) score = 1;
  else if (prev.group === crop.group) score = 0.6;
  return { score, note: null };
}

function nitrogenSlot(prev, crop) {
  if (crop.nFix >= 1) return 0.9;
  const afterLegume = prev.nFix >= 1;
  if (crop.nDemand === "high") return afterLegume ? 0.95 : prev.nDemand === "high" ? 0.2 : 0.45;
  if (crop.nDemand === "medium") return afterLegume ? 0.8 : 0.55;
  return 0.6;
}

function cropNames(crops) { return crops.map((c) => c.name).join(", "); }

export function evaluateRotation(cropIds, ctx, label = "Rotation") {
  const crops = cropIds.map((id) => CROP_BY_ID[id]).filter(Boolean);
  const n = crops.length;
  const years = ctx.seasonsPerYear === 1 ? n : n / 2;
  const slots = crops.map((crop, i) => {
    const kind = slotKind(i, ctx.seasonsPerYear);
    const fit = bestFit(crop, kind, ctx);
    const soil = soilFit(crop, ctx.soil);
    return { index: i, kind, crop, fit, soil };
  });
  const missing = new Set();
  const benefits = [];
  const risks = [];
  const detail = {};

  // Climate & water
  const unfit = slots.filter((s) => !s.fit || s.fit.fit < MIN_CLIMATE_FIT);
  const climate = mean(slots.map((s) => s.fit?.fit ?? 0));
  detail.climate = `${Math.round(climate * 100)}% average match between each crop's temperature and water needs and this location's climate in its best sowing window.`;
  for (const s of slots) {
    if (!s.fit) { risks.push(`${s.crop.name} needs ${s.crop.months} months, which does not fit a single ${s.kind} season here.`); continue; }
    const supply = s.fit.supplyMm;
    const coverage = supply / s.fit.needMm;
    if (s.fit.tempFit < 0.6) risks.push(`${s.crop.name}: average ${Math.round(s.fit.tempMean)}°C in ${monthLabel(s.fit.start)}–${monthLabel(s.fit.end)} is outside its comfortable range.`);
    if (coverage < 0.7) risks.push(`${s.crop.name}: usable rain and stored soil water${s.fit.irrigationMm ? " plus your irrigation" : ""} (~${Math.round(supply)} mm) cover only ${Math.round(coverage * 100)}% of its roughly ${Math.round(s.fit.needMm)} mm water need.`);
  }
  if (unfit.length === 0 && climate >= 0.7) benefits.push("Every crop is well matched to local temperature and water in its sowing window.");

  // Soil
  const soilValues = slots.map((s) => s.soil.fit);
  const knownSoil = soilValues.filter((v) => v !== null);
  const soilScore = knownSoil.length ? mean(soilValues.map((v) => (v === null ? 0.7 : v))) : NEUTRAL + 0.1;
  const missingSoil = [...new Set(slots.flatMap((s) => s.soil.missing))];
  if (missingSoil.length) missing.add(`Soil ${missingSoil.join(", ")} not available, so soil compatibility is only partly assessed. Add a soil test or run Soil health first.`);
  detail.soil = knownSoil.length ? `${Math.round(soilScore * 100)}% average match between crop pH, texture and root needs and your soil${ctx.soil?.texture ? ` (${ctx.soil.texture.toLowerCase()}${ctx.soil.ph != null ? `, pH ${ctx.soil.ph.toFixed(1)}` : ""})` : ""}.` : "No soil information was available; this criterion is neutral.";
  for (const s of slots) {
    if (s.soil.fit !== null && s.soil.fit < 0.5) risks.push(`${s.crop.name} is a weak match for your soil (${s.soil.parts.filter((p) => p.value < 0.6).map((p) => p.key).join(" / ") || "overall"}).`);
  }

  // Nitrogen
  const nitrogenScores = slots.map((s, i) => nitrogenSlot(slots[(i - 1 + n) % n].crop, s.crop));
  const legumeCount = crops.filter((c) => c.nFix >= 1).length;
  const share = legumeCount / n;
  const nitrogen = clamp(mean(nitrogenScores) + (share >= 0.25 && share <= 0.5 ? 0.05 : 0));
  detail.nitrogen = `${legumeCount} of ${n} crops fix nitrogen (${Math.round(share * 100)}%). Scored on legumes before nitrogen-hungry crops and avoiding back-to-back heavy feeders.`;
  if (legumeCount) benefits.push(`Includes ${legumeCount} nitrogen-fixing legume${legumeCount > 1 ? "s" : ""} (${cropNames(crops.filter((c) => c.nFix >= 1))}), which can reduce fertiliser nitrogen for the next crop.`);
  else risks.push("No nitrogen-fixing crop: nitrogen must come from fertiliser or manure.");
  for (let i = 0; i < n; i += 1) {
    const prev = slots[(i - 1 + n) % n].crop;
    const crop = slots[i].crop;
    if (crop.nDemand === "high" && prev.nDemand === "high" && prev.nFix === 0) risks.push(`${crop.name} follows another nitrogen-hungry crop (${prev.name}), so fertiliser need is high.`);
  }

  // Sequence compatibility
  const pairs = slots.map((s, i) => pairScore(slots[(i - 1 + n) % n].crop, s.crop));
  const families = new Set(crops.map((c) => c.family)).size;
  const sequence = 0.75 * mean(pairs.map((p) => p.score)) + 0.25 * (families / n);
  detail.sequence = `${families} plant famil${families === 1 ? "y" : "ies"} across ${n} crops; each crop is checked against the one before it (the cycle repeats).`;
  for (const p of pairs) if (p.note) risks.push(`${p.note}.`);
  if (families === n && n >= 3) benefits.push(`${families} different plant families break pest and disease cycles.`);

  // Erosion protection and organic matter
  const meanCover = mean(crops.map((c) => (c.cover - 1) / 4));
  const monthsGrown = crops.reduce((s, c) => s + c.months, 0);
  const coverage = clamp(monthsGrown / (12 * years));
  const erosion = 0.6 * meanCover + 0.4 * coverage;
  detail.erosion = `Crops give ${["very little", "little", "moderate", "good", "excellent"][Math.round(meanCover * 4)]} cover on average and a crop is in the ground about ${Math.round(coverage * 100)}% of the time.`;
  if (erosion >= 0.65) benefits.push(`Good soil cover (${Math.round(coverage * 100)}% of the year under a crop), which reduces erosion and moisture loss.`);
  if (coverage < 0.55) risks.push(`The soil is bare for roughly ${Math.round((1 - coverage) * 100)}% of the year in this sequence, raising erosion and weed risk. A cover crop in the gaps would help.`);
  const hasGreenCover = crops.some((c) => !c.cash);
  const organicMatter = clamp(mean(crops.map((c) => (c.residue - 1) / 4)) + (hasGreenCover ? 0.1 : 0));
  detail.organicMatter = `Residues average ${["very low", "low", "moderate", "high", "very high"][Math.round(mean(crops.map((c) => (c.residue - 1) / 4)) * 4)]}${hasGreenCover ? ", plus a green-manure or fodder crop" : ""}.`;
  if (organicMatter >= 0.65) benefits.push("Plenty of crop residue returned to the soil, supporting organic matter.");
  if (organicMatter < 0.4) risks.push("Little residue is returned to the soil, so organic matter may decline.");

  // Water saving
  const waterSaving = mean(crops.map((c) => 1 - clamp((mid(c.waterMm) - 300) / 900)));
  const meanNeed = mean(crops.map((c) => mid(c.waterMm)));
  detail.waterSaving = `Average crop water use is about ${Math.round(meanNeed)} mm per crop (lower is better for saving water).`;
  if (waterSaving >= 0.7) benefits.push(`Low water demand (about ${Math.round(meanNeed)} mm per crop on average).`);

  // Market
  let market;
  if (ctx.marketCrops && ctx.marketCrops.size) {
    const scores = crops.map((c) => (!c.cash ? 0.5 : ctx.marketCrops.has(c.id) ? 1 : 0.35));
    market = mean(scores);
    const outside = crops.filter((c) => c.cash && !ctx.marketCrops.has(c.id));
    detail.market = `${crops.filter((c) => c.cash && ctx.marketCrops.has(c.id)).length} of your sale crops are in this sequence.`;
    if (outside.length) risks.push(`${cropNames(outside)} ${outside.length > 1 ? "are" : "is"} not on your list of crops with a market.`);
    if (market >= 0.8) benefits.push("The cash crops match the crops you told us you can sell.");
  } else {
    market = NEUTRAL;
    detail.market = "You did not list crops you can sell, so market fit is neutral.";
    missing.add("Market demand: choose the crops you can sell locally to score market fit. No price data is used.");
  }

  // Forage
  const forage = mean(crops.map((c) => c.forage / 3));
  detail.forage = forage > 0.5 ? "Several crops double as fodder or have useful residue for livestock." : "Few crops here provide fodder.";
  if ((ctx.priorities?.forage ?? 2) >= 4 && forage < 0.4) risks.push("You rated forage as important, but this sequence offers little fodder.");
  if (forage >= 0.55) benefits.push("Good fodder / livestock-feed potential.");

  // Equipment
  let equipment;
  if (ctx.equipment) {
    const have = new Set(ctx.equipment);
    const scores = crops.map((c) => (c.needs.length ? c.needs.filter((tag) => have.has(tag) || (tag === "irrigation" && ctx.irrigation !== "rainfed")).length / c.needs.length : 1));
    equipment = mean(scores);
    detail.equipment = `${Math.round(equipment * 100)}% of the equipment these crops usually need is available.`;
    for (const c of crops) {
      const lacking = c.needs.filter((tag) => !have.has(tag) && !(tag === "irrigation" && ctx.irrigation !== "rainfed"));
      if (lacking.length) risks.push(`${c.name} usually needs: ${lacking.map((t) => ({ seedDrill: "a seed drill", rowPlanter: "a row planter", harvester: "a combine or thresher", irrigation: "irrigation" }[t])).join(", ")}, which you did not list.`);
    }
  } else {
    equipment = NEUTRAL;
    detail.equipment = "Equipment was not specified, so equipment fit is neutral.";
    missing.add("Equipment: tick the machinery you have to check each crop's practical fit.");
  }

  missing.add("Crop history and recent pest or disease problems in this field are not known.");
  missing.add("Rainfall is a long-term monthly average; dry or wet years can differ a lot (see the Water stress page).");
  if (ctx.irrigation === "rainfed") missing.add("Irrigation is assumed to be none. Choose your irrigation level if you have any.");

  const scores = { climate, soil: soilScore, nitrogen, sequence, erosion, organicMatter, waterSaving, market, forage, equipment };
  const weights = ctx.weights;
  const total = CRITERIA.reduce((sum, { key }) => sum + scores[key] * weights[key], 0);

  return {
    label,
    cropIds,
    crops: crops.map((c) => c.name),
    seasonsPerYear: ctx.seasonsPerYear,
    total,
    scores: Object.fromEntries(CRITERIA.map(({ key }) => [key, Math.round(scores[key] * 100)])),
    breakdown: CRITERIA.map(({ key, label: criterionLabel }) => ({ key, label: criterionLabel, score: Math.round(scores[key] * 100), weight: weights[key], contribution: scores[key] * weights[key], explanation: detail[key] })),
    schedule: slots.map((s) => ({
      slot: s.index + 1,
      season: s.kind === "year" ? `Year ${s.index + 1}` : `Year ${Math.floor(s.index / 2) + 1} · ${s.kind} season`,
      crop: s.crop.name,
      cropId: s.crop.id,
      sowIndex: s.fit ? s.fit.start : null,
      sow: s.fit ? monthLabel(s.fit.start) : null,
      harvest: s.fit ? monthLabel(s.fit.end) : null,
      climateFit: s.fit ? Math.round(s.fit.fit * 100) : 0,
      soilFit: s.soil.fit === null ? null : Math.round(s.soil.fit * 100),
      rainMm: s.fit ? Math.round(s.fit.rainMm) : null,
      needMm: s.fit ? Math.round(s.fit.needMm) : null,
      nitrogen: s.crop.nFix >= 1 ? "Fixes nitrogen" : s.crop.nDemand === "high" ? "Heavy nitrogen user" : s.crop.nDemand === "medium" ? "Moderate nitrogen use" : "Light nitrogen use",
    })),
    benefits: [...new Set(benefits)],
    risks: [...new Set(risks)],
    missing: [...missing],
    infeasible: unfit.map((s) => s.crop.name),
    legumeShare: share,
  };
}

// ---------------------------------------------------------------- generation

export function makeContext({ climate, seasonsPerYear = 1, irrigation = "rainfed", soil = null, marketCrops = null, equipment = null, priorities = DEFAULT_PRIORITIES }) {
  return {
    climate,
    seasonsPerYear: seasonsPerYear === 2 ? 2 : 1,
    irrigation: IRRIGATION_MM[irrigation] === undefined ? "rainfed" : irrigation,
    soil,
    marketCrops: marketCrops ? new Set(marketCrops) : null,
    equipment: Array.isArray(equipment) ? equipment : null,
    priorities: { ...DEFAULT_PRIORITIES, ...priorities },
    weights: buildWeights(priorities),
    _cache: new Map(),
  };
}

function canonicalKey(ids) {
  const rotations = ids.map((_, i) => ids.slice(i).concat(ids.slice(0, i)).join(">"));
  return rotations.sort()[0];
}

function eligibleCrops(kind, ctx) {
  return CROPS.filter((crop) => {
    const fit = bestFit(crop, kind, ctx);
    if (!fit || fit.fit < MIN_CLIMATE_FIT) return false;
    const soil = soilFit(crop, ctx.soil);
    return soil.fit === null || soil.fit >= 0.3;
  });
}

export function climateNotices(climate) {
  const notices = [];
  if (climate?.coldWinter) {
    notices.push(`This location has freezing winters (coldest month averages ${climate.coldestMonth.toFixed(0)}°C). Winter-hardy crops (winter wheat, winter rye) are modelled simply: they are assumed to survive dormancy if the coldest monthly average stays above their hardiness limit. Snow cover, winterkill from ice or freeze-thaw, vernalisation and snowmelt water are not modelled, so treat these suggestions as lower-confidence and rely on local advice.`);
  }
  return notices;
}

export function generateStrategies(baseInput, existingIds) {
  const ctx = makeContext(baseInput);
  if (!ctx.climate) return null;
  const length = ctx.seasonsPerYear === 1 ? 3 : 4;
  const kinds = Array.from({ length }, (_, i) => slotKind(i, ctx.seasonsPerYear));
  const pools = kinds.map((kind) => eligibleCrops(kind, ctx));
  const existing = existingIds?.length >= 2 ? evaluateRotation(existingIds, ctx, "Your current rotation") : null;

  const emptyPool = pools.some((pool) => !pool.length);
  if (emptyPool) return { ctx, existing, alternatives: [], poolSizes: pools.map((p) => p.length), notices: climateNotices(ctx.climate), message: "No crops in the database fit this climate in some seasons. Try irrigation or a single-season system." };

  // Enumerate every valid sequence once, cheaply, then rank it under several priority profiles.
  const candidates = [];
  const walk = (prefix, depth) => {
    if (depth === length) {
      const wrap = prefix[0] === prefix[length - 1];
      const nonCash = prefix.filter((id) => !CROP_BY_ID[id].cash).length;
      if (!wrap && new Set(prefix).size > 1 && nonCash <= MAX_NON_CASH_CROPS) candidates.push(prefix.slice());
      return;
    }
    for (const crop of pools[depth]) {
      if (depth > 0 && prefix[depth - 1] === crop.id) continue;
      prefix.push(crop.id);
      walk(prefix, depth + 1);
      prefix.pop();
    }
  };
  walk([], 0);

  const profiles = [
    { key: "balanced", label: "Best for your priorities", priorities: ctx.priorities },
    { key: "soil", label: "Soil-building focus", priorities: { ...ctx.priorities, soilHealth: 5 } },
    { key: "water", label: "Water-saving focus", priorities: { ...ctx.priorities, water: 5 } },
    { key: "market", label: "Market-income focus", priorities: { ...ctx.priorities, market: 5 } },
  ];

  const chosen = [];
  const chosenSets = [];
  const existingKey = existingIds?.length ? canonicalKey(existingIds) : null;
  const farmerWeights = ctx.weights;
  for (const profile of profiles) {
    if (profile.key === "market" && !(ctx.marketCrops && ctx.marketCrops.size)) continue;
    const profileCtx = { ...ctx, weights: buildWeights(profile.priorities) };
    const ranked = candidates.map((ids) => ({ ids, result: evaluateRotation(ids, profileCtx) })).sort((a, b) => b.result.total - a.result.total);
    for (const { ids } of ranked) {
      const key = canonicalKey(ids);
      const setKey = [...new Set(ids)].sort().join(",");
      if (key === existingKey || chosen.some((c) => c.key === key) || chosenSets.includes(setKey)) continue;
      chosen.push({ key, profile, ids });
      chosenSets.push(setKey);
      break;
    }
  }
  // Re-score everything under the farmer's own weights so totals are comparable.
  const alternatives = chosen.map(({ profile, ids }) => ({ ...evaluateRotation(ids, { ...ctx, weights: farmerWeights }, profile.label), focus: profile.key }));
  alternatives.sort((a, b) => b.total - a.total);
  return { ctx, existing, alternatives, poolSizes: pools.map((p) => p.length), candidateCount: candidates.length, notices: climateNotices(ctx.climate) };
}
