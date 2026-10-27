'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const base = { temperatureC: 35, humidityPct: 50, waterLph: 10, evaporationFraction: .5, airflowM3s: 2 };
const close = (a,b, tolerance = 1e-7) => assert.ok(Math.abs(a-b) < tolerance, `${a} ≈ ${b}`);

test('FEC-MP003 uses ten nozzles but does not invent a rated flow or mist droplet size', async () => {
  const { FOG_DEVICE, fogWaterLph, mistSource } = await import('../src/mist-model.mjs');
  assert.equal(FOG_DEVICE.model,'FEC-MP003'); assert.equal(FOG_DEVICE.nozzleCount,10);
  assert.equal(FOG_DEVICE.nozzleBoreMm,.1); assert.equal(FOG_DEVICE.ratedFlowLpm,null);
  close(fogWaterLph(.02),12); close(fogWaterLph(0),0);
  const active = mistSource({...base,waterLph:fogWaterLph(.02)}), off = mistSource({...base,waterLph:0});
  assert.ok(active.dropC > 0); close(off.dropC,0); close(off.evaporatedLph,0);
  for (const invalid of [null,NaN,-.01,2]) assert.throws(()=>fogWaterLph(invalid),RangeError);
});

test('heat colors map ambient to red and cooling to blue without changing the calculated temperature', async () => {
  const { mistHeatRgb, mistSource } = await import('../src/mist-model.mjs');
  assert.deepEqual(mistHeatRgb(0,2),[232,93,74]);
  assert.deepEqual(mistHeatRgb(2,2),[29,78,216]);
  assert.deepEqual(mistHeatRgb(3,2),mistHeatRgb(2,2));
  const m=mistSource(base), before=JSON.stringify(m);
  assert.notDeepEqual(mistHeatRgb(m.dropC,2),mistHeatRgb(m.dropC,5));
  assert.equal(JSON.stringify(m),before);
  assert.throws(()=>mistHeatRgb(1,0),RangeError);
});

test('adiabatic source conserves water and moist-air energy, raises humidity and respects saturation', async () => {
  const { mistSource } = await import('../src/mist-model.mjs');
  for (const humidityPct of [0, 30, 50, 90, 100]) for (const waterLph of [0, 1, 10, 100]) {
    const m = mistSource({ ...base, humidityPct, waterLph });
    assert.ok(m.afterC <= base.temperatureC && m.afterC >= m.wetBulbC);
    assert.ok(m.humidityAfterPct >= humidityPct - 1e-8 && m.humidityAfterPct <= 100);
    assert.ok(m.evaporatedLph <= waterLph * base.evaporationFraction + 1e-8);
    close((m.humidityRatioOut - m.humidityRatioIn) * m.dryAirKgS * 3600, m.evaporatedLph);
    const h = (t,w) => 1006*t + w*(2501000+1860*t);
    close(h(m.afterC,m.humidityRatioOut), h(m.beforeC,m.humidityRatioIn) + (m.humidityRatioOut-m.humidityRatioIn)*4186*m.wetBulbC, 1e-6);
  }
  const saturated = mistSource({ ...base, humidityPct: 100 });
  close(saturated.dropC, 0); close(saturated.evaporatedLph, 0);
});

test('wet bulb agrees with standard warm-air psychrometric values and sensitivity has the correct direction', async () => {
  const { mistSource } = await import('../src/mist-model.mjs');
  const m = mistSource(base);
  close(m.wetBulbC, 26.1, .2);
  close(mistSource({ ...base, temperatureC:30 }).wetBulbC, 22.0, .2);
  close(mistSource({ ...base, waterLph:0 }).dropC, 0);
  close(mistSource({ ...base, evaporationFraction:0 }).dropC, 0);
  assert.ok(mistSource({ ...base, waterLph:20 }).dropC > m.dropC);
  assert.ok(mistSource({ ...base, airflowM3s:4 }).dropC < m.dropC);
  assert.ok(mistSource({ ...base, humidityPct:99 }).dropC < m.dropC);
  for (const invalid of [{temperatureC:null},{temperatureC:NaN},{temperatureC:5},{humidityPct:101},{waterLph:-1},{airflowM3s:0},{evaporationFraction:2}]) assert.throws(() => mistSource({...base,...invalid}), RangeError);
});

test('radial screen tapers to zero and overlapping devices do not double-count cooling', async () => {
  const { mistDropAt, mistField } = await import('../src/mist-model.mjs');
  const points = [{x:0,y:0}];
  close(mistDropAt(0,0,points,4,12),4);
  close(mistDropAt(6,0,points,4,12),1);
  close(mistDropAt(12,0,points,4,12),0);
  close(mistDropAt(13,0,points,4,12),0);
  assert.deepEqual(mistField([...points,...points],4,12),mistField(points,4,12));
  assert.deepEqual(mistField([],4,12),[]);
  assert.deepEqual(mistField(points,0,12),[]);
  const field = mistField([{x:0,y:0},{x:6,y:0}],4,12);
  assert.equal(new Set(field.map(p => `${p.x}:${p.y}`)).size,field.length);
  assert.ok(field.every(p => p.dropC > 0 && p.dropC <= 4));
});

