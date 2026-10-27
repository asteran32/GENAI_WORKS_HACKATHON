import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/aster/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const folder=new URL('../../shared/demo/agent-monitor/',import.meta.url);
const manifest=JSON.parse(await fs.readFile(new URL('manifest.json',folder),'utf8'));
const runs=await Promise.all(manifest.runs.filter(r=>r.response_language==='en').reverse().map(r=>fs.readFile(new URL('runs/'+r.id+'.json',folder),'utf8').then(JSON.parse)));
const report={checkedAt:new Date().toISOString(),mode:'recorded-api-fixtures-no-live-model',checks:[],errors:[]},posts=[];
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const check=(name,condition)=>{assert.ok(condition,name);report.checks.push(name);};
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.route('https://tiles.openfreemap.org/**',r=>r.abort('failed'));
  await page.route('**/api/agent/**',async route=>{
    const req=route.request(),url=new URL(req.url());let value;
    if(url.pathname.endsWith('/status'))value={date:'2025-12-19',fresh_start_supported:true,dependency_installed:true,catalog_ready:true,providers:{gemini:{configured:true}}};
    else if(req.method()==='POST'){posts.push(req.postDataJSON());value={id:runs[(posts.length-1)%5].id};}
    else value=runs.find(r=>url.pathname.endsWith('/'+r.id));
    await route.fulfill({status:req.method()==='POST'?202:200,contentType:'application/json',body:JSON.stringify(value)});
  });
  await page.goto('http://127.0.0.1:4173');
  await page.locator('#chat-launcher').click();
  const input=page.locator('#chat-input');
  check('Blank input cannot be submitted',await page.locator('#chat-send').isDisabled());
  for(const [i,run]of runs.entries()){
    await input.fill(run.question);await input.press('Enter');
    await page.waitForFunction(n=>document.querySelectorAll('.chat-message-assistant').length===n&&!document.getElementById('chat-clear').disabled,i+1);
    check('User input reaches the existing agent contract, turn '+(i+1),posts[i].question===run.question&&posts[i].previous_run_id===(i?runs[i-1].id:null)&&posts[i].fresh_start===(i===0));
    if(i)check('Plan appears in candidate locations, turn '+(i+1),(await page.locator('#allocation-summary').innerText()).includes(run.plan.totals.units+' fog units')&&await page.locator('.candidate-units').count()===10);
  }
  check('Unit header replaces priority score',(await page.locator('.candidate-heading').innerText()).includes('Fog units')&&!(await page.locator('.candidate-heading').innerText()).includes('score'));
  check('Unit counts total the final inventory',await page.locator('.candidate-units').evaluateAll(nodes=>nodes.reduce((n,e)=>n+parseInt(e.textContent,10),0))===30);
  await page.locator('#chat-close').click();await page.locator('.allocation-row').first().click();
  check('Selected segment has quantity and schedule details',(await page.locator('#allocation-detail').innerText()).includes('fog units')&&(await page.locator('#allocation-detail').innerText()).includes('L/day'));
  await page.screenshot({path:new URL('connected-chat-desktop.png',import.meta.url).pathname});
  await page.reload();await page.locator('#chat-launcher').click();
  check('Reload restores conversation without sending again',posts.length===5&&await page.locator('.chat-message-user').count()===5);
  await page.locator('#chat-clear').click();
  check('Refresh icon starts a fresh scenario',await page.locator('.chat-message').count()===0&&await page.locator('.allocation-row').count()===0);
  await input.fill(runs[0].question);await input.press('Enter');await page.waitForFunction(()=>!document.getElementById('chat-clear').disabled);
  check('Next request excludes old context',posts[5].fresh_start===true&&posts[5].previous_run_id===null);
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    check(width+'px chat fits',await page.locator('#chat-panel').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth;}));
    await page.screenshot({path:new URL('connected-chat-mobile-'+width+'.png',import.meta.url).pathname});
  }
  check('No page runtime errors',report.errors.length===0);report.result='passed';
} catch(error){report.result='failed';report.failure=error.stack;throw error;}
finally{await fs.writeFile(new URL('connected-chat-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');await browser.close();}
