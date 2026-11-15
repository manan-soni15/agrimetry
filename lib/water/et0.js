/**
 * Evapotranspiration Calculation Engine for Agrimetry.
 *
 * Implements:
 * 1. FAO-56 Penman-Monteith Reference Evapotranspiration (Primary method)
 *    Reference: Allen, R.G., Pereira, L.S., Raes, D., Smith, M., 1998.
 *    "Crop evapotranspiration - Guidelines for computing crop water requirements",
 *    FAO Irrigation and Drainage Paper No. 56, Rome, Italy.
 *
 * 2. Hargreaves-Samani Evapotranspiration (Fallback method)
 *    Reference: Hargreaves, G.H., Samani, Z.A., 1985.
 *    "Reference crop evapotranspiration from ambient air temperature",
 *    Applied Engineering in Agriculture, 1(2): 96-99.
 *
 * CRITICAL SCIENTIFIC DISTINCTION:
 * ET0 represents the reference atmospheric demand of a hypothetical well-watered grass surface.
 * It is NOT actual crop evapotranspiration (ETc), which requires crop coefficients (Kc) and growth stage.
 */

/**
 * Calculates saturation vapour pressure e0(T) in kPa.
 * FAO-56 Eq. 11.
 *
 * @param {number} t - Air temperature in degrees Celsius
 * @returns {number} Saturation vapour pressure in kPa
 */
export function saturationVapourPressure(t) {
  if (t == null || !Number.isFinite(t)) return null;
  return 0.6108 * Math.exp((17.27 * t) / (t + 237.3));
}

/**
 * Calculates mean saturation vapour pressure es in kPa.
 * FAO-56 Eq. 12: es = (e0(Tmax) + e0(Tmin)) / 2
 *
 * @param {number} tMax - Maximum daily temperature (°C)
 * @param {number} tMin - Minimum daily temperature (°C)
 * @returns {number} Mean saturation vapour pressure in kPa
 */
export function meanSaturationVapourPressure(tMax, tMin) {
  const eMax = saturationVapourPressure(tMax);
  const eMin = saturationVapourPressure(tMin);
  if (eMax == null || eMin == null) return null;
  return (eMax + eMin) / 2;
}

/**
 * Calculates actual vapour pressure ea in kPa.
 * Uses FAO-56 Eq. 17 when mean RH is available, or Eq. 14 with dewpoint temperature.
 *
 * @param {Object} params
 * @param {number} [params.rhMean] - Mean daily relative humidity (0-100%)
 * @param {number} [params.tMax] - Maximum daily temperature (°C)
 * @param {number} [params.tMin] - Minimum daily temperature (°C)
 * @param {number} [params.tMean] - Mean daily temperature (°C)
 * @param {number} [params.tDew] - Dew point temperature (°C)
 * @returns {number|null} Actual vapour pressure in kPa
 */
export function actualVapourPressure({ rhMean, tMax, tMin, tMean, tDew }) {
  if (tDew != null && Number.isFinite(tDew)) {
    // FAO-56 Eq. 14
    return saturationVapourPressure(tDew);
  }

  if (rhMean != null && Number.isFinite(rhMean)) {
    const boundedRh = Math.max(0, Math.min(100, rhMean));
    if (tMax != null && tMin != null && Number.isFinite(tMax) && Number.isFinite(tMin)) {
      const es = meanSaturationVapourPressure(tMax, tMin);
      return es * (boundedRh / 100);
    }
    if (tMean != null && Number.isFinite(tMean)) {
      const e0 = saturationVapourPressure(tMean);
      return e0 * (boundedRh / 100);
    }
  }
  return null;
}

/**
 * Calculates vapour pressure deficit (VPD = es - ea) in kPa.
 *
 * @param {number} es - Mean saturation vapour pressure in kPa
 * @param {number} ea - Actual vapour pressure in kPa
 * @returns {number|null} Vapour pressure deficit in kPa
 */
export function vapourPressureDeficit(es, ea) {
  if (es == null || ea == null || !Number.isFinite(es) || !Number.isFinite(ea)) {
    return null;
  }
  return Number(Math.max(0, es - ea).toFixed(4));
}

/**
 * Calculates the slope of the saturation vapour pressure curve Delta in kPa/°C.
 * FAO-56 Eq. 13.
 *
 * @param {number} t - Air temperature in degrees Celsius
 * @returns {number} Delta in kPa/°C
 */
export function slopeVapourPressureCurve(t) {
  if (t == null || !Number.isFinite(t)) return null;
  const num = 4098 * (0.6108 * Math.exp((17.27 * t) / (t + 237.3)));
  const den = Math.pow(t + 237.3, 2);
  return num / den;
}

