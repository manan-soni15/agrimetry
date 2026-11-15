"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { area as calculateArea } from "@turf/area";
import { buildPassport } from "@/lib/passport/build";
import { passportToMarkdown } from "@/lib/passport/export";
import { CROPS } from "@/lib/rotation/crops";

const FIELDS_KEY = "agrimetry:global-farm-map:v1";
const SELECTED_FIELD_KEY = "agrimetry:vegetation:selected-field:v1";
const TEST_KEY_PREFIX = "agrimetry:soil-test:v1:";
const INPUTS_KEY = "agrimetry:rotation:inputs:v1";
const CLASS_ORDER = ["satellite", "model", "farmer", "reference", "derived"];
const CROP_NAME = Object.fromEntries(CROPS.map((crop) => [crop.id, crop.name]));
const STATUS_TEXT = { idle: "Waiting", loading: "Loading…", done: "Loaded", failed: "Unavailable", skipped: "Skipped" };

function Icon({ name, size = 18 }) {
  const paths = {
    shield: <><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></>,
    back: <path d="m15 18-6-6 6-6"/>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-3"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></>,
    external: <><path d="M14 3h7v7m0-7-9 9"/><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15m6-12v15"/></>,
    download: <><path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M4 19h16"/></>,
    print: <><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.info}</svg>;
}

