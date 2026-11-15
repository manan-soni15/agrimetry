import { fromUrl } from "geotiff";
import proj4 from "proj4";
import { PNG } from "pngjs";
import { computeFieldVariability, derivePhenology, ZONE_COLORS } from "./analytics.js";

export const EARTH_SEARCH_ENDPOINT = "https://earth-search.aws.element84.com/v1/search";
export const SENTINEL_COLLECTION = "sentinel-2-c1-l2a";
export const SENTINEL_START_DATE = "2015-06-27";
export const NDVI_PALETTE = [
  [143, 85, 46],
  [199, 157, 87],
  [230, 220, 165],
  [168, 189, 117],
  [86, 134, 75],
  [36, 91, 56],
];

const ALLOWED_ASSET_HOST_SUFFIXES = [".s3.us-west-2.amazonaws.com", ".s3.amazonaws.com"];
const ALLOWED_ASSET_HOSTS = new Set(["s3.us-west-2.amazonaws.com"]);
const MAX_STAC_ITEMS = 250;
const MAX_PAGES = 3;
const MAX_MONTHLY_SCENE_CANDIDATES = 2;
const MONTH_CONCURRENCY = 4;
const MAX_OUTPUT_SIDE = 512;
const INVALID_SCL_CLASSES = new Set([0, 1, 2, 3, 7, 8, 9, 10, 11]);

function parseEpsg(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const match = String(value || "").match(/(?:EPSG:)?(\d{4,6})/i);
  return match ? Number(match[1]) : null;
}

function utmZoneFor(longitude, latitude) {
  const lon = ((longitude + 180) % 360 + 360) % 360 - 180;
  let zone = Math.max(1, Math.min(60, Math.floor((lon + 180) / 6) + 1));

  // UTM's standard Norway and Svalbard zone exceptions.
  if (latitude >= 56 && latitude < 64 && lon >= 3 && lon < 12) zone = 32;
  if (latitude >= 72 && latitude < 84) {
    if (lon >= 0 && lon < 9) zone = 31;
    else if (lon >= 9 && lon < 21) zone = 33;
    else if (lon >= 21 && lon < 33) zone = 35;
    else if (lon >= 33 && lon < 42) zone = 37;
  }
  return zone;
}

export function getUtmProjection(longitude, latitude) {
  if (latitude < -56 || latitude > 84) {
    throw new Error("Sentinel-2 land coverage is generally available between 56°S and 84°N. This field is outside the supported coverage range.");
  }
  const zone = utmZoneFor(longitude, latitude);
  const epsg = (latitude >= 0 ? 32600 : 32700) + zone;
  const definition = `+proj=utm +zone=${zone} ${latitude < 0 ? "+south " : ""}+datum=WGS84 +units=m +no_defs +type=crs`;
  return { epsg, zone, definition };
}

export function validateFarmGeometry(geometry) {
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) {
    throw new Error("Select a saved farm Polygon or MultiPolygon before running vegetation analysis.");
  }

  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons) || polygons.length === 0 || polygons.length > 100) {
    throw new Error("The selected farm boundary has no polygons or contains too many separate parts.");
  }
  let vertexCount = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) throw new Error("The selected farm boundary is empty.");
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) throw new Error("Each farm boundary ring must contain at least four coordinates.");
      vertexCount += ring.length;
      if (ring.length > 6000) throw new Error("The farm boundary is too detailed. Simplify it before analysis.");
      for (const point of ring) {
        const longitude = Number(point?.[0]);
        const latitude = Number(point?.[1]);
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) {
          throw new Error("The farm boundary contains invalid longitude/latitude coordinates.");
        }
        if (latitude < -56 || latitude > 84) {
          throw new Error("This field is outside the approximate Sentinel-2 land coverage range (56°S to 84°N).");
        }
      }
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (Number(first[0]) !== Number(last[0]) || Number(first[1]) !== Number(last[1])) {
        throw new Error("The farm boundary must be closed: its final coordinate must match its first coordinate.");
      }
    }
  }
  if (!vertexCount || vertexCount > 12000) throw new Error("This boundary has too many vertices for one analysis request. Simplify it and try again.");
  return { type: geometry.type, coordinates: geometry.coordinates };
}

function getOuterCoordinates(geometry) {
  if (geometry.type === "Polygon") return geometry.coordinates[0] || [];
  return geometry.coordinates.flatMap((polygon) => polygon?.[0] || []);
}

