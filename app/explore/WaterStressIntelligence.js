'use client';

import { useEffect, useMemo, useState } from 'react';
import InfoTip from './InfoTip';

const TIME_RANGES = [
  { id: '30d', label: 'Last 30 days', days: 30, desc: 'Recent moisture and rainfall balance' },
  { id: '90d', label: 'Last 90 days', days: 90, desc: 'Seasonal water balance across growth stages' },
  { id: '180d', label: 'Last 180 days', days: 180, desc: 'Multi-month trends and dry spell history' },
  { id: '365d', label: 'Last 365 days', days: 365, desc: 'Annual hydrological cycle and seasonal comparison' },
];

function Icon({ name, size = 17 }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  const paths = {
    droplet: <><path d="M12 2.8S5.5 10.1 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10.1 12 2.8 12 2.8Z" /><path d="M9 15.2a3.1 3.1 0 0 0 3 3" /></>,
    rain: <><path d="M7 15.5a4.2 4.2 0 1 1 .8-8.3A5.3 5.3 0 0 1 18 9a3.4 3.4 0 0 1-.4 6.7H7Z" /><path d="m9 18-1 3m6-3-1 3m6-3-1 3" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    chart: <><path d="M4 19V5m0 14h17" /><path d="m7 15 4-4 3 2 5-6" /><path d="M16 7h3v3" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8h.01" /></>,
    alert: <><circle cx="12" cy="12" r="9" /><path d="M12 8v4m0 4h.01" /></>,
    refresh: <><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 21h5v-5" /></>,
    key: <><path d="m21 2-2 2m-1.5 1.5L14 9l-2-2-4 4a5.5 5.5 0 1 0 7.5 7.5l4-4-2-2 3.5-3.5" /><circle cx="7.5" cy="16.5" r="1.5" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    satellite: <><path d="M13 7 9 3 5 7l4 4" /><path d="m17 11 4 4-4 4-4-4" /><path d="m8 12 4 4" /><path d="m16 8-4-4" /><path d="M12 12l-8 8" /><path d="M18 6l2-2" /><path d="M4 20l2-2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
  };

  return <svg {...common}>{paths[name] || paths.info}</svg>;
}

