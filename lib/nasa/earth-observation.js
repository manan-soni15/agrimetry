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

export async function getWaterSatelliteContext({ latitude, longitude, months }) {
  const today = new Date();
  const endDate = dateString(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1)));
  const requestedStartDate = startForMonths(months, today);
  const boundedStart = new Date(today);
  boundedStart.setUTCDate(boundedStart.getUTCDate() - 90);
  const startDate = requestedStartDate > dateString(boundedStart) ? requestedStartDate : dateString(boundedStart);
  if (!getEarthdataStatus()) {
    const missing = { status: "needs_token", records: [], reason: "Configure NASA_EARTHDATA_TOKEN to unlock NASA GPM and ECOSTRESS observations." };
    return {
      earthdataConfigured: false,
      gpm: { ...missing, monthly: [], source: "GPM IMERG Late Daily V07", resolutionKm: 10 },
      ecostress: { ...missing, observations: [], source: "ECOSTRESS ECO_L3T_JET V002", resolutionM: 70 },
    };
  }

  const [gpmResult, ecoResult] = await Promise.all([
    fetchHarmonyPositionSeries({ collection: "GPM_3IMERGDL", variable: "precipitation", latitude, longitude, startDate, endDate, maxResults: 105, timeoutMs: 25000, min: 0, max: 1000 }),
    fetchHarmonyPositionSeries({ collection: "ECO_L3T_JET", variable: "ETdaily", parameterName: "all", latitude, longitude, startDate, endDate, maxResults: 60, timeoutMs: 25000, min: 0, max: 50 }),
  ]);

  return {
    earthdataConfigured: true,
    gpm: {
      status: gpmResult.status,
      source: "NASA GPM IMERG Late Daily V07 (GPM_3IMERGDL)",
      resolutionKm: 10,
      units: "mm/day",
      latestDate: gpmResult.records.at(-1)?.date || null,
      monthly: gpmResult.status === "available" ? monthlyRain(gpmResult.records) : [],
      reason: gpmResult.reason,
      note: "Daily IMERG precipitation estimates at the field-centre grid cell for a bounded recent window (up to 90 days). Monthly totals are sums of valid daily values; incomplete months may be partial. IMERG has approximately 10 km grid spacing and can be less reliable in complex terrain.",
    },
    ecostress: {
      status: ecoResult.status,
      source: "NASA ECOSTRESS ECO_L3T_JET V002",
      resolutionM: 70,
      units: "mm/day",
      latest: ecoResult.records.at(-1) || null,
      observations: ecoResult.records.slice(-12),
      reason: ecoResult.reason,
      note: "ETdaily is an ensemble estimate of daytime evapotranspiration, integrated from sunrise to sunset. ISS sampling is irregular; this is not a daily continuous record or a direct crop-water-demand measurement.",
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