const fieldName = (feature, index = 0) => feature?.properties?.fieldName || feature?.properties?.name || `Field ${index + 1}`;
const fieldKey = (feature, index = 0) => String(feature?.id || feature?.properties?.fieldName || `field-${index}`);
function areaHectares(feature) {
  try { return calculateArea(feature) / 10000; } catch { return null; }
}
function areaLabel(feature) {
  const ha = areaHectares(feature);
  return Number.isFinite(ha) ? `${ha.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha · ${(ha * 2.47105).toLocaleString(undefined, { maximumFractionDigits: 2 })} acres` : "Area unavailable";
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
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : "n/a");
const dateInput = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function ClassBadge({ cls, classes }) {
  return <span className={`pp-badge pp-${cls}`} title={classes[cls]?.detail}>{classes[cls]?.label || cls}</span>;
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PassportEntry({ entry, passport, active }) {
  const classes = passport.classes;
  const sourceById = Object.fromEntries(passport.sources.map((s) => [s.id, s]));
  const h = entry.history.summary;
  const scenarioLabel = (key) => entry.history.scenarioLabels.find((l) => l.key === key)?.label || key;
  return (
    <article className={`pp-entry ${active ? "active" : ""}`} aria-hidden={!active}>
      <header className="pp-entry-head">
        <div>
          <span className={`pp-role pp-role-${entry.role}`}>{entry.role === "current" ? "Your current rotation (reference)" : "Suggested rotation"}</span>
          <h2>{entry.crops.map((c) => c.split(" (")[0]).join(" → ")}</h2>
          <p>{entry.label} · repeats after the last crop</p>
        </div>
        <div className="pp-score"><strong>{entry.total.toFixed(0)}</strong><span>/ 100</span></div>
      </header>

      <div className="vi-table-scroll"><table><thead><tr><th>Slot</th><th>When</th><th>Crop</th><th>Sow – harvest</th><th>Climate fit</th><th>Soil fit</th><th>Rain vs need</th></tr></thead><tbody>{entry.schedule.map((s) => <tr key={s.slot}><td>{s.slot}</td><td>{s.season}</td><td>{s.crop}</td><td>{s.sow ? `${s.sow} – ${s.harvest}` : "—"}</td><td>{s.climateFit}%</td><td>{s.soilFit === null ? "unknown" : `${s.soilFit}%`}</td><td>{s.rainMm === null ? "—" : `${s.rainMm} / ${s.needMm} mm`}</td></tr>)}</tbody></table></div>

      {entry.role === "recommended" && (
        <section className="pp-section">
          <h3><span>1</span> Why this rotation was suggested</h3>
          <ul className="pp-reasons">{entry.why.map((reason) => (
            <li key={reason.text}>
              <strong>{reason.criterion}</strong> <em>{reason.effect}</em>
              <p>{reason.text}</p>
              <div className="pp-chips">{reason.sources.map((id) => <span className={`pp-badge pp-${sourceById[id].class}`} key={id} title={sourceById[id].name}>{sourceById[id].name.split(" (")[0]}</span>)}</div>
            </li>
          ))}</ul>
        </section>
      )}

      <section className="pp-section">
        <h3><span>{entry.role === "recommended" ? 2 : 1}</span> Evidence behind each claim</h3>
        <p className="pp-lead">Every statement below is tagged with the kind of evidence it rests on. Satellite observations, modelled estimates and things you told us are never blended.</p>
        <div className="vi-table-scroll"><table className="pp-ledger"><thead><tr><th>Claim</th><th>Evidence</th><th>Kind of evidence</th></tr></thead><tbody>{entry.evidenceLedger.map((item) => (
          <tr key={item.claim}><td><strong>{item.claim}</strong></td><td>{item.evidence}</td><td>{item.classes.length ? item.classes.map((cls) => <ClassBadge key={cls} cls={cls} classes={classes}/>) : <span className="pp-muted">No data used</span>}</td></tr>
        ))}</tbody></table></div>
        <div className="pp-datasets"><strong>Datasets that supported this:</strong> {entry.supportingDatasets.map((d) => <span key={d.id} className={`pp-ds ${d.nasa ? "nasa" : ""}`}>{d.nasa ? "NASA · " : ""}{d.name}</span>)}</div>
      </section>

      <section className="pp-section">
        <h3><span>{entry.role === "recommended" ? 3 : 2}</span> Historical conditions considered</h3>
        <p className="pp-lead">{passport.climate.startYear}–{passport.climate.endYear}: about {Math.round(passport.climate.annualRainMm)} mm rain a year{passport.climate.aridity ? `, ${passport.climate.aridity.toLowerCase()} climate` : ""}, coldest month averaging {passport.climate.coldestMonthC.toFixed(0)} °C. Each crop season of this rotation was replayed against every past year of NASA POWER weather.</p>
        <div className="pp-stats"><div><span>Seasons replayed</span><strong>{h.seasonsAnalysed}</strong></div><div><span>Favourable</span><strong>{pct(h.favourableShare)}</strong></div><div><span>Unfavourable</span><strong>{pct(h.unfavourableShare)}</strong></div><div><span>Widespread bad years</span><strong>{h.badYears.length}{h.badYears.length ? <small> ({h.badYears.slice(0, 6).join(", ")}{h.badYears.length > 6 ? "…" : ""})</small> : ""}</strong></div></div>
        {h.worstCrop && <p className="pp-lead">Weakest crop in this rotation: <strong>{h.worstCrop.name}</strong>, unfavourable in {pct(h.worstCrop.unfavourableShare)} of past seasons.</p>}
        <div className="vi-table-scroll"><table><thead><tr><th>Scenario applied to all </th><th>Not favourable</th><th>Average match</th><th>Bad years</th></tr></thead><tbody>{entry.history.scenarios.map((c) => <tr key={c.key}><td>{scenarioLabel(c.key)}</td><td>{pct(c.notFavourableShare)}</td><td>{Math.round(c.meanFit * 100)}%</td><td>{c.badYears}</td></tr>)}</tbody></table></div>
      </section>

      <section className="pp-section">
        <h3><span>{entry.role === "recommended" ? 4 : 3}</span> Potential soil and water effects</h3>
        {entry.benefits.length || entry.tradeoffs.length ? (
          <div className="pp-two">
            <div className="pp-box good"><h4>Potential benefits</h4>{entry.benefits.length ? <ul>{entry.benefits.map((b) => <li key={b.text}><strong>{b.area}.</strong> {b.text}</li>)}</ul> : <p className="pp-muted">No clear benefit over your current rotation.</p>}</div>
            <div className="pp-box warn"><h4>Trade-offs</h4>{entry.tradeoffs.length ? <ul>{entry.tradeoffs.map((b) => <li key={b.text}><strong>{b.area}.</strong> {b.text}</li>)}</ul> : <p className="pp-muted">No clear trade-off against your current rotation.</p>}</div>
          </div>
        ) : <p className="pp-muted">No comparison is possible without a current rotation.</p>}
        <small className="vi-method-note">These are potential effects estimated from typical crop traits and your local climate. They are not measured changes in your soil or water use.</small>
      </section>

      <section className="pp-section">
        <h3><span>{entry.role === "recommended" ? 5 : 4}</span> Risks, uncertainties and gaps</h3>
        <div className="pp-three">
          <div className="pp-box warn"><h4>Possible risks</h4>{entry.risks.length ? <ul>{entry.risks.map((r) => <li key={r}>{r}</li>)}</ul> : <p className="pp-muted">No risk flagged by the available data.</p>}</div>
          <div className="pp-box"><h4>Uncertainties</h4><ul>{entry.uncertainties.map((r) => <li key={r}>{r}</li>)}</ul></div>
          <div className="pp-box gap"><h4>Missing information</h4><ul>{entry.missing.map((r) => <li key={r}>{r}</li>)}</ul></div>
        </div>
      </section>

      <section className="pp-section">
        <h3><span>{entry.role === "recommended" ? 6 : 5}</span> Validate locally before acting</h3>
        <p className="pp-lead">Questions to take to a local agronomist or extension officer:</p>
        <ol className="pp-questions">{entry.questions.map((q) => <li key={q}>{q}</li>)}</ol>
      </section>
    </article>
  );
}

export default function PassportIntelligence() {
  const [fields, setFields] = useState([]);
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [saved, setSaved] = useState(null);
  const [includeVegetation, setIncludeVegetation] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sources, setSources] = useState({});
  const [passport, setPassport] = useState(null);
  const [selected, setSelected] = useState(0);
  const skipVegetation = useRef(null);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(FIELDS_KEY) || "[]");
      const selectedField = JSON.parse(localStorage.getItem(SELECTED_FIELD_KEY) || "null");
      const safe = Array.isArray(stored) ? stored.filter((f) => ["Polygon", "MultiPolygon"].includes(f?.geometry?.type)) : [];
      if (selectedField?.geometry && !safe.some((f) => String(f.id) === String(selectedField.id))) safe.unshift(selectedField);
      setFields(safe);
      setSelectedFieldId(selectedField?.geometry ? fieldKey(selectedField) : safe.length ? fieldKey(safe[0], 0) : "");
      setSaved(JSON.parse(localStorage.getItem(INPUTS_KEY) || "null"));
    } catch {
      setError("Saved field boundaries could not be read. Return to the Global Farm Map and save the field again.");
    }
  }, []);

  const selectedIndex = fields.findIndex((f, i) => fieldKey(f, i) === selectedFieldId);
  const selectedField = selectedIndex >= 0 ? fields[selectedIndex] : null;
  const selectedName = selectedField ? fieldName(selectedField, selectedIndex) : "Selected field";
  const selectedArea = useMemo(() => (selectedField ? areaLabel(selectedField) : "—"), [selectedField]);
  const inputsMatch = saved && saved.fieldId === selectedFieldId && Array.isArray(saved.existing) && saved.existing.length >= 2;

  function selectField(id) {
    const feature = fields.find((item, index) => fieldKey(item, index) === id);
    setSelectedFieldId(id);
    setPassport(null);
    setError("");
    if (feature) { try { localStorage.setItem(SELECTED_FIELD_KEY, JSON.stringify(feature)); } catch {} }
  }

  const setSource = (key, status, note = "") => setSources((current) => ({ ...current, [key]: { status, note } }));

  async function getJson(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  }

  async function generate(event) {
    event?.preventDefault();
    const centre = selectedField ? fieldCentre(selectedField) : null;
    if (!centre) { setError("Choose or save a farm boundary on the Global Farm Map first."); return; }
    if (!inputsMatch) { setError("Run the Rotation engine for this field first. The passport uses the farm details you entered there."); return; }
    setLoading(true);
    setError("");
    setPassport(null);
    setSources({ climate: { status: "loading" }, water: { status: "loading" }, soil: { status: "loading" }, vegetation: { status: includeVegetation ? "loading" : "skipped" } });

    const lat = centre.latitude.toFixed(4);
    const lon = centre.longitude.toFixed(4);
    let test = null;
    try { test = JSON.parse(localStorage.getItem(TEST_KEY_PREFIX + selectedFieldId) || "null"); } catch {}

    const track = (key, promise) => promise.then((value) => { setSource(key, "done"); return value; }, (reason) => { setSource(key, "failed", reason?.message || "Unavailable"); return null; });
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 12);
    start.setDate(start.getDate() + 1);

    const climatePromise = track("climate", getJson(`/api/climate-history?lat=${lat}&lon=${lon}`));
    const waterPromise = track("water", getJson(`/api/water-stress?lat=${lat}&lon=${lon}&months=12`));
    const soilPromise = track("soil", getJson("/api/soil-health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field: selectedField }) }));
    let vegetationPromise = Promise.resolve({ skipped: true });
    if (includeVegetation) {
      const skip = new Promise((resolve) => { skipVegetation.current = () => { setSource("vegetation", "skipped", "You continued without it."); resolve({ skipped: true }); }; });
      const request = getJson("/api/vegetation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field: selectedField, startDate: dateInput(start), endDate: dateInput(end), cloudLimit: 70 }) })
        .then((result) => { setSource("vegetation", "done"); return { result }; }, (reason) => { setSource("vegetation", "failed", reason?.message || "Unavailable"); return { error: reason?.message || "Unavailable" }; });
      vegetationPromise = Promise.race([request, skip]);
    }

    try {
      const [climateHistory, waterStress, soilResult, vegetation] = await Promise.all([climatePromise, waterPromise, soilPromise, vegetationPromise]);
      if (!climateHistory) throw new Error("NASA POWER climate history could not be loaded, so no passport can be produced. Please try again.");
      const result = buildPassport({
        field: { name: selectedName, areaHa: areaHectares(selectedField), centre },
        inputs: {
          seasonsPerYear: saved.seasonsPerYear === 2 ? 2 : 1,
          irrigation: saved.irrigation,
          existing: saved.existing,
          priorities: saved.priorities,
          marketCrops: saved.marketCrops || [],
          equipment: Array.isArray(saved.equipment) ? saved.equipment : null,
        },
        data: {
          climateHistory,
          waterStress,
          soil: { layers: soilResult?.layers || null, sample: soilResult?.sample || null, soilGrids: soilResult?.soilGrids || null, soilMoisture: soilResult?.soilMoisture || null, test },
          vegetation,
        },
      });
      setPassport(result);
      setSelected(result.entries.length > 1 ? 1 : 0);
    } catch (buildError) {
      setError(buildError.message || "Unable to build the passport.");
    } finally {
      skipVegetation.current = null;
      setLoading(false);
    }
  }

  const sourceRows = [
    ["climate", "NASA POWER climate history"],
    ["water", "NASA POWER water-stress analysis"],
    ["soil", "Soil profile + NASA SMAP water history"],
    ["vegetation", "Sentinel-2 vegetation of your field (can take up to 2 minutes)"],
  ];

  return (
    <main className="vi-page pp-page">
      <header className="vi-header pp-noprint">
        <div className="vi-brand-wrap">
          <Link href="/explore/rotation" className="vi-back" aria-label="Back to rotation engine"><Icon name="back" size={18}/></Link>
          <Link href="/" className="vi-brand"><span className="vi-brand-mark"><Icon name="shield" size={19}/></span><span>agrimetry<span>.</span></span></Link>
          <span className="vi-divider"/>
          <div className="vi-header-title"><small>DECISION SUPPORT</small><strong>Evidence passport</strong></div>
        </div>
        <div className="vi-header-actions"><span className="vi-source-pill"><i/> ALL FEATURES, ONE REPORT</span><Link href="/explore/rotation" className="vi-explore-link">Rotation engine</Link><Link href="/explore/replay" className="vi-explore-link">Climate replay</Link></div>
      </header>

      <div className="vi-content">
        <section className="vi-intro pp-noprint">
          <div>
            <span className="vi-kicker"><span/> EVIDENCE PASSPORT</span>
            <h1>Every suggestion, with its <em>evidence</em>.</h1>
            <p>The passport gathers everything Agrimetry knows about your field and shows, for each rotation, why it was suggested, which datasets support it, what years of weather would have done to it, the potential soil and water effects, and every risk, uncertainty and gap. It keeps satellite observations, modelled estimates and your own information clearly apart.</p>
          </div>
          <div className="vi-intro-note"><Icon name="shield" size={20}/><span>Printable · downloadable<br/><strong>Always ends with: validate locally</strong></span></div>
        </section>

        {fields.length === 0 ? (
          <section className="vi-empty-state pp-noprint">
            <div className="vi-empty-icon"><Icon name="map" size={28}/></div>
            <div><span className="vi-kicker">NO SAVED FIELD FOUND</span><h2>Choose a field before building a passport.</h2><p>Go to the Global Farm Map, draw a boundary and save it, then run the Rotation engine.</p><Link href="/explore/map" className="vi-primary-button">Open Global Farm Map <Icon name="external" size={15}/></Link></div>
          </section>
        ) : (
          <>
            <section className="vi-white-panel pp-controls pp-noprint">
              <div className="pp-controls-grid">
                <label className="vi-field-label">Saved farm / field
                  <select value={selectedFieldId} onChange={(event) => selectField(event.target.value)}>
                    {fields.map((feature, index) => <option key={fieldKey(feature, index)} value={fieldKey(feature, index)}>{fieldName(feature, index)} · {areaLabel(feature)}</option>)}
                  </select>
                </label>
                <div className="pp-input-summary">
                  <strong>{selectedName}</strong> <small>{selectedArea}</small>
                  {inputsMatch ? (
                    <p>Farm details from the Rotation page: current rotation <strong>{saved.existing.map((id) => (CROP_NAME[id] || id).split(" (")[0]).join(" → ")}</strong>, {saved.seasonsPerYear === 2 ? "two crops per year" : "one crop per year"}, {saved.irrigation === "rainfed" ? "rainfed" : saved.irrigation === "limited" ? "limited irrigation" : "reliable irrigation"}, {saved.marketCrops?.length ? `${saved.marketCrops.length} crops you can sell` : "no market list"}. <Link href="/explore/rotation">Edit on the Rotation page</Link></p>
                  ) : (
                    <p className="pp-warning">No saved farm details for this field yet. <Link href="/explore/rotation">Run the Rotation engine first</Link>; the passport reuses what you enter there.</p>
                  )}
                </div>
              </div>
              <label className="vi-check-row"><input type="checkbox" checked={includeVegetation} onChange={(event) => setIncludeVegetation(event.target.checked)}/><span>Include Sentinel-2 satellite vegetation of my field<small>Adds observed greenness to the evidence but can take up to two minutes. Leave unticked for a faster passport.</small></span></label>
              <div className="pp-actions">
                <button type="button" className="vi-run-button" onClick={generate} disabled={loading || !selectedField || !inputsMatch}><Icon name={loading ? "refresh" : "shield"} size={17}/>{loading ? "Gathering evidence…" : "Generate evidence passport"}</button>
                {loading && includeVegetation && sources.vegetation?.status === "loading" && <button type="button" className="sh-link-button" onClick={() => skipVegetation.current?.()}>Continue without satellite vegetation</button>}
              </div>
              {(loading || Object.keys(sources).length > 0) && !passport && (
                <ul className="pp-progress" aria-live="polite">{sourceRows.map(([key, label]) => { const s = sources[key] || { status: "idle" }; return <li key={key} className={`pp-st-${s.status}`}><b/> <span>{label}</span><em>{STATUS_TEXT[s.status]}{s.note ? ` — ${String(s.note).slice(0, 110)}` : ""}</em></li>; })}</ul>
              )}
              {error && <div className="vi-error" role="alert"><Icon name="info" size={17}/><span>{error}</span></div>}
            </section>

            {passport && (
              <div className="pp-report">
                <section className="pp-cover">
                  <div className="pp-cover-head">
                    <div><span className="vi-overline">AGRIMETRY EVIDENCE PASSPORT</span><h2>{passport.field.name}</h2><p>{Number.isFinite(passport.field.areaHa) ? `${passport.field.areaHa.toFixed(1)} ha · ` : ""}{passport.field.centre.latitude.toFixed(4)}, {passport.field.centre.longitude.toFixed(4)} · generated {new Date(passport.generatedAt).toLocaleString()}</p><code>{passport.id}</code></div>
                    <div className={`pp-confidence pp-conf-${passport.confidence.level.toLowerCase()}`}><span>EVIDENCE CONFIDENCE</span><strong>{passport.confidence.level}</strong><small>{passport.confidence.score} / {passport.confidence.max} data points</small></div>
                  </div>
                  <div className="pp-validate" role="note"><Icon name="shield" size={18}/><p><strong>Validate locally.</strong> {passport.validationReminder}</p></div>
                  <p className="pp-lead">{passport.confidence.explanation}</p>
                  <div className="vi-table-scroll"><table><thead><tr><th>What was checked</th><th>Points</th><th>Note</th></tr></thead><tbody>{passport.confidence.items.map((item) => <tr key={item.label}><td>{item.label}</td><td>{item.points} / {item.max}</td><td>{item.note}</td></tr>)}{passport.confidence.penalty ? <tr><td>Climate not well covered</td><td>−{passport.confidence.penalty}</td><td>{passport.confidence.notes.join(" ")}</td></tr> : null}</tbody></table></div>
                  {passport.observationCheck && <div className={`pp-check pp-check-${passport.observationCheck.status}`} role="note"><Icon name={passport.observationCheck.status === "consistent" ? "shield" : "info"} size={17}/><p><strong>Satellite reality check{passport.observationCheck.status === "consistent" ? ": consistent" : passport.observationCheck.status === "inconsistent" ? ": does not match" : ""}.</strong> {passport.observationCheck.text}</p></div>}
                  {passport.notices.map((notice) => <div className="vi-error" role="status" key={notice}><Icon name="info" size={17}/><span>{notice}</span></div>)}
                  {passport.message && <div className="vi-error" role="status"><Icon name="info" size={17}/><span>{passport.message}</span></div>}
                </section>

                <section className="vi-white-panel pp-section-card">
                  <div className="vi-panel-title"><div><span className="vi-overline">HOW TO READ THIS PASSPORT</span><h2>Four kinds of evidence, kept apart</h2></div></div>
                  <div className="pp-legend">{CLASS_ORDER.map((key) => <div key={key}><ClassBadge cls={key} classes={passport.classes}/><p>{passport.classes[key].detail}</p></div>)}</div>
                </section>

                <section className="vi-white-panel pp-section-card">
                  <div className="vi-panel-title"><div><span className="vi-overline">DATA BEHIND THIS PASSPORT</span><h2>Datasets and their status</h2><p>NASA datasets are marked. Sentinel-2 is a European mission and SoilGrids comes from ISRIC; they are not NASA data.</p></div></div>
                  <div className="vi-table-scroll"><table><thead><tr><th>Dataset</th><th>Provider</th><th>Kind</th><th>Status</th><th>Used for</th></tr></thead><tbody>{passport.sources.map((s) => <tr key={s.id} className={`pp-src-${s.status}`}><td><strong>{s.nasa ? "NASA · " : ""}{s.name}</strong><br/><small>{s.detail}</small></td><td>{s.provider}</td><td><ClassBadge cls={s.class} classes={passport.classes}/></td><td>{s.status === "used" ? "Used" : s.status === "visual-only" ? "Visual only" : s.status === "skipped" ? "Skipped" : "Unavailable"}</td><td>{s.usedFor}</td></tr>)}</tbody></table></div>
                </section>

                <section className="pp-tabs pp-noprint" aria-label="Choose a rotation">
                  {passport.entries.map((entry, index) => (
                    <button type="button" key={entry.label} className={`pp-tab ${selected === index ? "active" : ""}`} onClick={() => setSelected(index)}>
                      <small>{entry.role === "current" ? "CURRENT" : entry.label}</small>
                      <strong>{entry.total.toFixed(0)}</strong>
                      <span>{entry.crops.map((c) => c.split(" ")[0]).join(" → ")}</span>
                    </button>
                  ))}
                </section>

                {passport.entries.map((entry, index) => <PassportEntry key={entry.label} entry={entry} passport={passport} active={selected === index}/>)}

                <section className="vi-white-panel pp-section-card">
                  <div className="vi-panel-title"><div><span className="vi-overline">ASSUMPTIONS</span><h2>What every number above assumes</h2></div></div>
                  <ul className="pp-assumptions">{passport.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
                  <div className="pp-validate" role="note"><Icon name="shield" size={18}/><p><strong>Validate locally.</strong> {passport.validationReminder}</p></div>
                </section>

                <div className="pp-actions pp-noprint">
                  <button type="button" className="vi-primary-button" onClick={() => window.print()}><Icon name="print" size={16}/> Print or save as PDF (all rotations)</button>
                  <button type="button" className="vi-primary-button pp-secondary" onClick={() => download(`${passport.id}.md`, passportToMarkdown(passport), "text/markdown")}><Icon name="download" size={16}/> Download as text (Markdown)</button>
                  <button type="button" className="vi-primary-button pp-secondary" onClick={() => download(`${passport.id}.json`, JSON.stringify(passport, null, 2), "application/json")}><Icon name="download" size={16}/> Download data (JSON)</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
