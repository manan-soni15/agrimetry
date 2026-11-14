'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Fraunces, Hanken_Grotesk } from 'next/font/google';

// Where every "Explore" button leads: the application route (app/explore/page.js)
const APP_ROUTE = '/explore';

const display = Fraunces({ subsets: ['latin'], display: 'swap' });
const sans = Hanken_Grotesk({ subsets: ['latin'], display: 'swap' });

const C = {
  forest: '#173D2B', botanical: '#244F38', sage: '#A8B99A', sand: '#E8DCC5',
  parchment: '#F4EEDF', soil: '#927451', off: '#FAF8F1',
};

const NAV = [
  ['Home', '#home'], ['Our Intelligence', '#intelligence'], ['How It Works', '#process'],
  ['Features', '#rotation'], ['About', '#sources'],
];

/* ---------- small visual building blocks ---------- */

function Logo({ light }) {
  const fg = light ? C.off : C.forest;
  return (
    <a href="#home" className="ag-logo" aria-label="Agrimetry home" style={{ color: fg }}>
      <svg width="34" height="34" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="18" fill="none" stroke={fg} strokeWidth="1.4" />
        <path d="M4 25c6-5 11 2 16-3s10-3 16-6" fill="none" stroke={C.sage} strokeWidth="1.4" />
        <path d="M6 31c7-4 11 2 17-2s9-2 12-4" fill="none" stroke={C.sage} strokeWidth="1.1" opacity=".7" />
        <path d="M20 29V15m0 5c-4 0-6-3-6-6 4 0 6 2 6 6Zm0-1c3 0 5-2 5-5-3 0-5 2-5 5Z" fill="none" stroke={fg} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={display.className}>Agrimetry</span>
    </a>
  );
}

function Contours({ stroke = C.soil, opacity = 0.35, className = '' }) {
  const rings = [0, 1, 2, 3, 4, 5, 6];
  return (
    <svg className={`ag-contours ${className}`} viewBox="0 0 600 600" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <g fill="none" stroke={stroke} strokeWidth="1" opacity={opacity}>
        {rings.map((i) => (
          <path key={i} className="ag-dash" style={{ animationDelay: `${i * -2}s` }}
            d="M300 40c110-10 190 70 215 160s-10 170-80 230-190 130-290 80S25 340 60 240 190 50 300 40Z"
            transform={`translate(${300 - 300 * (1 - i * 0.12)} ${300 - 300 * (1 - i * 0.12)}) scale(${1 - i * 0.12})`} />
        ))}
      </g>
    </svg>
  );
}

