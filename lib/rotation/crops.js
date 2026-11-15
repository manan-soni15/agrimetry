// Generic crop knowledge base for the rotation engine.
//
// IMPORTANT: every number here is an approximate, generalised agronomic value in the
// style of FAO crop guidance (growing length, optimal mean temperature, seasonal
// water use, pH range). Varieties, sowing dates, management and local conditions
// change them substantially. They are used to rank options, not to predict yields,
// and must be checked against local agricultural advice.
//
// Fields:
//   months      growing period in whole months (sowing to harvest)
//   tempOpt     optimal mean air temperature range during growth, °C
//   tempTol     absolute tolerable mean temperature range, °C
//   waterMm     approximate seasonal crop water use [low, high], mm
//   nFix        0 none, 1 moderate, 2 strong biological nitrogen fixation
//   nDemand     nitrogen demand: low | medium | high
//   cover       protection of soil from erosion while growing, 1 (poor) to 5 (excellent)
//   residue     organic residue returned to soil, 1 (little) to 5 (a lot)
//   phOpt/phTol optimal and tolerable soil pH ranges
//   texture     suitability [light, medium, heavy] soils, 0 to 1
//   compaction  sensitivity to dense soil, 0 (tolerant) to 1 (very sensitive)
//   forage      0 none, 1 residues/stover useful, 2 good grain+fodder, 3 dedicated fodder
//   dormantMin  only for winter-hardy crops that sit dormant through cold months: the lowest
//               monthly mean air temperature (°C) they are assumed to survive; months colder than
//               tempTol[0] count as dormancy instead of failure. A simple model: snow cover, ice,
//               freeze-thaw winterkill and vernalisation are not modelled.
//   sowTemp     winter-hardy crops only: mean air temperature range (°C) of a typical autumn sowing month
//   needs       equipment tags: seedDrill, rowPlanter, harvester, irrigation
//   cash        true when normally grown to sell; false for green manure / cover crops

export const EQUIPMENT = [
  { id: "seedDrill", label: "Seed drill (small grains and pulses)" },
  { id: "rowPlanter", label: "Row-crop planter / cultivator" },
  { id: "harvester", label: "Combine harvester or thresher" },
  { id: "irrigation", label: "Irrigation system" },
];