test('selected-location readings agree with the rendered field, including no devices and missing weather', async () => {
  const { mistReading, mistField, mistSource } = await import('../src/mist-model.mjs');
  const model = mistSource(base), sites = [{x:0,y:0},{x:5,y:0}];
  const source = mistReading(0,0,sites,model,12);
  close(source.afterC,model.afterC); close(source.nearestM,0);
  for (const cell of mistField(sites,model.dropC,12)) {
    const sample = mistReading(cell.x,cell.y,sites,model,12);
    close(sample.dropC,cell.dropC); close(sample.beforeC-sample.afterC,cell.dropC);
  }
  close(mistReading(100,0,sites,model,12).dropC,0);
  const empty = mistReading(0,0,[],model,12);
  close(empty.beforeC,empty.afterC); assert.equal(empty.nearestM,null);
  assert.equal(mistReading(0,0,sites,null,12),null);
});

test('map geometry changes temperature colors between views and masks blocked ground without a WebGL context', async () => {
  const fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
  const vendor = pathToFileURL(path.resolve(__dirname,'../vendor/scene-vendor.mjs')).href;
  const modelUrl = pathToFileURL(path.resolve(__dirname,'../src/mist-model.mjs')).href;
  const source = fs.readFileSync(path.resolve(__dirname,'../src/city-scene.mjs'),'utf8').replace("'/vendor/scene-vendor.mjs'",JSON.stringify(vendor)).replace("'./mist-model.mjs'",JSON.stringify(modelUrl)).replace("'./agent-plan-view.mjs'",JSON.stringify(pathToFileURL(path.resolve(__dirname,'../src/agent-plan-view.mjs')).href));
  const [{ CityScene }, T, { mistSource }] = await Promise.all([import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`),import(vendor),import(modelUrl)]);
  const scene = Object.create(CityScene.prototype);
  Object.assign(scene, { area:{west:151.19,east:151.22,south:-33.88,north:-33.85,longitude:151.205,latitude:-33.865}, mist:new T.Group(), shades:new T.Group(), cells:new T.Group(), layers:{cells:true}, _sun:{daytime:true}, excluders:[[[[2,2],[8,2],[8,8],[2,8],[2,2]]]] });
  assert.equal(scene.mistGround(5,5),false); assert.equal(scene.mistGround(0,0),true);
  const input = { sites:[[151.205,-33.865]], model:mistSource(base), radiusM:12, enabled:true };
  scene.setMistScenario({...input,view:'before'});
  assert.equal(scene.mist.children.some(c=>c.isInstancedMesh),false);
  assert.equal(scene.mistBackdrop.visible,true);
  const background=scene.mistBackdrop.children[0];
  assert.ok(background.count>0);
  assert.equal(background.material.color.getHexString(),'e85d4a');
  const pole = scene.mist.children.find(c => c.userData.fogIndex === 0);
  assert.ok(pole); assert.equal(pole.children.filter(c => c.geometry?.type === 'SphereGeometry').length,10);
  assert.equal(scene.fogActors.length,0);
  const matrix = new T.Matrix4();
  scene.setMistScenario({...input,view:'after'});
  const after = scene.mist.children.find(c => c.isInstancedMesh);
  assert.equal(scene.fogActors.length,1);
  assert.ok(after.count>0);
  for (let i=0; i<after.count; i++) { after.getMatrixAt(i,matrix); assert.equal(scene.mistGround(matrix.elements[12],-matrix.elements[14]),true); }
  assert.equal(scene.mistBackdrop.children[0],background,'reuse the city-wide mask when a device moves or a setting changes');
  assert.equal(scene.shades.visible,false); assert.equal(scene.cells.visible,false);
  scene.setMistScenario({...input,model:mistSource({...base,waterLph:0}),spraying:false,view:'delta'});
  assert.equal(scene.mistBackdrop.visible,false);
  assert.equal(scene.fogActors.length,0);
  assert.equal(scene.mist.children.some(c => c.isInstancedMesh),false);
  scene.setMistScenario({...input,model:null});
  assert.equal(scene.mistBackdrop.visible,false);
  assert.equal(scene.mist.children.some(c => c.isInstancedMesh),false);
  scene.setCellsStale(true);
  scene.setMistScenario({...input,enabled:false});
  assert.equal(scene.mistBackdrop.visible,false);
  assert.equal(scene.mist.children.length,0); assert.equal(scene.shades.visible,true); assert.equal(scene.cells.visible,false);
});
