'use strict';
const path=require('node:path'),fs=require('node:fs');
const projectRoot=path.resolve(__dirname,'..');
const candidates=[path.join(projectRoot,'meterless-demo/.notebook/state.json')];
if(path.basename(path.dirname(projectRoot))==='.publish')candidates.push(path.resolve(projectRoot,'../../meterless-demo/.notebook/state.json'));
console.log(require('../cool-sydney/monitor-snapshot').exportSnapshot({projectRoot,memoryFile:candidates.find(file=>fs.existsSync(file))}));