/**
 * Calculates atmospheric pressure P in kPa from elevation z in meters.
 * FAO-56 Eq. 7.
 *
 * @param {number} elevation - Elevation above sea level in meters (default 0)
 * @returns {number} Atmospheric pressure in kPa
 */
export function atmosphericPressureFromElevation(elevation = 0) {
  const z = Number.isFinite(elevation) ? elevation : 0;
  return 101.3 * Math.pow((293 - 0.0065 * z) / 293, 5.26);
}

/**
 * Calculates psychrometric constant gamma in kPa/°C.
 * FAO-56 Eq. 8: gamma = 0.000665 * P
 *
 * @param {number} pressure - Atmospheric pressure in kPa
 * @returns {number} Psychrometric constant in kPa/°C
 */
export function psychrometricConstant(pressure = 101.3) {
  const p = Number.isFinite(pressure) && pressure > 0 ? pressure : 101.3;
  return 0.000665 * p;
}

/**
 * Converts wind speed measured at height z to standard 2-meter height u2.
 * FAO-56 Eq. 47: u2 = uz * (4.87 / ln(67.8 * z - 5.42))
 *
 * @param {number} windSpeed - Wind speed in m/s
 * @param {number} [heightMeters=2] - Measurement height in meters
 * @returns {number} Wind speed at 2 m in m/s
 */
export function convertWindTo2m(windSpeed, heightMeters = 2) {
  if (windSpeed == null || !Number.isFinite(windSpeed) || windSpeed < 0) return 0;
  if (heightMeters === 2) return windSpeed;
  if (heightMeters <= 0.1) return windSpeed;
  const factor = 4.87 / Math.log(67.8 * heightMeters - 5.42);
  return Math.max(0, windSpeed * factor);
}

/**
 * Calculates day of year (1-366) from Date object or ISO string.
 *
 * @param {Date|string} date
 * @returns {number}
 */
export function getDayOfYear(date) {
  const d = new Date(date);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 0));
  const diff = d.getTime() - start.getTime();
  const oneDay = 86400000;
  return Math.floor(diff / oneDay);
}

/**
 * Calculates extraterrestrial radiation Ra in MJ/m²/day.
 * FAO-56 Eqs. 21-28.
 *
 * @param {number} latitude - Latitude in decimal degrees
 * @param {number} dayOfYear - Julian day of year (1-366)
 * @returns {number} Ra in MJ/m²/day
 */
export function extraterrestrialRadiation(latitude, dayOfYear) {
  if (!Number.isFinite(latitude) || !Number.isFinite(dayOfYear)) return null;

  const phi = (Math.PI / 180) * latitude;
  const j = dayOfYear;

  // Inverse relative distance Earth-Sun, FAO-56 Eq. 23
  const dr = 1 + 0.033 * Math.cos(((2 * Math.PI) / 365) * j);

  // Solar declination, FAO-56 Eq. 24
  const delta = 0.409 * Math.sin(((2 * Math.PI) / 365) * j - 1.39);

  // Sunset hour angle, FAO-56 Eq. 25
  const x = -Math.tan(phi) * Math.tan(delta);
  let ws;
  if (x >= 1.0) {
    ws = 0; // Polar night
  } else if (x <= -1.0) {
    ws = Math.PI; // Midnight sun
  } else {
    ws = Math.acos(x);
  }

  // Solar constant Gsc = 0.0820 MJ/m2/min
  const gsc = 0.082;

  // FAO-56 Eq. 21
  const ra =
    ((24 * 60) / Math.PI) *
    gsc *
    dr *
    (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));

  return Math.max(0, ra);
}

/**
 * Calculates clear-sky solar radiation Rso in MJ/m²/day.
 * FAO-56 Eq. 37: Rso = (0.75 + 2e-5 * z) * Ra
 *
 * @param {number} ra - Extraterrestrial radiation in MJ/m²/day
 * @param {number} [elevation=0] - Elevation in meters
 * @returns {number} Rso in MJ/m²/day
 */
export function clearSkySolarRadiation(ra, elevation = 0) {
  if (ra == null || !Number.isFinite(ra)) return null;
  const z = Number.isFinite(elevation) ? elevation : 0;
  return (0.75 + 2e-5 * z) * ra;
}

/**
 * Calculates net radiation Rn in MJ/m²/day.
 * Combines net shortwave Rns and net longwave Rnl.
 * FAO-56 Eqs. 38-39.
 *
 * @param {Object} params
 * @param {number} params.rs - Incoming solar radiation (MJ/m²/day)
 * @param {number} params.ra - Extraterrestrial radiation (MJ/m²/day)
 * @param {number} params.tMax - Max temperature (°C)
 * @param {number} params.tMin - Min temperature (°C)
 * @param {number} params.ea - Actual vapour pressure (kPa)
 * @param {number} [params.elevation=0] - Elevation in meters
 * @param {number} [params.albedo=0.23] - Reference canopy albedo
 * @returns {number} Rn in MJ/m²/day
 */
