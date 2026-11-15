// Soil interpretation: pure functions with no network access, so the same code
// runs on the server and in the browser (farmer soil-test values re-run it live).
//
// Units used throughout:
//   soc  g/kg (organic carbon)     phh2o  pH (water)
//   sand, silt, clay  %           bdod   kg/dm3 (= g/cm3, fine-earth bulk density)

export const SOIL_PROPERTIES = [
  { key: "soc", label: "Organic carbon", unit: "g/kg", decimals: 1 },
  { key: "phh2o", label: "pH (water)", unit: "", decimals: 1 },
  { key: "sand", label: "Sand", unit: "%", decimals: 0 },
  { key: "silt", label: "Silt", unit: "%", decimals: 0 },
  { key: "clay", label: "Clay", unit: "%", decimals: 0 },
  { key: "bdod", label: "Bulk density", unit: "kg/dm³", decimals: 2 },
];

export const DEPTHS = [
  { label: "0-5cm", top: 0, bottom: 5 },
  { label: "5-15cm", top: 5, bottom: 15 },
  { label: "15-30cm", top: 15, bottom: 30 },
  { label: "30-60cm", top: 30, bottom: 60 },
  { label: "60-100cm", top: 60, bottom: 100 },
  { label: "100-200cm", top: 100, bottom: 200 },
];

const TOPSOIL_DEPTHS = ["0-5cm", "5-15cm", "15-30cm"];

const finite = (value) => Number.isFinite(value);

// Depth-weighted mean of a property over 0-30 cm from a { depthLabel: {mean} } map.
export function topsoilMean(layer) {
  let weighted = 0;
  let thickness = 0;
  for (const depth of DEPTHS.filter((d) => TOPSOIL_DEPTHS.includes(d.label))) {
    const value = layer?.[depth.label]?.mean;
    if (!finite(value)) continue;
    const t = depth.bottom - depth.top;
    weighted += value * t;
    thickness += t;
  }
  return thickness >= 20 ? weighted / thickness : null; // need at least two of the three layers
}

// USDA texture class from sand/silt/clay percentages.
export function textureClass(sandIn, siltIn, clayIn) {
  if (![sandIn, siltIn, clayIn].every(finite)) return null;
  const total = sandIn + siltIn + clayIn;
  if (total <= 0) return null;
  const sand = (sandIn / total) * 100;
  const silt = (siltIn / total) * 100;
  const clay = (clayIn / total) * 100;
  if (silt + 1.5 * clay < 15) return "Sand";
  if (silt + 1.5 * clay >= 15 && silt + 2 * clay < 30) return "Loamy sand";
  if ((clay >= 7 && clay < 20 && sand > 52 && silt + 2 * clay >= 30) || (clay < 7 && silt < 50 && silt + 2 * clay >= 30)) return "Sandy loam";
  if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return "Loam";
  if ((silt >= 50 && clay >= 12 && clay < 27) || (silt >= 50 && silt < 80 && clay < 12)) return "Silt loam";
  if (silt >= 80 && clay < 12) return "Silt";
  if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return "Sandy clay loam";
  if (clay >= 27 && clay < 40 && sand > 20 && sand <= 45) return "Clay loam";
  if (clay >= 27 && clay < 40 && sand <= 20) return "Silty clay loam";
  if (clay >= 35 && sand > 45) return "Sandy clay";
  if (clay >= 40 && silt >= 40) return "Silty clay";
  if (clay >= 40) return "Clay";
  return "Loam";
}

function textureGroup(name) {
  if (["Sand", "Loamy sand", "Sandy loam"].includes(name)) return "coarse";
  if (["Clay", "Silty clay", "Sandy clay"].includes(name)) return "fine";
  return "medium";
}

export function rateOrganicCarbon(socGkg) {
  if (!finite(socGkg)) return null;
  const percent = socGkg / 10;
  if (socGkg < 10) return { level: "low", label: "Low", detail: `About ${percent.toFixed(1)}% organic carbon` };
  if (socGkg < 20) return { level: "moderate", label: "Moderate", detail: `About ${percent.toFixed(1)}% organic carbon` };
  if (socGkg < 40) return { level: "good", label: "Good", detail: `About ${percent.toFixed(1)}% organic carbon` };
  return { level: "high", label: "High", detail: `About ${percent.toFixed(1)}% organic carbon` };
}

export function ratePh(ph) {
  if (!finite(ph)) return null;
  if (ph < 5.5) return { level: "limiting", label: "Strongly acidic", detail: "Aluminium and manganese can become toxic; phosphorus and calcium less available." };
  if (ph < 6.0) return { level: "watch", label: "Moderately acidic", detail: "Suits many crops; acid-sensitive crops may respond to liming." };
  if (ph <= 7.3) return { level: "good", label: "Near neutral", detail: "Nutrient availability is good for most crops." };
  if (ph <= 8.0) return { level: "watch", label: "Mildly alkaline", detail: "Fine for many crops; some micronutrients (iron, zinc) can become less available." };
  return { level: "limiting", label: "Alkaline", detail: "Iron, zinc and phosphorus availability is often reduced; check for free lime and sodium." };
}

