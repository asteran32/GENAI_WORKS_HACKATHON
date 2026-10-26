'use strict';
const fs = require('node:fs');
const path = require('node:path');
function build() {
  const target = path.join(__dirname, 'public'); fs.mkdirSync(target, { recursive: true });
  for (const [source, name] of [['city.html','index.html'],['city.css','city.css'],['city-app.mjs','city-app.mjs'],['city-scene.mjs','city-scene.mjs']]) fs.copyFileSync(path.join(__dirname,'src',source),path.join(target,name));
  // A server process from an older revision can serve the updated HTML while
  // missing newly added asset routes. Keep the layout visible in that case.
  const html = fs.readFileSync(path.join(target,'index.html'),'utf8').replace('<link rel="stylesheet" href="/city.css">', () => `<style>${fs.readFileSync(path.join(target,'city.css'),'utf8')}</style>`);
  fs.writeFileSync(path.join(target,'index.html'), html);
  fs.cpSync(path.join(__dirname,'vendor'),path.join(target,'vendor'),{ recursive: true });
  return { path: path.join(target,'index.html'), mode: 'server-backed-real-gis' };
}
if (require.main === module) console.log(build());
module.exports = { build };
