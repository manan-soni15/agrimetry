import { NextResponse } from "next/server";
import { analyzeWaterStress } from "@/lib/water-stress/analysis";

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
    const result = await analyzeWaterStress({ latitude, longitude, months });
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
