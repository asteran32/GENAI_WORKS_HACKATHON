'use strict';
const { AREA, project } = require('./city-data');
const { prepare, blocked } = require('./gis-shadow');
const { sunPosition } = require('./src/engine');
const VERSION = 'cbd-route-0.1.0';
const SPEED_M_S = 1.3;
class Heap {
  constructor() { this.items=[]; }
  push(value) { const a=this.items; a.push(value); let i=a.length-1; while(i>0) { const p=(i-1)>>1; if(a[p].cost<=value.cost) break; a[i]=a[p]; i=p; } a[i]=value; }
  pop() { const a=this.items, top=a[0], tail=a.pop(); if(a.length) { let i=0; while(2*i+1<a.length) { let c=2*i+1; if(c+1<a.length&&a[c+1].cost<a[c].cost)c++; if(a[c].cost>=tail.cost)break; a[i]=a[c]; i=c; } a[i]=tail; } return top; }
  get length() { return this.items.length; }
}
function validateInput(input, date) {
  const point = (value,name) => {
    if (!Array.isArray(value)||value.length!==2||!value.every(Number.isFinite)||value[0]<AREA.west||value[0]>AREA.east||value[1]<AREA.south||value[1]>AREA.north) throw new Error(`${name}은 Town Hall 분석 구역 안의 경위도여야 합니다.`);
    return value;
  };
  const departure = new Date(input?.departure_utc);
  if (!Number.isFinite(+departure) || departure.toISOString() !== input.departure_utc) throw new Error('UTC 출발 시각이 올바르지 않습니다.');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:AREA.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(departure).map(p=>[p.type,p.value]));
  const localDate=`${parts.year}-${parts.month}-${parts.day}`;
  if (localDate !== date) throw new Error('수집한 현지 날짜의 UTC 출발 시각을 사용하세요.');
  const profile = input.profile || 'standard', detour = Number(input.max_detour_minutes ?? 5);
  if (!['standard','step_free'].includes(profile)||!Number.isFinite(detour)||detour<0||detour>20) throw new Error('보행 프로필 또는 우회 허용 시간을 확인하세요.');
  return { start:point(input.start,'출발점'), end:point(input.end,'도착점'), departure_utc:departure.toISOString(), profile, max_detour_minutes:detour };
}
function treeBlocked(tree, point, direction, tangent) {
  if (!tree.canopy_diameter_m || !tree.height_m || tangent<=0) return false;
  const center=project(tree.lon,tree.lat), radius=tree.canopy_diameter_m/2;
  const x=center[0]-point[0], y=center[1]-point[1], along=x*direction[0]+y*direction[1];
  const across2=x*x+y*y-along*along, span2=radius*radius-across2;
  if (span2<0) return false;
  const span=Math.sqrt(span2), low=Math.max(0,along-span), high=along+span;
  return high>low && high*tangent>=tree.height_m*.35 && low*tangent<=tree.height_m;
}
function prepareOccluders(gis, trees) {
  const buildings=prepare(gis).buildings.filter(b=>b.casts && b.height>0), crowns=trees.filter(t=>t.canopy_diameter_m && t.height_m);
  return { buildings,crowns };
}
function classify(point, at, occluders) {
  const sun=sunPosition(at,AREA.latitude,AREA.longitude); if(sun.altitude<=0)return 'night';
  const angle=sun.azimuth*Math.PI/180, direction=[Math.sin(angle),Math.cos(angle)], tangent=Math.tan(sun.altitude*Math.PI/180);
  if(occluders.buildings.some(b=>blocked(b,point,direction,tangent)))return 'shade';
  if(occluders.crowns.some(t=>treeBlocked(t,point,direction,tangent)))return 'shade';
  return 'sun';
}
function adjacency(tables, profile) {
  const nodes=new Map(tables.walk_nodes.map(n=>[n.id,n])), map=new Map();
  for(const edge of tables.walk_edges) {
    if(profile==='step_free'&&!edge.step_free_candidate)continue;
    if(!nodes.has(edge.from_id)||!nodes.has(edge.to_id))continue;
    const add=(from,to,reverse)=>{ if(!map.has(from))map.set(from,[]); map.get(from).push({to,edge,reverse}); };
    if(edge.direction!=='backward')add(edge.from_id,edge.to_id,false);
    if(edge.direction!=='forward')add(edge.to_id,edge.from_id,true);
  }
  return { nodes,map };
}
function snap(point, graph) {
  const target=project(...point); let best=null;
  for(const [id,node] of graph.nodes) {
    if(!graph.map.has(id))continue;
    const p=project(node.lon,node.lat), distance=Math.hypot(p[0]-target[0],p[1]-target[1]);
    if(!best||distance<best.distance)best={id,distance,coordinate:[node.lon,node.lat]};
  }
  if(!best||best.distance>45)throw new Error('보행망에서 45m 이내에 연결 가능한 노드를 찾지 못했습니다.');
  return { ...best,distance:+best.distance.toFixed(2),method:'nearest-network-node' };
}
function shortest(graph, start, end, edgeCost) {
  const heap=new Heap(), best=new Map([[start,0]]), previous=new Map(); heap.push({node:start,cost:0});
  while(heap.length) {
    const current=heap.pop(); if(current.cost!==best.get(current.node))continue;
    if(current.node===end)break;
    for(const arc of graph.map.get(current.node)||[]) {
      const cost=current.cost+edgeCost(arc.edge); if(cost>= (best.get(arc.to)??Infinity))continue;
      best.set(arc.to,cost); previous.set(arc.to,{from:current.node,...arc}); heap.push({node:arc.to,cost});
    }
  }
  if(!best.has(end))return null;
  const arcs=[]; for(let at=end;at!==start;) { const arc=previous.get(at); if(!arc)return null; arcs.push(arc); at=arc.from; }
  return arcs.reverse();
}
function pathKey(arcs) { return arcs.map(a=>`${a.edge.id}:${a.reverse?1:0}`).join('|'); }
function measure(arcs, departure, occluders) {
  let elapsed=0, direct=0, shade=0, unknown=0, distance=0; const coordinates=[];
  for(const arc of arcs) {
    const coords=arc.reverse ? arc.edge.geometry.coordinates.slice().reverse() : arc.edge.geometry.coordinates;
    if(!coordinates.length)coordinates.push(coords[0]); coordinates.push(coords[1]);
    const a=project(...coords[0]), b=project(...coords[1]), n=Math.max(1,Math.ceil(arc.edge.length_m/4)), dt=arc.edge.length_m/SPEED_M_S/n;
    for(let i=0;i<n;i++) {
      if(arc.edge.quality==='road-centreline-unverified-sidewalk') { unknown+=dt; elapsed+=dt; continue; }
      const t=(i+.5)/n, point=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t], instant=new Date(departure.getTime()+(elapsed+dt/2)*1000);
      const kind=classify(point,instant,occluders); if(kind==='sun')direct+=dt; else if(kind==='shade')shade+=dt;
      elapsed+=dt;
    }
    distance+=arc.edge.length_m;
  }
  const minutes=value=>+(value/60).toFixed(2);
  return { coordinates, distance_m:+distance.toFixed(1), travel_minutes:minutes(elapsed), direct_sun_minutes:minutes(direct), shade_minutes:minutes(shade), unknown_minutes:minutes(unknown), night_minutes:minutes(Math.max(0,elapsed-direct-shade-unknown)), unverified_road_edges:arcs.filter(a=>a.edge.quality==='road-centreline-unverified-sidewalk').length };
}
function route(gis,cbd,input) {
  const manifest=cbd.manifest, accepted=validateInput(input,manifest.date);
  if(manifest.components.buildings!==gis.version)throw new Error('묶음의 건물 버전이 현재 GIS와 다릅니다. CBD 자료를 다시 수집하세요.');
  const graph=adjacency(cbd.tables,accepted.profile), start=snap(accepted.start,graph), end=snap(accepted.end,graph);
  if(start.id===end.id)throw new Error('출발점과 도착점이 같은 보행 노드에 연결됐습니다.');
  const shortestArcs=shortest(graph,start.id,end.id,e=>e.length_m/SPEED_M_S);
  if(!shortestArcs)throw new Error('두 지점 사이에 연결된 보행 경로가 없습니다.');
  const occluders=prepareOccluders(gis,cbd.tables.trees), departure=new Date(accepted.departure_utc);
  const fastest=measure(shortestArcs,departure,occluders), budget=fastest.travel_minutes+accepted.max_detour_minutes;
  const seen=new Set([pathKey(shortestArcs)]), candidates=[fastest], edgeRatio=new Map();
  function exposure(edge) {
    if(edgeRatio.has(edge.id))return edgeRatio.get(edge.id);
    if(edge.quality==='road-centreline-unverified-sidewalk')return 1;
    const a=project(...edge.geometry.coordinates[0]),b=project(...edge.geometry.coordinates[1]); let open=0;
    for(let i=0;i<3;i++) { const t=(i+.5)/3, kind=classify([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],departure,occluders); if(kind==='sun')open++; }
    const ratio=open/3;edgeRatio.set(edge.id,ratio);return ratio;
  }
  for(const weight of [.5,1,2,4,8,16]) {
    const arcs=shortest(graph,start.id,end.id,e=>e.length_m/SPEED_M_S*(1+weight*exposure(e)));
    if(!arcs)continue; const key=pathKey(arcs); if(seen.has(key))continue;seen.add(key);
    const result=measure(arcs,departure,occluders); if(result.travel_minutes<=budget+.01)candidates.push(result);
  }
  candidates.sort((a,b)=>(a.direct_sun_minutes+a.unknown_minutes)-(b.direct_sun_minutes+b.unknown_minutes)||a.travel_minutes-b.travel_minutes);
  const coolest=candidates[0];
  return { algorithm_version:VERSION, bundle_version:manifest.bundle_version, dataset_version:gis.version, input:accepted, snap:{start,end}, fastest, lower_exposure:coolest, candidates_considered:candidates.length, search_method:'weighted-candidate-routes-with-detour-limit', assumptions:['보행 속도 1.3m/s','OSM 차도 중심선은 보도 위치가 확인되지 않아 노출 시간을 미상으로 분류','TreeCanopyNS를 m 단위 원형 수관 직경으로 가정하고 수관 하단을 수고의 35%로 가정','건물 높이는 지도 렌더링 파생값이며 지형은 평지','과거 계수·기상과 최신 형상을 결합한 시나리오'], evidence:{ buildings:manifest.components.buildings, walk:manifest.sources.walk, trees:manifest.sources.trees, weather:manifest.sources.weather, counts:manifest.sources.counts }, validation_status:'passed' };
}
module.exports={ VERSION, validateInput, walkingGraph:adjacency, treeBlocked, route };
