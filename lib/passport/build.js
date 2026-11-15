// Evidence Passport builder: pure functions with no network access.
//
// It takes the data the other features already retrieve (NASA POWER climate and
// water-stress, SoilGrids, optional Sentinel-2 vegetation, the farmer's own inputs)
// and produces a structured, reproducible report for every rotation: why it was
// suggested, which datasets support it, what history it was tested against, the
// soil and water benefits, and the uncertainties, gaps and risks. Every statement is
// tagged with the kind of evidence behind it so satellite observations, modelled
// estimates and farmer-provided information are never blended together

import { CROP_BY_ID } from "../rotation/crops.js";
import { buildClimate, CRITERIA, generateStrategies, MONTH_NAMES, soilForEngine } from "../rotation/engine.js";
import { buildSoilProfile } from "../soil-health/interpret.js";
import { buildSeries, replayRotation, SCENARIO_PRESETS, scenarioMatrix } from "../replay/analysis.js";

export const EVIDENCE_CLASSES = {
  satellite: { label: "Satellite observation", detail: "Measured by a satellite sensor over your field." },
  model: { label: "Modelled estimate", detail: "Produced by a weather, reanalysis or machine-learning model for a grid cell. Not measured in your field." },
  farmer: { label: "Farmer-provided", detail: "Information you entered." },
  reference: { label: "General reference", detail: "Generalised agronomic values for typical crops, not specific to your farm." },
  derived: { label: "Agrimetry analysis", detail: "Calculated by Agrimetry from the inputs above." },
};

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const mid = (range) => (range[0] + range[1]) / 2;
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : "n/a");
const dash = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");

// Small stable hash (cyrb53) so a passport can be tied to the exact inputs behind it.
export function hashString(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).toUpperCase().padStart(10, "0");
}

// ------------------------------------------------------------------ sources

function describeSources({ data, inputs, profile, climate }) {
  const water = data.waterStress;
  const soilGrids = data.soil?.layers ? data.soil : null;
  const soilMoisture = data.soil?.soilMoisture?.available ? data.soil.soilMoisture : null;
  const veg = data.vegetation;
  const farmerSoil = profile?.farmerValuesUsed?.length || 0;
  const list = [];
  list.push({
    id: "power-climate", name: "NASA POWER daily and monthly climate", provider: "NASA POWER (MERRA-2 reanalysis)", class: "model", nasa: true,
    status: climate ? "used" : "unavailable",
    usedFor: "Climate normals, 25-year history replay, scenarios",
    detail: climate ? `${climate.startYear}–${climate.endYear}, monthly and daily, about 50 km grid cell around your field centre.` : "Could not be loaded.",
  });
  list.push({
    id: "power-water", name: "NASA POWER soil wetness, rainfall and temperature (water stress)", provider: "NASA POWER (MERRA-2), plus ET0 and rainfall index calculated by Agrimetry", class: "model", nasa: true,
    status: water ? "used" : "unavailable",
    usedFor: "Current water-stress signal, evaporative demand, aridity",
    detail: water ? `Latest month rated ${water.summary.latestLabel}; aridity ${water.baseline.aridityClass?.label || "n/a"}.` : "Water-stress analysis could not be loaded.",
  });
  list.push({
    id: "sentinel2", name: "Sentinel-2 vegetation (NDVI)", provider: "Copernicus / ESA, via Element 84 Earth Search (not a NASA mission)", class: "satellite", nasa: false,
    status: veg?.result ? "used" : veg?.skipped ? "skipped" : "unavailable",
    usedFor: "Field greenness pattern, within-field variation, cover periods",
    detail: veg?.result ? `${veg.result.summary.validMonths} of ${veg.result.summary.totalMonths} months with a clear observation.` : veg?.skipped ? "You chose not to include satellite vegetation in this passport." : "Could not be loaded.",
  });
  list.push({
    id: "soilgrids", name: "ISRIC SoilGrids soil properties", provider: "ISRIC – World Soil Information (not NASA)", class: "model", nasa: false,
    status: soilGrids ? "used" : "unavailable",
    usedFor: "Available mapped pH, texture, organic-carbon and bulk-density properties",
    detail: soilGrids ? `250 m machine-learning prediction via ${data.soil.soilGrids?.service || "ISRIC coverage service"}${data.soil.soilGrids?.coverage ? ` (${data.soil.soilGrids.coverage.returned}/${data.soil.soilGrids.coverage.requested} requested values)` : ""}${data.soil.sample?.where === "nearby" ? ", sampled just outside the field" : ""}.` : "No SoilGrids estimate was available for this field. Soil compatibility falls back to farmer-entered values or remains neutral.",
  });
  list.push({
    id: "nasa-smap", name: "NASA SMAP L4 soil moisture time series", provider: "NASA SMAP L4 via NASA POWER", class: "model", nasa: true,
    status: soilMoisture ? "used" : "unavailable",
    usedFor: "Recent surface and root-zone moisture history; landscape-scale water context, not a soil chemistry input",
    detail: soilMoisture ? `Recent SMAP series from ${soilMoisture.source?.startDate || "the available start date"} to ${soilMoisture.source?.endDate || "the latest available date"}; native grid about 9 km.` : "NASA SMAP numerical soil-moisture history was not available for this field request.",
  });
  list.push({
    id: "soil-test", name: "Your soil test", provider: "You", class: "farmer", nasa: false,
    status: farmerSoil ? "used" : "unavailable",
    usedFor: "Overrides the SoilGrids estimate for the properties you entered",
    detail: farmerSoil ? `${farmerSoil} propert${farmerSoil === 1 ? "y" : "ies"} entered.` : "No soil test saved for this field.",
  });
  list.push({
    id: "farmer-inputs", name: "Your farm details", provider: "You", class: "farmer", nasa: false, status: "used",
    usedFor: "Current rotation, irrigation, priorities, markets, equipment",
    detail: "Entered on the Rotation page.",
  });
  list.push({
    id: "gibs", name: "NASA GIBS imagery (SMAP soil moisture, GPM IMERG rainfall)", provider: "NASA Earth Observing System Data and Information System", class: "satellite", nasa: true, status: "visual-only",
    usedFor: "Map context on the Water stress page",
    detail: "Imagery only. It is not an input to any score in this passport.",
  });
  list.push({
    id: "crop-db", name: "Crop requirement database", provider: "Agrimetry (FAO-style generalised values)", class: "reference", nasa: false, status: "used",
    usedFor: "Growing length, temperature, water, pH, texture and nitrogen traits of each crop",
    detail: "Approximate values for typical varieties; not calibrated to your district.",
  });
  list.push({
    id: "engine", name: "Agrimetry multi-criteria scoring", provider: "Agrimetry", class: "derived", nasa: false, status: "used",
    usedFor: "Scores, ranking, replay ratings, scenario tests",
    detail: "Transparent weighted scoring; weights follow your priorities.",
  });
  return list;
}

