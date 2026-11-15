"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { area as calculateArea } from "@turf/area";

const FIELDS_KEY = "agrimetry:global-farm-map:v1";
const SELECTED_FIELD_KEY = "agrimetry:vegetation:selected-field:v1";
const MIN_SENTINEL_DATE = "2015-06-27";
const STATE_COLORS = { bare: "#8f552e", sparse: "#d6b04a", vegetated: "#4a7046", unknown: "#cfcabd" };
const STATE_LABELS = { bare: "Bare / very little green", sparse: "Sparse cover", vegetated: "Green cover", unknown: "No clear reading" };
const RISK_COLORS = { Low: "#6e925f", Moderate: "#e08a3c", High: "#c2412f" };

function Icon({ name, size = 18 }) {
  const paths = {
    soil: <><path d="M3 18h18M3 14c3-3 6 1 9-2s6 1 9-1"/><path d="M5 21h14"/></>,
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
function dateForInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function formatMonth(value) {
  if (!value) return "—";
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en", { month: "short", year: "2-digit", timeZone: "UTC" });
}
const rangeLabel = (start, end) => (start === end ? formatMonth(start) : `${formatMonth(start)} – ${formatMonth(end)}`);
const ndviText = (value) => (Number.isFinite(value) ? value.toFixed(2) : "—");
const mmText = (value) => (Number.isFinite(value) ? `${Math.round(value)} mm` : "—");

function CoverTimeline({ monthly }) {
  const width = 720, height = 220, left = 40, right = 14, top = 14, bottom = 62;
  const step = (width - left - right) / monthly.length;
  const x = (i) => left + step * i + step / 2;
  const y = (v) => top + (1 - Math.max(0, Math.min(0.9, v)) / 0.9) * (height - top - bottom);
  const segments = [];
  let seg = [];
  monthly.forEach((m, i) => {
    if (Number.isFinite(m.ndvi)) seg.push([x(i), y(m.ndvi)]);
    else if (seg.length) { segments.push(seg); seg = []; }
  });
  if (seg.length) segments.push(seg);
  return (
    <div className="vi-chart-wrap">
      <div className="vi-chart-legend">{Object.keys(STATE_COLORS).map((s) => <span key={s}><b className="ws-dot" style={{ background: STATE_COLORS[s] }}/> {STATE_LABELS[s]}</span>)}</div>
      <svg className="vi-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Monthly NDVI with bare-field classification">
        {[0, 0.2, 0.35, 0.6].map((t) => <g key={t}><line x1={left} x2={width - right} y1={y(t)} y2={y(t)} stroke={t === 0.2 || t === 0.35 ? "#c9b48a" : "#e6dece"} strokeDasharray="4 6"/><text x={left - 8} y={y(t) + 4} textAnchor="end" fill="#8a927f" fontSize="11">{t.toFixed(2)}</text></g>)}
        {segments.map((points, index) => points.length > 1 && <polyline key={index} points={points.map((p) => p.join(",")).join(" ")} fill="none" stroke="#315f3d" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>)}
        {monthly.map((m, i) => Number.isFinite(m.ndvi) && <circle key={m.month} cx={x(i)} cy={y(m.ndvi)} r="4" fill={STATE_COLORS[m.state]} stroke="#fbf9f3" strokeWidth="2"><title>{formatMonth(m.month)}: NDVI {ndviText(m.ndvi)} — {STATE_LABELS[m.state]}</title></circle>)}
        {monthly.map((m, i) => (
          <g key={`band-${m.month}`}>
            <rect x={left + step * i + 2} y={height - bottom + 12} width={step - 4} height="18" rx="4" fill={STATE_COLORS[m.state]} opacity={m.state === "unknown" ? 0.6 : 1}><title>{formatMonth(m.month)}: {STATE_LABELS[m.state]}</title></rect>
            <text x={x(i)} y={height - 14} textAnchor="middle" fill="#858c7c" fontSize="10">{formatMonth(m.month)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function buildStory(result) {
  const s = result.summary;
  if (!s.observedMonths) return { title: "Not enough clear observations", text: "No month had a usable Sentinel-2 reading, so bare periods cannot be assessed. Try a wider window or a higher cloud threshold." };
  if (!s.lowCoverMonths) return { title: "Green cover throughout", text: `All ${s.observedMonths} observed months showed green vegetation cover. No bare or low-cover period was detected in this window.` };
  const cycles = s.cropCycleCount ? `${s.cropCycleCount} green crop cycle${s.cropCycleCount === 1 ? "" : "s"} detected` : "no clear crop cycle detected";
  const gaps = s.gapBetweenCyclesCount ? ` ${s.gapBetweenCyclesCount} low-cover gap${s.gapBetweenCyclesCount === 1 ? "" : "s"} fall between crop cycles.` : "";
  return {
    title: s.lowCoverShare >= 0.6 ? "The field was mostly bare or sparse" : "Some months with little green cover",
    text: `${s.lowCoverMonths} of ${s.observedMonths} observed months showed bare or sparse cover; ${cycles}.${gaps} Whether these are normal fallow periods or a chance to protect the soil depends on your crop calendar.`,
  };
}

export default function BareFieldIntelligence() {
  const [fields, setFields] = useState([]);
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [todayDate, setTodayDate] = useState("");
  const [cloudLimit, setCloudLimit] = useState(70);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

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
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 12);
    start.setDate(start.getDate() + 1);
    setEndDate(dateForInput(end));
    setTodayDate(dateForInput(end));
    setStartDate(dateForInput(start));
  }, []);

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
  const story = result ? buildStory(result) : null;

  async function runAnalysis(event) {
    event?.preventDefault();
    if (!selectedField) { setError("Choose or save a farm boundary on the Global Farm Map first."); return; }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/bare-field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: selectedField, startDate, endDate, cloudLimit: Number(cloudLimit) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Bare-field analysis failed (HTTP ${response.status}).`);
      if (!payload?.summary || !Array.isArray(payload?.monthly)) throw new Error("The analysis returned an incomplete report. Please try again.");
      setResult(payload);
    } catch (requestError) {
      setError(requestError.message || "Unable to run the bare-field analysis.");
    } finally {
      setLoading(false);
    }
  }

  function selectField(id) {
    const feature = fields.find((item, index) => fieldKey(item, index) === id);
    setSelectedFieldId(id);
    setResult(null);
    setError("");
    if (feature) { try { localStorage.setItem(SELECTED_FIELD_KEY, JSON.stringify(feature)); } catch {} }
  }

  const s = result?.summary;
  return (
    <main className="vi-page">
      <header className="vi-header">
        <div className="vi-brand-wrap">
          <Link href="/explore/map" className="vi-back" aria-label="Back to global farm map"><Icon name="back" size={18}/></Link>
          <Link href="/" className="vi-brand"><span className="vi-brand-mark"><Icon name="soil" size={19}/></span><span>agrimetry<span>.</span></span></Link>
          <span className="vi-divider"/>
          <div className="vi-header-title"><small>FIELD INTELLIGENCE</small><strong>Bare-field detection</strong></div>
        </div>
        <div className="vi-header-actions"><span className="vi-source-pill"><i/> SENTINEL-2 · NASA POWER</span><Link href="/explore/vegetation" className="vi-explore-link">Vegetation</Link><Link href="/explore/water-stress" className="vi-explore-link">Water stress</Link><Link href="/explore/soil-health" className="vi-explore-link">Soil health</Link></div>
      </header>

      <div className="vi-content">
        <section className="vi-intro">
          <div>
            <span className="vi-kicker"><span/> AUTOMATIC BARE-FIELD DETECTION</span>
            <h1>Find when your soil was <em>left uncovered</em>.</h1>
            <p>Agrimetry reads a year of Sentinel-2 vegetation observations for your field, finds bare and low-cover periods, separates the gaps between crop cycles, and points out where a cover crop or residue mulch could protect the soil. Rainfall from NASA POWER shows when exposed soil was also getting wet.</p>
          </div>
          <div className="vi-intro-note"><Icon name="soil" size={20}/><span>Sentinel-2 NDVI + NASA POWER rainfall<br/><strong>No account or API key needed</strong></span></div>
        </section>

        {fields.length === 0 ? (
          <section className="vi-empty-state">
            <div className="vi-empty-icon"><Icon name="map" size={28}/></div>
            <div><span className="vi-kicker">NO SAVED FIELD FOUND</span><h2>Choose a field before analysing cover.</h2><p>Go to the Global Farm Map, draw a boundary and save it, then come back here.</p><Link href="/explore/map" className="vi-primary-button">Open Global Farm Map <Icon name="external" size={15}/></Link></div>
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
              <div className="vi-cloud-control"><div><label htmlFor="bf-cloud-limit">Scene cloud threshold</label><strong>{cloudLimit}%</strong></div><input id="bf-cloud-limit" type="range" min="10" max="90" step="5" value={cloudLimit} onChange={(event) => setCloudLimit(event.target.value)}/><small>A higher limit gives more months with a reading, but clearer scenes are preferred automatically.</small></div>
              <button type="button" className="vi-run-button" onClick={runAnalysis} disabled={loading || !selectedField || !startDate || !endDate}><Icon name={loading ? "refresh" : "soil"} size={17}/>{loading ? "Analysing…" : "Detect bare periods"}</button>
              {error && <div className="vi-error" role="alert"><Icon name="info" size={17}/><span>{error}</span></div>}
              <div className="vi-source-note"><Icon name="info" size={15}/><p>Bare periods are inferred from low NDVI (below 0.20 bare, 0.20–0.35 sparse). NDVI cannot tell bare soil from stubble, fallow, water or a newly sown crop, so always check against your crop calendar.</p></div>
            </aside>

            <section className="vi-results-area">
              {loading && <section className="vi-analysis-progress" role="status" aria-live="polite"><div className="vi-progress-head"><span className="vi-progress-orbit"><span/><i/></span><div><span className="vi-overline">AGRIMETRY IS READING YOUR FIELD</span><h2>Reading a year of satellite observations</h2></div><time>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</time></div><p className="vi-progress-detail">Finding Sentinel-2 scenes, masking clouds, calculating NDVI for each month and loading rainfall. This can take a minute or more.</p><div className="vi-progress-track" aria-hidden="true"><span/></div></section>}

              {!result ? (
                !loading && <div className="vi-wait-panel"><span className="vi-wait-mark"><Icon name="soil" size={22}/></span><div><strong>Your bare-field report will appear here.</strong><p>Choose a period (up to 12 months) and run the detection. It uses your saved field polygon.</p></div></div>
              ) : (
                <>
                  <div className="vi-result-heading"><div><span className="vi-overline">03 / YOUR COVER REPORT</span><h2>How covered was your soil?</h2><p>{result.period.startDate} to {result.period.endDate} · {s.observedMonths} of {s.totalMonths} months observed</p></div><span className="vi-live-badge"><i/> ANALYSIS COMPLETE</span></div>

                  <section className="vi-story-panel"><div className="vi-story-intro"><span className="vi-story-leaf"><Icon name="soil" size={21}/></span><div><span className="vi-overline">A FIELD NOTE FROM AGRIMETRY</span><h2>{story.title}</h2><p>{story.text}</p></div></div></section>

                  <div className="vi-metrics-grid">
                    <article className="vi-metric-card"><span>LOW-COVER MONTHS</span><strong>{s.lowCoverMonths} / {s.observedMonths}</strong><small>Observed months with NDVI below {result.thresholds.sparse}.</small></article>
                    <article className="vi-metric-card"><span>CROP CYCLES SEEN</span><strong>{s.cropCycleCount}</strong><small>Green stretches peaking above NDVI {result.thresholds.cropPeak}.</small></article>
                    <article className="vi-metric-card"><span>GAPS BETWEEN CYCLES</span><strong>{s.gapBetweenCyclesCount}</strong><small>Low-cover periods with crops before and after.</small></article>
                    <article className="vi-metric-card"><span>HIGH EROSION-EXPOSURE MONTHS</span><strong>{s.rainContextAvailable ? s.highErosionMonths : "—"}</strong><small>{s.rainContextAvailable ? "Low cover during heavy monthly rain." : "Rainfall context was unavailable."}</small></article>
                  </div>

                  <section className="vi-white-panel"><div className="vi-panel-title"><div><span className="vi-overline">04 / COVER TIMELINE</span><h2>Green cover, month by month</h2><p>The dashed lines mark the bare (0.20) and sparse (0.35) thresholds. Grey months had no clear satellite reading and are not assumed bare.</p></div></div><CoverTimeline monthly={result.monthly}/></section>

                  <div className="vi-analysis-grid">
                    <section className="vi-white-panel ws-decline-panel">
                      <span className="vi-overline">05 / BARE AND LOW-COVER PERIODS</span>
                      <h2>{result.periods.length ? `${result.periods.length} period${result.periods.length === 1 ? "" : "s"} found` : "No bare or low-cover period"}</h2>
                      {result.periods.length ? (
                        <ul className="ws-period-list">
                          {result.periods.map((p) => (
                            <li key={p.startMonth}>
                              <strong>{rangeLabel(p.startMonth, p.endMonth)} · {p.lengthMonths} month{p.lengthMonths === 1 ? "" : "s"}</strong>
                              <span>{p.betweenCropCycles ? "Gap between crop cycles" : p.kind === "starts-window" ? "Already low at the start of the window" : p.kind === "ends-window" ? "Low at the end of the window" : p.kind === "whole-window" ? "Low throughout the window" : "Low-cover period"} · lowest NDVI {ndviText(p.minNdvi)} · {p.bareMonths} bare, {p.sparseMonths} sparse{p.unobservedMonths ? ` · ${p.unobservedMonths} month${p.unobservedMonths === 1 ? "" : "s"} unobserved` : ""}{p.erosionRisk ? ` · erosion exposure ${p.erosionRisk}` : ""}</span>
                            </li>
                          ))}
                        </ul>
                      ) : <p>Every observed month showed green cover above the sparse threshold.</p>}
                    </section>
                    <section className="vi-white-panel ws-decline-panel">
                      <span className="vi-overline">06 / CROP CYCLES</span>
                      <h2>{result.cropCycles.length ? `${result.cropCycles.length} green cycle${result.cropCycles.length === 1 ? "" : "s"} detected` : "No clear crop cycle"}</h2>
                      {result.cropCycles.length ? (
                        <ul className="ws-period-list">{result.cropCycles.map((c) => <li key={c.startMonth}><strong>{rangeLabel(c.startMonth, c.endMonth)}</strong><span>Peak NDVI {ndviText(c.peakNdvi)} in {formatMonth(c.peakMonth)}</span></li>)}</ul>
                      ) : <p>No stretch of months reached an NDVI above {result.thresholds.cropPeak}. The field may have been fallow, sparsely cropped, or not seen clearly.</p>}
                      <small className="vi-method-note">A cycle is any run of green months whose peak NDVI reaches {result.thresholds.cropPeak}. Two crops grown back to back with no visible dip may appear as one cycle.</small>
                    </section>
                  </div>

                  <section className="vi-white-panel">
                    <div className="vi-panel-title"><div><span className="vi-overline">07 / SOIL-COVER OPPORTUNITIES</span><h2>{result.coverCropOpportunities.length ? "Where a cover could fit" : "No clear cover-crop window"}</h2><p>Gaps of {2}+ months between crop cycles are the best candidates for a cover crop or residue mulch.</p></div></div>
                    {result.coverCropOpportunities.length ? (
                      <div className="bf-opps">
                        {result.coverCropOpportunities.map((o) => (
                          <article className="bf-opp" key={o.startMonth}>
                            <div className="bf-opp-head"><strong>{rangeLabel(o.startMonth, o.endMonth)}</strong><span className={`bf-chip bf-priority-${o.priority.toLowerCase()}`}>{o.priority} priority</span></div>
                            <p>{o.advice}</p>
                            <small>{o.lengthMonths}-month gap · moisture: {o.moisture.replace("-", " ")}{o.erosionRisk ? ` · erosion exposure ${o.erosionRisk}` : ""}{o.partlyObserved ? " · partly observed" : ""}</small>
                          </article>
                        ))}
                      </div>
                    ) : <p className="bf-empty">A cover-crop window needs a low-cover gap of at least two months with a green crop before and after it. None was found in this period. Try a longer window if the field has a long fallow.</p>}
                  </section>

                  {result.erosion.length > 0 && (
                    <section className="vi-white-panel vi-observation-table"><div className="vi-panel-title"><div><span className="vi-overline">08 / EROSION EXPOSURE</span><h2>Uncovered soil and rain</h2></div><span className="vi-panel-stamp">Sentinel-2 + NASA POWER</span></div>
                      <div className="vi-table-scroll"><table><thead><tr><th>Month</th><th>Cover</th><th>NDVI</th><th>Rain</th><th>% of normal</th><th>Exposure</th></tr></thead><tbody>{result.erosion.map((e) => <tr key={e.month}><td>{formatMonth(e.month)}</td><td><b className="ws-dot" style={{ background: STATE_COLORS[e.state] }}/> {STATE_LABELS[e.state]}</td><td>{ndviText(e.ndvi)}</td><td>{mmText(e.rainMm)}</td><td>{Number.isFinite(e.rainRatio) ? `${Math.round(e.rainRatio * 100)}%` : "—"}</td><td>{e.level ? <><b className="ws-dot" style={{ background: RISK_COLORS[e.level] }}/> {e.level}</> : "—"}</td></tr>)}</tbody></table></div>
                      <small className="vi-method-note">Exposure rises with bare cover and with higher monthly rainfall. It ignores rain intensity, slope, soil type and tillage. {result.rainfall.note || ""}</small>
                    </section>
                  )}

                  <section className="vi-caveats"><div><span className="vi-overline">READ THE DATA RESPONSIBLY</span><h3>What this can—and cannot—tell you.</h3></div><ul>{result.caveats.map((item) => <li key={item}>{item}</li>)}</ul></section>
                  <div className="vi-source-footer"><span>DATA: COPERNICUS SENTINEL-2 L2A · NASA POWER</span><span>{result.ndviSource.attribution}</span><a href="https://power.larc.nasa.gov/docs/services/api/" target="_blank" rel="noreferrer">NASA POWER API <Icon name="external" size={12}/></a></div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
