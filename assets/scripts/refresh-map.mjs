import fs from 'node:fs/promises';
import {CITY,tileCoordinates,decodeCityTiles} from '../dist/gis-data.js';
const headers={'User-Agent':'MistSydneyDemo/1.0 (Sydney CBD Three.js prototype)'};
const get=async url=>{const r=await fetch(url,{headers,signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`${r.status}: ${url}`);return r;};
const metadata=await (await get(CITY.source)).json();
const tiles=[];
for(const tile of tileCoordinates()){const url=metadata.tiles[0].replace('{z}',tile.z).replace('{x}',tile.x).replace('{y}',tile.y);tiles.push({...tile,data:new Uint8Array(await (await get(url)).arrayBuffer())});}
const data=decodeCityTiles(tiles,{tileTemplate:metadata.tiles[0],retrievedAt:new Date().toISOString()});
const path=new URL('../dist/data/sydney-openfreemap.geojson',import.meta.url);
await fs.writeFile(path,JSON.stringify(data));
console.log(`Saved ${data.features.length} features from ${tiles.length} OpenFreeMap tiles.`);
