'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { dateWindow, normalizeWalk, normalizeCounts, normalizeWeather, unavailableCounts } = require('../cbd-store');
const { treeBlocked, route } = require('../cbd-route');
const { AREA } = require('../city-data');

test('CBD date window follows Sydney summer time and rejects an ambiguous DST day', () => {
  const window=dateWindow('2025-01-15');
  assert.equal(window.start,'2025-01-14T13:00:00.000Z');
  assert.equal(window.end,'2025-01-15T13:00:00.000Z');
  assert.throws(()=>dateWindow('2025-04-06'),/서머타임/);
  assert.throws(()=>dateWindow('2025-02-30'));
});
test('ArcGIS local wall-clock count converts to UTC and marks A004 fault interval', () => {
  const row=(date,hour,site='A004',id=1)=>({attributes:{Date:Date.parse(`${date}T${String(hour).padStart(2,'0')}:00:00Z`),Hour:hour,Location_code:site,TotalCount:123,ObjectId:id}});
  const summer=normalizeCounts({features:[row('2025-01-15',14),row('2025-01-15',15,'A003',2)]},dateWindow('2025-01-15'),'2025-01-15');
  assert.equal(summer[0].instant_utc,'2025-01-15T03:00:00.000Z');
  assert.equal(summer[0].quality,'reported');
  assert.equal(normalizeCounts({features:[row('2022-07-10',10)]},dateWindow('2022-07-10'),'2022-07-10')[0].quality,'known-undercount');
  assert.equal(normalizeCounts({features:[row('2025-01-14',14)]},dateWindow('2025-01-15'),'2025-01-15').length,0);
});
test('December heatwave has Sydney-local hours and unavailable demand, never fabricated zero counts', () => {
  const window = dateWindow('2025-12-19');
  assert.equal(window.start, '2025-12-18T13:00:00.000Z');
  assert.equal(window.end, '2025-12-19T13:00:00.000Z');
  const missing = unavailableCounts('2025-12-19');
  assert.equal(missing.availability, 'unavailable-source-ended');
  assert.equal(missing.collected_at_utc, null);
  assert.deepEqual(normalizeCounts(missing.data, window, '2025-12-19'), []);
  assert.equal(unavailableCounts('2025-01-15'), null);
  assert.equal(unavailableCounts('2025-06-30'), null);
  assert.notEqual(missing.hash, unavailableCounts('2025-12-20').hash);
});
test('OSM graph preserves shared-node connectivity and separates bridge level', () => {
  const elements=[];
  for(let i=0;i<25;i++) elements.push({type:'node',id:i+1,lon:151.202+i*.00004,lat:-33.872});
  elements.push({type:'way',id:10,nodes:Array.from({length:25},(_,i)=>i+1),tags:{highway:'footway'}});
  elements.push({type:'way',id:11,nodes:[12,13],tags:{highway:'footway',bridge:'yes'}});
  elements.push({type:'way',id:12,nodes:[14,15],tags:{highway:'footway',foot:'no'}});
  const graph=normalizeWalk({elements});
  assert.equal(graph.edges.length,25);
  assert.ok(graph.nodes.some(n=>n.id==='12:0:bridge'));
  assert.ok(graph.nodes.some(n=>n.id==='12:0:ground'));
  assert.equal(graph.edges.some(e=>e.way_id==='12'),false);
});
test('tree crown ray uses height and canopy, without treating a missing crown as shade', () => {
  const tree={lon:AREA.longitude,lat:AREA.latitude,height_m:10,canopy_diameter_m:8};
  assert.equal(treeBlocked(tree,[-8,0],[1,0],1),true);
  assert.equal(treeBlocked(tree,[-20,0],[1,0],1),false);
  assert.equal(treeBlocked({...tree,canopy_diameter_m:null},[-8,0],[1,0],1),false);
});
test('CBD route uses connected OSM nodes, excludes steps for candidate step-free profile and balances exposure time', () => {
  const points={a:[151.205,-33.872],b:[151.206,-33.872],c:[151.207,-33.872],d:[151.206,-33.871]};
  const nodes=Object.entries(points).map(([id,[lon,lat]])=>({id,lon,lat,level:'0:ground'}));
  const edge=(id,from,to,length,steps=false)=>({id,from_id:from,to_id:to,length_m:length,quality:'osm-pedestrian-way',steps,step_free_candidate:!steps,direction:'both',geometry:{type:'LineString',coordinates:[points[from],points[to]]}});
  const edges=[edge('ab','a','b',92),edge('bc','b','c',92,true),edge('ad','a','d',145),edge('dc','d','c',145)];
  const gis={version:'fixture',area:AREA,features:[]},cbd={manifest:{date:'2025-01-15',bundle_version:'cbd-fixture',components:{buildings:'fixture'},sources:{}},tables:{walk_nodes:nodes,walk_edges:edges,trees:[]}};
  const input={start:points.a,end:points.c,departure_utc:'2025-01-15T03:00:00.000Z',max_detour_minutes:5};
  const standard=route(gis,cbd,{...input,profile:'standard'});
  const stepFree=route(gis,cbd,{...input,profile:'step_free'});
  assert.equal(standard.fastest.distance_m,184);
  assert.equal(stepFree.fastest.distance_m,290);
  assert.ok(Math.abs(standard.fastest.direct_sun_minutes+standard.fastest.shade_minutes+standard.fastest.unknown_minutes+standard.fastest.night_minutes-standard.fastest.travel_minutes)<.03);
  assert.throws(()=>route(gis,cbd,{...input,start:[151.18,-33.872],profile:'standard'}),/분석 구역/);
});
test('CBD Parquet preserves geometry and refuses a changed file hash', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cool-cbd-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const point={type:'Point',coordinates:[151.207,-33.8715]},line={type:'LineString',coordinates:[[151.207,-33.8715],[151.208,-33.8715]]};
  const payload={area_id:AREA.id,bundle_version:'cbd-0123456789abcdef',date:'2025-01-15',created_at_utc:'2026-10-27T00:00:00.000Z',components:{buildings:'ofm-0123456789abcdef'},sources:{},quality:{},tables:{
    walk_nodes:[{id:'1',lon:151.207,lat:-33.8715,level:'0:ground',degree:1,geometry:point}],
    walk_edges:[{id:'1/1',from_id:'1',to_id:'2',length_m:90,quality:'osm-pedestrian-way',steps:false,step_free_candidate:true,level:'0:ground',way_id:'1',direction:'both',geometry:line}],
    trees:[{id:'T1',lon:151.207,lat:-33.8715,height_m:10,canopy_raw:8,canopy_diameter_m:8,canopy_method:'assumed',status:'Tree',geometry:point}],
    pedestrian_sites:[{id:'A001',name:'Bridge',description:'site',lon:151.207,lat:-33.8715,matched_edge_id:'1/1',match_distance_m:2,match_quality:'nearest-unverified',geometry:point}],
    pedestrian_counts:[{site_id:'A001',instant_utc:'2025-01-15T03:00:00.000Z',passages:100,source_object_id:1,quality:'reported',evidence_type:'observed'}],
    weather:[{instant_utc:'2025-01-15T03:00:00.000Z',temperature_c:30,humidity_pct:50,wind_m_s:2,shortwave_w_m2:900,grid_lat:-33.75,grid_lon:151,evidence_type:'reanalysis'}]
  }};
  const source=path.join(root,'input.json'),dest=path.join(root,'bundle');fs.writeFileSync(source,JSON.stringify(payload));
  const python=process.env.COOL_SYDNEY_PYTHON||path.join(__dirname,'..','..','.venv','bin','python'),script=path.join(__dirname,'..','cbd-parquet.py');
  execFileSync(python,[script,'write',source,dest]);
  const read=JSON.parse(execFileSync(python,[script,'read',dest],{encoding:'utf8'}));
  assert.deepEqual(read.tables.walk_edges[0].geometry,line);
  assert.equal(read.tables.pedestrian_counts[0].passages,100);
  payload.date = '2025-12-19';
  payload.tables.pedestrian_counts = [];
  payload.quality.pedestrian_counts_status = 'unavailable-source-ended';
  fs.writeFileSync(source, JSON.stringify(payload));
  execFileSync(python,[script,'write',source,dest]);
  const missing = JSON.parse(execFileSync(python,[script,'read',dest],{encoding:'utf8'}));
  assert.deepEqual(missing.tables.pedestrian_counts, []);
  assert.equal(missing.manifest.quality.pedestrian_counts_status, 'unavailable-source-ended');
  assert.equal(missing.manifest.files.find(f=>f.name==='pedestrian_counts.parquet').rows, 0);
  fs.appendFileSync(path.join(dest,'trees.parquet'),'corrupt');
  assert.throws(()=>execFileSync(python,[script,'read',dest],{stdio:'pipe'}),/Command failed/);
});
