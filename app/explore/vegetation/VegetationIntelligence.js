"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { area as calculateArea } from "@turf/area";

const FIELDS_KEY = "agrimetry:global-farm-map:v1";
const SELECTED_FIELD_KEY = "agrimetry:vegetation:selected-field:v1";
const PALETTE = ["#8f552e", "#c79d57", "#e6dca5", "#a8bd75", "#56864b", "#245b38"];
const MIN_SENTINEL_DATE = "2015-06-27";

function Icon({ name, size = 18 }) {
  const paths = {
    leaf: <><path d="M20.5 3.5C12 3.5 5 6.6 5 13.2c0 3.3 2.3 5.3 5.2 5.3 6.3 0 9.9-7.3 10.3-15Z"/><path d="M3.5 21c3.1-5.1 7.4-8.4 13-11"/></>,
    back: <path d="m15 18-6-6 6-6"/>,
    satellite: <><path d="m7 7 10 10M5 11l6-6M13 19l6-6"/><path d="M4 4 8 2l2 2-2 4-4-4Zm12 12 4-2 2 2-2 4-4-4Z"/><path d="M2 22 8 16m-6 0v6h6"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-3"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></>,
    external: <><path d="M14 3h7v7m0-7-9 9"/><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15m6-12v15"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.info}</svg>;
}

function dateForInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fieldName(feature, index = 0) {
  return feature?.properties?.fieldName || feature?.properties?.name || `Field ${index + 1}`;
}

function getAllOuterCoordinates(feature) {
  const geometry = feature?.geometry;
  if (geometry?.type === "Polygon") return geometry.coordinates?.[0] || [];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates?.flatMap((polygon) => polygon?.[0] || []) || [];
  return [];
}

function fieldKey(feature, index = 0) {
  return String(feature?.id || feature?.properties?.fieldName || `field-${index}`);
}

function areaLabel(feature) {
  try {
    const squareMetres = calculateArea(feature);
    if (!Number.isFinite(squareMetres)) return "Area unavailable";
    const hectares = squareMetres / 10000;
    const acres = squareMetres / 4046.8564224;
    return `${hectares.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha · ${acres.toLocaleString(undefined, { maximumFractionDigits: 2 })} acres`;
  } catch {
    return "Area unavailable";
  }
}

function formatNdvi(value) {
  return Number.isFinite(value) ? value.toFixed(3) : "—";
}

function formatMonth(value) {
  if (!value) return "—";
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" });
}

function getNdviInterpretation(value) {
  if (!Number.isFinite(value)) return { label: "No clear reading", detail: "The satellite could not see enough usable pixels inside this field during the selected period." };
  if (value < 0.15) return { label: "Very little green signal", detail: "The satellite saw little green vegetation in the usable pixels. This can happen after harvest, before planting, over bare ground or water, or when crops are sparse. The number alone cannot tell us which reason applies." };
  if (value < 0.35) return { label: "A light green cover", detail: "Some green vegetation is visible, but the overall signal is relatively low. A young crop, widely spaced plants, a crop nearing harvest or patches of exposed soil can all produce this pattern." };
  if (value < 0.60) return { label: "A moderate green cover", detail: "The field is showing a noticeable vegetation signal. Whether this is expected depends on the crop, planting date and stage of growth." };
  return { label: "A strong green cover", detail: "The field is showing a strong vegetation greenness signal in the clear pixels. This is encouraging evidence of green cover, but it does not by itself prove plant health, soil fertility or expected yield." };
}

function shiftYearBack(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const shifted = new Date(Date.UTC(year - 1, month - 1, day));
  // 29 Feb of a leap year rolls into March; clamp back to the last day of Feb.
  if (shifted.getUTCMonth() !== month - 1) shifted.setUTCDate(0);
  return shifted.toISOString().slice(0, 10);
}

function buildSeasonComparison(current, previous) {
  if (!current?.monthly || !previous?.monthly) return null;
  const pairs = [];
  current.monthly.forEach((item, index) => {
    const before = previous.monthly[index];
    if (Number.isFinite(item.meanNdvi) && Number.isFinite(before?.meanNdvi)) {
      pairs.push({ month: item.month, previousMonth: before.month, current: item.meanNdvi, previous: before.meanNdvi, delta: item.meanNdvi - before.meanNdvi });
    }
  });
  if (!pairs.length) return { pairs, averageDelta: null, higher: 0, lower: 0 };
  const averageDelta = pairs.reduce((sum, pair) => sum + pair.delta, 0) / pairs.length;
  return {
    pairs,
    averageDelta,
    higher: pairs.filter((pair) => pair.delta >= 0.04).length,
    lower: pairs.filter((pair) => pair.delta <= -0.04).length,
  };
}

function formatObservationDate(value) {
  if (!value) return "the latest clear observation";
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function buildFieldStory(result) {
  const summary = result?.summary || {};
  const monthly = Array.isArray(result?.monthly) ? result.monthly : [];
  const usableMonths = monthly.filter((item) => Number.isFinite(item.meanNdvi));
  const latestMonth = [...usableMonths].reverse()[0] || null;
  const firstMonth = usableMonths[0] || null;
  const latestValue = Number.isFinite(summary.latestMonthMeanNdvi)
    ? summary.latestMonthMeanNdvi
    : Number.isFinite(summary.meanNdvi) ? summary.meanNdvi : null;
  const interpretation = getNdviInterpretation(latestValue);
  const latestDate = formatObservationDate(summary.latestObservation || latestMonth?.observedAt);
  const meanText = latestValue == null ? "no clear vegetation reading" : `an NDVI reading of ${latestValue.toFixed(2)}`;
  const selectedFieldName = result?.field ? fieldName(result.field) : "this field";
  const opening = `On ${latestDate}, the clearest usable Sentinel-2 observation showed ${meanText}. In everyday language, this is a measure of how much green vegetation the satellite could see inside ${selectedFieldName} — not a score of how good the crop or soil is.`;

  let trendTitle = "Not enough dates for a trend";
  let trendDetail = "We found fewer than two months with usable observations. The map and field reading can still be useful as a snapshot, but we should not describe a direction of change yet.";
  let trendDirection = "unknown";
  let trendDelta = null;
  if (firstMonth && latestMonth && firstMonth.month !== latestMonth.month) {
    trendDelta = latestMonth.meanNdvi - firstMonth.meanNdvi;
    if (trendDelta >= 0.04) {
      trendDirection = "rising";
      trendTitle = "The green signal increased";
      trendDetail = `From ${formatMonth(firstMonth.month)} to ${formatMonth(latestMonth.month)}, the field's average NDVI moved from ${firstMonth.meanNdvi.toFixed(2)} to ${latestMonth.meanNdvi.toFixed(2)} (+${trendDelta.toFixed(2)}). More green vegetation was visible in the later observation. Crop growth can cause this, but seasonal timing and field checks are needed to confirm the reason.`;
    } else if (trendDelta <= -0.04) {
      trendDirection = "falling";
      trendTitle = "The green signal decreased";
      trendDetail = `From ${formatMonth(firstMonth.month)} to ${formatMonth(latestMonth.month)}, the field's average NDVI moved from ${firstMonth.meanNdvi.toFixed(2)} to ${latestMonth.meanNdvi.toFixed(2)} (${trendDelta.toFixed(2)}). Less green vegetation was visible in the later observation. This can be a normal part of harvest or crop maturity, or a sign to inspect the field; the satellite reading cannot tell us the cause on its own.`;
    } else {
      trendDirection = "steady";
      trendTitle = "The green signal was broadly steady";
      trendDetail = `From ${formatMonth(firstMonth.month)} to ${formatMonth(latestMonth.month)}, the field's average NDVI changed only slightly, from ${firstMonth.meanNdvi.toFixed(2)} to ${latestMonth.meanNdvi.toFixed(2)}. This may reflect a stable canopy or similar crop stages across the observations.`;
    }
  }

  const coverage = Number.isFinite(summary.validPixelFraction) ? summary.validPixelFraction : null;
  let coverageLabel = "Coverage unavailable";
  let coverageDetail = "The service did not return a clear-pixel coverage estimate for the latest usable scene.";
  if (coverage !== null) {
    if (coverage >= 0.75) {
      coverageLabel = "Good clear-pixel coverage";
      coverageDetail = `${(coverage * 100).toFixed(0)}% of the pixels expected inside the field were usable in the latest processed scene. The reading represents most of the mapped field, though small gaps may remain.`;
    } else if (coverage >= 0.4) {
      coverageLabel = "Partial clear-pixel coverage";
      coverageDetail = `Only ${(coverage * 100).toFixed(0)}% of the expected field pixels were usable in the latest processed scene. Clouds, shadows or missing scene coverage may hide parts of the field, so treat the average as a partial view.`;
    } else {
      coverageLabel = "Limited clear-pixel coverage";
      coverageDetail = `Only ${(coverage * 100).toFixed(0)}% of the expected field pixels were usable in the latest processed scene. This is a limited view; wait for another clear pass or widen the observation window before relying on the field average.`;
    }
  }

  let nextStep = "Compare this observation with the crop type and planting or harvest date. Walk the field and check whether the visible crop stage matches the satellite picture. Use the map to identify areas worth a closer look.";
  if (trendDirection === "falling" || (latestValue !== null && latestValue < 0.35)) {
    nextStep = "Visit the field and compare what you see with the crop calendar. Check whether the field has recently been harvested or is between crop cycles; if a crop is actively growing, inspect lower-greenness patches for water, nutrient, pest or disease issues and seek local agronomic advice. NDVI cannot diagnose the cause.";
  } else if (trendDirection === "rising") {
    nextStep = "Compare the increase with the crop's planting date and expected growth stage. A growing green canopy may explain the change. Keep monitoring the next clear observation and confirm the pattern during a field visit; rising NDVI is not a yield forecast.";
  }
  if (coverage !== null && coverage < 0.4) {
    nextStep = "The latest image only shows a small clear portion of this field. Before drawing conclusions, try a wider date window or wait for another clear satellite pass. Then compare the map with an on-the-ground inspection.";
  } else if (coverage !== null && coverage < 0.75) {
    nextStep += " Because some of the field was hidden by clouds, shadows or missing coverage, treat this as a partial view and confirm it during a field visit.";
  }

  return {
    interpretation,
    opening,
    trendTitle,
    trendDetail,
    trendDirection,
    trendDelta,
    coverageLabel,
    coverageDetail,
    nextStep,
    latestValue,
    latestDate,
    usableMonthCount: usableMonths.length,
  };
}

const LOADING_STAGES = [
  { title: "Finding satellite scenes for your field", detail: "Agrimetry is searching the public Sentinel-2 catalogue for images that overlap your saved boundary and date range." },
  { title: "Opening the satellite image bands", detail: "The system is reading the red, near-infrared and scene-classification pixels needed for the calculation." },
  { title: "Separating clear pixels from clouds and shadows", detail: "Cloudy, shadowed and unusable pixels are being removed before the field statistics are calculated." },
  { title: "Reading the green story of your field", detail: "Agrimetry is calculating NDVI inside your boundary and assembling the monthly observations and map layer." },
  { title: "Finishing the field report", detail: "The imagery is still being processed. Larger fields, longer date ranges or slow public data downloads can take a few minutes." },
];

function NdviChart({ data, previous }) {
  const validCount = data.filter((item) => Number.isFinite(item.meanNdvi)).length;
  if (validCount < 2) {
    return <div className="vi-chart-empty">At least two months with clear Sentinel-2 observations are needed to draw a trend.</div>;
  }

  const width = 720;
  const height = 220;
  const left = 42;
  const right = 18;
  const top = 18;
  const bottom = 42;
  const min = -0.1;
  const max = 0.9;
  const x = (index) => left + (index / Math.max(1, data.length - 1)) * (width - left - right);
  const y = (value) => top + ((max - value) / (max - min)) * (height - top - bottom);

  // Keep the original month positions. Missing months break the line rather
  // than compressing time or being silently treated as zero.
  const segments = [];
  let currentSegment = [];
  data.forEach((item, index) => {
    if (Number.isFinite(item.meanNdvi)) currentSegment.push({ item, index });
    else if (currentSegment.length) {
      segments.push(currentSegment);
      currentSegment = [];
    }
  });
  if (currentSegment.length) segments.push(currentSegment);

  const labelIndices = [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])];

  // Previous-season series is aligned by month position (same window, one year earlier).
  const previousSegments = [];
  if (previous?.length) {
    let segment = [];
    data.forEach((_, index) => {
      const value = previous[index]?.meanNdvi;
      if (Number.isFinite(value)) segment.push({ value, index, month: previous[index].month });
      else if (segment.length) { previousSegments.push(segment); segment = []; }
    });
    if (segment.length) previousSegments.push(segment);
  }

  return (
    <div className="vi-chart-wrap">
      {previousSegments.length > 0 && <div className="vi-chart-legend"><span><i className="current"/> Selected period</span><span><i className="previous"/> Same months, previous year</span></div>}
      <svg className="vi-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Monthly field mean NDVI time series">
        {[0, 0.25, 0.5, 0.75].map((tick) => <g key={tick}><line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke="#e6dece" strokeDasharray="4 6"/><text x={left - 10} y={y(tick) + 4} textAnchor="end" fill="#8a927f" fontSize="11">{tick.toFixed(2)}</text></g>)}
        <defs><linearGradient id="viAreaFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#6e925f" stopOpacity=".28"/><stop offset="100%" stopColor="#6e925f" stopOpacity=".015"/></linearGradient></defs>
        {segments.filter((segment) => segment.length > 1).map((segment, segmentIndex) => {
          const points = segment.map(({ item, index }) => `${x(index)},${y(item.meanNdvi)}`).join(" ");
          const first = segment[0];
          const last = segment[segment.length - 1];
          const areaPath = `M ${x(first.index)} ${height - bottom} L ${segment.map(({ item, index }) => `${x(index)} ${y(item.meanNdvi)}`).join(" L ")} L ${x(last.index)} ${height - bottom} Z`;
          return <g key={`segment-${segmentIndex}`}><path d={areaPath} fill="url(#viAreaFill)"/><polyline points={points} fill="none" stroke="#315f3d" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></g>;
        })}
        {previousSegments.map((segment, segmentIndex) => (
          <g key={`previous-${segmentIndex}`}>
            {segment.length > 1 && <polyline points={segment.map(({ value, index }) => `${x(index)},${y(value)}`).join(" ")} fill="none" stroke="#b8893a" strokeWidth="2.4" strokeDasharray="6 5" strokeLinecap="round" strokeLinejoin="round"/>}
            {segment.map(({ value, index, month }) => <circle key={month} cx={x(index)} cy={y(value)} r="3.4" fill="#b8893a" stroke="#fbf9f3" strokeWidth="1.5"><title>{formatMonth(month)} (previous year): {value.toFixed(3)} NDVI</title></circle>)}
          </g>
        ))}
        {data.map((item, index) => Number.isFinite(item.meanNdvi) ? <circle key={item.month} cx={x(index)} cy={y(item.meanNdvi)} r="4.2" fill="#315f3d" stroke="#fbf9f3" strokeWidth="2"><title>{formatMonth(item.month)}: {item.meanNdvi.toFixed(3)} NDVI</title></circle> : null)}
        {labelIndices.map((index) => <text key={data[index].month} x={x(index)} y={height - 13} textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"} fill="#858c7c" fontSize="11">{formatMonth(data[index].month)}</text>)}
      </svg>
    </div>
  );
}

export default function VegetationIntelligence() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const maplibreRef = useRef(null);
  const basemapRef = useRef("satellite");
  const [fields, setFields] = useState([]);
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [todayDate, setTodayDate] = useState("");
  const [cloudLimit, setCloudLimit] = useState(70);
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [mapError, setMapError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [basemap, setBasemap] = useState("satellite");
  const [showNdvi, setShowNdvi] = useState(true);
  const [showHotspots, setShowHotspots] = useState(true);
  const [showZones, setShowZones] = useState(false);
  const [compareSeasons, setCompareSeasons] = useState(true);
  const [previousResult, setPreviousResult] = useState(null);
  const [previousLoading, setPreviousLoading] = useState(false);
  const [previousError, setPreviousError] = useState("");
  const runIdRef = useRef(0);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(FIELDS_KEY) || "[]");
      const selected = JSON.parse(localStorage.getItem(SELECTED_FIELD_KEY) || "null");
      const safeFields = Array.isArray(stored) ? stored.filter((feature) => ["Polygon", "MultiPolygon"].includes(feature?.geometry?.type)) : [];
      if (selected?.geometry && !safeFields.some((feature) => String(feature.id) === String(selected.id))) safeFields.unshift(selected);
      setFields(safeFields);
      if (selected?.geometry) setSelectedFieldId(fieldKey(selected));
      else if (safeFields.length) setSelectedFieldId(fieldKey(safeFields[0], 0));
    } catch (readError) {
      console.warn("Could not read saved Agrimetry field boundaries:", readError);
      setError("Saved field boundaries could not be read. Return to the Global Farm Map and save the field again.");
    }

    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 12);
    setEndDate(dateForInput(end));
    setTodayDate(dateForInput(end));
    setStartDate(dateForInput(start));
  }, []);

  // The public STAC/COG service does not expose server-side progress events.
  // This timer shows honest elapsed time and indicative processing stages,
  // not a fabricated percentage-complete value.
  useEffect(() => {
    if (!loading) {
      setElapsedSeconds(0);
      setLoadingStage(0);
      return undefined;
    }
    const startedAt = Date.now();
    const updateElapsed = () => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      setElapsedSeconds(seconds);
      setLoadingStage(seconds < 10 ? 0 : seconds < 24 ? 1 : seconds < 42 ? 2 : seconds < 68 ? 3 : 4);
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [loading]);

  const selectedFieldIndex = fields.findIndex((feature, index) => fieldKey(feature, index) === selectedFieldId);
  const selectedField = selectedFieldIndex >= 0 ? fields[selectedFieldIndex] : null;
  const selectedName = selectedField ? fieldName(selectedField, selectedFieldIndex) : "Selected field";
  const selectedArea = useMemo(() => selectedField ? areaLabel(selectedField) : "—", [selectedField]);
  const interpretation = getNdviInterpretation(result?.summary?.latestMonthMeanNdvi ?? result?.summary?.meanNdvi);
  const fieldStory = result ? buildFieldStory({ ...result, field: selectedField }) : null;
  const monthDelta = result?.summary?.latestMonthMeanNdvi != null && result?.summary?.previousMonthMeanNdvi != null
    ? result.summary.latestMonthMeanNdvi - result.summary.previousMonthMeanNdvi
    : null;

  const focusMap = useCallback((map, feature) => {
    const coordinates = getAllOuterCoordinates(feature);
    if (!map || !coordinates.length) return;
    const maplibre = maplibreRef.current;
    if (!maplibre?.LngLatBounds) return;
    const bounds = new maplibre.LngLatBounds(coordinates[0], coordinates[0]);
    coordinates.forEach((coordinate) => bounds.extend(coordinate));
    map.fitBounds(bounds, { padding: 70, maxZoom: 17, duration: 700 });
  }, []);

  useEffect(() => {
    let alive = true;
    let mapInstance;

    async function createMap() {
      if (!selectedField || !mapContainerRef.current) return;
      try {
        const maplibregl = await import("maplibre-gl");

        // MapLibre GL JS v6 ships its rendering worker as a separate module.
        // With Next.js/Turbopack, point MapLibre at the worker asset explicitly
        // before constructing any map. Keep this in this component as well as
        // the Global Farm Map: the vegetation route creates its own MapLibre map.
        if (typeof maplibregl.setWorkerUrl !== "function") {
          throw new Error(
            "MapLibre worker setup is unavailable. Confirm maplibre-gl v6 is installed and dependencies are up to date."
          );
        }
        maplibregl.setWorkerUrl(
          new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString()
        );

        if (!alive || !mapContainerRef.current) return;
        maplibreRef.current = maplibregl;

        const coords = getAllOuterCoordinates(selectedField);
        const center = coords.length
          ? coords.reduce((acc, point) => [acc[0] + Number(point[0]) / coords.length, acc[1] + Number(point[1]) / coords.length], [0, 0])
          : [0, 20];

        mapInstance = new maplibregl.Map({
          container: mapContainerRef.current,
          style: {
            version: 8,
            sources: {
              satellite: {
                type: "raster",
                tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
                tileSize: 256,
                maxzoom: 19,
                attribution: "Tiles © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
              },
              street: {
                type: "raster",
                tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                tileSize: 256,
                maxzoom: 19,
                layout: { visibility: "none" },
                attribution: "© OpenStreetMap contributors",
              },
            },
            layers: [
              { id: "vi-satellite", type: "raster", source: "satellite", layout: { visibility: basemapRef.current === "satellite" ? "visible" : "none" } },
              { id: "vi-street", type: "raster", source: "street", layout: { visibility: basemapRef.current === "street" ? "visible" : "none" } },
            ],
          },
          center,
          zoom: 15,
          minZoom: 1,
          maxZoom: 19,
          attributionControl: { compact: true },
        });

        mapRef.current = mapInstance;
        mapInstance.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
        mapInstance.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");
        mapInstance.on("load", () => {
          if (!alive) return;
          mapInstance.addSource("vi-field", { type: "geojson", data: selectedField });
          mapInstance.addLayer({ id: "vi-field-fill", type: "fill", source: "vi-field", paint: { "fill-color": "#e4c77c", "fill-opacity": 0.10 } });
          mapInstance.addLayer({ id: "vi-field-line", type: "line", source: "vi-field", paint: { "line-color": "#f3d58a", "line-width": 3, "line-dasharray": [2, 1] } });
          setMapReady(true);
          focusMap(mapInstance, selectedField);
        });
        mapInstance.on("error", (event) => {
          if (event?.error) setMapError("Some map tiles could not be loaded. Check your connection or tile-provider availability.");
        });
      } catch (mapInitError) {
        console.error("Vegetation map initialization failed:", mapInitError);
        setMapError("The field map could not be initialized. Check that MapLibre is installed and the browser console for details.");
      }
    }

    setMapReady(false);
    setMapError("");
    createMap();
    return () => {
      alive = false;
      if (mapInstance) mapInstance.remove();
      if (mapRef.current === mapInstance) mapRef.current = null;
    };
  }, [selectedFieldId, selectedField, focusMap]);

  useEffect(() => {
    basemapRef.current = basemap;
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (map.getLayer("vi-satellite")) map.setLayoutProperty("vi-satellite", "visibility", basemap === "satellite" ? "visible" : "none");
    if (map.getLayer("vi-street")) map.setLayoutProperty("vi-street", "visibility", basemap === "street" ? "visible" : "none");
  }, [basemap, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const visibility = showNdvi && result?.map?.imageDataUrl ? "visible" : "none";
    if (map.getLayer("vi-ndvi-raster")) map.setLayoutProperty("vi-ndvi-raster", "visibility", visibility);
  }, [showNdvi, result, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !result?.map?.imageDataUrl || !Array.isArray(result?.map?.coordinates)) return;
    const addLayer = () => {
      if (!mapRef.current || mapRef.current !== map) return;
      try {
        if (map.getLayer("vi-ndvi-raster")) map.removeLayer("vi-ndvi-raster");
        if (map.getSource("vi-ndvi")) map.removeSource("vi-ndvi");
        map.addSource("vi-ndvi", {
          type: "image",
          url: result.map.imageDataUrl,
          coordinates: result.map.coordinates,
        });
        map.addLayer({
          id: "vi-ndvi-raster",
          type: "raster",
          source: "vi-ndvi",
          paint: { "raster-opacity": 0.84, "raster-resampling": "nearest" },
          layout: { visibility: showNdvi ? "visible" : "none" },
        }, map.getLayer("vi-field-fill") ? "vi-field-fill" : undefined);
      } catch (tileError) {
        console.error("Could not add the field NDVI image:", tileError);
        setMapError("The field NDVI image could not be added to the map. Run the analysis again.");
      }
    };
    if (map.isStyleLoaded()) addLayer();
    else map.once("load", addLayer);
  }, [result, showNdvi, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const imageUrl = result?.lowVegetation?.imageDataUrl;
    if (!map || !imageUrl || !Array.isArray(result?.map?.coordinates)) return;
    const addHotspots = () => {
      if (!mapRef.current || mapRef.current !== map) return;
      try {
        if (map.getLayer("vi-hotspot-raster")) map.removeLayer("vi-hotspot-raster");
        if (map.getSource("vi-hotspot")) map.removeSource("vi-hotspot");
        map.addSource("vi-hotspot", { type: "image", url: imageUrl, coordinates: result.map.coordinates });
        map.addLayer({
          id: "vi-hotspot-raster",
          type: "raster",
          source: "vi-hotspot",
          paint: { "raster-opacity": 0.9, "raster-resampling": "nearest" },
          layout: { visibility: showHotspots ? "visible" : "none" },
        }, map.getLayer("vi-field-line") ? "vi-field-line" : undefined);
      } catch (hotspotError) {
        console.error("Could not add the low-vegetation overlay:", hotspotError);
      }
    };
    if (map.isStyleLoaded()) addHotspots();
    else map.once("load", addHotspots);
    // Visibility is handled by the effect below; do not re-add on toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getLayer("vi-hotspot-raster")) return;
    map.setLayoutProperty("vi-hotspot-raster", "visibility", showHotspots ? "visible" : "none");
  }, [showHotspots, result, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const imageUrl = result?.fieldVariability?.zonesImageDataUrl;
    if (!map || !imageUrl || !Array.isArray(result?.map?.coordinates)) return;
    const addZones = () => {
      if (!mapRef.current || mapRef.current !== map) return;
      try {
        if (map.getLayer("vi-zones-raster")) map.removeLayer("vi-zones-raster");
        if (map.getSource("vi-zones")) map.removeSource("vi-zones");
        map.addSource("vi-zones", { type: "image", url: imageUrl, coordinates: result.map.coordinates });
        map.addLayer({
          id: "vi-zones-raster",
          type: "raster",
          source: "vi-zones",
          paint: { "raster-opacity": 0.85, "raster-resampling": "nearest" },
          layout: { visibility: "none" },
        }, map.getLayer("vi-field-line") ? "vi-field-line" : undefined);
      } catch (zoneError) {
        console.error("Could not add the management-zone overlay:", zoneError);
      }
    };
    if (map.isStyleLoaded()) addZones();
    else map.once("load", addZones);
  }, [result, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getLayer("vi-zones-raster")) return;
    map.setLayoutProperty("vi-zones-raster", "visibility", showZones ? "visible" : "none");
    // Show either the NDVI picture or the zones, not both stacked.
    if (map.getLayer("vi-ndvi-raster")) map.setLayoutProperty("vi-ndvi-raster", "visibility", showZones ? "none" : (showNdvi ? "visible" : "none"));
  }, [showZones, showNdvi, result, mapReady]);

  async function requestVegetation(field, start, end) {
    const response = await fetch("/api/vegetation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, startDate: start, endDate: end, cloudLimit: Number(cloudLimit) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Vegetation analysis failed (HTTP ${response.status}).`);
    if (!payload?.summary || !Array.isArray(payload?.monthly)) {
      throw new Error("The satellite service returned an incomplete report. Please try a shorter date range or run the analysis again.");
    }
    return payload;
  }

  async function loadPreviousSeason(field, start, end, runId) {
    setPreviousLoading(true);
    setPreviousError("");
    setPreviousResult(null);
    try {
      const previousStart = shiftYearBack(start);
      if (previousStart < MIN_SENTINEL_DATE) {
        throw new Error("The same window one year earlier is before Sentinel-2 Level-2A coverage begins, so no comparison is available.");
      }
      const payload = await requestVegetation(field, previousStart, shiftYearBack(end));
      if (runIdRef.current === runId) setPreviousResult(payload);
    } catch (previousRequestError) {
      if (runIdRef.current === runId) setPreviousError(previousRequestError.message || "The previous-year comparison could not be completed.");
    } finally {
      if (runIdRef.current === runId) setPreviousLoading(false);
    }
  }

  async function runAnalysis(event) {
    event?.preventDefault();
    if (!selectedField) {
      setError("Choose or save a farm boundary on the Global Farm Map first.");
      return;
    }
    if (!startDate || !endDate) {
      setError("Choose the observation start and end dates.");
      return;
    }
    setLoading(true);
    setError("");
    setMapError("");
    setResult(null);
    setPreviousResult(null);
    setPreviousError("");
    setPreviousLoading(false);
    runIdRef.current += 1;
    const runId = runIdRef.current;
    try {
      const payload = await requestVegetation(selectedField, startDate, endDate);
      setResult(payload);
      try {
        localStorage.setItem("agrimetry:completed-vegetation-analysis:v1", JSON.stringify({
          field: selectedField,
          result: { summary: payload.summary, monthly: payload.monthly, phenology: payload.phenology || null, lowVegetation: payload.lowVegetation || null, fieldVariability: payload.fieldVariability || null, hlsHistory: payload.hlsHistory || null },
          startDate, endDate, completedAt: new Date().toISOString(),
        }));
      } catch (storageError) { console.warn("Could not save completed field analysis for Land Storyteller:", storageError); }
      // Previous-year comparison runs after the main report is shown, so a slow or
      // failed comparison never blocks the current analysis.
      if (compareSeasons) loadPreviousSeason(selectedField, startDate, endDate, runId);
    } catch (requestError) {
      setError(requestError.message || "Unable to run Sentinel-2 vegetation analysis.");
    } finally {
      setLoading(false);
    }
  }

  function selectField(id) {
    const feature = fields.find((item, index) => fieldKey(item, index) === id);
    setSelectedFieldId(id);
    try {
      const cached = JSON.parse(localStorage.getItem("agrimetry:completed-vegetation-analysis:v1") || "null");
      if (JSON.stringify(cached?.field?.geometry || null) !== JSON.stringify(feature?.geometry || null)) localStorage.removeItem("agrimetry:completed-vegetation-analysis:v1");
    } catch {}
    runIdRef.current += 1;
    setResult(null);
    setPreviousResult(null);
    setPreviousError("");
    setPreviousLoading(false);
    setError("");
    if (feature) {
      try { localStorage.setItem(SELECTED_FIELD_KEY, JSON.stringify(feature)); } catch {}
    }
  }

  function switchBasemap(nextBasemap) {
    basemapRef.current = nextBasemap;
    setBasemap(nextBasemap);
  }

  const seasonComparison = useMemo(() => buildSeasonComparison(result, previousResult), [result, previousResult]);
  const lowVegetation = result?.lowVegetation;
  const fieldVariability = result?.fieldVariability;
  const phenology = result?.phenology;
  const ndviLatestLabel = result?.summary?.latestMonth ? formatMonth(result.summary.latestMonth) : "No clear month";
  const validPixelCount = result?.summary?.validPixelCount || 0;

  return (
    <main className="vi-page">
      <header className="vi-header">
        <div className="vi-brand-wrap">
          <Link href="/explore/map" className="vi-back" aria-label="Back to global farm map"><Icon name="back" size={18}/></Link>
          <Link href="/" className="vi-brand"><span className="vi-brand-mark"><Icon name="leaf" size={19}/></span><span>agrimetry<span>.</span></span></Link>
          <span className="vi-divider"/>
          <div className="vi-header-title"><small>FIELD INTELLIGENCE</small><strong>Vegetation analysis</strong></div>
        </div>
        <div className="vi-header-actions"><span className="vi-source-pill"><i/> SENTINEL-2 + NASA HLS</span><Link href="/explore/water-stress" className="vi-explore-link">Water stress</Link><Link href="/explore/bare-field" className="vi-explore-link">Bare fields</Link><Link href="/explore/map" className="vi-explore-link">Global farm map</Link></div>
      </header>

      <div className="vi-content">
        <section className="vi-intro">
          <div>
            <span className="vi-kicker"><span/> FIELD VEGETATION INTELLIGENCE</span>
            <h1>Read the <em>green</em> story of your field.</h1>
            <p>Public Sentinel-2 scenes are discovered for the exact field boundary you select. Agrimetry reads the red, near-infrared and scene-classification COGs, masks clouds and shadows, calculates field-only NDVI and summarizes the best available scene for each month.</p>
          </div>
          <div className="vi-intro-note"><Icon name="satellite" size={20}/><span>10 m red / NIR bands · 20 m SCL<br/><strong>Sentinel-2 needs no key · HLS history uses NASA Earthdata</strong></span></div>
        </section>

        {fields.length === 0 ? (
          <section className="vi-empty-state">
            <div className="vi-empty-icon"><Icon name="map" size={28}/></div>
            <div><span className="vi-kicker">NO SAVED FIELD FOUND</span><h2>Choose a field before analysing vegetation.</h2><p>Go to the Global Farm Map, draw or discover a boundary, save it, then choose <strong>Analyze NDVI</strong> next to that field.</p><Link href="/explore/map" className="vi-primary-button">Open Global Farm Map <Icon name="external" size={15}/></Link></div>
          </section>
        ) : (
          <div className="vi-workspace">
            <aside className="vi-controls-panel">
              <div className="vi-panel-heading"><span className="vi-section-number">01</span><div><small>ANALYSIS SETUP</small><h2>Choose your field</h2></div></div>
              <label className="vi-field-label">Saved farm / field
                <select value={selectedFieldId} onChange={(event) => selectField(event.target.value)}>
                  {fields.map((feature, index) => <option key={fieldKey(feature, index)} value={fieldKey(feature, index)}>{fieldName(feature, index)} · {areaLabel(feature)}</option>)}
                </select>
              </label>
              <div className="vi-selected-summary"><span className="vi-summary-icon"><Icon name="map" size={17}/></span><div><strong>{selectedName}</strong><small>{selectedArea}</small></div></div>

              <div className="vi-panel-divider"/>
              <div className="vi-panel-heading"><span className="vi-section-number">02</span><div><small>OBSERVATION WINDOW</small><h2>Choose a period</h2></div></div>
              <div className="vi-date-grid">
                <label>From<input type="date" min={MIN_SENTINEL_DATE} max={endDate || undefined} value={startDate} onChange={(event) => setStartDate(event.target.value)}/></label>
                <label>To<input type="date" min={startDate || MIN_SENTINEL_DATE} max={todayDate || undefined} value={endDate} onChange={(event) => setEndDate(event.target.value)}/></label>
              </div>
              <div className="vi-cloud-control"><div><label htmlFor="vi-cloud-limit">Scene cloud threshold</label><strong>{cloudLimit}%</strong></div><input id="vi-cloud-limit" type="range" min="10" max="90" step="5" value={cloudLimit} onChange={(event) => setCloudLimit(event.target.value)}/><small>Scenes with a higher metadata cloud percentage are excluded. Pixel-level cloud and shadow masking is applied separately using SCL.</small></div>
              <label className="vi-check-row"><input type="checkbox" checked={compareSeasons} onChange={(event) => setCompareSeasons(event.target.checked)}/><span>Compare with the same months last year<small>Runs a second analysis for the previous year after the main report. This takes extra time.</small></span></label>
              <button type="button" className="vi-run-button" onClick={runAnalysis} disabled={loading || !selectedField || !startDate || !endDate}><Icon name={loading ? "refresh" : "leaf"} size={17}/>{loading ? "Analysing Sentinel-2 scenes…" : "Run vegetation analysis"}</button>
              {error && <div className="vi-error" role="alert"><Icon name="info" size={17}/><span>{error}</span></div>}
              <div className="vi-source-note"><Icon name="info" size={15}/><p>Sentinel-2 is an ESA/Copernicus mission, not a NASA mission. Agrimetry discovers public Level-2A scenes through Element 84 Earth Search and processes their public Cloud-Optimized GeoTIFF assets directly. No Earth Engine account, API key or service-account environment variables are required for this main analysis. The optional historical HLS comparison uses NASA Earthdata and needs a server-side NASA_EARTHDATA_TOKEN.</p></div>
            </aside>

            <section className="vi-results-area">
              {loading && (
                <section className="vi-analysis-progress" role="status" aria-live="polite" aria-atomic="true">
                  <div className="vi-progress-head">
                    <span className="vi-progress-orbit"><span/><i/></span>
                    <div><span className="vi-overline">AGRIMETRY IS READING YOUR FIELD</span><h2>{LOADING_STAGES[loadingStage].title}</h2></div>
                    <time>{Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, "0")}</time>
                  </div>
                  <p className="vi-progress-detail">{LOADING_STAGES[loadingStage].detail}</p>
                  <div className="vi-progress-track" aria-hidden="true"><span/></div>
                  <div className="vi-progress-steps">
                    {LOADING_STAGES.slice(0, 4).map((stage, index) => (
                      <div className={`vi-progress-step ${index < loadingStage ? "done" : index === loadingStage ? "current" : ""}`} key={stage.title}>
                        <span>{index < loadingStage ? "✓" : String(index + 1).padStart(2, "0")}</span><small>{["Find scenes", "Read pixels", "Mask clouds", "Build report"][index]}</small>
                      </div>
                    ))}
                  </div>
                  <div className="vi-progress-note"><Icon name="info" size={14}/><span>This can take a few minutes. The public imagery service does not provide a live percentage, so these are indicative stages rather than a measured progress bar. Keep this page open while the analysis runs.</span></div>
                </section>
              )}
              <div className="vi-map-card">
                <div className="vi-map-card-head"><div><span className="vi-overline">FIELD VIEW</span><h2>{selectedName}</h2><small>{selectedArea} · outlined boundary</small></div><div className="vi-map-controls"><div className="vi-basemap-toggle"><button type="button" className={basemap === "satellite" ? "active" : ""} onClick={() => switchBasemap("satellite")}>Satellite</button><button type="button" className={basemap === "street" ? "active" : ""} onClick={() => switchBasemap("street")}>Street</button></div><button type="button" className={`vi-layer-toggle ${showNdvi && result ? "active" : ""}`} onClick={() => setShowNdvi((value) => !value)} disabled={!result}>NDVI {showNdvi && result ? "On" : "Off"}</button><button type="button" className={`vi-layer-toggle vi-hotspot-toggle ${showHotspots && lowVegetation?.imageDataUrl ? "active" : ""}`} onClick={() => setShowHotspots((value) => !value)} disabled={!lowVegetation?.imageDataUrl}>Low areas {showHotspots && lowVegetation?.imageDataUrl ? "On" : "Off"}</button><button type="button" className={`vi-layer-toggle ${showZones && fieldVariability?.zonesImageDataUrl ? "active" : ""}`} onClick={() => setShowZones((value) => !value)} disabled={!fieldVariability?.zonesImageDataUrl}>Zones {showZones && fieldVariability?.zonesImageDataUrl ? "On" : "Off"}</button></div></div>
                <div className="vi-map-wrap"><div ref={mapContainerRef} className="vi-map-canvas"/>{!mapReady && <div className="vi-map-loading"><span className="vi-spinner"/><strong>Preparing selected field</strong></div>}{mapError && <div className="vi-map-error">{mapError}</div>}{!result && !loading && <div className="vi-map-hint">Run analysis to render the median NDVI image inside this saved field boundary.</div>}{loading && <div className="vi-map-hint vi-map-hint-loading">Your selected field is being analysed…</div>}</div>
                <div className="vi-map-legend"><span>LOW NDVI</span><div className="vi-legend-ramp">{PALETTE.map((color) => <i key={color} style={{ background: color }}/>)}</div><span>HIGH NDVI</span>{lowVegetation?.imageDataUrl && <span className="vi-legend-hotspot"><i/> Unusually low area</span>}</div>
              </div>

              {!result ? (
                <div className="vi-wait-panel"><span className="vi-wait-mark"><Icon name="leaf" size={22}/></span><div><strong>Your field-specific vegetation report will appear here.</strong><p>Select an observation period and run the analysis. The request uses this saved polygon—not only the map centre coordinate.</p></div></div>
              ) : (
                <>
                  <div className="vi-result-heading"><div><span className="vi-overline">03 / YOUR FIELD REPORT</span><h2>The story your field is telling.</h2><p>{result.period.startDate} to {result.period.endDate} · {result.source.name}</p></div><span className="vi-live-badge"><i/> ANALYSIS COMPLETE</span></div>
                  <section className="vi-story-panel">
                    <div className="vi-story-intro"><span className="vi-story-leaf"><Icon name="leaf" size={21}/></span><div><span className="vi-overline">A FIELD NOTE FROM AGRIMETRY</span><h2>{fieldStory.interpretation.label}</h2><p>{fieldStory.opening}</p></div></div>
                    <div className="vi-story-grid">
                      <article className={`vi-story-cell trend-${fieldStory.trendDirection}`}><span>HOW THE FIELD CHANGED</span><strong>{fieldStory.trendTitle}</strong><p>{fieldStory.trendDetail}</p></article>
                      <article className="vi-story-cell"><span>HOW MUCH COULD THE SATELLITE SEE?</span><strong>{fieldStory.coverageLabel}</strong><p>{fieldStory.coverageDetail}</p></article>
                    </div>
                    <div className="vi-story-next"><span className="vi-overline">A PRACTICAL NEXT STEP</span><p>{fieldStory.nextStep}</p></div>
                  </section>
                  <div className="vi-ndvi-guide">
                    <div><span className="vi-overline">FIRST, WHAT IS NDVI?</span><h3>A simple way to measure visible green cover from space.</h3><p>Leaves absorb much of the red light they use for photosynthesis and reflect a lot of near-infrared light. Sentinel-2 measures both. NDVI compares those signals to estimate how strongly green vegetation is present in the observed pixels.</p></div>
                    <div className="vi-ndvi-scale"><div className="vi-ndvi-scale-labels"><span>−1</span><span>0</span><span>+1</span></div><div className="vi-ndvi-scale-ramp"><i/><i/><i/><i/><i/></div><div className="vi-ndvi-scale-caption"><span>Water / very little green signal</span><span>More green vegetation signal</span></div><small>It is not a crop-health grade, soil-fertility test or yield prediction. Crop type and growth stage matter.</small></div>
                  </div>
                  <div className="vi-metrics-grid">
                    <article className="vi-metric-card"><span>FIELD&apos;S AVERAGE GREEN SIGNAL</span><strong>{formatNdvi(result.summary.meanNdvi)}</strong><small>Mean NDVI across valid pixels in the combined period image.</small></article>
                    <article className="vi-metric-card"><span>THE TYPICAL PIXEL</span><strong>{formatNdvi(result.summary.medianNdvi)}</strong><small>Median NDVI; less affected by unusually high or low pixels.</small></article>
                    <article className="vi-metric-card"><span>MONTHS WITH OBSERVATIONS</span><strong>{result.summary.validMonths} / {result.summary.totalMonths}</strong><small>Months with at least one usable Sentinel-2 scene.</small></article>
                    <article className="vi-metric-card"><span>VISIBLE FIELD COVERAGE</span><strong>{Number.isFinite(result.summary.validPixelFraction) ? `${(result.summary.validPixelFraction * 100).toFixed(1)}%` : "—"}</strong><small>Share of expected pixels usable on the latest processed scene.</small></article>
                  </div>
                  <div className="vi-analysis-grid">
                    <section className="vi-white-panel vi-trend-panel"><div className="vi-panel-title"><div><span className="vi-overline">04 / TIME SERIES</span><h2>How the green cover changed</h2><p>Each point shows the average NDVI from one usable observation in that month. Gaps mean no clear reading was available.</p></div><span className="vi-panel-stamp">{result.summary.validMonths}/{result.summary.totalMonths} months</span></div><NdviChart data={result.monthly} previous={previousResult?.monthly}/><div className="vi-trend-foot"><span>Latest clear month: <strong>{ndviLatestLabel}</strong></span><span>Change vs previous clear month: <strong className={monthDelta == null ? "" : monthDelta < 0 ? "negative" : "positive"}>{monthDelta == null ? "—" : `${monthDelta > 0 ? "+" : ""}${monthDelta.toFixed(3)}`}</strong></span></div></section>
                    <section className="vi-white-panel vi-interpret-panel"><span className="vi-overline">05 / READING THE RESULT</span><h2>{interpretation.label}</h2><p>{interpretation.detail}</p><p className="vi-plain-language">A higher number usually means more green leaf cover was visible to the satellite. It does not automatically mean a healthier crop.</p><div className="vi-interpret-divider"/><div className="vi-interpret-row"><span>Clear-observation months</span><strong>{result.summary.validMonths} / {result.summary.totalMonths}</strong></div><div className="vi-interpret-row"><span>Cloud threshold</span><strong>≤ {result.period.cloudLimit}%</strong></div><div className="vi-interpret-row"><span>Effective output scale</span><strong>{result.quality.scaleMetres} metres</strong></div><div className="vi-interpret-row"><span>Rendered valid grid cells</span><strong>{validPixelCount.toLocaleString()}</strong></div><div className="vi-interpret-row"><span>Skipped scene candidates</span><strong>{result.quality.skippedSceneCount}</strong></div></section>
                  </div>
                  <div className="vi-analysis-grid">
                    <section className="vi-white-panel vi-hotspot-panel">
                      <span className="vi-overline">06 / UNUSUALLY LOW AREAS</span>
                      <h2>{lowVegetation?.available ? (lowVegetation.pixelCount ? "Parts of the field are noticeably less green" : "No clearly weaker area found") : "Within-field comparison unavailable"}</h2>
                      {lowVegetation?.available ? (
                        <>
                          <p>{lowVegetation.description}</p>
                          {lowVegetation.pixelCount > 0 && <div className="vi-hotspot-stats"><div><span>Area flagged</span><strong>{lowVegetation.areaHectares.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha</strong></div><div><span>Share of clear pixels</span><strong>{(lowVegetation.fractionOfValidPixels * 100).toFixed(1)}%</strong></div><div><span>NDVI below</span><strong>{lowVegetation.thresholdNdvi.toFixed(2)}</strong></div></div>}
                          <p className="vi-plain-language">Red areas on the map are the places worth walking first. The satellite cannot say why they are lower: it may be a wet patch, headland, compaction, poor emergence, pests, or just a different crop stage.</p>
                          <small className="vi-method-note">{lowVegetation.method}</small>
                        </>
                      ) : <p>{lowVegetation?.reason || "Not enough information to compare areas within this field."}</p>}
                    </section>
                    <section className="vi-white-panel vi-season-panel">
                      <span className="vi-overline">07 / COMPARED WITH LAST YEAR</span>
                      <h2>{!compareSeasons ? "Comparison switched off" : previousLoading ? "Loading last year&apos;s observations…" : previousError ? "Comparison unavailable" : seasonComparison?.pairs?.length ? (seasonComparison.averageDelta >= 0.04 ? "Greener than the same months last year" : seasonComparison.averageDelta <= -0.04 ? "Less green than the same months last year" : "Similar to the same months last year") : "No months to compare"}</h2>
                      {!compareSeasons && <p>Tick “Compare with the same months last year” and run the analysis again to see this.</p>}
                      {compareSeasons && previousLoading && <p className="vi-season-loading"><span className="vi-spinner"/> Analysing the previous year&apos;s Sentinel-2 scenes. The current report above is already complete.</p>}
                      {compareSeasons && previousError && <p>{previousError}</p>}
                      {compareSeasons && seasonComparison && !previousLoading && (seasonComparison.pairs.length ? (
                        <>
                          <p>Across {seasonComparison.pairs.length} month{seasonComparison.pairs.length === 1 ? "" : "s"} with clear readings in both years, the average NDVI differed by <strong className={seasonComparison.averageDelta < 0 ? "negative" : "positive"}>{seasonComparison.averageDelta > 0 ? "+" : ""}{seasonComparison.averageDelta.toFixed(3)}</strong>. It was higher in {seasonComparison.higher} and lower in {seasonComparison.lower} of those months (differences under 0.04 count as similar).</p>
                          <div className="vi-table-scroll"><table><thead><tr><th>Month</th><th>This period</th><th>Last year</th><th>Difference</th></tr></thead><tbody>{seasonComparison.pairs.map((pair) => <tr key={pair.month}><td>{formatMonth(pair.month)}</td><td>{formatNdvi(pair.current)}</td><td>{formatNdvi(pair.previous)}</td><td className={pair.delta < 0 ? "negative" : "positive"}>{pair.delta > 0 ? "+" : ""}{pair.delta.toFixed(3)}</td></tr>)}</tbody></table></div>
                          <small className="vi-method-note">Differences can come from a different crop, sowing date or weather, not only crop condition. Months are matched by calendar position; each uses one clear scene.</small>
                        </>
                      ) : <p>No month had a clear reading in both years, so a fair comparison is not possible. Try a higher cloud threshold or a different window.</p>)}
                    </section>
                  </div>
                  <section className="vi-white-panel vi-hls-history-panel">
                    <div className="vi-panel-title">
                      <div><span className="vi-overline">07B / LONG-TERM FIELD MEMORY</span><h2>How has this location changed since 2013?</h2><p>NASA HLS harmonizes Landsat 8/9 and Sentinel-2 observations on a common 30 m grid, extending the vegetation record beyond the selected Sentinel-2 window.</p></div>
                      <span className="vi-panel-stamp">NASA HLS · 30 m</span>
                    </div>
                    {result.hlsHistory?.status === "available" && result.hlsHistory.monthly?.length ? (
                      <>
                        <div className="vi-hls-summary">
                          <div><span>First record</span><strong>{result.hlsHistory.earliestDate || "—"}</strong></div>
                          <div><span>Latest record</span><strong>{result.hlsHistory.latestDate || "—"}</strong></div>
                          <div><span>Samples returned</span><strong>{result.hlsHistory.observationCount}</strong></div>
                          <div><span>Months represented</span><strong>{result.hlsHistory.monthly.length}</strong></div>
                        </div>
                        <div className="vi-hls-chart-wrap">
                          <div className="vi-chart-legend"><span><i/> Monthly HLS NDVI mean</span><span><i className="previous"/> NDVI scale −1 to 1</span></div>
                          <div className="vi-table-scroll">
                            <table><thead><tr><th>Month</th><th>HLS monthly NDVI</th><th>Observations</th><th>Landsat</th><th>Sentinel-2</th></tr></thead><tbody>{result.hlsHistory.monthly.slice(-36).map((item) => <tr key={item.month}><td>{formatMonth(item.month)}</td><td><div className="vi-hls-meter"><i style={{ width: `${Math.max(0, Math.min(100, ((item.meanNdvi + 1) / 2) * 100))}%` }}/></div><strong>{formatNdvi(item.meanNdvi)}</strong></td><td>{item.observationCount}</td><td>{item.landsatCount}</td><td>{item.sentinelCount}</td></tr>)}</tbody></table>
                          </div>
                        </div>
                        <small className="vi-method-note">{result.hlsHistory.note}</small>
                      </>
                    ) : (
                      <div className="vi-hls-unavailable"><p>{result.hlsHistory?.reason || "NASA HLS history has not been returned for this field yet."}</p>{result.hlsHistory?.status === "needs_token" && <a href="https://urs.earthdata.nasa.gov/" target="_blank" rel="noreferrer">Set up NASA Earthdata Login <Icon name="external" size={12}/></a>}</div>
                    )}
                  </section>
                  <div className="vi-analysis-grid">
                    <section className="vi-white-panel vi-zones-panel">
                      <span className="vi-overline">08 / MANAGEMENT ZONES</span>
                      <h2>{fieldVariability?.available ? `The field is ${fieldVariability.uniformity}` : "Within-field zones unavailable"}</h2>
                      {fieldVariability?.available ? (
                        <>
                          <p>{fieldVariability.guidance}</p>
                          <div className="vi-zone-bar" role="img" aria-label="Share of the field in each relative zone">{fieldVariability.relative.zones.map((zone) => <i key={zone.index} style={{ width: `${zone.share * 100}%`, background: zone.color }} title={`${zone.label}: ${zone.areaHectares.toFixed(2)} ha`}/>)}</div>
                          <ul className="vi-zone-list">{fieldVariability.relative.zones.map((zone) => <li key={zone.index}><b className="ws-dot" style={{ background: zone.color }}/> <strong>{zone.label}</strong><span>{zone.areaHectares.toFixed(2)} ha ({(zone.share * 100).toFixed(0)}%) · average NDVI {zone.meanNdvi.toFixed(2)}</span></li>)}</ul>
                          <div className="vi-hotspot-stats"><div><span>Typical NDVI</span><strong>{fieldVariability.meanNdvi.toFixed(2)}</strong></div><div><span>Spread (P10–P90)</span><strong>{fieldVariability.p10.toFixed(2)}–{fieldVariability.p90.toFixed(2)}</strong></div><div><span>Clear area measured</span><strong>{fieldVariability.areaHectares.toFixed(1)} ha</strong></div></div>
                          <div className="vi-class-grid">{fieldVariability.absolute.filter((c) => c.pixelCount > 0).map((cls) => <span key={cls.key}><b className="ws-dot" style={{ background: cls.color }}/> {cls.label}: {cls.areaHectares.toFixed(2)} ha ({(cls.share * 100).toFixed(0)}%)</span>)}</div>
                          <small className="vi-method-note">{fieldVariability.method} Turn on the <strong>Zones</strong> layer on the map to see where they fall.</small>
                        </>
                      ) : <p>{fieldVariability?.reason || "Not enough clear pixels."}</p>}
                    </section>
                    <section className="vi-white-panel vi-phenology-panel">
                      <span className="vi-overline">09 / SEASONAL PATTERN</span>
                      <h2>{phenology?.available ? phenology.pattern.charAt(0).toUpperCase() + phenology.pattern.slice(1) : "Seasonal pattern unavailable"}</h2>
                      {phenology?.available ? (
                        <>
                          <div className="vi-hotspot-stats"><div><span>Greenest month</span><strong>{phenology.peak.label}</strong><small>NDVI {phenology.peak.ndvi.toFixed(2)}</small></div><div><span>Least green</span><strong>{phenology.trough.label}</strong><small>NDVI {phenology.trough.ndvi.toFixed(2)}</small></div><div><span>Seasonal swing</span><strong>{phenology.amplitude.toFixed(2)}</strong><small>{phenology.greenMonths} green month{phenology.greenMonths === 1 ? "" : "s"}</small></div></div>
                          <p>The field was most active from {formatMonth(phenology.activeFrom)} to {formatMonth(phenology.activeTo)} (months above the halfway point between its lowest and highest greenness).{phenology.fastestRise ? ` Greenness rose fastest between ${formatMonth(phenology.fastestRise.from)} and ${formatMonth(phenology.fastestRise.to)} (+${phenology.fastestRise.change.toFixed(2)}).` : ""}{phenology.fastestFall ? ` It dropped fastest between ${formatMonth(phenology.fastestFall.from)} and ${formatMonth(phenology.fastestFall.to)} (${phenology.fastestFall.change.toFixed(2)}), which can be harvest, senescence or clearing.` : ""}</p>
                          <small className="vi-method-note">{phenology.note}</small>
                        </>
                      ) : <p>{phenology?.reason || "Not enough observations."}</p>}
                    </section>
                  </div>
                  <section className="vi-white-panel vi-observation-table"><div className="vi-panel-title"><div><span className="vi-overline">10 / MONTHLY OBSERVATIONS</span><h2>Observation record</h2></div><span className="vi-panel-stamp">Sentinel-2 L2A · Earth Search</span></div><div className="vi-table-scroll"><table><thead><tr><th>Month</th><th>Observation</th><th>Average green signal</th><th>Typical pixel</th><th>Scene cloud</th><th>Clear pixels</th></tr></thead><tbody>{result.monthly.map((item) => <tr key={item.month}><td>{formatMonth(item.month)}</td><td>{item.observedAt ? new Date(item.observedAt).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "No clear scene"}</td><td>{formatNdvi(item.meanNdvi)}</td><td>{formatNdvi(item.medianNdvi)}</td><td>{Number.isFinite(item.cloudCover) ? `${item.cloudCover.toFixed(1)}%` : "—"}</td><td>{item.validPixelCount.toLocaleString()}</td></tr>)}</tbody></table></div></section>
                  <section className="vi-caveats"><div><span className="vi-overline">READ THE DATA RESPONSIBLY</span><h3>What NDVI can—and cannot—tell you.</h3></div><ul>{result.caveats.map((item) => <li key={item}>{item}</li>)}</ul></section>
                  <div className="vi-source-footer"><span>DATA: COPERNICUS SENTINEL-2 MSI L2A · NASA HLS LANDSAT/SENTINEL-2 · {result.source.collection}</span><span>{result.source.attribution}</span><a href="https://earth-search.aws.element84.com/v1/collections/sentinel-2-c1-l2a" target="_blank" rel="noreferrer">Earth Search collection <Icon name="external" size={12}/></a></div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