function projectGeometry(geometry, projectionDefinition) {
  const projectRing = (ring) => ring.map(([longitude, latitude]) => proj4("EPSG:4326", projectionDefinition, [Number(longitude), Number(latitude)]));
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const projectedPolygons = polygons.map((polygon) => polygon.map(projectRing));
  const allPoints = projectedPolygons.flat(2);
  const xs = allPoints.map((point) => point[0]);
  const ys = allPoints.map((point) => point[1]);
  const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  if (!bbox.every(Number.isFinite) || bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) {
    throw new Error("The selected farm boundary could not be projected into a supported map grid.");
  }
  return {
    type: geometry.type,
    coordinates: geometry.type === "Polygon" ? projectedPolygons[0] : projectedPolygons,
    bbox,
  };
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInProjectedGeometry(point, geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((rings) => {
    if (!rings.length || !pointInRing(point, rings[0])) return false;
    for (let holeIndex = 1; holeIndex < rings.length; holeIndex += 1) {
      if (pointInRing(point, rings[holeIndex])) return false;
    }
    return true;
  });
}

function safeAssetUrl(href) {
  let url;
  try { url = new URL(href); } catch { throw new Error("Earth Search returned an invalid satellite asset URL."); }
  const allowed = url.protocol === "https:" && (
    ALLOWED_ASSET_HOSTS.has(url.hostname) || ALLOWED_ASSET_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix))
  );
  if (!allowed) throw new Error("Earth Search returned an asset hosted outside the approved public COG storage domain.");
  return url.toString();
}

function assetEpsg(item, asset, image) {
  const properties = item.properties || {};
  const assetFields = asset || {};
  const geokeys = image.getGeoKeys?.() || {};
  return parseEpsg(
    assetFields["proj:epsg"] ?? properties["proj:epsg"] ??
    assetFields["proj:code"] ?? properties["proj:code"] ??
    geokeys.ProjectedCSTypeGeoKey,
  );
}

function getWindowForBounds(image, bbox) {
  const [originX, originY] = image.getOrigin();
  const [resolutionX, resolutionY] = image.getResolution();
  const imageWidth = image.getWidth();
  const imageHeight = image.getHeight();
  const xA = (bbox[0] - originX) / resolutionX;
  const xB = (bbox[2] - originX) / resolutionX;
  const yA = (bbox[3] - originY) / resolutionY;
  const yB = (bbox[1] - originY) / resolutionY;
  const left = Math.max(0, Math.floor(Math.min(xA, xB)));
  const right = Math.min(imageWidth, Math.ceil(Math.max(xA, xB)));
  const top = Math.max(0, Math.floor(Math.min(yA, yB)));
  const bottom = Math.min(imageHeight, Math.ceil(Math.max(yA, yB)));
  if (right <= left || bottom <= top) throw new Error("The selected farm does not overlap this Sentinel-2 scene.");
  return { window: [left, top, right, bottom], width: right - left, height: bottom - top };
}

function ensureCovers(image, bbox) {
  const bounds = image.getBoundingBox();
  // Reject incomplete raster coverage rather than stretching a clipped window
  // over the entire field grid. This avoids spatially misregistered edge pixels.
  const tolerance = 1;
  return bbox[0] >= bounds[0] - tolerance && bbox[1] >= bounds[1] - tolerance &&
    bbox[2] <= bounds[2] + tolerance && bbox[3] <= bounds[3] + tolerance;
}

function percentileMedian(values) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function getReflectanceCorrection(item, asset) {
  const rasterBand = asset?.["raster:bands"]?.[0] || {};
  const scale = Number.isFinite(Number(rasterBand.scale)) ? Number(rasterBand.scale) : 0.0001;
  const rawApplied = item?.properties?.["earthsearch:boa_offset_applied"];
  const offsetAlreadyApplied = rawApplied === true || rawApplied === "true";
  const offsetNotApplied = rawApplied === false || rawApplied === "false";
  const metadataOffset = Number(rasterBand.offset);
  const baseline = Number(item?.properties?.["s2:processing_baseline"]);
  let offset = 0;

  // Earth Search records whether its COG conversion already applied the
  // Sentinel-2 BOA add-offset. Honour that item-level flag first; otherwise
  // use the asset offset or the Processing Baseline 04.00+ convention.
  if (offsetAlreadyApplied) offset = 0;
  else if (offsetNotApplied) offset = Number.isFinite(metadataOffset) ? metadataOffset : -1000 * scale;
  else if (Number.isFinite(baseline) && baseline >= 4) offset = Number.isFinite(metadataOffset) ? metadataOffset : -1000 * scale;
  else if (Number.isFinite(metadataOffset) && Number.isFinite(baseline) && baseline < 4) offset = 0;

  return {
    scale,
    offset,
    nodata: rasterBand.nodata === undefined ? 0 : Number(rasterBand.nodata),
    offsetStatus: offsetAlreadyApplied ? "already-applied" : offsetNotApplied ? "applied-by-agrimetry" : "baseline-fallback",
  };
}

