import { NextResponse } from "next/server";
import { analyzeWaterStress } from "@/lib/water-stress/analysis";
import { getWaterSatelliteContext } from "@/lib/nasa/earth-observation";

export const maxDuration = 60;


export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const latitude = Number(searchParams.get("lat"));
  const longitude = Number(searchParams.get("lon"));
  const months = Number(searchParams.get("months") ?? 12);

  if (
    !(searchParams.get("lat") || "").trim() || !(searchParams.get("lon") || "").trim() ||
    !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 || Math.abs(longitude) > 180
  ) {
    return NextResponse.json({ error: "Provide valid latitude and longitude values." }, { status: 400 });
  }
  if (!Number.isInteger(months) || months < 3 || months > 12) {
    return NextResponse.json({ error: "Choose a period between 3 and 12 months." }, { status: 400 });
  }

  try {
    // Fetch optional Harmony evidence in parallel with the established POWER
    // analysis. POWER can take close to its own timeout budget, so serializing
    // the extra satellite calls risks exceeding the route's 60-second limit.
    const satellitePromise = getWaterSatelliteContext({ latitude, longitude, months }).catch((satelliteError) => {
      const reason = String(satelliteError?.message || "Optional NASA satellite context is unavailable.").slice(0, 220);
      return {
        earthdataConfigured: Boolean(process.env.NASA_EARTHDATA_TOKEN?.trim()),
        gpm: { status: "unavailable", source: "NASA GPM IMERG Late Daily V07", resolutionKm: 10, monthly: [], reason },
        ecostress: { status: "unavailable", source: "NASA ECOSTRESS ECO_L3T_JET V002", resolutionM: 70, observations: [], reason },
      };
    });
    const [result, satelliteContext] = await Promise.all([
      analyzeWaterStress({ latitude, longitude, months }),
      satellitePromise,
    ]);
    result.satelliteContext = satelliteContext;
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    console.error("Agrimetry water-stress analysis failed:", error);
    const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 502;
    const message = error?.name === "TimeoutError"
      ? "NASA POWER took too long to respond. Please try again."
      : String(error?.message || "Unable to complete the water-stress analysis right now.").slice(0, 400);
    return NextResponse.json({ error: message }, { status });
  }
}