export function rateBulkDensity(bdod, texture) {
  if (!finite(bdod)) return null;
  const group = textureGroup(texture);
  const limits = { coarse: [1.6, 1.8], medium: [1.4, 1.6], fine: [1.1, 1.45] }[group];
  const [ideal, restrictive] = limits;
  if (bdod < ideal) return { level: "good", label: "Favourable", detail: `Below ${ideal} kg/dm³, typically open enough for roots in ${group}-textured soil.` };
  if (bdod < restrictive) return { level: "watch", label: "Watch compaction", detail: `Between ${ideal} and ${restrictive} kg/dm³: roots can grow but compaction deserves attention.` };
  return { level: "limiting", label: "Compaction-prone", detail: `At or above ${restrictive} kg/dm³, root growth is often restricted in ${group}-textured soil.` };
}

// Relative width of the 90% prediction interval -> a plain-language confidence.
export function confidenceFor(key, entry) {
  if (!entry || !finite(entry.low) || !finite(entry.high) || !finite(entry.mean)) return null;
  const width = entry.high - entry.low;
  if (key === "phh2o") return width < 1 ? "high" : width < 1.8 ? "medium" : "low";
  const relative = width / Math.max(Math.abs(entry.mean), 1e-6);
  if (key === "soc") return relative < 0.6 ? "high" : relative < 1.2 ? "medium" : "low";
  return relative < 0.3 ? "high" : relative < 0.6 ? "medium" : "low";
}

// Farmer soil-test input -> comparable units. Blank fields are ignored.
export function normalizeFarmerTest(raw) {
  if (!raw) return {};
  const num = (value) => (value === "" || value === null || value === undefined ? null : Number(value));
  const out = {};
  const ph = num(raw.ph);
  if (finite(ph) && ph >= 3 && ph <= 11) out.phh2o = ph;
  const socPercent = num(raw.socPercent);
  if (finite(socPercent) && socPercent >= 0 && socPercent <= 30) out.soc = socPercent * 10;
  for (const key of ["sand", "silt", "clay"]) {
    const value = num(raw[key]);
    if (finite(value) && value >= 0 && value <= 100) out[key] = value;
  }
  const bd = num(raw.bulkDensity);
  if (finite(bd) && bd >= 0.5 && bd <= 2.2) out.bdod = bd;
  return out;
}

function compareValues(key, modelled, measured) {
  if (!finite(modelled) || !finite(measured)) return null;
  const diff = measured - modelled;
  const notable = {
    phh2o: Math.abs(diff) >= 1,
    soc: Math.abs(diff) >= 10 || (modelled > 0 && Math.abs(diff) / modelled > 0.5),
    sand: Math.abs(diff) >= 15,
    silt: Math.abs(diff) >= 15,
    clay: Math.abs(diff) >= 15,
    bdod: Math.abs(diff) >= 0.2,
  }[key];
  return { modelled, measured, difference: diff, notable: Boolean(notable) };
}

const PLAIN_NAMES = { soc: "organic carbon", phh2o: "pH", sand: "sand content", silt: "silt content", clay: "clay content", bdod: "bulk density" };
const LEVEL_RANK = { info: 0, moderate: 1, high: 2 };

