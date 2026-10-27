import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/Users/aster/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const output = new URL('./', import.meta.url);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const report = { checkedAt:new Date().toISOString(), checks:[], errors:[], screenshots:[] };
const check = (name, condition) => { assert.ok(condition,name);report.checks.push(name);console.log('PASS '+name); };
const ready = async page => { await page.waitForFunction(() => !!window.mistDemo,null,{ timeout:45000 }); await settled(page); };
const settled = async page => { await page.waitForFunction(() => !window.mistDemo.getState().camera.moving); await page.waitForTimeout(100); };
const state = page => page.evaluate(() => window.mistDemo.getState());
const observe = page => { page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/net::ERR_FAILED/.test(m.text()))report.errors.push(m.text());}); };
const slider = async (page,id,value) => page.locator('#'+id).evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},String(value));
const capture = async (page,name) => { await page.waitForTimeout(3400);await page.screenshot({path:new URL(name,output).pathname});report.screenshots.push(name); };
async function layoutCheck(page,name) {
  const layout=await page.evaluate(()=>{
    const selectors=['.cooling-panel','.weather','.timeline','.scenario-switch','.layer-toggle','.map-controls'];
    const rects=selectors.map(selector=>({selector,rect:document.querySelector(selector).getBoundingClientRect().toJSON()}));
    const overlaps=[];
    for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];if(Math.min(a.rect.right,b.rect.right)-Math.max(a.rect.left,b.rect.left)>1&&Math.min(a.rect.bottom,b.rect.bottom)-Math.max(a.rect.top,b.rect.top)>1)overlaps.push([a.selector,b.selector]);}
    const coveredLabels=[...document.querySelectorAll('.station-label,.map-label.focusable button')].filter(el=>getComputedStyle(el.parentElement).display!=='none').filter(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)!==el&&!el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}).map(el=>el.id);
    return{overflow:document.documentElement.scrollWidth>innerWidth,overlaps,coveredLabels};
  });
  report[name]=layout;check(name+' has no horizontal scroll, overlapping panels or covered location labels',!layout.overflow&&!layout.overlaps.length&&!layout.coveredLabels.length);
}
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});observe(page);
  await page.goto('http://127.0.0.1:4173');await ready(page);
  let s;
  if(process.argv.includes('--people')){
    await page.locator('#candidate-townhall').click();await settled(page);
    for(let i=0;i<4;i++)await page.locator('#zoom-in').click();
    await page.mouse.move(1100,600);
    for(let i=0;i<32;i++){await page.mouse.wheel(0,-100);await page.waitForTimeout(40);}
    await page.waitForTimeout(700);
    report.camera=(await state(page)).camera;
    await capture(page,'people-detail.png');
    check('Close-up navigation reaches pedestrian scale',Math.hypot(...report.camera.position.map((x,i)=>x-report.camera.target[i]))<100);
    report.result='passed';console.log(JSON.stringify(report,null,2));
  }else{
  if(!process.argv.includes('--responsive')){

  const initial=await state(page);report.liveMap=initial.map;
  check('Real live OpenFreeMap building and street geometry loaded',initial.map.mode==='live'&&initial.map.buildingParts>2000&&initial.map.heatSegments>1000);
  check('All candidates are outside buildings and water',initial.sites.every(s=>s.valid));
  check('Australian English document and UI',await page.locator('html').getAttribute('lang')==='en-AU'&&!/[\uac00-\ud7a3]/u.test(await page.locator('body').innerText()));
  await layoutCheck(page,'desktop');await capture(page,'desktop.png');
  const schema=await page.evaluate(async()=>{const m=await(await fetch('https://tiles.openfreemap.org/planet')).json();return{tiles:m.tiles,version:m.version,layers:m.vector_layers.filter(l=>['building','transportation','water','park','landcover'].includes(l.id))};});
  await fs.writeFile(new URL('map-schema.json',output),JSON.stringify(schema,null,2)+'\n');
  for(const id of ['quay','martin','townhall']){
    await page.locator('#candidate-'+id).click();await settled(page);const s=await state(page);
    check(id+' list selection zooms and keeps the selected map marker',s.selected===id&&s.focusedPlace===id&&s.camera.zoom>1.5&&await page.locator('#map-focus-'+id).getAttribute('aria-pressed')==='true');
    const p=s.screenPoints.find(p=>p.id===id);const inspector=await page.locator('.cooling-panel').boundingBox();
    check(id+' focus is visible beside the inspector',p.x>inspector.x+inspector.width&&p.x<1300&&p.y>250&&p.y<800);
    await page.locator('#reset-view').click();await settled(page);
    await page.locator('#map-focus-'+id).click();await settled(page);
    check(id+' clickable map label selects and zooms',(await state(page)).focusedPlace===id);
    await page.locator('#reset-view').click();await settled(page);
    const point=(await state(page)).screenPoints.find(p=>p.id===id);
    await page.mouse.click(point.x+8,point.y+8);await settled(page);
    check(id+' nearby map area selects and zooms',(await state(page)).focusedPlace===id);
  }
  await page.locator('#candidate-martin').click();await settled(page);
  await page.locator('#top-view').click();await settled(page);const plan=await state(page);
  check('Top-down view is orthographic and preserves selection',plan.top&&plan.selected==='martin'&&plan.focusedPlace==='martin'&&plan.camera.type==='OrthographicCamera'&&Math.abs(plan.camera.position[0]-plan.camera.target[0])<.01);
  await capture(page,'top-down.png');
  await page.locator('#top-view').click();await settled(page);check('Return to 3D preserves focused location',(await state(page)).focusedPlace==='martin'&&(await state(page)).camera.type==='PerspectiveCamera');
  await page.locator('#reset-view').click();await settled(page);
  let p=(await state(page)).screenPoints.find(p=>p.id==='martin');
  await page.mouse.move(p.x+8,p.y+8);await page.mouse.down();await page.mouse.move(p.x+80,p.y+28,{steps:10});await page.mouse.up();
  check('Dragging does not accidentally select a location',(await state(page)).focusedPlace===null);
  await page.locator('#candidate-quay').click();await page.waitForTimeout(150);await page.mouse.move(1000,500);await page.mouse.down();await page.mouse.move(1080,530,{steps:5});await page.mouse.up();
  check('Manual input interrupts animated camera movement',!(await state(page)).camera.moving);
  await page.locator('#candidate-quay').click();await settled(page);
  await page.locator('#install-button').click();let s=await state(page);let quay=s.sites.find(s=>s.id==='quay');
  check('Install updates temperature and mist',s.installed.includes('quay')&&quay.after<quay.before&&s.stations.find(s=>s.id==='quay').mist);
  await slider(page,'power-slider',0);s=await state(page);quay=s.sites.find(s=>s.id==='quay');
  check('Zero output means no temperature reduction or mist',s.power===0&&quay.before===quay.after&&s.stations.every(s=>!s.mist)&&await page.locator('#fog-radius').innerText()==='0 m');
  await slider(page,'power-slider',100);s=await state(page);const highDrop=s.sites.find(s=>s.id==='quay').before-s.sites.find(s=>s.id==='quay').after;
  await slider(page,'power-slider',50);s=await state(page);quay=s.sites.find(s=>s.id==='quay');check('Higher output increases cooling',highDrop>quay.before-quay.after);
  const beforeCompare=await state(page),legend=await page.locator('.temperature-legend').innerText();
  await page.locator('#view-before').click();s=await state(page);check('Before comparison keeps baseline time, weather and scale',!s.after&&s.hour===beforeCompare.hour&&s.cloudy===beforeCompare.cloudy&&s.sites.every((site,i)=>site.before===beforeCompare.sites[i].before)&&s.stations.every(v=>!v.mist)&&legend===await page.locator('.temperature-legend').innerText());
  await page.locator('#view-after').click();check('After comparison restores installed mist',(await state(page)).stations.find(v=>v.id==='quay').mist);
  await page.locator('#candidate-martin').click();await settled(page);check('Installations persist when selecting another candidate',(await state(page)).installed.includes('quay'));
  await page.locator('#candidate-quay').click();await settled(page);await page.locator('#install-button').click();s=await state(page);quay=s.sites.find(s=>s.id==='quay');check('Removing unit removes its local cooling and mist',!s.installed.includes('quay')&&quay.before===quay.after&&!s.stations.find(v=>v.id==='quay').mist);
  const at15=await state(page);await slider(page,'time-slider',9);const at9=await state(page);
  check('Time changes temperature, shade, flow and ranking while preserving selection',at9.selected===at15.selected&&at9.sites.some(a=>{const b=at15.sites.find(b=>b.id===a.id);return a.before!==b.before&&a.footfall!==b.footfall&&a.score!==b.score;})&&at9.sites.some(a=>a.shade!==at15.sites.find(b=>b.id===a.id).shade));
  await page.locator('#weather-toggle').click();const cloudy=await state(page);check('Weather changes baseline temperature and preserves selection',cloudy.cloudy&&cloudy.selected===at9.selected&&cloudy.sites.some(a=>a.before<at9.sites.find(b=>b.id===a.id).before));
  await page.locator('#recommend-button').click();await settled(page);s=await state(page);check('Recommendation selects the current highest-ranked candidate',s.selected===s.sites[0].id);
  const shadeBefore=await state(page);await page.locator('#toggle-shadows').click();s=await state(page);check('Visual shadows do not change thermal calculations',!s.shadows&&s.sites.every(a=>a.before===shadeBefore.sites.find(b=>b.id===a.id).before));
  await page.locator('#toggle-trees').click();check('Tree presence changes independently from visual shadows',!(await state(page)).trees);
  await page.locator('#toggle-trees').click();await page.locator('#toggle-shadows').click();
  await slider(page,'time-slider',17.5);check('Natural comparison is bounded by the 18:00 scenario end',await page.locator('#natural-label').innerText()==='Natural change to 18:00');
  await slider(page,'time-slider',18);check('Natural change is zero at the scenario end',(await state(page)).sites.every(s=>Math.abs(s.natural)<1e-9));
  await page.locator('#play-time').click();await page.waitForTimeout(700);check('Play day restarts from morning at the end',(await state(page)).hour<9&&(await state(page)).playing);await page.locator('#play-time').click();
  await page.locator('.header-right .info-open').click();await page.locator('#scenario-date').fill('2026-07-15');await page.locator('#scenario-date').dispatchEvent('change');await page.locator('#close-info').click();
  check('Winter scenario uses AEST, not hard-coded AEDT',(await state(page)).date==='2026-07-15'&&(await page.locator('#scenario-date-display').innerText()).includes('AEST'));
  await page.locator('.header-right .info-open').click();await page.locator('#scenario-date').fill('2026-10-27');await page.locator('#scenario-date').dispatchEvent('change');await page.locator('#close-info').click();
  await slider(page,'time-slider',15);await page.locator('#weather-toggle').click();await slider(page,'power-slider',65);
  await page.locator('#reset-view').click();await settled(page);await page.locator('#map-focus-opera').focus();await page.keyboard.press('Enter');await settled(page);check('Opera House label works with keyboard',(await state(page)).focusedPlace==='opera');await capture(page,'opera-house.png');
  await page.locator('#reset-view').click();await settled(page);p=(await state(page)).screenPoints.find(p=>p.id==='opera');await page.mouse.click(p.x+8,p.y+8);await settled(page);check('Opera House nearby map area frames the landmark',(await state(page)).focusedPlace==='opera');
  await page.locator('#candidate-townhall').click();await settled(page);await capture(page,'street-detail.png');await page.locator('#zoom-in').click();await page.locator('#zoom-in').click();await page.mouse.move(1100,600);for(let i=0;i<28;i++){await page.mouse.wheel(0,-100);await page.waitForTimeout(30);}await page.waitForTimeout(700);await capture(page,'people-detail.png');
  }
  // True mobile/touch browser context; force network failure to exercise the bundled map.
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  const mobile=await context.newPage();observe(mobile);await mobile.route('https://tiles.openfreemap.org/**',r=>r.abort('failed'));
  await mobile.goto('http://127.0.0.1:4173');await ready(mobile);s=await state(mobile);report.cachedMap=s.map;
  check('Network failure loads the attributed bundled map',s.map.mode==='snapshot'&&s.map.buildingParts>2000&&(await mobile.locator('#map-source').innerText())==='Cached map data');
  await layoutCheck(mobile,'mobile');await capture(mobile,'mobile.png');
  await mobile.locator('#candidate-quay').tap();await settled(mobile);check('Mobile touch selection zooms to Circular Quay',(await state(mobile)).focusedPlace==='quay');
  await mobile.locator('#inspector-toggle').tap();await capture(mobile,'mobile-details.png');await mobile.locator('#power-slider').scrollIntoViewIfNeeded();await slider(mobile,'power-slider',0);check('Mobile sheet exposes output and retains recommendation',(await state(mobile)).power===0&&await mobile.locator('#recommend-button').isVisible());await slider(mobile,'power-slider',65);await layoutCheck(mobile,'expandedMobile');await capture(mobile,'mobile-output.png');
  await mobile.locator('#inspector-toggle').tap();await mobile.locator('#top-view').tap();await settled(mobile);check('Mobile top-down view preserves selection',(await state(mobile)).top&&(await state(mobile)).selected==='quay');
  await mobile.locator('#reset-view').tap();await settled(mobile);
  await mobile.setViewportSize({width:320,height:740});await mobile.waitForTimeout(500);await layoutCheck(mobile,'narrowMobile');await capture(mobile,'mobile-320.png');
  await page.setViewportSize({width:1024,height:768});await page.locator('#reset-view').click();await settled(page);await layoutCheck(page,'smallDesktop');await capture(page,'desktop-1024.png');
  const reduced=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});observe(reduced);await reduced.route('https://tiles.openfreemap.org/**',r=>r.abort('failed'));await reduced.goto('http://127.0.0.1:4173');await ready(reduced);await reduced.locator('#candidate-martin').click();await reduced.waitForTimeout(150);check('Reduced motion completes camera navigation immediately',!(await state(reduced)).camera.moving);
  // Expected failure is isolated from the normal console-error audit.
  const failure=await browser.newPage();await failure.route('https://tiles.openfreemap.org/**',r=>r.abort('failed'));await failure.route('**/data/sydney-openfreemap.geojson',r=>r.fulfill({status:503,body:'Unavailable'}));await failure.goto('http://127.0.0.1:4173');await failure.locator('#loading.failed button').waitFor();check('A useful English retry action appears when both data sources fail',await failure.locator('#loading.failed').getByRole('button',{name:'Try again'}).isVisible());
  await failure.unroute('**/data/sydney-openfreemap.geojson');await failure.getByRole('button',{name:'Try again',exact:true}).first().click();await ready(failure);check('Retry recovers after the bundled map becomes available',(await state(failure)).map.mode==='snapshot');
  check('No relevant console or runtime errors during working scenarios',report.errors.length===0);
  report.result='passed';console.log(JSON.stringify(report,null,2));
  }
} catch(error) {report.result='failed';report.failure=error.stack;throw error;}
finally {await fs.writeFile(new URL(process.argv.includes('--people')?'people-results.json':process.argv.includes('--responsive')?'responsive-results.json':'results.json',output),JSON.stringify(report,null,2)+'\n');await browser.close();}