export function calculateNetRadiation({ rs, ra, tMax, tMin, ea, elevation = 0, albedo = 0.23 }) {
  if (
    rs == null ||
    ra == null ||
    tMax == null ||
    tMin == null ||
    ea == null ||
    !Number.isFinite(rs) ||
    !Number.isFinite(ra) ||
    !Number.isFinite(tMax) ||
    !Number.isFinite(tMin) ||
    !Number.isFinite(ea)
  ) {
    return null;
  }

  // 1. Net solar shortwave radiation Rns, FAO-56 Eq. 38
  const rns = (1 - albedo) * rs;

  // 2. Clear-sky solar radiation Rso
  const rso = clearSkySolarRadiation(ra, elevation);
  if (!rso || rso <= 0) return rns;

  // Relative solar radiation Rs / Rso, bounded [0.3, 1.0] per FAO-56
  const relativeSolar = Math.max(0.3, Math.min(1.0, rs / rso));

  // Stefan-Boltzmann constant in MJ/K4/m2/day, FAO-56 p. 52
  const sigma = 4.903e-9;
  const tMaxK = Math.pow(tMax + 273.16, 4);
  const tMinK = Math.pow(tMin + 273.16, 4);
  const meanTempK4 = (tMaxK + tMinK) / 2;

  // Net longwave radiation Rnl, FAO-56 Eq. 39
  const eaFactor = Math.max(0, 0.34 - 0.14 * Math.sqrt(Math.max(0, ea)));
  const cloudFactor = 1.35 * relativeSolar - 0.35;
  const rnl = sigma * meanTempK4 * eaFactor * cloudFactor;

  // Net radiation Rn = Rns - Rnl, FAO-56 Eq. 40
  return rns - rnl;
}

/**
 * Calculates FAO-56 Penman-Monteith Reference Evapotranspiration (ET0) in mm/day.
 * FAO-56 Eq. 6.
 *
 * @param {Object} params
 * @param {number} params.tMean - Daily mean air temperature (°C)
 * @param {number} params.tMax - Daily maximum air temperature (°C)
 * @param {number} params.tMin - Daily minimum air temperature (°C)
 * @param {number} params.rhMean - Daily mean relative humidity (0-100%)
 * @param {number} params.solarRadiation - Downward solar radiation in MJ/m²/day
 * @param {number} params.windSpeed2m - Wind speed at 2 m in m/s
 * @param {number} params.latitude - Latitude in decimal degrees
 * @param {number} params.dayOfYear - Julian day of year (1-366)
 * @param {number} [params.pressureKpa] - Surface atmospheric pressure in kPa
 * @param {number} [params.elevationMeters=0] - Elevation in meters
 * @returns {number|null} ET0 in mm/day, or null if inputs are insufficient
 */
export function calculatePenmanMonteith({
  tMean,
  tMax,
  tMin,
  rhMean,
  solarRadiation,
  windSpeed2m,
  latitude,
  dayOfYear,
  pressureKpa,
  elevationMeters = 0,
}) {
  // Validate presence and finiteness of essential inputs
  if (
    tMax == null ||
    tMin == null ||
    rhMean == null ||
    solarRadiation == null ||
    windSpeed2m == null ||
    latitude == null ||
    dayOfYear == null ||
    !Number.isFinite(tMax) ||
    !Number.isFinite(tMin) ||
    !Number.isFinite(rhMean) ||
    !Number.isFinite(solarRadiation) ||
    !Number.isFinite(windSpeed2m) ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(dayOfYear) ||
    rhMean < 0 ||
    rhMean > 100
  ) {
    return null;
  }

  const t = tMean != null && Number.isFinite(tMean) ? tMean : (tMax + tMin) / 2;
  const u2 = Math.max(0, windSpeed2m);
  const p =
    pressureKpa != null && Number.isFinite(pressureKpa) && pressureKpa > 50
      ? pressureKpa
      : atmosphericPressureFromElevation(elevationMeters);

  const delta = slopeVapourPressureCurve(t);
  const gamma = psychrometricConstant(p);
  const es = meanSaturationVapourPressure(tMax, tMin);
  const ea = actualVapourPressure({ rhMean, tMax, tMin, tMean: t });

  if (delta == null || gamma == null || es == null || ea == null) return null;

  const ra = extraterrestrialRadiation(latitude, dayOfYear);
  const rn = calculateNetRadiation({
    rs: solarRadiation,
    ra,
    tMax,
    tMin,
    ea,
    elevation: elevationMeters,
  });

  if (rn == null) return null;

  // Daily soil heat flux G = 0, FAO-56 Eq. 42
  const g = 0;

  // FAO-56 Penman-Monteith Eq. 6
  // ET0 = [0.408 * Delta * (Rn - G) + gamma * (900 / (T + 273)) * u2 * (es - ea)] /
  //       [Delta + gamma * (1 + 0.34 * u2)]
  const vpd = Math.max(0, es - ea);
  const termRadiation = 0.408 * delta * (rn - g);
  const termAerodynamic = gamma * (900 / (t + 273)) * u2 * vpd;
  const denominator = delta + gamma * (1 + 0.34 * u2);

  if (denominator <= 0) return null;

  const et0 = (termRadiation + termAerodynamic) / denominator;
  return Number(Math.max(0, et0).toFixed(2));
}

