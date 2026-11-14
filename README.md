# Agrimetry

**Understand your land. Grow with intelligence.**

Agrimetry is a global agricultural decision-support prototype for exploring farm boundaries, environmental conditions and vegetation patterns from public Earth-observation data. It is being developed for the NASA Space Apps Challenge 2026 crop-rotation challenge.

The current application combines NASA climate/visualization resources with openly accessible non-NASA geospatial datasets. It is designed to support farmer decisions, not replace local agronomic advice or field measurements.

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
- Provides navigation to the Global Farm Map and Field Vegetation Intelligence.

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

This release uses a **public STAC catalog and public Sentinel-2 Cloud-Optimized GeoTIFF (COG) assets**. It does not require Google Earth Engine, a Google Cloud project, a service account, a private API key or `.env.local` credentials for this feature.

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

**Important source distinction:** Sentinel-2 is an ESA/Copernicus mission, not a NASA mission. Earth Search (Element 84) is the public STAC catalog; the Sentinel-2 COG assets are openly accessible from AWS. Agrimetry's current NASA data integrations are NASA POWER and the NASA GIBS visualization layer.

---

## 2. Data sources and attribution

| Source | Used for | Access / notes |
|---|---|---|
| NASA POWER Daily Point API | Temperature, precipitation, humidity and solar radiation | Public REST API; no API key is configured in this project. |
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

**Lockfile note for this patch:** the source ZIP includes the updated `package.json`, but not a regenerated `package-lock.json`. The package registry was unreachable while preparing this patch, so the previous lockfile was deliberately not shipped as if it were current. Run `npm install` to resolve the three new dependencies and update `package-lock.json`; use `npm ci` only after that update has completed.

Then start the app:

```bash
npm run dev
```

Open:

- Landing page: `http://localhost:3000/`
- Environmental explorer: `http://localhost:3000/explore`
- Global Farm Map: `http://localhost:3000/explore/map`
- Field Vegetation Intelligence: `http://localhost:3000/explore/vegetation`

Useful checks:

```bash
npm run lint
npm run build
```

### Environment variables

The current public-source integrations do **not** require an `.env.local` file or user-specific API credentials. Do not add a Google Earth Engine service account for this implementation. If a future provider requires a key, add it only as a server-side environment variable and never expose it to client-side code. Public access does not remove data-provider terms: retain the required Copernicus, NASA, OpenStreetMap, Esri and Fields of the World attribution, and review each provider's applicable usage/licensing conditions before public deployment.

---

## 5. How to use Field Vegetation Intelligence

1. Open `/explore/map`.
2. Search for the farm location or enter coordinates.
3. Draw a field using Trace points/Polygon, Freehand or Rectangle; alternatively inspect a Fields of the World candidate and add it after review.
4. Edit the boundary so it follows the actual field and save it in the browser.
5. Open `/explore/vegetation`.
6. Select the saved field from the field selector.
7. Choose a start date, end date and scene-level cloud threshold.
8. Run vegetation analysis.
9. Inspect the field-clipped NDVI overlay, composite statistics, monthly chart, observation table and data-quality notes.

If no field appears, return to the Global Farm Map, save the boundary, and reload the vegetation page. The current build stores boundaries in browser `localStorage`, so fields do not automatically sync between browsers or devices. Export GeoJSON to keep a portable copy.

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
- Crop-rotation suggestions are not yet implemented in this release. Vegetation and environmental indicators are evidence inputs for that future decision-support engine, not crop recommendations by themselves.

---

## 7. Current roadmap

1. Integrate NASA SMAP soil-moisture indicators and NASA GPM precipitation trends.
2. Add seasonal bare-field / low-vegetation-window analysis with appropriate validation caveats.
3. Add global soil-property context and farmer-entered soil-test results.
4. Build crop-sequence compatibility and crop-rotation scoring using farmer priorities.
5. Add historical climate replay for rotation comparisons.
6. Generate an Evidence Passport explaining data sources, observations, assumptions, uncertainty and risks for each strategy.

**Project principle:** From satellite observations to farm-specific agricultural intelligence — with transparent evidence, resolution and uncertainty.