function cloudCoverFor(item) {
  const value = Number(item?.properties?.["eo:cloud_cover"] ?? item?.properties?.["s2:cloudy_pixel_percentage"] ?? 100);
  return Number.isFinite(value) ? value : 100;
}

function itemDate(item) {
  const value = item?.properties?.datetime || item?.properties?.start_datetime;
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function monthKey(dateString) {
  return dateString.slice(0, 7);
}

function eachMonth(startDate, endDate) {
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const windows = [];
  cursor.setUTCDate(1);
  while (cursor <= end) {
    windows.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return windows;
}

// The public STAC service sometimes needs more than Node's default 10 s to accept a
// connection. Retry network-level failures (not HTTP errors) a couple of times.
async function fetchWithRetry(url, options, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, { ...options, signal: AbortSignal.timeout(25_000) });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    }
  }
  const wrapped = new Error("Could not reach the Earth Search catalogue (network timeout). It is a free public service; please try again in a moment.");
  wrapped.cause = lastError;
  wrapped.status = 503;
  throw wrapped;
}

async function searchEarthSearch(geometry, startDate, endDate) {
  const body = {
    collections: [SENTINEL_COLLECTION],
    intersects: geometry,
    datetime: `${startDate}T00:00:00Z/${endDate}T23:59:59Z`,
    limit: 100,
  };
  const features = [];
  let nextRequest = { url: EARTH_SEARCH_ENDPOINT, method: "POST", body };

  for (let page = 0; page < MAX_PAGES && features.length < MAX_STAC_ITEMS; page += 1) {
    const response = await fetchWithRetry(nextRequest.url, {
      method: nextRequest.method,
      headers: { "Content-Type": "application/json", Accept: "application/geo+json, application/json" },
      body: nextRequest.method === "POST" ? JSON.stringify(nextRequest.body) : undefined,
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Earth Search returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}.`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload.features)) throw new Error("Earth Search returned an unexpected STAC response.");
    features.push(...payload.features);
    const next = payload.links?.find((link) => link.rel === "next");
    if (!next || features.length >= MAX_STAC_ITEMS) break;

    const nextUrl = new URL(next.href, EARTH_SEARCH_ENDPOINT);
    if (nextUrl.origin !== new URL(EARTH_SEARCH_ENDPOINT).origin) break;
    const method = String(next.method || "GET").toUpperCase();
    nextRequest = { url: nextUrl.toString(), method, body: next.body || undefined };
    if (method !== "GET" && method !== "POST") break;
  }

  return {
    features: features.slice(0, MAX_STAC_ITEMS),
    truncated: features.length >= MAX_STAC_ITEMS,
  };
}

async function readScene(item, projectedGeometry, projection, grid) {
  const assets = item.assets || {};
  const redAsset = assets.red;
  const nirAsset = assets.nir;
  const sclAsset = assets.scl;
  if (!redAsset?.href || !nirAsset?.href || !sclAsset?.href) throw new Error("This Sentinel-2 scene is missing a required red, near-infrared or scene-classification asset.");

  const [redTiff, nirTiff, sclTiff] = await Promise.all([
    fromUrl(safeAssetUrl(redAsset.href)),
    fromUrl(safeAssetUrl(nirAsset.href)),
    fromUrl(safeAssetUrl(sclAsset.href)),
  ]);
  const [redImage, nirImage, sclImage] = await Promise.all([
    redTiff.getImage(), nirTiff.getImage(), sclTiff.getImage(),
  ]);

  const redEpsg = assetEpsg(item, redAsset, redImage);
  const nirEpsg = assetEpsg(item, nirAsset, nirImage);
  const sclEpsg = assetEpsg(item, sclAsset, sclImage);
  if ([redEpsg, nirEpsg, sclEpsg].some((epsg) => epsg !== projection.epsg)) {
    throw new Error(`The scene projection does not match the field's local UTM zone (expected EPSG:${projection.epsg}).`);
  }
  if (![redImage, nirImage, sclImage].every((image) => ensureCovers(image, grid.bbox))) {
    throw new Error("This scene only partially covers the selected farm. Another scene may cover it more completely.");
  }

  const redWindow = getWindowForBounds(redImage, grid.bbox);
  const nirWindow = getWindowForBounds(nirImage, grid.bbox);
  const sclWindow = getWindowForBounds(sclImage, grid.bbox);
  const [redRaster, nirRaster, sclRaster] = await Promise.all([
    redImage.readRasters({ window: redWindow.window, width: grid.width, height: grid.height, resampleMethod: "bilinear" }),
    nirImage.readRasters({ window: nirWindow.window, width: grid.width, height: grid.height, resampleMethod: "bilinear" }),
    sclImage.readRasters({ window: sclWindow.window, width: grid.width, height: grid.height, resampleMethod: "nearest" }),
  ]);

  const redValues = redRaster[0];
  const nirValues = nirRaster[0];
  const sclValues = sclRaster[0];
  const redCorrection = getReflectanceCorrection(item, redAsset);
  const nirCorrection = getReflectanceCorrection(item, nirAsset);
  const values = new Float32Array(grid.width * grid.height);
  values.fill(Number.NaN);
  const validValues = [];
  let insideCount = 0;

  for (let row = 0; row < grid.height; row += 1) {
    const y = grid.bbox[3] - (row + 0.5) * grid.pixelHeight;
    for (let column = 0; column < grid.width; column += 1) {
      const x = grid.bbox[0] + (column + 0.5) * grid.pixelWidth;
      if (!pointInProjectedGeometry([x, y], projectedGeometry)) continue;
      insideCount += 1;

      const index = row * grid.width + column;
      const scl = Number(sclValues[index]);
      if (!Number.isFinite(scl) || INVALID_SCL_CLASSES.has(scl)) continue;

      const rawRed = Number(redValues[index]);
      const rawNir = Number(nirValues[index]);
      if (!Number.isFinite(rawRed) || !Number.isFinite(rawNir) || rawRed === redCorrection.nodata || rawNir === nirCorrection.nodata) continue;

      const red = rawRed * redCorrection.scale + redCorrection.offset;
      const nir = rawNir * nirCorrection.scale + nirCorrection.offset;
      const denominator = nir + red;
      if (!Number.isFinite(denominator) || denominator <= 0) continue;
      const ndvi = (nir - red) / denominator;
      if (!Number.isFinite(ndvi) || ndvi < -1 || ndvi > 1) continue;
      values[index] = ndvi;
      validValues.push(ndvi);
    }
  }

  if (!validValues.length) throw new Error("No valid clear Sentinel-2 pixels remained inside the farm after cloud, shadow and boundary masking.");
  const meanNdvi = validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
  const medianNdvi = percentileMedian([...validValues]);
  const date = itemDate(item);

  return {
    values,
    meanNdvi,
    medianNdvi,
    validPixelCount: validValues.length,
    insidePixelCount: insideCount,
    sceneId: item.id,
    date,
    month: monthKey(date),
    cloudCover: cloudCoverFor(item),
  };
}

function interpolateColor(value) {
  const normalized = Math.max(0, Math.min(1, (value + 0.1) / 1.0));
  const scaled = normalized * (NDVI_PALETTE.length - 1);
  const index = Math.min(NDVI_PALETTE.length - 2, Math.floor(scaled));
  const fraction = scaled - index;
  return [0, 1, 2].map((channel) => Math.round(NDVI_PALETTE[index][channel] * (1 - fraction) + NDVI_PALETTE[index + 1][channel] * fraction));
}

function createNdviPngDataUrl(values, width, height) {
  const png = new PNG({ width, height, colorType: 6 });
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const offset = index * 4;
    if (!Number.isFinite(value)) {
      png.data[offset] = 0;
      png.data[offset + 1] = 0;
      png.data[offset + 2] = 0;
      png.data[offset + 3] = 0;
      continue;
    }
    const [red, green, blue] = interpolateColor(value);
    png.data[offset] = red;
    png.data[offset + 1] = green;
    png.data[offset + 2] = blue;
    png.data[offset + 3] = 230;
  }
  const encoded = PNG.sync.write(png, { deflateLevel: 6 });
  return `data:image/png;base64,${encoded.toString("base64")}`;
}

