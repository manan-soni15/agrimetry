"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { area as calculateArea } from "@turf/area";
import { CROPS, EQUIPMENT } from "@/lib/rotation/crops";
import { buildClimate, CRITERIA, DEFAULT_PRIORITIES, generateStrategies, MONTH_NAMES, soilForEngine } from "@/lib/rotation/engine";
import { buildSoilProfile } from "@/lib/soil-health/interpret";

const FIELDS_KEY = "agrimetry:global-farm-map:v1";
const SELECTED_FIELD_KEY = "agrimetry:vegetation:selected-field:v1";
const TEST_KEY_PREFIX = "agrimetry:soil-test:v1:";
const STRATEGY_COLORS = ["#8a6a63", "#426b46", "#4f86a8", "#d6a53a"];
const PRIORITY_ROWS = [
  { key: "water", label: "Water availability", hint: "How much water is a constraint" },
  { key: "soilHealth", label: "Soil health", hint: "Nitrogen, cover and organic matter" },
  { key: "market", label: "Market demand", hint: "Selling the crops you grow" },
  { key: "forage", label: "Forage for livestock", hint: "Fodder from the rotation" },
  { key: "equipment", label: "Equipment limits", hint: "Using machinery you have" },
];
const CASH_CROPS = CROPS.filter((crop) => crop.cash);

