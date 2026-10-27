import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE||'/Users/aster/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const output=new URL('./',import.meta.url),report={checkedAt:new Date().toISOString(),checks:[],errors:[],chatApiRequests:[]};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
async function bounds(page){return page.evaluate(()=>{
  const selectors=['#chat-panel','#chat-input','#chat-send','#chat-close'];
  return selectors.map(selector=>{const rect=document.querySelector(selector).getBoundingClientRect();return{selector,inside:rect.x>=0&&rect.y>=0&&rect.right<=innerWidth+1&&rect.bottom<=innerHeight+1};});
});}
async function headerFits(page){return page.evaluate(()=>{
  const elements=[...document.querySelectorAll('.topbar>.brand,.topbar>.nav-title,.topbar>.header-right')].filter(el=>getComputedStyle(el).display!=='none').map(el=>el.getBoundingClientRect());
  return elements.every(r=>r.x>=0&&r.right<=innerWidth)&&elements.every((r,i)=>elements.slice(i+1).every(b=>Math.min(r.right,b.right)<=Math.max(r.left,b.left)+1));
});}
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('net::ERR_FAILED'))report.errors.push(message.text());});
  page.on('request',request=>{if(request.method()==='POST'||new URL(request.url()).pathname.startsWith('/api/'))report.chatApiRequests.push(request.url());});
  await page.route('https://tiles.openfreemap.org/**',route=>route.abort('failed'));
  await page.goto('http://127.0.0.1:4173');
  const launcher=page.getByRole('button',{name:'Open Mist chat',exact:true});
  await launcher.waitFor();check('Chat starts closed',!await page.locator('#chat-panel').isVisible());
  check('Desktop header controls do not overlap',await headerFits(page));
  await launcher.click();
  const input=page.getByRole('textbox',{name:'Your message'}),send=page.getByRole('button',{name:'Send message',exact:true});
  check('Chat icon opens an accessible conversation panel',await page.getByRole('dialog',{name:'Mist assistant'}).isVisible()&&await launcher.getAttribute('aria-expanded')==='true');
  check('Opening chat focuses the composer',await input.evaluate(el=>el===document.activeElement));
  check('Preview clearly identifies the disconnected agent',await page.locator('#chat-note').isVisible()&&(await page.locator('#chat-note').innerText()).includes('not connected'));
  check('Empty messages cannot be sent',await send.isDisabled());
  await input.fill('   ');check('Whitespace messages cannot be sent',await send.isDisabled());
  await page.getByRole('button',{name:'Compare candidate locations',exact:true}).click();
  check('Starter questions fill the composer without submitting',await input.inputValue()==='Compare candidate locations'&&await page.locator('.chat-message').count()===0);
  await page.keyboard.press('Escape');check('Escape closes chat and restores launcher focus',!await page.locator('#chat-panel').isVisible()&&await launcher.evaluate(el=>el===document.activeElement));
  await launcher.click();check('Unsent draft survives close and reopen',await input.inputValue()==='Compare candidate locations');
  await page.waitForFunction(()=>window.mistDemo,null,{timeout:45000});await page.waitForTimeout(1000);
  await page.screenshot({animations:'disabled',path:new URL('chat-welcome-desktop.png',output).pathname});
  await input.fill('Line one');await input.press('Shift+Enter');await input.pressSequentially('Line two');
  check('Shift+Enter adds a new line',await input.inputValue()==='Line one\nLine two');
  await input.press('Enter');
  check('Enter adds the user message to the conversation',await page.locator('.chat-message p').last().innerText()==='Line one\nLine two'&&await input.inputValue()==='');
  check('Send resets the composer and retains input focus',await send.isDisabled()&&await input.evaluate(el=>el===document.activeElement));
  await input.fill('<img src=x onerror="window.chatInjection=true">');await send.click();
  check('Message content is rendered as text, not HTML',await page.locator('#chat-messages img').count()===0&&await page.evaluate(()=>!window.chatInjection));
  await page.getByRole('button',{name:'Close chat',exact:true}).click();await launcher.click();
  check('Conversation survives close and reopen',await page.locator('.chat-message').count()===2);
  await page.getByRole('button',{name:'Clear messages',exact:true}).click();
  check('Clear restores the welcome state',await page.locator('.chat-message').count()===0&&await page.locator('#chat-welcome').isVisible()&&await page.getByRole('button',{name:'Clear messages',exact:true}).isDisabled());
  // IME Enter must not accidentally submit a message during composition.
  await input.fill('Composing');await input.dispatchEvent('keydown',{key:'Enter',isComposing:true});
  check('IME composition does not submit prematurely',await page.locator('.chat-message').count()===0);
  await input.fill('Which location would benefit most from cooling fog?');await send.click();
  check('No fake agent replies are generated',await page.locator('.chat-message').count()===1&&await page.locator('.chat-message-speaker').innerText()==='You');
  check('Desktop composer and close controls remain within the viewport',(await bounds(page)).every(x=>x.inside));
  await page.screenshot({animations:'disabled',path:new URL('chat-desktop.png',output).pathname});
  await page.locator('#chat-close').click();await page.mouse.click(100,100);await launcher.click();await page.mouse.click(50,100);
  check('Clicking the backdrop closes the panel',!await page.locator('#chat-panel').isVisible());
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});await page.waitForTimeout(200);
    check(width+'px mobile header does not overlap',await headerFits(page));
    await launcher.click();
    check(width+'px mobile chat has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.getElementById('chat-panel').scrollWidth<=document.getElementById('chat-panel').clientWidth));
    check(width+'px mobile composer and close button stay accessible',(await bounds(page)).every(x=>x.inside));
    await input.fill('Cooling fog '.repeat(150));await send.click();
    check(width+'px long messages wrap and scroll',await page.locator('#chat-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth&&el.scrollHeight>el.clientHeight));
    await page.getByRole('button',{name:'Clear messages',exact:true}).click();await input.fill('How does shade affect the cooling estimate?');await send.click();
    await page.screenshot({animations:'disabled',path:new URL('chat-mobile-'+width+'.png',output).pathname});
    await page.locator('#chat-close').click();
  }
  await page.setViewportSize({width:390,height:480});await launcher.click();
  check('Short keyboard-sized viewport retains composer controls',(await bounds(page)).every(x=>x.inside));
  await page.screenshot({animations:'disabled',path:new URL('chat-mobile-keyboard.png',output).pathname});
  await page.locator('#chat-close').click();await page.emulateMedia({reducedMotion:'reduce'});await launcher.click();
  check('Reduced motion disables panel animation',await page.locator('#chat-panel').evaluate(el=>getComputedStyle(el).animationName)==='none');
  check('UI-only chat makes no agent API requests',report.chatApiRequests.length===0);
  check('No relevant console or runtime errors',report.errors.length===0);
  report.result='passed';console.log(JSON.stringify(report,null,2));
}catch(error){report.result='failed';report.failure=error.stack;throw error;}
finally{await fs.writeFile(new URL('chat-results.json',output),JSON.stringify(report,null,2)+'\n');await browser.close();}
