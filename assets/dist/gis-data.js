import { VectorTile, Pbf, polygonClipping } from './vendor/vector-data.js';
import { UI } from './i18n.js';

export const CITY = { center:[151.2095,-33.8665], bounds:[151.200,-33.8785,151.220,-33.8525], zoom:14, metersPerUnit:5, source:'https://tiles.openfreemap.org/planet' };
const R=6378137,rad=Math.PI/180,scale=Math.cos(CITY.center[1]*rad),originY=R*Math.log(Math.tan(Math.PI/4+CITY.center[1]*rad/2));
export function project([lon,lat]) {return [(lon-CITY.center[0])*rad*R*scale/CITY.metersPerUnit,(originY-R*Math.log(Math.tan(Math.PI/4+lat*rad/2)))*scale/CITY.metersPerUnit];}
export function unproject([x,z]) {return [CITY.center[0]+x*CITY.metersPerUnit/(rad*R*scale),(2*Math.atan(Math.exp((originY-z*CITY.metersPerUnit/scale)/R))-Math.PI/2)/rad];}
export function tileCoordinates(bounds=CITY.bounds,z=CITY.zoom) {
  const n=2**z,tx=lon=>Math.floor((lon+180)/360*n),ty=lat=>Math.floor((1-Math.asinh(Math.tan(lat*rad))/Math.PI)/2*n),tiles=[];
  for(let x=tx(bounds[0]);x<=tx(bounds[2]);x++)for(let y=ty(bounds[3]);y<=ty(bounds[1]);y++)tiles.push({x,y,z});return tiles;
}
const polygonLayers=['building','water','landcover','landuse','park'];
function bbox(coords,result=[Infinity,Infinity,-Infinity,-Infinity]) {if(typeof coords[0]==='number'){result[0]=Math.min(result[0],coords[0]);result[1]=Math.min(result[1],coords[1]);result[2]=Math.max(result[2],coords[0]);result[3]=Math.max(result[3],coords[1]);}else for(const c of coords)bbox(c,result);return result;}
export function decodeCityTiles(tiles, metadata={}) {
  const [w,s,e,n]=CITY.bounds,clip=[[[w,s],[e,s],[e,n],[w,n],[w,s]]],features=[],groups=new Map(),lineKeys=new Set();
  for(const {x,y,z,data} of tiles) {
    const tile=new VectorTile(new Pbf(data));
    for(const layerName of [...polygonLayers,'transportation']) {
      const layer=tile.layers[layerName];if(!layer)continue;
      for(let i=0;i<layer.length;i++) {
        const source=layer.feature(i),f=source.toGeoJSON(x,y,z),p=f.properties,b=bbox(f.geometry.coordinates);
        if(b[2]<w||b[0]>e||b[3]<s||b[1]>n)continue;
        if(layerName==='building'&&(p.hide_3d===true||p.hide_3d===1||p.hide_3d==='true'))continue;
        if(layerName==='transportation') {
          if(!['LineString','MultiLineString'].includes(f.geometry.type)||p.brunnel==='tunnel'||Number(p.layer)<0||p.indoor===1)continue;
          const key=JSON.stringify([source.id,p.class,p.subclass,f.geometry.coordinates]);if(lineKeys.has(key))continue;lineKeys.add(key);
          features.push({...f,properties:{class:p.class,subclass:p.subclass,brunnel:p.brunnel,layer:layerName}});continue;
        }
        if(!['Polygon','MultiPolygon'].includes(f.geometry.type))continue;
        const properties={layer:layerName,class:p.class,subclass:p.subclass,name:p['name:en']||p.name,render_height:p.render_height,render_min_height:p.render_min_height,colour:p.colour};
        const key=JSON.stringify([layerName,source.id,properties]);
        if(!groups.has(key))groups.set(key,{id:source.id,properties,polygons:[]});
        groups.get(key).polygons.push(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates);
      }
    }
  }
  for(const group of groups.values()) {
    // Merge tile-buffer duplicates before clipping; retain multipolygons and courtyard holes.
    const merged=group.polygons.length>1?polygonClipping.union(...group.polygons):group.polygons[0];
    const polygons=polygonClipping.intersection(merged,clip);
    if(polygons.length)features.push({type:'Feature',id:group.id,properties:group.properties,geometry:{type:'MultiPolygon',coordinates:polygons}});
  }
  return {type:'FeatureCollection',metadata:{provider:'OpenFreeMap',source:CITY.source,bounds:CITY.bounds,zoom:CITY.zoom,tileCount:tiles.length,attribution:'OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors',...metadata},features};
}
async function withinDeadline(operation, milliseconds) {
  const controller=new AbortController();
  let timer;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Map request timed out'));},milliseconds);})
    ]);
  } finally {clearTimeout(timer);controller.abort();}
}
function validateMap(data) {
  if(data?.type!=='FeatureCollection'||!data.metadata||!Array.isArray(data.features)||!data.features.some(f=>f.properties?.layer==='building'&&f.geometry?.type==='MultiPolygon'))throw new Error('Invalid Sydney map data');
  return data;
}
export async function loadCityData({fetcher=fetch,onStatus=()=>{},timeoutMs=10000,snapshotTimeoutMs=5000}={}) {
  try {
    return await withinDeadline(async signal=>{
    onStatus(UI.loadingTiles);
    const response=await fetcher(CITY.source,{signal});if(!response.ok)throw Error('TileJSON '+response.status);
    const metadata=await response.json(),template=metadata.tiles?.[0];
    if(!template?.startsWith('https://tiles.openfreemap.org/'))throw Error('Unsupported tile source');
    const tiles=tileCoordinates(),results=[];
    // Four requests at most; no global map or bulk download.
    for(let i=0;i<tiles.length;i+=4)results.push(...await Promise.all(tiles.slice(i,i+4).map(async tile=>{
      const url=template.replace('{z}',tile.z).replace('{x}',tile.x).replace('{y}',tile.y),res=await fetcher(url,{signal});if(!res.ok)throw Error('Vector tile '+res.status);
      return {...tile,data:new Uint8Array(await res.arrayBuffer())};
    })));
    onStatus(UI.loadingGeometry);
    const data=validateMap(decodeCityTiles(results,{tileTemplate:template,retrievedAt:new Date().toISOString()}));
    return {data,mode:'live'};
    },timeoutMs);
  } catch(error) {
    onStatus(UI.loadingSnapshot);
    try {
      return await withinDeadline(async signal=>{
        const response=await fetcher('./data/sydney-openfreemap.geojson',{signal});if(!response.ok)throw Error('Snapshot '+response.status);
        return {data:validateMap(await response.json()),mode:'snapshot',reason:error.message};
      },snapshotTimeoutMs);
    } catch { throw Error(UI.mapError); }
  }
}
