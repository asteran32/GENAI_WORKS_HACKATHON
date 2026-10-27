'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spatialIndex, clippedBox, shadowBox, blocked } = require('../gis-shadow');

test('indexed shadow candidates match an exhaustive scan including distant casters and courtyards', () => {
  const rectangle = (x, y, w, h) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
  const buildings = Array.from({ length: 32 }, (_, i) => {
    const x = (i * 137 % 1500) - 750, y = (i * 193 % 1300) - 650;
    const rings = [rectangle(x, y, 50, 70)];
    if (i % 3 === 0) rings.push(rectangle(x + 10, y + 10, 25, 40));
    return { rings, box: [x, y, x + 50, y + 70], tile: [x - 1, y - 1, x + 35, y + 80], height: 20 + i * 9, base: i % 2 ? 10 : 0, casts: true };
  });
  const extent = [-200, -200, 200, 200];
  for (const altitude of [5, 25, 70]) for (const azimuth of [0, 45, 90, 180, 270, 315]) {
    const direction = [Math.sin(azimuth * Math.PI / 180), Math.cos(azimuth * Math.PI / 180)], tangent = Math.tan(altitude * Math.PI / 180);
    const indexed = spatialIndex(buildings, extent, b => shadowBox(b, direction, tangent));
    for (let x = -200; x <= 200; x += 20) for (let y = -200; y <= 200; y += 20) {
      const point = [x, y], hit = b => blocked(b, point, direction, tangent);
      assert.equal(indexed(point).some(hit), buildings.some(hit), `sun ${altitude}/${azimuth}, point ${x}/${y}`);
    }
  }
});

test('footprint index clips to tile bounds and skips distant buildings', () => {
  const a = { box: [-50,-50,50,50], tile: [0,0,100,100] }, b = { box: [900,900,950,950], tile: [800,800,1000,1000] };
  const index = spatialIndex([a,b], [-100,-100,100,100], clippedBox, 25);
  assert.deepEqual(index([-25,-25]), []);
  assert.deepEqual(index([10,10]), [a]);
  assert.deepEqual(index([900,900]), []);
});