/**
 * Calculates Hargreaves-Samani Evapotranspiration in mm/day.
 * Fallback when wind or humidity are unavailable.
 *
 * ET0 = 0.0023 * (Tmean + 17.8) * (Tmax - Tmin)^0.5 * Ra * 0.408
 * (0.408 converts Ra in MJ/m²/day to equivalent mm/day)
 *
 * @param {Object} params
 * @param {number} params.tMean - Daily mean air temperature (°C)
 * @param {number} params.tMax - Daily maximum air temperature (°C)
 * @param {number} params.tMin - Daily minimum air temperature (°C)
 * @param {number} params.latitude - Latitude in decimal degrees
 * @param {number} params.dayOfYear - Julian day of year (1-366)
 * @returns {number|null} Estimated ET0 in mm/day
 */
export function calculateHargreavesSamani({ tMean, tMax, tMin, latitude, dayOfYear }) {
  if (
    tMax == null ||
    tMin == null ||
    latitude == null ||
    dayOfYear == null ||
    !Number.isFinite(tMax) ||
    !Number.isFinite(tMin) ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(dayOfYear)
  ) {
    return null;
  }

  const deltaT = tMax - tMin;
  if (deltaT < 0) return null;

  const t = tMean != null && Number.isFinite(tMean) ? tMean : (tMax + tMin) / 2;
  const ra = extraterrestrialRadiation(latitude, dayOfYear);
  if (ra == null) return null;

  // Hargreaves (1985) formula:
  // ET0 = 0.0023 * (T + 17.8) * (Tmax - Tmin)^0.5 * (0.408 * Ra)
  const et0 = 0.0023 * (t + 17.8) * Math.sqrt(deltaT) * (0.408 * ra);
  return Number(Math.max(0, et0).toFixed(2));
}

/**
 * Computes Reference Evapotranspiration with automated fallback.
 * Prefers FAO-56 Penman-Monteith, falls back to Hargreaves-Samani if inputs are missing.
 *
 * @param {Object} dayRecord - Meteorological day record from NASA POWER
 * @param {number} latitude - Latitude in decimal degrees
 * @param {number} [elevationMeters=0] - Elevation in meters
 * @returns {{ et0: number|null, method: string, isFallback: boolean, qualityStatus: string, reason: string|null }}
 */
export function computeDailyEt0(dayRecord, latitude, elevationMeters = 0) {
  const dayOfYear = getDayOfYear(dayRecord.date || new Date());

  const pmEt0 = calculatePenmanMonteith({
    tMean: dayRecord.temperature,
    tMax: dayRecord.maximumTemperature,
    tMin: dayRecord.minimumTemperature,
    rhMean: dayRecord.humidity,
    solarRadiation: dayRecord.solarRadiation,
    windSpeed2m: dayRecord.windSpeed != null ? dayRecord.windSpeed : dayRecord.windSpeed2m,
    latitude,
    dayOfYear,
    pressureKpa: dayRecord.pressure,
    elevationMeters,
  });

  if (pmEt0 !== null) {
    return {
      et0: pmEt0,
      method: "FAO-56 Penman-Monteith",
      isFallback: false,
      qualityStatus: "optimal",
      reason: null,
    };
  }

  const hsEt0 = calculateHargreavesSamani({
    tMean: dayRecord.temperature,
    tMax: dayRecord.maximumTemperature,
    tMin: dayRecord.minimumTemperature,
    latitude,
    dayOfYear,
  });

  if (hsEt0 !== null) {
    return {
      et0: hsEt0,
      method: "Estimated ET0 — Hargreaves–Samani",
      isFallback: true,
      qualityStatus: "estimated_fallback",
      reason: "Missing humidity, wind, or solar radiation inputs required for FAO-56 Penman-Monteith.",
    };
  }

  return {
    et0: null,
    method: "unavailable",
    isFallback: false,
    qualityStatus: "insufficient_data",
    reason: "Required daily temperature inputs are missing or invalid.",
  };
}