function Reveal({ children, className = '', delay = 0 }) {
  const ref = useRef(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setOn(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOn(true); io.disconnect(); } }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`ag-reveal ${on ? 'on' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

function Glyph({ kind, size = 44 }) {
  const s = { fill: 'none', stroke: C.forest, strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    grain: <><path d="M22 38V10" {...s} />{[14, 20, 26].map((y) => <g key={y}><path d={`M22 ${y}c-5 0-7-3-7-6 5 0 7 3 7 6Z`} {...s} /><path d={`M22 ${y}c5 0 7-3 7-6-5 0-7 3-7 6Z`} {...s} /></g>)}</>,
    legume: <><path d="M10 30c8 8 22 2 24-14-12 0-24 4-24 14Z" {...s} /><path d="M10 30c6-6 12-10 20-14" {...s} /></>,
    cover: <><path d="M8 34c4-12 8-16 14-20 6 4 10 8 14 20" {...s} /><path d="M22 14v20M15 28l7-6 7 6" {...s} /></>,
    fallow: <><path d="M6 30c6-4 10 2 16-2s10-2 16-6M6 36c6-4 10 2 16-2s10-2 16-6" {...s} /></>,
    root: <><path d="M16 12c2-4 10-4 12 0M18 14c-2 10 2 22 4 26 2-4 6-16 4-26" {...s} /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r="21" fill={C.parchment} stroke={C.soil} strokeWidth="1" strokeDasharray="2 3" />
      {paths[kind]}
    </svg>
  );
}

/* ---------- hero composition: aerial field mosaic + radar ---------- */

function FieldMosaic() {
  const f = [
    ['#5f7f4a', '10,20 140,10 150,120 20,130'], ['#8a9a55', '150,10 290,25 280,125 160,120'],
    ['#b79b62', '290,25 390,40 380,140 282,126'], ['#3f6a47', '20,132 150,122 160,250 28,262'],
    ['#c9b27c', '160,122 280,128 270,240 170,250'], ['#6f8c52', '282,128 380,142 372,262 272,242'],
    ['#7b6a45', '28,264 160,252 150,380 36,392'], ['#4d7a50', '170,252 270,242 285,370 160,382'],
    ['#a8b99a', '272,244 372,264 364,392 288,372'], ['#8b6f4b', '36,394 150,382 140,470 44,466'],
    ['#6a8a4d', '160,384 285,372 300,466 152,470'], ['#bfa56f', '288,374 364,394 356,462 302,466'],
  ];
  return (
    <svg viewBox="0 0 400 480" className="ag-mosaic" role="img" aria-label="Stylised aerial view of agricultural fields">
      <defs>
        <clipPath id="ag-blob"><path d="M60 20c90-26 250-10 310 70s20 190 6 260-60 120-170 120S30 430 18 320 -20 55 60 20Z" /></clipPath>
        <pattern id="ag-rows" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(18)"><path d="M0 0H7" stroke="#173D2B" strokeOpacity=".18" strokeWidth="1" /></pattern>
      </defs>
      <g clipPath="url(#ag-blob)">
        <rect width="400" height="480" fill={C.soil} />
        {f.map(([c, p], i) => <polygon key={i} points={p} fill={c} stroke={C.parchment} strokeWidth="2" />)}
        {f.map(([, p], i) => <polygon key={'r' + i} points={p} fill="url(#ag-rows)" />)}
        <circle cx="215" cy="185" r="46" fill="#7fa162" stroke={C.parchment} strokeWidth="2" />
        <circle cx="95" cy="320" r="40" fill="#4d7a50" stroke={C.parchment} strokeWidth="2" />
        <path d="M0 300C90 260 170 330 240 280S360 250 400 270" stroke="#E8DCC5" strokeOpacity=".7" strokeWidth="5" fill="none" />
        <g stroke={C.parchment} strokeOpacity=".35" strokeWidth=".8">
          {[100, 200, 300].map((x) => <line key={x} x1={x} y1="0" x2={x} y2="480" />)}
          {[120, 240, 360].map((y) => <line key={y} x1="0" y1={y} x2="400" y2={y} />)}
        </g>
      </g>
      <path d="M60 20c90-26 250-10 310 70s20 190 6 260-60 120-170 120S30 430 18 320 -20 55 60 20Z" fill="none" stroke={C.forest} strokeWidth="1.5" />
    </svg>
  );
}

function Radar() {
  return (
    <svg className="ag-radar" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="56" fill="none" stroke={C.forest} strokeOpacity=".5" />
      <circle cx="60" cy="60" r="38" fill="none" stroke={C.forest} strokeOpacity=".35" />
      <circle cx="60" cy="60" r="20" fill="none" stroke={C.forest} strokeOpacity=".25" />
      <g className="ag-sweep"><path d="M60 60L60 4A56 56 0 0 1 110 34Z" fill={C.sage} opacity=".55" /></g>
      <circle cx="88" cy="38" r="3" fill={C.soil} />
    </svg>
  );
}

function Chip({ label, value, style, delay }) {
  return (
    <div className="ag-chip" style={{ ...style, animationDelay: delay }}>
      <span>{label}</span>
      <strong className={display.className}>{value}</strong>
    </div>
  );
}

/* ---------- data ---------- */

const INTEL = [
  { t: 'Soil Intelligence', d: 'Understand soil moisture patterns, soil characteristics and potential soil-health challenges.', k: 'root' },
  { t: 'Climate Intelligence', d: 'Explore historical rainfall, temperature trends and changing environmental conditions.', k: 'cover' },
  { t: 'Vegetation Intelligence', d: 'Understand vegetation patterns, seasonal changes and potential crop stress using satellite observations.', k: 'grain' },
  { t: 'Terrain Intelligence', d: 'Explore elevation, slope and geographical factors that influence agricultural conditions.', k: 'fallow' },
];

const STEPS = [
  ['Observe', 'Collect Earth observation data from NASA and other trusted sources.'],
  ['Understand', 'Analyze environmental conditions, soil characteristics and seasonal patterns.'],
  ['Evaluate', 'Explore crop rotation alternatives using agricultural characteristics and farmer priorities.'],
  ['Decide', 'Compare evidence, benefits, risks and trade-offs before making a farming decision.'],
];

const INDICATORS = ['Water demand alignment', 'Seasonal suitability', 'Soil-building potential', 'Crop diversity'];

const ROTATIONS = [
  { name: 'Existing Rotation', note: 'Your current sequence, used as the reference point.', seq: [['Wheat', 'grain'], ['Fallow', 'fallow'], ['Maize', 'grain']], vals: [48, 62, 30, 28] },
  { name: 'Water-Conscious Rotation', note: 'Shifts toward crops suited to drier seasons and shorter water-demand windows.', seq: [['Millet', 'grain'], ['Chickpea', 'legume'], ['Mustard', 'root']], vals: [78, 70, 52, 66] },
  { name: 'Soil-Building Rotation', note: 'Adds a nitrogen-fixing legume and a winter cover crop between cash crops.', seq: [['Wheat', 'grain'], ['Cover mix', 'cover'], ['Pulses', 'legume']], vals: [60, 66, 82, 80] },
];

const SCENARIOS = {
  'Historical drought': { sub: 'Soil moisture deficit during the growing season', v: [78, 46, 58] },
  'Extreme heat': { sub: 'Days above crop heat-stress thresholds', v: [70, 52, 49] },
  'Excessive rainfall': { sub: 'Bare-soil days exposed to heavy rain and erosion', v: [64, 57, 33] },
};

const SOURCES = [
  ['SMAP', 'Soil moisture', 'Surface and root-zone wetness trends.'],
  ['GPM', 'Precipitation', 'Rainfall totals and extreme events.'],
  ['Landsat', 'Vegetation monitoring', 'Field-scale greenness and bare-soil periods.'],
  ['POWER', 'Meteorological conditions', 'Temperature, radiation and evapotranspiration.'],
  ['MODIS', 'Vegetation and environment', 'Long daily record of vegetation and land surface temperature.'],
];

/* ---------- page ---------- */

export default function Page() {
  const [open, setOpen] = useState(false);
  const [scenario, setScenario] = useState('Historical drought');
  const sc = SCENARIOS[scenario];

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`ag ${sans.className}`}>
      <style>{CSS}</style>

      <header className="ag-nav">
        <div className="ag-wrap ag-navin">
          <Logo />
          <nav className="ag-links" aria-label="Primary">
            {NAV.map(([l, h]) => <a key={l} href={h}>{l}</a>)}
          </nav>
          <Link className="ag-btn ag-btn-dark ag-navcta" href={APP_ROUTE}>Explore Agrimetry</Link>
          <button className="ag-burger" aria-expanded={open} aria-controls="ag-mobile" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)}>
            <span /><span />
          </button>
        </div>
        <div id="ag-mobile" className={`ag-mobile ${open ? 'open' : ''}`}>
          {NAV.map(([l, h]) => <a key={l} href={h} onClick={() => setOpen(false)}>{l}</a>)}
          <Link className="ag-btn ag-btn-dark" href={APP_ROUTE} onClick={() => setOpen(false)}>Explore Agrimetry</Link>
        </div>
      </header>

      <main>
        {/* HERO */}
        <section id="home" className="ag-hero">
          <Contours className="ag-hero-contours" />
          <div className="ag-wrap ag-herogrid">
            <div className="ag-herotext">
              <p className="ag-label">EARTH OBSERVATION × AGRICULTURAL INTELLIGENCE</p>
              <h1 className={display.className}>
                Your Land Has a Story. Let&rsquo;s <em>Read It.</em>
              </h1>
              <p className="ag-lead">
                Agrimetry transforms satellite observations, soil intelligence and climate data into meaningful insights that help farmers discover smarter crop rotations and build resilient agricultural systems.
              </p>
              <div className="ag-cta">
                <Link className="ag-btn ag-btn-dark" href={APP_ROUTE}>Explore the Platform</Link>
                <a className="ag-btn ag-btn-line" href="#process">Discover How It Works</a>
              </div>
              <p className="ag-cred"><span className="ag-dot" /> Powered by NASA Earth Observations</p>
            </div>

            <div className="ag-herovis" aria-hidden="false">
              <FieldMosaic />
              <Radar />
              <Chip label="Soil moisture" value="0.27 m³/m³" style={{ top: '8%', left: '-2%' }} delay="0s" />
              <Chip label="Rainfall, 30 days" value="42 mm" style={{ top: '46%', right: '-4%' }} delay="-2s" />
              <Chip label="Vegetation health" value="NDVI 0.61" style={{ bottom: '8%', left: '4%' }} delay="-4s" />
              <span className="ag-coord" style={{ top: '2%', right: '12%' }}>26.91°N 75.79°E</span>
              <span className="ag-coord" style={{ bottom: '1%', right: '8%' }}>Sample field, illustrative values</span>
            </div>
          </div>
        </section>

        {/* INTELLIGENCE */}
        <section id="intelligence" className="ag-sand">
          <div className="ag-wrap">
            <Reveal>
              <div className="ag-twocol">
                <h2 className={display.className}>Understand What Is Happening Beneath the Surface.</h2>
                <p className="ag-lead">Agrimetry combines Earth observations with local soil information and agricultural knowledge, so each field is read in its own context rather than through regional averages.</p>
              </div>
            </Reveal>
            <div className="ag-intel">
              {INTEL.map((x, i) => (
                <Reveal key={x.t} className={`ag-intel-${i}`} delay={i * 80}>
                  <article className="ag-block">
                    <Glyph kind={x.k} size={52} />
                    <h3 className={display.className}>{x.t}</h3>
                    <p>{x.d}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* PROCESS */}
        <section id="process" className="ag-parch">
          <div className="ag-wrap">
            <Reveal><h2 className={`${display.className} ag-center`}>From Earth&rsquo;s Signals to Smarter Farming Decisions.</h2></Reveal>
            <ol className="ag-steps">
              <svg className="ag-orbit" viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden="true">
                <path d="M0 30C120 -10 200 70 330 30S540 -10 660 30 880 70 1000 30" fill="none" stroke={C.soil} strokeWidth="1.2" strokeDasharray="5 6" />
              </svg>
              {STEPS.map(([t, d], i) => (
                <Reveal key={t} delay={i * 110}>
                  <li>
                    <span className={`ag-num ${display.className}`}>{String(i + 1).padStart(2, '0')}</span>
                    <h3 className={display.className}>{t}</h3>
                    <p>{d}</p>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* ROTATION */}
        <section id="rotation" className="ag-sand">
          <div className="ag-wrap">
            <Reveal>
              <div className="ag-twocol">
                <h2 className={display.className}>Not Just What to Grow. What to Grow Next.</h2>
                <p className="ag-lead">Agrimetry evaluates whole crop rotation strategies instead of recommending crops in isolation, so you can see how each season sets up the next.</p>
              </div>
            </Reveal>
            <div className="ag-rots">
              {ROTATIONS.map((r, i) => (
                <Reveal key={r.name} delay={i * 90}>
                  <article className={`ag-rot ${i === 2 ? 'feat' : ''}`}>
                    <h3 className={display.className}>{r.name}</h3>
                    <p className="ag-note">{r.note}</p>
                    <div className="ag-seq" aria-label={`Sequence: ${r.seq.map((s) => s[0]).join(', then ')}`}>
                      {r.seq.map(([n, k], j) => (
                        <div key={n} className="ag-seqi">
                          <Glyph kind={k} />
                          <span>{n}</span>
                          {j < r.seq.length - 1 && <i className="ag-link" />}
                        </div>
                      ))}
                    </div>
                    <ul className="ag-ind">
                      {INDICATORS.map((l, j) => (
                        <li key={l}>
                          <span>{l}</span>
                          <div className="ag-bar" role="img" aria-label={`${l}: illustrative ${r.vals[j]} out of 100`}><b style={{ width: `${r.vals[j]}%` }} /></div>
                        </li>
                      ))}
                    </ul>
                  </article>
                </Reveal>
              ))}
            </div>
            <p className="ag-fine">Example values are illustrative, not actual predictions.</p>
          </div>
        </section>

        {/* REPLAY */}
        <section id="replay" className="ag-dark">
          <Contours stroke={C.sage} opacity={0.18} className="ag-replay-contours" />
          <div className="ag-wrap ag-replaygrid">
            <div>
              <h2 className={display.className}>What If You Could Revisit a Difficult Growing Season?</h2>
              <p className="ag-lead light">Compare how alternative rotations would have been exposed to conditions a field has already lived through. It is historical scenario analysis, not a guaranteed yield prediction.</p>
              <div className="ag-tabs" role="tablist" aria-label="Historical scenario">
                {Object.keys(SCENARIOS).map((k) => (
                  <button key={k} role="tab" aria-selected={scenario === k} className={scenario === k ? 'on' : ''} onClick={() => setScenario(k)}>{k}</button>
                ))}
              </div>
            </div>
            <div className="ag-chart" role="region" aria-live="polite" aria-label="Scenario comparison">
              <p className={`ag-chart-t ${display.className}`}>{scenario}</p>
              <p className="ag-chart-s">{sc.sub}. Lower exposure is better.</p>
              {ROTATIONS.map((r, i) => (
                <div key={r.name} className="ag-row">
                  <span>{r.name}</span>
                  <div className="ag-track"><b style={{ width: `${sc.v[i]}%`, background: i === 0 ? C.soil : i === 1 ? C.sage : '#d6e0c8' }} /></div>
                  <em>{sc.v[i]}</em>
                </div>
              ))}
              <p className="ag-fine light">Illustrative exposure index, 0 to 100.</p>
            </div>
          </div>
        </section>

        {/* SOURCES */}
        <section id="sources" className="ag-parch">
          <div className="ag-wrap">
            <Reveal>
              <div className="ag-twocol">
                <h2 className={display.className}>Grounded in Earth Observation. Designed for Agriculture.</h2>
                <p className="ag-lead">Satellite observations are complemented by local soil information and agricultural knowledge, because no satellite sees everything a farmer knows about their land.</p>
              </div>
            </Reveal>
            <ul className="ag-src">
              {SOURCES.map(([n, t, d]) => (
                <li key={n}>
                  <small>NASA</small>
                  <strong className={display.className}>{n}</strong>
                  <span>{t}</span>
                  <p>{d}</p>
                </li>
              ))}
            </ul>
            <p className="ag-fine">Agrimetry uses publicly available NASA data. NASA does not endorse Agrimetry.</p>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="ag-sand ag-final">
          <Contours className="ag-final-contours" opacity={0.3} />
          <div className="ag-wrap ag-center">
            <h2 className={display.className}>Better Decisions Begin With Understanding Your Land.</h2>
            <p className="ag-lead ag-mid">Explore the possibilities of climate-resilient agriculture with Earth observation and intelligent crop rotation insights.</p>
            <Link className="ag-btn ag-btn-dark" href={APP_ROUTE}>Explore Agrimetry</Link>
          </div>
        </section>
      </main>

      <footer className="ag-foot">
        <div className="ag-wrap ag-footgrid">
          <div>
            <Logo light />
            <p className="ag-tag">Understand Your Land. Grow With Intelligence.</p>
          </div>
          <nav aria-label="Product"><h4>Product</h4><a href="#rotation">Rotation comparison</a><a href="#replay">Climate replay</a></nav>
          <nav aria-label="Intelligence"><h4>Intelligence</h4><a href="#intelligence">Soil and climate</a><a href="#process">How it works</a></nav>
          <nav aria-label="About"><h4>About</h4><a href="#home">Agrimetry</a><a href="#sources">Data Sources</a></nav>
        </div>
        <div className="ag-wrap ag-foot2">
          <p>Created for the NASA Space Apps Challenge. Not endorsed by NASA.</p>
          <p>Built to support farmers. Inspired by Earth.</p>
        </div>
      </footer>
    </div>
  );
}

/* ---------- styles (scoped by .ag, no extra dependencies) ---------- */

const CSS = `
html{scroll-behavior:smooth}
.ag{--forest:${C.forest};--bot:${C.botanical};--sage:${C.sage};--sand:${C.sand};--parch:${C.parchment};--soil:${C.soil};--off:${C.off};
  color:var(--forest);background:var(--off);line-height:1.6;overflow-x:hidden;
  background-image:radial-gradient(rgba(146,116,81,.07) 1px,transparent 1px);background-size:5px 5px}
.ag *{box-sizing:border-box}
.ag a{color:inherit;text-decoration:none}
.ag h1,.ag h2,.ag h3{font-weight:500;line-height:1.08;margin:0;letter-spacing:-.01em}
.ag h1{font-size:clamp(2.7rem,6.4vw,5.4rem)}
.ag h1 em{font-style:italic;color:var(--bot);background:linear-gradient(transparent 62%,rgba(168,185,154,.75) 62%)}
.ag h2{font-size:clamp(2rem,4.2vw,3.4rem)}
.ag h3{font-size:1.4rem}
.ag-wrap{max-width:1180px;margin:0 auto;padding:0 24px;position:relative;z-index:1}
.ag section{position:relative;padding:112px 0;overflow:hidden}
.ag-lead{font-size:1.12rem;max-width:34rem;margin:0;color:#2e4a3b}
.ag-lead.light{color:#d9e2cf}.ag-mid{margin:20px auto 36px}
.ag-center{text-align:center}.ag-center h2{max-width:44rem;margin:0 auto}
.ag-label{font-size:.72rem;letter-spacing:.16em;font-weight:600;color:var(--soil);margin:0 0 22px}
.ag-fine{font-size:.82rem;color:var(--soil);margin:28px 0 0}.ag-fine.light{color:var(--sage)}
.ag :focus-visible{outline:3px solid var(--soil);outline-offset:3px;border-radius:4px}

.ag-btn{display:inline-flex;align-items:center;justify-content:center;padding:14px 26px;border-radius:999px;font-weight:600;font-size:.96rem;border:1.5px solid var(--forest);cursor:pointer;transition:transform .25s,background .25s,color .25s,box-shadow .25s}
.ag-btn-dark{background:var(--forest);color:var(--off)!important}
.ag-btn-dark:hover{background:var(--bot);transform:translateY(-2px);box-shadow:0 10px 22px -10px rgba(23,61,43,.6)}
.ag-btn-line{background:transparent}.ag-btn-line:hover{background:var(--forest);color:var(--off)!important;transform:translateY(-2px)}

.ag-nav{position:sticky;top:0;z-index:50;background:rgba(250,248,241,.88);backdrop-filter:blur(10px);border-bottom:1px solid rgba(146,116,81,.25)}
.ag-navin{display:flex;align-items:center;gap:28px;height:72px}
.ag-logo{display:flex;align-items:center;gap:10px;font-size:1.45rem;font-weight:600}
.ag-links{display:flex;gap:26px;margin-left:auto;font-size:.95rem}
.ag-links a{position:relative;padding:4px 0}
.ag-links a:after{content:'';position:absolute;left:0;bottom:0;height:1.5px;width:0;background:var(--soil);transition:width .3s}
.ag-links a:hover:after{width:100%}
.ag-burger{display:none;margin-left:auto;background:none;border:0;width:42px;height:42px;cursor:pointer;position:relative}
.ag-burger span{position:absolute;left:9px;right:9px;height:2px;background:var(--forest);transition:transform .3s}
.ag-burger span:first-child{top:16px}.ag-burger span:last-child{top:25px}
.ag-burger[aria-expanded=true] span:first-child{transform:translateY(4.5px) rotate(45deg)}
.ag-burger[aria-expanded=true] span:last-child{transform:translateY(-4.5px) rotate(-45deg)}
.ag-mobile{display:none}

.ag-hero{padding:72px 0 104px!important;background:linear-gradient(180deg,var(--parch),var(--sand))}
.ag-contours{position:absolute;pointer-events:none}
.ag-hero-contours{right:-12%;top:-20%;width:80%}
.ag-dash{stroke-dasharray:10 8;animation:agdash 40s linear infinite}
@keyframes agdash{to{stroke-dashoffset:-360}}
.ag-herogrid{display:grid;grid-template-columns:1.05fr .95fr;gap:48px;align-items:center}
.ag-herotext>*{animation:agin .9s both}
.ag-herotext>*:nth-child(2){animation-delay:.1s}.ag-herotext>*:nth-child(3){animation-delay:.2s}.ag-herotext>*:nth-child(4){animation-delay:.3s}.ag-herotext>*:nth-child(5){animation-delay:.4s}
@keyframes agin{from{opacity:0;transform:translateY(18px)}}
.ag-herotext .ag-lead{margin:26px 0 34px}
.ag-cta{display:flex;flex-wrap:wrap;gap:14px}
.ag-cred{display:flex;align-items:center;gap:10px;margin:34px 0 0;font-size:.9rem;color:var(--bot)}
.ag-dot{width:9px;height:9px;border-radius:50%;background:var(--soil);box-shadow:0 0 0 4px rgba(146,116,81,.25)}
.ag-herovis{position:relative;max-width:520px;margin-left:auto;width:100%}
.ag-mosaic{width:100%;height:auto;filter:drop-shadow(0 28px 32px rgba(23,61,43,.28))}
.ag-radar{position:absolute;width:26%;right:-5%;top:-4%;animation:agin 1.2s .5s both}
.ag-sweep{transform-origin:60px 60px;animation:agsweep 7s linear infinite}
@keyframes agsweep{to{transform:rotate(360deg)}}
.ag-chip{position:absolute;background:var(--off);border:1px solid rgba(146,116,81,.45);padding:10px 14px;border-radius:14px 14px 14px 3px;box-shadow:0 14px 24px -14px rgba(23,61,43,.55);animation:agfloat 7s ease-in-out infinite}
.ag-chip span{display:block;font-size:.7rem;color:var(--soil)}.ag-chip strong{font-size:1.08rem;font-weight:600}
@keyframes agfloat{50%{transform:translateY(-10px)}}
.ag-coord{position:absolute;font-size:.68rem;color:var(--bot);background:rgba(244,238,223,.8);padding:2px 8px;border-radius:4px}

.ag-sand{background:var(--sand)}.ag-parch{background:var(--parch)}
.ag-twocol{display:grid;grid-template-columns:1.2fr 1fr;gap:56px;align-items:end;margin-bottom:64px}
.ag-reveal{opacity:0;transform:translateY(16px);transition:opacity .8s,transform .8s}
.ag-reveal.on{opacity:1;transform:none}

.ag-intel{display:grid;grid-template-columns:repeat(12,1fr);gap:22px}
.ag-intel-0{grid-column:1/6}.ag-intel-1{grid-column:6/13;margin-top:46px}.ag-intel-2{grid-column:1/8}.ag-intel-3{grid-column:8/13;margin-top:-34px}
.ag-block{height:100%;padding:34px;background:var(--off);border:1px solid rgba(146,116,81,.35);box-shadow:0 18px 30px -22px rgba(23,61,43,.45)}
.ag-intel-0 .ag-block{border-radius:42px 8px 42px 8px}.ag-intel-1 .ag-block{border-radius:8px 42px 8px 42px;background:var(--parch)}
.ag-intel-2 .ag-block{border-radius:8px 42px 8px 42px;background:var(--parch)}.ag-intel-3 .ag-block{border-radius:42px 8px 42px 8px}
.ag-block h3{margin:20px 0 10px}.ag-block p{margin:0;color:#2e4a3b;max-width:26rem}

.ag-steps{list-style:none;margin:72px 0 0;padding:0;display:grid;grid-template-columns:repeat(4,1fr);gap:28px;position:relative}
.ag-orbit{position:absolute;left:0;top:22px;width:100%;height:60px;pointer-events:none}
.ag-steps li{position:relative;padding-top:78px}
.ag-num{position:absolute;top:0;left:0;width:52px;height:52px;border-radius:50%;background:var(--forest);color:var(--sage);display:grid;place-items:center;font-size:1.15rem}
.ag-steps h3{margin-bottom:8px}.ag-steps p{margin:0;color:#2e4a3b;font-size:.97rem}

.ag-rots{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;align-items:stretch}
.ag-rots>div{display:flex}.ag-rot{flex:1;padding:30px;background:var(--off);border:1px solid rgba(146,116,81,.35);border-radius:6px 28px 6px 28px;box-shadow:0 18px 30px -22px rgba(23,61,43,.45)}
.ag-rot.feat{background:var(--forest);color:var(--off);border-color:var(--forest)}
.ag-note{font-size:.93rem;margin:10px 0 24px;min-height:3.4em;opacity:.85}
.ag-seq{display:flex;gap:6px;margin-bottom:26px}
.ag-seqi{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;font-size:.8rem}
.ag-link{position:absolute;top:22px;left:calc(50% + 28px);width:calc(100% - 56px);border-top:1.5px dashed var(--soil)}
.ag-ind{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.ag-ind li span{font-size:.8rem;display:block;margin-bottom:4px}
.ag-bar{height:7px;border-radius:9px;background:rgba(146,116,81,.25);overflow:hidden}
.ag-bar b{display:block;height:100%;background:var(--bot);border-radius:9px}
.ag-rot.feat .ag-bar{background:rgba(250,248,241,.2)}.ag-rot.feat .ag-bar b{background:var(--sage)}

.ag-dark{background:var(--forest);color:var(--off)}
.ag-replay-contours{left:-15%;bottom:-40%;width:75%}
.ag-replaygrid{display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:center}
.ag-replaygrid .ag-lead{margin:24px 0 32px}
.ag-tabs{display:flex;flex-wrap:wrap;gap:10px}
.ag-tabs button{font:inherit;font-weight:600;padding:11px 20px;border-radius:999px;border:1.5px solid var(--sage);background:transparent;color:var(--off);cursor:pointer;transition:background .25s,color .25s}
.ag-tabs button:hover{background:rgba(168,185,154,.2)}
.ag-tabs button.on{background:var(--sand);color:var(--forest);border-color:var(--sand)}
.ag-chart{background:var(--bot);border:1px solid rgba(168,185,154,.4);border-radius:8px 36px 8px 36px;padding:34px}
.ag-chart-t{font-size:1.5rem;margin:0}.ag-chart-s{margin:6px 0 26px;color:var(--sage);font-size:.9rem}
.ag-row{display:grid;grid-template-columns:150px 1fr 30px;gap:14px;align-items:center;margin-bottom:18px;font-size:.88rem}
.ag-row em{font-style:normal;text-align:right}
.ag-track{height:14px;border-radius:9px;background:rgba(0,0,0,.22);overflow:hidden}
.ag-track b{display:block;height:100%;border-radius:9px;transition:width .9s cubic-bezier(.2,.7,.2,1)}

.ag-src{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(5,1fr);border-top:1.5px solid var(--forest)}
.ag-src li{padding:26px 20px 8px 0;border-right:1px solid rgba(146,116,81,.4);padding-left:20px}
.ag-src li:first-child{padding-left:0}.ag-src li:last-child{border-right:0}
.ag-src small{color:var(--soil);font-weight:600;font-size:.72rem;display:block}.ag-src strong{font-size:1.8rem;font-weight:500;display:block}
.ag-src span{font-weight:600;font-size:.88rem;display:block;margin:4px 0 8px}.ag-src p{margin:0;font-size:.88rem;color:#2e4a3b}

.ag-final{padding:132px 0!important}.ag-final-contours{left:50%;top:50%;width:90%;transform:translate(-50%,-50%)}

.ag-foot{background:var(--forest);color:var(--off);padding:72px 0 28px}
.ag-footgrid{display:grid;grid-template-columns:1.6fr 1fr 1fr 1fr;gap:32px}
.ag-tag{margin:14px 0 0;color:var(--sage);max-width:18rem;font-size:.92rem}
.ag-foot h4{margin:0 0 12px;font-size:.85rem;color:var(--sage)}.ag-foot nav{display:flex;flex-direction:column;gap:8px;font-size:.93rem}
.ag-foot nav a:hover{color:var(--sage)}
.ag-foot2{display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-top:56px;padding-top:22px;border-top:1px solid rgba(168,185,154,.3);font-size:.82rem;color:var(--sage)}
.ag-foot2 p{margin:0}

@media(max-width:980px){
  .ag-links,.ag-navcta{display:none}.ag-burger{display:block}
  .ag-mobile{display:flex;flex-direction:column;gap:4px;max-height:0;overflow:hidden;padding:0 24px;background:var(--off);transition:max-height .4s,padding .4s}
  .ag-mobile.open{max-height:460px;padding:10px 24px 24px}.ag-mobile a:not(.ag-btn){padding:12px 0;border-bottom:1px solid rgba(146,116,81,.25)}
  .ag-mobile .ag-btn{margin-top:14px}
  .ag-herogrid,.ag-twocol,.ag-replaygrid{grid-template-columns:1fr;gap:36px}
  .ag-herovis{margin:0 auto}.ag .ag-intel>div{grid-column:1/-1!important;margin-top:0!important}
  .ag-steps{grid-template-columns:1fr 1fr;row-gap:44px}.ag-orbit{display:none}
  .ag-rots{grid-template-columns:1fr}.ag-src{grid-template-columns:1fr 1fr}
  .ag-src li{padding-left:0;border-right:0;border-bottom:1px solid rgba(146,116,81,.3);padding-bottom:20px}
  .ag-footgrid{grid-template-columns:1fr 1fr}.ag section{padding:80px 0}
}
@media(max-width:560px){.ag-steps{grid-template-columns:1fr}.ag-row{grid-template-columns:1fr 30px}.ag-row span{grid-column:1/-1}.ag-src{grid-template-columns:1fr}.ag-chip{transform:scale(.88)}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.ag *{animation:none!important;transition:none!important}.ag-reveal{opacity:1;transform:none}}
`;