function evidenceConfidence({ sources, climate, strategies, profile }) {
  const by = Object.fromEntries(sources.map((s) => [s.id, s]));
  const items = [];
  const add = (label, points, max, note) => items.push({ label, points, max, note });
  add("Climate record", by["power-climate"].status === "used" ? 2 : 0, 2, by["power-climate"].status === "used" ? "25 years of NASA POWER data loaded." : "No climate data.");
  const testCount = profile?.farmerValuesUsed?.length || 0;
  add("Soil information", testCount >= 3 ? 2 : testCount > 0 || by.soilgrids.status === "used" ? 1 : 0, 2, testCount >= 3 ? "Your own soil test covers three or more properties." : testCount > 0 ? "Partly from your soil test." : by.soilgrids.status === "used" ? "Only the 250 m SoilGrids model. A soil test would strengthen this." : "No soil data.");
  add("Satellite observations of your field", by.sentinel2.status === "used" ? 2 : 0, 2, by.sentinel2.status === "used" ? "Sentinel-2 vegetation observations of your boundary." : by.sentinel2.status === "skipped" ? "Skipped by choice." : "Not available.");
  add("Market information", strategies.ctx.marketCrops?.size ? 1 : 0, 1, strategies.ctx.marketCrops?.size ? "You listed crops you can sell." : "No market information provided.");
  add("Equipment information", strategies.ctx.equipment ? 1 : 0, 1, strategies.ctx.equipment ? "Equipment listed." : "Equipment not specified.");
  let penalty = 0;
  const notes = [];
  if (climate?.coldWinter) { penalty += 1; notes.push("Freezing winters: winter-hardy crops are modelled only simply (no snow cover, winterkill or vernalisation)."); }
  const total = items.reduce((s, i) => s + i.points, 0) - penalty;
  const max = items.reduce((s, i) => s + i.max, 0);
  const score = Math.max(0, total);
  // Never "High": crop requirements are generalised and need local validation.
  const level = score >= 6 ? "Medium" : score >= 4 ? "Medium" : "Low";
  const reachedCap = score >= 6;
  return {
    level, score, max, penalty, items, notes,
    explanation: reachedCap
      ? `The data inputs are strong (${score} of ${max} points), but confidence is capped at Medium because crop requirements are generalised and no local agronomic validation is included.`
      : `${score} of ${max} points for data completeness${penalty ? `, minus ${penalty} for a climate the crop database handles poorly` : ""}. Adding the missing inputs raises confidence.`,
  };
}