export const CROPS = [
  { id: "wheat", name: "Wheat", family: "Poaceae", group: "cereal", months: 5, tempOpt: [12, 22], tempTol: [5, 28], waterMm: [450, 650], nFix: 0, nDemand: "high", cover: 4, residue: 4, phOpt: [6.0, 7.5], phTol: [5.5, 8.0], texture: [0.6, 1, 0.8], compaction: 0.4, forage: 1, needs: ["seedDrill", "harvester"], cash: true },
  { id: "barley", name: "Barley", family: "Poaceae", group: "cereal", months: 5, tempOpt: [10, 22], tempTol: [4, 28], waterMm: [350, 500], nFix: 0, nDemand: "medium", cover: 4, residue: 3, phOpt: [6.0, 8.0], phTol: [5.8, 8.5], texture: [0.7, 1, 0.7], compaction: 0.4, forage: 2, needs: ["seedDrill", "harvester"], cash: true },
  { id: "winter-wheat", name: "Winter wheat", family: "Poaceae", group: "cereal", months: 9, tempOpt: [8, 22], tempTol: [0, 28], dormantMin: -12, sowTemp: [5, 17], waterMm: [450, 650], nFix: 0, nDemand: "high", cover: 5, residue: 4, phOpt: [6.0, 7.5], phTol: [5.5, 8.0], texture: [0.6, 1, 0.8], compaction: 0.4, forage: 1, needs: ["seedDrill", "harvester"], cash: true },
  { id: "winter-rye", name: "Winter rye (cover / fodder)", family: "Poaceae", group: "cereal", months: 9, tempOpt: [5, 20], tempTol: [-2, 26], dormantMin: -20, sowTemp: [3, 17], waterMm: [350, 500], nFix: 0, nDemand: "medium", cover: 5, residue: 5, phOpt: [5.5, 7.0], phTol: [4.8, 7.8], texture: [1, 1, 0.7], compaction: 0.1, forage: 2, needs: ["seedDrill"], cash: false },
  { id: "oats", name: "Oats (grain / fodder)", family: "Poaceae", group: "cereal", months: 4, tempOpt: [10, 20], tempTol: [4, 26], waterMm: [350, 500], nFix: 0, nDemand: "medium", cover: 4, residue: 3, phOpt: [5.5, 7.0], phTol: [5.0, 7.5], texture: [0.6, 1, 0.8], compaction: 0.3, forage: 3, needs: ["seedDrill"], cash: true },
  { id: "maize", name: "Maize", family: "Poaceae", group: "cereal", months: 4, tempOpt: [18, 28], tempTol: [12, 34], waterMm: [500, 800], nFix: 0, nDemand: "high", cover: 3, residue: 5, phOpt: [5.8, 7.3], phTol: [5.5, 7.8], texture: [0.6, 1, 0.7], compaction: 0.6, forage: 2, needs: ["rowPlanter", "harvester"], cash: true },
  { id: "rice", name: "Rice", family: "Poaceae", group: "cereal", months: 5, tempOpt: [22, 30], tempTol: [18, 35], waterMm: [900, 1500], nFix: 0, nDemand: "high", cover: 3, residue: 4, phOpt: [5.5, 7.0], phTol: [5.0, 8.0], texture: [0.3, 0.8, 1], compaction: 0.1, forage: 1, needs: ["irrigation", "harvester"], cash: true },
  { id: "sorghum", name: "Sorghum", family: "Poaceae", group: "cereal", months: 4, tempOpt: [24, 32], tempTol: [18, 38], waterMm: [450, 650], nFix: 0, nDemand: "medium", cover: 3, residue: 4, phOpt: [6.0, 8.0], phTol: [5.5, 8.5], texture: [0.7, 1, 0.9], compaction: 0.4, forage: 3, needs: ["rowPlanter"], cash: true },
  { id: "pearl-millet", name: "Pearl millet", family: "Poaceae", group: "cereal", months: 4, tempOpt: [25, 32], tempTol: [20, 38], waterMm: [350, 450], nFix: 0, nDemand: "low", cover: 3, residue: 3, phOpt: [5.5, 8.0], phTol: [5.0, 8.5], texture: [1, 0.8, 0.4], compaction: 0.3, forage: 2, needs: ["seedDrill"], cash: true },
  { id: "soybean", name: "Soybean", family: "Fabaceae", group: "legume", months: 4, tempOpt: [20, 28], tempTol: [15, 32], waterMm: [450, 700], nFix: 2, nDemand: "low", cover: 3, residue: 3, phOpt: [6.0, 7.0], phTol: [5.8, 7.5], texture: [0.6, 1, 0.7], compaction: 0.5, forage: 1, needs: ["rowPlanter", "harvester"], cash: true },
  { id: "chickpea", name: "Chickpea", family: "Fabaceae", group: "legume", months: 5, tempOpt: [15, 25], tempTol: [8, 30], waterMm: [300, 450], nFix: 2, nDemand: "low", cover: 2, residue: 2, phOpt: [6.0, 8.0], phTol: [5.8, 9.0], texture: [0.6, 1, 0.7], compaction: 0.5, forage: 1, needs: ["seedDrill"], cash: true },
  { id: "lentil", name: "Lentil", family: "Fabaceae", group: "legume", months: 5, tempOpt: [12, 22], tempTol: [6, 28], waterMm: [300, 400], nFix: 2, nDemand: "low", cover: 2, residue: 2, phOpt: [6.0, 7.5], phTol: [5.8, 8.0], texture: [0.7, 1, 0.6], compaction: 0.5, forage: 1, needs: ["seedDrill"], cash: true },
  { id: "field-pea", name: "Field pea", family: "Fabaceae", group: "legume", months: 4, tempOpt: [10, 20], tempTol: [5, 25], waterMm: [350, 500], nFix: 2, nDemand: "low", cover: 3, residue: 3, phOpt: [6.0, 7.0], phTol: [5.8, 7.5], texture: [0.6, 1, 0.6], compaction: 0.5, forage: 2, needs: ["seedDrill"], cash: true },
  { id: "groundnut", name: "Groundnut", family: "Fabaceae", group: "legume", months: 5, tempOpt: [22, 30], tempTol: [18, 34], waterMm: [500, 700], nFix: 2, nDemand: "low", cover: 2, residue: 2, phOpt: [5.8, 6.8], phTol: [5.5, 7.0], texture: [1, 0.8, 0.3], compaction: 0.9, forage: 2, needs: ["rowPlanter"], cash: true },
  { id: "mustard", name: "Mustard / rapeseed", family: "Brassicaceae", group: "oilseed", months: 5, tempOpt: [12, 22], tempTol: [8, 28], waterMm: [350, 450], nFix: 0, nDemand: "medium", cover: 3, residue: 3, phOpt: [6.0, 7.5], phTol: [5.5, 8.5], texture: [0.7, 1, 0.7], compaction: 0.4, forage: 0, needs: ["seedDrill", "harvester"], cash: true },
  { id: "sunflower", name: "Sunflower", family: "Asteraceae", group: "oilseed", months: 4, tempOpt: [18, 26], tempTol: [12, 32], waterMm: [600, 1000], nFix: 0, nDemand: "medium", cover: 2, residue: 3, phOpt: [6.0, 7.5], phTol: [6.0, 8.0], texture: [0.6, 1, 0.8], compaction: 0.4, forage: 0, needs: ["rowPlanter", "harvester"], cash: true },
  { id: "cotton", name: "Cotton", family: "Malvaceae", group: "fibre", months: 6, tempOpt: [22, 30], tempTol: [18, 35], waterMm: [700, 1300], nFix: 0, nDemand: "high", cover: 2, residue: 3, phOpt: [6.0, 8.0], phTol: [5.8, 8.5], texture: [0.5, 1, 0.9], compaction: 0.5, forage: 0, needs: ["rowPlanter"], cash: true },
  { id: "potato", name: "Potato", family: "Solanaceae", group: "root", months: 4, tempOpt: [14, 20], tempTol: [8, 25], waterMm: [500, 700], nFix: 0, nDemand: "high", cover: 1, residue: 1, phOpt: [5.2, 6.2], phTol: [4.8, 6.8], texture: [0.9, 1, 0.3], compaction: 1, forage: 0, needs: ["rowPlanter", "irrigation"], cash: true },
  { id: "berseem", name: "Berseem clover (fodder)", family: "Fabaceae", group: "legume", months: 5, tempOpt: [12, 24], tempTol: [6, 30], waterMm: [500, 800], nFix: 2, nDemand: "low", cover: 5, residue: 4, phOpt: [6.0, 7.8], phTol: [5.8, 8.5], texture: [0.5, 1, 0.9], compaction: 0.3, forage: 3, needs: ["seedDrill"], cash: false },
  { id: "cowpea", name: "Cowpea (fodder / green manure)", family: "Fabaceae", group: "legume", months: 3, tempOpt: [24, 32], tempTol: [18, 36], waterMm: [300, 450], nFix: 2, nDemand: "low", cover: 4, residue: 3, phOpt: [5.8, 7.2], phTol: [5.5, 7.5], texture: [1, 0.9, 0.5], compaction: 0.3, forage: 3, needs: [], cash: false },
  { id: "sesbania", name: "Sesbania (green manure)", family: "Fabaceae", group: "legume", months: 2, tempOpt: [24, 32], tempTol: [20, 38], waterMm: [250, 400], nFix: 2, nDemand: "low", cover: 4, residue: 5, phOpt: [5.5, 8.0], phTol: [5.0, 8.5], texture: [0.8, 1, 0.9], compaction: 0.2, forage: 0, needs: [], cash: false },
];

export const CROP_BY_ID = Object.fromEntries(CROPS.map((crop) => [crop.id, crop]));

export const GROUP_LABELS = { cereal: "Cereal", legume: "Legume", oilseed: "Oilseed", fibre: "Fibre", root: "Root / tuber" };
