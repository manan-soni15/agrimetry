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
  const showProfile = Boolean(layers) || hasFarmerValues;

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
      if (!payload?.layers) throw new Error("SoilGrids returned an incomplete report. Please try again.");
      setResult(payload);
    } catch (requestError) {
      setError(requestError.message || "Unable to retrieve SoilGrids information.");
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
      setResult((current) => {
        if (!current) return current;
        const merged = {};
        for (const key of Object.keys(current.layers)) {
          merged[key] = { ...current.layers[key] };
          for (const [label, entry] of Object.entries(payload.layers?.[key] || {})) merged[key][label] = { ...(merged[key][label] || {}), ...Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== null)) };
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
        <div className="vi-header-actions"><span className="vi-source-pill"><i/> ISRIC SOILGRIDS · YOUR SOIL TEST</span><Link href="/explore/vegetation" className="vi-explore-link">Vegetation</Link><Link href="/explore/water-stress" className="vi-explore-link">Water stress</Link><Link href="/explore/bare-field" className="vi-explore-link">Bare fields</Link><Link href="/explore/rotation" className="vi-explore-link">Rotation</Link></div>
      </header>

      <div className="vi-content">
        <section className="vi-intro">
          <div>
            <span className="vi-kicker"><span/> SOIL HEALTH INTELLIGENCE</span>
            <h1>Know the soil under your <em>next crop</em>.</h1>
            <p>Agrimetry looks up modelled soil properties for your field from ISRIC SoilGrids (organic carbon, pH, sand, silt, clay and bulk density down to 2 m), lets you add your own soil-test results, and explains what the soil means for crops and rotations, with the depth, resolution and uncertainty always shown.</p>
          </div>
          <div className="vi-intro-note"><Icon name="layers" size={20}/><span>ISRIC SoilGrids 2.0 · 250 m · 6 depths<br/><strong>No account or API key needed</strong></span></div>
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
              <button type="button" className="vi-run-button" onClick={runAnalysis} disabled={loading || !selectedField}><Icon name={loading ? "refresh" : "layers"} size={17}/>{loading ? "Asking SoilGrids…" : "Get soil profile"}</button>
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
              {loading && <section className="vi-analysis-progress" role="status" aria-live="polite"><div className="vi-progress-head"><span className="vi-progress-orbit"><span/><i/></span><div><span className="vi-overline">AGRIMETRY IS READING THE SOIL MAP</span><h2>Asking ISRIC SoilGrids for your field</h2></div><time>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</time></div><p className="vi-progress-detail">SoilGrids is a free research service and can take from a few seconds to about a minute. If your field sits on a cell with no estimate, Agrimetry tries nearby points.</p><div className="vi-progress-track" aria-hidden="true"><span/></div></section>}

              {!showProfile ? (
                !loading && <div className="vi-wait-panel"><span className="vi-wait-mark"><Icon name="layers" size={22}/></span><div><strong>Your Soil Intelligence Profile will appear here.</strong><p>Get the SoilGrids profile for your field, or just type in your own soil-test results on the left.</p></div></div>
              ) : (
                <>
                  <div className="vi-result-heading"><div><span className="vi-overline">03 / SOIL INTELLIGENCE PROFILE</span><h2>{selectedName}</h2><p>{layers ? `SoilGrids 2.0 (250 m)${result.sample?.where === "nearby" ? " · sampled just outside the field" : ""}` : "From your own soil test"}{hasFarmerValues ? " · with your soil-test values" : ""}</p></div><span className="vi-live-badge"><i/> {layers ? "PROFILE READY" : "YOUR TEST ONLY"}</span></div>

                  {layers && (!layers["30-60cm"] || !Number.isFinite(layers.soc?.["0-5cm"]?.low)) && (
                    <div className="vi-error sh-notice" role="status"><Icon name="info" size={17}/><span>Loaded quickly: topsoil averages only (SoilGrids answers slowly). {!layers["30-60cm"] && <button type="button" className="sh-link-button" onClick={() => loadMore("deep")} disabled={Boolean(deepLoading)}>{deepLoading === "deep" ? "Loading deeper layers…" : "Load deeper layers (30–200 cm)"}</button>} {!Number.isFinite(layers.soc?.["0-5cm"]?.low) && <button type="button" className="sh-link-button" onClick={() => loadMore("intervals")} disabled={Boolean(deepLoading)}>{deepLoading === "intervals" ? "Loading uncertainty ranges (up to a minute)…" : "Load uncertainty ranges (top 30 cm)"}</button>}{deepError ? " " + deepError : ""}</span></div>
                  )}
                  {result?.sample?.where === "nearby" && <div className="vi-error sh-notice" role="status"><Icon name="info" size={17}/><span>SoilGrids had no estimate inside your field, so these values come from a point about 300 m away. Treat them as a rough guide.</span></div>}

                  <div className="vi-metrics-grid">
                    <article className="vi-metric-card"><span>TEXTURE (TOPSOIL)</span><strong className="sh-metric-text">{profile.texture || "—"}</strong><small>{Number.isFinite(sand) ? `${sand.toFixed(0)}% sand · ${silt.toFixed(0)}% silt · ${clay.toFixed(0)}% clay` : "Needs sand, silt and clay."}</small></article>
                    <article className="vi-metric-card"><span>ORGANIC CARBON</span><strong>{profile.ratings.soc ? profile.ratings.soc.label : "—"}</strong><small>{profile.ratings.soc ? `${profile.ratings.soc.detail} (${profile.origin.soc === "farmer" ? "your test" : "SoilGrids"}).` : "No value available."}</small></article>
                    <article className="vi-metric-card"><span>SOIL pH</span><strong>{Number.isFinite(profile.effective.phh2o) ? profile.effective.phh2o.toFixed(1) : "—"}</strong><small>{profile.ratings.ph ? `${profile.ratings.ph.label}. ${profile.origin.phh2o === "farmer" ? "Your test." : "SoilGrids."}` : "No value available."}</small></article>
                    <article className="vi-metric-card"><span>BULK DENSITY</span><strong>{Number.isFinite(profile.effective.bdod) ? profile.effective.bdod.toFixed(2) : "—"}</strong><small>{profile.ratings.bulkDensity ? `${profile.ratings.bulkDensity.label} (kg/dm³). ${profile.origin.bdod === "farmer" ? "Your test." : "SoilGrids."}` : "No value available."}</small></article>
                  </div>

                  <section className="vi-white-panel">
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
                    ) : <p className="bf-empty">Based on the available values, organic carbon, pH and bulk density are within generally comfortable ranges and texture is not extreme. Soil tests can still reveal nutrient or salinity issues that these layers do not cover.</p>}
                  </section>

                  {layers && (
                    <>
                      <div className="vi-analysis-grid">
                        <section className="vi-white-panel"><div className="vi-panel-title"><div><span className="vi-overline">05 / TEXTURE BY DEPTH</span><h2>How sandy or clayey, down to 2 m</h2><p>Sand / silt / clay (%) for each SoilGrids layer.</p></div></div><TextureProfile layers={layers}/></section>
                        <section className="vi-white-panel sh-meta-panel"><span className="vi-overline">06 / HOW MUCH TO TRUST IT</span><h2>Resolution and uncertainty</h2>
                          <ul className="sh-meta-list">
                            <li><strong>Resolution:</strong> one prediction per {result.source.resolutionMetres} m cell (about {Math.round((result.source.resolutionMetres ** 2) / 100) / 100} ha).</li>
                            <li><strong>Depths:</strong> {DEPTHS.map((d) => depthText(d.label)).join(", ")}.</li>
                            <li><strong>Uncertainty:</strong> every value is shown with a 90% prediction interval; wide intervals mean low confidence.</li>
                            <li><strong>Sample point:</strong> {result.sample ? `${result.sample.latitude.toFixed(4)}, ${result.sample.longitude.toFixed(4)} (${result.sample.where === "nearby" ? "just outside the field" : "inside the field"})` : "—"}.</li>
                          </ul>
                          <small className="vi-method-note">{result.source.note} Licence: {result.source.license}.</small>
                        </section>
                      </div>

                      <section className="vi-white-panel vi-observation-table"><div className="vi-panel-title"><div><span className="vi-overline">07 / ALL LAYERS</span><h2>Values by depth</h2></div><span className="vi-panel-stamp">Mean (90% interval) · confidence</span></div>
                        <div className="vi-table-scroll"><table><thead><tr><th>Depth</th>{SOIL_PROPERTIES.map((p) => <th key={p.key}>{p.label}{p.unit ? ` (${p.unit})` : ""}</th>)}</tr></thead><tbody>{DEPTHS.map((depth) => <tr key={depth.label}><td>{depthText(depth.label)}</td>{SOIL_PROPERTIES.map((p) => { const entry = layers?.[p.key]?.[depth.label]; const conf = confidenceFor(p.key, entry); return <td key={p.key}>{Number.isFinite(entry?.mean) ? <>{fmt(entry.mean, p.decimals)} <small>({fmt(entry.low, p.decimals)}–{fmt(entry.high, p.decimals)})</small> {conf && <b className="ws-dot" title={`${conf} confidence`} style={{ background: LEVEL_COLORS[conf === "high" ? "good" : conf === "medium" ? "moderate" : "low"] }}/>}</> : "—"}</td>; })}</tr>)}</tbody></table></div>
                        <small className="vi-method-note">Dot colour: green = narrow interval (higher confidence), amber = medium, red = wide (low confidence). Organic carbon is shown in g/kg (10 g/kg = 1%).</small>
                      </section>
                    </>
                  )}

                  <section className="vi-caveats"><div><span className="vi-overline">READ THE DATA RESPONSIBLY</span><h3>What this can—and cannot—tell you.</h3></div><ul>{[...(result?.caveats || ["Soil-test results describe a sample, not the whole field; sampling depth and method matter.", "Interpretations are general guidance. Crop response depends on climate, management and local conditions."]), "Crop-by-crop suitability scoring is planned in the Crop Rotation Intelligence Engine; this profile feeds that engine."].map((item) => <li key={item}>{item}</li>)}</ul></section>
                  <div className="vi-source-footer"><span>DATA: ISRIC SOILGRIDS 2.0 · FARMER SOIL TEST</span><span>Poggio et al. (2021), SOIL 7, 217–240</span><a href="https://www.isric.org/explore/soilgrids" target="_blank" rel="noreferrer">ISRIC SoilGrids <Icon name="external" size={12}/></a></div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