// ------------------------------------------------------------------ per-rotation parts

function rotationFacts(entry) {
  const crops = entry.cropIds.map((id) => CROP_BY_ID[id]);
  const years = entry.seasonsPerYear === 1 ? crops.length : crops.length / 2;
  const grownMonths = crops.reduce((s, c) => s + c.months, 0);
  return {
    meanWaterNeedMm: mean(crops.map((c) => mid(c.waterMm))),
    legumeShare: crops.filter((c) => c.nFix >= 1).length / crops.length,
    nFixingCrops: crops.filter((c) => c.nFix >= 1).map((c) => c.name),
    coveredShare: Math.min(1, grownMonths / (12 * years)),
    bareMonthsPerYear: Math.max(0, 12 - grownMonths / years),
    meanResidue: mean(crops.map((c) => c.residue)),
    families: new Set(crops.map((c) => c.family)).size,
  };
}

const WHY_TEXT = {
  climate: (a, c) => `Climate and water fit is ${a.score}/100 against ${c.score}/100 for your current rotation: ${a.explanation}`,
  soil: (a, c) => `Soil compatibility is ${a.score}/100 against ${c.score}/100: ${a.explanation}`,
  nitrogen: (a, c) => `Nitrogen balance is ${a.score}/100 against ${c.score}/100: ${a.explanation}`,
  sequence: (a, c) => `Crop sequence is ${a.score}/100 against ${c.score}/100: ${a.explanation}`,
  erosion: (a, c) => `Erosion protection is ${a.score}/100 against ${c.score}/100: ${a.explanation}`,
  organicMatter: (a, c) => `Organic matter return is ${a.score}/100 against ${c.score}/100: ${a.explanation}`,
  waterSaving: (a, c) => `Water use is lower: ${a.score}/100 against ${c.score}/100. ${a.explanation}`,
  market: (a, c) => `Market fit is ${a.score}/100 against ${c.score}/100: ${a.explanation}`,
  forage: (a, c) => `Forage potential is ${a.score}/100 against ${c.score}/100: ${a.explanation}`,
  equipment: (a, c) => `Equipment fit is ${a.score}/100 against ${c.score}/100: ${a.explanation}`,
};
const CRITERION_SOURCES = {
  climate: ["power-climate", "crop-db"], soil: ["soilgrids", "soil-test", "crop-db"], nitrogen: ["crop-db"], sequence: ["crop-db"],
  erosion: ["crop-db"], organicMatter: ["crop-db"], waterSaving: ["crop-db"], market: ["farmer-inputs"], forage: ["crop-db"], equipment: ["farmer-inputs", "crop-db"],
};

function whyRecommended(entry, current, replayEntry, replayCurrent) {
  if (!current || entry.role === "current") return [];
  const reasons = [];
  const deltas = CRITERIA.map(({ key, label }) => {
    const a = entry.breakdown.find((b) => b.key === key);
    const c = current.breakdown.find((b) => b.key === key);
    return { key, label, a, c, weighted: ((a.score - c.score) * a.weight) / 100 };
  }).sort((x, y) => y.weighted - x.weighted);
  for (const d of deltas.filter((x) => x.weighted >= 0.6).slice(0, 4)) {
    reasons.push({ text: WHY_TEXT[d.key](d.a, d.c), criterion: d.label, sources: CRITERION_SOURCES[d.key], effect: `adds about ${d.weighted.toFixed(1)} points to the 100-point score` });
  }
  if (replayEntry && replayCurrent && Number.isFinite(replayEntry.summary.favourableShare) && Number.isFinite(replayCurrent.summary.favourableShare)) {
    const better = replayEntry.summary.favourableShare - replayCurrent.summary.favourableShare;
    if (Math.abs(better) >= 0.08) {
      reasons.push({
        text: better > 0
          ? `Replayed over ${replayEntry.summary.seasonsAnalysed} past crop seasons, ${pct(replayEntry.summary.favourableShare)} were favourable, compared with ${pct(replayCurrent.summary.favourableShare)} for your current rotation.`
          : `Replayed over past seasons it was favourable less often (${pct(replayEntry.summary.favourableShare)}) than your current rotation (${pct(replayCurrent.summary.favourableShare)}); this is a trade-off to weigh.`,
        criterion: "Historical resilience", sources: ["power-climate", "engine"], effect: better > 0 ? "supports the recommendation" : "counts against it",
      });
    }
  }
  if (!reasons.length) reasons.push({ text: "No criterion is clearly stronger than in your current rotation, so there is no evidence-based reason to change on these inputs.", criterion: "Overall", sources: ["engine"], effect: "neutral" });
  return reasons;
}

