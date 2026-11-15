// ECOSTRESS daytime evapotranspiration at a point, read straight from NASA's
// cloud-optimised GeoTIFFs. Harmony cannot return ECO_L3T_JET as CSV (HTTP 422
// "reformatting to text/csv ... unsupported"), so we find granules through the
// public CMR catalogue and read only the one pixel we need from each file.
import { fromUrl } from "geotiff";
import proj4 from "proj4";

const CMR_GRANULES = "https://cmr.earthdata.nasa.gov/search/granules.json";

function utmDefinition(code) {
  if (code >= 32601 && code <= 32660) return `+proj=utm +zone=${code - 32600} +datum=WGS84 +units=m +no_defs`;
  if (code >= 32701 && code <= 32760) return `+proj=utm +zone=${code - 32700} +south +datum=WGS84 +units=m +no_defs`;
  return null;
}

const withTimeout = (promise, ms, message) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
]);

async function sampleEtDaily(href, token, longitude, latitude) {
  const tiff = await fromUrl(href, { headers: { Authorization: `Bearer ${token}` } });
  const image = await tiff.getImage();
  const keys = image.getGeoKeys() || {};
  let x = longitude;
  let y = latitude;
  if (keys.ProjectedCSTypeGeoKey) {
    const definition = utmDefinition(Number(keys.ProjectedCSTypeGeoKey));
    if (!definition) throw new Error(`Unsupported ECOSTRESS tile projection EPSG:${keys.ProjectedCSTypeGeoKey}.`);
    [x, y] = proj4("EPSG:4326", definition, [longitude, latitude]);
  }
  const [originX, originY] = image.getOrigin();
  const [resX, resY] = image.getResolution();
  const column = Math.floor((x - originX) / resX);
  const row = Math.floor((y - originY) / resY);
  if (column < 0 || row < 0 || column >= image.getWidth() || row >= image.getHeight()) return null;
  const rasters = await image.readRasters({ window: [column, row, column + 1, row + 1], samples: [0] });
  const value = Number(rasters[0][0]);
  const noData = image.getGDALNoData();
  if (!Number.isFinite(value) || (noData !== null && noData !== undefined && value === Number(noData))) return null;
  return value;
}

export async function fetchEcostressEtSeries({ latitude, longitude, startDate, endDate, token, maxObservations = 12, timeBudgetMs = 28000 }) {
  const startedAt = Date.now();
  if (!token) return { status: "needs_token", records: [], reason: "Configure NASA_EARTHDATA_TOKEN to unlock NASA ECOSTRESS observations." };

  try {
    const params = new URLSearchParams({ short_name: "ECO_L3T_JET", version: "002", page_size: "40" });
    params.set("point", `${Number(longitude).toFixed(5)},${Number(latitude).toFixed(5)}`);
    params.append("temporal[]", `${startDate}T00:00:00Z,${endDate}T23:59:59Z`);
    params.append("sort_key[]", "-start_date");
    const catalogue = await fetch(`${CMR_GRANULES}?${params}`, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!catalogue.ok) return { status: "unavailable", records: [], reason: `NASA CMR catalogue returned HTTP ${catalogue.status} while searching ECOSTRESS passes.` };
    const entries = (await catalogue.json())?.feed?.entry || [];

    const granules = entries.map((entry) => {
      const links = (entry.links || []).filter((link) => /_ETdaily\.tif$/i.test(link.href || "") && /^https:/i.test(link.href));
      const link = links.find((item) => /earthdatacloud/i.test(item.href)) || links[0];
      return link ? { href: link.href, date: String(entry.time_start || "").slice(0, 10) } : null;
    }).filter((item) => item && /^\d{4}-\d{2}-\d{2}$/.test(item.date));

    if (!granules.length) {
      return { status: "unavailable", records: [], reason: "NASA's catalogue lists no ECOSTRESS evapotranspiration passes over this location in the last 90 days. ECOSTRESS samples irregularly, so gaps are normal." };
    }

    const records = [];
    let failures = 0;
    let lastError = "";
    for (let index = 0; index < granules.length && records.length < maxObservations; index += 4) {
      if (Date.now() - startedAt > timeBudgetMs) break;
      const batch = granules.slice(index, index + 4);
      const settled = await Promise.allSettled(batch.map((granule) => withTimeout(sampleEtDaily(granule.href, token, longitude, latitude), 14000, "ECOSTRESS file read timed out.")));
      settled.forEach((result, position) => {
        if (result.status === "fulfilled") {
          const value = result.value;
          if (value !== null && value >= 0 && value <= 50) records.push({ date: batch[position].date, value: Number(value.toFixed(3)) });
        } else {
          failures += 1;
          lastError = String(result.reason?.message || result.reason || "").slice(0, 160);
        }
      });
    }

    if (records.length) return { status: "available", records: records.sort((a, b) => a.date.localeCompare(b.date)), reason: null };
    if (failures && failures === Math.min(granules.length, 4)) {
      const authIssue = /401|403|unauthor|forbidden/i.test(lastError);
      return { status: "unavailable", records: [], reason: authIssue ? "NASA Earthdata rejected the token for ECOSTRESS files. Check that it is valid and that the LP DAAC data application is approved on your Earthdata account." : `Could not read ECOSTRESS files from NASA${lastError ? ` (${lastError})` : ""}. This usually means the Earthdata token is expired or invalid, or the LP DAAC data application is not approved on your Earthdata account.` };
    }
    return { status: "unavailable", records: [], reason: "ECOSTRESS passes overlap this location, but the evapotranspiration pixel was empty (cloud or quality filtering) in the recent passes." };
  } catch (error) {
    return { status: "unavailable", records: [], reason: String(error?.message || "Could not read ECOSTRESS evapotranspiration.").slice(0, 220) };
  }
}
