// Shared hydrology helpers: reference evapotranspiration, aridity and a
// standardized rainfall index. Pure functions, no network access.
//
// ET0 uses the Hargreaves-Samani equation (FAO-56 recommends it when only
// temperature is available). It is a screening estimate: it is less accurate than
// Penman-Monteith, especially in very humid or very windy places.

const GSC = 0.082; // solar constant, MJ m-2 min-1

// Extraterrestrial radiation (mm/day equivalent) for a latitude (degrees) and day of year.
export function extraterrestrialRadiationMm(latitudeDeg, dayOfYear) {
  const phi = (latitudeDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI * dayOfYear) / 365 - 1.39);
  const x = Math.min(1, Math.max(-1, -Math.tan(phi) * Math.tan(delta))); // clamp for polar day/night
  const ws = Math.acos(x);
  const ra = ((24 * 60) / Math.PI) * GSC * dr * (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));
  return Math.max(0, ra * 0.408);
}

export function dayOfYear(year, month, day = 15) {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86400000);
}

// Hargreaves-Samani ET0 in mm/day from mean/max/min air temperature.
export function hargreavesEt0(tMean, tMax, tMin, latitudeDeg, doy) {
  if (![tMean, tMax, tMin].every(Number.isFinite)) return null;
  const range = Math.max(tMax - tMin, 0);
  return Math.max(0, 0.0023 * extraterrestrialRadiationMm(latitudeDeg, doy) * (tMean + 17.8) * Math.sqrt(range));
}

// ET0 (mm/day) for a calendar month from the month's mean Tmax and Tmin.
export function monthlyEt0PerDay(tMax, tMin, latitudeDeg, year, month) {
  if (![tMax, tMin].every(Number.isFinite)) return null;
  return hargreavesEt0((tMax + tMin) / 2, tMax, tMin, latitudeDeg, dayOfYear(year, month));
}

// UNEP aridity index = annual precipitation / annual ET0.
export function aridityClass(index) {
  if (!Number.isFinite(index)) return null;
  if (index < 0.05) return { key: "hyper-arid", label: "Hyper-arid" };
  if (index < 0.2) return { key: "arid", label: "Arid" };
  if (index < 0.5) return { key: "semi-arid", label: "Semi-arid" };
  if (index < 0.65) return { key: "dry-subhumid", label: "Dry sub-humid" };
  return { key: "humid", label: "Humid or sub-humid" };
}

// Inverse of the standard normal CDF (Acklam's rational approximation).
export function inverseNormal(p) {
  if (!(p > 0 && p < 1)) return null;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Empirical standardized index: where the value ranks among historical samples,
// converted to a z-score. This is SPI-style (it does not fit a gamma distribution),
// so it is a robust screening index rather than the official SPI.
export function standardizedIndex(value, samples) {
  if (!Number.isFinite(value) || !samples || samples.length < 10) return null;
  const below = samples.filter((s) => s < value).length;
  const equal = samples.filter((s) => s === value).length;
  const p = (below + equal / 2 + 0.5) / (samples.length + 1);
  const z = inverseNormal(Math.min(Math.max(p, 1 / (samples.length + 1)), samples.length / (samples.length + 1)));
  return z;
}

export function spiClass(spi) {
  if (!Number.isFinite(spi)) return null;
  if (spi <= -2) return { key: "extreme-dry", label: "Extremely dry" };
  if (spi <= -1.5) return { key: "severe-dry", label: "Severely dry" };
  if (spi <= -1) return { key: "moderate-dry", label: "Moderately dry" };
  if (spi < 1) return { key: "normal", label: "Near normal" };
  if (spi < 1.5) return { key: "moderate-wet", label: "Moderately wet" };
  if (spi < 2) return { key: "severe-wet", label: "Very wet" };
  return { key: "extreme-wet", label: "Extremely wet" };
}