function Icon({ name, size = 18 }) {
  const paths = {
    rotate: <><path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4M6 21v-4h4"/></>,
    back: <path d="m15 18-6-6 6-6"/>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-3"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></>,
    external: <><path d="M14 3h7v7m0-7-9 9"/><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15m6-12v15"/></>,
    droplets: <><path d="M12 3s-6 6.2-6 10a6 6 0 0 0 12 0c0-3.8-6-10-6-10Z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/></>,
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
function fieldCentre(feature) {
  const geometry = feature?.geometry;
  const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
  const points = polygons.flatMap((polygon) => polygon?.[0] || []);
  if (!points.length) return null;
  const lons = points.map((p) => Number(p[0]));
  const lats = points.map((p) => Number(p[1]));
  return { longitude: (Math.min(...lons) + Math.max(...lons)) / 2, latitude: (Math.min(...lats) + Math.max(...lats)) / 2 };
}
const slotLabel = (index, seasonsPerYear) => (seasonsPerYear === 1 ? `Year ${index + 1}` : `Y${Math.floor(index / 2) + 1} ${index % 2 === 0 ? "warm" : "cool"}`);

function ClimateStrip({ climate }) {
  const width = 720, height = 150, left = 38, right = 36, top = 12, bottom = 26;
  const step = (width - left - right) / 12;
  const maxRain = Math.max(50, ...climate.months.map((m) => m.rainMm)) * 1.1;
  const maxTemp = Math.max(...climate.months.map((m) => m.tempMean), 30) + 2;
  const minTemp = Math.min(...climate.months.map((m) => m.tempMean), 0) - 2;
  const yRain = (v) => top + (1 - v / maxRain) * (height - top - bottom);
  const yTemp = (v) => top + (1 - (v - minTemp) / (maxTemp - minTemp)) * (height - top - bottom);
  const points = climate.months.map((m, i) => `${left + step * i + step / 2},${yTemp(m.tempMean)}`).join(" ");
  return (
    <svg className="vi-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Monthly rainfall and temperature normals">
      {climate.months.map((m, i) => <g key={m.index}><rect x={left + step * i + step * 0.2} y={yRain(m.rainMm)} width={step * 0.6} height={Math.max(0, height - bottom - yRain(m.rainMm))} fill="#4f86a8" opacity=".75" rx="2"><title>{MONTH_NAMES[i]}: {Math.round(m.rainMm)} mm, {m.tempMean.toFixed(1)}°C</title></rect><text x={left + step * i + step / 2} y={height - 8} textAnchor="middle" fill="#858c7c" fontSize="10">{MONTH_NAMES[i]}</text></g>)}
      <polyline points={points} fill="none" stroke="#c2412f" strokeWidth="2.4" strokeLinejoin="round"/>
      <text x={left - 6} y={top + 4} textAnchor="end" fill="#4f86a8" fontSize="10">{Math.round(maxRain)} mm</text>
      <text x={width - right + 6} y={top + 4} fill="#c2412f" fontSize="10">{Math.round(maxTemp)}°C</text>
    </svg>
  );
}

export default function RotationIntelligence() {
  const [fields, setFields] = useState([]);
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [seasonsPerYear, setSeasonsPerYear] = useState(1);
  const [irrigation, setIrrigation] = useState("rainfed");
  const [existing, setExisting] = useState(["", "", "", ""]);
  const [priorities, setPriorities] = useState(DEFAULT_PRIORITIES);
  const [marketCrops, setMarketCrops] = useState([]);
  const [specifyEquipment, setSpecifyEquipment] = useState(false);
  const [equipment, setEquipment] = useState([]);
  const [useSoil, setUseSoil] = useState(true);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(0);
  const climateCache = useRef(new Map());

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(FIELDS_KEY) || "[]");
      const selectedField = JSON.parse(localStorage.getItem(SELECTED_FIELD_KEY) || "null");
      const safe = Array.isArray(stored) ? stored.filter((f) => ["Polygon", "MultiPolygon"].includes(f?.geometry?.type)) : [];
      if (selectedField?.geometry && !safe.some((f) => String(f.id) === String(selectedField.id))) safe.unshift(selectedField);
      setFields(safe);
      if (selectedField?.geometry) setSelectedFieldId(fieldKey(selectedField));
      else if (safe.length) setSelectedFieldId(fieldKey(safe[0], 0));
    } catch {
      setError("Saved field boundaries could not be read. Return to the Global Farm Map and save the field again.");
    }
  }, []);

  const selectedIndex = fields.findIndex((f, i) => fieldKey(f, i) === selectedFieldId);
  const selectedField = selectedIndex >= 0 ? fields[selectedIndex] : null;
  const selectedName = selectedField ? fieldName(selectedField, selectedIndex) : "Selected field";
  const selectedArea = useMemo(() => (selectedField ? areaLabel(selectedField) : "—"), [selectedField]);

  function selectField(id) {
    const feature = fields.find((item, index) => fieldKey(item, index) === id);
    setSelectedFieldId(id);
    setResult(null);
    setError("");
    if (feature) { try { localStorage.setItem(SELECTED_FIELD_KEY, JSON.stringify(feature)); } catch {} }
  }
  const toggle = (list, setList, id) => setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function loadClimate(centre) {
    const key = `${centre.latitude.toFixed(2)},${centre.longitude.toFixed(2)}`;
    if (climateCache.current.has(key)) return climateCache.current.get(key);
    const response = await fetch(`/api/climate-normals?lat=${centre.latitude.toFixed(4)}&lon=${centre.longitude.toFixed(4)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Climate lookup failed (HTTP ${response.status}).`);
    const climate = buildClimate(payload.parameter, payload.startYear, payload.endYear);
    if (!climate) throw new Error("NASA POWER returned too little history for a climate baseline here.");
    climateCache.current.set(key, climate);
    return climate;
  }

  async function loadSoil() {
    let layers = null;
    let soilMoisture = null;
    let note = null;
    try {
      const response = await fetch("/api/soil-health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field: selectedField }) });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        layers = payload.layers || null;
        soilMoisture = payload.soilMoisture || null;
        note = payload.warnings?.join(" ") || (!layers ? "Mapped soil properties are unavailable. Rotation scoring continues with the information that is available." : null);
      } else note = payload.error || `Soil and water context could not be loaded (HTTP ${response.status}).`;
    } catch (error) {
      note = error?.message || "Soil and water context could not be loaded.";
    }
    let test = null;
    try { test = JSON.parse(localStorage.getItem(TEST_KEY_PREFIX + selectedFieldId) || "null"); } catch {}
    const profile = buildSoilProfile(layers, test);
    const soil = soilForEngine(profile);
    return { soil, profile, note, soilMoisture, usedTest: profile.farmerValuesUsed.length > 0, usedSoilGrids: Boolean(layers) };
  }

  async function runAnalysis(event) {
    event?.preventDefault();
    const centre = selectedField ? fieldCentre(selectedField) : null;
    if (!centre) { setError("Choose or save a farm boundary on the Global Farm Map first."); return; }
    const slots = existing.slice(0, seasonsPerYear === 1 ? 4 : 4).filter(Boolean);
    if (slots.length < 2) { setError("Pick at least two crops for your current rotation so it can be compared. Use the crops you grow now, in order."); return; }
    if (seasonsPerYear === 2 && slots.length % 2 !== 0) { setError("With two seasons per year, pick crops in pairs (warm season then cool season)."); return; }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      setStage("Loading years of climate for your field…");
      const [climate, soilInfo] = await Promise.all([loadClimate(centre), useSoil ? loadSoil() : Promise.resolve({ soil: null, note: null })]);
      setStage("Scoring thousands of crop sequences…");
      await new Promise((resolve) => setTimeout(resolve, 30));
      const strategies = generateStrategies({
        climate, seasonsPerYear, irrigation, soil: soilInfo.soil,
        marketCrops: marketCrops.length ? marketCrops : null,
        equipment: specifyEquipment ? equipment : null,
        priorities,
      }, slots);
      if (!strategies) throw new Error("A climate baseline could not be built for this location.");
      setResult({ strategies, climate, soilInfo, centre, slots });
      try {
        const saved = [strategies.existing, ...strategies.alternatives].filter(Boolean).map((row) => ({ label: row.label, cropIds: row.cropIds }));
        localStorage.setItem("agrimetry:rotation:last:v1", JSON.stringify({ fieldId: selectedFieldId, seasonsPerYear, irrigation, strategies: saved }));
        // Full set of farmer-provided inputs, so the Evidence Passport can reproduce this comparison.
        localStorage.setItem("agrimetry:rotation:inputs:v1", JSON.stringify({ fieldId: selectedFieldId, seasonsPerYear, irrigation, existing: slots, priorities, marketCrops, equipment: specifyEquipment ? equipment : null, savedAt: new Date().toISOString() }));
      } catch {}
      setSelected(0);
    } catch (runError) {
      setError(runError.message || "Unable to compare crop rotations.");
    } finally {
      setLoading(false);
      setStage("");
    }
  }

  const rows = result ? [result.strategies.existing, ...result.strategies.alternatives].filter(Boolean) : [];
  const best = result?.strategies.alternatives[0];
  const current = result?.strategies.existing;
  const chosen = rows[selected] || null;
  const weights = result?.strategies.ctx.weights;

  return (
    <main className="vi-page">
      <header className="vi-header">
        <div className="vi-brand-wrap">
          <Link href="/explore/map" className="vi-back" aria-label="Back to global farm map"><Icon name="back" size={18}/></Link>
          <Link href="/" className="vi-brand"><span className="vi-brand-mark"><Icon name="rotate" size={19}/></span><span>agrimetry<span>.</span></span></Link>
          <span className="vi-divider"/>
          <div className="vi-header-title"><small>DECISION SUPPORT</small><strong>Crop rotation intelligence</strong></div>
        </div>
        <div className="vi-header-actions"><span className="vi-source-pill"><i/> NASA POWER · SOILGRIDS</span><Link href="/explore/soil-health" className="vi-explore-link">Soil health</Link><Link href="/explore/water-stress" className="vi-explore-link">Water stress</Link><Link href="/explore/bare-field" className="vi-explore-link">Bare fields</Link><Link href="/explore/replay" className="vi-explore-link">Climate replay</Link><Link href="/explore/passport" className="vi-explore-link">Evidence passport</Link></div>
      </header>

      <div className="vi-content">
        <section className="vi-intro">
          <div>
            <span className="vi-kicker"><span/> CROP ROTATION INTELLIGENCE ENGINE</span>
            <h1>Compare your rotation with <em>better options</em>.</h1>
            <p>Tell Agrimetry what you grow now and what matters to you. It scores your rotation and the best alternatives on climate and water fit, soil, nitrogen, crop sequence, erosion, organic matter, water use, market and equipment, and explains every score, with benefits, risks and what information is still missing.</p>
          </div>
          <div className="vi-intro-note"><Icon name="rotate" size={20}/><span>{CROPS.length} crops · 10 criteria · explainable scores<br/><strong>Uses your climate and soil data</strong></span></div>
        </section>

        {fields.length === 0 ? (
          <section className="vi-empty-state">
            <div className="vi-empty-icon"><Icon name="map" size={28}/></div>
            <div><span className="vi-kicker">NO SAVED FIELD FOUND</span><h2>Choose a field before comparing rotations.</h2><p>Go to the Global Farm Map, draw a boundary and save it, then come back here.</p><Link href="/explore/map" className="vi-primary-button">Open Global Farm Map <Icon name="external" size={15}/></Link></div>
          </section>
        ) : (
          <div className="vi-workspace">
            <aside className="vi-controls-panel">
              <div className="vi-panel-heading"><span className="vi-section-number">01</span><div><small>YOUR FIELD</small><h2>Choose your field</h2></div></div>
              <label className="vi-field-label">Saved farm / field
                <select value={selectedFieldId} onChange={(event) => selectField(event.target.value)}>
                  {fields.map((feature, index) => <option key={fieldKey(feature, index)} value={fieldKey(feature, index)}>{fieldName(feature, index)} · {areaLabel(feature)}</option>)}
                </select>
              </label>
              <div className="vi-selected-summary"><span className="vi-summary-icon"><Icon name="map" size={17}/></span><div><strong>{selectedName}</strong><small>{selectedArea}</small></div></div>

              <div className="vi-panel-divider"/>
              <div className="vi-panel-heading"><span className="vi-section-number">02</span><div><small>YOUR SYSTEM</small><h2>Seasons and water</h2></div></div>
              <label className="vi-field-label">Crops per year
                <select value={seasonsPerYear} onChange={(event) => setSeasonsPerYear(Number(event.target.value))}>
                  <option value={1}>One crop per year</option>
                  <option value={2}>Two crops per year (warm + cool season)</option>
                </select>
              </label>
              <label className="vi-field-label">Irrigation
                <select value={irrigation} onChange={(event) => setIrrigation(event.target.value)}>
                  <option value="rainfed">Rainfed only</option>
                  <option value="limited">Limited irrigation (about 200 mm per crop)</option>
                  <option value="good">Reliable irrigation</option>
                </select>
              </label>

              <div className="vi-panel-divider"/>
              <div className="vi-panel-heading"><span className="vi-section-number">03</span><div><small>WHAT YOU GROW NOW</small><h2>Current rotation</h2></div></div>
              <p className="sh-form-help">Pick 2–4 crops in the order you grow them, repeating cycle.</p>
              <div className="ro-slots">
                {existing.map((value, index) => (
                  <label key={index}>{slotLabel(index, seasonsPerYear)}
                    <select className="ro-select" value={value} onChange={(event) => setExisting(existing.map((v, i) => (i === index ? event.target.value : v)))}>
                      <option value="">— none —</option>
                      {CROPS.map((crop) => <option key={crop.id} value={crop.id}>{crop.name}</option>)}
                    </select>
                  </label>
                ))}
              </div>

              <div className="vi-panel-divider"/>
              <div className="vi-panel-heading"><span className="vi-section-number">04</span><div><small>WHAT MATTERS TO YOU</small><h2>Your priorities</h2></div></div>
              <div className="ro-sliders">
                {PRIORITY_ROWS.map((row) => (
                  <label className="ro-slider-row" key={row.key}>
                    <div><span>{row.label}</span><strong>{priorities[row.key]} / 5</strong></div>
                    <input type="range" min="1" max="5" step="1" value={priorities[row.key]} onChange={(event) => setPriorities({ ...priorities, [row.key]: Number(event.target.value) })}/>
                    <small>{row.hint}</small>
                  </label>
                ))}
              </div>

              <div className="vi-panel-divider"/>
              <div className="vi-panel-heading"><span className="vi-section-number">05</span><div><small>OPTIONAL DETAILS</small><h2>Market, machinery, soil</h2></div></div>
              <p className="sh-form-help">Crops you can sell locally (leave empty if unsure):</p>
              <div className="ro-chips">{CASH_CROPS.map((crop) => <label key={crop.id} className={`ro-chip ${marketCrops.includes(crop.id) ? "on" : ""}`}><input type="checkbox" checked={marketCrops.includes(crop.id)} onChange={() => toggle(marketCrops, setMarketCrops, crop.id)}/>{crop.name.split(" (")[0]}</label>)}</div>
              <label className="vi-check-row"><input type="checkbox" checked={specifyEquipment} onChange={(event) => setSpecifyEquipment(event.target.checked)}/><span>I will list my equipment<small>Otherwise equipment fit is left neutral.</small></span></label>
              {specifyEquipment && <div className="ro-equip">{EQUIPMENT.map((item) => <label key={item.id}><input type="checkbox" checked={equipment.includes(item.id)} onChange={() => toggle(equipment, setEquipment, item.id)}/>{item.label}</label>)}</div>}
              <label className="vi-check-row"><input type="checkbox" checked={useSoil} onChange={(event) => setUseSoil(event.target.checked)}/><span>Use soil data<small>Fetches mapped soil properties, NASA soil-water history and your saved soil test. If one service fails, scoring continues with the remaining inputs.</small></span></label>

              <button type="button" className="vi-run-button" onClick={runAnalysis} disabled={loading || !selectedField}><Icon name={loading ? "refresh" : "rotate"} size={17}/>{loading ? "Comparing rotations…" : "Compare rotations"}</button>
              {error && <div className="vi-error" role="alert"><Icon name="info" size={17}/><span>{error}</span></div>}
              <div className="vi-source-note"><Icon name="info" size={15}/><p>Crop values are approximate, general agronomic guidance, not local recommendations. Scores rank options; they do not predict yield or profit.</p></div>
            </aside>

            <section className="vi-results-area">
              {loading && <section className="vi-analysis-progress" role="status" aria-live="polite"><div className="vi-progress-head"><span className="vi-progress-orbit"><span/><i/></span><div><span className="vi-overline">AGRIMETRY IS COMPARING ROTATIONS</span><h2>{stage || "Working…"}</h2></div></div><p className="vi-progress-detail">Local climate, your soil and your priorities are combined to score each crop sequence.</p><div className="vi-progress-track" aria-hidden="true"><span/></div></section>}

              {!result ? (
                !loading && <div className="vi-wait-panel"><span className="vi-wait-mark"><Icon name="rotate" size={22}/></span><div><strong>Your rotation comparison will appear here.</strong><p>Enter your current rotation and priorities, then compare. You will see your rotation next to the best alternatives with every score explained.</p></div></div>
              ) : (
                <>
                  <div className="vi-result-heading"><div><span className="vi-overline">06 / ROTATION COMPARISON</span><h2>{selectedName}</h2><p>{result.climate.startYear}–{result.climate.endYear} climate · {seasonsPerYear === 1 ? "one crop per year" : "two crops per year"} · {irrigation === "rainfed" ? "rainfed" : irrigation === "limited" ? "limited irrigation" : "reliable irrigation"}</p></div><span className="vi-live-badge"><i/> COMPARISON READY</span></div>

                  {(result.strategies.notices || []).map((notice) => <div className="vi-error sh-notice" role="status" key={notice}><Icon name="info" size={17}/><span>{notice}</span></div>)}
                  {result.strategies.message && <div className="vi-error sh-notice" role="status"><Icon name="info" size={17}/><span>{result.strategies.message}</span></div>}
                  {result.soilInfo.note && <div className="sh-service-notice" role="status"><span className="sh-service-notice-icon"><Icon name="info" size={17}/></span><div><strong>{result.soilInfo.soilMoisture?.available && result.soilInfo.soilMoisture.kind === "wetness" ? "Using a broader NASA water dataset" : "Some environmental data could not be loaded"}</strong><p>{result.soilInfo.note} Rotation scoring continues with available inputs; missing soil properties remain unknown rather than being replaced with invented values.</p></div></div>}
                  {result.soilInfo.soilMoisture?.available && <section className="vi-story-panel sh-rotation-moisture"><div className="vi-story-intro"><span className="vi-story-leaf"><Icon name="droplets" size={21}/></span><div><span className="vi-overline">{result.soilInfo.soilMoisture.kind === "smap" ? "NASA SMAP · LANDSCAPE WATER MEMORY" : "NASA POWER · LANDSCAPE WETNESS CONTEXT"}</span><h2>{result.soilInfo.soilMoisture.story?.headline || "Recent soil-water context"}</h2><p>{result.soilInfo.soilMoisture.story?.observations?.join(" ") || "Recent surface and root-zone moisture estimates add context to this field's wider landscape."}</p></div></div><p className="vi-method-note">This approximately {Math.round((result.soilInfo.soilMoisture.source?.nativeResolutionMetres || 9000) / 1000)} km gridded water estimate is shown as context only. It does not replace pH, texture or bulk-density inputs and is not used as a soil-fit score.</p></section>}

                  {best && current && (
                    <section className="vi-story-panel"><div className="vi-story-intro"><span className="vi-story-leaf"><Icon name="rotate" size={21}/></span><div><span className="vi-overline">SUMMARY</span><h2>{best.total > current.total + 3 ? "A different rotation scores higher for your priorities" : "Your rotation is already close to the best options"}</h2><p>Your current rotation scores <strong>{current.total.toFixed(0)}</strong> out of 100. The top alternative, <strong>{best.crops.join(" → ")}</strong>, scores <strong>{best.total.toFixed(0)}</strong>. Scores compare options for your own priorities and local conditions; open each card for the reasons, risks and missing information.</p></div></div></section>
                  )}

                  <section className="vi-white-panel">
                    <div className="vi-panel-title"><div><span className="vi-overline">07 / OPTIONS SIDE BY SIDE</span><h2>{rows.length} rotation strategies</h2><p>Select a card to see its schedule and explanation. All totals use your priorities.</p></div></div>
                    <div className="ro-compare">
                      {rows.map((row, index) => (
                        <button type="button" key={row.label} className={`ro-card ${selected === index ? "active" : ""}`} onClick={() => setSelected(index)}>
                          <span className={`ro-badge ${row === current ? "current" : ""}`}>{row === current ? "CURRENT" : `#${rows.filter((r) => r !== current).indexOf(row) + 1}`}</span>
                          <span className="ro-card-label">{row.label}</span>
                          <span className="ro-card-score">{row.total.toFixed(0)}<small> / 100</small></span>
                          <span className="ro-card-seq">{row.crops.map((c) => c.split(" (")[0]).join(" → ")}</span>
                        </button>
                      ))}
                    </div>
                    <div className="ro-bars">
                      {CRITERIA.map((criterion) => (
                        <div className="ro-bar-row" key={criterion.key}>
                          <span>{criterion.label}</span>
                          <div className="ro-bar-set">{rows.map((row, index) => <div className="ro-bar" key={row.label}><span style={{ width: `${row.scores[criterion.key]}%`, background: STRATEGY_COLORS[index % STRATEGY_COLORS.length] }}/><em>{row.scores[criterion.key]}</em></div>)}</div>
                        </div>
                      ))}
                    </div>
                    <div className="ro-bar-legend">{rows.map((row, index) => <span key={row.label}><b className="ws-dot" style={{ background: STRATEGY_COLORS[index % STRATEGY_COLORS.length] }}/> {row.label}</span>)}</div>
                  </section>

                  {chosen && (
                    <>
                      <section className="vi-white-panel">
                        <div className="vi-panel-title"><div><span className="vi-overline">08 / {chosen.label.toUpperCase()}</span><h2>{chosen.crops.map((c) => c.split(" (")[0]).join(" → ")}</h2><p>Total {chosen.total.toFixed(0)} / 100. The cycle repeats after the last crop.</p></div></div>
                        <div className="vi-table-scroll"><table><thead><tr><th>Slot</th><th>When</th><th>Crop</th><th>Sow – harvest</th><th>Climate fit</th><th>Soil fit</th><th>Rain vs need</th><th>Nitrogen</th></tr></thead><tbody>{chosen.schedule.map((s) => <tr key={s.slot}><td>{s.slot}</td><td>{s.season}</td><td>{s.crop}</td><td>{s.sow ? `${s.sow} – ${s.harvest}` : "—"}</td><td>{s.climateFit}%</td><td>{s.soilFit === null ? "unknown" : `${s.soilFit}%`}</td><td>{s.rainMm === null ? "—" : `${s.rainMm} / ${s.needMm} mm`}</td><td>{s.nitrogen}</td></tr>)}</tbody></table></div>
                        <small className="vi-method-note">Sowing months are the best-matching window for local temperature and rainfall, not a planting recommendation for a specific variety. Rain is the monthly average over the growing months.</small>
                      </section>

                      <section className="vi-white-panel">
                        <div className="vi-panel-title"><div><span className="vi-overline">09 / WHY THIS SCORE</span><h2>Criterion by criterion</h2><p>Each criterion scores 0–100. Weight shows how much it counts, based on your priorities.</p></div></div>
                        <div className="ro-explain">{chosen.breakdown.map((item) => <div className="ro-explain-row" key={item.key}><b>{item.label}: {item.score}/100</b> <small>· weight {item.weight.toFixed(0)}%</small><br/>{item.explanation}</div>)}</div>
                        {weights && <div className="ro-weights">{CRITERIA.map((c) => <span key={c.key}>{c.label} {weights[c.key].toFixed(0)}%</span>)}</div>}
                      </section>

                      <section className="vi-white-panel">
                        <div className="ro-lists">
                          <div className="ro-list benefits"><h3>Benefits</h3>{chosen.benefits.length ? <ul>{chosen.benefits.map((b) => <li key={b}>{b}</li>)}</ul> : <p className="bf-empty">No standout benefit for your priorities.</p>}</div>
                          <div className="ro-list risks"><h3>Risks</h3>{chosen.risks.length ? <ul>{chosen.risks.map((b) => <li key={b}>{b}</li>)}</ul> : <p className="bf-empty">No major risk flagged by the available data.</p>}</div>
                          <div className="ro-list missing"><h3>Missing information</h3><ul>{chosen.missing.map((b) => <li key={b}>{b}</li>)}</ul></div>
                        </div>
                      </section>
                    </>
                  )}

                  <section className="vi-white-panel"><div className="vi-panel-title"><div><span className="vi-overline">10 / LOCAL CLIMATE USED</span><h2>Rainfall and temperature by month</h2><p>Average {result.climate.startYear}–{result.climate.endYear} for your field&apos;s NASA POWER grid cell. {result.climate.annualRainMm.toFixed(0)} mm per year. Warm season starts in {MONTH_NAMES[result.climate.warmStart]}.</p></div></div><ClimateStrip climate={result.climate}/></section>

                  <section className="vi-caveats"><div><span className="vi-overline">READ THE RESULTS RESPONSIBLY</span><h3>What this can—and cannot—tell you.</h3></div><ul>
                    <li>Crop requirements are generalised values (growing length, temperature, water use, pH, texture, nitrogen) and vary with variety, management and local conditions. Validate any recommendation with local agricultural advice before changing your rotation.</li>
                    <li>Scores rank options against each other. They do not forecast yield, profit or market prices; market fit only uses the crops you said you can sell.</li>
                    <li>Climate is a 25-year monthly average from NASA POWER (about 50 km grid). Year-to-year variation, frost, heat spikes and flood risk are not modelled.</li>
                    <li>Rotations are compared as fixed cycles with one crop per season slot. Intercropping, relay cropping, perennials, tillage and fertiliser practice are not modelled.</li>
                    <li>Green-manure and fodder crops are limited to one per cycle so suggestions remain productive. Soil nutrients (N, P, K) and salinity are not assessed.</li>
                    <li>Soil compatibility uses available SoilGrids mapped properties (250 m) and any soil test you entered. NASA soil-water estimates are separate landscape-scale context and is not substituted for pH, texture or bulk density. A recent test from your own field is more reliable.</li>
                  </ul></section>
                  <div className="vi-source-footer"><span>DATA: NASA POWER (MERRA-2) · NASA SMAP · ISRIC SOILGRIDS · GENERAL CROP GUIDANCE (FAO-STYLE)</span><span>{result.strategies.candidateCount?.toLocaleString()} valid crop sequences evaluated.</span><Link href="/explore/soil-health">Edit soil test <Icon name="external" size={12}/></Link></div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
