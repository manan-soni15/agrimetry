// NASA POWER daily hydrology context for Agrimetry.
// Prefer SMAP L4 volumetric moisture. If the SMAP aliases are rejected or
// unavailable, fall back to POWER's standard wetness fractions (GWETTOP /
// GWETROOT), and label them as MERRA-2 context rather than SMAP.
// Neither source is a field-scale probe or a substitute for soil chemistry.

export const NASA_POWER_DAILY = "https://power.larc.nasa.gov/api/temporal/daily/point";
const POWER_LAG_DAYS = 10;
const WINDOW_DAYS = 90;
const SMAP_PARAMETERS = ["SFMC", "RZMC"];
const WETNESS_PARAMETERS = ["GWETTOP", "GWETROOT"];
const isValid = (value) => Number.isFinite(value) && value > -900;
const readValue = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return isValid(number) ? number : null;
};
const pad = (value) => String(value).padStart(2, "0");
const toPowerDate = (date) => `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function deriveTrend(values) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 12) return { direction: "insufficient", change: null, earlierMean: null, recentMean: null };
  const split = Math.floor(clean.length / 2);
  const earlierMean = mean(clean.slice(0, split));
  const recentMean = mean(clean.slice(split));
  const change = recentMean - earlierMean;
  const threshold = Math.max(0.008, Math.abs(earlierMean || 0) * 0.08);
  return { direction: change < -threshold ? "declining" : change > threshold ? "rising" : "steady", change, earlierMean, recentMean };
}

function parsePowerError(rawBody, status) {
  let detail = String(rawBody || "").replace(/\s+/g, " ").trim();
  try {
    const parsed = JSON.parse(rawBody);
    const messages = parsed?.messages;
    if (Array.isArray(messages) && messages.length) {
      detail = messages.map((item) => typeof item === "string" ? item : item?.message || item?.detail || JSON.stringify(item)).join(" | ");
    } else detail = parsed?.detail || parsed?.message || parsed?.error || detail;
  } catch {}
  const error = new Error(`NASA POWER hydrology lookup returned HTTP ${status}${detail ? `: ${String(detail).slice(0, 240)}` : "."}`);
  error.status = status;
  return error;
}

function buildStory(latest, rootTrend, surfaceTrend, kind) {
  const observations = [];
  if (kind === "smap" && Number.isFinite(latest?.rootPercentile)) {
    if (latest.rootPercentile <= 20) observations.push("Root-zone moisture is in the lowest fifth of the SMAP record at this grid location, so the wider landscape has been unusually dry compared with its record since 2015.");
    else if (latest.rootPercentile >= 80) observations.push("Root-zone moisture is in the upper fifth of the SMAP record at this grid location, indicating unusually wet conditions relative to its record since 2015.");
    else observations.push("Root-zone moisture sits within the middle portion of the SMAP record at this grid location.");
  } else {
    observations.push(kind === "smap"
      ? "NASA's SMAP product provides recent surface and root-zone water estimates for the wider landscape."
      : "NASA POWER's modelled soil-wetness fractions provide broad surface and root-zone context; they are not the higher-resolution SMAP product.");
  }
  if (rootTrend.direction === "declining") observations.push("Across the requested 90-day window, the root-zone readings have generally moved downward.");
  else if (rootTrend.direction === "rising") observations.push("Across the requested 90-day window, the root-zone readings have generally moved upward.");
  else if (rootTrend.direction === "steady") observations.push("Across the requested 90-day window, the root-zone readings have been relatively steady.");
  if (surfaceTrend.direction === "declining" && rootTrend.direction !== "declining") observations.push("The surface layer has declined more clearly than the root-zone estimate, so a dry surface should not automatically be read as depleted deeper reserves.");
  return {
    headline: rootTrend.direction === "declining" ? "The wider landscape's root-zone readings are falling" : rootTrend.direction === "rising" ? "The wider landscape's root-zone readings are rising" : "A recent picture of water beneath the land",
    observations,
    nextStep: "Read this alongside recent rainfall, crop stage and Sentinel-2 vegetation change. These gridded estimates describe the surrounding landscape, not the individual field; use field observations or a soil-moisture probe before making irrigation decisions.",
  };
}

async function requestPower(parameters, point, start, end, timeoutMs) {
  const params = new URLSearchParams({
    parameters: parameters.join(","), community: "HY",
    longitude: point[0].toFixed(4), latitude: point[1].toFixed(4),
    start: toPowerDate(start), end: toPowerDate(end), format: "JSON", "time-standard": "UTC",
  });
  const response = await fetch(`${NASA_POWER_DAILY}?${params.toString()}`, {
    headers: { Accept: "application/json" }, next: { revalidate: 21_600 }, signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw parsePowerError(await response.text().catch(() => ""), response.status);
  const payload = await response.json();
  const values = payload?.properties?.parameter;
  if (!values || typeof values !== "object") throw new Error("NASA POWER returned an unexpected hydrology response.");
  return values;
}

export async function fetchNasaSmapSoilMoisture(point) {
  try {
    const end = new Date();
    end.setUTCDate(end.getUTCDate() - POWER_LAG_DAYS);
    end.setUTCHours(0, 0, 0, 0);
    const attempts = [
      { parameters: SMAP_PARAMETERS, offset: 0, kind: "smap" },
      { parameters: SMAP_PARAMETERS, offset: 7, kind: "smap" },
      { parameters: WETNESS_PARAMETERS, offset: 0, kind: "wetness" },
      { parameters: WETNESS_PARAMETERS, offset: 7, kind: "wetness" },
    ];
    let values = null;
    let chosen = null;
    let lastError = null;
    for (const attempt of attempts) {
      const attemptEnd = new Date(end.getTime() - attempt.offset * 86_400_000);
      const start = new Date(attemptEnd);
      start.setUTCDate(start.getUTCDate() - (WINDOW_DAYS - 1));
      try {
        values = await requestPower(attempt.parameters, point, start, attemptEnd, 12_000);
        chosen = { ...attempt, end: attemptEnd, start };
        break;
      } catch (error) {
        // Keep trying independent fallbacks for validation errors, upstream
        // outages, rate limits and timeouts. A failed SMAP request must not
        // prevent the broader POWER wetness series from being attempted.
        lastError = error;
      }
    }
    if (!values || !chosen) throw lastError || new Error("NASA POWER did not return soil-water data.");

    const surfaceKey = chosen.kind === "smap" ? "SFMC" : "GWETTOP";
    const rootKey = chosen.kind === "smap" ? "RZMC" : "GWETROOT";
    const surfaceValues = values[surfaceKey] || {};
    const rootValues = values[rootKey] || {};
    const dateKeys = [...new Set([...Object.keys(surfaceValues), ...Object.keys(rootValues)])].sort();
    const records = dateKeys.map((date) => ({ date, surface: readValue(surfaceValues[date]), rootZone: readValue(rootValues[date]), profile: null, surfacePercentile: null, rootPercentile: null }))
      .filter((entry) => entry.surface !== null || entry.rootZone !== null);
    if (!records.length) throw new Error("NASA POWER returned no valid soil-water observations for this location and period.");
    const latest = [...records].reverse().find((entry) => entry.rootZone !== null || entry.surface !== null);
    const surfaceTrend = deriveTrend(records.map((entry) => entry.surface));
    const rootTrend = deriveTrend(records.map((entry) => entry.rootZone));
    const recent = records.slice(-30);
    const smap = chosen.kind === "smap";
    const fallbackNote = chosen.offset
      ? "The newest requested dates were not available; an earlier 90-day window was used."
      : null;
    return {
      available: true,
      kind: chosen.kind,
      units: smap ? "m³/m³" : "fraction",
      source: {
        name: smap ? "NASA SMAP Level-4 soil moisture via NASA POWER" : "NASA POWER Hydrology soil wetness (MERRA-2)",
        provider: "NASA / NASA POWER",
        product: smap ? "SMAP L4 Surface and Root Zone Soil Moisture" : "MERRA-2 surface and root-zone wetness fractions",
        nativeResolutionMetres: smap ? 9_000 : 50_000,
        deliveredGrid: smap ? "approximately 0.09° latitude/longitude" : "approximately 0.5° × 0.625°",
        startDate: records[0].date, endDate: records[records.length - 1].date,
        parameters: chosen.parameters, note: fallbackNote,
      },
      samplePoint: { longitude: point[0], latitude: point[1] },
      summary: {
        latest,
        surfaceMean30d: mean(recent.filter((entry) => entry.surface !== null).map((entry) => entry.surface)),
        rootZoneMean30d: mean(recent.filter((entry) => entry.rootZone !== null).map((entry) => entry.rootZone)),
        surfaceTrend, rootTrend, observationCount: records.length,
      },
      story: buildStory(latest, rootTrend, surfaceTrend, chosen.kind),
      records: records.slice(-45),
      caveats: [
        smap
          ? "SMAP L4 is a model-assimilated satellite soil-moisture estimate at about 9 km native resolution; it is not a field-scale probe reading."
          : "This fallback is a MERRA-2 model wetness fraction at roughly 50 km grid scale; it is not SMAP and is not volumetric water content.",
        ...(fallbackNote ? [fallbackNote] : []),
        "These gridded values describe the surrounding landscape, not the soil conditions at every point inside the farm boundary.",
        "Soil-water values do not measure soil pH, texture, organic-carbon concentration, nutrient status or compaction.",
      ],
    };
  } catch (error) {
    return {
      available: false,
      error: String(error?.message || "NASA POWER soil-water data is temporarily unavailable.").slice(0, 280),
      source: { name: "NASA POWER soil-water context", provider: "NASA / NASA POWER" },
      summary: null, story: null, records: [],
    };
  }
}
