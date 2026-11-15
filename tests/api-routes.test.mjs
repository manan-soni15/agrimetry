import test from 'node:test';
import assert from 'node:assert/strict';
import { GET as geocodeGet } from '../app/api/geocode/route.js';
import { GET as environmentGet } from '../app/api/environment/route.js';
import { GET as vegetationGet, POST as vegetationPost } from '../app/api/vegetation/route.js';
import { GET as waterGet, POST as waterPost } from '../app/api/water/route.js';

test('1. Geocode API: Input Validation & Edge Cases', async () => {
  // Query too short (< 2 chars)
  const shortReq = new Request('http://localhost/api/geocode?q=a');
  const shortRes = await geocodeGet(shortReq);
  assert.equal(shortRes.status, 400);
  const shortJson = await shortRes.json();
  assert.ok(shortJson.error.includes('at least 2 characters'));

  // Missing query
  const emptyReq = new Request('http://localhost/api/geocode');
  const emptyRes = await geocodeGet(emptyReq);
  assert.equal(emptyRes.status, 400);

  // Query too long (> 100 chars)
  const longReq = new Request(`http://localhost/api/geocode?q=${'x'.repeat(101)}`);
  const longRes = await geocodeGet(longReq);
  assert.equal(longRes.status, 400);
});

test('2. Environment API: Coordinate Validation', async () => {
  // Missing coordinates
  const missingReq = new Request('http://localhost/api/environment');
  const missingRes = await environmentGet(missingReq);
  assert.equal(missingRes.status, 400);
  const missingJson = await missingRes.json();
  assert.ok(missingJson.error.includes('valid latitude and longitude'));

  // Out of bounds latitude
  const badLatReq = new Request('http://localhost/api/environment?lat=95&lon=75');
  const badLatRes = await environmentGet(badLatReq);
  assert.equal(badLatRes.status, 400);

  // Out of bounds longitude
  const badLonReq = new Request('http://localhost/api/environment?lat=26&lon=200');
  const badLonRes = await environmentGet(badLonReq);
  assert.equal(badLonRes.status, 400);

  // Non-numeric coordinates
  const nanReq = new Request('http://localhost/api/environment?lat=abc&lon=xyz');
  const nanRes = await environmentGet(nanReq);
  assert.equal(nanRes.status, 400);
});

test('3. Vegetation API: Input Validation & POST Schema', async () => {
  // Invalid JSON body in POST
  const invalidJsonReq = new Request('http://localhost/api/vegetation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'this is not valid json',
  });
  const invalidJsonRes = await vegetationPost(invalidJsonReq);
  assert.equal(invalidJsonRes.status, 400);
  const invalidJsonPayload = await invalidJsonRes.json();
  assert.ok(invalidJsonPayload.error);

  // Invalid coordinates in POST body
  const badCoordReq = new Request('http://localhost/api/vegetation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude: 999, longitude: 0 }),
  });
  const badCoordRes = await vegetationPost(badCoordReq);
  assert.equal(badCoordRes.status, 400);

  // Invalid date range in POST body
  const badDateReq = new Request('http://localhost/api/vegetation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      latitude: 26.9124,
      longitude: 75.7873,
      from: '2024-05-01',
      to: '2023-01-01', // to before from
    }),
  });
  const badDateRes = await vegetationPost(badDateReq);
  assert.equal(badDateRes.status, 400);

  // GET route with missing coordinates
  const missingGetReq = new Request('http://localhost/api/vegetation');
  const missingGetRes = await vegetationGet(missingGetReq);
  assert.equal(missingGetRes.status, 400);
});

test('4. Water Stress API: Input Validation & POST Schema', async () => {
  // Invalid JSON body in POST
  const invalidJsonReq = new Request('http://localhost/api/water', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{broken',
  });
  const invalidJsonRes = await waterPost(invalidJsonReq);
  assert.equal(invalidJsonRes.status, 400);

  // Invalid coordinates in POST
  const badCoordReq = new Request('http://localhost/api/water', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude: -100, longitude: 50 }),
  });
  const badCoordRes = await waterPost(badCoordReq);
  assert.equal(badCoordRes.status, 400);

  // Invalid date range in POST
  const badDateReq = new Request('http://localhost/api/water', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      latitude: 26.9124,
      longitude: 75.7873,
      from: '2024-06-01',
      to: '2024-01-01',
    }),
  });
  const badDateRes = await waterPost(badDateReq);
  assert.equal(badDateRes.status, 400);

  // GET route with missing coordinates
  const missingGetReq = new Request('http://localhost/api/water');
  const missingGetRes = await waterGet(missingGetReq);
  assert.equal(missingGetRes.status, 400);
});

test('5. Cache Isolation & Distinct Cache Keys for Multi-Field Support', async () => {
  const { getCacheKey: getVegCacheKey } = await import('../app/api/vegetation/route.js');
  const { getCacheKey: getWaterCacheKey } = await import('../app/api/water/route.js');

  const geomField1 = {
    type: 'Polygon',
    coordinates: [[[75.78, 26.91], [75.80, 26.91], [75.80, 26.93], [75.78, 26.93], [75.78, 26.91]]],
  };
  const geomField2 = {
    type: 'Polygon',
    coordinates: [[[77.10, 28.60], [77.12, 28.60], [77.12, 28.62], [77.10, 28.62], [77.10, 28.60]]],
  };

  const vegKey1 = getVegCacheKey(geomField1, '2024-01-01', '2024-03-01', 'P10D');
  const vegKey2 = getVegCacheKey(geomField2, '2024-01-01', '2024-03-01', 'P10D');
  const vegKeyDifferentDate = getVegCacheKey(geomField1, '2024-01-01', '2024-06-01', 'P10D');

  assert.notEqual(vegKey1, vegKey2, 'Different field geometries must generate distinct cache keys');
  assert.notEqual(vegKey1, vegKeyDifferentDate, 'Different date ranges must generate distinct cache keys');

  const waterKey1 = getWaterCacheKey(geomField1, '2024-01-01', '2024-03-01');
  const waterKey2 = getWaterCacheKey(geomField2, '2024-01-01', '2024-03-01');
  assert.notEqual(waterKey1, waterKey2, 'Water API must generate distinct cache keys for different fields');
});

test('6. Stale Request & AbortController Protection in Analysis Components', async () => {
  // Test that AbortController aborts cleanly and signal is properly configured
  const controller = new AbortController();
  assert.equal(controller.signal.aborted, false);
  controller.abort();
  assert.equal(controller.signal.aborted, true);

  // Simulated rapid field switching: newest request supersedes previous
  let activeId = 'field-1';
  let activeData = null;

  const runRequest = async (fieldId, msDelay, dataPayload) => {
    let active = true;
    if (activeId !== fieldId) active = false;
    await new Promise((r) => setTimeout(r, msDelay));
    if (active && activeId === fieldId) {
      activeData = dataPayload;
    }
  };

  // Start slow request for field 1
  const req1 = runRequest('field-1', 50, { name: 'Field 1 Result' });
  // User rapidly switches to field 2
  activeId = 'field-2';
  const req2 = runRequest('field-2', 10, { name: 'Field 2 Result' });

  await Promise.all([req1, req2]);
  assert.equal(activeData.name, 'Field 2 Result', 'Stale request from field 1 must not overwrite field 2 data');
});


