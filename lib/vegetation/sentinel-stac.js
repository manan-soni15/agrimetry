/**
 * Copernicus Data Space Ecosystem (CDSE) STAC Scene Discovery Client.
 *
 * Official endpoint:
 * https://stac.dataspace.copernicus.eu/v1/search
 * Documentation:
 * https://documentation.dataspace.copernicus.eu/APIs/STAC.html
 */

const STAC_ENDPOINT = "https://stac.dataspace.copernicus.eu/v1/search";

/**
 * Discovers Sentinel-2 L2A acquisitions intersecting a field geometry.
 *
 * @param {Object} params
 * @param {Object} params.geometry - GeoJSON Polygon or MultiPolygon
 * @param {Date} params.from - Start date
 * @param {Date} params.to - End date
 * @param {number} [params.maxCloudCover=100] - Scene-level cloud cover threshold (0-100)
 * @param {number} [params.limit=50] - Maximum scenes to return
 * @returns {Promise<Array<Object>>} List of discovered scene descriptors
 */
export async function discoverSentinelScenes({
  geometry,
  from,
  to,
  maxCloudCover = 100,
  limit = 50,
}) {
  const datetime = `${from.toISOString()}/${to.toISOString()}`;

  const payload = {
    collections: ["sentinel-2-l2a"],
    intersects: geometry,
    datetime,
    limit: Math.min(limit, 100),
    query: {
      "eo:cloud_cover": {
        lte: maxCloudCover,
      },
    },
  };

  try {
    const response = await fetch(STAC_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/geo+json, application/json",
      },
      body: JSON.stringify(payload),
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      console.warn(`CDSE STAC query returned status ${response.status}`);
      return [];
    }

    const data = await response.json();
    const features = data?.features || [];

    return features.map((feature) => {
      const props = feature.properties || {};
      const cloud = props["eo:cloud_cover"] ?? props.cloudCover ?? null;
      const tile = props["s2:mgrs_tile"] || props.mgrs_tile || feature.id?.match(/_T([0-9]{2}[A-Z]{3})_/)?.[1] || null;
      const platform = props.platform || (feature.id?.startsWith("S2A") ? "Sentinel-2A" : feature.id?.startsWith("S2B") ? "Sentinel-2B" : "Sentinel-2");

      return {
        id: feature.id,
        datetime: props.datetime || feature.id?.match(/\d{8}T\d{6}/)?.[0] || null,
        cloudCoverPercent: cloud !== null ? Number(cloud.toFixed(1)) : null,
        tileId: tile,
        platform,
        processingBaseline: props["s2:processing_baseline"] || null,
        orbitDirection: props["sat:orbit_state"] || null,
        sunElevation: props["view:sun_elevation"] ?? null,
      };
    }).sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());
  } catch (error) {
    console.error("Copernicus STAC scene discovery failed:", error);
    return [];
  }
}

