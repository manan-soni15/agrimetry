'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

const PRIORITY_OPTIONS = [
  { id: 'water', label: 'Conserve water', icon: 'droplet' },
  { id: 'soil', label: 'Build soil health', icon: 'sprout' },
  { id: 'climate', label: 'Climate resilience', icon: 'sun' },
  { id: 'income', label: 'Diversify income', icon: 'chart' },
];

const NEXT_LAYERS = [
  { code: 'SMAP', title: 'Soil moisture', detail: 'Surface and root-zone moisture', status: 'Next integration', icon: 'droplet' },
  { code: 'GPM', title: 'Precipitation', detail: 'Satellite rainfall estimates', status: 'Next integration', icon: 'rain' },
];

function Icon({ name, size = 18, strokeWidth = 1.7 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  const paths = {
    leaf: <><path d="M20.5 3.5C12 3.5 5 6.6 5 13.2c0 3.3 2.3 5.3 5.2 5.3 6.3 0 9.9-7.3 10.3-15Z"/><path d="M3.5 21c3.1-5.1 7.4-8.4 13-11"/><path d="M5.3 14.2c2 .2 3.5.9 4.7 2.2"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/></>,
    droplet: <><path d="M12 2.8S5.5 10.1 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10.1 12 2.8 12 2.8Z"/><path d="M9 15.2a3.1 3.1 0 0 0 3 3"/></>,
    rain: <><path d="M7 15.5a4.2 4.2 0 1 1 .8-8.3A5.3 5.3 0 0 1 18 9a3.4 3.4 0 0 1-.4 6.7H7Z"/><path d="m9 18-1 3m6-3-1 3m6-3-1 3"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    chart: <><path d="M4 19V5m0 14h17"/><path d="m7 15 4-4 3 2 5-6"/><path d="M16 7h3v3"/></>,
    pin: <><path d="M20 10.2c0 5.2-8 11.3-8 11.3S4 15.4 4 10.2a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,
    crosshair: <><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/><path d="M12 1.5v3m0 15v3m10.5-10.5h-3m-15 0h-3"/></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
    compass: <><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2Z"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    thermometer: <><path d="M14 14.8V5a3 3 0 0 0-6 0v9.8a5 5 0 1 0 6 0Z"/><path d="M11 11v7"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    sprout: <><path d="M12 21v-9"/><path d="M12 13C5 13 4 8 4 5c5 0 8 2 8 8Z"/><path d="M12 16c0-6 4-9 8-9 0 4-1.5 9-8 9Z"/></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 17v3h16v-3"/></>,
    external: <><path d="M14 4h6v6m0-6-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></>,
  };
  return <svg {...common}>{paths[name] || paths.info}</svg>;
}

function BrandMark({ light = false }) {
  return (
    <Link href="/" className={`fx-brand ${light ? 'fx-brand-light' : ''}`} aria-label="Agrimetry home">
      <span className="fx-brand-mark"><Icon name="leaf" size={21} /></span>
      <span className="fx-brand-word">agrimetry<span className="fx-brand-dot">.</span></span>
    </Link>
  );
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`);
  return date.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function formatMetric(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function MetricCard({ icon, label, value, unit, note, accent = 'sage' }) {
  return (
    <article className={`fx-metric fx-metric-${accent}`}>
      <div className="fx-metric-top"><span className="fx-metric-icon"><Icon name={icon} size={17} /></span><span className="fx-metric-label">{label}</span></div>
      <div className="fx-metric-value">{value}<small>{unit}</small></div>
      <p>{note}</p>
    </article>
  );
}

function MonthlyChart({ data }) {
  const chartData = data.slice(-12);
  const maxRain = Math.max(10, ...chartData.map((item) => item.precipitation || 0));
  const temps = chartData.map((item) => item.temperature).filter(Number.isFinite);
  const minTemp = temps.length ? Math.min(...temps) - 2 : 0;
  const maxTemp = temps.length ? Math.max(...temps) + 2 : 10;
  const xFor = (index) => 48 + index * (650 / Math.max(chartData.length - 1, 1));
  const yForTemp = (value) => 142 - ((value - minTemp) / Math.max(maxTemp - minTemp, 1)) * 82;
  const points = chartData.map((item, index) => Number.isFinite(item.temperature) ? `${xFor(index)},${yForTemp(item.temperature)}` : null).filter(Boolean).join(' ');

  return (
    <div className="fx-chart-wrap">
      <div className="fx-chart-legend">
        <span><i className="fx-legend-bar" /> Monthly precipitation</span>
        <span><i className="fx-legend-line" /> Mean air temperature</span>
      </div>
      <svg className="fx-chart" viewBox="0 0 720 205" role="img" aria-label="Monthly precipitation bars and mean temperature line for the latest twelve months">
        {[46, 92, 138].map((y) => <line key={y} x1="38" x2="698" y1={y} y2={y} stroke="#e8e1d2" strokeDasharray="3 6" />)}
        {chartData.map((item, index) => {
          const barHeight = item.precipitation === null ? 0 : (item.precipitation / maxRain) * 88;
          const x = xFor(index) - 12;
          return <g key={item.month}>
            <rect x={x} y={146 - barHeight} width="24" height={barHeight} rx="5" fill="#91a985" opacity=".88" />
            <text x={xFor(index)} y="176" textAnchor="middle" className="fx-chart-label">{new Date(`${item.month}-01T00:00:00Z`).toLocaleDateString('en', { month: 'short', timeZone: 'UTC' })}</text>
          </g>;
        })}
        {points && <polyline points={points} fill="none" stroke="#244f38" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />}
        {chartData.map((item, index) => Number.isFinite(item.temperature) ? <circle key={`t-${item.month}`} cx={xFor(index)} cy={yForTemp(item.temperature)} r="3.5" fill="#244f38" stroke="#fbf9f3" strokeWidth="1.6" /> : null)}
      </svg>
      <div className="fx-chart-foot"><span>Monthly values from NASA POWER daily data</span><span>Latest 12 months</span></div>
    </div>
  );
}

function MapPreview({ latitude, longitude, location }) {
  const deltaLat = 0.035;
  const deltaLon = 0.035;
  const bbox = `${longitude - deltaLon},${latitude - deltaLat},${longitude + deltaLon},${latitude + deltaLat}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${latitude}%2C${longitude}`;

  return (
    <div className="fx-map-card">
      <div className="fx-map-head"><div><span className="fx-overline">FIELD LOCATION</span><strong>{location || 'Selected coordinates'}</strong></div><span className="fx-map-pin"><Icon name="pin" size={16} /></span></div>
      <iframe title={`Map showing ${location || 'selected farm coordinates'}`} src={src} loading="lazy" referrerPolicy="no-referrer" />
      <div className="fx-map-foot"><span>{latitude.toFixed(4)}°, {longitude.toFixed(4)}°</span><a href={`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=13/${latitude}/${longitude}`} target="_blank" rel="noreferrer">Open full map <Icon name="external" size={12} /></a></div>
      <small>Map data © OpenStreetMap contributors</small>
    </div>
  );
}

function SetupScreen({ farm, setFarm, onAnalyze, loading, error, onSearch, searchLoading, searchResults, searchError, onSelectLocation, onUseLocation }) {
  const [showCoordinates, setShowCoordinates] = useState(false);
  const selected = Number.isFinite(Number(farm.latitude)) && Number.isFinite(Number(farm.longitude)) && farm.latitude !== '' && farm.longitude !== '';
  const togglePriority = (id) => {
    setFarm((current) => ({
      ...current,
      priorities: current.priorities.includes(id)
        ? current.priorities.filter((item) => item !== id)
        : [...current.priorities, id],
    }));
  };

  return (
    <div className="fx-setup-layout">
      <section className="fx-setup-main">
        <div className="fx-page-kicker"><span className="fx-kicker-dot" /> YOUR FIRST FIELD PROFILE</div>
        <h1 className="fx-page-title">Every field has a <em>fingerprint.</em></h1>
        <p className="fx-page-intro">Start with a place. Agrimetry will assemble its environmental story from NASA climate data and your local farm context.</p>

        <form className="fx-form-card" onSubmit={onAnalyze}>
          <div className="fx-form-heading">
            <div><span className="fx-step-number">01 / FARM PROFILE</span><h2>Tell us about your land</h2></div>
            <span className="fx-form-mark"><Icon name="sprout" size={23} /></span>
          </div>

          <div className="fx-field-grid">
            <label className="fx-field fx-span-2">
              <span>Farm or field name</span>
              <input value={farm.name} onChange={(event) => setFarm({ ...farm, name: event.target.value })} placeholder="e.g. North Field" maxLength={70} />
            </label>

            <div className="fx-field fx-span-2">
              <label htmlFor="farm-location">Where is your farm?</label>
              <div className="fx-search-row">
                <div className="fx-input-icon"><Icon name="search" size={17} /><input id="farm-location" value={farm.locationQuery} onChange={(event) => setFarm({ ...farm, locationQuery: event.target.value, latitude: '', longitude: '', location: '' })} placeholder="Search village, town, region or country" maxLength={100} /></div>
                <button type="button" className="fx-search-button" onClick={onSearch} disabled={searchLoading || farm.locationQuery.trim().length < 2}>{searchLoading ? <span className="fx-spinner" /> : <Icon name="arrow" size={17} />}<span>{searchLoading ? 'Searching' : 'Find'}</span></button>
              </div>
              <div className="fx-location-tools">
                <button type="button" onClick={onUseLocation}><Icon name="crosshair" size={14} /> Use my current location</button>
                <button type="button" onClick={() => setShowCoordinates((value) => !value)}>{showCoordinates ? 'Hide coordinates' : 'Enter coordinates manually'}</button>
              </div>
              {searchError && <p className="fx-inline-error">{searchError}</p>}
              {searchResults.length > 0 && (
                <div className="fx-search-results" role="listbox" aria-label="Location search results">
                  {searchResults.map((place) => (
                    <button key={place.id} type="button" className="fx-search-result" onClick={() => onSelectLocation(place)}>
                      <span className="fx-result-icon"><Icon name="pin" size={16} /></span>
                      <span><strong>{place.name}</strong><small>{[place.admin1, place.country].filter(Boolean).join(', ')}</small></span>
                      <Icon name="chevron" size={16} />
                    </button>
                  ))}
                  <div className="fx-geocode-credit">Location data by Open-Meteo · GeoNames</div>
                </div>
              )}
            </div>

            {showCoordinates && <>
              <label className="fx-field"><span>Latitude</span><input type="number" step="any" min="-90" max="90" value={farm.latitude} onChange={(event) => setFarm({ ...farm, latitude: event.target.value, location: 'Manual coordinates' })} placeholder="e.g. 26.9124" /></label>
              <label className="fx-field"><span>Longitude</span><input type="number" step="any" min="-180" max="180" value={farm.longitude} onChange={(event) => setFarm({ ...farm, longitude: event.target.value, location: 'Manual coordinates' })} placeholder="e.g. 75.7873" /></label>
            </>}

            {selected && <div className="fx-selected-place fx-span-2"><span className="fx-selected-check"><Icon name="check" size={14} /></span><div><strong>{farm.location || 'Coordinates selected'}</strong><small>{Number(farm.latitude).toFixed(4)}, {Number(farm.longitude).toFixed(4)} · Global point analysis</small></div><button type="button" onClick={() => setFarm({ ...farm, latitude: '', longitude: '', location: '' })}>Change</button></div>}

            <label className="fx-field"><span>Farm area <small>(optional)</small></span><div className="fx-input-suffix"><input type="number" min="0" step="0.1" value={farm.area} onChange={(event) => setFarm({ ...farm, area: event.target.value })} placeholder="e.g. 5" /><span>{farm.areaUnit}</span></div></label>
            <label className="fx-field"><span>Area unit</span><select value={farm.areaUnit} onChange={(event) => setFarm({ ...farm, areaUnit: event.target.value })}><option value="hectares">Hectares</option><option value="acres">Acres</option><option value="sqm">Square metres</option></select></label>
            <label className="fx-field"><span>Current crop</span><select value={farm.currentCrop} onChange={(event) => setFarm({ ...farm, currentCrop: event.target.value })}><option value="">Select current crop</option><option>Wheat</option><option>Rice</option><option>Maize</option><option>Millet</option><option>Sorghum</option><option>Soybean</option><option>Chickpea</option><option>Mustard</option><option>Cotton</option><option>Other / mixed</option></select></label>
            <label className="fx-field"><span>Previous crop <small>(optional)</small></span><select value={farm.previousCrop} onChange={(event) => setFarm({ ...farm, previousCrop: event.target.value })}><option value="">Select previous crop</option><option>Wheat</option><option>Rice</option><option>Maize</option><option>Millet</option><option>Sorghum</option><option>Soybean</option><option>Chickpea</option><option>Mustard</option><option>Cotton</option><option>Other / mixed</option></select></label>
            <label className="fx-field"><span>Soil type <small>(if known)</small></span><select value={farm.soilType} onChange={(event) => setFarm({ ...farm, soilType: event.target.value })}><option value="">Not sure yet</option><option>Sandy</option><option>Sandy loam</option><option>Loam</option><option>Clay loam</option><option>Clay</option><option>Silt loam</option><option>Other / mixed</option></select></label>
            <label className="fx-field"><span>Water availability</span><select value={farm.irrigation} onChange={(event) => setFarm({ ...farm, irrigation: event.target.value })}><option value="">Select availability</option><option>Rainfed</option><option>Limited irrigation</option><option>Reliable irrigation</option><option>Seasonal / variable</option><option>Not sure</option></select></label>
            <label className="fx-field fx-span-2"><span>Primary growing season</span><select value={farm.season} onChange={(event) => setFarm({ ...farm, season: event.target.value })}><option value="">Select growing season</option><option>Year-round / multiple seasons</option><option>Wet season</option><option>Dry season</option><option>Spring</option><option>Summer</option><option>Autumn</option><option>Winter</option><option>Local seasonal calendar varies</option></select></label>
          </div>

          <div className="fx-priority-block">
            <div className="fx-priority-heading"><div><span className="fx-step-number">02 / FARMER PRIORITIES</span><h3>What matters most to you?</h3></div><span>Choose any</span></div>
            <div className="fx-priority-grid">
              {PRIORITY_OPTIONS.map((item) => (
                <button key={item.id} type="button" onClick={() => togglePriority(item.id)} className={`fx-priority ${farm.priorities.includes(item.id) ? 'is-selected' : ''}`} aria-pressed={farm.priorities.includes(item.id)}>
                  <span className="fx-priority-check">{farm.priorities.includes(item.id) ? <Icon name="check" size={13} /> : <Icon name={item.icon} size={16} />}</span>{item.label}
                </button>
              ))}
            </div>
          </div>

          {error && <div className="fx-error-box"><Icon name="info" size={17} /><span>{error}</span></div>}
          <button className="fx-primary-button fx-analyze-button" type="submit" disabled={loading || !selected}>
            {loading ? <><span className="fx-spinner fx-spinner-light" /> Building your fingerprint…</> : <>Build my environmental fingerprint <Icon name="arrow" size={18} /></>}
          </button>
          <p className="fx-form-footnote"><Icon name="shield" size={13} /> Your farm details stay in this session. You can analyse a location without providing every field detail.</p>
        </form>
      </section>

      <aside className="fx-setup-aside">
        {selected ? <MapPreview latitude={Number(farm.latitude)} longitude={Number(farm.longitude)} location={farm.location} /> : (
          <div className="fx-map-placeholder">
            <div className="fx-map-art">
              <svg viewBox="0 0 420 310" role="img" aria-label="Illustration of field boundaries and terrain contours">
                <defs><pattern id="mapGrain" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".65" fill="#8a7657" opacity=".32" /></pattern></defs>
                <path d="M-20 70 105 12l105 38 115-32 120 64-16 170-140 52-105-38-105 28-96-55Z" fill="#e5d9bf"/>
                <path d="M-20 70 105 12l105 38 115-32 120 64-16 170-140 52-105-38-105 28-96-55Z" fill="url(#mapGrain)"/>
                <g fill="none" stroke="#af9d7e" strokeWidth="1.2" opacity=".78">{[0,1,2,3,4,5,6].map((i)=><path key={i} d="M-15 150c72-82 131-80 198-31s136 49 254-33M-15 178c72-82 131-80 198-31s136 49 254-33M-15 207c72-82 131-80 198-31s136 49 254-33" transform={`translate(0 ${i*8-20})`}/>)}</g>
                <g transform="translate(70 72) rotate(-12 140 90)" fill="#79926b" stroke="#f4eedf" strokeWidth="3"><rect x="0" y="0" width="100" height="78" rx="4"/><rect x="104" y="0" width="100" height="78" rx="4" fill="#a8b99a"/><rect x="0" y="82" width="100" height="78" rx="4" fill="#b5a078"/><rect x="104" y="82" width="100" height="78" rx="4" fill="#5f7f57"/></g>
                <circle cx="211" cy="153" r="19" fill="#244f38" opacity=".13"/><circle cx="211" cy="153" r="8" fill="#244f38" stroke="#fbf9f3" strokeWidth="4"/>
                <path d="M211 153 258 104" stroke="#244f38" strokeDasharray="3 4" strokeWidth="1.3"/><rect x="256" y="83" width="104" height="31" rx="15" fill="#173d2b"/><text x="308" y="103" fill="#fbf9f3" textAnchor="middle" fontSize="10" letterSpacing="1.4">YOUR FIELD</text>
              </svg>
            </div>
            <div className="fx-map-placeholder-copy"><span className="fx-overline">A PLACE-BASED START</span><h3>First, find your field.</h3><p>Search for a place or use your coordinates. We’ll anchor the environmental analysis to that location.</p></div>
          </div>
        )}

        <div className="fx-source-card">
          <div className="fx-source-card-head"><span className="fx-overline">DATA LAYERS</span><span className="fx-live-pill"><i /> READY TO CONNECT</span></div>
          <div className="fx-layer-row fx-layer-active"><span className="fx-layer-icon"><Icon name="sun" /></span><span><strong>NASA POWER</strong><small>Daily temperature, rainfall, humidity, solar</small></span><span className="fx-layer-status">LIVE</span></div>
          <Link href="/explore/vegetation" className="fx-layer-row fx-layer-active fx-layer-link"><span className="fx-layer-icon"><Icon name="leaf" /></span><span><strong>Sentinel-2 · Vegetation</strong><small>Field NDVI and seasonal observations</small></span><span className="fx-layer-status">LIVE</span></Link>
          <Link href="/explore/water-stress" className="fx-layer-row fx-layer-active fx-layer-link"><span className="fx-layer-icon"><Icon name="droplet" /></span><span><strong>SMAP · GPM · Water stress</strong><small>Soil moisture, rainfall and drought signals</small></span><span className="fx-layer-status">LIVE</span></Link>
          <div className="fx-source-card-foot">NASA Earth observations + local farm context</div>
        </div>

        <div className="fx-note-card"><span className="fx-note-icon"><Icon name="info" size={17} /></span><p><strong>Built for honest insight.</strong> Satellite and gridded climate data provide environmental context. They do not replace field soil tests or local agronomic advice.</p></div>
      </aside>
    </div>
  );
}

function Dashboard({ farm, result, onEdit }) {
  const summary = result.summary || {};
  const comparison = result.comparison || {};
  const bestRainMonth = useMemo(() => {
    const valid = (result.monthly || []).filter((item) => Number.isFinite(item.precipitation));
    return valid.reduce((best, item) => (!best || item.precipitation > best.precipitation ? item : best), null);
  }, [result.monthly]);
  const rainfallChange = comparison.rainfallChangePercent;
  const tempDelta = comparison.temperatureDelta;

  return (
    <div className="fx-dashboard">
      <div className="fx-dashboard-heading">
        <div><div className="fx-page-kicker"><span className="fx-kicker-dot" /> ENVIRONMENTAL FINGERPRINT</div><h1 className="fx-page-title">A closer look at <em>{farm.name || 'your land'}.</em></h1><p className="fx-page-intro">A two-year environmental record, condensed into a field-context report. Start with the patterns; then validate what matters on the ground.</p></div>
        <button className="fx-outline-button" onClick={onEdit}><Icon name="map" size={16} /> Edit farm profile</button>
      </div>

      <div className="fx-context-strip">
        <div className="fx-context-pin"><Icon name="pin" size={17} /></div>
        <div className="fx-context-location"><strong>{farm.location || 'Selected location'}</strong><span>{Number(farm.latitude).toFixed(4)}°, {Number(farm.longitude).toFixed(4)}° · {farm.area ? `${farm.area} ${farm.areaUnit}` : 'Area not provided'}</span></div>
        <div className="fx-context-divider" />
        <div className="fx-context-detail"><small>CURRENT CROP</small><strong>{farm.currentCrop || 'Not specified'}</strong></div>
        <div className="fx-context-detail"><small>WATER ACCESS</small><strong>{farm.irrigation || 'Not specified'}</strong></div>
        <div className="fx-data-stamp"><span className="fx-live-pill"><i /> LIVE DATA</span><small>NASA POWER · refreshed {new Date(result.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div>
      </div>

      <section className="fx-metric-section">
        <div className="fx-section-heading"><div><span className="fx-overline">01 / CLIMATE BASELINE</span><h2>The atmosphere around your field</h2></div><span className="fx-period"><Icon name="calendar" size={14} /> {formatDate(result.period.currentStart)} — {formatDate(result.period.end)}</span></div>
        <div className="fx-metric-grid">
          <MetricCard icon="thermometer" label="Mean air temperature" value={formatMetric(summary.meanTemperature)} unit="°C" note="Daily mean · latest 365 days" accent="sand" />
          <MetricCard icon="rain" label="Total precipitation" value={formatMetric(summary.precipitationTotal, 0)} unit="mm" note="Daily precipitation accumulation" accent="blue" />
          <MetricCard icon="droplet" label="Mean relative humidity" value={formatMetric(summary.meanHumidity, 0)} unit="%" note="Daily mean · 2 m relative humidity" accent="sage" />
          <MetricCard icon="sun" label="Mean solar radiation" value={formatMetric(summary.meanSolarRadiation, 1)} unit="kWh/m²" note="Daily surface shortwave radiation" accent="gold" />
        </div>
        <div className="fx-observation-note"><Icon name="info" size={15} /><span>These are NASA POWER gridded daily estimates for the selected coordinate, not measurements taken at the exact field boundary. {result.recordsAvailable} valid days were available in the current period.</span></div>
      </section>

      <div className="fx-analysis-grid">
        <section className="fx-panel fx-chart-panel">
          <div className="fx-panel-heading"><div><span className="fx-overline">02 / SEASONAL RHYTHM</span><h2>Rainfall & temperature</h2><p>How the last twelve months moved through the seasons.</p></div><span className="fx-panel-icon"><Icon name="chart" size={20} /></span></div>
          <MonthlyChart data={result.monthly || []} />
          <div className="fx-chart-insight"><span className="fx-insight-mark"><Icon name="sprout" size={17} /></span><p>{bestRainMonth ? `The highest precipitation total in the displayed period was ${formatMetric(bestRainMonth.precipitation, 1)} mm in ${new Date(`${bestRainMonth.month}-01T00:00:00Z`).toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })}.` : 'Monthly rainfall values are not available for this period.'} Use this as a seasonal signal, not a planting recommendation.</p></div>
        </section>

        <section className="fx-panel fx-compare-panel">
          <div className="fx-panel-heading"><div><span className="fx-overline">03 / YEAR-ON-YEAR CONTEXT</span><h2>Compared with the year before</h2><p>Latest 365 days vs previous 365 days.</p></div><span className="fx-panel-icon"><Icon name="layers" size={20} /></span></div>
          <div className="fx-compare-stat"><div><span>Precipitation total</span><strong>{rainfallChange === null ? '—' : `${rainfallChange > 0 ? '+' : ''}${rainfallChange.toFixed(1)}%`}</strong></div><span className={`fx-delta ${rainfallChange === null ? '' : rainfallChange < 0 ? 'fx-delta-warm' : 'fx-delta-cool'}`}>{rainfallChange === null ? 'Comparison unavailable' : rainfallChange < 0 ? 'Lower than previous period' : rainfallChange > 0 ? 'Higher than previous period' : 'Similar to previous period'}</span></div>
          <div className="fx-compare-stat"><div><span>Mean temperature</span><strong>{tempDelta === null ? '—' : `${tempDelta > 0 ? '+' : ''}${tempDelta.toFixed(1)}°C`}</strong></div><span className={`fx-delta ${tempDelta === null ? '' : tempDelta > 0 ? 'fx-delta-warm' : 'fx-delta-cool'}`}>{tempDelta === null ? 'Comparison unavailable' : tempDelta > 0 ? 'Warmer than previous period' : tempDelta < 0 ? 'Cooler than previous period' : 'Similar to previous period'}</span></div>
          <div className="fx-compare-caution"><Icon name="info" size={16} /><p>A two-period comparison is descriptive. It is not a long-term climate trend, attribution study or drought classification.</p></div>
          <div className="fx-data-quality"><div><span>Data completeness</span><strong>{result.records?.length ? Math.round((result.recordsAvailable / 365) * 100) : 0}%</strong></div><div className="fx-quality-track"><i style={{ width: `${Math.min(100, result.records?.length ? (result.recordsAvailable / 365) * 100 : 0)}%` }} /></div><small>Valid temperature or precipitation days in the latest 365-day period.</small></div>
        </section>
      </div>

      <section className="fx-layers-section" id="fx-roadmap">
        <div className="fx-section-heading"><div><span className="fx-overline">04 / EXPANDING THE FINGERPRINT</span><h2>More layers. A fuller picture.</h2></div><span className="fx-coming-label">INTEGRATION ROADMAP</span></div>
        <div className="fx-next-grid">
          {NEXT_LAYERS.map((layer, index) => <article className="fx-next-card" key={layer.code}><div className="fx-next-top"><span className="fx-next-icon"><Icon name={layer.icon} size={20} /></span><span>0{index + 2}</span></div><span className="fx-next-code">NASA {layer.code}</span><h3>{layer.title}</h3><p>{layer.detail}. Now available as field-level water-stress analysis plus NASA GIBS map layers.</p><Link href="/explore/water-stress" className="fx-roadmap-status"><i /> Open water stress</Link></article>)}
        </div>
      </section>

      <section className="fx-farm-context-panel">
        <div className="fx-farm-context-copy"><span className="fx-overline">YOUR FARM CONTEXT</span><h2>Environmental data is only one part of the story.</h2><p>Your crop history, soil information, irrigation access and priorities will help Agrimetry compare rotation strategies responsibly. The next step is to connect these details to crop-specific requirements.</p><button className="fx-primary-button" onClick={onEdit}>Review farm details <Icon name="arrow" size={17} /></button></div>
        <div className="fx-farm-details-grid">
          <div><small>PREVIOUS CROP</small><strong>{farm.previousCrop || 'Not supplied'}</strong></div>
          <div><small>SOIL TYPE</small><strong>{farm.soilType || 'Not supplied'}</strong></div>
          <div><small>GROWING SEASON</small><strong>{farm.season || 'Not supplied'}</strong></div>
          <div><small>FARMER PRIORITIES</small><strong>{farm.priorities.length ? farm.priorities.map((id) => PRIORITY_OPTIONS.find((item) => item.id === id)?.label).filter(Boolean).join(' · ') : 'Not supplied'}</strong></div>
        </div>
      </section>

      <div className="fx-source-footer"><span><i className="fx-source-dot" /> SOURCE: NASA POWER DAILY POINT API</span><span>Fetched {new Date(result.fetchedAt).toLocaleString()}</span><a href="https://power.larc.nasa.gov/docs/services/api/temporal/daily/" target="_blank" rel="noreferrer">Data documentation <Icon name="external" size={12} /></a></div>
    </div>
  );
}

export default function FarmExplorer() {
  const [farm, setFarm] = useState({
    name: 'My field',
    locationQuery: '',
    location: '',
    latitude: '',
    longitude: '',
    area: '',
    areaUnit: 'hectares',
    currentCrop: '',
    previousCrop: '',
    soilType: '',
    irrigation: '',
    season: '',
    priorities: ['water', 'soil'],
  });
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [activeNav, setActiveNav] = useState('overview');

  async function handleSearch() {
    setSearchError('');
    setSearchResults([]);
    if (farm.locationQuery.trim().length < 2) {
      setSearchError('Enter at least two characters to search for a place.');
      return;
    }
    setSearchLoading(true);
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(farm.locationQuery.trim())}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Location search failed.');
      if (!payload.results?.length) {
        setSearchError('No matching places found. Try adding a region or country.');
      } else {
        setSearchResults(payload.results);
      }
    } catch (searchException) {
      setSearchError(searchException.message || 'Unable to search for this location.');
    } finally {
      setSearchLoading(false);
    }
  }

  function selectLocation(place) {
    setFarm((current) => ({
      ...current,
      locationQuery: place.label,
      location: place.label,
      latitude: String(place.latitude),
      longitude: String(place.longitude),
    }));
    setSearchResults([]);
    setSearchError('');
  }

  function useCurrentLocation() {
    setSearchError('');
    if (!navigator.geolocation) {
      setSearchError('Location access is not supported by this browser. Enter coordinates manually.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        setFarm((current) => ({
          ...current,
          location: 'Current device location',
          locationQuery: 'Current device location',
          latitude: String(latitude),
          longitude: String(longitude),
        }));
        setSearchResults([]);
      },
      () => setSearchError('Location permission was unavailable. You can search for a place or enter coordinates manually.'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  async function handleAnalyze(event) {
    event.preventDefault();
    setError('');
    const latitude = Number(farm.latitude);
    const longitude = Number(farm.longitude);
    if (farm.latitude === '' || farm.longitude === '' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      setError('Choose a location or enter valid coordinates before analysing your farm.');
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const response = await fetch(`/api/environment?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Environmental data could not be retrieved.');
      setResult(payload);
      setActiveNav('environment');
    } catch (analysisException) {
      setError(analysisException.message || 'Unable to build the environmental fingerprint. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleNavClick(id) {
    if (id === 'overview' || id === 'environment') {
      setActiveNav(id);
      if (id === 'overview' && result) setResult(null);
      return;
    }
    setActiveNav(id);
    document.getElementById('fx-roadmap')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <main className="fx-app-shell">
      <aside className="fx-sidebar">
        <BrandMark light />
        <div className="fx-workspace-label">WORKSPACE</div>
        <nav className="fx-nav" aria-label="Application navigation">
          <button className={activeNav === 'overview' ? 'is-active' : ''} onClick={() => handleNavClick('overview')}><Icon name="grid" size={17} /><span>Farm overview</span></button>
          <button className={activeNav === 'environment' ? 'is-active' : ''} onClick={() => handleNavClick('environment')}><Icon name="compass" size={17} /><span>Environmental data</span>{result && <i className="fx-nav-live" />}</button>
          <Link href="/explore/map" className="fx-nav-map-link"><Icon name="map" size={17} /><span>Global farm map</span><em>NEW</em></Link>
          <Link href="/explore/vegetation" className="fx-nav-map-link fx-nav-vegetation-link"><Icon name="leaf" size={17} /><span>Field vegetation</span><em>LIVE</em></Link>
          <Link href="/explore/land-story" className="fx-nav-map-link fx-nav-vegetation-link"><Icon name="book-open" size={17} /><span>AI Land Storyteller</span><em>AI</em></Link>
          <Link href="/explore/water-stress" className="fx-nav-map-link fx-nav-vegetation-link"><Icon name="droplet" size={17} /><span>Water stress</span><em>LIVE</em></Link>
          <Link href="/explore/bare-field" className="fx-nav-map-link fx-nav-vegetation-link"><Icon name="sprout" size={17} /><span>Bare-field detection</span><em>LIVE</em></Link>
          <Link href="/explore/soil-health" className="fx-nav-map-link fx-nav-vegetation-link"><Icon name="sprout" size={17} /><span>Soil health</span><em>LIVE</em></Link>
          <Link href="/explore/rotation" className="fx-nav-map-link fx-nav-vegetation-link"><Icon name="sprout" size={17} /><span>Rotation engine</span><em>NEW</em></Link>
          <Link href="/explore/replay" className="fx-nav-map-link fx-nav-vegetation-link"><Icon name="calendar" size={17} /><span>Climate replay</span><em>NEW</em></Link>
          <Link href="/explore/passport" className="fx-nav-map-link fx-nav-vegetation-link"><Icon name="leaf" size={17} /><span>Evidence passport</span><em>NEW</em></Link>
          <button onClick={() => handleNavClick('rotation')}><Icon name="sprout" size={17} /><span>Rotation explorer</span><em>SOON</em></button>
          <button onClick={() => handleNavClick('climate')}><Icon name="calendar" size={17} /><span>Climate replay</span><em>SOON</em></button>
        </nav>
        <div className="fx-sidebar-bottom">
          <div className="fx-side-earth"><div className="fx-earth-orbit"><span /></div><span>EARTH DATA, MADE USEFUL.</span></div>
          <Link href="/" className="fx-back-home"><Icon name="arrow" size={15} /> Back to Agrimetry</Link>
          <div className="fx-sidebar-version">AGRIMETRY · EARLY ACCESS</div>
        </div>
      </aside>

      <div className="fx-main-area">
        <header className="fx-topbar">
          <div className="fx-breadcrumb"><span>AGRIMETRY</span><Icon name="chevron" size={13} /><strong>{result ? 'Environmental data' : 'Farm overview'}</strong></div>
          <div className="fx-topbar-right"><span className="fx-topbar-status"><i /> POWER API READY</span><span className="fx-avatar">A</span></div>
        </header>

        <div className="fx-content-wrap">
          {!result ? (
            <SetupScreen
              farm={farm}
              setFarm={setFarm}
              onAnalyze={handleAnalyze}
              loading={loading}
              error={error}
              onSearch={handleSearch}
              searchLoading={searchLoading}
              searchResults={searchResults}
              searchError={searchError}
              onSelectLocation={selectLocation}
              onUseLocation={useCurrentLocation}
            />
          ) : (
            <Dashboard farm={farm} result={result} onEdit={() => { setResult(null); setActiveNav('overview'); }} />
          )}
        </div>
        <footer className="fx-app-footer"><span>AGRIMETRY <i>·</i> EARTH OBSERVATION FOR RESILIENT FARMING</span><span>Environmental estimates support decisions; they do not replace local expertise.</span></footer>
      </div>
    </main>
  );
}

