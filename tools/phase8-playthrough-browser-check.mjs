/** Focused production Reader checks. Screenshot bytes stay in local files. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const shopOnly = process.argv.includes('--shop-only');
const resultDir = join(root, 'test-results', shopOnly ? 'phase8-reader-shop' : 'phase8-reader');
const screenshotDir = join(resultDir, 'screenshots');
const source = JSON.parse(await readFile(join(dist,'data','maps','story-source.json'),'utf8'));
const english = JSON.parse(await readFile(join(dist,'data','locales','en.json'),'utf8'));
const profile = await mkdtemp(join(tmpdir(), 'solaris-reader-ui-'));
const checks = [], screenshots = [], errors = [];
const maxSteps = Number(process.env.SOLARIS_BROWSER_STEPS ?? 1600);
const seen = new Set(), route = [];
let checkpointBranch = shopOnly;
let shopBefore, shopCommand, shopVerified = false;
let storeClicks = 0;
let browser, client, server, slowNextScript = false;
let browserErrors = '';
let lastControl = null, lastScene = null;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
const testId = id => `[data-testid="${id}"]`;

class CDP {
  nextId = 0;
  pending = new Map();
  sessionId;
  constructor(input, output) {
    this.input = input;
    let buffer = '';
    output.setEncoding('utf8');
    output.on('data', chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\0')) >= 0) {
        const packet = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (packet) this.receive(JSON.parse(packet));
      }
    });
    const broken = error => {
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
      this.pending.clear();
    };
    input.on('error', broken); output.on('error', broken);
  }
  receive(message) {
    if (message.id) {
      const item = this.pending.get(message.id);
      if (!item) return;
      this.pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      errors.push(message.params.entry.text);
    } else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
      errors.push(`HTTP ${message.params.response.status}: ${new URL(message.params.response.url).pathname}`);
    }
  }
  send(method, params = {}) {
    return new Promise((resolveResult, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10_000);
      this.pending.set(id, { resolve: resolveResult, reject, timer });
      const sessionId = method.startsWith('Target.') ? undefined : this.sessionId;
      this.input.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
}

async function until(expression, description, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  do {
    if (await client.evaluate(expression)) return;
    await delay(50);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}`);
}
const settle = () => client.evaluate('new Promise(resolve => { const timer=setTimeout(resolve,100);requestAnimationFrame(() => requestAnimationFrame(() => {clearTimeout(timer);resolve();})); })');
const state = () => client.evaluate(`(() => { const e = document.querySelector('${testId('runner-state')}'); return { run: e.dataset.runId, visit: e.dataset.visitId, nid: e.dataset.nid, status: e.dataset.status, script: e.dataset.scriptId }; })()`).then(value=>{lastScene=value;return value;});
async function clickSelector(selector) {
  lastControl=selector;
  await until(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return e && !e.disabled && e.getClientRects().length > 0; })()`, `enabled ${selector}`);
  const point = await client.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,height:innerHeight}; })()`);
  assert.ok(point.x >= 0 && point.y >= 0 && point.x < point.width && point.y < point.height, `Control is offscreen: ${selector}`);
  delete point.width;delete point.height;
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  await settle();
}
const click = id => clickSelector(testId(id));
async function key(key, code, keyCode) {
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
  await settle();
}
async function input(id, value) {
  await client.evaluate(`(() => { const e = document.querySelector('${testId(id)}'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await settle();
}
async function select(id, value) {
  await client.evaluate(`(() => { const e = document.querySelector('${testId(id)}'); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await settle();
}
async function screenshot(name) {
  await settle();
  const result = await client.send('Page.captureScreenshot', { format: 'jpeg', quality: 82, captureBeyondViewport: false });
  const path = join(screenshotDir, name + '.jpg');
  await writeFile(path, Buffer.from(result.data, 'base64'));
  screenshots.push(path);
}
async function layout(label) {
  assert.ok(await client.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), `${label}: horizontal overflow`);
  assert.ok(await client.evaluate(`Array.from(document.images).filter(e => e.getClientRects().length).every(e => e.complete && e.naturalWidth > 0)`), `${label}: visible artwork failed`);
  checks.push(label);
}

async function schoolState() {
  await click('menu'); await click('menu-stories');
  await until(`!!document.querySelector('${testId('journey-panel')}')`, 'School year overview');
  const result = await client.evaluate(`(() => { const p=document.querySelector('${testId('journey-panel')}');return {stats:p.querySelector('.journey-stats')?.innerText,favor:p.querySelector('.journey-favor')?.innerText,records:p.querySelector('.journey-records')?.innerText}; })()`);
  await click('stories-close');
  return result;
}
async function checkpoint(action) {
  await click('settings');
  await click(`${action}-checkpoint`);
  await click('settings-close');
}
async function capturedNotices() {
  const current = await state();
  const types = await client.evaluate(`({relationship:!!document.querySelector('${testId('reader-relationship')}'),attribute:!!document.querySelector('${testId('consequence-attribute')}'),favor:!!document.querySelector('${testId('consequence-favor')}'),item:!!document.querySelector('${testId('consequence-item')}'),request:!!document.querySelector('${testId('consequence-requestUnlocked')}')})`);
  for (const name of shopOnly ? [] : ['relationship','item','request']) if (types[name] && !seen.has(name)) {
    if(name==='request') assert.ok(await client.evaluate(`(() => { const r=document.querySelector('${testId('consequence-requestUnlocked')}').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth; })()`),'request-unlocked notice stays visible on a scrolled planning page');
    seen.add(name); await screenshot(name+'-desktop'); checks.push({kind:name,at:current});
    if(name==='relationship') {
      assert.ok(await client.evaluate(`document.querySelector('.relationship-tier').innerText.includes('Acquainted')`),'initial relationship uses the verified source tier');
      assert.ok(await client.evaluate(`(() => { const title=document.querySelector('.relationship-card h3').getBoundingClientRect(),portrait=document.querySelector('.relationship-portrait').getBoundingClientRect();return title.left >= portrait.right-1; })()`),'relationship heading clears its portrait');
      await client.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await settle();await screenshot('relationship-mobile');await layout('mobile relationship');
      assert.ok(await client.evaluate(`(() => { const title=document.querySelector('.relationship-card h3').getBoundingClientRect(),portrait=document.querySelector('.relationship-portrait').getBoundingClientRect();return title.left >= portrait.right-1; })()`),'mobile relationship heading clears its portrait');
      await client.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});await settle();
    }
  }
  if (!shopOnly && types.attribute && types.favor && !seen.has('combined-gains')) { seen.add('combined-gains'); await screenshot('combined-gains-desktop'); checks.push({kind:'combined-gains',at:current}); }
  if(shopCommand && types.item && !seen.has('shop-receipt')) {
    assert.equal(await client.evaluate(`document.querySelectorAll('${testId('reader-consequences')}').length`),1,'purchase has exactly one receipt region');
    assert.ok(await client.evaluate(`!!document.querySelector('${testId('consequence-item')}')?.closest('dialog[open]')`),'received item is visible inside the open shop dialog');
    assert.ok(await client.evaluate(`(() => { const r=document.querySelector('${testId('reader-consequences')}').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth; })()`),'shop receipts stay fully visible in the open dialog');
    assert.ok(await client.evaluate(`Array.from(document.querySelectorAll('${testId('consequence-item')} .consequence-name')).some(e=>e.innerText===${JSON.stringify(shopCommand.label)})`),'receipt shows the actual purchased item name');
    seen.add('shop-receipt');await screenshot('shop-receipt-desktop');checks.push({kind:'shop-receipt',command:shopCommand,at:current});
    if(shopOnly) {
      await client.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await settle();await screenshot('shop-receipt-mobile');await layout('mobile shop receipt');
      assert.ok(await client.evaluate(`(() => { const r=document.querySelector('${testId('reader-consequences')}').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth; })()`),'mobile shop receipt stays fully visible');
      await client.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});await settle();
    }
  }
}
async function normalStep() {
  await capturedNotices();
  if (await client.evaluate(`!!document.querySelector('${testId('relationship-confirm')}')`)) { await click('relationship-confirm'); return; }
  if (await client.evaluate(`!!document.querySelector('${testId('letter-confirm')}')`)) { await screenshot('letter-desktop'); await click('letter-confirm'); return; }
  const enabled = await client.evaluate(`(() => {
    const visible=e=>e&&!e.disabled&&e.getClientRects().length>0;
    const q=s=>Array.from(document.querySelectorAll(s)).filter(visible);
    let e=q('[data-testid="journey-option"]')[0];
    if(document.querySelector('[data-testid="journey-interaction"]')) {
      if(${!!shopCommand}&&document.querySelector('.journey-interaction-body')?.dataset.kind==='shop') return {selector:'[data-testid="journey-confirm"]',shopClose:true};
      return e?{selector:'[data-journey-option="'+e.dataset.journeyOption+'"]',journeyOption:e.dataset.journeyOption,label:e.querySelector('span')?.innerText}:visible(document.querySelector('[data-testid="journey-confirm"]'))?{selector:'[data-testid="journey-confirm"]'}:null;
    }
    e=q('[data-testid="choice"]')[0];if(e)return {selector:'[data-testid="choice"][data-option-index="'+e.dataset.optionIndex+'"]',optionId:e.dataset.optionId};
    e=document.querySelector('[data-testid="advance"]');if(visible(e))return {selector:'[data-testid="advance"]'};
    e=q('[data-testid="quiz-answer"]')[0];if(e)return {selector:'[data-testid="quiz-answer"][data-answer-id="'+e.dataset.answerId+'"]'};
    e=document.querySelector('[data-testid="quiz-continue"]');if(visible(e))return {selector:'[data-testid="quiz-continue"]'};
    e=q('[data-journey-option^="reward:"]')[0];if(e)return {selector:'[data-journey-option="'+e.dataset.journeyOption+'"]'};
    if(${checkpointBranch && !shopCommand}) {
      e=q('[data-journey-option="locationOption:401"]')[0]||q('[data-journey-option="location:1010"]')[0];
      if(e)return {selector:'[data-journey-option="'+e.dataset.journeyOption+'"]',journeyOption:e.dataset.journeyOption};
    }
    e=document.querySelector('[data-testid="journey-continue"]');if(visible(e))return {selector:'[data-testid="journey-continue"]'};
    const choices=q('[data-testid="journey-option"]');e=choices.find(e=>/rest|break/i.test(e.innerText))||choices[0];return e?{selector:'[data-journey-option="'+e.dataset.journeyOption+'"]'}:null;
  })()`);
  if (!enabled) { await delay(100); return; }
  const before=await state();
  if(enabled.journeyOption==='location:1010'&&!shopBefore)shopBefore=await schoolState();
  if (enabled.optionId) route.push({...before,optionId:enabled.optionId});
  if (enabled.journeyOption) route.push({...before,journeyOption:enabled.journeyOption});
  await clickSelector(enabled.selector);
  if(shopOnly&&['location:1010','locationOption:401'].includes(enabled.journeyOption)) {
    storeClicks++;
    const visibleStore=await client.evaluate(`(() => { const e=document.querySelector('[data-journey-option="locationOption:401"]');return {phase:document.querySelector('[data-testid="journey-panel"]')?.dataset.phase,storeOptionPresent:!!e,storeOptionEnabled:e?!e.disabled:false,interaction:document.querySelector('.journey-interaction-body')?.dataset.kind}; })()`);
    console.log(`Shop control ${enabled.journeyOption}: ${JSON.stringify(visibleStore)}`);
    assert.ok(storeClicks<=8,'store navigation did not expose its authored shop option');
  }
  if(enabled.journeyOption?.startsWith('shop:')) {
    const goods=source.shopGoods[enabled.journeyOption.split(':')[2]], item=source.items[goods.ItemId], expected=english[item.Name];
    assert.ok(expected,'purchased source item has an exported English name');
    assert.equal(enabled.label,expected,'shop button uses its actual source item name');
    shopCommand={optionId:enabled.journeyOption,label:enabled.label,itemId:goods.ItemId};
  }
  if(enabled.shopClose&&!shopVerified) {
    const received=await schoolState();
    assert.notEqual(received.records,shopBefore.records,'purchase changes the real inventory');
    assert.notEqual(received.stats,shopBefore.stats,'purchase applies its real currency cost');
    await click('history');await click('history-close');await checkpoint('save');await checkpoint('restore');
    assert.deepEqual(await schoolState(),received,'History and checkpoint restore cannot repeat the purchase or cost');
    checks.push({kind:'shop-history-checkpoint-idempotence',command:shopCommand,before:shopBefore,received});shopVerified=true;
  }
}
async function untilNode(nid, budget=30) {
  for(let i=0;i<budget;i++){if((await state()).nid===String(nid))return;await normalStep();}
  throw new Error('Did not reach source node '+nid);
}
async function branchCheckpoint() {
  await checkpoint('save');
  const branches=[];
  for(const [optionId,destination] of [['2','9'],['3','10']]) {
    if(branches.length)await checkpoint('restore');
    assert.equal((await state()).nid,'8');
    await clickSelector(`[data-testid="choice"][data-option-id="${optionId}"]`);
    await until(`document.querySelector('${testId('runner-state')}').dataset.nid===${JSON.stringify(destination)}`,'source branch destination');
    const immediate=await state();await untilNode(11);
    const rejoin=await state(),story=await schoolState();branches.push({optionId,immediate,rejoin,story});
    await screenshot('1011-option-'+optionId+'-rejoin');
    await click('history');await click('history-close');await click('history');await click('history-close');
    assert.deepEqual(await schoolState(),story,'History cannot grant another consequence');
  }
  assert.notEqual(branches[0].story.favor,branches[1].story.favor,'source option3 carries its actual Chisa favor gain after rejoin');
  checks.push({kind:'1011-checkpoint-fork',branches});checkpointBranch=true;
}

try {
  await mkdir(screenshotDir,{recursive:true});await readFile(join(dist,'index.html'));
  server=createServer(async(request,response)=>{
    try {
      const pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
      if(pathname==='/favicon.ico'){response.writeHead(204);response.end();return;}
      const filename=resolve(dist,'.'+(extname(pathname)?pathname:'/index.html'));if(!filename.startsWith(dist+sep))throw new Error('Invalid path');
      response.writeHead(200,{'Content-Type':mime[extname(filename)]??'application/octet-stream','Cache-Control':'no-store'});response.end(await readFile(filename));
    }catch{response.writeHead(404);response.end('Missing fixture file');}
  });
  await new Promise(resolveServer=>server.listen(0,'127.0.0.1',resolveServer));
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=spawn(process.env.CHROMIUM_BIN??'/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader',`--user-data-dir=${profile}`,'--remote-debugging-pipe','about:blank'],{stdio:['ignore','ignore','pipe','pipe','pipe']});
  browser.stderr.on('data',chunk=>{browserErrors=(browserErrors+chunk).slice(-3000);});
  client=new CDP(browser.stdio[3],browser.stdio[4]);
  const target=await client.send('Target.createTarget',{url:'about:blank'});client.sessionId=(await client.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
  for(const domain of ['Page','Runtime','Log','Network'])await client.send(domain+'.enable');
  await client.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  await client.send('Page.navigate',{url:origin+'/'});
  await client.send('Page.bringToFront');
  await until(`!!document.querySelector('${testId('start')}')&&!document.querySelector('${testId('start')}').disabled&&!document.querySelector('${testId('reader-loading')}')`,'Reader entry');
  if(!shopOnly)await screenshot('entry-desktop');await click('settings');await click('instant-text');await click('settings-close');await click('start');
  await until(`document.querySelector('${testId('runner-state')}').dataset.scriptId==='1001'`,'authored first scene1001');
  await capturedNotices();await click('relationship-confirm');
  if(!shopOnly) {
    const initial=await schoolState();await checkpoint('save');await normalStep();await checkpoint('restore');
    assert.deepEqual(await schoolState(),initial,'checkpoint restore keeps granted initial state without granting it again');
    assert.equal(await client.evaluate(`!!document.querySelector('${testId('reader-relationship')}')`),false,'checkpoint restoration cannot replay the initial tier confirmation');
    await click('history');await screenshot('history-desktop');await click('history-close');
    assert.deepEqual(await schoolState(),initial,'History remains read-only');checks.push({kind:'initial-history-checkpoint-idempotence',initial});
  }
  for(let step=0;step<maxSteps;step++){
    const current=await state();
    if(!shopOnly&&current.script==='1011'&&current.nid==='8'&&!checkpointBranch)await branchCheckpoint();
    if(step%100===0){console.log(`Reader step ${step}: script ${current.script} node ${current.nid}`);await writeFile(join(resultDir,'progress.json'),JSON.stringify({step,scene:current,lastControl})+'\n');}
    await normalStep();
    if(await client.evaluate(`document.querySelector('${testId('journey-panel')}')?.dataset.phase==='complete'`)){checks.push({kind:'normal-route-complete',at:await state()});break;}
    if(seen.has('shop-receipt')&&shopVerified&&(shopOnly||checkpointBranch&&seen.has('combined-gains')&&seen.has('item')))break;
  }
  if(!shopOnly) {
    assert.ok(checkpointBranch,'normal Reader reaches the1011 checkpoint comparison');
    assert.ok(seen.has('combined-gains'),'normal Reader shows authored stat/favor gains together');
  }
  assert.ok(seen.has('shop-receipt')&&shopVerified,'normal Reader can purchase and view a modal receipt without replay');
  const noTraces=await client.evaluate(`!document.querySelector('[data-testid="journey-diagnostics"]')&&!document.querySelector('.debug-panel')&&!document.body.innerText.includes('ConditionGroupId')&&!document.body.innerText.includes('unavailable-internal-name')`);
  assert.ok(noTraces,'Reader exposes no route conditions or diagnostic traces');await screenshot('normal-route-desktop');
  await client.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await settle();await screenshot('normal-route-mobile');await layout('mobile Reader');
  checks.push({kind:shopOnly?'targeted-shop-route':'bounded-normal-route',final:await state(),maxSteps,captured:Array.from(seen),checkpointBranch:!shopOnly&&checkpointBranch});
} catch(error) {errors.push(error.message);console.log('Reader check failed: '+error.message);if(client){try{await screenshot('failure');}catch{}}}
finally {
  // Preserve assertion results before process/socket finalization. A provider
  // timeout during cleanup cannot make an older result look like a new pass.
  await mkdir(resultDir,{recursive:true});
  await writeFile(join(resultDir,'browser-result.json'),JSON.stringify({passed:errors.length===0,mode:'production HTTP Chromium, public Reader controls',checks,route,screenshots,errors,lastScene,lastControl,finalization:'pending'},null,2)+'\n');
  if(client){try{await client.send('Browser.close');}catch{}}
  if(browser&&browser.exitCode===null){browser.kill('SIGTERM');await Promise.race([new Promise(done=>browser.once('exit',done)),delay(1500)]);if(browser.exitCode===null)browser.kill('SIGKILL');}
  if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}
  try { await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100}); }
  catch(error) { errors.push('Browser profile cleanup: '+error.message); }
  const result={passed:errors.length===0,mode:'production HTTP Chromium, public Reader controls',checks,route,screenshots,errors,lastScene,lastControl,...(errors.length?{browserErrors}:{})};
  await writeFile(join(resultDir,'browser-result.json'),JSON.stringify(result,null,2)+'\n');console.log(`${result.passed?'PASS':'FAIL'}: ${checks.length} checks; ${screenshots.length} local captures; ${route.length} normal choices. ${resultDir}/browser-result.json`);
  if(errors.length){console.log(errors.join('\n').slice(0,1500));process.exitCode=1;}
}