// Builds the Soil Intelligence Profile from SoilGrids layers (+ optional farmer test).
// layers: { soc: { "0-5cm": { mean, low, high }, ... }, phh2o: ..., ... }
export function buildSoilProfile(layers, farmerTestRaw) {
  const farmer = normalizeFarmerTest(farmerTestRaw);
  const modelled = {};
  for (const { key } of SOIL_PROPERTIES) modelled[key] = topsoilMean(layers?.[key]);

  const effective = {};
  const origin = {};
  for (const { key } of SOIL_PROPERTIES) {
    if (finite(farmer[key])) { effective[key] = farmer[key]; origin[key] = "farmer"; }
    else if (finite(modelled[key])) { effective[key] = modelled[key]; origin[key] = "soilgrids"; }
    else { effective[key] = null; origin[key] = null; }
  }

  const texture = textureClass(effective.sand, effective.silt, effective.clay);
  const ratings = {
    soc: rateOrganicCarbon(effective.soc),
    ph: ratePh(effective.phh2o),
    bulkDensity: rateBulkDensity(effective.bdod, texture),
  };

  const comparisons = {};
  for (const { key } of SOIL_PROPERTIES) comparisons[key] = compareValues(key, modelled[key], farmer[key]);

  const limitations = [];
  const add = (item) => limitations.push(item);
  const src = (key) => (origin[key] === "farmer" ? "your soil test" : "SoilGrids");

  if (ratings.soc?.level === "low") {
    add({ id: "low-soc", severity: "high", title: "Low organic carbon", evidence: `${(effective.soc / 10).toFixed(1)}% organic carbon (${src("soc")}).`,
      effect: "Less stored nutrients, weaker soil structure and lower water-holding capacity, so the soil recovers slowly from dry spells and heavy rain.",
      rotation: "Rotations that return residue, include cover crops or forage/pasture phases, and reduce bare periods help rebuild organic matter over several seasons." });
  } else if (ratings.soc?.level === "moderate") {
    add({ id: "moderate-soc", severity: "info", title: "Moderate organic carbon", evidence: `${(effective.soc / 10).toFixed(1)}% organic carbon (${src("soc")}).`,
      effect: "Adequate for many crops, but there is room to improve structure and moisture holding.",
      rotation: "Keeping residues on the field and avoiding long bare fallows helps maintain or raise it." });
  }

  if (ratings.ph?.level === "limiting") {
    const acid = effective.phh2o < 7;
    add({ id: acid ? "strong-acidity" : "alkalinity", severity: "high", title: acid ? "Strongly acidic soil" : "Alkaline soil", evidence: `pH ${effective.phh2o.toFixed(1)} (${src("phh2o")}).`,
      effect: ratings.ph.detail,
      rotation: acid ? "Acid-sensitive crops can struggle; liming based on a soil test, and choosing acid-tolerant crops in the rotation, reduces risk." : "Choose crops tolerant of high pH where possible and watch for iron and zinc deficiency symptoms; confirm with a soil and plant test." });
  } else if (ratings.ph?.level === "watch") {
    add({ id: "ph-watch", severity: "info", title: ratings.ph.label, evidence: `pH ${effective.phh2o.toFixed(1)} (${src("phh2o")}).`, effect: ratings.ph.detail,
      rotation: "Check crop pH preferences when planning the sequence; a soil test will show whether correction is worthwhile." });
  }

  if (ratings.bulkDensity?.level === "limiting") {
    add({ id: "compaction", severity: "high", title: "Dense, compaction-prone soil", evidence: `Bulk density ${effective.bdod.toFixed(2)} kg/dm³ in a ${texture?.toLowerCase()} soil (${src("bdod")}).`,
      effect: "Dense soil restricts root depth and water infiltration, raising waterlogging and runoff risk.",
      rotation: "Including deep-rooted crops or cover crops, avoiding field work on wet soil and reducing traffic can help; check for a compacted layer in the field." });
  } else if (ratings.bulkDensity?.level === "watch") {
    add({ id: "compaction-watch", severity: "info", title: "Watch for compaction", evidence: `Bulk density ${effective.bdod.toFixed(2)} kg/dm³ (${src("bdod")}).`, effect: ratings.bulkDensity.detail,
      rotation: "Rotate rooting depths and limit machinery on wet soil." });
  }

  if (finite(effective.sand) && effective.sand >= 70) {
    add({ id: "light-soil", severity: "moderate", title: "Light, fast-draining soil", evidence: `${effective.sand.toFixed(0)}% sand${texture ? ` (${texture.toLowerCase()})` : ""} (${src("sand")}).`,
      effect: "Water and nutrients drain quickly, so drought stress appears sooner and nitrogen can leach.",
      rotation: "Drought-tolerant crops, cover crops that hold nutrients over wet seasons and organic matter additions suit these soils; avoid leaving them bare." });
  }
  if (finite(effective.clay) && effective.clay >= 40) {
    add({ id: "heavy-soil", severity: "moderate", title: "Heavy clay soil", evidence: `${effective.clay.toFixed(0)}% clay${texture ? ` (${texture.toLowerCase()})` : ""} (${src("clay")}).`,
      effect: "Drains slowly and can waterlog, with a narrow window when it is workable; it also holds water well in dry spells.",
      rotation: "Crops that tolerate wet feet, good drainage and timing field operations to dry periods matter; deep-rooted crops can improve structure." });
  }

  for (const { key } of SOIL_PROPERTIES) {
    const c = comparisons[key];
    if (c?.notable) {
      add({ id: `mismatch-${key}`, severity: "info", title: `Your ${PLAIN_NAMES[key]} differs from the mapped estimate`,
        evidence: `Your test: ${c.measured.toFixed(key === "bdod" ? 2 : 1)}; SoilGrids: ${c.modelled.toFixed(key === "bdod" ? 2 : 1)}.`,
        effect: "SoilGrids is a 250 m model prediction. A recent test on your own field is usually more reliable, and the interpretation above already uses your value.",
        rotation: "No change needed; this note is shown so you know the two sources disagree." });
    }
  }

  limitations.sort((a, b) => LEVEL_RANK[b.severity] - LEVEL_RANK[a.severity]);
  return { modelled, effective, origin, texture, ratings, comparisons, limitations, farmerValuesUsed: Object.keys(farmer) };
}