function benefitsAndTradeoffs(entry, current) {
  const f = rotationFacts(entry);
  const c = current ? rotationFacts(current) : null;
  const benefits = [];
  const tradeoffs = [];
  const ref = "Based on typical crop traits and your local climate; a potential, not a measured, effect.";
  if (c) {
    const water = c.meanWaterNeedMm - f.meanWaterNeedMm;
    if (water >= 40) benefits.push({ area: "Water", text: `Crops need about ${Math.round(water)} mm less water per season on average (${Math.round(f.meanWaterNeedMm)} mm vs ${Math.round(c.meanWaterNeedMm)} mm).`, note: ref });
    else if (water <= -40) tradeoffs.push({ area: "Water", text: `Crops need about ${Math.round(-water)} mm more water per season on average (${Math.round(f.meanWaterNeedMm)} mm vs ${Math.round(c.meanWaterNeedMm)} mm).`, note: ref });
    const legume = f.legumeShare - c.legumeShare;
    if (legume >= 0.15) benefits.push({ area: "Soil nitrogen", text: `Legume share rises from ${pct(c.legumeShare)} to ${pct(f.legumeShare)} (${f.nFixingCrops.join(", ")}), which can lower the fertiliser nitrogen needed by following crops.`, note: ref });
    else if (legume <= -0.15) tradeoffs.push({ area: "Soil nitrogen", text: `Legume share falls from ${pct(c.legumeShare)} to ${pct(f.legumeShare)}, so more fertiliser nitrogen may be needed.`, note: ref });
    const cover = f.coveredShare - c.coveredShare;
    if (cover >= 0.08) benefits.push({ area: "Soil cover and erosion", text: `A crop is in the ground about ${pct(f.coveredShare)} of the time (was ${pct(c.coveredShare)}), leaving about ${f.bareMonthsPerYear.toFixed(1)} bare months a year instead of ${c.bareMonthsPerYear.toFixed(1)}.`, note: ref });
    else if (cover <= -0.08) tradeoffs.push({ area: "Soil cover and erosion", text: `Cover drops to about ${pct(f.coveredShare)} of the year (was ${pct(c.coveredShare)}), so exposed soil and erosion risk may rise.`, note: ref });
    const om = entry.scores.organicMatter - current.scores.organicMatter;
    if (om >= 8) benefits.push({ area: "Organic matter", text: `Organic-matter score ${entry.scores.organicMatter}/100 vs ${current.scores.organicMatter}/100 from more or better residue return.`, note: ref });
    else if (om <= -8) tradeoffs.push({ area: "Organic matter", text: `Organic-matter score falls to ${entry.scores.organicMatter}/100 from ${current.scores.organicMatter}/100.`, note: ref });
    if (f.families > c.families) benefits.push({ area: "Pests and disease", text: `${f.families} plant families instead of ${c.families}, which helps break pest and disease cycles.`, note: ref });
  } else {
    if (f.nFixingCrops.length) benefits.push({ area: "Soil nitrogen", text: `Includes nitrogen-fixing ${f.nFixingCrops.join(", ")}.`, note: ref });
    benefits.push({ area: "Soil cover and erosion", text: `A crop is in the ground about ${pct(f.coveredShare)} of the year.`, note: ref });
  }
  return { benefits, tradeoffs, facts: f };
}