const HOTSPOT_MIN_FIELD_MEDIAN = 0.2;
const HOTSPOT_MIN_SIGMA = 0.04;
const HOTSPOT_SIGMA_MULTIPLIER = 1.5;
const HOTSPOT_MIN_ABSOLUTE_DROP = 0.08;

function createHotspotPngDataUrl(mask, width, height) {
  const png = new PNG({ width, height, colorType: 6 });
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    if (mask[index]) {
      png.data[offset] = 214;
      png.data[offset + 1] = 64;
      png.data[offset + 2] = 48;
      png.data[offset + 3] = 215;
    }
  }
  return `data:image/png;base64,${PNG.sync.write(png, { deflateLevel: 6 }).toString("base64")}`;
}

// Flags pixels whose NDVI is unusually low *relative to the rest of this field*.
// It uses a robust (median/MAD) threshold so a few extreme pixels do not shift it,
// and drops isolated single-cell hits to reduce speckle noise. This is a
// within-field screening aid, not a diagnosis of the cause.
export function detectLowVegetation(values, grid) {
  const valid = [];
  for (const value of values) if (Number.isFinite(value)) valid.push(value);
  if (valid.length < 20) {
    return { available: false, reason: "Too few clear pixels to compare areas within the field." };
  }
  const fieldMedian = percentileMedian([...valid]);
  if (fieldMedian < HOTSPOT_MIN_FIELD_MEDIAN) {
    return {
      available: false,
      reason: `The whole field has a low green signal (median NDVI ${fieldMedian.toFixed(2)}), so there is no unusually low area relative to the rest of the field. This pattern is typical of bare or fallow ground.`,
    };
  }
  const deviations = valid.map((value) => Math.abs(value - fieldMedian));
  const mad = percentileMedian(deviations);
  const sigma = Math.max(HOTSPOT_MIN_SIGMA, 1.4826 * mad);
  const threshold = Math.min(
    fieldMedian - HOTSPOT_SIGMA_MULTIPLIER * sigma,
    fieldMedian - HOTSPOT_MIN_ABSOLUTE_DROP,
  );

  const { width, height } = grid;
  const raw = new Uint8Array(width * height);
  for (let index = 0; index < values.length; index += 1) {
    if (Number.isFinite(values[index]) && values[index] < threshold) raw[index] = 1;
  }
  const mask = new Uint8Array(width * height);
  let count = 0;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      if (!raw[index]) continue;
      let neighbours = 0;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (!dr && !dc) continue;
          const r = row + dr;
          const c = column + dc;
          if (r >= 0 && r < height && c >= 0 && c < width && raw[r * width + c]) neighbours += 1;
        }
      }
      if (neighbours >= 1) {
        mask[index] = 1;
        count += 1;
      }
    }
  }

  const pixelAreaSquareMetres = grid.pixelWidth * grid.pixelHeight;
  const fraction = count / valid.length;
  return {
    available: true,
    fieldMedianNdvi: fieldMedian,
    thresholdNdvi: threshold,
    pixelCount: count,
    fractionOfValidPixels: fraction,
    areaHectares: (count * pixelAreaSquareMetres) / 10000,
    imageDataUrl: count ? createHotspotPngDataUrl(mask, width, height) : null,
    description: count
      ? `${(fraction * 100).toFixed(1)}% of the clear pixels have NDVI below ${threshold.toFixed(2)}, noticeably lower than this field's typical value of ${fieldMedian.toFixed(2)}.`
      : `No connected group of pixels fell clearly below this field's typical NDVI (${fieldMedian.toFixed(2)}). The vegetation signal looks fairly uniform.`,
    method: "Pixels below the field median minus the larger of 1.5 robust standard deviations (MAD-based) or 0.08 NDVI, in the pixel-wise median composite. Isolated single pixels are ignored.",
  };
}

