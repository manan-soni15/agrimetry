'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import InfoTip from './InfoTip';

const TIME_RANGES = [
  { id: '30d', label: 'Last 30 days', days: 30, interval: 'P5D', desc: 'Recent vegetation conditions' },
  { id: '90d', label: 'Last 90 days', days: 90, interval: 'P10D', desc: 'Short-term vegetation patterns' },
  { id: '180d', label: 'Last 180 days', days: 180, interval: 'P15D', desc: 'Seasonal changes across crop stages' },
  { id: '365d', label: 'Last 365 days', days: 365, interval: 'P15D', desc: 'Longer-term annual vegetation patterns' },
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
    leaf: <><path d="M20.5 3.5C12 3.5 5 6.6 5 13.2c0 3.3 2.3 5.3 5.2 5.3 6.3 0 9.9-7.3 10.3-15Z"/><path d="M3.5 21c3.1-5.1 7.4-8.4 13-11"/><path d="M5.3 14.2c2 .2 3.5.9 4.7 2.2"/></>,
    satellite: <><path d="M13 7 9 3 5 7l4 4"/><path d="m17 11 4 4-4 4-4-4"/><path d="m8 12 4 4"/><path d="m16 8-4-4"/><path d="M12 12l-8 8"/><path d="M18 6l2-2"/><path d="M4 20l2-2"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    chart: <><path d="M4 19V5m0 14h17"/><path d="m7 15 4-4 3 2 5-6"/><path d="M16 7h3v3"/></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    alert: <><circle cx="12" cy="12" r="9"/><path d="M12 8v4m0 4h.01"/></>,
    refresh: <><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    key: <><path d="m21 2-2 2m-1.5 1.5L14 9l-2-2-4 4a5.5 5.5 0 1 0 7.5 7.5l4-4-2-2 3.5-3.5"/><circle cx="7.5" cy="16.5" r="1.5"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
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

function NdviTimeseriesChart({ timeseries = [] }) {
  if (!timeseries || timeseries.length === 0) {
    return (
      <div className="fx-chart-empty">
        <Icon name="info" size={20} />
        <p>No valid satellite observation intervals in this period.</p>
      </div>
    );
  }

  const validItems = timeseries.filter((item) => item.hasValidObservations && item.mean !== null);
  const chartWidth = 720;
  const chartHeight = 220;
  const padLeft = 46;
  const padRight = 24;
  const padTop = 32;
  const padBottom = 42;

  const usableWidth = chartWidth - padLeft - padRight;
  const usableHeight = chartHeight - padTop - padBottom;

  // NDVI bounds: default display -0.1 to 1.0
  const yMin = -0.1;
  const yMax = 0.95;

  const xFor = (index) => padLeft + (index / Math.max(timeseries.length - 1, 1)) * usableWidth;
  const yFor = (val) => padTop + (1 - (val - yMin) / (yMax - yMin)) * usableHeight;

  // Construct mean line
  const meanPoints = [];
  timeseries.forEach((item, index) => {
    if (item.hasValidObservations && item.mean !== null) {
      meanPoints.push(`${xFor(index)},${yFor(item.mean)}`);
    }
  });

  // Construct percentile polygon envelope (p10 to p90)
  const topPoints = [];
  const bottomPoints = [];
  timeseries.forEach((item, index) => {
    if (item.hasValidObservations && item.percentiles?.p10 != null && item.percentiles?.p90 != null) {
      topPoints.push(`${xFor(index)},${yFor(item.percentiles.p90)}`);
      bottomPoints.unshift(`${xFor(index)},${yFor(item.percentiles.p10)}`);
    }
  });

  const envelopePath = topPoints.length > 1 ? [...topPoints, ...bottomPoints].join(' ') : null;

  return (
    <div className="fx-chart-wrap">
      <div className="fx-chart-legend">
        <span><i className="fx-legend-line" style={{ background: '#244f38' }} /> Mean field NDVI</span>
        <span><i className="fx-legend-envelope" /> 10th–90th percentile distribution (canopy variation)</span>
        <span><i className="fx-legend-masked" /> Cloud/shadow masked</span>
      </div>

      <svg className="fx-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Sentinel-2 NDVI time series chart">
        {/* Horizontal gridlines */}
        {[0.0, 0.2, 0.4, 0.6, 0.8].map((level) => {
          const y = yFor(level);
          return (
            <g key={level}>
              <line x1={padLeft} x2={chartWidth - padRight} y1={y} y2={y} stroke="#e4ddcf" strokeDasharray="3 5" />
              <text x={padLeft - 8} y={y + 4} textAnchor="end" className="fx-chart-axis-label">{level.toFixed(1)}</text>
            </g>
          );
        })}

        {/* Shaded percentile envelope */}
        {envelopePath && (
          <polygon points={envelopePath} fill="#a8b99a" opacity="0.32" />
        )}

        {/* Masked interval indicators */}
        {timeseries.map((item, index) => {
          if (!item.hasValidObservations) {
            const x = xFor(index);
            return (
              <g key={`masked-${index}`}>
                <line x1={x} x2={x} y1={padTop} y2={chartHeight - padBottom} stroke="#d2bba3" strokeDasharray="2 3" opacity="0.65" />
                <circle cx={x} cy={chartHeight - padBottom - 8} r="3" fill="#b86f55" opacity="0.75" />
              </g>
            );
          }
          return null;
        })}

        {/* Mean line */}
        {meanPoints.length > 1 && (
          <polyline points={meanPoints.join(' ')} fill="none" stroke="#244f38" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* Data points */}
        {timeseries.map((item, index) => {
          if (item.hasValidObservations && item.mean !== null) {
            const cx = xFor(index);
            const cy = yFor(item.mean);
            return (
              <g key={`pt-${index}`}>
                <circle cx={cx} cy={cy} r="4.2" fill="#244f38" stroke="#fbf9f3" strokeWidth="1.8" />
              </g>
            );
          }
          return null;
        })}

        {/* X-axis date labels */}
        {timeseries.map((item, index) => {
          // Label first, middle, and last to prevent crowding
          const shouldLabel = index === 0 || index === Math.floor(timeseries.length / 2) || index === timeseries.length - 1;
          if (!shouldLabel) return null;
          return (
            <text key={`label-${index}`} x={xFor(index)} y={chartHeight - 14} textAnchor="middle" className="fx-chart-label">
              {formatShortDate(item.from)}
            </text>
          );
        })}
      </svg>
      <div className="fx-chart-foot">
        <span>Sentinel-2 L2A Surface Reflectance (10 m native)</span>
        <span>{validItems.length} valid interval(s) of {timeseries.length} requested</span>
      </div>
    </div>
  );
}

export default function VegetationIntelligence({ farm }) {
  const [selectedRange, setSelectedRange] = useState('90d');
  const [includeWater, setIncludeWater] = useState(false);
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
    const interval = activeRangeConfig.interval;

    const toDate = new Date();
    const fromDate = new Date(Date.now() - days * 86400000);

    const payload = {
      geometry: farm.geometry || null,
      latitude: Number(farm.latitude),
      longitude: Number(farm.longitude),
      areaHectares: Number(farm.area) || 2,
      fieldName: farm.name || 'My field',
      fieldId: farm.fieldId || 'field-active',
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
      interval,
      includeWater,
      refresh: reloadTrigger > 0,
    };

    (async () => {
      await Promise.resolve();
      if (!active) return;
      setLoading(true);
      setError('');
      setData(null);

      try {
        const response = await fetch('/api/vegetation', {
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
          throw new Error(json.error || `Satellite request failed (HTTP ${response.status})`);
        }

        if (active) {
          setData(json);
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (active) {
          console.error('Vegetation Intelligence fetch error:', err);
          setError(err.message || 'Unable to retrieve Sentinel-2 vegetation intelligence.');
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
    activeRangeConfig.interval,
    includeWater,
    reloadTrigger,
  ]);

  const latest = data?.latest || {};
  const condition = data?.condition || {};
  const trend = data?.trend || {};
  const quality = data?.quality || {};
  const scenes = data?.scenes || [];
  const authStatus = data?.authStatus;

  return (
    <div className="fx-vegetation-section">
      <div className="fx-section-heading">
        <div>
          <span className="fx-overline">02 / SATELLITE VEGETATION INTELLIGENCE</span>
          <h2>
            Satellite vegetation observations
            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', background: 'rgba(36, 79, 56, 0.1)', color: '#244f38', padding: '3px 8px', borderRadius: '4px', marginLeft: '10px', verticalAlign: 'middle', textTransform: 'uppercase' }}>
              Sentinel-2 Level-2A (10 m)
            </span>
          </h2>
          <p>
            Field greenness and crop growth monitored from orbit at 10-meter native detail, with automated cloud and shadow exclusion.
          </p>
        </div>
        <div className="fx-veg-controls">
          <div className="fx-range-picker" role="group" aria-label="Select satellite observation time range">
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
            title="Refresh satellite data"
          >
            <Icon name="refresh" size={15} />
          </button>
        </div>
      </div>

      <div className="fx-range-helper">
        <Icon name="info" size={14} />
        <span>Viewing <strong>{activeRangeConfig.label}</strong>: {activeRangeConfig.desc} ({activeRangeConfig.interval} composite windows)</span>
      </div>

      {loading && (
        <div className="fx-chart-empty" style={{ margin: '14px 0', padding: '16px', background: '#faf7f2', border: '1px solid #e7ded2', borderRadius: '8px' }}>
          <span className="fx-spinner" />
          <p style={{ margin: '8px 0 0', fontWeight: 500, color: '#244f38' }}>
            Analysing satellite observations for your field. This may take a moment...
          </p>
        </div>
      )}

      {error && (
        <div className="fx-error-box" role="alert">
          <Icon name="alert" size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Auth Failure Notice if CDSE authentication failed */}
      {authStatus === 'auth_failed' && (
        <div className="fx-error-box" role="alert" style={{ marginBottom: '16px' }}>
          <Icon name="alert" size={18} />
          <div>
            <strong>Copernicus Authentication Failed</strong>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
              {data?.authMessage || 'Verify that CDSE_CLIENT_ID and CDSE_CLIENT_SECRET in .env.local are valid.'}
            </p>
          </div>
        </div>
      )}

      {/* Auth Guidance Notice if credentials not configured */}
      {authStatus === 'credentials_required' && (
        <div className="fx-auth-notice">
          <div className="fx-auth-notice-head">
            <span className="fx-auth-notice-icon"><Icon name="key" size={18} /></span>
            <div>
              <strong>Copernicus Sentinel Hub Credentials Required for Statistical Pixel Processing</strong>
              <p>
                Actual Sentinel-2 L2A scene acquisitions for this field were discovered via open STAC metadata below.
                To compute pixel-level NDVI time-series statistics, add your free Copernicus Data Space credentials in <code>.env.local</code>:
              </p>
            </div>
          </div>
          <pre className="fx-auth-code">
            CDSE_CLIENT_ID=your-client-id-here&#10;CDSE_CLIENT_SECRET=your-client-secret-here
          </pre>
          <div className="fx-auth-foot">
            <small>
              Register free at <a href="https://dataspace.copernicus.eu/" target="_blank" rel="noreferrer">dataspace.copernicus.eu</a>.
            </small>
          </div>
        </div>
      )}

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
            COPERNICUS CDSE · SENTINEL-2 L2A · SENTINEL HUB
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
          <div style={{ padding: '8px 12px', background: '#fff', borderRadius: '6px', border: '1px solid #ede5d8' }}>
            <div style={{ fontSize: '0.7rem', color: '#887d6b', textTransform: 'uppercase' }}>1. Scene Discovery</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: scenes.length ? '#2e6b3e' : data ? '#887d6b' : '#b25916', display: 'flex', alignItems: 'center', gap: '5px', marginTop: '3px' }}>
              <Icon name={scenes.length ? 'check' : data ? 'info' : 'alert'} size={14} />
              {scenes.length ? `${scenes.length} Scenes Found` : data ? '0 Scenes Found' : 'Awaiting Query'}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#998d7d', marginTop: '2px' }}>Open CDSE STAC</div>
          </div>
          <div style={{ padding: '8px 12px', background: '#fff', borderRadius: '6px', border: '1px solid #ede5d8' }}>
            <div style={{ fontSize: '0.7rem', color: '#887d6b', textTransform: 'uppercase' }}>2. Statistical Request</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: authStatus === 'configured' ? '#2e6b3e' : authStatus === 'auth_failed' ? '#b83b3b' : '#885522', display: 'flex', alignItems: 'center', gap: '5px', marginTop: '3px' }}>
              <Icon name={authStatus === 'configured' ? 'check' : authStatus === 'auth_failed' ? 'alert' : 'key'} size={14} />
              {authStatus === 'configured' ? 'Request Configured' : authStatus === 'auth_failed' ? 'Auth Failed' : 'Credentials Required'}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#998d7d', marginTop: '2px' }}>CDSE OAuth2 Client</div>
          </div>
          <div style={{ padding: '8px 12px', background: '#fff', borderRadius: '6px', border: '1px solid #ede5d8' }}>
            <div style={{ fontSize: '0.7rem', color: '#887d6b', textTransform: 'uppercase' }}>3. Processing Response</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: (data?.timeseries?.length || 0) > 0 ? '#2e6b3e' : authStatus === 'auth_failed' ? '#b83b3b' : '#776e62', display: 'flex', alignItems: 'center', gap: '5px', marginTop: '3px' }}>
              <Icon name={(data?.timeseries?.length || 0) > 0 ? 'check' : authStatus === 'auth_failed' ? 'alert' : 'info'} size={14} />
              {(data?.timeseries?.length || 0) > 0 ? `${data.timeseries.length} Intervals Received` : authStatus === 'auth_failed' ? 'Auth Failed' : authStatus === 'credentials_required' ? 'Pending Credentials' : data ? '0 Intervals' : 'Pending Auth'}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#998d7d', marginTop: '2px' }}>Sentinel Hub Statistical API</div>
          </div>
          <div style={{ padding: '8px 12px', background: '#fff', borderRadius: '6px', border: '1px solid #ede5d8' }}>
            <div style={{ fontSize: '0.7rem', color: '#887d6b', textTransform: 'uppercase' }}>4. Valid Pixel Extraction</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: latest.validPixelCount ? '#2e6b3e' : '#776e62', display: 'flex', alignItems: 'center', gap: '5px', marginTop: '3px' }}>
              <Icon name={latest.validPixelCount ? 'check' : 'info'} size={14} />
              {latest.validPixelCount ? `${latest.validPixelCount.toLocaleString()} Pixels (10 m)` : data ? '0 Valid Pixels' : 'Awaiting Valid Samples'}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#998d7d', marginTop: '2px' }}>SCL Masked (Clouds/Shadow)</div>
          </div>
          <div style={{ padding: '8px 12px', background: '#fff', borderRadius: '6px', border: '1px solid #ede5d8' }}>
            <div style={{ fontSize: '0.7rem', color: '#887d6b', textTransform: 'uppercase' }}>5. Derived NDVI Analysis</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: latest.meanNdvi != null ? '#2e6b3e' : '#776e62', display: 'flex', alignItems: 'center', gap: '5px', marginTop: '3px' }}>
              <Icon name={latest.meanNdvi != null ? 'check' : 'info'} size={14} />
              {latest.meanNdvi != null ? `NDVI ${latest.meanNdvi.toFixed(2)}` : data?.condition?.label ? data.condition.label : 'Pending Valid Obs'}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#998d7d', marginTop: '2px' }}>OLS Trend &amp; Condition</div>
          </div>
        </div>
      </div>

      {/* Top Metric Cards */}
      <div className="fx-metric-grid">
        <article className="fx-metric fx-metric-sage">
          <div className="fx-metric-top">
            <span className="fx-metric-icon"><Icon name="leaf" size={17} /></span>
            <span className="fx-metric-label">
              Field Greenness (NDVI)
              <InfoTip title="Field Greenness (NDVI)" label="About NDVI" technicalNote="NDVI = (B08 - B04) / (B08 + B04)">
                NDVI is a satellite indicator of how green and actively growing plants appear. Higher values (0.4 to 0.8) indicate dense green canopy; lower values (0.1 to 0.3) indicate bare soil or sparse crops. It is an optical greenness indicator, not a direct measurement of crop yield or disease.
              </InfoTip>
            </span>
          </div>
          <div className="fx-metric-value">
            {latest.meanNdvi != null && Number.isFinite(latest.meanNdvi) ? latest.meanNdvi.toFixed(2) : '—'}
            <small>score</small>
          </div>
          <p>{condition.label || 'No cloud-free observation'}</p>
        </article>

        <article className="fx-metric fx-metric-sand">
          <div className="fx-metric-top">
            <span className="fx-metric-icon"><Icon name="calendar" size={17} /></span>
            <span className="fx-metric-label">
              Latest Observation
              <InfoTip title="Observation Window" label="About observation window" technicalNote="Sentinel-2 revisit window aggregated to mosaic">
                The multi-day time window containing the most recent clear, cloud-free satellite overpass evaluated for your field.
              </InfoTip>
            </span>
          </div>
          <div className="fx-metric-value" style={{ fontSize: '1.25rem' }}>
            {latest.intervalStart ? formatDateLabel(latest.intervalStart) : '—'}
          </div>
          <p>
            {latest.validPixelCount ? `${latest.validPixelCount.toLocaleString()} valid 10 m pixels` : 'Awaiting observations'}
          </p>
        </article>

        <article className="fx-metric fx-metric-blue">
          <div className="fx-metric-top">
            <span className="fx-metric-icon"><Icon name="shield" size={17} /></span>
            <span className="fx-metric-label">
              Clear Sky Coverage
              <InfoTip title="Clear Sky Coverage" label="About sample coverage" technicalNote="Scene Classification Layer (SCL) cloud & shadow mask">
                The percentage of your field with clear, cloud-free and shadow-free satellite observations during this observation window.
              </InfoTip>
            </span>
          </div>
          <div className="fx-metric-value">
            {latest.validSampleRatio != null && Number.isFinite(latest.validSampleRatio)
              ? `${latest.validSampleRatio.toFixed(0)}%`
              : latest.validCoveragePercent != null && Number.isFinite(latest.validCoveragePercent)
              ? `${latest.validCoveragePercent.toFixed(0)}%`
              : '—'}
          </div>
          <p title="Valid evaluated in-field pixels vs raster grid cells (including bounding-box margin and cloud masks)">
            Valid samples (excludes clouds &amp; bbox margin)
          </p>
        </article>

        <article className="fx-metric fx-metric-gold">
          <div className="fx-metric-top">
            <span className="fx-metric-icon"><Icon name="chart" size={17} /></span>
            <span className="fx-metric-label">
              Canopy Trend
              <InfoTip title="Canopy Growth Trend" label="About canopy trend" technicalNote="Ordinary Least Squares linear regression slope">
                The overall direction of crop canopy change over this period: greening (growth/vegetative development), browning (crop ripening, harvesting, or senescence), or stable baseline.
              </InfoTip>
            </span>
          </div>
          <div className="fx-metric-value" style={{ fontSize: '1.25rem' }}>
            {trend.slopePerYear != null && Number.isFinite(trend.slopePerYear) ? `${trend.slopePerYear > 0 ? '+' : ''}${trend.slopePerYear.toFixed(2)}/yr` : '—'}
          </div>
          <p>
            {trend.direction === 'greening' ? 'Greening canopy trend' : trend.direction === 'browning' ? 'Browning / senescing trend' : 'Stable or seasonal baseline'}
          </p>
        </article>
      </div>

      {/* Plain-Language Interpretation: What this means for your farm */}
      {data && (
        <div className="fx-plain-insight">
          <div className="fx-plain-insight-head">
            <Icon name="leaf" size={15} />
            <span>What this means for your farm</span>
          </div>
          <div className="fx-plain-insight-title">
            {condition.label || 'Vegetation status'}
          </div>
          <p className="fx-plain-insight-desc">
            {latest.meanNdvi != null
              ? `${condition.description || 'Field observations evaluated.'} Over the selected ${activeRangeConfig.label.toLowerCase()} (${activeRangeConfig.desc.toLowerCase()}), your field shows an average greenness score of ${latest.meanNdvi.toFixed(2)} with a ${trend.direction || 'stable'} trend.`
              : 'A reliable vegetation interpretation is not available yet for this period due to cloud cover or lack of clear satellite passes. Try selecting a longer date range such as the Last 90 days or Last 180 days.'}
          </p>
        </div>
      )}

      {/* Main Analysis Grid */}
      <div className="fx-analysis-grid">
        {/* Time-Series Chart Panel */}
        <section className="fx-panel fx-chart-panel">
          <div className="fx-panel-heading">
            <div>
              <span className="fx-overline">TIME-SERIES DYNAMICS</span>
              <h2>Field Greenness Progression</h2>
              <p>Sentinel-2 L2A mean NDVI and 10th–90th percentile field canopy envelope.</p>
            </div>
            <span className="fx-panel-icon"><Icon name="chart" size={20} /></span>
          </div>

          <NdviTimeseriesChart timeseries={data?.timeseries || []} />

          {quality.warnings?.length > 0 && (
            <div className="fx-quality-warning">
              <Icon name="alert" size={16} />
              <span>{quality.warnings.join(' ')}</span>
            </div>
          )}

          <div className="fx-chart-insight">
            <span className="fx-insight-mark"><Icon name="leaf" size={17} /></span>
            <p>
              <strong>Vegetation Condition:</strong> {condition.description || 'Evaluating field status.'}
            </p>
          </div>

          <div className="fx-composite-note" style={{ marginTop: '12px', padding: '10px 14px', borderRadius: '8px', background: 'rgba(235, 240, 230, 0.65)', border: '1px solid #d5dfcb', fontSize: '0.82rem', color: '#334839', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <span style={{ marginTop: '2px', flexShrink: 0 }}><Icon name="info" size={15} /></span>
            <span>
              <strong>Temporal Composite Notice:</strong> Intervals ({activeRangeConfig.interval}) represent multi-day mosaic windows prioritizing the most recent valid pixel per 10 m cell. Individual pixels across your field may originate from different overpasses within each window rather than a single instantaneous acquisition.
            </span>
          </div>
        </section>

        {/* Scene Discovery & Provenance Panel */}
        <section className="fx-panel fx-compare-panel">
          <div className="fx-panel-heading">
            <div>
              <span className="fx-overline">COPERNICUS STAC DISCOVERY</span>
              <h2>Satellite Scene Overpasses</h2>
              <p>{scenes.length} Sentinel-2 L2A overpasses identified.</p>
            </div>
            <span className="fx-panel-icon"><Icon name="satellite" size={20} /></span>
          </div>

          {scenes.length > 0 ? (
            <div className="fx-scenes-list">
              {scenes.slice(0, 7).map((scene) => (
                <div key={scene.id} className="fx-scene-item">
                  <div className="fx-scene-info">
                    <strong>{formatDateLabel(scene.datetime)}</strong>
                    <small>{scene.platform} · Tile {scene.tileId || 'MGRS'}</small>
                  </div>
                  <div className="fx-scene-meta">
                    <span className={`fx-cloud-badge ${scene.cloudCoverPercent > 40 ? 'is-cloudy' : 'is-clear'}`}>
                      {scene.cloudCoverPercent != null ? `${scene.cloudCoverPercent}% cloud` : 'Cloud N/A'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="fx-chart-empty">
              <Icon name="info" size={18} />
              <p>No Sentinel-2 scenes catalogued in this window.</p>
            </div>
          )}

          <div className="fx-data-quality" style={{ marginTop: '16px' }}>
            <div>
              <span>SCL Masking Quality</span>
              <strong>{quality.validIntervals || 0} valid / {quality.totalIntervals || 0} intervals</strong>
            </div>
            <div className="fx-quality-track">
              <i
                style={{
                  width: `${Math.min(
                    100,
                    quality.totalIntervals > 0
                      ? (quality.validIntervals / quality.totalIntervals) * 100
                      : 0,
                  )}%`,
                }}
              />
            </div>
            <small>Masked SCL classes: 0 (No data), 1 (Defective), 3 (Shadow), 7–10 (Clouds/Cirrus), 11 (Snow).</small>
          </div>
        </section>
      </div>

      {/* Expandable Educational Guide */}
      <details className="fx-guide-details">
        <summary className="fx-guide-summary">
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="info" size={16} />
            <strong>Farmer&apos;s Guide: Understanding Crop Greenness &amp; Satellite Observations</strong>
          </span>
          <span style={{ fontSize: '11px', color: '#7a7062' }}>Tap to expand / collapse</span>
        </summary>
        <div className="fx-guide-content">
          <p>
            <strong>What is NDVI (Field Greenness Score)?</strong><br />
            NDVI measures how strongly plants reflect near-infrared sunlight compared to visible red light. Healthy, living leaves absorb red light for photosynthesis and strongly reflect near-infrared light.
          </p>
          <ul>
            <li><strong>0.00 – 0.19 (Bare soil / Fallow):</strong> Soil background, freshly plowed land, or crop stubble. A low score here does <em>not</em> mean crop failure—it is completely normal before sowing or after harvest.</li>
            <li><strong>0.20 – 0.39 (Sparse / Emerging):</strong> Young seedlings just breaking through the soil, light ground cover, or ripening grain heading toward harvest.</li>
            <li><strong>0.40 – 0.59 (Moderate canopy):</strong> Actively growing crop in its vegetative stage with good ground cover.</li>
            <li><strong>0.60 – 0.85+ (Dense, vigorous canopy):</strong> Peak vegetative growth, closed canopy, and optimal photosynthetic activity.</li>
          </ul>
          <p>
            <strong>What does the shaded envelope in the chart mean?</strong><br />
            The shaded green area shows the 10th to 90th percentile variation across all 10-meter pixels within your field boundary. A narrow envelope indicates uniform, even crop growth throughout the field. A wide envelope suggests field variability—such as different soil types, localized water pooling, or uneven emergence.
          </p>
          <p>
            <strong>How do clouds affect the data?</strong><br />
            Sentinel-2 observes your field from orbit every 3 to 5 days. When thick clouds or cloud shadows obscure the ground, our 5-tier pipeline uses Sentinel-2&apos;s Scene Classification Layer (SCL) to automatically mask out obstructed pixels so cloudy days do not drag down your greenness score.
          </p>
          <p>
            <strong>Which date range should I choose?</strong><br />
            Use <strong>Last 30 days</strong> to check current crop vigor and response to recent weather. Use <strong>Last 90 days</strong> to track a full seasonal crop cycle from planting to canopy closure. Use <strong>180 or 365 days</strong> to see long-term rotation patterns across seasons.
          </p>
        </div>
      </details>

      {/* Scientific Limitations & Honest Guidance */}
      <section className="fx-note-card" style={{ marginTop: '16px' }}>
        <span className="fx-note-icon"><Icon name="shield" size={18} /></span>
        <div>
          <strong>Scientific Interpretation Guidance & Limitations:</strong>
          <p style={{ margin: '6px 0 0', lineHeight: 1.6, fontSize: '0.85rem' }}>
            NDVI measures active green chlorophyll reflectance ($NIR - RED / NIR + RED$); it does not directly measure soil moisture, nitrogen content, or crop yield.
            Values above 0.8 may saturate in dense canopies. Low values during fallow or tillage periods reflect bare soil reflectance rather than crop failure.
            Atmospheric corrections from Level-2A remove aerosol scattering, but thin cirrus or residual cloud shadows may influence individual observations.
          </p>
        </div>
      </section>
    </div>
  );
}

