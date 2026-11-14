const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") || "").trim();

  if (query.length < 2 || query.length > 100) {
    return Response.json(
      { error: "Enter a location name with at least 2 characters." },
      { status: 400 },
    );
  }

  try {
    const params = new URLSearchParams({ name: query, count: "6", language: "en", format: "json" });
    const upstream = await fetch(`${GEOCODING_ENDPOINT}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(15000),
    });

    if (!upstream.ok) {
      return Response.json({ error: "The location search service is temporarily unavailable." }, { status: 502 });
    }

    const payload = await upstream.json();
    const results = (payload.results || []).map((place) => ({
      id: place.id,
      name: place.name,
      admin1: place.admin1 || null,
      country: place.country || null,
      countryCode: place.country_code || null,
      latitude: place.latitude,
      longitude: place.longitude,
      elevation: place.elevation ?? null,
      timezone: place.timezone || null,
      label: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
    }));

    return Response.json(
      {
        results,
        attribution: "Location data: GeoNames via Open-Meteo Geocoding API",
      },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch (error) {
    console.error("Geocoding request failed:", error);
    return Response.json({ error: "Unable to search for that location right now." }, { status: 502 });
  }
}
