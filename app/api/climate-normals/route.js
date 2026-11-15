import { NextResponse } from "next/server";

export const maxDuration = 30;

const POWER_MONTHLY = "https://power.larc.nasa.gov/api/temporal/monthly/point";
const START_YEAR = 2001;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const latitude = Number(searchParams.get("lat"));
  const longitude = Number(searchParams.get("lon"));
  if (!(searchParams.get("lat") || "").trim() || !(searchParams.get("lon") || "").trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return NextResponse.json({ error: "Provide valid latitude and longitude values." }, { status: 400 });
  }
  const endYear = new Date().getUTCFullYear() - 1;
  const params = new URLSearchParams({
    parameters: "T2M,PRECTOTCORR",
    community: "AG",
    longitude: longitude.toFixed(4),
    latitude: latitude.toFixed(4),
    start: String(START_YEAR),
    end: String(endYear),
    format: "JSON",
  });
  try {
    const response = await fetch(`${POWER_MONTHLY}?${params}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 604800 },
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error(`NASA POWER could not complete the request (HTTP ${response.status}).`);
    const payload = await response.json();
    const parameter = payload?.properties?.parameter;
    if (!parameter?.T2M || !parameter?.PRECTOTCORR) throw new Error("NASA POWER returned an unexpected response.");
    return NextResponse.json({
      source: "NASA POWER Monthly Point API (MERRA-2 based)",
      startYear: START_YEAR,
      endYear,
      location: { latitude, longitude },
      parameter: { T2M: parameter.T2M, PRECTOTCORR: parameter.PRECTOTCORR },
      note: "Gridded model estimates for the cell containing the field centre, averaged by calendar month over all years shown.",
    }, { headers: { "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000" } });
  } catch (error) {
    console.error("Climate normals request failed:", error);
    const message = error?.name === "TimeoutError" ? "NASA POWER took too long to respond. Please try again." : String(error?.message || "Unable to load climate data right now.").slice(0, 300);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
