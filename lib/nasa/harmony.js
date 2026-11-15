const HARMONY_BASE = "https://harmony.earthdata.nasa.gov";

function parseCsvRows(csv) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim()); cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && csv[i + 1] === "\n") i += 1;
      row.push(cell.trim()); cell = "";
      if (row.some((item) => item !== "")) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some((item) => item !== "")) rows.push(row);
  return rows;
}

function isoDate(value) {
  const match = String(value || "").match(/(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || null;
}

function chooseIndex(headers, matcher, excluded = new Set()) {
  return headers.findIndex((header, index) => !excluded.has(index) && matcher.test(header));
}

function parseSeriesCsv(csv, variable, options = {}) {
  const rows = parseCsvRows(csv.slice(0, 8_000_000));
  if (rows.length < 2) throw new Error("NASA Harmony returned no tabular observations for this location and period.");
  const headers = rows[0].map((header) => header.toLowerCase().replace(/[\s"']/g, ""));
  const timeIndex = chooseIndex(headers, /(time|date|datetime|observation)/i);
  let valueIndex = chooseIndex(headers, new RegExp(variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  if (valueIndex < 0) valueIndex = chooseIndex(headers, /^(value|mean|average|data|band1|result)$/i, new Set([timeIndex]));
  if (valueIndex < 0) {
    const candidates = headers.map((_, index) => index).filter((index) => index !== timeIndex && !/(lat|lon|long|quality|count|uncertainty)/i.test(headers[index]));
    valueIndex = candidates.length ? candidates[candidates.length - 1] : -1;
  }
  if (timeIndex < 0 || valueIndex < 0) {
    throw new Error(`NASA Harmony returned CSV without a recognizable date and ${variable} column.`);
  }

  const records = [];
  for (const row of rows.slice(1)) {
    const date = isoDate(row[timeIndex]);
    let value = Number(String(row[valueIndex] || "").replace(/,/g, ""));
    if (!date || !Number.isFinite(value) || value <= -9000) continue;
    if (options.scaleFactor && Math.abs(value) > 1.1) value *= options.scaleFactor;
    if (options.min !== undefined && value < options.min) continue;
    if (options.max !== undefined && value > options.max) continue;
    records.push({ date, value: Number(value.toFixed(4)) });
  }
  if (!records.length) throw new Error(`NASA Harmony returned no valid ${variable} observations for this location and period.`);
  return records.sort((a, b) => a.date.localeCompare(b.date)).slice(-500);
}

export async function fetchHarmonyPositionSeries({ collection, variable, parameterName, latitude, longitude, startDate, endDate, maxResults = 180, timeoutMs = 6500, ...parseOptions }) {
  const token = process.env.NASA_EARTHDATA_TOKEN?.trim();
  if (!token) {
    return { status: "needs_token", records: [], reason: "Add a NASA_EARTHDATA_TOKEN to .env.local to enable authenticated NASA Harmony data access." };
  }

  const url = new URL(`${HARMONY_BASE}/ogc-api-edr/1.1.0/collections/${encodeURIComponent(collection)}/position`);
  url.searchParams.set("coords", `POINT(${Number(longitude).toFixed(5)} ${Number(latitude).toFixed(5)})`);
  url.searchParams.set("datetime", `${startDate}T00:00:00Z/${endDate}T23:59:59Z`);
  url.searchParams.set("parameter-name", parameterName || variable);
  url.searchParams.set("f", "text/csv");
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("concatenate", "true");
  url.searchParams.set("ignoreErrors", "true");
  url.searchParams.set("skipPreview", "true");

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "text/csv" },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const serviceDetail = (await response.text()).replace(/\\s+/g, " ").slice(0, 360);
      const statusMessage = response.status === 401 || response.status === 403
        ? "NASA Earthdata rejected the configured token. Check that it is valid and authorized for NASA Harmony."
        : `NASA Harmony returned HTTP ${response.status} for ${collection}${serviceDetail ? `: ${serviceDetail}` : "."}`;
      return { status: "unavailable", records: [], reason: statusMessage };
    }
    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();
    if (!/csv|text\/plain|octet-stream/i.test(contentType) && !/^[^\n,]+[,\n]/.test(body.trim())) {
      return { status: "unavailable", records: [], reason: "NASA Harmony did not return the expected CSV time-series format for this product." };
    }
    const records = parseSeriesCsv(body, variable, parseOptions);
    return { status: "available", records, reason: null };
  } catch (error) {
    const reason = error?.name === "TimeoutError" || error?.name === "AbortError"
      ? `NASA Harmony took longer than the configured time budget for ${collection}. The satellite data may be temporarily slow or the requested period may be too large.`
      : String(error?.message || `Could not read ${collection} from NASA Harmony.`).slice(0, 220);
    return { status: "unavailable", records: [], reason };
  }
}

export function getEarthdataStatus() {
  return Boolean(process.env.NASA_EARTHDATA_TOKEN?.trim());
}

