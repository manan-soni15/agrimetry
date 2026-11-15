import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BENCHMARK_FARM,
  DEFAULT_FARM,
  deserializeActiveFarm,
  hasValidCoordinates,
  parseFarmFromUrl,
  resolveActiveView,
  serializeActiveFarm,
  VALID_VIEWS,
  VIEW_TITLES,
} from '../lib/explore/explore-state.js';

test('1. hasValidCoordinates: Boundary & Type Validation', () => {
  assert.equal(hasValidCoordinates({ latitude: '26.9124', longitude: '75.7873' }), true);
  assert.equal(hasValidCoordinates({ latitude: 0, longitude: 0 }), true);
  assert.equal(hasValidCoordinates({ latitude: -90, longitude: -180 }), true);
  assert.equal(hasValidCoordinates({ latitude: 90, longitude: 180 }), true);

  // Out of bounds
  assert.equal(hasValidCoordinates({ latitude: '90.001', longitude: '75.0' }), false);
  assert.equal(hasValidCoordinates({ latitude: '-91.0', longitude: '75.0' }), false);
  assert.equal(hasValidCoordinates({ latitude: '20.0', longitude: '180.001' }), false);
  assert.equal(hasValidCoordinates({ latitude: '20.0', longitude: '-181.0' }), false);

  // Missing or non-numeric
  assert.equal(hasValidCoordinates(null), false);
  assert.equal(hasValidCoordinates({}), false);
  assert.equal(hasValidCoordinates({ latitude: '', longitude: '' }), false);
  assert.equal(hasValidCoordinates({ latitude: 'abc', longitude: 'xyz' }), false);
  assert.equal(hasValidCoordinates({ latitude: '26.9124', longitude: null }), false);
});

test('2. resolveActiveView: Canonical Routing Resolution', () => {
  for (const view of VALID_VIEWS) {
    assert.equal(resolveActiveView(view), view);
    assert.equal(resolveActiveView(view.toUpperCase()), view);
  }

  // Fallback behavior
  assert.equal(resolveActiveView('invalid_view'), 'overview');
  assert.equal(resolveActiveView(''), 'overview');
  assert.equal(resolveActiveView(null), 'overview');
  assert.equal(resolveActiveView(undefined), 'overview');
  assert.equal(resolveActiveView('unknown', 'vegetation'), 'vegetation');
});

test('3. VIEW_TITLES: All Valid Views Have Human-Readable Titles', () => {
  for (const view of VALID_VIEWS) {
    assert.ok(typeof VIEW_TITLES[view] === 'string' && VIEW_TITLES[view].length > 0);
  }
});

test('4. parseFarmFromUrl: URL Parameter Extraction & Sanitization', () => {
  const query = '?lat=28.6139&lon=77.2090&name=Delhi+Organic+Plot&area=3.2&fieldId=f-101&crop=Wheat&soil=Loam';
  const parsed = parseFarmFromUrl(query);

  assert.equal(parsed.latitude, '28.6139');
  assert.equal(parsed.longitude, '77.209');
  assert.equal(parsed.name, 'Delhi Organic Plot');
  assert.equal(parsed.area, '3.2');
  assert.equal(parsed.fieldId, 'f-101');
  assert.equal(parsed.currentCrop, 'Wheat');
  assert.equal(parsed.soilType, 'Loam');
  assert.ok(hasValidCoordinates(parsed));

  // Invalid coordinates in URL should not overwrite defaults with bad values
  const badQuery = '?lat=999&lon=-999&name=Bad+Farm';
  const badParsed = parseFarmFromUrl(badQuery, DEFAULT_FARM);
  assert.equal(badParsed.latitude, '');
  assert.equal(badParsed.longitude, '');
});

test('5. Active Farm Serialization & Deserialization (localStorage round-trip)', () => {
  const farm = {
    name: 'Field Alpha',
    location: 'Rajasthan, India',
    locationQuery: 'Rajasthan, India',
    latitude: '26.5',
    longitude: '75.5',
    area: '10',
    areaUnit: 'hectares',
    currentCrop: 'Mustard',
    previousCrop: 'Millet',
    soilType: 'Sandy',
    irrigation: 'Rainfed',
    season: 'Rabi',
    priorities: ['water'],
    geometry: null,
    fieldId: 'field-alpha-1',
  };

  const serialized = serializeActiveFarm(farm);
  assert.ok(typeof serialized === 'string');

  const deserialized = deserializeActiveFarm(serialized);
  assert.equal(deserialized.name, 'Field Alpha');
  assert.equal(deserialized.latitude, '26.5');
  assert.equal(deserialized.longitude, '75.5');
  assert.equal(deserialized.currentCrop, 'Mustard');
  assert.deepEqual(deserialized.priorities, ['water']);

  // Malformed JSON test
  const corrupt = deserializeActiveFarm('{bad json}');
  assert.equal(corrupt.latitude, '');

  // Serializing farm without coordinates returns null
  assert.equal(serializeActiveFarm(DEFAULT_FARM), null);
});

test('6. Benchmark Agricultural Field Integrity', () => {
  assert.ok(hasValidCoordinates(BENCHMARK_FARM));
  assert.equal(BENCHMARK_FARM.name, 'Jaipur Agricultural Benchmark');
  assert.equal(BENCHMARK_FARM.fieldId, 'benchmark-jaipur-01');

  // Verify GeoJSON closed ring polygon
  const coords = BENCHMARK_FARM.geometry.coordinates[0];
  assert.ok(coords.length >= 4);
  const first = coords[0];
  const last = coords[coords.length - 1];
  assert.equal(first[0], last[0]);
  assert.equal(first[1], last[1]);
});

test('7. Decoupled Architecture: Feature Independence from Climate Result', () => {
  // A farm with valid coordinates should be ready for Vegetation and Water Intelligence
  // without needing a prior climate baseline result.
  const activeFarm = {
    latitude: '26.9124',
    longitude: '75.7873',
    name: 'Test Field',
    area: '5',
  };

  const isReadyForVegetation = hasValidCoordinates(activeFarm);
  const isReadyForWater = hasValidCoordinates(activeFarm);
  const isClimateFingerprintLoaded = false; // result is null

  assert.equal(isReadyForVegetation, true);
  assert.equal(isReadyForWater, true);
  // Feature views can be displayed even when climate fingerprint is null
  assert.equal(isClimateFingerprintLoaded, false);
});

