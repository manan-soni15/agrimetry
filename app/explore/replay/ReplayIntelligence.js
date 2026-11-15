"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { area as calculateArea } from "@turf/area";
import { CROPS } from "@/lib/rotation/crops";
import { buildClimate, evaluateRotation, FULL_WATER_COVERAGE, makeContext } from "@/lib/rotation/engine";
import { applyScenario, buildSeries, climateTrends, RATINGS, replayRotation, SCENARIO_PRESETS, scenarioMatrix } from "@/lib/replay/analysis";

const FIELDS_KEY = "agrimetry:global-farm-map:v1";
const SELECTED_FIELD_KEY = "agrimetry:vegetation:selected-field:v1";
const LAST_ROTATION_KEY = "agrimetry:rotation:last:v1";
const RATING_COLORS = ["#c2412f", "#e0b43a", "#4a7046"];
const MAX_ROTATIONS = 3;

function Icon({ name, size = 18 }) {
  const paths = {
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
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
function fieldCentre(feature) {
  const geometry = feature?.geometry;
  const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
  const points = polygons.flatMap((polygon) => polygon?.[0] || []);
  if (!points.length) return null;
  const lons = points.map((p) => Number(p[0]));
  const lats = points.map((p) => Number(p[1]));
  return { longitude: (Math.min(...lons) + Math.max(...lons)) / 2, latitude: (Math.min(...lats) + Math.max(...lats)) / 2 };
}
const pct = (value) => (Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—");
const shortName = (name) => name.split(" (")[0];
const emptyRotation = (label) => ({ label, slots: ["", "", "", ""] });

function SeasonChart({ seasons, selectedYear, onSelect }) {
  const width = 720, height = 200, left = 40, right = 12, top = 12, bottom = 28;
  const step = (width - left - right) / seasons.length;
  const max = Math.max(...seasons.map((s) => Math.max(s.supplyMm, s.needMm)), 100) * 1.1;
  const y = (v) => top + (1 - v / max) * (height - top - bottom);
  const need = seasons[0].needMm * FULL_WATER_COVERAGE;
  return (
    <svg className="vi-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Water supply each season compared with the crop water need">
      {[0, 0.5, 1].map((t) => <g key={t}><line x1={left} x2={width - right} y1={y(max * t)} y2={y(max * t)} stroke="#e6dece" strokeDasharray="4 6"/><text x={left - 6} y={y(max * t) + 4} textAnchor="end" fill="#8a927f" fontSize="10">{Math.round(max * t)}</text></g>)}
      {seasons.map((s, i) => (
        <g key={s.year} onClick={() => onSelect(s.year)} style={{ cursor: "pointer" }}>
          <rect x={left + step * i + step * 0.15} y={y(s.supplyMm)} width={step * 0.7} height={Math.max(0, height - bottom - y(s.supplyMm))} fill={RATING_COLORS[s.rating]} opacity={s.year === selectedYear ? 1 : 0.7} rx="2" stroke={s.year === selectedYear ? "#1f3d2b" : "none"} strokeWidth="2"><title>{s.year}: {Math.round(s.supplyMm)} mm usable water, {s.rating_label}</title></rect>
          {(i % 2 === 0 || seasons.length < 14) && <text x={left + step * i + step / 2} y={height - 10} textAnchor="middle" fill="#858c7c" fontSize="9">{String(s.year).slice(2)}</text>}
        </g>
      ))}
      <line x1={left} x2={width - right} y1={y(need)} y2={y(need)} stroke="#2f4d33" strokeWidth="1.6" strokeDasharray="6 4"/>
      <text x={width - right} y={y(need) - 4} textAnchor="end" fill="#2f4d33" fontSize="10">enough for a full score (~{Math.round(need)} mm)</text>
    </svg>
  );
}

function TrendChart({ years, valueKey, slope, unit, color, label }) {
  const width = 340, height = 130, left = 36, right = 8, top = 10, bottom = 22;
  if (years.length < 2) return null;
  const values = years.map((y) => y[valueKey]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.1 || 1;
  const x = (i) => left + (i / (years.length - 1)) * (width - left - right);
  const y = (v) => top + (1 - (v - (min - pad)) / (max - min + 2 * pad)) * (height - top - bottom);
  const n = years.length;
  const mx = (n - 1) / 2;
  const my = values.reduce((a, b) => a + b, 0) / n;
  const b = values.reduce((s, v, i) => s + (i - mx) * (v - my), 0) / values.reduce((s, _, i) => s + (i - mx) ** 2, 0);
  const trend = [my + b * (0 - mx), my + b * (n - 1 - mx)];
  return (
    <div className="rp-trend">
      <strong>{label}</strong>
      <svg className="vi-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label} by year`}>
        <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={color} strokeWidth="2"/>
        <line x1={x(0)} y1={y(trend[0])} x2={x(n - 1)} y2={y(trend[1])} stroke="#2f4d33" strokeDasharray="5 4" strokeWidth="1.5"/>
        {values.map((v, i) => <circle key={years[i].year} cx={x(i)} cy={y(v)} r="2.6" fill={color}><title>{years[i].year}: {v.toFixed(1)} {unit}</title></circle>)}
        <text x={left} y={height - 6} fill="#858c7c" fontSize="9">{years[0].year}</text>
        <text x={width - right} y={height - 6} textAnchor="end" fill="#858c7c" fontSize="9">{years[n - 1].year}</text>
        <text x={left - 4} y={top + 4} textAnchor="end" fill="#8a927f" fontSize="9">{Math.round(max)}</text>
        <text x={left - 4} y={height - bottom} textAnchor="end" fill="#8a927f" fontSize="9">{Math.round(min)}</text>
      </svg>
      <small>{Number.isFinite(slope) ? `Trend ${slope > 0 ? "+" : ""}${slope.toFixed(slope > 10 || slope < -10 ? 0 : 2)} ${unit} per decade (dashed)` : "Trend unavailable"}</small>
    </div>
  );
}

export default function ReplayIntelligence() {
  const [fields, setFields] = useState([]);
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [seasonsPerYear, setSeasonsPerYear] = useState(1);
  const [irrigation, setIrrigation] = useState("rainfed");
  const [rotations, setRotations] = useState([emptyRotation("Rotation A"), emptyRotation("Rotation B"), emptyRotation("Rotation C")]);
  const [scenario, setScenario] = useState({ rainPct: 0, tempDelta: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [base, setBase] = useState(null);
  const [tab, setTab] = useState(0);
  const [cell, setCell] = useState(null); // { cropIndex, year }
  const [loadedFromRotation, setLoadedFromRotation] = useState(false);
  const cache = useRef(new Map());

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(FIELDS_KEY) || "[]");
      const selectedField = JSON.parse(localStorage.getItem(SELECTED_FIELD_KEY) || "null");
      const safe = Array.isArray(stored) ? stored.filter((f) => ["Polygon", "MultiPolygon"].includes(f?.geometry?.type)) : [];
      if (selectedField?.geometry && !safe.some((f) => String(f.id) === String(selectedField.id))) safe.unshift(selectedField);
      setFields(safe);
      const id = selectedField?.geometry ? fieldKey(selectedField) : safe.length ? fieldKey(safe[0], 0) : "";
      setSelectedFieldId(id);
      const last = JSON.parse(localStorage.getItem(LAST_ROTATION_KEY) || "null");
      if (last?.strategies?.length && last.fieldId === id) {
        setSeasonsPerYear(last.seasonsPerYear === 2 ? 2 : 1);
        if (["rainfed", "limited", "good"].includes(last.irrigation)) setIrrigation(last.irrigation);
        setRotations(last.strategies.slice(0, MAX_ROTATIONS).map((item) => ({ label: item.label, slots: [...item.cropIds, "", "", "", ""].slice(0, 4) })).concat(Array.from({ length: Math.max(0, MAX_ROTATIONS - last.strategies.length) }, (_, i) => emptyRotation(`Rotation ${String.fromCharCode(65 + last.strategies.length + i)}`))));
        setLoadedFromRotation(true);
      }
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
    setBase(null);
    setError("");
    setLoadedFromRotation(false);
    if (feature) { try { localStorage.setItem(SELECTED_FIELD_KEY, JSON.stringify(feature)); } catch {} }
  }
  const setSlot = (rotationIndex, slotIndex, value) => setRotations(rotations.map((r, i) => (i === rotationIndex ? { ...r, slots: r.slots.map((s, j) => (j === slotIndex ? value : s)) } : r)));

  async function runReplay(event) {
    event?.preventDefault();
    const centre = selectedField ? fieldCentre(selectedField) : null;
    if (!centre) { setError("Choose or save a farm boundary on the Global Farm Map first."); return; }
    const chosen = rotations.map((r) => ({ label: r.label, ids: r.slots.filter(Boolean) })).filter((r) => r.ids.length >= 2);
    if (!chosen.length) { setError("Pick at least two crops for at least one rotation. You can also run the Rotation page first and come back here."); return; }
    if (seasonsPerYear === 2 && chosen.some((r) => r.ids.length % 2 !== 0)) { setError("With two crops per year, pick crops in pairs (warm season then cool season)."); return; }
    setLoading(true);
    setError("");
    setBase(null);
    try {
      const key = `${centre.latitude.toFixed(2)},${centre.longitude.toFixed(2)}`;
      let payload = cache.current.get(key);
      if (!payload) {
        const response = await fetch(`/api/climate-history?lat=${centre.latitude.toFixed(4)}&lon=${centre.longitude.toFixed(4)}`);
        payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `Climate history failed (HTTP ${response.status}).`);
        cache.current.set(key, payload);
      }
      const climate = buildClimate(payload.parameter, payload.startYear, payload.endYear);
      if (!climate) throw new Error("NASA POWER returned too little history for this location.");
      const series = buildSeries(payload.parameter, payload.startYear, payload.endYear, payload.daily);
      const ctx = makeContext({ climate, seasonsPerYear, irrigation });
      const evaluated = chosen.map((r) => {
        const result = evaluateRotation(r.ids, ctx, r.label);
        return { label: r.label, crops: result.crops, schedule: result.schedule };
      });
      setBase({ series, climate, rotations: evaluated, irrigation, startYear: payload.startYear, endYear: payload.endYear });
      setTab(0);
      setCell(null);
    } catch (runError) {
      setError(runError.message || "Unable to replay the rotations.");
    } finally {
      setLoading(false);
    }
  }

  const analysis = useMemo(() => {
    if (!base) return null;
    const scenarioSeries = applyScenario(base.series, scenario);
    const changed = Boolean(scenario.rainPct || scenario.tempDelta);
    const replays = base.rotations.map((r) => replayRotation(r.schedule, scenarioSeries, base.irrigation));
    const baseline = changed ? base.rotations.map((r) => replayRotation(r.schedule, base.series, base.irrigation)) : replays;
    const presets = SCENARIO_PRESETS.concat(changed ? [{ key: "custom", label: `Your scenario (${scenario.rainPct > 0 ? "+" : ""}${scenario.rainPct}% rain, +${scenario.tempDelta}°C)`, rainPct: scenario.rainPct, tempDelta: scenario.tempDelta }] : []);
    return { replays, baseline, changed, presets, matrix: scenarioMatrix(base.rotations, base.series, base.irrigation, presets), trends: climateTrends(base.series) };
  }, [base, scenario]);

  const activeReplay = analysis?.replays[tab];
  const activeCell = activeReplay && cell ? activeReplay.crops[cell.cropIndex]?.seasons.find((s) => s.year === cell.year) : null;
  const activeCrop = activeReplay && cell ? activeReplay.crops[cell.cropIndex] : activeReplay?.crops[0];
  const years = base ? Array.from({ length: base.endYear - base.startYear + 1 }, (_, i) => base.startYear + i) : [];

  return (
    <main className="vi-page">
      <header className="vi-header">
        <div className="vi-brand-wrap">
          <Link href="/explore/map" className="vi-back" aria-label="Back to global farm map"><Icon name="back" size={18}/></Link>
          <Link href="/" className="vi-brand"><span className="vi-brand-mark"><Icon name="clock" size={19}/></span><span>agrimetry<span>.</span></span></Link>
          <span className="vi-divider"/>
          <div className="vi-header-title"><small>DECISION SUPPORT</small><strong>Historical climate replay</strong></div>
        </div>
        <div className="vi-header-actions"><span className="vi-source-pill"><i/> NASA POWER · MANY YEARS</span><Link href="/explore/rotation" className="vi-explore-link">Rotation engine</Link><Link href="/explore/water-stress" className="vi-explore-link">Water stress</Link><Link href="/explore/passport" className="vi-explore-link">Evidence passport</Link></div>
      </header>

      <div className="vi-content">
        <section className="vi-intro">
          <div>
            <span className="vi-kicker"><span/> HISTORICAL CLIMATE REPLAY</span>
            <h1>How would these rotations have <em>fared</em> in the past?</h1>
            <p>Agrimetry replays each crop of a rotation against every year of real rainfall, temperature and soil wetness from 2001 onward, marks the seasons that were unfavourable, and lets you test drier or warmer futures. It shows how resilient each rotation is, not what yield it will give.</p>
          </div>
          <div className="vi-intro-note"><Icon name="clock" size={20}/><span>{CROPS.length} crops ·  years · what-if scenarios<br/><strong>Uses NASA POWER monthly data</strong></span></div>
        </section>

        {fields.length === 0 ? (
          <section className="vi-empty-state">
            <div className="vi-empty-icon"><Icon name="map" size={28}/></div>
            <div><span className="vi-kicker">NO SAVED FIELD FOUND</span><h2>Choose a field before replaying history.</h2><p>Go to the Global Farm Map, draw a boundary and save it, then come back here.</p><Link href="/explore/map" className="vi-primary-button">Open Global Farm Map <Icon name="external" size={15}/></Link></div>
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
              <div className="vi-panel-heading"><span className="vi-section-number">03</span><div><small>WHAT TO REPLAY</small><h2>Rotations to compare</h2></div></div>
              {loadedFromRotation ? <p className="sh-form-help">Loaded from your last comparison on the Rotation page. You can edit the crops.</p> : <p className="sh-form-help">Pick 2–4 crops per rotation, or run the <Link href="/explore/rotation">Rotation engine</Link> first and they will appear here.</p>}
              {rotations.map((rotation, rotationIndex) => (
                <div className="ro-slots" key={rotationIndex} style={{ marginBottom: 10 }}>
                  <strong style={{ fontSize: 11 }}>{rotation.label}</strong>
                  {rotation.slots.map((value, slotIndex) => (
                    <label key={slotIndex}>{seasonsPerYear === 1 ? `Year ${slotIndex + 1}` : `Y${Math.floor(slotIndex / 2) + 1} ${slotIndex % 2 === 0 ? "warm" : "cool"}`}
                      <select className="ro-select" value={value} onChange={(event) => setSlot(rotationIndex, slotIndex, event.target.value)}>
                        <option value="">— none —</option>
                        {CROPS.map((crop) => <option key={crop.id} value={crop.id}>{crop.name}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              ))}

              <button type="button" className="vi-run-button" onClick={runReplay} disabled={loading || !selectedField}><Icon name={loading ? "refresh" : "clock"} size={17}/>{loading ? "Replaying history…" : "Replay history"}</button>
              {error && <div className="vi-error" role="alert"><Icon name="info" size={17}/><span>{error}</span></div>}

              {base && (
                <>
                  <div className="vi-panel-divider"/>
                  <div className="vi-panel-heading"><span className="vi-section-number">04</span><div><small>WHAT-IF</small><h2>Test a scenario</h2></div></div>
                  <div className="rp-sliders">
                    <label className="ro-slider-row"><div><span>Rainfall change</span><strong>{scenario.rainPct > 0 ? "+" : ""}{scenario.rainPct}%</strong></div><input type="range" min="-50" max="30" step="5" value={scenario.rainPct} onChange={(event) => setScenario({ ...scenario, rainPct: Number(event.target.value) })}/></label>
                    <label className="ro-slider-row"><div><span>Warmer by</span><strong>+{scenario.tempDelta.toFixed(1)}°C</strong></div><input type="range" min="0" max="4" step="0.5" value={scenario.tempDelta} onChange={(event) => setScenario({ ...scenario, tempDelta: Number(event.target.value) })}/></label>
                  </div>
                  <p className="rp-scenario-note">The change is applied to every month of all years. It does not model changed rainfall patterns, extremes or crop adaptation.</p>
                </>
              )}
              <div className="vi-source-note"><Icon name="info" size={15}/><p>Seasons are rated from monthly climate and approximate crop values. A rating says how favourable the weather was, not what yield you would have had.</p></div>
            </aside>

            <section className="vi-results-area">
              {loading && <section className="vi-analysis-progress" role="status" aria-live="polite"><div className="vi-progress-head"><span className="vi-progress-orbit"><span/><i/></span><div><span className="vi-overline">AGRIMETRY IS REPLAYING HISTORY</span><h2>Loading years of climate</h2></div></div><div className="vi-progress-track" aria-hidden="true"><span/></div></section>}

              {!analysis ? (
                !loading && <div className="vi-wait-panel"><span className="vi-wait-mark"><Icon name="clock" size={22}/></span><div><strong>Your climate replay will appear here.</strong><p>Choose rotations and replay history. You will see which past seasons were favourable or not for every crop, then can try drier or warmer scenarios.</p></div></div>
              ) : (
                <>
                  <div className="vi-result-heading"><div><span className="vi-overline">05 / REPLAY RESULTS</span><h2>{selectedName}</h2><p>{base.startYear}–{base.endYear} · {irrigation === "rainfed" ? "rainfed" : irrigation === "limited" ? "limited irrigation" : "reliable irrigation"}{analysis.changed ? ` · scenario: ${scenario.rainPct > 0 ? "+" : ""}${scenario.rainPct}% rain, +${scenario.tempDelta}°C` : ""}</p></div><span className="vi-live-badge"><i/> REPLAY READY</span></div>

                  <section className="vi-white-panel">
                    <div className="vi-panel-title"><div><span className="vi-overline">06 / HOW RESILIENT IS EACH ROTATION</span><h2>Past seasons, side by side</h2><p>Every crop season in every year was rated Favourable, Marginal or Unfavourable{analysis.changed ? ". Brackets show how your scenario changes the history" : ""}.</p></div></div>
                    <div className="vi-table-scroll"><table><thead><tr><th>Rotation</th><th>Crops</th><th>Seasons rated</th><th>Favourable</th><th>Unfavourable</th><th>Bad years</th><th>Weakest crop</th></tr></thead><tbody>
                      {base.rotations.map((rotation, i) => {
                        const s = analysis.replays[i].summary;
                        const b = analysis.baseline[i].summary;
                        const d = (now, was) => (analysis.changed ? ` (was ${pct(was)})` : "");
                        return <tr key={rotation.label}><td><strong>{rotation.label}</strong></td><td>{rotation.crops.map(shortName).join(" → ")}</td><td>{s.seasonsAnalysed}</td><td>{pct(s.favourableShare)}{d(s.favourableShare, b.favourableShare)}</td><td>{pct(s.unfavourableShare)}{d(s.unfavourableShare, b.unfavourableShare)}</td><td>{s.badYears.length}{analysis.changed ? ` (was ${b.badYears.length})` : ""}</td><td>{s.worstCrop ? `${shortName(s.worstCrop.name)} (${pct(s.worstCrop.unfavourableShare)} unfavourable)` : "none"}</td></tr>;
                      })}
                    </tbody></table></div>
                    <small className="vi-method-note">A bad year is one where at least half of the rotation&apos;s crops had an unfavourable season. Crops are replayed independently of their position in the cycle.</small>
                  </section>

                  <section className="vi-white-panel">
                    <div className="vi-panel-title"><div><span className="vi-overline">07 / INTERACTIVE TIMELINE</span><h2>Crop by crop, year by year</h2><p>Select a rotation, then click a season to see why it was rated that way.</p></div></div>
                    <div className="rp-tabs">{base.rotations.map((r, i) => <button type="button" key={r.label} className={`rp-tab ${tab === i ? "active" : ""}`} onClick={() => { setTab(i); setCell(null); }}>{r.label}</button>)}</div>
                    <div className="rp-grid-wrap"><div className="rp-grid" style={{ "--years": years.length }}>
                      <div className="rp-row"><span/>{years.map((year) => <span className="rp-year" key={year}>{String(year).slice(2)}</span>)}</div>
                      {activeReplay.crops.map((crop, cropIndex) => (
                        <div className="rp-row" key={crop.cropId + crop.sowMonth}>
                          <span className="rp-row-label">{shortName(crop.name)}</span>
                          {years.map((year) => {
                            const season = crop.seasons.find((s) => s.year === year);
                            if (!season) return <span className="rp-cell empty" key={year} title="Season runs beyond the data"/>;
                            const selected = cell?.cropIndex === cropIndex && cell?.year === year;
                            return <button type="button" key={year} className={`rp-cell ${selected ? "selected" : ""}`} style={{ background: RATING_COLORS[season.rating] }} title={`${year}: ${season.rating_label}`} aria-label={`${shortName(crop.name)} ${year}: ${season.rating_label}`} onClick={() => setCell({ cropIndex, year })}/>;
                          })}
                        </div>
                      ))}
                    </div></div>
                    <div className="rp-legend">{RATINGS.map((label, i) => <span key={label}><b className="ws-dot" style={{ background: RATING_COLORS[i] }}/> {label}</span>)}<span><b className="ws-dot" style={{ background: "#eee7d6" }}/> Season runs past the data</span></div>

                    {activeCell ? (
                      <div className="rp-detail">
                        <h3>{shortName(activeCrop.name)}, {activeCell.label}: {activeCell.rating_label} ({Math.round(activeCell.fit * 100)}% match)</h3>
                        Usable water {Math.round(activeCell.supplyMm)} mm against a typical need of about {Math.round(activeCell.needMm)} mm ({pct(activeCell.coverage)}). Average temperature {activeCell.tempMean.toFixed(1)}°C. {activeCell.causes.length ? `What went wrong: ${activeCell.causes.join("; ")}.` : "No limiting factor stood out."}
                        {activeCell.extremes && <><br/>Daily extremes: {activeCell.extremes.hotDays} day{activeCell.extremes.hotDays === 1 ? "" : "s"} at or above {activeCell.extremes.heatThreshold}°C (a heat-stress rule of thumb for this crop) and a longest dry spell of {activeCell.extremes.longestDrySpell} day{activeCell.extremes.longestDrySpell === 1 ? "" : "s"}{activeCell.extremes.longDrySpell ? " in a season that normally has rain" : ""}.</>}
                        {activeCell.wetnessAnomaly !== null && <><br/>Root-zone soil wetness averaged {activeCell.wetness.toFixed(2)}, {activeCell.wetnessAnomaly >= 0 ? "above" : "below"} the usual {activeCell.wetnessNormal.toFixed(2)} for these months{analysis.changed ? " (observed history, not changed by the scenario)" : ""}.</>}
                      </div>
                    ) : <div className="rp-detail">Click a coloured square above to see the reasons for that season.</div>}

                    {activeCrop && activeCrop.seasons.length > 0 && (
                      <>
                        <h3 style={{ margin: "14px 0 0", fontSize: 13 }}>{shortName(activeCrop.name)}: water available each season</h3>
                        <SeasonChart seasons={activeCrop.seasons} selectedYear={cell?.cropIndex === activeReplay.crops.indexOf(activeCrop) ? cell.year : null} onSelect={(year) => setCell({ cropIndex: activeReplay.crops.indexOf(activeCrop), year })}/>
                      </>
                    )}
                  </section>

                  <section className="vi-white-panel vi-observation-table">
                    <div className="vi-panel-title"><div><span className="vi-overline">08 / CLIMATE SCENARIOS</span><h2>How each rotation responds to change</h2><p>Share of crop seasons that were not favourable, and average match, under each scenario applied to the same years.</p></div></div>
                    <div className="vi-table-scroll"><table className="rp-matrix"><thead><tr><th>Rotation</th>{analysis.presets.map((p) => <th key={p.key}>{p.label}</th>)}</tr></thead><tbody>
                      {analysis.matrix.map((row) => {
                        const baseCell = row.cells[0];
                        return <tr key={row.label}><td><strong>{row.label}</strong></td>{row.cells.map((c, i) => { const worse = i > 0 && c.notFavourableShare - baseCell.notFavourableShare > 0.1; return <td key={c.key} className={worse ? "bad" : ""}>{pct(c.notFavourableShare)} not favourable<small>match {Math.round(c.meanFit * 100)}% · {c.badYears} bad year{c.badYears === 1 ? "" : "s"}</small></td>; })}</tr>;
                      })}
                    </tbody></table></div>
                    <small className="vi-method-note">Red marks a scenario that raises the not-favourable share by more than 10 percentage points. A rotation that barely changes is more resilient to that kind of shift.</small>
                  </section>

                  <section className="vi-white-panel">
                    <div className="vi-panel-title"><div><span className="vi-overline">09 / HISTORICAL TRENDS</span><h2>Annual rainfall and temperature</h2><p>Yearly totals for your field&apos;s NASA POWER grid cell with a straight-line trend.</p></div></div>
                    <div className="rp-trends" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
                      <TrendChart years={analysis.trends.years} valueKey="rain" slope={analysis.trends.rainPerDecade} unit="mm" color="#4f86a8" label="Annual rainfall (mm)"/>
                      <TrendChart years={analysis.trends.years} valueKey="temp" slope={analysis.trends.tempPerDecade} unit="°C" color="#c2412f" label="Mean temperature (°C)"/>
                    </div>
                    <small className="vi-method-note">25 years is a short record and gridded model output can contain artefacts, so these trends describe the data here and are not a climate-change attribution.</small>
                  </section>

                  <section className="vi-caveats"><div><span className="vi-overline">READ THE RESULTS RESPONSIBLY</span><h3>What this can—and cannot—tell you.</h3></div><ul>
                    <li>Seasons are rated from monthly average temperature and rainfall plus approximate crop requirements. Heat waves, dry spells, storms, frost, pests and floods inside a month are not seen, so real bad seasons can be missed.</li>
                    <li>Ratings describe how favourable the weather was. They are not yield estimates, and they do not capture management, variety, soil or markets.</li>
                    <li>Scenarios shift every month by the same amount. They are simple sensitivity tests, not climate projections for your region.</li>
                    <li>Sowing windows come from the rotation engine&apos;s best match to average climate; a farmer may sow earlier or later.</li>
                    <li>NASA POWER values are gridded model estimates (about 50 km) and soil wetness is a MERRA-2 model value, not SMAP or a field measurement.</li>
                    <li>Validate any change to your rotation with local agricultural advice.</li>
                  </ul></section>
                  <div className="vi-source-footer"><span>DATA: NASA POWER (MERRA-2) · CROP VALUES: GENERAL FAO-STYLE GUIDANCE</span><span>{analysis.replays.reduce((s, r) => s + r.summary.seasonsAnalysed, 0)} crop seasons rated.</span><Link href="/explore/rotation">Open rotation engine <Icon name="external" size={12}/></Link></div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
