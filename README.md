# Agrimetry

**Understand your land. Grow with intelligence.**

Agrimetry is a global agricultural decision-support prototype. A farmer draws their real field boundary, reads what satellites and NASA climate data say about that field, and compares crop rotations with every score explained and every source labelled. It is being developed for the NASA Space Apps Challenge 2026 crop-rotation challenge.

It combines NASA resources (NASA POWER climate and soil wetness, NASA GIBS imagery) with openly accessible non-NASA datasets (Sentinel-2, ISRIC SoilGrids, Fields of the World, OpenStreetMap). It is designed to support farmer decisions, not replace local agronomic advice or field measurements.

## Status

All seven features on the project roadmap now have a working first version. They are prototypes: the data pipelines run on live public data, but crop requirements are generalised and nothing has been validated against local agronomic advice (see [Scientific limitations](#6-scientific-limitations-and-responsible-interpretation)).

| # | Feature | Page | Main data |
|---|---|---|---|
| 1 | Field Vegetation Intelligence | `/explore/vegetation` | Sentinel-2 L2A (ESA, not NASA) |
| 2 | Soil Moisture & Water Stress | `/explore/water-stress` | NASA POWER; NASA GIBS (SMAP, IMERG imagery) |
| 3 | Automatic Bare-Field Detection | `/explore/bare-field` | Sentinel-2 NDVI + NASA POWER rainfall |
| 4 | Soil Health Intelligence | `/explore/soil-health` | ISRIC SoilGrids + farmer soil test |
| 5 | Crop Rotation Intelligence Engine | `/explore/rotation` | NASA POWER + SoilGrids + crop database |
| 6 | Historical Climate Replay | `/explore/replay` | NASA POWER (25 years, monthly and daily) |
| 7 | Evidence Passport | `/explore/passport` | All of the above |

The foundation they sit on: a landing page (`/`), an Environmental Explorer (`/explore`) and a Global Farm Map (`/explore/map`) where fields are drawn and saved.

### How the pieces fit together

1. **Draw and save a field** on the Global Farm Map.
2. **Look at the field:** vegetation (greenness, management zones, seasonal pattern), water stress (rainfall, ET0, drought index), bare-field periods and soil health.
3. **Compare rotations** on the Rotation page, then **replay** them against 25 years of real weather and test drier or warmer scenarios.
4. **Generate the Evidence Passport:** a printable report that says, for every rotation, why it was suggested, which datasets support it, what is uncertain or missing, and what to validate locally.

---

## 1. Current capabilities

### Public landing page — `/`

- Agrimetry product landing page with its forest-green and sandy visual identity.
- Explains the Earth-observation and crop-rotation decision-support concept.
- Links into the Explore workspace.

### Environmental Explorer — `/explore`

- Farm and location-oriented environmental workspace.
- Retrieves daily meteorological information for latitude/longitude from the NASA POWER Agroclimatology API.
- Displays temperature, precipitation, humidity and solar-radiation indicators where returned by the API.
- Compares the most recent 365-day period with the preceding 365-day period.
- Includes monthly climate summaries and source/measurement caveats.
- Provides navigation to the Global Farm Map and to every field-level analysis page.

### Global Farm Map — `/explore/map`

- Global interactive map rendered with MapLibre GL JS.
- Street basemap using OpenStreetMap tiles and satellite basemap using Esri World Imagery tiles.
- Coordinate entry, global place search and optional browser geolocation.
- Farm-boundary creation with trace-points/polygon, freehand and rectangle tools; existing boundaries can be edited.
- Multiple fields can be created, inspected and removed.
- Calculates area in hectares/acres using Turf.js.
- Imports and exports GeoJSON boundaries.
- Saves field boundaries in this browser's `localStorage` under `agrimetry:global-farm-map:v1`.
- Optional NASA GIBS MODIS true-colour visualization layer for broad Earth-observation context.
- Global predicted field-boundary overlay from the Fields of the World / PRUE dataset distributed as PMTiles. These are model-derived field units, not legal cadastral parcels; every outline must be reviewed and corrected by the farmer.

### Field Vegetation Intelligence — `/explore/vegetation`

This release uses a **public STAC catalog and public Sentinel-2 Cloud-Optimized GeoTIFF (COG) assets**. 

The farmer chooses a saved Polygon or MultiPolygon field from the Global Farm Map. Agrimetry sends that selected GeoJSON geometry (not just its centre coordinate) to the server-side vegetation API.

Processing flow:

1. The server validates the selected farm geometry and requested date window.
2. Agrimetry searches the Element 84 Earth Search STAC API for `sentinel-2-c1-l2a` scenes intersecting the selected field and date range.
3. It filters scenes by the user-selected scene-level cloud-cover threshold.
4. It reads the scene's public red (`B04`), near-infrared (`B08`) and Scene Classification Layer (`SCL`) COG assets using HTTP range requests via GeoTIFF.js.
5. It applies the Sentinel-2 BOA reflectance scale/offset metadata and masks no-data, defective/saturated, dark-area, cloud-shadow, unclassified, cloud and snow classes from SCL.
6. It calculates NDVI for pixel centres inside the selected field geometry using `(NIR - RED) / (NIR + RED)`.
7. For each month it selects the lowest-cloud candidate that can be processed with complete raster coverage (up to two candidates are tried). Months without a usable clear observation remain missing; they are not filled with zero.
8. It computes a pixel-wise median composite from the selected monthly scenes, field mean/median NDVI, monthly observations and valid-pixel coverage.
9. It returns a transparent PNG overlay clipped to the submitted farm geometry, plus statistics, dates, scene metadata and quality notes. The UI places that overlay on the selected field map and displays a monthly time-series chart and observation table.

**Low-vegetation areas.** The composite NDVI is screened for pixels that are unusually low *relative to the rest of the same field*: below the field median minus the larger of 1.5 robust standard deviations (MAD-based) or 0.08 NDVI, ignoring isolated single pixels. The result (flagged hectares, share of clear pixels, threshold) is returned as `lowVegetation` with a red overlay (`imageDataUrl`) shown on the map. It is skipped when the whole field is low (median NDVI < 0.2, e.g. fallow/bare ground). It shows *where* the signal is low, not *why*.

**Previous-season comparison.** After the main report, the page can run the same analysis for the same months one year earlier (`/api/vegetation` called again with dates shifted back 12 months) and overlays that series on the time-series chart, with a per-month difference table. Months are matched by calendar position; only months with a clear reading in both years are compared. Differences may reflect a different crop, sowing date or weather, not only crop condition.

**Management zones and variability.** The composite NDVI is also summarised inside the field: relative zones (thirds of the field's own NDVI distribution) with hectares and mean NDVI, fixed NDVI classes (bare / sparse / moderate / dense) with hectares, the P10–P90 spread and a plain-language uniformity label. A **Zones** map layer shows where the zones fall. Zones show where greenness differs, not why, and are meant to guide scouting and soil sampling.

**Seasonal pattern.** From the monthly series the app reports the greenest and least green months, the seasonal swing, the months above the halfway level, the fastest rise and fall, and a pattern label (steady cover, one green period, several green periods). It is based on one clear observation per month.

**Resilience.** Searches of the public Earth Search catalogue are retried on network timeouts, and up to four months are read in parallel.

**Important source distinction:** Sentinel-2 is an ESA/Copernicus mission, not a NASA mission. Earth Search (Element 84) is the public STAC catalog; the Sentinel-2 COG assets are openly accessible from AWS. Agrimetry's current NASA data integrations are NASA POWER and the NASA GIBS visualization layer.

### Soil Moisture & Water Stress — `/explore/water-stress`

Uses the centre of a saved field to compare the last 6–12 months with the same calendar months from 2001 onward, using **NASA POWER** (MERRA-2 based; no login needed):

- Daily `GWETROOT` (root-zone wetness), `GWETTOP` (surface wetness), `PRECTOTCORR` (rain) and `T2M_MAX`; monthly history for the seasonal baseline.
- **Rainfall vs normal:** each month is compared with the average for the same month and number of observed days.
- **Declining soil moisture:** runs of at least three weekly declines in root-zone wetness totalling 0.06 or more.
- **Water Stress Timeline:** each month is scored from root-zone wetness anomaly, rainfall ratio, very low absolute wetness and heat (Normal / Watch / Moderate / Severe). It is a screening indicator, not a drought declaration.
- **NASA GIBS map layers:** SMAP L4 root-zone and surface soil moisture and GPM IMERG precipitation rate, selectable by date. These are visual context only; SMAP L4 has a delay of several days and occasional gaps.

**Evaporative demand and drought indices.**
- **ET0** (reference evapotranspiration) uses the Hargreaves–Samani equation (FAO-56) from POWER daily maximum/minimum temperature and latitude, checked against the FAO-56 extraterrestrial-radiation example. It is a temperature-based screening estimate and overestimates in some humid or windy places.
- **Climatic water balance** = rainfall − ET0 for each month, compared with the normal for the same days.
- **Aridity index** = annual rainfall / annual ET0 (UNEP classes), shown as the climate type of the field's grid cell.
- **3-month rainfall index (SPI-style)** ranks the last three months of rain against the same three months in every year since 2001 and converts the rank to a z-score. It is an empirical index, not the official gamma-fitted SPI.
- The monthly rating counts the worse of the rainfall ratio and the 3-month index once, then adds one compounding point for heat (≥ 2 °C above normal) or evaporative demand (≥ 10 % above normal).
- Baseline and observations now come from the same 25-year daily POWER record. (POWER's *monthly* `T2M_MAX`/`T2M_MIN` are the month's absolute extremes, not means of daily extremes, so they are not used.)

**Source distinction:** the soil wetness numbers come from NASA POWER (MERRA-2 model), not directly from SMAP retrievals. SMAP and IMERG *point values* require a NASA Earthdata login (not configured here), so they appear as map imagery only.

### Automatic Bare-Field Detection — `/explore/bare-field`

Built on the monthly Sentinel-2 NDVI series (up to 12 months) plus NASA POWER rainfall:

- **Cover state per month:** bare (NDVI < 0.20), sparse (0.20–0.35), green (≥ 0.35) or unknown. Months with no clear reading, or fewer than 30% clear pixels, are *unknown*, never assumed bare.
- **Bare / low-cover periods:** consecutive low months (unknown months inside a low stretch do not end it; the period is marked *partly observed*).
- **Crop cycles and seasonal gaps:** a green stretch whose peak NDVI reaches 0.45 counts as a crop cycle; a low period with a cycle before and after is a gap between cycles.
- **Cover-crop opportunities:** gaps of two or more months, with general guidance (cover crop, drought-tolerant cover or residue mulch) based on average rainfall in the gap. No species are recommended.
- **Erosion exposure:** low cover combined with monthly rainfall totals (Low / Moderate / High). It ignores rain intensity, slope, soil type and tillage.

Rainfall is optional context: if NASA POWER is unavailable, the detection still returns without erosion ratings. Soil- and crop-specific scoring is planned in later features.

### Soil Health Intelligence — `/explore/soil-health`

- Looks up **ISRIC SoilGrids 2.0** (250 m, public, no key) for the field: organic carbon, pH, sand, silt, clay and bulk density at six depths (0–5, 5–15, 15–30, 30–60, 60–100, 100–200 cm). Values are shown with the 90% prediction interval (5th–95th percentile) and a plain confidence marker.
- Samples a point inside the field nearest its middle; if SoilGrids has no value there (urban, water or masked cells) it tries nearby points, and says so when it does.
- **Farmer soil test:** enter pH, organic carbon (%), sand/silt/clay (%) and bulk density. Values are stored in this browser per field, replace the SoilGrids topsoil estimate, and the interpretation updates instantly. Notable disagreements with SoilGrids are flagged.
- **Soil Intelligence Profile:** USDA texture class, organic-carbon / pH / bulk-density ratings (topsoil = depth-weighted 0–30 cm), possible limitations (low organic carbon, strong acidity or alkalinity, compaction, light or heavy soils), and what each means for crop choice and rotation planning. These are general guidance, not crop-specific scores.

SoilGrids is a free research service that answers slowly (roughly one second per property, depth and statistic) and has rate limits, so lookups are staged: a one-layer probe finds a sample point with data, then the 0–30 cm means load first (the profile appears from these). Deeper layers (30–200 cm) and the 90% prediction intervals (top 30 cm) are loaded on demand with buttons on the page. Results are cached on the server for a week.

### Crop Rotation Intelligence Engine — `/explore/rotation`

Compares the farmer's current rotation with generated alternatives for a saved field.

- **Inputs:** current rotation (2–4 crops in order), one or two crops per year, irrigation level (rainfed / limited / reliable), priorities (water, soil health, market, forage, equipment, each 1–5), optional crops you can sell, optional equipment list, and soil data (SoilGrids plus any soil test saved on the Soil health page).
- **Climate:** 25-year monthly temperature and rainfall normals from NASA POWER for the field centre (`/api/climate-normals`). Rain includes a share stored from the two months before sowing; 85% of a crop's typical water use counts as full coverage.
- **Strategies:** every valid sequence of the ~21 crops in the database is scored; the app shows the current rotation plus the best sequences for your priorities, a soil-building focus, a water-saving focus and (if you listed sale crops) a market focus. At least three strategies are compared including the current one.
- **Ten explainable criteria (0–100 each):** climate & water fit, soil compatibility (pH, texture, compaction), nitrogen balance (legumes before nitrogen-hungry crops), sequence compatibility (same crop or family back to back, diversity), erosion protection, organic matter, water saving, market fit, forage potential, equipment fit. Weights follow your priorities and are shown.
- **Output per strategy:** sowing/harvest schedule, benefits, risks and **missing information**; unknown inputs are scored neutrally and listed rather than hidden.
- All scoring runs in the browser from pure functions in `lib/rotation`, so changing inputs re-ranks instantly once climate and soil are loaded.

**Important limits.** Crop values in `lib/rotation/crops.js` (growing length, temperature, water use, pH, texture, nitrogen) are generalised, FAO-style approximations. They rank options; they do not predict yield or profit and must be checked locally. Winter-hardy crops (winter wheat, winter rye) are modelled simply: they are sown in autumn when the monthly mean temperature is falling within a sowing range (5–17 °C for wheat, 3–17 °C for rye), need at least one month at or below 10 °C (a rough vernalisation proxy), count cold months as dormancy rather than failure, and fail if a monthly mean falls below their hardiness limit (−12 °C wheat, −20 °C rye). Snow cover, ice and freeze–thaw winterkill, true vernalisation requirements and snowmelt water are not modelled, so freezing-winter locations still carry a lower-confidence warning. Intercropping, perennials, tillage, fertiliser practice, price data, frost and flood risk, and soil nutrients/salinity are not modelled. At most one green-manure/fodder crop is allowed per cycle.

### Historical Climate Replay — `/explore/replay`

Replays rotations against 25 years of real climate (NASA POWER monthly temperature, rainfall and root-zone wetness, 2001 to last year).

- **Rotations to replay:** up to three, picked by hand or loaded automatically from your last comparison on the Rotation page (saved in this browser).
- **Season outcomes:** every crop is replayed in every year at its best-match sowing month. Each season is rated Favourable (match ≥ 75%), Marginal or Unfavourable (< 50%) from temperature suitability and usable water (in-season rain, a share of the previous two months' rain, irrigation) against the crop's typical need, with the main cause stated (water, heat or cold) and the soil-wetness anomaly for reference.
- **Rotation resilience:** share of favourable and unfavourable seasons, "bad years" (at least half the crops unfavourable) and the weakest crop.
- **Interactive timeline:** crop-by-year grid; click a season for the reasons and a water-supply chart for that crop.
- **Scenarios:** sliders for rainfall change (−50% to +30%) and warming (+0 to +4 °C) re-rate all 25 years; a table compares every rotation under observed history, 20% less rain, 2 °C warmer, both, and your own scenario.
- **Trends:** annual rainfall and temperature with a straight-line trend per decade.

Sanity check: for a semi-arid Rajasthan field, rainfed sorghum is rated Unfavourable in 2002 (about 73 mm of season rain, the 2002 drought year), Marginal in 2009 and Favourable in wet years such as 2019.

**Daily extremes.** When daily data are available (NASA POWER daily maximum temperature and rainfall, 2001 onward), each season also reports days at or above a crop-specific heat-stress threshold (8 °C above the top of the crop's optimum temperature, capped 30–42 °C) and the longest dry spell between the first and last substantial rain (≥ 5 mm). A dry spell of 15+ days is flagged only in seasons that receive at least 150 mm. These are shown for context and do not change the rating; scenarios shift daily temperature and rainfall too.

**Limits.** Monthly ratings hide heat waves, dry spells and storms inside a month (the extremes above help, but they are rules of thumb). Ratings show how favourable the weather was, not yield. Scenarios shift every month uniformly and are sensitivity tests, not regional climate projections. Soil wetness is a MERRA-2 model value and is not changed by scenarios.

### Evidence Passport — `/explore/passport`

A printable evidence report for the current rotation and every suggested alternative, built from the farm details entered on the Rotation page plus live data for the saved field. It gathers NASA POWER climate (25 years) and water-stress, the SoilGrids profile plus any saved soil test, and optionally Sentinel-2 vegetation, and shows per-source progress while loading (satellite vegetation can be skipped while waiting).

For each rotation the passport contains:
1. **Why it was suggested:** the criteria where it beats the current rotation by the most points, plus the historical-replay comparison, each tagged with the datasets behind it.
2. **Evidence for each claim:** a ledger of claim → evidence → kind of evidence → datasets. Only datasets that were actually loaded count as evidence.
3. **Datasets supporting it:** NASA datasets are marked. Sentinel-2 (ESA) and SoilGrids (ISRIC) are labelled as non-NASA, and NASA GIBS (SMAP, IMERG) is labelled visual-only because it feeds no score.
4. **Historical conditions considered:** seasons replayed, favourable/unfavourable shares, bad years, weakest crop and the four climate scenarios.
5. **Potential soil and water effects** against the current rotation (water use per crop, legume share, time under crop, organic matter, plant-family diversity), with trade-offs, and an explicit note that these are potential, not measured, effects.
6. **Risks, uncertainties and missing information**, then **questions to take to a local agronomist** generated from the findings.

Evidence is kept in five kinds, always labelled: *satellite observation*, *modelled estimate*, *farmer-provided*, *general reference* (generalised crop values) and *Agrimetry analysis*.

**Evidence confidence** is a transparent rubric (climate record 2, soil 2, satellite observations 2, market information 1, equipment information 1, minus 1 for freezing-winter climates, where winter crops are modelled only simply). It is capped at **Medium** because crop requirements are generalised and nothing is validated locally.

**Satellite reality check.** When vegetation is included, the field's greenest month is compared with the growing windows expected for the farmer's current crops and reported as consistent, not matching, or inconclusive (steady greenness). It is a consistency check, not a crop map.

Exports: print or save as PDF (all rotations, page break per rotation), Markdown text, and JSON. Each passport has an ID derived from a hash of its inputs. Every page and export ends with the reminder to validate locally.

---

## 2. Data sources and attribution

| Source | Used for | Access / notes |
|---|---|---|
| NASA POWER Daily Point API | Temperature, precipitation, humidity and solar radiation | Public REST API; no API key is configured in this project. |
| NASA POWER Daily/Monthly Point API (soil wetness) | Root-zone and surface soil wetness, rainfall and temperature history for water stress | MERRA-2 model estimates; no API key. Data lag about two days. |
| ISRIC SoilGrids 2.0 | Soil properties by depth for the Soil Health profile | Public REST API (rest.isric.org), CC BY 4.0; 250 m model predictions with uncertainty, variable latency. |
| NASA GIBS (SMAP L4, GPM IMERG) | Soil-moisture and rainfall imagery on the water-stress map | Public WMTS tiles; imagery only, not point values. |
| NASA GIBS | MODIS true-colour visualization overlay on the map | Public NASA visualization tiles; this is a rendered imagery layer, not a farm-specific analysis product. |
| Copernicus Sentinel-2 MSI Level-2A | Red/NIR surface reflectance and SCL for NDVI | `sentinel-2-c1-l2a` collection through Earth Search; public COG assets. Sentinel-2 is ESA/Copernicus, not NASA. |
| Element 84 Earth Search | STAC scene discovery and metadata | `https://earth-search.aws.element84.com/v1`; public best-effort service, no API key used. |
| Fields of the World / PRUE | Predicted field-boundary vector overlay | PMTiles hosted by Source Cooperative; attribution and CC BY 4.0 terms are shown in the map. Model-derived outlines need farmer verification. |
| OpenStreetMap | Street basemap and map attribution | Public tile service with its own usage policy; use a suitable provider or self-hosted tiles for production-scale traffic. |
| Esri World Imagery | Satellite basemap | External tile service; follow Esri's applicable attribution and usage terms. |
| Open-Meteo Geocoding (GeoNames-based data) | Place-name lookup | Public geocoding endpoint used by `/api/geocode`. |

Useful source documentation:

- [NASA POWER API](https://power.larc.nasa.gov/docs/services/api/)
- [NASA GIBS](https://www.earthdata.nasa.gov/data/tools/gibs)
- [Earth Search STAC API](https://earth-search.aws.element84.com/v1)
- [Sentinel-2 C1 L2A collection metadata](https://earth-search.aws.element84.com/v1/collections/sentinel-2-c1-l2a)
- [GeoTIFF.js](https://geotiffjs.github.io/)
- [Proj4js](https://proj4js.org/)
- [PNGjs](https://github.com/pngjs/pngjs)

### Sentinel-2 bands and NDVI

- Red: B04, nominal 10 m.
- Near infrared: B08, nominal 10 m.
- Scene Classification Layer: SCL, nominal 20 m; nearest-neighbour resampled to the analysis output grid for masking.
- NDVI: `(B08 - B04) / (B08 + B04)` after reflectance scale/offset handling.

The output grid is capped at 512 × 512 cells per field analysis. Larger field extents are downsampled; the effective output scale is reported in the result. The nominal 10 m band resolution does not mean every field has many clear pixels. The 20 m SCL classification layer is a coarser cloud/shadow mask.

---

## 3. Routes and APIs

### `GET /api/environment?lat=<latitude>&lon=<longitude>`

Calls NASA POWER Daily Point API for the Agroclimatology community. The route requests:

- `T2M`
- `T2M_MAX`
- `T2M_MIN`
- `PRECTOTCORR`
- `RH2M`
- `ALLSKY_SFC_SW_DWN`

It returns daily records, units, a monthly summary and a descriptive comparison of the latest 365 days with the preceding 365 days. NASA POWER values are gridded estimates and are not direct measurements taken at the farm boundary.

### `GET /api/geocode?q=<place name>`

Uses the Open-Meteo Geocoding API to return candidate places with coordinates and administrative labels.

### `GET /api/water-stress?lat=<latitude>&lon=<longitude>&months=<3-12>`

Returns monthly stress ratings, rainfall vs seasonal normal, ET0 and water balance, 3-month rainfall index, aridity class, root-zone wetness vs normal, declining-moisture periods, dry-spell statistics, baseline details and caveats from NASA POWER.

### `POST /api/soil-health`

Request body: `{ "field": <GeoJSON Feature or geometry>, "mode": "topsoil" | "deep" | "intervals", "samplePoint": <sample from a topsoil response> }`. `topsoil` (default) probes for a sample point with data and returns 0–30 cm means; `deep` returns 30–200 cm means and `intervals` returns the 5th/95th percentile bounds for 0–30 cm, both at the given sample point. Values are converted to common units. Returns 404 when SoilGrids has no estimate nearby and 504 when it is too slow.

### `GET /api/climate-history?lat=<latitude>&lon=<longitude>`

Returns year-by-year monthly NASA POWER `T2M`, `PRECTOTCORR` and `GWETROOT` (2001 to last year) plus compact daily `T2M_MAX` and `PRECTOTCORR` arrays, used by the climate replay.

### `GET /api/climate-normals?lat=<latitude>&lon=<longitude>`

Returns NASA POWER monthly `T2M` and `PRECTOTCORR` for 2001 to last year, used by the rotation engine to build monthly normals.

### `POST /api/bare-field`

Same request body as `/api/vegetation`. Runs the Sentinel-2 vegetation analysis and NASA POWER rainfall in parallel and returns monthly cover states, bare/low-cover periods, crop cycles, cover-crop opportunities, erosion exposure, thresholds and caveats. A 12-month analysis can take a couple of minutes on the public COG storage; months are read four at a time.

### `POST /api/vegetation`

Request body:

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

The `geometry` property may be supplied directly instead of `field.geometry`. The endpoint validates polygon coordinates, date range, cloud threshold and analysis size. This release limits requests to 12 months to keep the COG reads manageable.

The response includes:

- Source and collection information.
- Composite mean and median NDVI.
- Monthly mean/median NDVI, scene date and cloud cover.
- Valid-pixel coverage and effective output scale.
- A transparent `imageDataUrl` plus geographic corner coordinates for the MapLibre image source.
- Cloud-mask, scene-selection, attribution and scientific caveats.

---

## 4. Installation and local setup

### Requirements

- Node.js 20.9 or newer (use a current LTS release).
- npm.
- Internet access for public map tiles, geocoding, NASA POWER, Earth Search STAC and public Sentinel-2 COG assets.

### Install dependencies

From the project root (the folder containing `package.json`):

```bash
npm install
```

The vegetation processor uses these additional JavaScript packages:

- `geotiff` — reads public Cloud-Optimized GeoTIFFs using HTTP range requests.
- `proj4` — transforms field coordinates into a local UTM analysis grid.
- `pngjs` — creates the transparent NDVI PNG returned to the map.

The mapping stack includes MapLibre GL JS, PMTiles, Terra Draw, its MapLibre adapter and Turf.js.

Then start the app:

```bash
npm run dev
```

Open:

- Landing page: `http://localhost:3000/`
- Environmental explorer: `http://localhost:3000/explore`
- Global Farm Map: `http://localhost:3000/explore/map`
- Field Vegetation Intelligence: `http://localhost:3000/explore/vegetation`
- Soil Moisture & Water Stress: `http://localhost:3000/explore/water-stress`
- Bare-Field Detection: `http://localhost:3000/explore/bare-field`
- Soil Health: `http://localhost:3000/explore/soil-health`
- Crop Rotation Engine: `http://localhost:3000/explore/rotation`
- Historical Climate Replay: `http://localhost:3000/explore/replay`
- Evidence Passport: `http://localhost:3000/explore/passport`

Useful checks:

```bash
npm run lint
npm run build
```

### Environment variables

The current public-source integrations do **not** require an `.env.local` file or user-specific API credentials. Do not add a Google Earth Engine service account for this implementation. If a future provider requires a key, add it only as a server-side environment variable and never expose it to client-side code. Public access does not remove data-provider terms: retain the required Copernicus, NASA, OpenStreetMap, Esri and Fields of the World attribution, and review each provider's applicable usage/licensing conditions before public deployment.

---

## 5. How to use Agrimetry end to end

1. Open `/explore/map`, search for the farm location or enter coordinates.
2. Draw a field with Trace points/Polygon, Freehand or Rectangle (or inspect a Fields of the World candidate and add it after review). Edit the boundary so it follows the real field and save it in the browser.
3. Open the analysis pages from the Explorer or the map layer list and choose the saved field:
   - **Vegetation:** pick dates and a cloud threshold; read the NDVI map, low areas, management zones, seasonal pattern and previous-year comparison.
   - **Water stress:** see rainfall, evaporative demand, the 3-month rainfall index and a month-by-month stress timeline, with NASA SMAP and IMERG imagery on the map.
   - **Bare fields:** find bare periods, gaps between crops, cover-crop windows and erosion exposure.
   - **Soil health:** load the SoilGrids profile and, optionally, enter your own soil test.
4. Open **Rotation engine**: enter your current rotation, irrigation, priorities, crops you can sell and machinery, then compare it with the best alternatives.
5. Open **Climate replay** to test those rotations against 25 years of weather and drier or warmer scenarios.
6. Open **Evidence passport** to generate the report; print or save it as PDF, or download it as Markdown or JSON.

If no field appears on a page, return to the Global Farm Map, save the boundary and reload. Fields live in your browser (see [Data stored in your browser](#9-data-stored-in-your-browser)), so they do not sync between browsers or devices. Export GeoJSON to keep a portable copy.

---

## 6. Scientific limitations and responsible interpretation

- NDVI indicates vegetation greenness/biomass-related reflectance patterns. It does not directly measure yield, crop type, plant disease, soil fertility, soil moisture or farmer profitability.
- Low NDVI can correspond to bare soil, fallow periods, water, built areas, harvested fields, sparse crops or stressed vegetation. Interpret it with crop type, planting/harvest dates and field observations.
- Each month currently uses one selected clear Sentinel-2 granule, not a complete mosaic of all acquisitions. If no usable scene covers the field, the month is shown as missing.
- The field geometry is used to mask statistics and the returned NDVI image, but it does not improve the native resolution of any satellite input.
- The Scene Classification Layer is 20 m, while B04/B08 are 10 m. Cloud masking therefore has coarser spatial detail than the red/NIR bands.
- A very small, narrow or irregular field may contain few valid output cells. Check valid-pixel coverage before interpreting summary statistics.
- Sentinel-2 usable observations depend on latitude, acquisition coverage, clouds and the selected dates. This release supports approximate land coverage from 56°S to 84°N; polar areas outside that range are rejected.
- Farms crossing the equator, spanning more than 100 km in the local analysis grid, or crossing Sentinel-2 tile/UTM boundaries may need to be divided into smaller fields.
- Earth Search is a public best-effort service with no guaranteed uptime or throughput. Catalog or COG outages can interrupt the analysis.
- NASA POWER and SMAP/GPM-like gridded observations must not be represented as exact field-level measurements when their native spatial resolution is much coarser than the field.
- Fields of the World predictions are not legal parcel boundaries and must be verified and edited by the farmer.
- Crop-rotation scores rank options against each other using generalised, FAO-style crop values (growing length, temperature, water use, pH, texture, nitrogen). They are not yield or profit forecasts and have not been validated locally; confirm any change with a local agronomist.
- Climate, rainfall and soil wetness come from NASA POWER (MERRA-2) grid cells about 50 km wide. Soil wetness is a model value, not a SMAP retrieval or a field measurement. ET0 is a temperature-based (Hargreaves–Samani) estimate.
- SoilGrids is a 250 m machine-learning prediction with wide uncertainty for some properties (organic carbon especially), and it can be slow or unavailable.
- Winter-hardy crops are modelled simply; freezing-winter locations carry a lower-confidence warning. Intercropping, perennials, tillage, fertiliser practice, price data, frost and flood risk are not modelled.
- Historical replay uses monthly weather (plus daily heat and dry-spell counts), so heat waves, storms and dry spells inside a month are only partly captured. Scenarios shift every month uniformly and are sensitivity tests, not climate projections.
- The Evidence Passport labels every statement by its kind of evidence and caps its confidence at Medium. It ends with the reminder that results must be validated locally.

---

## 7. Roadmap and next steps

The seven planned features are in place. Next steps, roughly in order of value:

1. **Local validation:** partner-contributed district crop calendars and agronomic advice, so the Evidence Passport can cite regional sources and raise confidence beyond Medium.
2. **SMAP and IMERG point time series** (needs NASA Earthdata credentials) to complement the MERRA-2 based water-stress analysis.
3. **Landsat observations** to improve bare-field timing between Sentinel-2 passes.
4. **Soil health:** nutrients (N, P, K), salinity and cation-exchange capacity from farmer tests.
5. **Rotation engine:** more crops and regions, fuller cold-climate modelling (snow cover, winterkill), local variety calendars and price data.
6. **Climate replay:** event-level weather and regional climate-change projections.
7. **Engineering:** a shared field/profile store (instead of browser `localStorage`), automated tests for the analysis libraries, and resolving the remaining `react-hooks/set-state-in-effect` lint warnings.

---

## 8. Project structure

```
app/
  page.js                    landing page
  explore/                   Environmental Explorer
    map/                     Global Farm Map (draw and save fields)
    vegetation/  water-stress/  bare-field/  soil-health/
    rotation/  replay/  passport/      one folder per feature (page + client component + CSS)
  api/                       server route handlers
    environment  geocode  vegetation  water-stress  bare-field
    soil-health  climate-normals  climate-history
lib/                         analysis code (pure functions where possible, so it can run in the browser or on the server)
  vegetation/   Sentinel-2 NDVI pipeline, zones and phenology
  water-stress/ NASA POWER water-stress analysis
  climate/      ET0, aridity and standardized rainfall index
  bare-field/   bare-period, cycle and erosion detection
  soil-health/  SoilGrids client and soil interpretation
  rotation/     crop database and multi-criteria rotation engine
  replay/       historical season replay and scenarios
  passport/     Evidence Passport builder and exports
```

---

## 9. Data stored in your browser

Agrimetry has no database or accounts. These `localStorage` keys hold your work on this device:

| Key | Content |
|---|---|
| `agrimetry:global-farm-map:v1` | Saved field boundaries |
| `agrimetry:vegetation:selected-field:v1` | The field currently selected across pages |
| `agrimetry:soil-test:v1:<fieldId>` | Your soil-test values for a field |
| `agrimetry:rotation:last:v1` | The last rotation comparison (used by Climate replay) |
| `agrimetry:rotation:inputs:v1` | Your farm details from the Rotation page (used by the Evidence Passport) |

Clearing site data removes them. Nothing is sent to a server except the field geometry and coordinates needed to fetch public data.

**Project principle:** From satellite observations to farm-specific agricultural intelligence — with transparent evidence, resolution and uncertainty.
