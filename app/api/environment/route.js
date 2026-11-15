const POWER_ENDPOINT = "https://power.larc.nasa.gov/api/temporal/daily/point";
const PARAMETERS = [
  "T2M",
  "T2M_MAX",
  "T2M_MIN",
  "PRECTOTCORR",
  "RH2M",
  "ALLSKY_SFC_SW_DWN",
];

function toPowerDate(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function isValidNumber(value) {
  return Number.isFinite(value) && value > -900;
}

function mean(values) {
  const valid = values.filter(isValidNumber);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function sum(values) {
  const valid = values.filter(isValidNumber);
  if (!valid.length) return null;
  return valid.reduce((total, value) => total + value, 0);
}

function summarize(records) {
  return {
    meanTemperature: mean(records.map((item) => item.temperature)),
    meanMaximumTemperature: mean(records.map((item) => item.maximumTemperature)),
    meanMinimumTemperature: mean(records.map((item) => item.minimumTemperature)),
    precipitationTotal: sum(records.map((item) => item.precipitation)),
    meanHumidity: mean(records.map((item) => item.humidity)),
    meanSolarRadiation: mean(records.map((item) => item.solarRadiation)),
    validDays: records.filter((item) => item.temperature !== null || item.precipitation !== null).length,
  };
}

function changePercent(current, previous) {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function buildMonthly(records) {
  const months = new Map();

  for (const record of records) {
    const key = `${record.date.slice(0, 4)}-${record.date.slice(4, 6)}`;
    if (!months.has(key)) {
      months.set(key, { month: key, temperatureValues: [], precipitationTotal: 0, precipitationDays: 0 });
    }
    const month = months.get(key);
    if (isValidNumber(record.temperature)) month.temperatureValues.push(record.temperature);
    if (isValidNumber(record.precipitation)) {
      month.precipitationTotal += record.precipitation;
      month.precipitationDays += 1;
    }
  }

  return [...months.values()].map((month) => ({
    month: month.month,
    temperature: mean(month.temperatureValues),
    precipitation: month.precipitationDays ? month.precipitationTotal : null,
  }));
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const latStr = searchParams.get("lat");
  const lonStr = searchParams.get("lon");

  if (!latStr || !lonStr) {
    return Response.json(
      { error: "Provide valid latitude and longitude values." },
      { status: 400 },
    );
  }

  const latitude = Number(latStr);
  const longitude = Number(lonStr);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 ||
    longitude < -180 || longitude > 180
  ) {
    return Response.json(
      { error: "Provide valid latitude and longitude values." },
      { status: 400 },
    );
  }

  // Request two completed years so the dashboard can compare like-for-like periods.
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 729);
  const startDate = toPowerDate(start);
  const endDate = toPowerDate(end);

  const params = new URLSearchParams({
    parameters: PARAMETERS.join(","),
    community: "AG",
    longitude: longitude.toFixed(4),
    latitude: latitude.toFixed(4),
    start: startDate,
    end: endDate,
    format: "JSON",
    "time-standard": "UTC",
  });

  try {
    const upstream = await fetch(`${POWER_ENDPOINT}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 21600 },
      signal: AbortSignal.timeout(30000),
    });

    if (!upstream.ok) {
      return Response.json(
        { error: `NASA POWER could not complete the request (HTTP ${upstream.status}). Please try again later.` },
        { status: 502 },
      );
    }

    const payload = await upstream.json();
    const parameterData = payload?.properties?.parameter;
    if (!parameterData?.T2M || !parameterData?.PRECTOTCORR) {
      return Response.json(
        { error: "NASA POWER returned an unexpected response. Please try again later." },
        { status: 502 },
      );
    }

    const records = Object.keys(parameterData.T2M)
      .sort()
      .map((date) => {
        const read = (key) => {
          const value = parameterData[key]?.[date];
          return isValidNumber(value) ? value : null;
        };

        return {
          date,
          temperature: read("T2M"),
          maximumTemperature: read("T2M_MAX"),
          minimumTemperature: read("T2M_MIN"),
          precipitation: read("PRECTOTCORR"),
          humidity: read("RH2M"),
          solarRadiation: read("ALLSKY_SFC_SW_DWN"),
        };
      });

    if (!records.length) {
      return Response.json(
        { error: "No daily records were returned for this location and period." },
        { status: 404 },
      );
    }

    const currentStart = new Date(end);
    currentStart.setUTCDate(currentStart.getUTCDate() - 364);
    const currentStartKey = toPowerDate(currentStart);
    const currentRecords = records.filter((item) => item.date >= currentStartKey);
    const previousRecords = records.filter((item) => item.date < currentStartKey);

    const current = summarize(currentRecords);
    const previous = summarize(previousRecords);
    const monthly = buildMonthly(currentRecords);
    const rainfallChange = changePercent(current.precipitationTotal, previous.precipitationTotal);
    const temperatureDelta =
      current.meanTemperature !== null && previous.meanTemperature !== null
        ? current.meanTemperature - previous.meanTemperature
        : null;

    const metadata = payload?.parameters || {};
    const units = Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [key, value?.units || null]),
    );

    return Response.json(
      {
        source: "NASA POWER",
        product: "Daily Point API · Agroclimatology community",
        coordinates: { latitude, longitude },
        period: { start: startDate, end: endDate, currentStart: currentStartKey },
        units,
        summary: current,
        comparison: {
          previous: previous,
          rainfallChangePercent: rainfallChange,
          temperatureDelta,
        },
        monthly,
        recordCount: records.length,
        recordsAvailable: current.validDays,
        records,
        notes: [
          "NASA POWER daily meteorological estimates are gridded products; they are not direct measurements taken at the farm boundary.",
          "The comparison uses the latest 365-day period against the immediately preceding 365-day period. It is descriptive, not a climate-normal or attribution analysis.",
          "Missing values are excluded from summary calculations.",
        ],
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } },
    );
  } catch (error) {
    console.error("NASA POWER request failed:", error);
    return Response.json(
      { error: "Unable to reach NASA POWER right now. Check your connection and try again." },
      { status: 502 },
    );
  }
}
