import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { UI } from '../dist/i18n.js';
const root=new URL('../',import.meta.url);
for(const file of await readdir(new URL('dist/',root)))if(file.endsWith('.js'))execFileSync(process.execPath,['--check',new URL('dist/'+file,root).pathname],{stdio:'inherit'});
const html=await readFile(new URL('dist/index.html',root),'utf8');
for(const [,key] of html.matchAll(/data-i18n(?:-label|-title|-placeholder)?="([^"]+)"/g))if(typeof UI[key]!=='string')throw Error('Missing UI copy: '+key);
for(const file of ['index.html',...await readdir(new URL('dist/',root))]){
  if(!/\.(js|html|css)$/.test(file))continue;
  if(/[\uac00-\ud7a3]/u.test(await readFile(new URL('dist/'+file,root),'utf8')))throw Error('Unexpected Korean UI copy in '+file);
}
console.log('Buildless distribution verified: JavaScript syntax, UI copy keys and English-only application sources. Serve dist/ directly; no generated bundle is required.');
