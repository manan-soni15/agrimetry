/**
 * Agrimetry Farm Explorer State & Navigation Utilities
 * 
 * Centralizes view resolution, URL parameter parsing, active farm serialization,
 * coordinate validation, and canonical benchmark agricultural presets.
 */

export const VALID_VIEWS = [
  'overview',
  'environment',
  'vegetation',
  'water',
  'rotation',
  'climate',
];

export const VIEW_TITLES = {
  overview: 'Farm overview',
  environment: 'Environmental data',
  vegetation: 'Vegetation intelligence',
  water: 'Soil moisture & water',
  rotation: 'Rotation explorer (Roadmap)',
  climate: 'Climate replay (Roadmap)',
};

export const BENCHMARK_FARM = {
  name: 'Jaipur Agricultural Benchmark',
  location: 'Jaipur, Rajasthan, India',
  locationQuery: 'Jaipur, Rajasthan, India',
  latitude: '26.9124',
  longitude: '75.7873',
  area: '4.5',
  areaUnit: 'hectares',
  currentCrop: 'Wheat',
  previousCrop: 'Mustard',
  soilType: 'Sandy loam',
  irrigation: 'Limited irrigation',
  season: 'Rabi (Winter)',
  priorities: ['water', 'soil'],
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [75.7850, 26.9100],
        [75.7895, 26.9100],
        [75.7895, 26.9148],
        [75.7850, 26.9148],
        [75.7850, 26.9100],
      ],
    ],
  },
  fieldId: 'benchmark-jaipur-01',
};

export const DEFAULT_FARM = {
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
  geometry: null,
  fieldId: null,
};

/**
 * Validates that latitude and longitude are finite numbers within Earth geographic boundaries.
 */
export function hasValidCoordinates(farm) {
  if (!farm) return false;
  if (farm.latitude === '' || farm.longitude === '' || farm.latitude == null || farm.longitude == null) {
    return false;
  }
  const lat = Number(farm.latitude);
  const lon = Number(farm.longitude);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/**
 * Normalizes view parameter to a supported view key.
 */
export function resolveActiveView(viewKey, fallback = 'overview') {
  if (typeof viewKey === 'string' && VALID_VIEWS.includes(viewKey.toLowerCase())) {
    return viewKey.toLowerCase();
  }
  return fallback;
}

/**
 * Extracts farm profile parameters from a URL search string or URLSearchParams.
 */
export function parseFarmFromUrl(search, initialFarm = DEFAULT_FARM) {
  if (!search) return { ...initialFarm };
  try {
    const sp = typeof search === 'string' ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) : search;
    const lat = sp.get('lat');
    const lon = sp.get('lon');
    const name = sp.get('name');
    const area = sp.get('area');
    const fieldId = sp.get('fieldId');
    const crop = sp.get('crop');
    const soil = sp.get('soil');

    if (lat && lon) {
      const latNum = Number(lat);
      const lonNum = Number(lon);
      if (Number.isFinite(latNum) && Number.isFinite(lonNum) && latNum >= -90 && latNum <= 90 && lonNum >= -180 && lonNum <= 180) {
        return {
          ...initialFarm,
          latitude: String(latNum),
          longitude: String(lonNum),
          name: name || initialFarm.name,
          area: area || initialFarm.area,
          location: name || `${latNum.toFixed(4)}, ${lonNum.toFixed(4)}`,
          locationQuery: name || `${latNum.toFixed(4)}, ${lonNum.toFixed(4)}`,
          fieldId: fieldId || initialFarm.fieldId,
          currentCrop: crop || initialFarm.currentCrop,
          soilType: soil || initialFarm.soilType,
        };
      }
    }
  } catch (err) {
    console.warn('Could not parse farm parameters from URL:', err);
  }
  return { ...initialFarm };
}

/**
 * Safely serializes active farm state for storage in localStorage.
 */
export function serializeActiveFarm(farm) {
  if (!hasValidCoordinates(farm)) return null;
  return JSON.stringify({
    name: farm.name || 'My field',
    location: farm.location || '',
    locationQuery: farm.locationQuery || '',
    latitude: farm.latitude,
    longitude: farm.longitude,
    area: farm.area || '',
    areaUnit: farm.areaUnit || 'hectares',
    currentCrop: farm.currentCrop || '',
    previousCrop: farm.previousCrop || '',
    soilType: farm.soilType || '',
    irrigation: farm.irrigation || '',
    season: farm.season || '',
    priorities: farm.priorities || ['water', 'soil'],
    geometry: farm.geometry || null,
    fieldId: farm.fieldId || null,
  });
}

/**
 * Safely deserializes active farm state from localStorage JSON string.
 */
export function deserializeActiveFarm(rawString, fallback = DEFAULT_FARM) {
  if (!rawString || typeof rawString !== 'string') return { ...fallback };
  try {
    const parsed = JSON.parse(rawString);
    if (parsed && typeof parsed === 'object' && hasValidCoordinates(parsed)) {
      return {
        ...fallback,
        ...parsed,
      };
    }
  } catch (err) {
    console.warn('Could not deserialize active farm:', err);
  }
  return { ...fallback };
}

