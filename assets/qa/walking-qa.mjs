import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE||'/Users/aster/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const output=new URL('./',import.meta.url),report={checkedAt:new Date().toISOString(),checks:[],errors:[]};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
const get=page=>page.evaluate(()=>window.mistDemo.getState());
const walkers=state=>state.pedestrians.flatMap(group=>group.walkers.map(person=>({...person,key:group.id+':'+person.id})));
const prepare=async options=>{
  const page=await browser.newPage(options);
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('net::ERR_FAILED'))report.errors.push(message.text());});
  await page.route('https://tiles.openfreemap.org/**',route=>route.abort('failed'));
  await page.goto('http://127.0.0.1:4173');
  await page.waitForFunction(()=>window.mistDemo,null,{timeout:45000});
  await page.waitForFunction(()=>!window.mistDemo.getState().camera.moving);
  return page;
};
try{
  const page=await prepare({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  const first=walkers(await get(page));await page.waitForTimeout(1400);let current=walkers(await get(page));
  check('Every visible pedestrian has a validated walking route',first.length>30&&first.every(p=>p.moving&&p.valid));
  const travel=current.map((p,i)=>Math.hypot(p.x-first[i].x,p.z-first[i].z)*5);
  report.displacementMetres={min:Math.min(...travel),max:Math.max(...travel),mean:travel.reduce((a,b)=>a+b,0)/travel.length};
  check('People actually travel along streets rather than walking in place',travel.filter(distance=>distance>.3).length>first.length*.7);
  check('Travel remains at a restrained human walking speed',Math.max(...travel)<2.5);
  await page.locator('#toggle-people').click();const paused=walkers(await get(page));await page.waitForTimeout(800);
  check('Hiding pedestrians pauses their motion',JSON.stringify(paused)===JSON.stringify(walkers(await get(page))));
  await page.locator('#toggle-people').click();await page.waitForTimeout(200);current=walkers(await get(page));
  check('Showing pedestrians resumes without jumping ahead',current.every((p,i)=>Math.hypot(p.x-paused[i].x,p.z-paused[i].z)*5<.5));
  await page.locator('#time-slider').evaluate(el=>{el.value='9';el.dispatchEvent(new Event('input',{bubbles:true}));});
  const morning=await get(page);
  check('Time-dependent crowd counts update while retaining safe motion',walkers(morning).length!==first.length&&walkers(morning).every(p=>p.valid&&p.moving));
  await page.locator('#time-slider').evaluate(el=>{el.value='15';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#map-focus-townhall').click();await page.waitForFunction(()=>!window.mistDemo.getState().camera.moving);
  for(let i=0;i<4;i++)await page.locator('#zoom-in').click();
  await page.mouse.move(1100,600);for(let i=0;i<32;i++){await page.mouse.wheel(0,-100);await page.waitForTimeout(40);}
  await page.locator('#toggle-heat').click();await page.waitForTimeout(500);
  const frames=await fs.mkdtemp('/tmp/mist-walking-');
  for(let i=0;i<28;i++){
    const state=await get(page);checkFrame(state);
    await page.screenshot({path:frames+`/frame-${String(i).padStart(3,'0')}.png`,clip:{x:380,y:265,width:960,height:530}});
    await page.waitForTimeout(90);
  }
  function checkFrame(state){assert.ok(walkers(state).every(p=>p.valid),'A walker left mapped walkable space');}
  check('All sampled positions stay outside buildings and water throughout the close-up',true);
  execFileSync(process.env.FFMPEG_PATH||'/opt/homebrew/bin/ffmpeg',['-y','-loglevel','error','-framerate','8','-i',frames+'/frame-%03d.png','-filter_complex','[0:v]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a','-loop','0',new URL('walking.gif',output).pathname]);
  await page.screenshot({path:new URL('walking-desktop.png',output).pathname});
  const mobile=await prepare({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  const mobileBefore=walkers(await get(mobile));await mobile.waitForTimeout(800);const mobileAfter=walkers(await get(mobile));
  check('Walking motion runs on the mobile viewport',mobileAfter.some((p,i)=>Math.hypot(p.x-mobileBefore[i].x,p.z-mobileBefore[i].z)>.05)&&mobileAfter.every(p=>p.valid));
  await mobile.screenshot({path:new URL('walking-mobile.png',output).pathname});
  const reduced=await prepare({viewport:{width:1000,height:800},reducedMotion:'reduce'});
  const still=walkers(await get(reduced));await reduced.waitForTimeout(900);
  check('Reduced-motion preference keeps pedestrians still',JSON.stringify(still)===JSON.stringify(walkers(await get(reduced))));
  check('No relevant browser console or runtime errors',report.errors.length===0);
  report.result='passed';console.log(JSON.stringify(report,null,2));
}catch(error){report.result='failed';report.failure=error.stack;throw error;}
finally{await fs.writeFile(new URL('walking-results.json',output),JSON.stringify(report,null,2)+'\n');await browser.close();}