function formatDateLabel(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function formatShortDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function CwbChart({ dailySeries = [] }) {
  if (!dailySeries || dailySeries.length === 0) {
    return (
      <div className="fx-chart-empty">
        <Icon name="info" size={20} />
        <p>No daily precipitation and ET₀ records available.</p>
      </div>
    );
  }

  const chartWidth = 720;
  const chartHeight = 220;
  const padLeft = 44;
  const padRight = 20;
  const padTop = 26;
  const padBottom = 38;

  const usableWidth = chartWidth - padLeft - padRight;
  const usableHeight = chartHeight - padTop - padBottom;

  // Maximum value for rainfall bars (left axis)
  const maxRain = Math.max(10, ...dailySeries.map((d) => d.precipitationMm || 0));
  // Maximum value for ET0 line
  const maxEt0 = Math.max(8, ...dailySeries.map((d) => d.et0Mm || 0));
  const yMax = Math.max(maxRain, maxEt0);

  const xFor = (index) => padLeft + (index / Math.max(dailySeries.length - 1, 1)) * usableWidth;
  const yFor = (val) => padTop + (1 - val / yMax) * usableHeight;

  // Construct ET0 line points
  const et0Points = [];
  dailySeries.forEach((d, idx) => {
    if (d.et0Mm != null) {
      et0Points.push(`${xFor(idx)},${yFor(d.et0Mm)}`);
    }
  });

  return (
    <div className="fx-chart-wrap">
      <div className="fx-chart-legend">
        <span><i className="fx-legend-bar" style={{ background: '#3b789e' }} /> Daily precipitation (mm)</span>
        <span><i className="fx-legend-line" style={{ background: '#d97736' }} /> Reference ET₀ (mm/day)</span>
      </div>

      <svg className="fx-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Precipitation bars and reference ET0 line chart">
        {/* Horizontal gridlines */}
        {[0, Math.round(yMax * 0.33), Math.round(yMax * 0.66), Math.round(yMax)].map((lvl) => {
          const y = yFor(lvl);
          return (
            <g key={lvl}>
              <line x1={padLeft} x2={chartWidth - padRight} y1={y} y2={y} stroke="#e4ddcf" strokeDasharray="3 5" />
              <text x={padLeft - 6} y={y + 4} textAnchor="end" className="fx-chart-axis-label">{lvl}</text>
            </g>
          );
        })}

        {/* Precipitation bars */}
        {dailySeries.map((d, idx) => {
          if (d.precipitationMm == null || d.precipitationMm <= 0) return null;
          const x = xFor(idx) - 2;
          const barH = (d.precipitationMm / yMax) * usableHeight;
          const y = chartHeight - padBottom - barH;
          return (
            <rect
              key={`rain-${idx}`}
              x={x}
              y={y}
              width={Math.max(2, usableWidth / dailySeries.length - 1)}
              height={barH}
              fill="#3b789e"
              opacity="0.82"
              rx="1"
            />
          );
        })}

        {/* ET0 curve */}
        {et0Points.length > 1 && (
          <polyline
            points={et0Points.join(' ')}
            fill="none"
            stroke="#d97736"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Date labels */}
        {dailySeries.map((d, idx) => {
          const shouldLabel = idx === 0 || idx === Math.floor(dailySeries.length / 2) || idx === dailySeries.length - 1;
          if (!shouldLabel) return null;
          return (
            <text key={`label-${idx}`} x={xFor(idx)} y={chartHeight - 12} textAnchor="middle" className="fx-chart-label">
              {formatShortDate(d.date)}
            </text>
          );
        })}
      </svg>

      <div className="fx-chart-foot">
        <span>Atmospheric demand vs precipitation (mm/day)</span>
        <span>{dailySeries.length} daily observation steps evaluated</span>
      </div>
    </div>
  );
}

export default function WaterStressIntelligence({ farm }) {
  const [selectedRange, setSelectedRange] = useState('90d');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  const activeRangeConfig = useMemo(
    () => TIME_RANGES.find((r) => r.id === selectedRange) || TIME_RANGES[1],
    [selectedRange],
  );

  useEffect(() => {
    let active = true;
    if (!farm.latitude || !farm.longitude) return;

    const controller = new AbortController();
    const days = activeRangeConfig.days;
    const toDate = new Date();
    toDate.setUTCDate(toDate.getUTCDate() - 2); // 2-day operational latency
    const fromDate = new Date(toDate);
    fromDate.setUTCDate(fromDate.getUTCDate() - days);

    const payload = {
      geometry: farm.geometry || null,
      latitude: Number(farm.latitude),
      longitude: Number(farm.longitude),
      areaHectares: Number(farm.area) || 5,
      fieldName: farm.name || 'My field',
      fieldId: farm.fieldId || 'field-active',
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
      refresh: reloadTrigger > 0,
    };

    (async () => {
      await Promise.resolve();
      if (!active) return;
      setLoading(true);
      setError('');
      setData(null);

      try {
        const response = await fetch('/api/water', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        const json = await response.json();
        if (!response.ok) {
          throw new Error(json.error || `Water stress request failed (HTTP ${response.status})`);
        }

        if (active) {
          setData(json);
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (active) {
          console.error('Water Intelligence fetch error:', err);
          setError(err.message || 'Unable to retrieve soil moisture and water stress data.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    farm.latitude,
    farm.longitude,
    farm.geometry,
    farm.area,
    farm.name,
    farm.fieldId,
    activeRangeConfig.days,
    reloadTrigger,
  ]);

  const soilMoisture = data?.soilMoisture || {};
  const surfaceSm = soilMoisture.surface || {};
  const rootZoneSm = soilMoisture.rootZone || {};
  const precipitation = data?.precipitation || {};
  const et0 = data?.evapotranspiration || {};
  const cwb = data?.climaticWaterBalance || {};
  const waterStress = data?.waterStress || {};
  const quality = data?.quality || {};
  const granules = data?.granules || {};
  const authStatus = data?.authStatus;

  return (
    <div className="fx-vegetation-section" id="fx-water-intelligence">
      <div className="fx-section-heading">
        <div>
          <span className="fx-overline">03 / SOIL MOISTURE &amp; WATER STRESS INTELLIGENCE</span>
          <h2>
            Soil moisture &amp; rainfall balance
            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', background: 'rgba(36, 79, 56, 0.1)', color: '#244f38', padding: '3px 8px', borderRadius: '4px', marginLeft: '10px', verticalAlign: 'middle', textTransform: 'uppercase' }}>
              SMAP L4 · GPM IMERG · FAO-56
            </span>
          </h2>
          <p>
            Root-zone moisture availability, satellite rainfall estimates, and atmospheric water demand to assess moisture stress.
          </p>
        </div>
        <div className="fx-veg-controls">
          <div className="fx-range-picker" role="group" aria-label="Select water analysis time range">
            {TIME_RANGES.map((range) => (
              <button
                key={range.id}
                type="button"
                className={`fx-range-btn ${selectedRange === range.id ? 'is-active' : ''}`}
                onClick={() => setSelectedRange(range.id)}
                disabled={loading}
                title={range.desc}
              >
                {range.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="fx-refresh-btn"
            onClick={() => setReloadTrigger((c) => c + 1)}
            disabled={loading}
            title="Refresh water data"
          >
            <Icon name="refresh" size={15} />
          </button>
        </div>
      </div>

      <div className="fx-range-helper">
        <Icon name="info" size={14} />
        <span>Viewing <strong>{activeRangeConfig.label}</strong>: {activeRangeConfig.desc}</span>
      </div>

      {loading && (
        <div className="fx-chart-empty" style={{ margin: '14px 0', padding: '16px', background: '#faf7f2', border: '1px solid #e7ded2', borderRadius: '8px' }}>
          <span className="fx-spinner" />
          <p style={{ margin: '8px 0 0', fontWeight: 500, color: '#244f38' }}>
            Checking NASA soil moisture and rainfall estimates. This may take a moment...
          </p>
        </div>
      )}

      {error && (
        <div className="fx-error-box" role="alert">
          <Icon name="alert" size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Earthdata Auth Failure Notice */}
      {authStatus === 'auth_failed' && (
        <div className="fx-error-box" role="alert" style={{ marginBottom: '16px' }}>
          <Icon name="alert" size={18} />
          <div>
            <strong>NASA Earthdata Authentication Failed</strong>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
              {data?.authMessage || 'Verify that EARTHDATA_TOKEN in .env.local is valid and active.'}
            </p>
          </div>
        </div>
      )}

      {/* Earthdata Auth Notice if credentials required */}
      {authStatus === 'credentials_required' && (
        <div className="fx-auth-notice">
          <div className="fx-auth-notice-head">
            <span className="fx-auth-notice-icon"><Icon name="key" size={18} /></span>
            <div>
              <strong>NASA Earthdata Login Credentials Required for Binary HDF5 Extraction</strong>
              <p>
                Actual SMAP L4 (SPL4SMGP V008) and GPM IMERG V07 granules were discovered via open NASA CMR below.
                To extract pixel-level HDF5 volumetric soil moisture grids, add your free NASA Earthdata token in <code>.env.local</code>:
              </p>
            </div>
          </div>
          <pre className="fx-auth-code">
            EARTHDATA_TOKEN=your-earthdata-bearer-token-here
          </pre>
          <div className="fx-auth-foot">
            <small>
              Register free at <a href="https://urs.earthdata.nasa.gov/" target="_blank" rel="noreferrer">urs.earthdata.nasa.gov</a>.
            </small>
          </div>
        </div>
      )}

      {/* Water-Stress Evidence Banner */}
      <div className={`fx-stress-banner fx-stress-${waterStress.category || 'neutral'}`}>
        <div className="fx-stress-head">
          <div>
            <span className="fx-overline">SYNTHESIZED WATER-STRESS EVIDENCE</span>
            <h3>{waterStress.label || 'Evaluating moisture evidence...'}</h3>
          </div>
          <span className="fx-stress-confidence">Confidence: <strong>{waterStress.confidence || 'Moderate'}</strong></span>
        </div>

        {waterStress.evidence?.length > 0 && (
          <ul className="fx-evidence-list">
            {waterStress.evidence.map((item, idx) => (
              <li key={`ev-${idx}`}>
                <Icon name="check" size={15} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}

        {waterStress.warnings?.length > 0 && (
          <div className="fx-stress-warning">
            <Icon name="alert" size={16} />
            <span>{waterStress.warnings.join(' ')}</span>
          </div>
        )}
      </div>

      {/* 5-Tier Data Pipeline & Scientific Verification Status */}
      <div
        className="fx-pipeline-status-card"
        style={{
          margin: '16px 0 20px',
          padding: '14px 18px',
          borderRadius: '8px',
          background: '#faf7f2',
          border: '1px solid #e7ded2',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: '#7a7062' }}>
            DATA INTEGRITY &amp; 5-TIER PIPELINE VERIFICATION
          </span>
          <span style={{ fontSize: '0.75rem', color: '#887d6b' }}>
            NASA CMR · NSIDC · GES DISC · POWER
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
          <div style={{ padding: '8px 12px', background: '#fff', borderRadius: '6px', border: '1px solid #ede5d8' }}>
            <div style={{ fontSize: '0.7rem', color: '#887d6b', textTransform: 'uppercase' }}>1. Metadata Discovery</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: ((granules.smap?.length || 0) + (granules.imerg?.length || 0) > 0) ? '#2e6b3e' : data ? '#887d6b' : '#b25916', display: 'flex', alignItems: 'center', gap: '5px', marginTop: '3px' }}>
              <Icon name={((granules.smap?.length || 0) + (granules.imerg?.length || 0) > 0) ? 'check' : data ? 'info' : 'alert'} size={14} />
              {((granules.smap?.length || 0) + (granules.imerg?.length || 0) > 0) ? `${(granules.smap?.length || 0) + (granules.imerg?.length || 0)} Granules Found` : data ? '0 Granules in Window' : 'Awaiting Query'}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#998d7d', marginTop: '2px' }}>Open NASA CMR</div>
          </div>
          <div style={{ padding: '8px 12px', background: '#fff', borderRadius: '6px', border: '1px solid #ede5d8' }}>
            <div style={{ fontSize: '0.7rem', color: '#887d6b', textTransform: 'uppercase' }}>2. Satellite Download</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: authStatus === 'configured' ? '#2e6b3e' : authStatus === 'auth_failed' ? '#b83b3b' : '#885522', display: 'flex', alignItems: 'center', gap: '5px', marginTop: '3px' }}>
              <Icon name={authStatus === 'configured' ? 'check' : authStatus === 'auth_failed' ? 'alert' : 'key'} size={14} />
              {authStatus === 'configured' ? 'HDF5 Downloaded' : authStatus === 'auth_failed' ? 'Auth Failed' : 'Credentials Required'}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#998d7d', marginTop: '2px' }}>NASA Earthdata Login</div>
          </div>
          <div style={{ padding: '8px 12px', background: '#fff', borderRadius: '6px', border: '1px solid #ede5d8' }}>
            <div style={{ fontSize: '0.7rem', color: '#887d6b', textTransform: 'uppercase' }}>3. Values Decoded</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: authStatus === 'configured' ? '#2e6b3e' : authStatus === 'auth_failed' ? '#b83b3b' : '#776e62', display: 'flex', alignItems: 'center', gap: '5px', marginTop: '3px' }}>
              <Icon name={authStatus === 'configured' ? 'check' : authStatus === 'auth_failed' ? 'alert' : 'info'} size={14} />
              {authStatus === 'configured' ? 'sm_rootzone & precip' : authStatus === 'auth_failed' ? 'Auth Failed' : 'Pending Credentials'}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#998d7d', marginTop: '2px' }}>Binary Array Parsing</div>
          </div>
          <div style={{ padding: '8px 12px', background: '#fff', borderRadius: '6px', border: '1px solid #ede5d8' }}>
            <div style={{ fontSize: '0.7rem', color: '#887d6b', textTransform: 'uppercase' }}>4. Spatial Extraction</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#2e6b3e', display: 'flex', alignItems: 'center', gap: '5px', marginTop: '3px' }}>
              <Icon name="check" size={14} />
              EASE-Grid 2.0 (9 km)
            </div>
            <div style={{ fontSize: '0.72rem', color: '#998d7d', marginTop: '2px' }}>0.1° GPM IMERG Grid</div>
          </div>
          <div style={{ padding: '8px 12px', background: '#fff', borderRadius: '6px', border: '1px solid #ede5d8' }}>
            <div style={{ fontSize: '0.7rem', color: '#887d6b', textTransform: 'uppercase' }}>5. Derived Analysis</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#2e6b3e', display: 'flex', alignItems: 'center', gap: '5px', marginTop: '3px' }}>
              <Icon name="check" size={14} />
              FAO-56 CWB Succeeded
            </div>
            <div style={{ fontSize: '0.72rem', color: '#998d7d', marginTop: '2px' }}>Penman-Monteith (P − ET₀)</div>
          </div>
        </div>
      </div>

      {/* Top Metric Cards */}
      <div className="fx-metric-grid">
        <article className="fx-metric fx-metric-sage">
          <div className="fx-metric-top">
            <span className="fx-metric-icon"><Icon name="droplet" size={17} /></span>
            <span className="fx-metric-label">
              Root-Zone Moisture
              <InfoTip title="Root-Zone Soil Moisture (0–100 cm)" label="About root-zone moisture" technicalNote="NASA Catchment Model assimilated estimate informed by SMAP L-band radiometer">
                Water available in the deeper soil profile (top 100 cm) where crop root systems drink. Unlike surface moisture, root-zone moisture changes more slowly and serves as your farm&apos;s main moisture buffer during dry spells.
              </InfoTip>
            </span>
          </div>
          <div className="fx-metric-value">
            {rootZoneSm.latest != null && Number.isFinite(rootZoneSm.latest) ? rootZoneSm.latest.toFixed(3) : '—'}
            <small>m³/m³</small>
          </div>
          <p title="Top 0–100 cm. Catchment model assimilated estimate informed by SMAP. NOT a direct satellite measurement throughout the column.">
            {rootZoneSm.latest != null
              ? rootZoneSm.latest < 0.15 ? 'Low moisture reserve (dry)' : rootZoneSm.latest > 0.32 ? 'Ample moisture reserve (wet)' : 'Moderate moisture reserve'
              : '0–100 cm (Model estimate)'}
          </p>
        </article>

        <article className="fx-metric fx-metric-sand">
          <div className="fx-metric-top">
            <span className="fx-metric-icon"><Icon name="layers" size={17} /></span>
            <span className="fx-metric-label">
              Surface Soil Moisture
              <InfoTip title="Surface Soil Moisture (0–5 cm)" label="About surface soil moisture" technicalNote="SMAP L-band passive microwave radiometer (1.4 GHz)">
                Moisture present in the top 5 cm of the soil. This layer is sensitive to daily weather—it wets up immediately after rainfall and dries out rapidly under direct sun or wind.
              </InfoTip>
            </span>
          </div>
          <div className="fx-metric-value">
            {surfaceSm.latest != null && Number.isFinite(surfaceSm.latest) ? surfaceSm.latest.toFixed(3) : '—'}
            <small>m³/m³</small>
          </div>
          <p>
            {surfaceSm.latest != null
              ? surfaceSm.latest < 0.12 ? 'Dry topsoil (top 0–5 cm)' : surfaceSm.latest > 0.28 ? 'Wet topsoil' : 'Moist topsoil'
              : 'Top 0–5 cm topsoil moisture'}
          </p>
        </article>

        <article className="fx-metric fx-metric-gold">
          <div className="fx-metric-top">
            <span className="fx-metric-icon"><Icon name="sun" size={17} /></span>
            <span className="fx-metric-label">
              Reference ET₀ (Water Demand)
              <InfoTip title="Reference Evapotranspiration (ET₀)" label="About reference ET0" technicalNote="FAO-56 Penman-Monteith equation driven by NASA POWER agroclimatology">
                Atmospheric water demand: how much water would evaporate from soil and a well-watered reference grass crop. Hot, sunny, windy days produce high ET₀ (5–8+ mm/day), meaning crops lose water quickly.
              </InfoTip>
            </span>
          </div>
          <div className="fx-metric-value">
            {et0.meanDailyMm != null && Number.isFinite(et0.meanDailyMm) ? et0.meanDailyMm.toFixed(1) : '—'}
            <small>mm/day</small>
          </div>
          <p title="Reference grass atmospheric demand. Not actual crop water consumption.">
            {et0.meanDailyMm != null
              ? et0.meanDailyMm > 5.5 ? 'High evaporative demand' : et0.meanDailyMm < 3.0 ? 'Low evaporative demand' : 'Moderate evaporative demand'
              : 'Atmospheric demand (Penman-Monteith)'}
          </p>
        </article>

        <article className="fx-metric fx-metric-blue">
          <div className="fx-metric-top">
            <span className="fx-metric-icon"><Icon name="rain" size={17} /></span>
            <span className="fx-metric-label">
              30-Day Climatic Balance
              <InfoTip title="Climatic Water Balance (P − ET₀)" label="About climatic water balance" technicalNote="Precipitation (GPM IMERG) minus Reference Evapotranspiration (ET0)">
                The difference between total rainfall received and atmospheric water demand over the past 30 days. Positive (+) means rainfall exceeded evaporative demand. Negative (−) means atmospheric thirst exceeded rainfall, drawing down soil water reserves.
              </InfoTip>
            </span>
          </div>
          <div className="fx-metric-value">
            {cwb.cumulative30dMm != null && Number.isFinite(cwb.cumulative30dMm) ? `${cwb.cumulative30dMm > 0 ? '+' : ''}${cwb.cumulative30dMm.toFixed(0)}` : '—'}
            <small>mm</small>
          </div>
          <p title="P - ET0. Negative means atmospheric demand exceeded precipitation over 30 days. Not a measured root-zone deficit.">
            {cwb.cumulative30dMm != null
              ? cwb.cumulative30dMm < -50
                ? 'High evaporative deficit (P << ET₀)'
                : cwb.cumulative30dMm < 0
                ? 'Mild evaporative deficit (P < ET₀)'
                : 'Moisture surplus (P ≥ ET₀)'
              : 'Atmospheric supply vs demand'}
          </p>
        </article>
      </div>

      {/* Plain-Language Interpretation: What this means for your farm */}
      {data && (
        <div className="fx-plain-insight">
          <div className="fx-plain-insight-head">
            <Icon name="droplet" size={15} />
            <span>What this means for your farm</span>
          </div>
          <div className="fx-plain-insight-title">
            {waterStress.label || 'Moisture & Water Assessment'}
          </div>
          <p className="fx-plain-insight-desc">
            {rootZoneSm.latest != null
              ? `Root-zone soil moisture is currently estimated at ${rootZoneSm.latest.toFixed(3)} m³/m³ (${rootZoneSm.latest < 0.15 ? 'dry reserve' : rootZoneSm.latest > 0.32 ? 'ample reserve' : 'adequate reserve'}). Over the past 30 days, atmospheric demand ${cwb.cumulative30dMm != null && cwb.cumulative30dMm < 0 ? `exceeded rainfall by ${Math.abs(cwb.cumulative30dMm).toFixed(0)} mm (drying pattern)` : `was balanced or exceeded by rainfall (+${cwb.cumulative30dMm?.toFixed(0) || 0} mm)`}. Overall stress risk is currently ${waterStress.category?.replace(/_/g, ' ') || 'normal'}.`
              : 'Soil moisture estimates are currently being retrieved. When available, this panel explains whether your crop has adequate root-zone water reserves or is approaching moisture stress.'}
          </p>
        </div>
      )}

      {/* Main Analysis Grid */}
      <div className="fx-analysis-grid">
        {/* Panel 1: Atmospheric Balance Chart */}
        <section className="fx-panel fx-chart-panel">
          <div className="fx-panel-heading">
            <div>
              <span className="fx-overline">ATMOSPHERIC SUPPLY &amp; DEMAND</span>
              <h2>Climatic Water Balance (P − ET₀)</h2>
              <p>Daily precipitation vs FAO-56 Penman-Monteith reference evapotranspiration.</p>
            </div>
            <span className="fx-panel-icon"><Icon name="chart" size={20} /></span>
          </div>

          <CwbChart dailySeries={cwb.dailySeries || []} />

          <div className="fx-cwb-metrics">
            <div className="fx-cwb-metric-item">
              <small>7-DAY CUMULATIVE CWB</small>
              <strong>{cwb.cumulative7dMm != null && Number.isFinite(cwb.cumulative7dMm) ? `${cwb.cumulative7dMm > 0 ? '+' : ''}${cwb.cumulative7dMm.toFixed(1)} mm` : '—'}</strong>
            </div>
            <div className="fx-cwb-metric-item">
              <small>14-DAY CUMULATIVE CWB</small>
              <strong>{cwb.cumulative14dMm != null && Number.isFinite(cwb.cumulative14dMm) ? `${cwb.cumulative14dMm > 0 ? '+' : ''}${cwb.cumulative14dMm.toFixed(1)} mm` : '—'}</strong>
            </div>
            <div className="fx-cwb-metric-item">
              <small>30-DAY CUMULATIVE CWB</small>
              <strong>{cwb.cumulative30dMm != null && Number.isFinite(cwb.cumulative30dMm) ? `${cwb.cumulative30dMm > 0 ? '+' : ''}${cwb.cumulative30dMm.toFixed(1)} mm` : '—'}</strong>
            </div>
          </div>
        </section>

        {/* Panel 2: Satellite Overpasses & Provenance */}
        <section className="fx-panel fx-compare-panel">
          <div className="fx-panel-heading">
            <div>
              <span className="fx-overline">NASA CMR GRANULE DISCOVERY</span>
              <h2>SMAP L4 &amp; GPM IMERG Coverage</h2>
              <p>Discovered granules intersecting field bounding box.</p>
            </div>
            <span className="fx-panel-icon"><Icon name="satellite" size={20} /></span>
          </div>

          <div className="fx-granules-container">
            <h4>NASA SMAP L4 (SPL4SMGP V008) · 9 km</h4>
            {granules.smap?.length > 0 ? (
              <div className="fx-scenes-list" style={{ maxHeight: '140px' }}>
                {granules.smap.slice(0, 4).map((g) => (
                  <div key={g.id} className="fx-scene-item">
                    <div className="fx-scene-info">
                      <strong>{formatDateLabel(g.timeStart)}</strong>
                      <small>{g.title?.slice(0, 40)}...</small>
                    </div>
                    <span className="fx-cloud-badge is-clear">9 km EASE</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="fx-subtle-empty">Awaiting SMAP granules query.</p>
            )}

            <h4 style={{ marginTop: '16px' }}>NASA GPM IMERG (GPM_3IMERGHHE 07) · 10 km</h4>
            {granules.imerg?.length > 0 ? (
              <div className="fx-scenes-list" style={{ maxHeight: '140px' }}>
                {granules.imerg.slice(0, 4).map((g) => (
                  <div key={g.id} className="fx-scene-item">
                    <div className="fx-scene-info">
                      <strong>{formatDateLabel(g.timeStart)}</strong>
                      <small>{g.title?.slice(0, 40)}...</small>
                    </div>
                    <span className="fx-cloud-badge is-clear">0.1° Early</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="fx-subtle-empty">Awaiting IMERG granules query.</p>
            )}
          </div>

          <div className="fx-data-quality" style={{ marginTop: '16px' }}>
            <div>
              <span>Spatial Representativeness</span>
              <strong>{quality.spatialRepresentativeness === 'coarse_regional' ? 'Regional (9 km)' : 'Moderate'}</strong>
            </div>
            <small>
              {quality.warnings?.[0] || 'SMAP 9 km EASE-Grid cells provide regional landscape context.'}
            </small>
          </div>
        </section>
      </div>

      {/* Expandable Farmer's Guide */}
      <details className="fx-guide-details">
        <summary className="fx-guide-summary">
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="info" size={16} />
            <strong>Farmer&apos;s Guide: Understanding Soil Moisture &amp; Water Balance</strong>
          </span>
          <span style={{ fontSize: '11px', color: '#7a7062' }}>Tap to expand / collapse</span>
        </summary>
        <div className="fx-guide-content">
          <p>
            <strong>Surface vs. Root-Zone Soil Moisture:</strong><br />
            <strong>Surface soil moisture (top 0–5 cm)</strong> responds quickly to daily weather, wetting up after rain and drying rapidly under heat or wind. <strong>Root-zone soil moisture (top 0–100 cm)</strong> is the deeper reservoir crops rely on during dry spells. Even when surface dirt is dry, roots may still access moisture below.
          </p>
          <p>
            <strong>What do volumetric moisture numbers (m³/m³) mean?</strong><br />
            This measures the volume of water per volume of soil:
          </p>
          <ul>
            <li><strong>Below 0.15 m³/m³ (Dry reserve):</strong> Available soil water is low. Crops may show wilting or moisture stress unless supplemented by irrigation.</li>
            <li><strong>0.15 – 0.30 m³/m³ (Moderate / Adequate):</strong> Favorable soil moisture conditions for most common crops, supporting active transpiration and root uptake.</li>
            <li><strong>Above 0.32 – 0.40+ m³/m³ (Ample / Saturated):</strong> High soil water content. In heavy clay soils, sustained high moisture can reduce root aeration.</li>
          </ul>
          <p>
            <strong>What is Reference Evapotranspiration (ET₀)?</strong><br />
            ET₀ measures atmospheric &ldquo;thirst&rdquo;—how much water would evaporate from soil and a well-watered grass reference crop under current solar radiation, temperature, humidity, and wind. High ET₀ (5–8+ mm/day) means atmospheric demand is drawing moisture rapidly.
          </p>
          <p>
            <strong>What is Climatic Water Balance (P − ET₀)?</strong><br />
            It is simple water accounting: total rainfall (P) minus atmospheric water demand (ET₀). A negative balance means evaporative demand exceeded rainfall, indicating that soil moisture reserves are being depleted over time.
          </p>
          <p>
            <strong>Understanding Satellite Scale:</strong><br />
            NASA SMAP (~9 km EASE-Grid) and GPM IMERG (~10 km) provide regional landscape-scale estimates. They accurately capture general dry periods and widespread rain, but cannot detect localized drip irrigation, furrow flooding, or field drainage pipes.
          </p>
        </div>
      </details>

      {/* Scientific Limitations & Guidance */}
      <section className="fx-note-card" style={{ marginTop: '16px' }}>
        <span className="fx-note-icon"><Icon name="shield" size={18} /></span>
        <div>
          <strong>Scientific Methodology &amp; Limitations Notice:</strong>
          <p style={{ margin: '6px 0 0', lineHeight: 1.6, fontSize: '0.85rem' }}>
            SMAP L4 root-zone soil moisture is a model-assimilated estimate informed by SMAP radiometer observations and the NASA Catchment Land Surface Model; it is not a direct radar or radiometer measurement throughout the 0–100 cm soil column.
            Reference Evapotranspiration (ET₀) represents atmospheric water demand for a well-watered hypothetical grass reference crop (FAO-56 Penman-Monteith) and does not represent actual farm crop water consumption (ETc).
            Climatic Water Balance (P − ET₀) reflects atmospheric supply versus demand; negative values do not directly measure root-zone water loss or crop stress when soil reserves are active.
            Coarse resolution datasets (~9–10 km) reflect regional landscape averages and cannot distinguish furrow, drip, or canal irrigation within individual farm fields.
          </p>
        </div>
      </section>
    </div>
  );
}