// Does the satellite's greenest month fall inside the growing window Agrimetry expects
// for the crops the farmer says they grow now? A consistency check, not a crop map.
function observationCheck(veg, currentRow) {
  if (!veg?.phenology?.available || !currentRow) return null;
  const phen = veg.phenology;
  if (phen.amplitude < 0.12) {
    return { status: "unknown", text: `The field's greenness stayed steady through the year (seasonal swing ${phen.amplitude.toFixed(2)}), so the satellite cannot show which crop was growing.` };
  }
  const peakMonth = Number(phen.peak.month.slice(5, 7)) - 1;
  const windows = currentRow.schedule.filter((s) => s.sowIndex !== null && s.sowIndex !== undefined).map((s) => {
    const crop = CROP_BY_ID[s.cropId];
    return { crop: crop.name.split(" (")[0], from: MONTH_NAMES[s.sowIndex], to: MONTH_NAMES[(s.sowIndex + crop.months - 1) % 12], months: Array.from({ length: crop.months }, (_, k) => (s.sowIndex + k) % 12) };
  });
  const hits = windows.filter((w) => w.months.includes(peakMonth));
  if (hits.length) {
    return { status: "consistent", text: `Satellite greenness peaked in ${phen.peak.label}, inside the typical growing window of ${[...new Set(hits.map((h) => `${h.crop} (${h.from}–${h.to})`))].join(", ")} in your current rotation. That is consistent with what you told us, though it does not prove which crop actually grew.` };
  }
  return { status: "inconsistent", text: `Satellite greenness peaked in ${phen.peak.label}, outside the growing windows Agrimetry expects for your current crops (${[...new Set(windows.map((w) => `${w.crop} ${w.from}–${w.to}`))].join(", ")}). Your real sowing dates or crops may differ from these typical windows, so check the crop calendar before relying on the timing in this passport.` };
}

function questionsFor(entry, { profile, sources, climate, replay }) {
  const q = [];
  const names = [...new Set(entry.cropIds.map((id) => CROP_BY_ID[id].name))];
  q.push(`Which varieties, sowing dates and seed rates are recommended for ${names.slice(0, 4).join(", ")} in your district?`);
  const by = Object.fromEntries(sources.map((s) => [s.id, s]));
  if (by["soil-test"].status !== "used") q.push("Can you get a soil test (pH, organic carbon, texture and nutrients) for this field before committing? Only a model estimate was available.");
  if (profile?.ratings?.ph?.level === "limiting") q.push("Your soil pH looks limiting. Is liming or gypsum advisable here, and in what amount?");
  if (entry.risks.some((r) => /covers only|water need/i.test(r))) q.push("How much irrigation water will really be available in the growing months of the crops flagged for low water cover?");
  if (entry.risks.some((r) => /same plant family|follows itself/i.test(r))) q.push("Are there known diseases or pests in your area that build up when these crops follow each other?");
  if (entry.risks.some((r) => /market/i.test(r)) || entry.missing.some((m) => /Market/i.test(m))) q.push("Which of these crops can you sell nearby, and at what recent prices? Agrimetry uses no price data.");
  if (entry.risks.some((r) => /equipment|usually needs/i.test(r))) q.push("Can you hire or borrow the machinery these crops need (seed drill, planter, harvester)?");
  if (climate?.coldWinter) q.push("This location has freezing winters. Which winter-hardy crops and sowing windows do local advisers use?");
  if (replay?.summary?.badYears?.length >= 3) q.push(`The replay found ${replay.summary.badYears.length} past years with widespread unfavourable seasons. What risk-reduction options (crop insurance, drought-tolerant varieties, staggered sowing) are used locally?`);
  q.push("Does anything about your field (slope, drainage, salinity, flooding, previous crop) differ from these general assumptions?");
  return q;
}

// ------------------------------------------------------------------ main

