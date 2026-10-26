'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine');
const { createDataset } = require('../src/dataset');
const d = createDataset();

test('Sydney local time observes daylight saving and is independent of machine timezone', () => {
  assert.equal(E.localInstant('2027-01-15', 14).toISOString(), '2027-01-15T03:00:00.000Z');
  assert.equal(E.localInstant('2027-07-15', 14).toISOString(), '2027-07-15T04:00:00.000Z');
  assert.equal(E.localInstant('2027-10-03', 8).toISOString(), '2027-10-02T21:00:00.000Z');
});
test('solar position has independent seasonal and directional sanity bounds', () => {
  const summer = E.sunPosition(E.localInstant('2027-01-15', 13), d.latitude, d.longitude);
  const winter = E.sunPosition(E.localInstant('2027-06-21', 12), d.latitude, d.longitude);
  assert.ok(summer.altitude > 75 && summer.altitude < 80);
  assert.ok(winter.altitude > 31 && winter.altitude < 34);
  assert.ok(winter.azimuth < 10 || winter.azimuth > 350);
  assert.equal(E.sunPosition(E.localInstant('2027-06-21', 18), d.latitude, d.longitude).daytime, false);
});
test('10m building under a 45-degree east sun casts a 10m westward shadow', () => {
  const data = { buildings: [{ id: 'B', x: 0, y: 0, w: 10, d: 10, height: 10 }], trees: [] };
  const shapes = E.shadowPolygons(data, { daytime: true, altitude: 45, azimuth: 90 });
  assert.ok(Math.abs(shapes[0].bounds[0] + 10) < 1e-8);
  assert.equal(E.transmissionAt(shapes, -5, 5), 0);
  assert.equal(E.transmissionAt(shapes, 15, 5), 1);
  assert.equal(E.transmissionAt([], 15, 5, false), 0);
});
test('tree silhouette preserves stated transmission; duplicate crowns do not double attenuate', () => {
  const t = { id: 'T', x: 0, y: 0, radius: 5, height: 10, transmission: .25 };
  const shapes = E.shadowPolygons({ buildings: [], trees: [t, { ...t, id: 'T2' }] }, { daytime: true, altitude: 90, azimuth: 0 });
  assert.equal(E.transmissionAt(shapes, 0, 0), .25);
});
test('routing follows edges and respects inaccessible links, rather than straight-line circles', () => {
  const fixture = { nodes: [{ id: 0 }, { id: 1 }, { id: 2 }], edges: [{ a: 0, b: 1, length: 10, accessible: false }, { a: 0, b: 2, length: 20, accessible: true }, { a: 2, b: 1, length: 20, accessible: true }] };
  assert.equal(E.shortestPaths(fixture, 0, false).distance[1], 10);
  assert.equal(E.shortestPaths(fixture, 0, true).distance[1], 40);
  assert.deepEqual(E.shortestPaths(fixture, 0, true).path(1), [0, 2, 1]);
});
test('capacitated allocation reroutes priority flows so other residents can also be served', () => {
  const fixture = { demand: [{ id: 'P', population: 1, priority: 1 }, { id: 'G', population: 1, priority: 0 }], facilities: [{ id: 'A', capacity: 1, accessible: true, open: 8, close: 20 }, { id: 'B', capacity: 1, accessible: true, open: 8, close: 20 }] };
  const route = { minutes: 1, sunMinutes: .5, path: [0, 1], distance: 60 };
  const result = E.allocate(fixture, { hour: 12, accessibleOnly: true }, ['A', 'B'], { P: { A: route, B: { ...route, minutes: 2 } }, G: { A: route } });
  assert.equal(result.priorityServed, 1); assert.equal(result.served, 2);
  assert.equal(result.assignments.find(a => a.demandId === 'P').facilityId, 'B');
});
test('synthetic result is deterministic, satisfies budget/capacity and deduplicates people', () => {
  const a = E.solve(d, {}), b = E.solve(createDataset(), {});
  assert.deepEqual(a, b); assert.deepEqual(E.validateResult(d, a), []);
  assert.equal(a.dataKind, 'synthetic'); assert.equal(a.best.population, 2092);
  assert.equal(a.baseline.served, 210); assert.equal(a.best.cost, 60000);
  assert.equal(a.best.served, 1000); assert.equal(a.best.priorityServed, 515);
  assert.ok(a.best.meanSunMinutes <= a.best.meanWalkMinutes);
  assert.ok(a.best.clusters.every(c => c.served <= c.population));
});
test('zero budget has no additional benefit or fabricated cost per additional person', () => {
  const r = E.solve(d, { budget: 0 });
  assert.equal(r.best.additional, 0); assert.equal(r.best.cost, 0); assert.equal(r.best.costPerAdditional, null); assert.deepEqual(r.best.selectedIds, []);
});
test('closed facilities only serve residents after the paid extension; arrival includes dwell time', () => {
  const closed = E.solve(d, { hour: 17, budget: 8000 }), extended = E.solve(d, { hour: 17, budget: 8000, extendHours: true });
  assert.equal(closed.baseline.served, 0); assert.equal(closed.best.served, 0);
  assert.equal(extended.best.served, 210); assert.equal(extended.best.cost, 8000);
  const nearClose = E.solve(d, { hour: 16.5, budget: 0 });
  assert.ok(nearClose.best.assignments.every(a => a.minutes === 0));
});
test('candidate exclusion, count limit and accessibility all constrain the optimizer', () => {
  const r = E.solve(d, { budget: 100000, maxFacilities: 1, candidateIds: ['F1', 'F4'] });
  assert.deepEqual(r.best.selectedIds, ['F1']);
  assert.ok(r.alternatives.every(a => a.selectedIds.length <= 1 && !a.selectedIds.includes('F4')));
});
test('nighttime has zero direct-sun exposure without removing cooling demand', () => {
  const r = E.solve(d, { date: '2027-06-21', hour: 18 });
  assert.equal(r.shadePercent, null); assert.equal(r.best.meanSunMinutes, 0); assert.equal(r.best.population, 2092); assert.ok(r.best.unmet > 0);
});
test('invalid dates, nonfinite values, unknown candidates and unaffordable interventions fail', () => {
  for (const bad of [{ date: '2027-02-30' }, { hour: 25 }, { budget: -1 }, { speed: NaN }, { maxFacilities: 1.5 }, { candidateIds: ['F99'] }, { candidateIds: ['F1', 'F1'] }, { accessibleOnly: 'false' }, { extendHours: true, budget: 0 }]) assert.throws(() => E.validateInput(d, bad));
});
test('independent validator detects capacity tampering', () => {
  const r = E.solve(d, {}); r.alternatives[0].usage[0].served = 100000;
  assert.ok(E.validateResult(d, r).some(error => error.includes('capacity')));
});
