"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { area as calculateArea } from "@turf/area";

const FIELDS_KEY = "agrimetry:global-farm-map:v1";
const SELECTED_FIELD_KEY = "agrimetry:vegetation:selected-field:v1";
const LEVEL_COLORS = ["#6e925f", "#d6b04a", "#e08a3c", "#c2412f"];
const LEVEL_NAMES = ["Normal", "Watch", "Moderate", "Severe"];
const GIBS_LAYERS = {
  SMAP_L4_Analyzed_Root_Zone_Soil_Moisture: {
    label: "SMAP root-zone soil moisture",
    detail: "SMAP Level 4 analysed root-zone soil moisture (about 0–100 cm), a model product that assimilates SMAP observations. Coarse (about 9 km) and not a field measurement.",
  },
  SMAP_L4_Analyzed_Surface_Soil_Moisture: {
    label: "SMAP surface soil moisture",
    detail: "SMAP Level 4 analysed surface soil moisture (top ~5 cm), a model product that assimilates SMAP observations. Changes quickly after rain.",
  },
  IMERG_Precipitation_Rate: {
    label: "GPM IMERG precipitation rate",
    detail: "GPM IMERG satellite precipitation rate for the chosen day. Shows where rain was falling, at about 10 km resolution.",
  },
};

function Icon({ name, size = 18 }) {
  const paths = {
    drop: <path d="M12 3c3.5 4.4 6 7.3 6 10.4a6 6 0 0 1-12 0C6 10.3 8.5 7.4 12 3Z"/>,
    back: <path d="m15 18-6-6 6-6"/>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-3"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></>,
    external: <><path d="M14 3h7v7m0-7-9 9"/><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15m6-12v15"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.info}</svg>;
}

function fieldName(feature, index = 0) {
  return feature?.properties?.fieldName || feature?.properties?.name || `Field ${index + 1}`;
}
function fieldKey(feature, index = 0) {
  return String(feature?.id || feature?.properties?.fieldName || `field-${index}`);
}
function outerCoordinates(feature) {
  const geometry = feature?.geometry;
  if (geometry?.type === "Polygon") return geometry.coordinates?.[0] || [];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates?.flatMap((polygon) => polygon?.[0] || []) || [];
  return [];
}
function fieldCentre(feature) {
  const points = outerCoordinates(feature);
  if (!points.length) return null;
  const lons = points.map((p) => Number(p[0]));
  const lats = points.map((p) => Number(p[1]));
  return { longitude: (Math.min(...lons) + Math.max(...lons)) / 2, latitude: (Math.min(...lats) + Math.max(...lats)) / 2 };
}
function areaLabel(feature) {
  try {
    const m2 = calculateArea(feature);
    return `${(m2 / 10000).toLocaleString(undefined, { maximumFractionDigits: 2 })} ha · ${(m2 / 4046.8564224).toLocaleString(undefined, { maximumFractionDigits: 2 })} acres`;
  } catch { return "Area unavailable"; }
}
function formatMonth(value) {
  if (!value) return "—";
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en", { month: "short", year: "2-digit", timeZone: "UTC" });
}
function formatPowerDate(value) {
  if (!value) return "—";
  return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
const pct = (value) => (Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—");
const mm = (value) => (Number.isFinite(value) ? `${value.toFixed(value < 10 ? 1 : 0)} mm` : "—");
const wet = (value) => (Number.isFinite(value) ? value.toFixed(2) : "—");

function defaultGibsDate() {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function describeStatus(summary) {
  const level = summary.latestLevel ?? 0;
  const month = formatMonth(summary.latestMonth);
  const reasons = summary.latestReasons?.length ? ` Main signals: ${summary.latestReasons.join("; ")}.` : "";
  if (level === 0) return { title: "No water-stress signal this month", text: `For ${month}, rainfall and root-zone wetness are within this location's usual range.${reasons}` };
  if (level === 1) return { title: "Early signs of dryness — keep watching", text: `For ${month}, conditions are drier than usual in at least one measure.${reasons}` };
  if (level === 2) return { title: "Moderate water-stress signal", text: `For ${month}, several indicators point to drier-than-normal conditions.${reasons} Check soil moisture in the field.` };
  return { title: "Severe water-stress signal", text: `For ${month}, rainfall and soil wetness are well below this location's normal.${reasons} Verify with a field check and local advice.` };
}

function StressTimeline({ months }) {
  const width = 720, height = 230, left = 40, right = 14, top = 14, bottom = 58;
  const plotW = width - left - right;
  const step = plotW / months.length;
  const y = (v) => top + (1 - Math.max(0, Math.min(1, v))) * (height - top - bottom - 24);
  const x = (i) => left + step * i + step / 2;
  const line = (key) => months.map((m, i) => (Number.isFinite(m[key]) ? [x(i), y(m[key])] : null));
  // A missing month breaks the line instead of being drawn as zero.
  const path = (points) => {
    let d = "";
    let pen = false;
    for (const p of points) {
      if (!p) { pen = false; continue; }
      d += `${pen ? "L" : "M"} ${p[0]} ${p[1]} `;
      pen = true;
    }
    return d.trim();
  };
  return (
    <div className="vi-chart-wrap">
      <div className="vi-chart-legend"><span><i/> Root-zone wetness</span><span><i className="previous"/> Normal for the month</span>{LEVEL_NAMES.map((n, i) => <span key={n}><b className="ws-dot" style={{ background: LEVEL_COLORS[i] }}/> {n}</span>)}</div>
      <svg className="vi-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Monthly water stress timeline with root-zone soil wetness">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => <g key={t}><line x1={left} x2={width - right} y1={y(t)} y2={y(t)} stroke="#e6dece" strokeDasharray="4 6"/><text x={left - 8} y={y(t) + 4} textAnchor="end" fill="#8a927f" fontSize="11">{t.toFixed(2)}</text></g>)}
        <path d={path(line("rootWetnessNormal"))} fill="none" stroke="#b8893a" strokeWidth="2.2" strokeDasharray="6 5"/>
        <path d={path(line("rootWetness"))} fill="none" stroke="#315f3d" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
        {months.map((m, i) => Number.isFinite(m.rootWetness) && <circle key={m.month} cx={x(i)} cy={y(m.rootWetness)} r="4" fill="#315f3d" stroke="#fbf9f3" strokeWidth="2"><title>{formatMonth(m.month)}: wetness {wet(m.rootWetness)} (normal {wet(m.rootWetnessNormal)})</title></circle>)}
        {months.map((m, i) => (
          <g key={`band-${m.month}`}>
            <rect x={left + step * i + 2} y={height - bottom + 8} width={step - 4} height="20" rx="4" fill={LEVEL_COLORS[m.stressLevel]} opacity={m.partial ? 0.7 : 1}><title>{formatMonth(m.month)}: {m.stressLabel}{m.reasons.length ? ` — ${m.reasons.join("; ")}` : ""}</title></rect>
            <text x={x(i)} y={height - 14} textAnchor="middle" fill="#858c7c" fontSize="10">{formatMonth(m.month)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function WaterBalanceChart({ months }) {
  const rows = months.filter((m) => m.et0Mm !== null && m.rainMm !== null);
  if (rows.length < 2) return <div className="vi-chart-empty">Not enough temperature data to estimate evaporative demand.</div>;
  const width = 720, height = 210, left = 42, right = 14, top = 14, bottom = 34;
  const max = Math.max(10, ...rows.flatMap((m) => [m.rainMm, m.et0Mm, m.normalEt0Mm ?? 0])) * 1.1;
  const step = (width - left - right) / rows.length;
  const y = (v) => top + (1 - v / max) * (height - top - bottom);
  const cx = (i) => left + step * i + step / 2;
  const path = (key) => rows.map((m, i) => (Number.isFinite(m[key]) ? `${i ? "L" : "M"} ${cx(i)} ${y(m[key])}` : "")).join(" ");
  return (
    <div className="vi-chart-wrap">
      <div className="vi-chart-legend"><span><b className="ws-dot" style={{ background: "#4f86a8" }}/> Rainfall</span><span><i/> Evaporative demand (ET0)</span><span><i className="previous"/> Normal ET0</span></div>
      <svg className="vi-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Monthly rainfall compared with evaporative demand">
        {[0, 0.5, 1].map((t) => <g key={t}><line x1={left} x2={width - right} y1={y(max * t)} y2={y(max * t)} stroke="#e6dece" strokeDasharray="4 6"/><text x={left - 8} y={y(max * t) + 4} textAnchor="end" fill="#8a927f" fontSize="11">{Math.round(max * t)}</text></g>)}
        {rows.map((m, i) => <g key={m.month}><rect x={cx(i) - Math.min(14, step / 3)} y={y(m.rainMm)} width={Math.min(28, step * 0.66)} height={Math.max(0, height - bottom - y(m.rainMm))} fill="#4f86a8" rx="2" opacity=".85"><title>{formatMonth(m.month)}: rain {mm(m.rainMm)}, ET0 {mm(m.et0Mm)}, balance {Math.round(m.waterBalanceMm)} mm</title></rect><text x={cx(i)} y={height - 12} textAnchor="middle" fill="#858c7c" fontSize="10">{formatMonth(m.month)}</text></g>)}
        <path d={path("normalEt0Mm")} fill="none" stroke="#b8893a" strokeWidth="2" strokeDasharray="6 5"/>
        <path d={path("et0Mm")} fill="none" stroke="#c2412f" strokeWidth="2.6" strokeLinejoin="round"/>
        <text x={left - 8} y={top - 2} textAnchor="end" fill="#8a927f" fontSize="10">mm</text>
      </svg>
    </div>
  );
}

function RainChart({ months }) {
  const width = 720, height = 210, left = 42, right = 14, top = 14, bottom = 34;
  const max = Math.max(10, ...months.flatMap((m) => [m.rainMm ?? 0, m.normalRainMm ?? 0])) * 1.1;
  const step = (width - left - right) / months.length;
  const y = (v) => top + (1 - v / max) * (height - top - bottom);
  const barW = Math.min(18, step / 2.6);
  return (
    <div className="vi-chart-wrap">
      <div className="vi-chart-legend"><span><b className="ws-dot" style={{ background: "#4f86a8" }}/> Rainfall</span><span><b className="ws-dot" style={{ background: "#d9cdb0" }}/> Normal for the same days</span></div>
      <svg className="vi-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Monthly rainfall compared with seasonal normal">
        {[0, 0.5, 1].map((t) => <g key={t}><line x1={left} x2={width - right} y1={y(max * t)} y2={y(max * t)} stroke="#e6dece" strokeDasharray="4 6"/><text x={left - 8} y={y(max * t) + 4} textAnchor="end" fill="#8a927f" fontSize="11">{Math.round(max * t)}</text></g>)}
        {months.map((m, i) => {
          const cx = left + step * i + step / 2;
          return (
            <g key={m.month}>
              {m.normalRainMm !== null && <rect x={cx - barW - 1} y={y(m.normalRainMm)} width={barW} height={Math.max(0, height - bottom - y(m.normalRainMm))} fill="#d9cdb0" rx="2"/>}
              {m.rainMm !== null && <rect x={cx + 1} y={y(m.rainMm)} width={barW} height={Math.max(0, height - bottom - y(m.rainMm))} fill="#4f86a8" rx="2"><title>{formatMonth(m.month)}: {mm(m.rainMm)} (normal {mm(m.normalRainMm)}{m.rainRatio !== null ? `, ${pct(m.rainRatio)} of normal` : ""})</title></rect>}
              <text x={cx} y={height - 12} textAnchor="middle" fill="#858c7c" fontSize="10">{formatMonth(m.month)}</text>
            </g>
          );
        })}
        <text x={left - 8} y={top - 2} textAnchor="end" fill="#8a927f" fontSize="10">mm</text>
      </svg>
    </div>
  );
}

export default function WaterStressIntelligence() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const maplibreRef = useRef(null);
  const [fields, setFields] = useState([]);
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [months, setMonths] = useState(12);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [gibsLayer, setGibsLayer] = useState("SMAP_L4_Analyzed_Root_Zone_Soil_Moisture");
  const [gibsDate, setGibsDate] = useState("");
  const [gibsOn, setGibsOn] = useState(true);
  const [maxGibsDate, setMaxGibsDate] = useState("");

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(FIELDS_KEY) || "[]");
      const selected = JSON.parse(localStorage.getItem(SELECTED_FIELD_KEY) || "null");
      const safe = Array.isArray(stored) ? stored.filter((f) => ["Polygon", "MultiPolygon"].includes(f?.geometry?.type)) : [];
      if (selected?.geometry && !safe.some((f) => String(f.id) === String(selected.id))) safe.unshift(selected);
      setFields(safe);
      if (selected?.geometry) setSelectedFieldId(fieldKey(selected));
      else if (safe.length) setSelectedFieldId(fieldKey(safe[0], 0));
    } catch {
      setError("Saved field boundaries could not be read. Return to the Global Farm Map and save the field again.");
    }
    setGibsDate(defaultGibsDate());
    const today = new Date();
    setMaxGibsDate(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`);
  }, []);

  const selectedIndex = fields.findIndex((f, i) => fieldKey(f, i) === selectedFieldId);
  const selectedField = selectedIndex >= 0 ? fields[selectedIndex] : null;
  const selectedName = selectedField ? fieldName(selectedField, selectedIndex) : "Selected field";
  const selectedArea = useMemo(() => (selectedField ? areaLabel(selectedField) : "—"), [selectedField]);
  const selectedCentre = useMemo(() => (selectedField ? fieldCentre(selectedField) : null), [selectedField]);
  const status = result ? describeStatus(result.summary) : null;

  const focusMap = useCallback((map, feature) => {
    const coords = outerCoordinates(feature);
    const maplibre = maplibreRef.current;
    if (!map || !coords.length || !maplibre?.LngLatBounds) return;
    const bounds = new maplibre.LngLatBounds(coords[0], coords[0]);
    coords.forEach((c) => bounds.extend(c));
    // Zoom close enough to make small farm boundaries legible. The NASA GIBS
    // raster itself remains coarse; the selected polygon is the focus here.
    map.fitBounds(bounds, { padding: 72, maxZoom: 17, duration: 650 });
  }, []);

  useEffect(() => {
    let alive = true;
    let mapInstance;
    async function createMap() {
      if (!selectedField || !mapContainerRef.current) return;
      try {
        const maplibregl = await import("maplibre-gl");
        if (typeof maplibregl.setWorkerUrl !== "function") throw new Error("MapLibre worker setup is unavailable.");
        maplibregl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
        if (!alive || !mapContainerRef.current) return;
        maplibreRef.current = maplibregl;
        const centre = fieldCentre(selectedField);
        mapInstance = new maplibregl.Map({
          container: mapContainerRef.current,
          style: {
            version: 8,
            sources: { base: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "© OpenStreetMap contributors" } },
            layers: [{ id: "ws-base", type: "raster", source: "base" }],
          },
          center: centre ? [centre.longitude, centre.latitude] : [0, 20],
          zoom: 4,
          minZoom: 1,
          maxZoom: 18,
          attributionControl: { compact: true },
        });
        mapRef.current = mapInstance;
        mapInstance.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
        mapInstance.on("load", () => {
          if (!alive) return;
          mapInstance.addSource("ws-field", { type: "geojson", data: selectedField });
          mapInstance.addLayer({ id: "ws-field-fill", type: "fill", source: "ws-field", paint: { "fill-color": "#1f3d2b", "fill-opacity": 0.25 } });
          mapInstance.addLayer({ id: "ws-field-line", type: "line", source: "ws-field", paint: { "line-color": "#102a1b", "line-width": 2.5 } });
          setMapReady(true);
          focusMap(mapInstance, selectedField);
        });
        mapInstance.on("error", (event) => {
          const status = event?.error?.status;
          if (status === 404) setMapError("NASA GIBS has no imagery for this layer and date (SMAP data has gaps and a few days of delay). Try another date.");
          else if (event?.error) setMapError("Some map tiles could not be loaded. Check your connection.");
        });
      } catch (initError) {
        console.error("Water-stress map initialization failed:", initError);
        setMapError("The map could not be initialized. Check the browser console for details.");
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

  // NASA GIBS layer (SMAP / IMERG) drawn under the field outline.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !gibsDate) return;
    if (map.getLayer("ws-gibs")) map.removeLayer("ws-gibs");
    if (map.getSource("ws-gibs")) map.removeSource("ws-gibs");
    setMapError("");
    if (!gibsOn) return;
    map.addSource("ws-gibs", {
      type: "raster",
      tiles: [`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${gibsLayer}/default/${gibsDate}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 6,
      attribution: "Imagery: NASA GIBS (SMAP, GPM IMERG)",
    });
    map.addLayer({ id: "ws-gibs", type: "raster", source: "ws-gibs", paint: { "raster-opacity": 0.78 } }, map.getLayer("ws-field-fill") ? "ws-field-fill" : undefined);
  }, [gibsLayer, gibsDate, gibsOn, mapReady]);

  async function runAnalysis(event) {
    event?.preventDefault();
    const centre = selectedField ? fieldCentre(selectedField) : null;
    if (!centre) {
      setError("Choose or save a farm boundary on the Global Farm Map first.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const query = new URLSearchParams({ lat: centre.latitude.toFixed(4), lon: centre.longitude.toFixed(4), months: String(months) });
      const response = await fetch(`/api/water-stress?${query}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Water-stress analysis failed (HTTP ${response.status}).`);
      if (!payload?.summary || !Array.isArray(payload?.monthly)) throw new Error("NASA POWER returned an incomplete report. Please try again.");
      setResult(payload);
    } catch (requestError) {
      setError(requestError.message || "Unable to run the water-stress analysis.");
    } finally {
      setLoading(false);
    }
  }

  function selectField(id) {
    const feature = fields.find((item, index) => fieldKey(item, index) === id);
    setSelectedFieldId(id);
    setResult(null);
    setError("");
    if (feature) {
      try { localStorage.setItem(SELECTED_FIELD_KEY, JSON.stringify(feature)); } catch {}
    }
  }

  const s = result?.summary;
  const satelliteContext = result?.satelliteContext || null;
  return (
    <main className="vi-page">
      <header className="vi-header">
        <div className="vi-brand-wrap">
          <Link href="/explore/map" className="vi-back" aria-label="Back to global farm map"><Icon name="back" size={18}/></Link>
          <Link href="/" className="vi-brand"><span className="vi-brand-mark"><Icon name="drop" size={19}/></span><span>agrimetry<span>.</span></span></Link>
          <span className="vi-divider"/>
          <div className="vi-header-title"><small>FIELD INTELLIGENCE</small><strong>Soil moisture &amp; water stress</strong></div>
        </div>
        <div className="vi-header-actions"><span className="vi-source-pill"><i/> NASA POWER · GPM · ECOSTRESS</span><Link href="/explore/vegetation" className="vi-explore-link">Vegetation</Link><Link href="/explore/bare-field" className="vi-explore-link">Bare fields</Link><Link href="/explore/map" className="vi-explore-link">Global farm map</Link></div>
      </header>

      <div className="vi-content">
        <section className="vi-intro">
          <div>
            <span className="vi-kicker"><span/> SOIL MOISTURE AND WATER STRESS INTELLIGENCE</span>
            <h1>See when your field was <em>thirsty</em>.</h1>
            <p>Agrimetry compares your field&apos;s recent rainfall, soil wetness and temperature with the same months over the past two decades, flags periods of declining soil moisture and builds a month-by-month water-stress timeline. GPM IMERG rainfall totals and ECOSTRESS daytime evapotranspiration add independent satellite context alongside the established climate analysis.</p>
          </div>
          <div className="vi-intro-note"><Icon name="drop" size={20}/><span>NASA POWER baseline · GPM IMERG · ECOSTRESS<br/><strong>NASA Earthdata token enables extra satellite series</strong></span></div>
        </section>

        {fields.length === 0 ? (
          <section className="vi-empty-state">
            <div className="vi-empty-icon"><Icon name="map" size={28}/></div>
            <div><span className="vi-kicker">NO SAVED FIELD FOUND</span><h2>Choose a field before analysing water stress.</h2><p>Go to the Global Farm Map, draw a boundary and save it, then come back here.</p><Link href="/explore/map" className="vi-primary-button">Open Global Farm Map <Icon name="external" size={15}/></Link></div>
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
              <div className="vi-panel-heading"><span className="vi-section-number">02</span><div><small>PERIOD</small><h2>How far back?</h2></div></div>
              <label className="vi-field-label">Months to analyse
                <select value={months} onChange={(event) => setMonths(Number(event.target.value))}>
                  {[6, 9, 12].map((n) => <option key={n} value={n}>Last {n} months</option>)}
                </select>
              </label>
              <button type="button" className="vi-run-button" onClick={runAnalysis} disabled={loading || !selectedField}><Icon name={loading ? "refresh" : "drop"} size={17}/>{loading ? "Reading NASA data…" : "Run water-stress analysis"}</button>
              {error && <div className="vi-error" role="alert"><Icon name="info" size={17}/><span>{error}</span></div>}
              <div className="vi-source-note"><Icon name="info" size={15}/><p>The established water-stress score uses NASA POWER (MERRA-2) estimates for the grid cell containing your field centre; they are not field measurements. GPM IMERG adds roughly 10 km precipitation estimates, while ECOSTRESS adds intermittent 70 m daytime ET observations when NASA Earthdata access is configured. These extra sources provide context and do not alter the POWER-derived score.</p></div>
            </aside>

            <section className="vi-results-area">
              {loading && <section className="vi-analysis-progress" role="status" aria-live="polite"><div className="vi-progress-head"><span className="vi-progress-orbit"><span/><i/></span><div><span className="vi-overline">AGRIMETRY IS READING NASA DATA</span><h2>Comparing this period with 25 years of history</h2></div></div><p className="vi-progress-detail">Fetching daily soil wetness, rainfall and temperature, and the long-term monthly record for your field&apos;s grid cell. This usually takes a few seconds.</p><div className="vi-progress-track" aria-hidden="true"><span/></div></section>}

              <div className="vi-map-card">
                <div className="vi-map-card-head">
                  <div className="ws-map-heading"><span className="vi-overline">NASA SATELLITE CONTEXT · ACTIVE FIELD</span><h2>{selectedName}</h2><div className="ws-map-field-meta"><strong>{selectedArea}</strong>{selectedCentre && <span>{selectedCentre.latitude.toFixed(4)}°, {selectedCentre.longitude.toFixed(4)}°</span>}</div><small>{GIBS_LAYERS[gibsLayer].label} · {gibsDate || "—"}</small></div>
                  <div className="vi-map-controls ws-map-controls">
                    <select aria-label="NASA GIBS layer" value={gibsLayer} onChange={(event) => setGibsLayer(event.target.value)}>
                      {Object.entries(GIBS_LAYERS).map(([id, layer]) => <option key={id} value={id}>{layer.label}</option>)}
                    </select>
                    <input aria-label="Imagery date" type="date" min="2015-03-31" max={maxGibsDate || undefined} value={gibsDate} onChange={(event) => setGibsDate(event.target.value)}/>
                    <button type="button" className={`vi-layer-toggle ${gibsOn ? "active" : ""}`} onClick={() => setGibsOn((v) => !v)}>Layer {gibsOn ? "On" : "Off"}</button>
                  </div>
                </div>
                <div className="vi-map-wrap"><div ref={mapContainerRef} className="vi-map-canvas"/>{!mapReady && <div className="vi-map-loading"><span className="vi-spinner"/><strong>Preparing selected field</strong></div>}{mapError && <div className="vi-map-error">{mapError}</div>}</div>
                <div className="ws-layer-note"><Icon name="info" size={14}/><span>{GIBS_LAYERS[gibsLayer].detail} Imagery is delayed by several days and has occasional gaps. The outlined field is highlighted at field zoom; the satellite raster remains much coarser than a small farm.</span></div>
              </div>

              {!result ? (
                <div className="vi-wait-panel"><span className="vi-wait-mark"><Icon name="drop" size={22}/></span><div><strong>Your water-stress timeline will appear here.</strong><p>Choose a period and run the analysis. It uses the centre of your saved field boundary.</p></div></div>
              ) : (
                <>
                  <div className="vi-result-heading"><div><span className="vi-overline">03 / YOUR WATER REPORT</span><h2>How thirsty has your field been?</h2><p>{formatPowerDate(result.period.start)} to {formatPowerDate(result.period.end)} · compared with {result.baseline.startYear}–{result.baseline.endYear}</p></div><span className="vi-live-badge"><i/> ANALYSIS COMPLETE</span></div>

                  <section className={`vi-story-panel ws-status ws-level-${s.latestLevel ?? 0}`}>
                    <div className="vi-story-intro"><span className="vi-story-leaf" style={{ background: LEVEL_COLORS[s.latestLevel ?? 0] }}><Icon name="drop" size={21}/></span><div><span className="vi-overline">CURRENT SIGNAL · {(s.latestLabel || "").toUpperCase()}</span><h2>{status.title}</h2><p>{status.text}</p></div></div>
                  </section>

                  <div className="vi-metrics-grid">
                    <article className="vi-metric-card"><span>ROOT-ZONE WETNESS</span><strong>{wet(s.latestRootWetness)}</strong><small>Fraction 0 (dry) to 1 (saturated), latest value on {formatPowerDate(s.latestRootWetnessDate)}.</small></article>
                    <article className="vi-metric-card"><span>RAIN, LAST 30 DAYS</span><strong>{mm(s.last30?.rainMm)}</strong><small>{s.last30?.rainRatio != null ? `${pct(s.last30.rainRatio)} of the ${mm(s.last30.normalRainMm)} normal for these days.` : "Normal rainfall is too low in this season for a reliable percentage."}</small></article>
                    <article className="vi-metric-card"><span>DAYS SINCE MEANINGFUL RAIN</span><strong>{s.currentDrySpellDays}</strong><small>Days in a row below 1 mm. Longest dry spell this period: {s.longestDrySpell.days} days.</small></article>
                    <article className="vi-metric-card"><span>MONTHS WITH STRESS</span><strong>{s.stressMonthCount} / {s.totalMonths}</strong><small>Months rated Moderate or Severe.</small></article>
                  </div>
                  <div className="vi-metrics-grid">
                    <article className="vi-metric-card"><span>CLIMATE TYPE (ARIDITY)</span><strong className="sh-metric-text">{result.baseline.aridityClass?.label || "—"}</strong><small>{Number.isFinite(result.baseline.aridityIndex) ? `Rain is ${(result.baseline.aridityIndex * 100).toFixed(0)}% of potential evaporation (${Math.round(result.baseline.annualRainMm)} mm rain vs ${Math.round(result.baseline.annualEt0Mm)} mm ET0 a year).` : "Needs temperature data."}</small></article>
                    <article className="vi-metric-card"><span>3-MONTH RAINFALL INDEX</span><strong>{Number.isFinite(s.latestSpi3) ? s.latestSpi3.toFixed(1) : "—"}</strong><small>{s.latestSpiLabel ? `${s.latestSpiLabel} compared with the same three months since 2001 (0 = typical, below −1 = dry).` : "Needs three months of data."}</small></article>
                    <article className="vi-metric-card"><span>WATER BALANCE, LATEST MONTH</span><strong>{Number.isFinite(s.latestWaterBalanceMm) ? `${Math.round(s.latestWaterBalanceMm)} mm` : "—"}</strong><small>Rain minus evaporative demand. Negative values are normal in dry seasons; {s.deficitMonths} month{s.deficitMonths === 1 ? "" : "s"} ran at least 20 mm drier than usual.</small></article>
                  </div>

                  <section className="vi-white-panel ws-earth-observations">
                    <div className="vi-panel-title"><div><span className="vi-overline">03B / ADDITIONAL NASA SATELLITE EVIDENCE</span><h2>Rain from space, water leaving the land.</h2><p>Independent satellite context alongside the existing NASA POWER analysis. These observations do not change the POWER-based stress rating.</p></div></div>
                    <div className="ws-earth-grid">
                      <article className="ws-earth-card">
                        <div className="ws-earth-card-head"><div><span className="vi-overline">GPM IMERG · DAILY PRECIPITATION</span><h3>How much rain reached this region?</h3></div><span className={`ws-data-state ${satelliteContext?.gpm?.status === "available" ? "is-ready" : ""}`}>{satelliteContext?.gpm?.status === "available" ? "DATA FOUND" : satelliteContext?.gpm?.status === "needs_token" ? "TOKEN REQUIRED" : "UNAVAILABLE"}</span></div>
                        {satelliteContext?.gpm?.status === "available" ? <>
                          <div className="ws-earth-highlight"><strong>{satelliteContext.gpm.monthly.at(-1)?.totalMm ?? "—"} <small>mm</small></strong><span>latest month total · {satelliteContext.gpm.monthly.at(-1)?.month || "—"}</span></div>
                          <div className="ws-month-rain-list">{satelliteContext.gpm.monthly.slice(-6).map((item) => <div key={item.month}><span>{formatMonth(item.month)}</span><strong>{Math.round(item.totalMm)} mm</strong><small>{item.validDays} days</small></div>)}</div>
                          <small className="vi-method-note">{satelliteContext.gpm.source} · approx. {satelliteContext.gpm.resolutionKm} km grid · mm/day accumulated by month.</small>
                        </> : <div className="ws-source-unavailable"><p>{satelliteContext?.gpm?.reason || "GPM IMERG observations were not available for this location and period."}</p>{satelliteContext?.gpm?.status === "needs_token" && <a href="https://urs.earthdata.nasa.gov/" target="_blank" rel="noreferrer">NASA Earthdata Login</a>}</div>}
                        {satelliteContext?.gpm?.note && <small className="vi-method-note">{satelliteContext.gpm.note}</small>}
                      </article>
                      <article className="ws-earth-card">
                        <div className="ws-earth-card-head"><div><span className="vi-overline">ECOSTRESS · EVAPOTRANSPIRATION</span><h3>How much water was released?</h3></div><span className={`ws-data-state ${satelliteContext?.ecostress?.status === "available" ? "is-ready" : ""}`}>{satelliteContext?.ecostress?.status === "available" ? "DATA FOUND" : satelliteContext?.ecostress?.status === "needs_token" ? "TOKEN REQUIRED" : "UNAVAILABLE"}</span></div>
                        {satelliteContext?.ecostress?.status === "available" ? <>
                          <div className="ws-earth-highlight"><strong>{Number(satelliteContext.ecostress.latest?.value).toFixed(2)} <small>mm/day</small></strong><span>latest daytime ET estimate · {satelliteContext.ecostress.latest?.date || "—"}</span></div>
                          <div className="ws-eco-observations">{satelliteContext.ecostress.observations.slice(-5).reverse().map((item) => <div key={item.date}><span>{item.date}</span><strong>{item.value.toFixed(2)} mm/day</strong></div>)}</div>
                          <small className="vi-method-note">{satelliteContext.ecostress.source} · {satelliteContext.ecostress.resolutionM} m grid · {satelliteContext.ecostress.observations.length} recent sampled observation(s).</small>
                        </> : <div className="ws-source-unavailable"><p>{satelliteContext?.ecostress?.reason || "ECOSTRESS observations were not available for this location and period."}</p>{satelliteContext?.ecostress?.status === "needs_token" && <a href="https://urs.earthdata.nasa.gov/" target="_blank" rel="noreferrer">NASA Earthdata Login</a>}</div>}
                        {satelliteContext?.ecostress?.note && <small className="vi-method-note">{satelliteContext.ecostress.note}</small>}
                      </article>
                    </div>
                    <div className="ws-earth-footnote"><Icon name="info" size={14}/><span>IMERG is a roughly 10 km rainfall estimate; ECOSTRESS JET is a 70 m daytime ET estimate with irregular ISS sampling. Both are sampled at the field centre, not averaged across the full boundary. ET is not the same as crop water demand, and a high ET value alone does not prove water stress.</span></div>
                  </section>

                  <section className="vi-white-panel"><div className="vi-panel-title"><div><span className="vi-overline">04 / WATER STRESS TIMELINE</span><h2>Month by month</h2><p>The coloured strip rates each month. The line shows root-zone wetness against what is normal for that month at this location.</p></div></div><StressTimeline months={result.monthly}/></section>

                  <div className="vi-analysis-grid">
                    <section className="vi-white-panel"><div className="vi-panel-title"><div><span className="vi-overline">05 / RAINFALL VS NORMAL</span><h2>Was it wetter or drier than usual?</h2><p>Normal is the average for the same calendar month and the same number of observed days over {result.baseline.yearsUsed} years.</p></div></div><RainChart months={result.monthly}/></section>
                    <section className="vi-white-panel"><div className="vi-panel-title"><div><span className="vi-overline">05b / RAIN VS EVAPORATIVE DEMAND</span><h2>How thirsty was the air?</h2><p>Bars show rainfall; the red line is how much water the atmosphere could have taken (ET0). When the line is above the bars, the soil is drying unless irrigated.</p></div></div><WaterBalanceChart months={result.monthly}/></section>
                    <section className="vi-white-panel ws-decline-panel">
                      <span className="vi-overline">06 / DECLINING SOIL MOISTURE</span>
                      <h2>{result.decliningPeriods.length ? `${result.decliningPeriods.length} drying period${result.decliningPeriods.length === 1 ? "" : "s"} found` : "No sustained drying period"}</h2>
                      {result.decliningPeriods.length ? (
                        <ul className="ws-period-list">
                          {result.decliningPeriods.map((period) => <li key={period.startDate}><strong>{formatPowerDate(period.startDate)} – {formatPowerDate(period.endDate)}</strong><span>{period.weeks} weeks · wetness fell from {wet(period.startWetness)} to {wet(period.endWetness)} (−{period.drop.toFixed(2)}) · {mm(period.rainMm)} rain</span></li>)}
                        </ul>
                      ) : <p>Root-zone wetness did not fall for three or more weeks in a row by at least 0.06.</p>}
                      <small className="vi-method-note">A drying period is a run of at least three weekly declines in root-zone wetness totalling 0.06 or more. Drying after a wet season can be normal; compare with the crop calendar.</small>
                    </section>
                  </div>

                  <section className="vi-white-panel vi-observation-table"><div className="vi-panel-title"><div><span className="vi-overline">07 / MONTHLY DETAIL</span><h2>Evidence by month</h2></div><span className="vi-panel-stamp">NASA POWER</span></div><div className="vi-table-scroll"><table><thead><tr><th>Month</th><th>Rating</th><th>Rain</th><th>Normal</th><th>% of normal</th><th>Root wetness</th><th>Normal wetness</th><th>Max temp</th><th>ET0</th><th>Rain − ET0</th><th>3-mo index</th></tr></thead><tbody>{result.monthly.map((m) => <tr key={m.month}><td>{formatMonth(m.month)}{m.partial ? " *" : ""}</td><td><b className="ws-dot" style={{ background: LEVEL_COLORS[m.stressLevel] }}/> {m.stressLabel}</td><td>{mm(m.rainMm)}</td><td>{mm(m.normalRainMm)}</td><td>{pct(m.rainRatio)}</td><td>{wet(m.rootWetness)}</td><td>{wet(m.rootWetnessNormal)}</td><td>{Number.isFinite(m.tmax) ? `${m.tmax.toFixed(1)}°C${Number.isFinite(m.tmaxAnomaly) ? ` (${m.tmaxAnomaly > 0 ? "+" : ""}${m.tmaxAnomaly.toFixed(1)})` : ""}` : "—"}</td><td>{mm(m.et0Mm)}</td><td>{Number.isFinite(m.waterBalanceMm) ? `${Math.round(m.waterBalanceMm)} mm` : "—"}</td><td>{Number.isFinite(m.spi3) ? m.spi3.toFixed(1) : "—"}</td></tr>)}</tbody></table></div><small className="vi-method-note">* Month with fewer days of data (most recent month, or NASA POWER lag). Normals are matched to the observed days.</small></section>

                  <section className="vi-caveats"><div><span className="vi-overline">READ THE DATA RESPONSIBLY</span><h3>What this can—and cannot—tell you.</h3></div><ul>{[...result.caveats, result.baseline.note, "How ratings are built: a month gains points for root-zone wetness well below normal, rainfall below 75% (or 50%) of normal or a dry three-month rainfall index (whichever is worse, counted once), very low absolute wetness, and, once, either daytime temperatures 2°C or more above normal or evaporative demand 10% above normal. Zero points is Normal, 1 Watch, 2–3 Moderate, 4 or more Severe."].map((item) => <li key={item}>{item}</li>)}</ul></section>
                  <div className="vi-source-footer"><span>DATA: NASA POWER (MERRA-2) · GPM IMERG · ECOSTRESS · NASA GIBS imagery</span><span>{result.source.gridNote}</span><a href="https://power.larc.nasa.gov/docs/services/api/" target="_blank" rel="noreferrer">NASA POWER API <Icon name="external" size={12}/></a></div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

