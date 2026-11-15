import { fetchHarmonyPositionSeries, getEarthdataStatus } from "./harmony";

const dateString = (date) => date.toISOString().slice(0, 10);

function startForMonths(months, now = new Date()) {
  return dateString(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1)));
}

function monthlyRain(records) {
  const groups = new Map();
  for (const record of records) {
    const month = record.date.slice(0, 7);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(record.value);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, values]) => ({
    month,
    totalMm: Number(values.reduce((sum, value) => sum + value, 0).toFixed(1)),
    validDays: values.length,
  }));
}

// IMERG daily precipitation through the public NASA POWER API. This needs no
// Earthdata token and does not depend on Harmony concatenation support.
async function fetchPowerImerg({ latitude, longitude, startDate, endDate, timeoutMs = 20000 }) {
  const compact = (value) => value.replace(/-/g, "");
  let lastReason = "NASA POWER did not return IMERG precipitation.";
  // POWER offers parameters per community; try the ones that may carry IMERG.
  for (const community of ["AG", "HY", "RE"]) {
    const params = new URLSearchParams({
      parameters: "IMERG_PRECTOT", community,
      longitude: Number(longitude).toFixed(4), latitude: Number(latitude).toFixed(4),
      start: compact(startDate), end: compact(endDate), format: "JSON", "time-standard": "UTC",
    });
    try {
      const response = await fetch(`https://power.larc.nasa.gov/api/temporal/daily/point?${params}`, {
        headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
        lastReason = `NASA POWER (${community}) returned HTTP ${response.status} for IMERG precipitation${detail ? `: ${detail}` : "."}`;
        continue;
      }
      const values = (await response.json())?.properties?.parameter?.IMERG_PRECTOT || {};
      const records = Object.entries(values)
        .map(([key, raw]) => ({ date: `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`, value: Number(raw) }))
        .filter((item) => Number.isFinite(item.value) && item.value >= 0 && item.value <= 1000)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (records.length) return { status: "available", records, reason: null };
      lastReason = "NASA POWER returned no valid IMERG precipitation values for this location and period.";
    } catch (error) {
      lastReason = String(error?.message || "Could not read IMERG precipitation from NASA POWER.").slice(0, 220);
    }
  }
  return { status: "unavailable", records: [], reason: lastReason };
}

export async function getWaterSatelliteContext({ latitude, longitude, months }) {
  const today = new Date();
  const endDate = dateString(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1)));
  const requestedStartDate = startForMonths(months, today);
  const boundedStart = new Date(today);
  boundedStart.setUTCDate(boundedStart.getUTCDate() - 90);
  const startDate = requestedStartDate > dateString(boundedStart) ? requestedStartDate : dateString(boundedStart);
  const earthdataReady = getEarthdataStatus();

  // IMERG: public NASA POWER first (no login), then Harmony without
  // concatenation if a token is available.
  const gpmPromise = (async () => {
    const viaPower = await fetchPowerImerg({ latitude, longitude, startDate, endDate });
    if (viaPower.status === "available" || !earthdataReady) return { ...viaPower, via: "power" };
    const viaHarmony = await fetchHarmonyPositionSeries({ collection: "GPM_3IMERGDL", variable: "precipitation", latitude, longitude, startDate, endDate, maxResults: 105, timeoutMs: 25000, concatenate: false, min: 0, max: 1000 });
    return viaHarmony.status === "available"
      ? { ...viaHarmony, via: "harmony" }
      : { ...viaHarmony, reason: `${viaPower.reason} Harmony fallback: ${viaHarmony.reason}`, via: "none" };
  })();
  const gpmResult = await gpmPromise;

  return {
    earthdataConfigured: earthdataReady,
    gpm: {
      status: gpmResult.status,
      source: gpmResult.via === "harmony" ? "NASA GPM IMERG Late Daily V07 (GPM_3IMERGDL)" : "NASA GPM IMERG daily precipitation via NASA POWER",
      resolutionKm: 10,
      units: "mm/day",
      latestDate: gpmResult.records.at(-1)?.date || null,
      monthly: gpmResult.status === "available" ? monthlyRain(gpmResult.records) : [],
      reason: gpmResult.reason,
      note: "Daily IMERG precipitation estimates at the field-centre grid cell for a bounded recent window (up to 90 days). Monthly totals are sums of valid daily values; incomplete months may be partial. IMERG has approximately 10 km grid spacing and can be less reliable in complex terrain.",
    },
  };
}

export async function getHlsHistory({ latitude, longitude }) {
  const endDate = dateString(new Date());
  const startDate = "2013-04-11";
  if (!getEarthdataStatus()) {
    return {
      status: "needs_token", records: [], monthly: [],
      reason: "Configure NASA_EARTHDATA_TOKEN to unlock the NASA HLS/Landsat historical series.",
      source: "NASA Harmonized Landsat Sentinel-2 Vegetation Indices V2.0",
    };
  }

  const [landsat, sentinel] = await Promise.all([
    fetchHarmonyPositionSeries({ collection: "HLSL30_VI", variable: "NDVI", latitude, longitude, startDate, endDate, maxResults: 400, timeoutMs: 45000, scaleFactor: 0.0001, min: -1, max: 1 }),
    fetchHarmonyPositionSeries({ collection: "HLSS30_VI", variable: "NDVI", latitude, longitude, startDate, endDate, maxResults: 400, timeoutMs: 45000, scaleFactor: 0.0001, min: -1, max: 1 }),
  ]);
  const records = [
    ...landsat.records.map((item) => ({ ...item, sensor: "Landsat 8/9 OLI" })),
    ...sentinel.records.map((item) => ({ ...item, sensor: "Sentinel-2 MSI (HLS)" })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const groups = new Map();
  for (const record of records) {
    const month = record.date.slice(0, 7);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(record);
  }
  const monthly = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, values]) => ({
    month,
    meanNdvi: Number((values.reduce((sum, item) => sum + item.value, 0) / values.length).toFixed(3)),
    observationCount: values.length,
    landsatCount: values.filter((item) => item.sensor.startsWith("Landsat")).length,
    sentinelCount: values.filter((item) => item.sensor.startsWith("Sentinel")).length,
  }));

  const status = records.length ? "available" : landsat.status === "needs_token" || sentinel.status === "needs_token" ? "needs_token" : "unavailable";
  return {
    status,
    source: "NASA HLSL30_VI + HLSS30_VI V2.0",
    resolutionM: 30,
    earliestDate: records[0]?.date || null,
    latestDate: records.at(-1)?.date || null,
    observationCount: records.length,
    monthly,
    records: records.slice(-500),
    sensors: {
      landsat: { status: landsat.status, count: landsat.records.length, reason: landsat.reason },
      sentinel: { status: sentinel.status, count: sentinel.records.length, reason: sentinel.reason },
    },
    note: "HLS harmonizes Landsat 8/9 OLI and Sentinel-2 MSI observations on a common 30 m grid. This first integration samples the pixel at the saved field-centre coordinate; it is not a polygon-wide field average. Only NDVI values in the physical range -1 to 1 are retained. Review HLS product quality flags before operational decisions.",
  };
}

