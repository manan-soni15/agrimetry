import { NextResponse } from "next/server";

export const maxDuration = 30;

const POWER_MONTHLY = "https://power.larc.nasa.gov/api/temporal/monthly/point";
const POWER_DAILY = "https://power.larc.nasa.gov/api/temporal/daily/point";
const START_YEAR = 2001;

// Year-by-year monthly temperature, rainfall and root-zone wetness for the replay.
// Daily series as two aligned arrays starting 1 Jan of the first year (null = missing).
function compactDaily(payload, startYear, endYear) {
  const parameter = payload?.properties?.parameter;
  if (!parameter?.T2M_MAX || !parameter?.PRECTOTCORR) return null;
  const tmax = [];
  const rain = [];
  const round = (value) => (Number.isFinite(value) && value > -900 ? Math.round(value * 10) / 10 : null);
  for (let year = startYear; year <= endYear; year += 1) {
    const days = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1 ? 366 : 365;
    for (let d = 0; d < days; d += 1) {
      const date = new Date(Date.UTC(year, 0, 1 + d)).toISOString().slice(0, 10).replaceAll("-", "");
      tmax.push(round(parameter.T2M_MAX[date]));
      rain.push(round(parameter.PRECTOTCORR[date]));
    }
  }
  return { startYear, endYear, tmax, rain };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const latitude = Number(searchParams.get("lat"));
  const longitude = Number(searchParams.get("lon"));
  if (!(searchParams.get("lat") || "").trim() || !(searchParams.get("lon") || "").trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return NextResponse.json({ error: "Provide valid latitude and longitude values." }, { status: 400 });
  }
  const endYear = new Date().getUTCFullYear() - 1;
  const params = new URLSearchParams({
    parameters: "T2M,PRECTOTCORR,GWETROOT",
    community: "AG",
    longitude: longitude.toFixed(4),
    latitude: latitude.toFixed(4),
    start: String(START_YEAR),
    end: String(endYear),
    format: "JSON",
  });
  try {
    const dailyParams = new URLSearchParams({
      parameters: "T2M_MAX,PRECTOTCORR",
      community: "AG",
      longitude: longitude.toFixed(4),
      latitude: latitude.toFixed(4),
      start: `${START_YEAR}0101`,
      end: `${endYear}1231`,
      format: "JSON",
      "time-standard": "UTC",
    });
    const fetchJson = async (url) => {
      const res = await fetch(url, { headers: { Accept: "application/json" }, next: { revalidate: 604800 }, signal: AbortSignal.timeout(28000) });
      if (!res.ok) throw new Error(`NASA POWER could not complete the request (HTTP ${res.status}).`);
      return res.json();
    };
    // Daily extremes are optional: if that request fails the monthly replay still works.
    const [payload, dailyPayload] = await Promise.all([
      fetchJson(`${POWER_MONTHLY}?${params}`),
      fetchJson(`${POWER_DAILY}?${dailyParams}`).catch((dailyError) => { console.warn("Daily climate history unavailable:", dailyError?.message); return null; }),
    ]);
    const parameter = payload?.properties?.parameter;
    if (!parameter?.T2M || !parameter?.PRECTOTCORR) throw new Error("NASA POWER returned an unexpected response.");
    return NextResponse.json({
      source: "NASA POWER Monthly Point API (MERRA-2 based)",
      startYear: START_YEAR,
      endYear,
      location: { latitude, longitude },
      parameter: { T2M: parameter.T2M, PRECTOTCORR: parameter.PRECTOTCORR, GWETROOT: parameter.GWETROOT || {} },
      daily: compactDaily(dailyPayload, START_YEAR, endYear),
      note: "Gridded model estimates for the cell containing the field centre; monthly means (rainfall converted from mm/day). Daily maximum temperature and rainfall are included for heat and dry-spell counts.",
    }, { headers: { "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000" } });
  } catch (error) {
    console.error("Climate history request failed:", error);
    const message = error?.name === "TimeoutError" ? "NASA POWER took too long to respond. Please try again." : String(error?.message || "Unable to load climate history right now.").slice(0, 300);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