export function buildPassport({ field, inputs, data, now = new Date() }) {
  const climate = data.climateHistory ? buildClimate(data.climateHistory.parameter, data.climateHistory.startYear, data.climateHistory.endYear) : null;
  if (!climate) {
    const error = new Error("A climate baseline could not be built, so no rotation evidence can be produced for this location.");
    error.code = "NO_CLIMATE";
    throw error;
  }
  const series = buildSeries(data.climateHistory.parameter, data.climateHistory.startYear, data.climateHistory.endYear, data.climateHistory.daily);
  const profile = data.soil?.layers || data.soil?.test ? buildSoilProfile(data.soil.layers || null, data.soil.test || null) : null;
  const soil = soilForEngine(profile);

  const strategies = generateStrategies({
    climate, seasonsPerYear: inputs.seasonsPerYear, irrigation: inputs.irrigation, soil,
    marketCrops: inputs.marketCrops?.length ? inputs.marketCrops : null,
    equipment: inputs.equipment,
    priorities: inputs.priorities,
  }, inputs.existing);
  if (!strategies) throw new Error("The rotation engine could not run for this climate.");

  const sources = describeSources({ data, inputs, profile, climate });
  const confidence = evidenceConfidence({ sources, climate, strategies, profile });

  const current = strategies.existing;
  const rows = [current, ...strategies.alternatives].filter(Boolean);
  const replays = rows.map((row) => replayRotation(row.schedule, series, inputs.irrigation));
  const matrix = scenarioMatrix(rows.map((row) => ({ label: row.label, schedule: row.schedule })), series, inputs.irrigation, SCENARIO_PRESETS);
  const currentIndex = current ? 0 : -1;
  const water = data.waterStress;
  const soilMoisture = data.soil?.soilMoisture?.available ? data.soil.soilMoisture : null;
  const veg = data.vegetation?.result;
  const check = observationCheck(veg, current);

  const entries = rows.map((row, index) => {
    const role = row === current ? "current" : "recommended";
    const replay = replays[index];
    const scenarios = matrix[index].cells;
    const { benefits, tradeoffs } = benefitsAndTradeoffs(row, current);
    const why = whyRecommended({ ...row, role }, current, replay, currentIndex >= 0 ? replays[currentIndex] : null);

    const risks = [...row.risks];
    if (Number.isFinite(replay.summary.unfavourableShare) && replay.summary.unfavourableShare >= 0.15) {
      risks.push(`In the 25-year replay, ${pct(replay.summary.unfavourableShare)} of crop seasons were unfavourable${replay.summary.worstCrop ? `, most often for ${replay.summary.worstCrop.name} (${pct(replay.summary.worstCrop.unfavourableShare)})` : ""}.`);
    }
    const hotDry = scenarios.find((c) => c.key === "hotDry");
    const base = scenarios.find((c) => c.key === "baseline");
    if (hotDry && base && hotDry.notFavourableShare - base.notFavourableShare >= 0.1) {
      risks.push(`Under a warmer (+2 °C) and drier (−20% rain) scenario, the share of seasons that are not favourable rises from ${pct(base.notFavourableShare)} to ${pct(hotDry.notFavourableShare)}.`);
    }
    if (row === current && check?.status === "inconsistent") risks.push("The satellite's greenest month does not match the growing windows expected for your current crops, so the timing assumptions in this passport may not fit your field.");
    if (water && water.summary.latestLevel >= 2) risks.push(`Current conditions are rated ${water.summary.latestLabel} for water stress (${water.summary.latestReasons.join("; ") || "see Water stress"}), which matters for the next sowing.`);

    const uncertainties = [];
    uncertainties.push("Climate values are modelled estimates for a grid cell about 50 km wide, not measurements at your field.");
    uncertainties.push("Crop requirements are generalised values; real needs vary with variety, sowing date and management.");
    uncertainties.push("Past seasons are rated from monthly weather and approximate crop traits; heat waves and dry spells inside a month are only partly captured.");
    if (soilMoisture) uncertainties.push("NASA SMAP L4 soil moisture is a model-assimilated estimate on a landscape-scale grid of about 9 km, not a probe reading from inside your field.");
    if (profile) {
      const soc = data.soil?.layers?.soc?.["0-5cm"];
      if (soc && Number.isFinite(soc.low) && Number.isFinite(soc.high)) uncertainties.push(`SoilGrids organic carbon in the top 5 cm is predicted at ${dash(soc.low, 1)}–${dash(soc.high, 1)} g/kg (90% interval), a wide range, so treat soil carbon as uncertain.`);
      else if (data.soil?.layers) uncertainties.push("SoilGrids uncertainty ranges were not loaded, so the confidence of its soil values is unknown.");
      if (data.soil?.sample?.where === "nearby") uncertainties.push("SoilGrids had no estimate inside your field; values come from a point about 300 m away.");
    }
    if (veg) uncertainties.push(`Satellite greenness comes from one clear Sentinel-2 image per month (${veg.summary.validMonths} of ${veg.summary.totalMonths} months), so short events can be missed.`);
    if (!veg) uncertainties.push("No satellite observations of your field are included, so nothing in this passport has been checked against what actually grew there.");
    uncertainties.push("Scenario tests shift every month by the same amount; they are sensitivity checks, not climate projections.");

    const facts = rotationFacts(row);
    const ledger = [];
    const a = (id) => sources.find((s) => s.id === id);
    const usedIds = (ids) => ids.filter((id) => a(id)?.status === "used");
    const cls = (ids) => [...new Set(usedIds(ids).map((id) => a(id).class))];
    ledger.push({ claim: `Climate fit of ${row.scores.climate}/100`, evidence: `Average ${climate.startYear}–${climate.endYear}: ${Math.round(climate.annualRainMm)} mm rain a year, coldest month ${climate.coldestMonth.toFixed(0)} °C, warm season from ${MONTH_NAMES[climate.warmStart]}.`, sources: ["power-climate", "crop-db"], classes: cls(["power-climate", "crop-db"]) });
    if (profile && (profile.effective.phh2o != null || profile.texture)) ledger.push({ claim: `Soil compatibility of ${row.scores.soil}/100`, evidence: `${profile.texture ? `${profile.texture} texture` : "Texture unknown"}${Number.isFinite(profile.effective.phh2o) ? `, pH ${profile.effective.phh2o.toFixed(1)}` : ""}${Number.isFinite(profile.effective.soc) ? `, organic carbon ${(profile.effective.soc / 10).toFixed(1)}%` : ""} (${profile.farmerValuesUsed.length ? "your soil test" : "SoilGrids"}).`, sources: profile.farmerValuesUsed.length ? ["soil-test", "soilgrids", "crop-db"] : ["soilgrids", "crop-db"], classes: cls(profile.farmerValuesUsed.length ? ["soil-test", "soilgrids", "crop-db"] : ["soilgrids", "crop-db"]) });
    else ledger.push({ claim: `Soil compatibility of ${row.scores.soil}/100`, evidence: "No soil information was available, so this criterion was scored neutrally.", sources: ["crop-db"], classes: cls(["crop-db"]) });
    ledger.push({ claim: `${Math.round(facts.legumeShare * 100)}% of crops fix nitrogen`, evidence: facts.nFixingCrops.length ? `${facts.nFixingCrops.join(", ")} (typical nitrogen-fixing crops).` : "No nitrogen-fixing crop in this sequence.", sources: ["crop-db"], classes: cls(["crop-db"]) });
    ledger.push({ claim: `${pct(replay.summary.favourableShare)} of past seasons favourable`, evidence: `${replay.summary.seasonsAnalysed} crop seasons replayed against ${series.startYear}–${series.endYear} monthly NASA POWER weather${series.daily ? " and daily heat/dry-spell counts" : ""}; ${replay.summary.badYears.length} widespread bad year${replay.summary.badYears.length === 1 ? "" : "s"}.`, sources: ["power-climate", "crop-db", "engine"], classes: cls(["power-climate", "crop-db", "engine"]) });
    if (water) ledger.push({ claim: `Latest water-stress signal: ${water.summary.latestLabel}`, evidence: `${water.summary.latestMonth}: ${water.summary.latestReasons.join("; ") || "no stress signal"}${Number.isFinite(water.summary.latestSpi3) ? `; three-month rainfall index ${water.summary.latestSpi3.toFixed(1)}` : ""}.`, sources: ["power-water"], classes: cls(["power-water"]) });
    if (soilMoisture) {
      const latestSmap = soilMoisture.summary?.latest;
      const smapEvidence = [
        Number.isFinite(latestSmap?.surface) ? `surface ${latestSmap.surface.toFixed(3)} m³/m³` : null,
        Number.isFinite(latestSmap?.rootZone) ? `root zone ${latestSmap.rootZone.toFixed(3)} m³/m³` : null,
        Number.isFinite(latestSmap?.rootPercentile) ? `root-zone percentile ${latestSmap.rootPercentile.toFixed(0)}` : null,
      ].filter(Boolean).join(", ");
      ledger.push({ claim: "Recent NASA SMAP soil-water context", evidence: `${smapEvidence || "A recent SMAP moisture time series was available"}; native grid about 9 km, so this describes the wider landscape rather than an in-field measurement.`, sources: ["nasa-smap"], classes: cls(["nasa-smap"]) });
    }
    if (veg?.phenology?.available) ledger.push({ claim: "Your field's observed greenness pattern", evidence: `${veg.phenology.pattern}; greenest in ${veg.phenology.peak.label} (NDVI ${veg.phenology.peak.ndvi.toFixed(2)}), least green in ${veg.phenology.trough.label}. Field is ${veg.fieldVariability?.available ? veg.fieldVariability.uniformity : "of unknown uniformity"}.`, sources: ["sentinel2"], classes: cls(["sentinel2"]) });
    if (row === current && check) ledger.push({ claim: `Reality check: ${check.status === "consistent" ? "satellite timing matches your rotation" : check.status === "inconsistent" ? "satellite timing does not match your rotation" : "satellite cannot confirm your rotation"}`, evidence: check.text, sources: ["sentinel2", "engine"], classes: cls(["sentinel2", "engine"]) });
    ledger.push({ claim: "Your priorities, irrigation and constraints", evidence: `Irrigation: ${inputs.irrigation}; ${inputs.seasonsPerYear} crop${inputs.seasonsPerYear === 1 ? "" : "s"} per year; ${inputs.marketCrops?.length ? `${inputs.marketCrops.length} crops you can sell` : "no market list"}; ${inputs.equipment ? "equipment listed" : "equipment not specified"}.`, sources: ["farmer-inputs"], classes: cls(["farmer-inputs"]) });

    for (const item of ledger) item.sources = usedIds(item.sources);
    for (const reason of why) reason.sources = usedIds(reason.sources);
    const supportingIds = [...new Set(ledger.flatMap((l) => l.sources))];
    return {
      label: row.label,
      role,
      crops: row.crops,
      cropIds: row.cropIds,
      total: row.total,
      scores: row.scores,
      breakdown: row.breakdown,
      schedule: row.schedule,
      why,
      evidenceLedger: ledger,
      supportingDatasets: supportingIds.map((id) => ({ id, name: a(id).name, class: a(id).class, nasa: a(id).nasa })),
      history: { summary: replay.summary, scenarios, scenarioLabels: SCENARIO_PRESETS.map((p) => ({ key: p.key, label: p.label })) },
      benefits,
      tradeoffs,
      risks: [...new Set(risks)],
      uncertainties,
      missing: row.missing,
      questions: questionsFor({ ...row, risks, missing: row.missing }, { profile, sources, climate, replay }),
    };
  });

  const generatedAt = now.toISOString();
  const snapshot = { field: { name: field.name, centre: field.centre }, inputs, climate: [climate.startYear, climate.endYear], soil: soil ? { ph: soil.ph, texture: soil.texture, bd: soil.bdodLevel } : null, vegetationMonths: veg?.summary?.validMonths ?? null };
  return {
    id: `AGP-${hashString(JSON.stringify(snapshot))}`,
    generatedAt,
    field,
    inputs,
    classes: EVIDENCE_CLASSES,
    sources,
    confidence,
    climate: { startYear: climate.startYear, endYear: climate.endYear, annualRainMm: climate.annualRainMm, coldestMonthC: climate.coldestMonth, coldWinter: climate.coldWinter, warmStart: MONTH_NAMES[climate.warmStart], aridity: water?.baseline?.aridityClass?.label || null },
    soil: profile ? { texture: profile.texture, ph: profile.effective.phh2o, socGkg: profile.effective.soc, bulkDensity: profile.effective.bdod, origin: profile.origin, limitations: profile.limitations.filter((l) => l.severity !== "info").map((l) => l.title) } : null,
    water: water ? { latestMonth: water.summary.latestMonth, level: water.summary.latestLabel, reasons: water.summary.latestReasons, spi3: water.summary.latestSpi3, aridity: water.baseline.aridityClass?.label || null } : null,
    vegetation: veg ? { validMonths: veg.summary.validMonths, totalMonths: veg.summary.totalMonths, pattern: veg.phenology?.pattern || null, uniformity: veg.fieldVariability?.available ? veg.fieldVariability.uniformity : null } : null,
    observationCheck: check,
    notices: strategies.notices || [],
    message: strategies.message || null,
    entries,
    validationReminder: "These results are decision support, not a recommendation to change your rotation. They rely on modelled data and generalised crop values and have not been validated locally. Confirm every choice with a local agricultural adviser or extension service before acting.",
    assumptions: [
      "Crop values (growing length, temperature, water use, pH, texture, nitrogen) are generalised FAO-style estimates.",
      "Each crop is placed at the sowing window that best matches average climate; a farmer may sow earlier or later.",
      "Rainfall efficiency is 80%, plus 30% of the previous two months' rain stored in the soil; 85% of typical water use counts as full coverage.",
      "At most one green-manure or fodder crop is allowed in a generated rotation so suggestions stay productive.",
      "One crop per season slot; intercropping, perennials, tillage, fertiliser practice and prices are not modelled.",
    ],
  };
}
