# Agrimetry

**Understand your land. Grow with intelligence.**

Agrimetry is a global agricultural decision-support prototype. A farmer draws their real field boundary, reads what satellites and NASA climate data say about that field, and compares crop rotations with every score explained and every source labelled. It is being developed for the **NASA Space Apps Challenge 2026** crop-rotation challenge.

It combines NASA resources (NASA POWER climate and soil wetness, NASA GIBS imagery) with openly accessible non-NASA data (Sentinel-2, ISRIC SoilGrids, Fields of the World, OpenStreetMap). It is built to support farmer decisions. It does **not** replace local agronomic advice or field measurements.

> **Project principle:** from satellite observations to farm-specific agricultural intelligence, with transparent evidence, resolution and uncertainty.

## Contents

1. [What you can do](#1-what-you-can-do)
2. [Quick start](#2-quick-start)
3. [Features in detail](#3-features-in-detail)
4. [How Agrimetry treats evidence](#4-how-agrimetry-treats-evidence)
5. [Data sources and attribution](#5-data-sources-and-attribution)
6. [API reference](#6-api-reference)
7. [Project structure and browser storage](#7-project-structure-and-browser-storage)
8. [Development notes](#8-development-notes)
9. [Limitations and responsible use](#9-limitations-and-responsible-use)
10. [Roadmap](#10-roadmap)

---

## 1. What you can do

All seven features on the project roadmap have a working first version. They are **prototypes**: the pipelines run on live public data, but crop requirements are generalised and nothing has been validated against local agronomic advice.

| # | Feature | Page | Main data |
|---|---|---|---|
| 1 | Field Vegetation Intelligence | `/explore/vegetation` | Sentinel-2 L2A (ESA, not NASA) |
| 2 | Soil Moisture & Water Stress | `/explore/water-stress` | NASA POWER; NASA GIBS (SMAP, IMERG imagery) |
| 3 | Automatic Bare-Field Detection | `/explore/bare-field` | Sentinel-2 NDVI + NASA POWER rainfall |
| 4 | Soil Health Intelligence | `/explore/soil-health` | ISRIC SoilGrids + your own soil test |
| 5 | Crop Rotation Intelligence Engine | `/explore/rotation` | NASA POWER + SoilGrids + crop database |
| 6 | Historical Climate Replay | `/explore/replay` | NASA POWER (25 years, monthly and daily) |
| 7 | Evidence Passport | `/explore/passport` | Everything above |

They sit on a foundation of a landing page (`/`), an Environmental Explorer (`/explore`) and a Global Farm Map (`/explore/map`) where fields are drawn and saved.

### How the pieces fit together

```
 Global Farm Map ──► saved field boundary (stays in your browser)
        │
        ├──► Vegetation ─┐
        ├──► Water stress├─► understand the field today
        ├──► Bare fields ┤
        └──► Soil health ┘
                 │
                 ▼
        Rotation engine ──► compare your rotation with better options
                 │
                 ▼
        Climate replay ──► test them against 25 years of weather and scenarios
                 │
                 ▼
        Evidence Passport ──► printable report: why, which data, what is uncertain
```

---

## 2. Quick start

**Requirements:** Node.js 20.9 or newer, npm, and internet access (map tiles, geocoding, NASA POWER, Earth Search, SoilGrids and public Sentinel-2 files are all fetched live). No API keys, accounts or `.env` file are needed.

```bash
git clone https://github.com/manan-soni15/agrimetry.git
cd agrimetry
npm install
npm run dev
```

Open `http://localhost:3000/`. Direct links:

| Page | URL |
|---|---|
| Landing page | `/` |
| Environmental Explorer | `/explore` |
| Global Farm Map (start here) | `/explore/map` |
| Vegetation · Water stress · Bare fields · Soil health | `/explore/vegetation` · `/explore/water-stress` · `/explore/bare-field` · `/explore/soil-health` |
| Rotation engine · Climate replay · Evidence passport | `/explore/rotation` · `/explore/replay` · `/explore/passport` |

### A first walk-through

1. On `/explore/map`, search for your farm location (or enter coordinates).
2. Draw the field with **Trace points/Polygon**, **Freehand** or **Rectangle** (or inspect a Fields of the World candidate and add it after review). Edit the outline so it follows the real field and **save** it.
3. Open the analysis pages from the Explorer or the map layer list and pick the saved field.
4. On `/explore/rotation`, enter your current rotation, irrigation, priorities, crops you can sell and machinery; compare it with the alternatives.
5. Open `/explore/replay` to test them against past weather, then `/explore/passport` to generate the report. Print or save it as PDF, or download it as Markdown or JSON.

If no field appears on a page, go back to the Global Farm Map, save the boundary and reload. Fields live in your browser, so they do not sync between devices; export GeoJSON to keep a portable copy.

---

## 3. Features in detail

### Foundation

- **Landing page (`/`):** product introduction and the forest-green and sandy visual identity.
- **Environmental Explorer (`/explore`):** daily NASA POWER agroclimatology (temperature, rain, humidity, solar radiation) for a latitude/longitude, the latest 365 days compared with the 365 before, monthly summaries, and navigation to every field-level page.
- **Global Farm Map (`/explore/map`):** MapLibre GL JS map with OpenStreetMap and Esri World Imagery basemaps, coordinate entry, place search and optional geolocation. Farm boundaries can be drawn (polygon, freehand, rectangle), edited, listed, removed, measured in hectares and acres (Turf.js) and imported or exported as GeoJSON. Optional layers: NASA GIBS MODIS true colour, and global predicted field boundaries from the Fields of the World / PRUE dataset (PMTiles). Those predicted outlines are model output, not legal parcels, and must be reviewed by the farmer.

### 1. Field Vegetation Intelligence — `/explore/vegetation`

Works on the farmer's exact polygon, using the public Element 84 Earth Search STAC catalogue and public Sentinel-2 Cloud-Optimized GeoTIFFs.

**Pipeline.** Validate the geometry and dates → search `sentinel-2-c1-l2a` scenes by field and date → filter by scene cloud cover → read red (B04), near-infrared (B08) and the Scene Classification Layer (SCL) by HTTP range requests (GeoTIFF.js) → apply reflectance scale/offset and mask no-data, saturated, dark, shadow, unclassified, cloud and snow → compute NDVI = (NIR − RED) / (NIR + RED) for pixels inside the field → pick the lowest-cloud processable scene each month (up to two candidates; missing months stay missing, never zero) → build a pixel-wise median composite and a field-clipped PNG overlay. Up to four months are read in parallel and catalogue searches are retried on network timeouts. A 6–12 month analysis typically takes about one to two minutes.

**What you get**

- Field mean and median NDVI, monthly time series, observation table, valid-pixel coverage and quality notes.
- **Low-vegetation areas:** pixels unusually low *relative to the rest of the same field* (below the field median minus the larger of 1.5 robust standard deviations or 0.08 NDVI; isolated pixels ignored), with hectares and a red map overlay. Skipped when the whole field is low (median NDVI < 0.2).
- **Previous-season comparison:** the same months one year earlier, overlaid on the chart with a per-month difference table.
- **Management zones and variability:** thirds of the field's own NDVI distribution (relative zones) with hectares and mean NDVI, fixed NDVI classes (bare / sparse / moderate / dense), the P10–P90 spread, a plain-language uniformity label and a **Zones** map layer. Zones show where greenness differs, not why; use them to guide scouting and soil sampling.
- **Seasonal pattern:** greenest and least green months, seasonal swing, months above the halfway level, fastest rise and fall, and a pattern label.

### 2. Soil Moisture & Water Stress — `/explore/water-stress`

Compares the last 6–12 months at the field centre with the same calendar months since 2001, using one 25-year **NASA POWER** daily record (MERRA-2 based).

- **Rainfall vs normal**, matched to the same days of the month.
- **Soil wetness** (root-zone `GWETROOT`, surface `GWETTOP`) against its normal, and **declining soil-moisture periods** (three or more weekly declines totalling at least 0.06).
- **Evaporative demand:** reference evapotranspiration **ET0** by the Hargreaves–Samani equation (FAO-56), checked against the FAO-56 extraterrestrial-radiation worked example; a monthly **climatic water balance** (rain − ET0); and the **aridity index** (annual rain / annual ET0, UNEP classes).
- **3-month rainfall index (SPI-style):** the rank of the last three months' rain among the same months since 2001, converted to a z-score. It is an empirical index, not the official gamma-fitted SPI.
- **Water Stress Timeline:** each month rated Normal / Watch / Moderate / Severe from soil-wetness anomaly, rainfall (the worse of the monthly ratio and the 3-month index, counted once), very low absolute wetness, and one compounding point for heat (≥ 2 °C above normal) or evaporative demand (≥ 10 % above normal). It is a screening indicator, not a drought declaration.
- **Dry spells and last-30-day rain** with the longest dry spell and the current one.
- **NASA GIBS map layers:** SMAP L4 root-zone and surface soil moisture and GPM IMERG precipitation rate, selectable by date. They are visual context only and feed no score; SMAP L4 lags by several days and has gaps.

Note: POWER's *monthly* `T2M_MAX`/`T2M_MIN` are the month's absolute extremes, not means of daily extremes, so baseline and observations are both built from the same daily record.

### 3. Automatic Bare-Field Detection — `/explore/bare-field`

Built on the monthly Sentinel-2 NDVI series (up to 12 months) plus NASA POWER rainfall.

- **Cover state per month:** bare (NDVI < 0.20), sparse (0.20–0.35), green (≥ 0.35) or **unknown**. A month with no clear reading, or under 30 % clear pixels, is unknown, never assumed bare.
- **Bare and low-cover periods**, **crop cycles** (a green stretch whose peak NDVI reaches 0.45) and **gaps between cycles**. Periods containing unknown months are marked *partly observed*.
- **Cover-crop opportunities:** gaps of two or more months, with general guidance (cover crop, drought-tolerant cover or residue mulch) based on rainfall during the gap. No species are recommended.
- **Erosion exposure** (Low / Moderate / High) from low cover combined with monthly rainfall. It ignores rain intensity, slope, soil type and tillage. If NASA POWER is unavailable the detection still runs without erosion ratings.

### 4. Soil Health Intelligence — `/explore/soil-health`

- **ISRIC SoilGrids 2.0** (250 m, public, no key): organic carbon, pH, sand, silt, clay and bulk density at six depths (0–5 to 100–200 cm), shown with the 90 % prediction interval and a plain confidence marker.
- **Staged lookups**, because SoilGrids is a slow research service (about a second per property, depth and statistic): a one-layer probe finds a sample point with data (trying nearby points for urban, water or masked cells and saying so), the 0–30 cm means load first, and deeper layers and prediction intervals load on demand. Results are cached on the server for a week.
- **Your own soil test:** pH, organic carbon (%), sand/silt/clay (%) and bulk density. Stored in this browser per field, they replace the modelled topsoil values, the interpretation updates instantly, and notable disagreements with SoilGrids are flagged.
- **Soil Intelligence Profile:** USDA texture class, organic-carbon, pH and bulk-density ratings (topsoil = depth-weighted 0–30 cm), possible limitations (low organic carbon, strong acidity or alkalinity, compaction, light or heavy soils) and what each means for crops and rotations.

### 5. Crop Rotation Intelligence Engine — `/explore/rotation`

Compares the farmer's current rotation with generated alternatives for a saved field. All scoring runs in the browser from pure functions in `lib/rotation`, so changing inputs re-ranks instantly once climate and soil are loaded.

- **Inputs:** current rotation (2–4 crops in order), one or two crops per year, irrigation level (rainfed / limited / reliable), priorities (water, soil health, market, forage, equipment; 1–5 each), optional crops you can sell, optional equipment, and soil data (SoilGrids plus any saved soil test).
- **Climate:** 25-year monthly normals from NASA POWER (`/api/climate-normals`). Usable water counts in-season rain at 80 %, a share of the previous two months' rain, and irrigation; 85 % of a crop's typical water use counts as full coverage. Temperature is a hard condition: water cannot compensate for the wrong season.
- **Strategies:** every valid sequence of the **21 crops** in the database is scored. The page shows the current rotation plus the best sequence for your priorities, a soil-building focus, a water-saving focus and (if you listed sale crops) a market focus.
- **Ten explainable criteria (0–100 each),** weighted by your priorities (weights are shown):

| Criterion | What it looks at |
|---|---|
| Climate & water fit | Temperature and water against local climate in the best sowing window |
| Soil compatibility | pH, texture and compaction sensitivity against your soil |
| Nitrogen balance | Legumes before nitrogen-hungry crops; no back-to-back heavy feeders |
| Sequence compatibility | Same crop or family back to back, plant-family diversity |
| Erosion protection | Soil cover while growing and share of the year under a crop |
| Organic matter | Residue returned, green-manure or fodder crops |
| Water saving | Average crop water use |
| Market fit | Overlap with crops you can sell (neutral if not given) |
| Forage potential | Fodder value of the crops |
| Equipment fit | Machinery the crops usually need vs what you listed (neutral if not given) |

- **Each strategy** shows a sow/harvest schedule, benefits, risks and **missing information**. Unknown inputs are scored neutrally and listed rather than hidden.
- **Winter-hardy crops** (winter wheat, winter rye) are modelled simply: sown in autumn while temperature is falling within a sowing range (5–17 °C wheat, 3–17 °C rye), they need at least one month ≤ 10 °C (a rough vernalisation proxy), treat cold months as dormancy, and fail if a monthly mean falls below their hardiness limit (−12 °C wheat, −20 °C rye).
- At most one green-manure or fodder crop is allowed per cycle so suggestions stay productive.

### 6. Historical Climate Replay — `/explore/replay`

Replays rotations against every year of NASA POWER weather since 2001 (monthly temperature, rainfall and soil wetness, plus daily extremes).

- **Rotations:** up to three, picked by hand or loaded automatically from your last comparison on the Rotation page.
- **Season outcomes:** each crop is replayed in every year at its best-match sowing month and rated **Favourable** (match ≥ 75 %), **Marginal** or **Unfavourable** (< 50 %) from temperature suitability and usable water, with the main cause (water, heat or cold) and the soil-wetness anomaly for reference.
- **Daily extremes:** days at or above a crop-specific heat threshold (8 °C above the top of the crop's optimum, capped 30–42 °C) and the longest dry spell between the first and last substantial rain (≥ 5 mm); dry spells of 15+ days are flagged only in seasons with at least 150 mm. These add context and do not change the rating.
- **Resilience:** favourable and unfavourable shares, "bad years" (at least half the crops unfavourable) and the weakest crop.
- **Interactive timeline:** a crop-by-year grid; click a season for the reasons and a water-supply chart.
- **Scenarios:** sliders for rainfall (−50 % to +30 %) and warming (0 to +4 °C), and a table comparing every rotation under observed history, 20 % less rain, 2 °C warmer, both, and your own scenario.
- **Trends:** annual rainfall and temperature with a straight-line trend per decade.

*Sanity check:* for a semi-arid Rajasthan field, rainfed sorghum is rated Unfavourable in 2002 (about 73 mm of season rain, the 2002 drought year), Marginal in 2009 and Favourable in wet years such as 2019.

### 7. Evidence Passport — `/explore/passport`

A printable evidence report for the current rotation and every suggested alternative, built from the farm details entered on the Rotation page plus live data for the saved field (NASA POWER climate and water stress, the SoilGrids profile and any saved soil test, and optionally Sentinel-2 vegetation). Per-source progress is shown while loading, and satellite vegetation can be skipped while waiting.

For each rotation the passport contains:

1. **Why it was suggested:** the criteria where it beats the current rotation by the most points, plus the historical-replay comparison, each tagged with the datasets behind it.
2. **Evidence for each claim:** a ledger of claim → evidence → kind of evidence → datasets. Only datasets that were actually loaded count.
3. **Datasets supporting it,** with NASA datasets marked; Sentinel-2 (ESA) and SoilGrids (ISRIC) are labelled non-NASA, and NASA GIBS is labelled visual-only because it feeds no score.
4. **Historical conditions considered:** seasons replayed, favourable and unfavourable shares, bad years, weakest crop and four climate scenarios.
5. **Potential soil and water effects** against the current rotation (water use, legume share, time under crop, organic matter, plant-family diversity), with trade-offs and a note that they are potential, not measured, effects.
6. **Risks, uncertainties and missing information,** then **questions to take to a local agronomist** generated from the findings.

It also provides an **evidence-confidence rubric** (climate record 2, soil 2, satellite observations 2, market information 1, equipment information 1, minus 1 for freezing-winter climates), **capped at Medium** because crop requirements are generalised and nothing is validated locally; a **satellite reality check** that compares the field's greenest month with the growing windows expected for your current crops (consistent, not matching, or inconclusive; it is a consistency check, not a crop map); and exports as **print/PDF** (all rotations, one per page), **Markdown** and **JSON**. Each passport ID is a hash of its inputs, and every page and export ends with the reminder to validate locally.

---

## 4. How Agrimetry treats evidence

Every number Agrimetry shows rests on one of five kinds of evidence, and the Evidence Passport labels them and never blends them:

| Kind | Meaning | Examples |
|---|---|---|
| **Satellite observation** | Measured by a sensor over your field | Sentinel-2 NDVI |
| **Modelled estimate** | Produced by a weather, reanalysis or machine-learning model for a grid cell | NASA POWER climate and soil wetness (MERRA-2), SoilGrids |
| **Farmer-provided** | Information you entered | Current rotation, soil test, priorities |
| **General reference** | Generalised values for typical crops | The crop database |
| **Agrimetry analysis** | Calculated from the above | Scores, replay ratings, scenarios |

Working rules: unknown is shown as unknown (never as zero or "bare"); missing inputs are listed, not hidden; NASA and non-NASA data are labelled; confidence is capped at Medium; and the results are decision support that must be validated locally.

---

## 5. Data sources and attribution

| Source | Provider | NASA? | Used for | Access / notes |
|---|---|---|---|---|
| NASA POWER daily and monthly point APIs | NASA POWER (MERRA-2 reanalysis) | Yes | Climate, rain, temperature, soil wetness; baselines, replay, water stress, rotation | Public REST API, no key. About 50 km grid; about two days of lag. |
| NASA GIBS (SMAP L4, GPM IMERG, MODIS) | NASA EOSDIS | Yes | Soil-moisture and rain imagery; MODIS true colour on the map | Public WMTS tiles. Imagery only, not point values. |
| Sentinel-2 L2A (`sentinel-2-c1-l2a`) | Copernicus / ESA | No | NDVI, vegetation, bare-field detection | Public COG files on AWS. "Contains modified Copernicus Sentinel data." |
| Earth Search STAC | Element 84 | No | Sentinel-2 scene discovery | `earth-search.aws.element84.com/v1`, public best-effort service. |
| SoilGrids 2.0 | ISRIC – World Soil Information | No | Soil properties by depth | `rest.isric.org`, CC BY 4.0, 250 m predictions, slow and rate limited. |
| Fields of the World / PRUE | Source Cooperative | No | Predicted field boundaries on the map | PMTiles, CC BY 4.0. Model-derived outlines. |
| OpenStreetMap | OSM contributors | No | Street basemap | Public tiles with their own usage policy. |
| Esri World Imagery | Esri | No | Satellite basemap | External tiles; follow Esri's terms. |
| Open-Meteo Geocoding | Open-Meteo (GeoNames-based) | No | Place search | Public endpoint behind `/api/geocode`. |
| Crop requirement database | Agrimetry (FAO-style generalised values) | No | Rotation, replay, passport | `lib/rotation/crops.js`; approximate, not calibrated locally. |

SMAP and IMERG *point values* need a NASA Earthdata login, which is not configured, so they appear as map imagery only; soil wetness numbers come from NASA POWER (MERRA-2), not from SMAP retrievals.

Documentation: [NASA POWER API](https://power.larc.nasa.gov/docs/services/api/) · [NASA GIBS](https://www.earthdata.nasa.gov/data/tools/gibs) · [Earth Search](https://earth-search.aws.element84.com/v1) · [SoilGrids](https://www.isric.org/explore/soilgrids) · [FAO-56](https://www.fao.org/4/x0490e/x0490e00.htm) · [GeoTIFF.js](https://geotiffjs.github.io/) · [Proj4js](https://proj4js.org/) · [PNGjs](https://github.com/pngjs/pngjs)

**Sentinel-2 details.** Red B04 and near-infrared B08 are nominally 10 m; the SCL cloud/shadow mask is 20 m and nearest-neighbour resampled for masking. The analysis grid is capped at 512 × 512 cells (larger fields are downsampled and the effective scale is reported), and a 10 m band does not guarantee many clear pixels in a small or irregular field.

---

## 6. API reference

All routes are server-side Next.js route handlers. Latitude/longitude are validated; empty values are rejected.

| Route | Purpose |
|---|---|
| `GET /api/environment?lat&lon` | NASA POWER daily agroclimatology (`T2M`, `T2M_MAX`, `T2M_MIN`, `PRECTOTCORR`, `RH2M`, `ALLSKY_SFC_SW_DWN`), monthly summary and 365-vs-365-day comparison |
| `GET /api/geocode?q` | Place-name lookup (Open-Meteo) |
| `POST /api/vegetation` | Sentinel-2 NDVI analysis for a polygon (below) |
| `GET /api/water-stress?lat&lon&months=3-12` | Monthly stress ratings, rainfall vs normal, ET0, water balance, 3-month rainfall index, aridity class, soil wetness, declining periods, dry spells |
| `POST /api/bare-field` | Same body as vegetation; bare periods, crop cycles, cover-crop windows, erosion exposure (a 12-month run can take a couple of minutes) |
| `POST /api/soil-health` | `{ field, mode: "topsoil" \| "deep" \| "intervals", samplePoint }`; staged SoilGrids lookup. 404 if no estimate nearby, 504 if too slow |
| `GET /api/climate-normals?lat&lon` | NASA POWER monthly `T2M` and `PRECTOTCORR` since 2001 for the rotation engine |
| `GET /api/climate-history?lat&lon` | Year-by-year monthly `T2M`, `PRECTOTCORR`, `GWETROOT` plus compact daily `T2M_MAX` and `PRECTOTCORR` for the replay |

### `POST /api/vegetation`

```json
{
  "field": {
    "type": "Feature",
    "properties": { "fieldName": "North field" },
    "geometry": {
      "type": "Polygon",
      "coordinates": [[[75.0, 26.0], [75.001, 26.0], [75.001, 26.001], [75.0, 26.001], [75.0, 26.0]]]
    }
  },
  "startDate": "2025-11-01",
  "endDate": "2026-11-01",
  "cloudLimit": 70
}
```

`geometry` may be sent directly instead of `field.geometry`. The endpoint validates polygon coordinates, dates (at most 12 months, Sentinel-2 era onward, not in the future), cloud threshold (0–100) and analysis size. The response contains the source and collection, composite and monthly NDVI, valid-pixel coverage and scale, transparent PNG overlays (`map.imageDataUrl`, `lowVegetation.imageDataUrl`, `fieldVariability.zonesImageDataUrl`) with their corner coordinates, `fieldVariability`, `phenology`, quality notes, per-scene details and caveats.

---

## 7. Project structure and browser storage

```
app/
  page.js                     landing page
  explore/                    Environmental Explorer
    map/                      Global Farm Map (draw and save fields)
    vegetation/  water-stress/  bare-field/  soil-health/
    rotation/  replay/  passport/       one folder per feature (page, client component, CSS)
  api/                        server route handlers (see the API reference)
lib/                          analysis code, pure functions where possible so it runs in the browser or on the server
  vegetation/    Sentinel-2 NDVI pipeline, management zones, phenology
  water-stress/  NASA POWER water-stress analysis
  climate/       ET0, aridity and the standardized rainfall index
  bare-field/    bare-period, crop-cycle and erosion detection
  soil-health/   SoilGrids client and soil interpretation
  rotation/      crop database and the multi-criteria rotation engine
  replay/        historical season replay, extremes and scenarios
  passport/      Evidence Passport builder and exports
```

Agrimetry has **no database and no accounts**. Your work lives in browser `localStorage`:

| Key | Content |
|---|---|
| `agrimetry:global-farm-map:v1` | Saved field boundaries |
| `agrimetry:vegetation:selected-field:v1` | The field currently selected across pages |
| `agrimetry:soil-test:v1:<fieldId>` | Your soil-test values for a field |
| `agrimetry:rotation:last:v1` | Last rotation comparison (used by Climate replay) |
| `agrimetry:rotation:inputs:v1` | Your farm details from the Rotation page (used by the Evidence Passport) |

Clearing site data removes them. Nothing is sent to a server except the field geometry and coordinates needed to fetch public data.

---

## 8. Development notes

- **Stack:** Next.js 16 (App Router) with React 19, MapLibre GL JS, PMTiles, Terra Draw, Turf.js, GeoTIFF.js, Proj4js and PNGjs. Node.js 20.9 or newer.
- **Scripts:** `npm run dev`, `npm run build`, `npm start`, `npm run lint`.
- **Build needs the network:** the app loads Google Fonts through `next/font`, so `npm run build` fails in an offline environment.
- **Lint status:** the code is clean apart from a known `react-hooks/set-state-in-effect` warning on the pattern used to load saved fields from `localStorage` on mount.
- **Tests:** there is no automated test suite yet. The analysis libraries are pure functions and were checked by hand against live NASA POWER, Sentinel-2 and SoilGrids responses and known cases (for example the FAO-56 radiation example and the 2002 Rajasthan drought). Adding unit tests for `lib/` is a roadmap item.
- **Adding or tuning a crop:** edit `lib/rotation/crops.js` (growing months, temperature range, water use, pH, texture, nitrogen, equipment). Criterion weights are in `buildWeights` in `lib/rotation/engine.js`.
- **Credentials:** none are used. If a future provider needs a key, keep it in a server-side environment variable and never expose it to client code. Public access does not remove provider terms: keep the Copernicus, NASA, OpenStreetMap, Esri, ISRIC and Fields of the World attributions and review each provider's terms before public deployment.
- **Public services:** Earth Search, SoilGrids and the map tile providers are best-effort and can be slow or unavailable; the app surfaces those failures instead of hiding them.

---

## Story-first experience and interface refinements

Agrimetry presents each analysis as a story about a specific field rather than a list of disconnected measurements. The intended reading flow is:

1. **The place:** identify the selected field and the observation period.
2. **What the data saw:** show the satellite, climate or soil observation with its date, spatial resolution and source.
3. **What changed:** compare the observation with an earlier period or a relevant baseline where data supports that comparison.
4. **What it could mean:** explain plausible interpretations without presenting correlation as proof or guessing at causes.
5. **What to look at next:** give a practical field check or a question to discuss with a local agronomist.
6. **How certain is this:** state missing observations, cloud coverage, model uncertainty, scale mismatch and other limitations beside the interpretation.

The soil-health page now includes a plain-language field story that connects texture, organic carbon, pH and flagged limitations. It distinguishes farmer-entered test results from SoilGrids estimates and avoids treating a modelled profile as a laboratory diagnosis.

The shared analytical-page styles have also been refined:
- Compact, consistent form controls and dropdowns, with bounded widths so long options do not stretch cards.
- More predictable vertical and horizontal scrolling, including thin scrollbars and contained table scrolling.
- Better keyboard focus visibility, responsive spacing and reduced-motion support.
- More readable narrative paragraphs and consistent story-panel spacing.
- The map workspace keeps its map canvas fixed while side panels scroll independently.

These are presentation improvements only; they do not change the underlying scientific calculations or data sources.

## 9. Limitations and responsible use

- **NDVI** shows greenness, not yield, crop type, disease, soil fertility or soil moisture. Low NDVI can mean bare soil, fallow, water, buildings, a harvested or newly sown crop, or stress.
- **One clear Sentinel-2 image per month** represents each month; short events can be missed, and months without a usable image stay blank. Sentinel-2 coverage here spans about 56°S to 84°N; farms crossing the equator, a UTM or Sentinel-2 tile boundary, or larger than 100 km must be split.
- **Climate, rainfall and soil wetness** are NASA POWER grid-cell estimates about 50 km wide, not measurements at the field. ET0 is a temperature-based Hargreaves–Samani estimate.
- **SoilGrids** is a 250 m machine-learning prediction with wide uncertainty for some properties (organic carbon especially), and can be slow or unavailable.
- **Crop values are generalised** FAO-style approximations (growing length, temperature, water, pH, texture, nitrogen). Scores rank options; they are **not** yield or profit forecasts and have not been validated locally.
- **Not modelled:** intercropping, perennials, tillage, fertiliser practice, price data, frost and flood risk, soil nutrients and salinity, snow cover and winterkill detail.
- **Replay and scenarios** use monthly weather plus daily heat and dry-spell counts, so events inside a month are only partly captured. Scenarios shift every month by the same amount; they are sensitivity tests, not climate projections.
- **Fields of the World** outlines are not legal parcel boundaries and must be verified by the farmer.
- Always **confirm any change to your rotation with a local agronomist or extension service.**

---

## 10. Roadmap

The seven planned features are in place. Next, roughly in order of value:

1. **Local validation:** district crop calendars and agronomic advice, so the Evidence Passport can cite regional sources and raise confidence beyond Medium.
2. **SMAP and IMERG point time series** (needs NASA Earthdata credentials) to complement the MERRA-2 soil-wetness analysis.
3. **Landsat observations** to improve bare-field timing between Sentinel-2 passes.
4. **Soil health:** nutrients (N, P, K), salinity and cation-exchange capacity from farmer tests.
5. **Rotation engine:** more crops and regions, fuller cold-climate modelling (snow cover, winterkill), local variety calendars and price data.
6. **Climate replay:** event-level weather and regional climate-change projections.
7. **Engineering:** a shared field and profile store instead of browser storage, an automated test suite for `lib/`, and resolving the remaining lint warnings.

---

*Data: NASA POWER (NASA Langley Research Center POWER Project), NASA GIBS, Copernicus Sentinel-2 (ESA), ISRIC SoilGrids, Fields of the World, OpenStreetMap contributors and Esri. See [section 5](#5-data-sources-and-attribution). No licence file has been added to this repository yet.*