// Three-colour overlay of the relative management zones (thirds of the field's own NDVI).
function createZonesPngDataUrl(values, thresholds, width, height) {
  const png = new PNG({ width, height, colorType: 6 });
  const rgb = ZONE_COLORS.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const offset = index * 4;
    if (!Number.isFinite(value)) continue;
    const zone = value < thresholds[0] ? 0 : value < thresholds[1] ? 1 : 2;
    [png.data[offset], png.data[offset + 1], png.data[offset + 2]] = rgb[zone];
    png.data[offset + 3] = 205;
  }
  return `data:image/png;base64,${PNG.sync.write(png, { deflateLevel: 6 }).toString("base64")}`;
}

function projectImageCorners(bbox, projectionDefinition) {
  const corners = [
    [bbox[0], bbox[3]],
    [bbox[2], bbox[3]],
    [bbox[2], bbox[1]],
    [bbox[0], bbox[1]],
  ];
  return corners.map((point) => proj4(projectionDefinition, "EPSG:4326", point));
}

function numericMedian(values) {
  return percentileMedian([...values]);
}

function reflectanceNote(item) {
  const applied = item?.properties?.["earthsearch:boa_offset_applied"];
  if (applied === true || applied === "true") return "Earth Search indicates the Sentinel-2 BOA offset is already applied to this scene.";
  if (applied === false || applied === "false") return "Agrimetry applied the Sentinel-2 BOA offset using the scene's raster-band metadata.";
  return "Reflectance offset handling used the scene processing baseline and available raster metadata; verify unusual item metadata before using results operationally.";
}

