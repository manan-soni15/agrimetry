"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const CACHE_KEY = "agrimetry:completed-vegetation-analysis:v1";

function Icon({ name }) {
  const paths = {
    leaf: <><path d="M20 4C10 4 5 8 5 14c0 3 2 5 5 5 6 0 10-6 10-15Z"/><path d="M3 21c3-5 7-8 13-11"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22V5.5Z"/><path d="M4 5v17m5-14h7m-7 4h7"/></>,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    rotate: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-3"/></>,
    message: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/></>,
  };
  return <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.spark}</svg>;
}

export default function LandStoryteller() {
  const [analysis, setAnalysis] = useState(null);
  const [story, setStory] = useState(null);
  const [evidence, setEvidence] = useState([]);
  const [active, setActive] = useState(0);
  const [expandedEvidence, setExpandedEvidence] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const [answers, setAnswers] = useState([]);

  useEffect(() => {
    try { setAnalysis(JSON.parse(localStorage.getItem(CACHE_KEY) || "null")); }
    catch { setAnalysis(null); }
  }, []);

  const fieldName = analysis?.field?.properties?.fieldName || analysis?.field?.properties?.name || "Your selected field";
  const ndviMonths = useMemo(() => analysis?.result?.monthly?.filter((item) => Number.isFinite(item?.meanNdvi)).length || 0, [analysis]);
  const hasAnalysis = Boolean(analysis?.field?.geometry && ndviMonths > 0 && analysis?.result?.summary);

  async function generateStory() {
    if (!hasAnalysis || loading) return;
    setLoading(true); setError(""); setStory(null); setAnswers([]); setActive(0);
    try {
      const response = await fetch("/api/land-story", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field: { name: fieldName, geometry: analysis.field.geometry }, period: { start: analysis.startDate, end: analysis.endDate }, vegetationAnalysis: analysis.result }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not generate the land story.");
      setStory(payload.story); setEvidence(payload.evidence || []);
    } catch (err) { setError(err.message || "The storyteller is temporarily unavailable."); }
    finally { setLoading(false); }
  }

  async function askQuestion(event) {
    event.preventDefault();
    if (!question.trim() || asking || !story) return;
    setAsking(true); setAnswer("");
    try {
      const response = await fetch("/api/land-story", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field: { name: fieldName, geometry: analysis.field.geometry }, period: { start: analysis.startDate, end: analysis.endDate }, vegetationAnalysis: analysis.result, evidence, story, question }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not answer that question.");
      setAnswers((items) => [...items, { question, answer: payload.answer }]); setQuestion("");
    } catch (err) { setAnswer(err.message || "Could not answer that question."); }
    finally { setAsking(false); }
  }

  const chapter = story?.chapters?.[active];

  return <main className="land-story-page">
    <header className="ls-topbar"><Link href="/explore" className="ls-brand"><span><Icon name="leaf"/></span> agrimetry<span className="ls-brand-dot">.</span></Link><Link href="/explore/vegetation" className="ls-back">Field analysis <Icon name="arrow"/></Link></header>
    <section className="ls-hero">
      <div className="ls-kicker"><Icon name="spark"/> INTELLIGENCE LAYER · GEMINI</div>
      <h1>The story <em>of your land.</em></h1>
      <p>Agrimet​​ry connects completed satellite observations with soil, water and climate context, then turns the evidence into a story you can explore.</p>
      <div className="ls-field-strip"><div><span>SELECTED FIELD</span><strong>{hasAnalysis ? fieldName : "No completed field analysis"}</strong></div><div><span>USABLE NDVI MONTHS</span><strong>{hasAnalysis ? ndviMonths : "—"}</strong></div><div><span>ANALYSIS PERIOD</span><strong>{hasAnalysis ? `${analysis.startDate} – ${analysis.endDate}` : "—"}</strong></div></div>
    </section>

    {!hasAnalysis ? <section className="ls-gate"><div className="ls-gate-icon"><Icon name="book"/></div><div><span className="ls-kicker">FIRST, LET THE SATELLITE SEE YOUR FIELD</span><h2>Complete Field Vegetation analysis to unlock your story.</h2><p>The storyteller is intentionally locked until a Sentinel-2 field analysis has completed successfully. This ensures every generated story starts with real field observations instead of guesses.</p><Link href="/explore/vegetation" className="ls-primary">Go to Field Vegetation <Icon name="arrow"/></Link></div></section> : <>
      {!story && <section className="ls-generate-card"><div className="ls-generate-copy"><span className="ls-kicker">YOUR FIELD, CONNECTED</span><h2>Turn the evidence into a journey.</h2><p>We will use your completed Sentinel-2 analysis and independently request available soil, water-stress and climate context. Missing sources are labelled, never invented.</p><div className="ls-source-pills"><span>Sentinel-2 · required</span><span>Soil profile · optional</span><span>Water & climate · optional</span></div></div><button className="ls-primary ls-generate" onClick={generateStory} disabled={loading}>{loading ? <><span className="ls-spinner"/> Building your story…</> : <><Icon name="spark"/> Generate My Land Story</>}</button>{loading && <div className="ls-loading-note">Gathering field evidence and asking Gemini to interpret it. This can take a little while.</div>}</section>}
      {error && <div className="ls-error" role="alert">{error}<button onClick={generateStory}>Try again</button></div>}
      {story && <>
        <section className="ls-story-heading"><div><span className="ls-kicker">YOUR FIELD NARRATIVE</span><h2>{story.title}</h2><p>{story.opening}</p></div><button className="ls-secondary" onClick={generateStory} disabled={loading}><Icon name="rotate"/> Regenerate</button></section>
        <section className="ls-story-layout">
          <aside className="ls-chapter-nav"><span className="ls-overline">FOLLOW THE STORY</span>{story.chapters.map((item, index) => <button key={`${item.heading}-${index}`} className={active === index ? "active" : ""} onClick={() => { setActive(index); setExpandedEvidence(false); }}><span className="ls-chapter-number">0{index + 1}</span><span>{item.heading}</span><Icon name="chevron"/></button>)}<div className="ls-nav-foot">{active + 1} of {story.chapters.length} chapters</div></aside>
          <article className="ls-chapter-card"><div className="ls-chapter-meta"><span>CHAPTER 0{active + 1}</span><span className={`ls-claim ls-${chapter.claimType}`}>{chapter.claimType}</span></div><h3>{chapter.heading}</h3><p className="ls-chapter-story">{chapter.story}</p>{chapter.fieldQuestion && <div className="ls-field-question"><span>LOOK CLOSER</span><strong>{chapter.fieldQuestion}</strong></div>}<button className="ls-evidence-toggle" onClick={() => setExpandedEvidence((value) => !value)}>{expandedEvidence ? "Hide supporting sources" : `Explore supporting evidence (${chapter.evidenceIds.length})`} <Icon name="chevron"/></button>{expandedEvidence && <div className="ls-evidence-list">{chapter.evidenceIds.length ? chapter.evidenceIds.map((id) => { const item = evidence.find((entry) => entry.id === id); return <div key={id}><strong>{item?.source || id}</strong><span>{item?.status === "available" ? "Data available for this analysis" : item?.note || "Source unavailable"}</span></div>; }) : <p>No direct source reference was attached to this chapter. Treat it as general context, not a measured finding.</p>}</div>}<div className="ls-chapter-controls"><button className="ls-secondary" onClick={() => setActive((value) => Math.max(0, value - 1))} disabled={active === 0}>Previous</button><button className="ls-primary" onClick={() => { setActive((value) => Math.min(story.chapters.length - 1, value + 1)); setExpandedEvidence(false); }} disabled={active === story.chapters.length - 1}>Next chapter <Icon name="arrow"/></button></div></article>
        </section>
        <section className="ls-bottom-grid"><article className="ls-check-card"><span className="ls-kicker">WHAT TO CHECK ON THE GROUND</span><h3>Take the story back to the field.</h3>{story.nextChecks.map((item, index) => <div className="ls-check-item" key={index}><span><Icon name="check"/></span>{item}</div>)}</article><article className="ls-check-card ls-limits"><span className="ls-kicker">READ THE STORY CAREFULLY</span><h3>What the data cannot tell us</h3>{story.limitations.map((item, index) => <p key={index}>{item}</p>)}</article></section>
        <section className="ls-ask-card"><div><span className="ls-kicker">KEEP EXPLORING</span><h3>Ask Agrimetry about this story.</h3><p>Ask a follow-up grounded in the same field analysis and evidence.</p></div><form onSubmit={askQuestion}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="e.g. What could explain the vegetation change?" maxLength={500}/><button className="ls-primary" disabled={asking || !question.trim()}>{asking ? "Thinking…" : <><Icon name="arrow"/> Ask</>}</button></form>{answer && <p className="ls-answer-error">{answer}</p>}{answers.map((item, index) => <div className="ls-answer" key={index}><strong>{item.question}</strong><p>{item.answer}</p></div>)}</section>
        <p className="ls-disclaimer">AI-generated interpretation of available environmental data. It is not a crop diagnosis or a substitute for field inspection and local agronomic advice.</p>
      </>}
    </>}
    <footer className="ls-footer">Agrimetry · Evidence first. Stories with context.</footer>
  </main>;
}
