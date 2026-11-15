"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { area as calculateArea } from "@turf/area";
import { buildSoilProfile, confidenceFor, DEPTHS, SOIL_PROPERTIES } from "@/lib/soil-health/interpret";

const FIELDS_KEY = "agrimetry:global-farm-map:v1";
const SELECTED_FIELD_KEY = "agrimetry:vegetation:selected-field:v1";
const TEST_KEY_PREFIX = "agrimetry:soil-test:v1:";
const EMPTY_TEST = { ph: "", socPercent: "", sand: "", silt: "", clay: "", bulkDensity: "" };
const LEVEL_COLORS = { good: "#4a7046", high: "#2f6b3a", moderate: "#d6b04a", watch: "#d6b04a", low: "#c2412f", limiting: "#c2412f" };
const SEVERITY_COLORS = { high: "#c2412f", moderate: "#e08a3c", info: "#6e925f" };
const SEVERITY_LABELS = { high: "Important", moderate: "Worth planning for", info: "Good to know" };
const TEXTURE_COLORS = { sand: "#d9b36a", silt: "#a8bd75", clay: "#8f552e" };

function Icon({ name, size = 18 }) {
  const paths = {
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/></>,
    back: <path d="m15 18-6-6 6-6"/>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-3"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></>,
    external: <><path d="M14 3h7v7m0-7-9 9"/><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15m6-12v15"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.info}</svg>;
}

const fieldName = (feature, index = 0) => feature?.properties?.fieldName || feature?.properties?.name || `Field ${index + 1}`;
const fieldKey = (feature, index = 0) => String(feature?.id || feature?.properties?.fieldName || `field-${index}`);
function areaLabel(feature) {
  try {
    const m2 = calculateArea(feature);
    return `${(m2 / 10000).toLocaleString(undefined, { maximumFractionDigits: 2 })} ha · ${(m2 / 4046.8564224).toLocaleString(undefined, { maximumFractionDigits: 2 })} acres`;
  } catch { return "Area unavailable"; }
}
const fmt = (value, decimals) => (Number.isFinite(value) ? value.toFixed(decimals) : "—");
const depthText = (label) => label.replace("cm", "").replace("-", "–") + " cm";

function TextureProfile({ layers }) {
  const rows = DEPTHS.map((depth) => {
    const sand = layers?.sand?.[depth.label]?.mean;
    const silt = layers?.silt?.[depth.label]?.mean;
    const clay = layers?.clay?.[depth.label]?.mean;
    return { depth, sand, silt, clay, ok: [sand, silt, clay].every(Number.isFinite) };
  });
  return (
    <div className="sh-texture">
      <div className="vi-chart-legend">{Object.keys(TEXTURE_COLORS).map((k) => <span key={k}><b className="ws-dot" style={{ background: TEXTURE_COLORS[k] }}/> {k[0].toUpperCase() + k.slice(1)}</span>)}</div>
      {rows.map(({ depth, sand, silt, clay, ok }) => {
        const total = ok ? sand + silt + clay : 0;
        return (
          <div className="sh-texture-row" key={depth.label}>
            <span>{depthText(depth.label)}</span>
            <div className="sh-texture-bar">{ok ? ["sand", "silt", "clay"].map((k) => { const v = { sand, silt, clay }[k]; return <i key={k} style={{ width: `${(v / total) * 100}%`, background: TEXTURE_COLORS[k] }} title={`${k}: ${v.toFixed(0)}%`}/>; }) : <em>no estimate</em>}</div>
            <small>{ok ? `${sand.toFixed(0)} / ${silt.toFixed(0)} / ${clay.toFixed(0)} %` : "—"}</small>
          </div>
        );
      })}
    </div>
  );
}

function SoilMoistureStory({ data }) {
  if (!data?.available || !data.summary?.latest) return null;
  const latest = data.summary.latest;
  const trendLabel = (direction) => ({ declining: "Moving down", rising: "Moving up", steady: "Fairly steady", insufficient: "Not enough observations" }[direction] || "Not available");
  const dateLabel = (value) => value && /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : "Latest available";
  return (
    <section className="vi-story-panel sh-smap-panel" aria-labelledby="sh-smap-title">
      <div className="vi-story-intro">
        <span className="vi-story-leaf"><Icon name="layers" size={21}/></span>
        <div>
          <span className="vi-overline">THE WATER MEMORY OF THIS LAND · {data.kind === "smap" ? "NASA SMAP" : "NASA POWER HYDROLOGY"}</span>
          <h2 id="sh-smap-title">What has been happening beneath the surface?</h2>
          <p>{data.kind === "smap" ? "SMAP follows water in the surface and root zone over time. Its roughly 9 km grid represents the surrounding landscape rather than this individual field." : "When the higher-resolution SMAP series is unavailable, NASA POWER can still provide broader MERRA-2 wetness context. This roughly 50 km model grid is coarser and is not a direct SMAP measurement."}</p>
        </div>
      </div>
      <div className="sh-smap-metrics">
        <article><span>{data.kind === "smap" ? "SURFACE MOISTURE · 0–5 CM" : "SURFACE WETNESS FRACTION"}</span><strong>{Number.isFinite(latest.surface) ? (data.kind === "smap" ? `${latest.surface.toFixed(3)} m³/m³` : `${(latest.surface * 100).toFixed(0)}%`) : "—"}</strong><small>{data.kind === "smap" ? "Recent surface water content" : "Modelled fraction of surface-layer wetness"}</small></article>
        <article><span>{data.kind === "smap" ? "ROOT-ZONE MOISTURE · 0–100 CM" : "ROOT-ZONE WETNESS FRACTION"}</span><strong>{Number.isFinite(latest.rootZone) ? (data.kind === "smap" ? `${latest.rootZone.toFixed(3)} m³/m³` : `${(latest.rootZone * 100).toFixed(0)}%`) : "—"}</strong><small>{data.kind === "smap" ? "Recent modelled root-zone water content" : "Modelled fraction of root-zone wetness"}</small></article>
        <article><span>{data.kind === "smap" ? "ROOT-ZONE PERCENTILE" : "DATA SOURCE"}</span><strong>{data.kind === "smap" && Number.isFinite(latest.rootPercentile) ? `${latest.rootPercentile.toFixed(0)}th` : data.kind === "smap" ? "—" : "MERRA-2"}</strong><small>{data.kind === "smap" ? "Relative to this location's SMAP record since 2015" : "Broader model-based context, not SMAP"}</small></article>
      </div>
      <div className="sh-smap-story-grid">
        <article><span>THE DEEPER STORY</span><strong>{data.story?.headline || "Recent water conditions"}</strong><p>{data.story?.observations?.join(" ") || "Recent SMAP readings add context to the water held in the wider landscape."}</p></article>
        <article><span>HOW THE LAST 90 DAYS MOVED</span><strong>Root zone: {trendLabel(data.summary.rootTrend?.direction)}</strong><p>Surface layer: {trendLabel(data.summary.surfaceTrend?.direction)}. These trends describe the available sequence of readings, not a forecast or a diagnosis of crop stress.</p></article>
      </div>
      <div className="vi-story-next"><span className="vi-overline">WHAT TO CHECK NEXT</span><p>{data.story?.nextStep || "Compare these readings with rainfall, crop stage and what is visible in the field."}</p></div>
      <small className="vi-method-note">{data.source?.name || "NASA POWER soil-water context"} · native resolution about {Math.round((data.source?.nativeResolutionMetres || 9000) / 1000)} km · {data.summary.observationCount || 0} valid daily observations · through {dateLabel(data.source?.endDate || latest.date)}. {data.source?.note || ""}</small>
    </section>
  );
}

export default function SoilHealthIntelligence() {
  const [fields, setFields] = useState([]);
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [test, setTest] = useState(EMPTY_TEST);
  const [testSaved, setTestSaved] = useState(false);
  const [deepLoading, setDeepLoading] = useState("");
  const [deepError, setDeepError] = useState("");

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
  }, []);

  useEffect(() => {
    if (!selectedFieldId) return;
    try {
      const saved = JSON.parse(localStorage.getItem(TEST_KEY_PREFIX + selectedFieldId) || "null");
      setTest(saved ? { ...EMPTY_TEST, ...saved } : EMPTY_TEST);
    } catch { setTest(EMPTY_TEST); }
    setTestSaved(false);
  }, [selectedFieldId]);

  useEffect(() => {
    if (!loading) return undefined;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => { window.clearInterval(timer); setElapsed(0); };
  }, [loading]);

  const selectedIndex = fields.findIndex((f, i) => fieldKey(f, i) === selectedFieldId);
  const selectedField = selectedIndex >= 0 ? fields[selectedIndex] : null;
  const selectedName = selectedField ? fieldName(selectedField, selectedIndex) : "Selected field";
  const selectedArea = useMemo(() => (selectedField ? areaLabel(selectedField) : "—"), [selectedField]);

  const layers = result?.layers || null;
  const profile = useMemo(() => buildSoilProfile(layers, test), [layers, test]);
  const hasFarmerValues = profile.farmerValuesUsed.length > 0;
  const showProfile = Boolean(result) || hasFarmerValues;
  const resultInfo = result || { status: "local", source: null, sample: null, warnings: [], caveats: [] };

  async function runAnalysis(event) {
    event?.preventDefault();
    if (!selectedField) { setError("Choose or save a farm boundary on the Global Farm Map first."); return; }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/soil-health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field: selectedField }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Soil lookup failed (HTTP ${response.status}).`);
      setResult(payload);
    } catch (requestError) {
      setError(requestError.message || "Unable to retrieve soil information.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore(kind) {
    if (!selectedField || !result?.sample) return;
    setDeepLoading(kind);
    setDeepError("");
    try {
      const response = await fetch("/api/soil-health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field: selectedField, mode: kind, samplePoint: result.sample }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "That request could not be completed (HTTP " + response.status + ").");
      if (!payload.layers) throw new Error(payload.error || payload.soilGrids?.error || "ISRIC did not return the requested extra soil layers. Your existing soil and water analysis is unchanged.");
      if (payload.soilGrids?.error) setDeepError(payload.soilGrids.error);
      setResult((current) => {
        if (!current) return current;
        const merged = {};
        const keys = new Set([...Object.keys(current.layers || {}), ...Object.keys(payload.layers || {})]);
        for (const key of keys) {
          merged[key] = { ...(current.layers?.[key] || {}) };
          for (const [label, entry] of Object.entries(payload.layers?.[key] || {})) {
            merged[key][label] = { ...(merged[key][label] || {}), ...Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== null)) };
          }
        }
        return { ...current, layers: merged };
      });
    } catch (loadError) {
      setDeepError(loadError.message || "That request could not be completed.");
    } finally {
      setDeepLoading("");
    }
  }

  function selectField(id) {
    const feature = fields.find((item, index) => fieldKey(item, index) === id);
    setSelectedFieldId(id);
    setResult(null);
    setError("");
    if (feature) { try { localStorage.setItem(SELECTED_FIELD_KEY, JSON.stringify(feature)); } catch {} }
  }

  function updateTest(key, value) {
    setTest((current) => ({ ...current, [key]: value }));
    setTestSaved(false);
  }
  function saveTest() {
    try { localStorage.setItem(TEST_KEY_PREFIX + selectedFieldId, JSON.stringify(test)); setTestSaved(true); } catch { setError("Your soil test could not be saved in this browser."); }
  }
  function clearTest() {
    setTest(EMPTY_TEST);
    try { localStorage.removeItem(TEST_KEY_PREFIX + selectedFieldId); } catch {}
    setTestSaved(false);
  }

  const sand = profile.effective.sand, silt = profile.effective.silt, clay = profile.effective.clay;
  const textureSum = [sand, silt, clay].every(Number.isFinite) ? sand + silt + clay : null;
  const textureWarning = textureSum !== null && Math.abs(textureSum - 100) > 5 && profile.origin.sand === "farmer";

  return (
    <main className="vi-page">
      <header className="vi-header">
        <div className="vi-brand-wrap">
          <Link href="/explore/map" className="vi-back" aria-label="Back to global farm map"><Icon name="back" size={18}/></Link>
          <Link href="/" className="vi-brand"><span className="vi-brand-mark"><Icon name="layers" size={19}/></span><span>agrimetry<span>.</span></span></Link>
          <span className="vi-divider"/>
          <div className="vi-header-title"><small>FIELD INTELLIGENCE</small><strong>Soil health</strong></div>
        </div>
        <div className="vi-header-actions"><span className="vi-source-pill"><i/> SOILGRIDS · NASA SMAP · YOUR SOIL TEST</span><Link href="/explore/vegetation" className="vi-explore-link">Vegetation</Link><Link href="/explore/water-stress" className="vi-explore-link">Water stress</Link><Link href="/explore/bare-field" className="vi-explore-link">Bare fields</Link><Link href="/explore/rotation" className="vi-explore-link">Rotation</Link></div>
      </header>

      <div className="vi-content">
        <section className="vi-intro">
          <div>
            <span className="vi-kicker"><span/> SOIL HEALTH INTELLIGENCE</span>
            <h1>Know the soil under your <em>next crop</em>.</h1>
            <p>Agrimetry combines mapped soil properties when available, NASA soil-water history and your own laboratory results. It explains what the soil foundation and changing water conditions may mean for crops, while keeping each source, depth and resolution visible.</p>
          </div>
          <div className="vi-intro-note"><Icon name="layers" size={20}/><span>ISRIC WCS · NASA SMAP · farmer tests<br/><strong>Independent fallback data sources</strong></span></div>
        </section>

        {fields.length === 0 ? (
          <section className="vi-empty-state">
            <div className="vi-empty-icon"><Icon name="map" size={28}/></div>
            <div><span className="vi-kicker">NO SAVED FIELD FOUND</span><h2>Choose a field before looking at soil.</h2><p>Go to the Global Farm Map, draw a boundary and save it, then come back here.</p><Link href="/explore/map" className="vi-primary-button">Open Global Farm Map <Icon name="external" size={15}/></Link></div>
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
              <button type="button" className="vi-run-button" onClick={runAnalysis} disabled={loading || !selectedField}><Icon name={loading ? "refresh" : "layers"} size={17}/>{loading ? "Reading soil and water data…" : "Read this field"}</button>
              {error && <div className="vi-error" role="alert"><Icon name="info" size={17}/><span>{error}</span></div>}

              <div className="vi-panel-divider"/>
              <div className="vi-panel-heading"><span className="vi-section-number">02</span><div><small>OPTIONAL · YOUR LAB RESULTS</small><h2>Add a soil test</h2></div></div>
              <p className="sh-form-help">Topsoil values (about 0–30 cm). Leave blank what you do not have. Your values replace the SoilGrids estimate and the interpretation updates instantly.</p>
              <div className="sh-form">
                <label>pH (water)<input type="number" step="0.1" min="3" max="11" inputMode="decimal" value={test.ph} onChange={(e) => updateTest("ph", e.target.value)} placeholder="e.g. 6.5"/></label>
                <label>Organic carbon (%)<input type="number" step="0.1" min="0" max="30" inputMode="decimal" value={test.socPercent} onChange={(e) => updateTest("socPercent", e.target.value)} placeholder="e.g. 1.2"/></label>
                <label>Sand (%)<input type="number" step="1" min="0" max="100" inputMode="decimal" value={test.sand} onChange={(e) => updateTest("sand", e.target.value)}/></label>
                <label>Silt (%)<input type="number" step="1" min="0" max="100" inputMode="decimal" value={test.silt} onChange={(e) => updateTest("silt", e.target.value)}/></label>
                <label>Clay (%)<input type="number" step="1" min="0" max="100" inputMode="decimal" value={test.clay} onChange={(e) => updateTest("clay", e.target.value)}/></label>
                <label>Bulk density (g/cm³)<input type="number" step="0.01" min="0.5" max="2.2" inputMode="decimal" value={test.bulkDensity} onChange={(e) => updateTest("bulkDensity", e.target.value)} placeholder="e.g. 1.35"/></label>
              </div>
              {textureWarning && <div className="vi-error" role="alert"><Icon name="info" size={17}/><span>Sand + silt + clay add up to {textureSum.toFixed(0)}%, not 100%. Check your lab report; the texture class normalises them.</span></div>}
              <div className="sh-form-actions"><button type="button" className="vi-primary-button" onClick={saveTest}>{testSaved ? "Saved in this browser ✓" : "Save for this field"}</button><button type="button" className="sh-link-button" onClick={clearTest}>Clear</button></div>
              <div className="vi-source-note"><Icon name="info" size={15}/><p>Soil-test values are stored only in this browser, per field. Enter organic carbon as a percentage, as most labs report it (1% = 10 g/kg).</p></div>
            </aside>

            <section className="vi-results-area">
              {loading && <section className="vi-analysis-progress" role="status" aria-live="polite"><div className="vi-progress-head"><span className="vi-progress-orbit"><span/><i/></span><div><span className="vi-overline">AGRIMETRY IS READING THE LAND</span><h2>Checking soil maps and NASA water history</h2></div><time>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</time></div><p className="vi-progress-detail">SoilGrids map access and NASA SMAP are requested independently. If one service is unavailable, the other can still provide useful context, and you can always add your own soil-test values.</p><div className="vi-progress-track" aria-hidden="true"><span/></div></section>}

              {!showProfile ? (
                !loading && <div className="vi-wait-panel"><span className="vi-wait-mark"><Icon name="layers" size={22}/></span><div><strong>Your Soil Intelligence Profile will appear here.</strong><p>Run an analysis to combine mapped soil information and NASA soil-water history, or add your own laboratory soil-test results on the left.</p></div></div>
              ) : (
                <>
                  <div className="vi-result-heading"><div><span className="vi-overline">03 / SOIL & WATER INTELLIGENCE</span><h2>{selectedName}</h2><p>{layers ? `SoilGrids 2.0 via ${resultInfo.source?.accessMethod || "ISRIC map service"} (250 m)${resultInfo.sample?.where === "nearby" ? " · sampled just outside the field" : ""}` : hasFarmerValues ? "Using your own soil-test results" : "Soil map unavailable; checking independent NASA water data"}{hasFarmerValues ? " · your test values take priority" : ""}</p></div><span className="vi-live-badge"><i/> {resultInfo.status === "ready" ? "SOURCES READY" : resultInfo.status === "partial" ? "PARTIAL DATA READY" : resultInfo.status === "local" ? "LOCAL TEST DATA" : "LIMITED DATA"}</span></div>

                  {layers && (!layers.soc?.["30-60cm"] || !Number.isFinite(layers.soc?.["0-5cm"]?.low)) && (
                    <div className="vi-error sh-notice" role="status"><Icon name="info" size={17}/><span>Some optional deeper layers or prediction intervals are not loaded yet. {!layers.soc?.["30-60cm"] && <button type="button" className="sh-link-button" onClick={() => loadMore("deep")} disabled={Boolean(deepLoading)}>{deepLoading === "deep" ? "Loading deeper layers…" : "Load deeper layers (30–200 cm)"}</button>} {!Number.isFinite(layers.soc?.["0-5cm"]?.low) && <button type="button" className="sh-link-button" onClick={() => loadMore("intervals")} disabled={Boolean(deepLoading)}>{deepLoading === "intervals" ? "Loading uncertainty ranges (up to a minute)…" : "Load uncertainty ranges (top 30 cm)"}</button>}{deepError ? " " + deepError : ""}</span></div>
                  )}
                  {result?.sample?.where === "nearby" && <div className="vi-error sh-notice" role="status"><Icon name="info" size={17}/><span>The mapped estimate comes from a nearby point outside the field. Treat it as regional context, not a field measurement.</span></div>}

                  {resultInfo.warnings?.map((warning) => <div className="sh-service-notice" role="status" key={warning}><span className="sh-service-notice-icon"><Icon name="info" size={17}/></span><div><strong>{warning.includes("showing the coarser MERRA-2") ? "Using a broader NASA water dataset" : "Some data is temporarily unavailable"}</strong><p>{warning}</p></div></div>)}

                  {(layers || hasFarmerValues) && <div className="vi-metrics-grid">
                    <article className="vi-metric-card"><span>TEXTURE (TOPSOIL)</span><strong className="sh-metric-text">{profile.texture || "—"}</strong><small>{Number.isFinite(sand) ? `${sand.toFixed(0)}% sand · ${silt.toFixed(0)}% silt · ${clay.toFixed(0)}% clay` : "Needs sand, silt and clay."}</small></article>
                    <article className="vi-metric-card"><span>ORGANIC CARBON</span><strong>{profile.ratings.soc ? profile.ratings.soc.label : "—"}</strong><small>{profile.ratings.soc ? `${profile.ratings.soc.detail} (${profile.origin.soc === "farmer" ? "your test" : "mapped estimate"}).` : "No value available."}</small></article>
                    <article className="vi-metric-card"><span>SOIL pH</span><strong>{Number.isFinite(profile.effective.phh2o) ? profile.effective.phh2o.toFixed(1) : "—"}</strong><small>{profile.ratings.ph ? `${profile.ratings.ph.label}. ${profile.origin.phh2o === "farmer" ? "Your test." : "mapped estimate."}` : "No value available."}</small></article>
                    <article className="vi-metric-card"><span>BULK DENSITY</span><strong>{Number.isFinite(profile.effective.bdod) ? profile.effective.bdod.toFixed(2) : "—"}</strong><small>{profile.ratings.bulkDensity ? `${profile.ratings.bulkDensity.label} (kg/dm³). ${profile.origin.bdod === "farmer" ? "Your test." : "mapped estimate."}` : "No value available."}</small></article>
                  </div>}

                  {(layers || hasFarmerValues) && <section className="vi-story-panel sh-land-story" aria-labelledby="sh-land-story-title">
                    <div className="vi-story-intro">
                      <span className="vi-story-leaf"><Icon name="leaf" size={21}/></span>
                      <div>
                        <span className="vi-overline">THE STORY BENEATH THIS FIELD</span>
                        <h2 id="sh-land-story-title">What the soil is telling us</h2>
                        <p>Every field has a foundation beneath the crop canopy. This profile brings together {hasFarmerValues ? "your soil-test results" : "mapped soil estimates"}{layers && hasFarmerValues ? " and regional SoilGrids information" : ""} to describe that foundation. It is a guide to what may shape crop choices, not a diagnosis of the whole field.</p>
                      </div>
                    </div>
                    <div className="vi-story-grid">
                      <article className="vi-story-cell"><span>THE SOIL'S TEXTURE</span><strong>{profile.texture || "Texture not yet known"}</strong><p>{Number.isFinite(sand) ? `The topsoil estimate is ${sand.toFixed(0)}% sand, ${silt.toFixed(0)}% silt and ${clay.toFixed(0)}% clay. Texture influences how quickly water drains, how much it can hold and how roots move through the soil.` : "Sand, silt and clay values are not available yet. Add a soil test to complete this part of the story."}</p></article>
                      <article className="vi-story-cell"><span>THE SOIL'S ORGANIC FOUNDATION</span><strong>{profile.ratings.soc?.label || "No carbon result"}</strong><p>{profile.ratings.soc ? `${profile.ratings.soc.detail}. Organic carbon is one clue about the soil's organic matter; it does not by itself measure all aspects of soil fertility or biological activity.` : "Organic carbon was not available in this profile. A laboratory soil test can provide a more direct measurement."}</p></article>
                      <article className="vi-story-cell"><span>THE CHEMICAL SETTING</span><strong>{Number.isFinite(profile.effective.phh2o) ? `pH ${profile.effective.phh2o.toFixed(1)}` : "pH not available"}</strong><p>{Number.isFinite(profile.effective.phh2o) ? "Soil pH influences nutrient availability and the suitability of different crops. The best range depends on the crop and local conditions." : "A pH result is needed before drawing conclusions about acidity or alkalinity."}</p></article>
                      <article className="vi-story-cell"><span>WHAT MAY NEED ATTENTION</span><strong>{profile.limitations?.length ? `${profile.limitations.length} point${profile.limitations.length === 1 ? "" : "s"} to review` : "No flagged limitation"}</strong><p>{profile.limitations?.length ? "The evidence panel below explains each flagged property, why it may matter and what to consider when comparing rotations. These are prompts for investigation, not proof of a field problem." : "The available indicators have not flagged a major limitation. This does not rule out nutrient deficiencies, salinity or local variation that these datasets do not measure."}</p></article>
                    </div>
                    <div className="vi-story-next"><span className="vi-overline">A PRACTICAL NEXT STEP</span><p>Use this profile alongside a recent laboratory soil test and what you observe in the field. Compare texture, organic carbon and pH with the needs of the crops you are considering; investigate any flagged limitation with a local agronomist before changing the rotation.</p></div>
                  </section>}

                  {!layers && !hasFarmerValues && <section className="vi-white-panel sh-no-soil-map"><span className="vi-overline">SOIL FOUNDATION NOT AVAILABLE RIGHT NOW</span><h2>The water story can still be read.</h2><p>ISRIC SoilGrids did not return a usable soil profile for this request. Agrimetry has not substituted NASA moisture data for pH, texture or organic carbon. Enter a recent laboratory soil test to complete the soil foundation while the mapped service recovers.</p></section>}

                  {resultInfo.soilMoisture?.available && <SoilMoistureStory data={resultInfo.soilMoisture}/>}

                  {(layers || hasFarmerValues) && <section className="vi-white-panel">
                    <div className="vi-panel-title"><div><span className="vi-overline">04 / POSSIBLE LIMITATIONS</span><h2>{profile.limitations.some((l) => l.severity !== "info") ? "What may hold the soil back" : "No major limitation flagged"}</h2><p>Plain-language reading of the values above, and what each means for crop choice and rotation planning.</p></div></div>
                    {profile.limitations.length ? (
                      <div className="sh-limits">
                        {profile.limitations.map((item) => (
                          <article className="sh-limit" key={item.id} style={{ borderLeftColor: SEVERITY_COLORS[item.severity] }}>
                            <div className="sh-limit-head"><strong>{item.title}</strong><span className="bf-chip" style={{ background: SEVERITY_COLORS[item.severity] }}>{SEVERITY_LABELS[item.severity]}</span></div>
                            <small className="sh-evidence">{item.evidence}</small>
                            <p><b>What it means:</b> {item.effect}</p>
                            <p><b>For your rotation:</b> {item.rotation}</p>
                          </article>
                        ))}
                      </div>
                    ) : <p className="bf-empty">No major limitation is flagged by the available values. This does not rule out nutrient deficiencies, salinity or local variation that these inputs do not measure.</p>}
                  </section>}

                  {layers && (
                    <>
                      <div className="vi-analysis-grid">
                        <section className="vi-white-panel"><div className="vi-panel-title"><div><span className="vi-overline">05 / TEXTURE BY DEPTH</span><h2>How sandy or clayey, down to 2 m</h2><p>Sand / silt / clay (%) for each SoilGrids layer.</p></div></div><TextureProfile layers={layers}/></section>
                        <section className="vi-white-panel sh-meta-panel"><span className="vi-overline">06 / HOW MUCH TO TRUST IT</span><h2>Resolution and uncertainty</h2>
                          <ul className="sh-meta-list">
                            <li><strong>Resolution:</strong> one prediction per {(resultInfo.source?.resolutionMetres || 250)} m cell (about {Math.round(((resultInfo.source?.resolutionMetres || 250) ** 2) / 100) / 100} ha).</li>
                            <li><strong>Depths:</strong> {DEPTHS.map((d) => depthText(d.label)).join(", ")}.</li>
                            <li><strong>Uncertainty:</strong> 90% prediction intervals are shown when the map service returns them. A missing interval means its uncertainty range was not available, not that the value is certain.</li>
                            <li><strong>Sample point:</strong> {resultInfo.sample ? `${resultInfo.sample.latitude.toFixed(4)}, ${resultInfo.sample.longitude.toFixed(4)} (${resultInfo.sample.where === "nearby" ? "just outside the field" : "inside the field"})` : "—"}.</li>
                          </ul>
                          <small className="vi-method-note">{resultInfo.source?.note || "Values are not currently available from the mapped service."} {resultInfo.source?.license ? `Licence: ${resultInfo.source.license}.` : ""}</small>
                        </section>
                      </div>

                      <section className="vi-white-panel vi-observation-table"><div className="vi-panel-title"><div><span className="vi-overline">07 / ALL LAYERS</span><h2>Values by depth</h2></div><span className="vi-panel-stamp">Mean (90% interval) · confidence</span></div>
                        <div className="vi-table-scroll"><table><thead><tr><th>Depth</th>{SOIL_PROPERTIES.map((p) => <th key={p.key}>{p.label}{p.unit ? ` (${p.unit})` : ""}</th>)}</tr></thead><tbody>{DEPTHS.map((depth) => <tr key={depth.label}><td>{depthText(depth.label)}</td>{SOIL_PROPERTIES.map((p) => { const entry = layers?.[p.key]?.[depth.label]; const conf = confidenceFor(p.key, entry); return <td key={p.key}>{Number.isFinite(entry?.mean) ? <>{fmt(entry.mean, p.decimals)} <small>({fmt(entry.low, p.decimals)}–{fmt(entry.high, p.decimals)})</small> {conf && <b className="ws-dot" title={`${conf} confidence`} style={{ background: LEVEL_COLORS[conf === "high" ? "good" : conf === "medium" ? "moderate" : "low"] }}/>}</> : "—"}</td>; })}</tr>)}</tbody></table></div>
                        <small className="vi-method-note">Dot colour: green = narrow interval (higher confidence), amber = medium, red = wide (low confidence). Organic carbon is shown in g/kg (10 g/kg = 1%).</small>
                      </section>
                    </>
                  )}

                  <section className="vi-caveats"><div><span className="vi-overline">READ THE DATA RESPONSIBLY</span><h3>What this can—and cannot—tell you.</h3></div><ul>{[...(resultInfo.caveats || ["Soil-test results describe a sample, not the whole field; sampling depth and method matter.", "Interpretations are general guidance. Crop response depends on climate, management and local conditions."]), "Crop-by-crop suitability scoring is provided by the Crop Rotation Intelligence Engine; this profile feeds that engine."].map((item) => <li key={item}>{item}</li>)}</ul></section>
                  <div className="vi-source-footer"><span>DATA: ISRIC SOILGRIDS · NASA SMAP / POWER · FARMER SOIL TEST</span><span>SoilGrids: CC BY 4.0 · SMAP: NASA / NSIDC</span><a href="https://docs.isric.org/globaldata/soilgrids/" target="_blank" rel="noreferrer">ISRIC data access <Icon name="external" size={12}/></a><a href="https://power.larc.nasa.gov/docs/methodology/data/sources_hydrology/" target="_blank" rel="noreferrer">NASA SMAP methodology <Icon name="external" size={12}/></a></div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