export async function analyzeSentinelVegetation({ geometry, startDate, endDate, cloudLimit }) {
  const outerCoordinates = getOuterCoordinates(geometry);
  const longitudes = outerCoordinates.map((point) => Number(point[0]));
  const latitudes = outerCoordinates.map((point) => Number(point[1]));
  const centerLongitude = (Math.min(...longitudes) + Math.max(...longitudes)) / 2;
  const centerLatitude = (Math.min(...latitudes) + Math.max(...latitudes)) / 2;
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  if (minLatitude < 0 && maxLatitude > 0) {
    throw new Error("This farm crosses the equator. Split it into separate fields so each analysis can use the correct Sentinel-2 UTM grid.");
  }
  const projection = getUtmProjection(centerLongitude, centerLatitude);
  const projectedGeometry = projectGeometry(geometry, projection.definition);
  const rawBbox = projectedGeometry.bbox;
  if ((rawBbox[2] - rawBbox[0]) > 100000 || (rawBbox[3] - rawBbox[1]) > 100000) {
    throw new Error("This boundary is too large for a single field-level Sentinel-2 analysis. Split the farm into individual fields and analyze them separately.");
  }
  // Align the common analysis extent to 20 m. Sentinel-2 red/NIR are 10 m
  // while SCL is 20 m; snapping to their shared grid keeps all three COG
  // windows spatially aligned before resampling them to the same output size.
  const gridBbox = [
    Math.floor(rawBbox[0] / 20) * 20,
    Math.floor(rawBbox[1] / 20) * 20,
    Math.ceil(rawBbox[2] / 20) * 20,
    Math.ceil(rawBbox[3] / 20) * 20,
  ];
  const [minX, minY, maxX, maxY] = gridBbox;
  const targetScale = Math.max(10, (maxX - minX) / MAX_OUTPUT_SIDE, (maxY - minY) / MAX_OUTPUT_SIDE);
  const gridWidth = Math.max(2, Math.min(MAX_OUTPUT_SIDE, Math.ceil((maxX - minX) / targetScale)));
  const gridHeight = Math.max(2, Math.min(MAX_OUTPUT_SIDE, Math.ceil((maxY - minY) / targetScale)));
  const grid = {
    width: gridWidth,
    height: gridHeight,
    bbox: gridBbox,
    pixelWidth: (maxX - minX) / gridWidth,
    pixelHeight: (maxY - minY) / gridHeight,
  };

  const search = await searchEarthSearch(geometry, startDate, endDate);
  const items = search.features
    .filter((item) => itemDate(item) && itemDate(item).slice(0, 10) >= startDate && itemDate(item).slice(0, 10) <= endDate)
    .filter((item) => cloudCoverFor(item) <= cloudLimit)
    .filter((item) => item.assets?.red?.href && item.assets?.nir?.href && item.assets?.scl?.href);

  if (!items.length) {
    const error = new Error("Earth Search found no Sentinel-2 scenes for this farm and date range. Try a wider date range or increase the scene-cloud threshold.");
    error.status = 422;
    error.code = "NO_SCENES";
    throw error;
  }

  const months = eachMonth(startDate, endDate);
  const groups = new Map(months.map((month) => [month, []]));
  for (const item of items) {
    const month = monthKey(itemDate(item));
    if (groups.has(month)) groups.get(month).push(item);
  }

  for (const candidates of groups.values()) {
    candidates.sort((a, b) => cloudCoverFor(a) - cloudCoverFor(b) || String(itemDate(a)).localeCompare(String(itemDate(b))));
  }

  const processedScenes = [];
  const sceneErrors = [];

  // Months are independent, so read several at once. Each month still tries its
  // candidates in order (lowest cloud first). Concurrency is capped to stay
  // polite to the public COG storage and to bound memory use.
  const monthResults = new Array(months.length);
  let nextMonthIndex = 0;
  async function processMonths() {
    while (nextMonthIndex < months.length) {
      const index = nextMonthIndex;
      nextMonthIndex += 1;
      const month = months[index];
      const candidates = groups.get(month) || [];
      let selectedScene = null;
      for (const candidate of candidates.slice(0, MAX_MONTHLY_SCENE_CANDIDATES)) {
        try {
          selectedScene = await readScene(candidate, projectedGeometry, projection, grid);
          processedScenes.push({ candidate, scene: selectedScene });
          break;
        } catch (sceneError) {
          sceneErrors.push({ month, id: candidate.id, message: String(sceneError?.message || sceneError).slice(0, 180) });
        }
      }
      monthResults[index] = { month, candidates, selectedScene };
    }
  }
  await Promise.all(Array.from({ length: Math.min(MONTH_CONCURRENCY, months.length) }, processMonths));
  processedScenes.sort((a, b) => String(a.scene.date).localeCompare(String(b.scene.date)));

  const monthly = [];
  for (const { month, candidates, selectedScene } of monthResults) {
    monthly.push(selectedScene ? {
      month,
      sceneCount: 1,
      candidateSceneCount: candidates.length,
      meanNdvi: selectedScene.meanNdvi,
      medianNdvi: selectedScene.medianNdvi,
      validPixelCount: selectedScene.validPixelCount,
      insidePixelCount: selectedScene.insidePixelCount,
      validPixelFraction: selectedScene.insidePixelCount ? selectedScene.validPixelCount / selectedScene.insidePixelCount : null,
      observedAt: selectedScene.date,
      cloudCover: selectedScene.cloudCover,
      sceneId: selectedScene.sceneId,
    } : {
      month,
      sceneCount: 0,
      candidateSceneCount: candidates.length,
      meanNdvi: null,
      medianNdvi: null,
      validPixelCount: 0,
      insidePixelCount: 0,
      validPixelFraction: null,
      observedAt: null,
      cloudCover: null,
      sceneId: null,
    });
  }

  if (!processedScenes.length) {
    const reason = sceneErrors[0]?.message || "No suitable complete Sentinel-2 scene could be processed.";
    const error = new Error(`Sentinel-2 scenes were found, but none could be processed for this farm. ${reason}`);
    error.status = 422;
    error.code = "NO_PROCESSABLE_SCENES";
    throw error;
  }

  const compositeValues = new Float32Array(grid.width * grid.height);
  compositeValues.fill(Number.NaN);
  for (let index = 0; index < compositeValues.length; index += 1) {
    const observations = [];
    for (const { scene } of processedScenes) {
      const value = scene.values[index];
      if (Number.isFinite(value)) observations.push(value);
    }
    if (observations.length) compositeValues[index] = numericMedian(observations);
  }

  const compositeStats = [];
  for (const value of compositeValues) if (Number.isFinite(value)) compositeStats.push(value);
  if (!compositeStats.length) {
    const error = new Error("Scenes were found, but no valid pixels remained inside this farm after masking.");
    error.status = 422;
    error.code = "NO_VALID_PIXELS";
    throw error;
  }

  const meanNdvi = compositeStats.reduce((sum, value) => sum + value, 0) / compositeStats.length;
  const medianNdvi = numericMedian(compositeStats);
  const latestScene = processedScenes.reduce((latest, current) => !latest || current.scene.date > latest.scene.date ? current : latest, null);
  const latestInsidePixelCount = latestScene.scene.insidePixelCount;
  const validPixelFraction = latestInsidePixelCount ? latestScene.scene.validPixelCount / latestInsidePixelCount : null;
  const validMonths = monthly.filter((item) => item.meanNdvi !== null).length;
  const latestMonth = [...monthly].reverse().find((item) => item.meanNdvi !== null) || null;
  const previousMonth = latestMonth
    ? [...monthly].reverse().find((item) => item.meanNdvi !== null && item.month !== latestMonth.month) || null
    : null;

  const pngDataUrl = createNdviPngDataUrl(compositeValues, grid.width, grid.height);
  const lowVegetation = detectLowVegetation(compositeValues, grid);
  const variability = computeFieldVariability(compositeValues, grid);
  const fieldVariability = variability.available
    ? { ...variability, zonesImageDataUrl: createZonesPngDataUrl(compositeValues, variability.relative.thresholds, grid.width, grid.height) }
    : variability;
  const phenology = derivePhenology(monthly);
  const coordinates = projectImageCorners(grid.bbox, projection.definition);
  const years = [...new Set(processedScenes.map(({ scene }) => scene.date.slice(0, 4)))];
  const offsetNotes = [...new Set(processedScenes.map(({ candidate }) => reflectanceNote(candidate)))];

  return {
    source: {
      name: "Copernicus Sentinel-2 MSI Level-2A Surface Reflectance",
      collection: SENTINEL_COLLECTION,
      catalog: "Element 84 Earth Search STAC API",
      provider: "European Union / ESA / Copernicus; public COG assets indexed by Element 84 and hosted on AWS",
      processing: "Agrimetry JavaScript backend using geotiff.js and proj4",
      resolutionMetres: 10,
      attribution: `Contains modified Copernicus Sentinel data ${years.join(", ")}.`,
      revisitNote: "Sentinel-2 has a nominal revisit of about five days for the constellation; usable observations depend on acquisition coverage, clouds and the selected farm boundary.",
    },
    period: { startDate, endDate, cloudLimit },
    summary: {
      meanNdvi,
      medianNdvi,
      sceneCount: processedScenes.length,
      candidateSceneCount: items.length,
      validPixelCount: compositeStats.length,
      validMonths,
      totalMonths: months.length,
      latestMonth: latestMonth?.month || null,
      latestMonthMeanNdvi: latestMonth?.meanNdvi ?? null,
      previousMonth: previousMonth?.month || null,
      previousMonthMeanNdvi: previousMonth?.meanNdvi ?? null,
      latestObservation: latestScene.scene.date,
      latestSceneCloudCover: latestScene.scene.cloudCover,
      validPixelFraction,
      latestInsidePixelCount,
    },
    monthly,
    map: {
      imageDataUrl: pngDataUrl,
      coordinates,
      width: grid.width,
      height: grid.height,
      min: -0.1,
      max: 0.9,
      palette: NDVI_PALETTE.map((color) => `#${color.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`),
      mapDescription: "Pixel-wise median of the selected monthly clear-scene NDVI observations, masked to the submitted farm geometry.",
      geometryApplied: true,
      boundaryAppliedToStatistics: true,
    },
    lowVegetation,
    fieldVariability,
    phenology,
    quality: {
      cloudMask: "Sentinel-2 Scene Classification Layer (SCL). No-data, saturated/defective, dark-area, cloud-shadow, unclassified, cloud and snow classes are excluded; clear vegetation, bare-soil and water classes are retained for NDVI interpretation.",
      sceneCloudFilter: `Scene metadata cloud cover ≤ ${cloudLimit}% before pixel-level SCL masking.`,
      nativeResolutionMetres: 10,
      scaleMetres: Math.round(Math.max(grid.pixelWidth, grid.pixelHeight) * 10) / 10,
      validMonths,
      searchItems: search.features.length,
      searchTruncated: search.truncated,
      validPixelFraction,
      latestInsidePixelCount,
      utmZone: projection.zone,
      utmEpsg: projection.epsg,
      offsetNotes,
      skippedSceneCount: sceneErrors.length,
      skippedSceneMessages: sceneErrors.slice(0, 5),
    },
    caveats: [
      "Low-vegetation areas are flagged relative to the rest of the same field, using a statistical threshold. They show where the green signal is unusually low; they do not explain why (headlands, wet spots, poor emergence, pests, soil or simply a different crop stage).",
      "Management zones are thirds of this field's own NDVI distribution. They show where greenness differs, not why; use them to decide where to scout and sample, and confirm in the field.",
      "NDVI is a vegetation greenness indicator. It is not a direct measurement of crop yield, plant disease, soil fertility or soil moisture.",
      "Each month uses the lowest scene-cloud-percentage Sentinel-2 item available for the selected farm, then applies pixel-level SCL masking. Months without usable pixels remain as gaps.",
      "The map is a pixel-wise median of the selected monthly observations and is clipped to the submitted farm polygon. It is not a legal parcel map or a crop classification.",
      "Sentinel-2 red and near-infrared bands are 10 m; the Scene Classification Layer is 20 m and is nearest-neighbour resampled to the output grid for masking. Larger farm extents are downsampled to a maximum 512 × 512 output grid, and the effective output scale is shown.",
      "A 10 m nominal resolution does not guarantee many valid pixels for very small, narrow or irregular fields. Cloud, shadow, haze, crop stage and mixed pixels can affect the signal.",
      "This release selects one complete Sentinel-2 granule per month (trying up to two low-cloud candidates if needed). A farm polygon crossing a Sentinel-2 tile boundary may need to be split into separate fields for analysis.",
      "Earth Search is a public best-effort STAC service. Temporary catalog or public COG outages can interrupt analysis; no API key is required, but availability and throughput are not guaranteed.",
      "The time-series point for each month is based on one selected clear scene, not a full monthly mosaic of every acquisition. Months with no usable coverage remain blank.",
    ],
    generatedAt: new Date().toISOString(),
    sceneDetails: processedScenes.map(({ scene }) => ({
      id: scene.sceneId,
      date: scene.date,
      month: scene.month,
      cloudCover: scene.cloudCover,
      validPixelCount: scene.validPixelCount,
      insidePixelCount: scene.insidePixelCount,
      validPixelFraction: scene.insidePixelCount ? scene.validPixelCount / scene.insidePixelCount : null,
    })),
  };
}
