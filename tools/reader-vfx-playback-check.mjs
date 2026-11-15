/** Production VFX checks using ordinary Reader gestures and Settings saves.
 * The optional probes only observe the shared engine/renderers. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const resultDir = process.env.READER_RESULT_DIR ? resolve(process.env.READER_RESULT_DIR) : join(root, 'test-results/reader-vfx-playback');
const profile = await mkdtemp(join(tmpdir(), 'reader-vfx-playback-'));
const screenshots = [], clips = [], measurements = [], navigation = [], errors = [], checks = [];
let browser, client, server, failure;
const tid = id => `[data-testid="${id}"]`;
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.wasm':'application/wasm', '.opus':'audio/ogg', '.ogg':'audio/ogg', '.wav':'audio/wav' };

class CDP {
  next = 0; pending = new Map(); sessionId;
  constructor(input, output) {
    this.input = input; let buffer = '';
    output.setEncoding('utf8'); output.on('data', chunk => {
      buffer += chunk; let end;
      while ((end = buffer.indexOf('\0')) >= 0) {
        const value = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (value) this.receive(JSON.parse(value));
      }
    });
    const broken = error => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear(); };
    input.on('error', broken); output.on('error', broken);
  }
  receive(message) {
    if (message.id) {
      const p = this.pending.get(message.id); if (!p) return;
      this.pending.delete(message.id); clearTimeout(p.timer);
      if (message.error) p.reject(new Error(message.error.message)); else p.resolve(message.result);
    } else if (message.method === 'Page.screencastFrame') {
      this.clip?.frames.push({ data:message.params.data, metadata:message.params.metadata });
      this.send('Page.screencastFrameAck', { sessionId:message.params.sessionId }).catch(error=>errors.push(error.message));
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) errors.push(`HTTP ${message.params.response.status}: ${new URL(message.params.response.url).pathname}`);
  }
  send(method, params = {}) {
    return new Promise((resolveResult, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 20_000);
      this.pending.set(id, { resolve:resolveResult, reject, timer });
      this.input.write(JSON.stringify({ id, method, params, sessionId:method.startsWith('Target.') ? undefined : this.sessionId }) + '\0');
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
}

async function until(expression, label, timeout = 18_000) {
  const deadline = Date.now() + timeout;
  do { if (await client.evaluate(expression)) return; await delay(30); } while (Date.now() < deadline);
  throw new Error('Timed out: ' + label);
}
const settle = () => client.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const state = () => client.evaluate(`({...document.querySelector('${tid('runner-state')}').dataset})`);
const vfx = () => client.evaluate(`JSON.parse(document.querySelector('${tid('vfx-probe')}').textContent)`);
const audio = () => client.evaluate(`JSON.parse(document.querySelector('${tid('audio-probe')}').textContent)`);
async function clickSelector(selector, touch = false) {
  await until(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e&&!e.disabled&&e.getClientRects().length>0;})()`, selector);
  const point = await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  if (touch) {
    await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[point] });
    await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
  } else {
    await client.send('Input.dispatchMouseEvent', { type:'mousePressed', button:'left', clickCount:1, ...point });
    await client.send('Input.dispatchMouseEvent', { type:'mouseReleased', button:'left', clickCount:1, ...point });
  }
  await settle();
}
const click = id => clickSelector(tid(id));
async function select(id, value) {
  await client.evaluate(`(()=>{const e=document.querySelector('${tid(id)}');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await settle();
}
async function screenshot(name) {
  const r = await client.send('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
  const path = join(resultDir, name + '.png');
  await writeFile(path, Buffer.from(r.data, 'base64')); screenshots.push(path);
}
async function startClip(label) {
  client.clip = { label, frames:[] };
  await client.send('Page.startScreencast', { format:'png', maxWidth:1600, maxHeight:900, everyNthFrame:1 });
}
async function finishClip() {
  await client.send('Page.stopScreencast');
  const clip = client.clip; client.clip = null;
  const directory = join(resultDir, 'frames', clip.label); await mkdir(directory, { recursive:true });
  const frames = [];
  for (const [index, frame] of clip.frames.entries()) {
    const path = join(directory, String(index).padStart(3,'0') + '.png');
    await writeFile(path, Buffer.from(frame.data, 'base64'));
    frames.push({ path, metadata:frame.metadata });
  }
  clips.push({ label:clip.label, frames });
  assert.ok(frames.length >= 3, 'Capture multiple real compositor frames for ' + clip.label);
}
async function dismissNotices() {
  for (let i = 0; i < 12; i++) {
    const selector = await client.evaluate(`['relationship-confirm','letter-confirm','role-intro-confirm'].map(id=>'[data-testid="'+id+'"]').find(s=>document.querySelector(s)?.getClientRects().length)||null`);
    if (!selector) return;
    await clickSelector(selector);
  }
}
async function step() {
  await dismissNotices();
  await until(`(()=>{const e=document.querySelector('${tid('runner-state')}');return ['dialogue','choices'].includes(e.dataset.status)&&e.dataset.inputReady==='true'&&e.dataset.textComplete==='true';})()`, 'Reader input ready');
  const before = await state();
  const options = await client.evaluate(`Array.from(document.querySelectorAll('${tid('choice')}')).filter(e=>!e.disabled&&e.getClientRects().length).map(e=>e.dataset.optionId)`);
  if (before.status === 'choices' && before.hiddenChoice !== 'true') {
    assert.ok(options.length, 'Source scene exposes an eligible ordinary response');
    await clickSelector(`${tid('choice')}:not(:disabled)`);
  } else await click('advance');
  navigation.push({ before, options, after:await state() });
}
async function advanceTo(nid, waitMs = 400) {
  for (let i = 0; i < 350; i++) {
    if ((await state()).nid === String(nid)) { if (waitMs) await delay(waitMs); return; }
    await step();
  }
  throw new Error('Did not reach node ' + nid);
}
async function sourceScene(id) {
  await dismissNotices(); await click('menu'); await click('switch-view');
  await until(`document.querySelector('${tid('interface')}').dataset.interface==='developer'`, 'existing source selector');
  await select('script-select', id); await click('continue-script');
  await until(`document.querySelector('${tid('runner-state')}').dataset.scriptId===${JSON.stringify(id)}&&['dialogue','choices'].includes(document.querySelector('${tid('runner-state')}').dataset.status)`, 'source ' + id);
  await click('switch-view');
  await until(`document.querySelector('${tid('interface')}').dataset.interface==='reader'`, 'normal Reader');
  checks.push('Source ' + id + ' selected through existing UI, with known New playthrough story state');
}
async function checkpoint(action) {
  await click('settings'); await click(action + '-checkpoint');
  if (action === 'save') await until(`document.querySelector('dialog[open]')?.textContent.includes('Checkpoint saved.')`, 'saved checkpoint');
  await click('settings-close'); await settle();
}
async function record(label, extra = {}) {
  const { vfxBitmap, ...measured } = await client.evaluate(`(()=>{
    const engine=JSON.parse(document.querySelector('${tid('vfx-probe')}').textContent),audio=JSON.parse(document.querySelector('${tid('audio-probe')}').textContent);
    const c=document.querySelector('${tid('reader-vfx-canvas')}');let pixels=null;
    if(c){const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let painted=0,alpha=0;for(let i=3;i<p.length;i+=4){painted+=Number(p[i]>0);alpha+=p[i];}pixels={painted,alpha,width:c.width,height:c.height};}
    return{engine,audio,state:{...document.querySelector('${tid('runner-state')}').dataset},interface:document.querySelector('${tid('interface')}').dataset.interface,
      canvas:c?{data:{...c.dataset},pixels}:null,vfxBitmap:c?c.toDataURL('image/png'):null,visibleCues:Array.from(document.querySelectorAll('${tid('reader-vfx-cue')}')).map(e=>({...e.dataset})),
      portraitCanvases:Array.from(document.querySelectorAll('.visual-stage canvas')).filter(e=>e.dataset.renderedWhos).map(e=>({data:{...e.dataset},draws:e.__vfxDraws??[]}))};})()`);
  assert.equal(measured.interface, 'reader');
  if (vfxBitmap) {
    const path = join(resultDir, label + '-vfx-layer.png');
    await writeFile(path, Buffer.from(vfxBitmap.split(',')[1], 'base64'));
    measured.canvas.bitmapPath = path; screenshots.push(path);
  }
  const m = { label, ...measured, ...extra };
  measurements.push(m); console.log('Measured ' + label); return m;
}
async function arm(label) { await client.evaluate(`window.__vfxWatch.arm(${JSON.stringify(label)})`); }
async function watch() { return client.evaluate('window.__vfxWatch.capture()'); }
async function installWatch() {
  await until('!!window.spine?.SceneRenderer', 'local Spine runtime');
  await client.evaluate(`(()=>{
    const w={label:null,frames:[],draws:[],seen:new Set(),arm(label){this.label=label;this.frames=[];this.draws=[];this.seen.clear();},capture(){return{label:this.label,frames:this.frames,draws:this.draws};}};window.__vfxWatch=w;
    const originalDraw=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(image){
      const result=originalDraw.apply(this,arguments);
      if(w.label&&this.canvas.dataset.testid==='reader-vfx-canvas'&&image.src){
        const p=JSON.parse(document.querySelector('${tid('vfx-probe')}').textContent),key=p.runId+':'+p.nid+':'+image.src;
        if(!w.seen.has(key)){w.seen.add(key);w.draws.push({at:performance.now(),source:new URL(image.src).pathname,script:p.scriptId,nid:p.nid,active:p.effects.active.map(e=>({id:e.id,name:e.name,startedAtMs:e.startedAtMs}))});}
      }return result;
    };
    const proto=spine.SceneRenderer.prototype,begin=proto.begin,draw=proto.drawSkeleton;
    proto.begin=function(){this.canvas.__vfxDraws=[];return begin.apply(this,arguments);};
    proto.drawSkeleton=function(s){this.canvas.__vfxDraws.push({root:[s.x,s.y],scale:[s.scaleX,s.scaleY],color:{r:s.color.r,g:s.color.g,b:s.color.b,a:s.color.a},time:s.time});return draw.apply(this,arguments);};
    const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
    const sample=()=>{
      if(w.label&&w.frames.length<600){const p=JSON.parse(document.querySelector('${tid('vfx-probe')}').textContent),player=document.querySelector('${tid('runner-state')}');
        w.frames.push({at:performance.now(),clockMs:p.clockMs,script:p.scriptId,nid:p.nid,effects:p.effects.active.map(e=>({id:e.id,name:e.name,target:e.target,who:e.who,offset:e.offset,elapsed:e.elapsedMs})),characters:p.characters,
          player:{rect:rect(player),width:player.clientWidth,transform:getComputedStyle(player).transform},background:rect(document.querySelector('${tid('background-layer')}')),dialogue:rect(document.querySelector('.dialogue-box')),
          portraits:Array.from(document.querySelectorAll('.visual-stage canvas')).filter(e=>e.dataset.renderedWhos).map(e=>({whos:e.dataset.renderedWhos.split(','),draws:e.__vfxDraws??[],rect:rect(e)}))});}
      requestAnimationFrame(sample);
    };requestAnimationFrame(sample);
  })()`);
}
const activeNamed = (p, name) => p.effects.active.find(effect => effect.name.includes(name));

try {
  await mkdir(resultDir, { recursive:true }); await readFile(join(dist, 'index.html'));
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      const filename = resolve(dist, '.' + (extname(pathname) ? pathname : '/index.html'));
      if (!filename.startsWith(dist + sep)) throw new Error('Invalid path');
      res.writeHead(200, { 'Content-Type':mime[extname(filename)] ?? 'application/octet-stream', 'Cache-Control':'no-store' }); res.end(await readFile(filename));
    } catch { res.writeHead(404); res.end('Missing local fixture'); }
  });
  if (server) await new Promise((r,reject) => { server.once('error',reject); server.listen(0, '127.0.0.1', r); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = spawn(process.env.CHROMIUM_BIN ?? '/usr/bin/chromium', ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader',`--user-data-dir=${profile}`,'--remote-debugging-pipe','about:blank'], { stdio:['ignore','ignore','ignore','pipe','pipe'] });
  client = new CDP(browser.stdio[3], browser.stdio[4]);
  const target = await client.send('Target.createTarget', { url:'about:blank' });
  client.sessionId = (await client.send('Target.attachToTarget', { targetId:target.targetId, flatten:true })).sessionId;
  for (const domain of ['Page','Runtime','Network']) await client.send(domain + '.enable');
  await client.send('Emulation.setDeviceMetricsOverride', { width:1600,height:900,deviceScaleFactor:1,mobile:false });
  await client.send('Page.navigate', { url:origin + '/?vfxProbe=1&audioProbe=1' });
  await until(`!document.querySelector('${tid('reader-loading')}')&&!!document.querySelector('${tid('start')}')&&!document.querySelector('${tid('start')}').disabled`, 'entry with preloaded source sprites');
  await click('settings'); if (!await client.evaluate(`document.querySelector('${tid('instant-text')}').checked`)) await click('instant-text'); await click('settings-close');
  await click('start'); await until(`document.querySelector('${tid('runner-state')}').dataset.scriptId==='1001'&&document.querySelector('${tid('runner-state')}').dataset.status==='dialogue'`, 'known New playthrough baseline');
  await sourceScene('1006'); await advanceTo(14);
  await installWatch();
  await arm('1006/15 authored order'); await step();
  await until(`document.querySelector('${tid('runner-state')}').dataset.nid==='15'`, 'Butterfly node');
  const first = await record('1006-15-butterfly-first');
  assert.deepEqual(first.engine.effects.active.map(e=>e.name), ['UiItem_FxStart_Butterfly']);
  assert.ok(first.canvas?.pixels.painted > 10); await screenshot('1006-15-butterfly-first');
  await until(`JSON.parse(document.querySelector('${tid('vfx-probe')}').textContent).effects.active.length===2`, 'Huaban +200 ms');
  await delay(190); const both = await record('1006-15-butterfly-and-huaban', { observed:await watch() });
  assert.deepEqual(both.engine.effects.active.map(e=>e.name), ['UiItem_FxStart_Butterfly','UiItem_FxStart_Huaban']);
  assert.equal(both.engine.effects.active[1].startedAtMs - both.engine.effects.active[0].startedAtMs, 200);
  assert.ok(both.canvas?.pixels.painted > first.canvas.pixels.painted);
  const butterflyDraw = both.observed.draws.find(d=>d.source.endsWith('/T_UI_Wenli_X140011.png'));
  const huabanDraw = both.observed.draws.find(d=>d.source.endsWith('/T_UI_Sub_21042.png'));
  assert.ok(butterflyDraw && huabanDraw && butterflyDraw.at < huabanDraw.at, 'actual texture draws preserve visible cue order');
  assert.ok(huabanDraw.at-butterflyDraw.at >= 150 && huabanDraw.at-butterflyDraw.at < 650, 'visible delay follows authored200ms on the real clock');
  await screenshot('1006-15-butterfly-and-huaban'); checks.push('1006/15 exact200ms cue order and actual Butterfly/Huaban texture draws');
  await delay(2300); const completed = await record('1006-15-completed-bursts'); assert.equal(completed.engine.effects.active.length, 0);
  await checkpoint('save'); await step(); await checkpoint('restore'); await delay(400);
  const burstRestore = await record('1006-15-checkpoint-no-burst-replay'); assert.equal(burstRestore.engine.nid,15); assert.equal(burstRestore.engine.effects.active.length,0); assert.equal(burstRestore.engine.cues.length,0);
  await screenshot('1006-15-checkpoint-no-burst-replay'); checks.push('Completed bursts do not replay after a normal Settings checkpoint restore');

  await sourceScene('1002'); await advanceTo(5); await startClip('1002-6-screen-shake'); await arm('1002/6 screen Shake'); await step(); await delay(100);
  const screenShake = await record('1002-6-screen-shake', { observed:await watch() });
  const custom = activeNamed(screenShake.engine,'Shake'); assert.ok(custom); assert.equal(custom.target,'screen'); assert.equal(custom.customType,'Shake'); assert.deepEqual(custom.event.operation.effectConfig,{ Type:'Custom',CustomType:'Shake' });
  assert.ok(screenShake.engine.effects.screenOffset.some(v=>Math.abs(v)>.01));
  assert.ok(screenShake.engine.characters.every(c=>c.position.every((v,i)=>v===c.sourcePosition[i])));
  assert.ok(screenShake.observed.frames.some(f=>f.player.transform!=='none'));
  await screenshot('1002-6-screen-shake');
  await delay(260); const screenFrames = (await watch()).frames.filter(f=>f.nid===6);
  const matrix = f => f.player.transform==='none' ? [0,0] : f.player.transform.slice(7,-1).split(',').map(Number).slice(4,6);
  const baseFrame = screenFrames.find(f=>matrix(f).every(v=>Math.abs(v)<.01)), movedFrame = screenFrames.find(f=>matrix(f).some(v=>Math.abs(v)>.1));
  assert.ok(baseFrame && movedFrame, 'Observe both a translated screen and its settled frame');
  for (const frame of screenFrames) {
    assert.equal(frame.player.width, baseFrame.player.width, 'Shake must not create a scrollbar or resize the Reader');
    const m=matrix(frame); for (const item of ['background','dialogue']) {
      assert.ok(baseFrame[item] && frame[item], `Observe ${item} throughout the screen Shake`);
      // Transformed DOMRects can differ by a floating-point subpixel while
      // clientWidth above still proves the layout itself has not resized.
      assert.ok(Math.abs(frame[item].width-baseFrame[item].width)<.01, `${item} width stays fixed during Shake`);
      assert.ok(Math.abs(frame[item].height-baseFrame[item].height)<.01, `${item} height stays fixed during Shake`);
      assert.ok(Math.abs((frame[item].x-baseFrame[item].x)-m[0])<1, `${item} follows the screen's horizontal translation`);
      assert.ok(Math.abs((frame[item].y-baseFrame[item].y)-m[1])<1, `${item} follows the screen's vertical translation`);
    }
  }
  measurements.push({ label:'1002-6-screen-frame-motion',frames:screenFrames });
  await delay(450); assert.deepEqual((await vfx()).effects.screenOffset,[0,0]); await finishClip(); checks.push('1002/6 Custom Shake transforms screen and dialogue together, keeps logical portrait positions, then settles');

  await sourceScene('1001'); await advanceTo(9); await startClip('1001-10-abby-portrait-shake'); await arm('1001/10 Abby portrait Shake'); await step();
  const portraitBefore = await record('1001-10-before-portrait-shake'); assert.equal(portraitBefore.engine.effects.active.some(e=>e.target==='portrait'),false);
  const pendingShake = portraitBefore.engine.pendingStage.find(task=>task.operation.op==='portraitFx'&&task.operation.who==='1316');
  const arrival = portraitBefore.engine.moves.find(event=>event.nid===10&&event.operation.who==='1316');
  assert.ok(pendingShake && arrival, 'Observe the pending authored Shake and the delivered arrival before the deadline');
  assert.equal(pendingShake.phase,'start'); assert.equal(pendingShake.operation.t,.3);
  assert.equal(arrival.operation.t,0); assert.equal(arrival.operation.dur,.3);
  assert.equal(pendingShake.phaseStartedAtMs,arrival.timing.phaseStartedAtMs);
  assert.equal(pendingShake.dueAtMs,arrival.timing.dueAtMs+300, 'Shake is relative to the start-performance phase, alongside the arrival');
  assert.ok(portraitBefore.engine.clockMs<pendingShake.dueAtMs, 'The real Reader has not reached the authored deadline');
  await until(`JSON.parse(document.querySelector('${tid('vfx-probe')}').textContent).effects.active.some(e=>e.target==='portrait')`, 'Abby Shake at +300ms');
  await delay(90); const portrait = await record('1001-10-abby-portrait-shake', { observed:await watch() });
  const abbyFx=portrait.engine.effects.active.find(e=>e.target==='portrait'); assert.equal(abbyFx.who,'1316'); assert.equal(abbyFx.event.operation.t,.3); assert.equal(abbyFx.event.operation.amp,'Medium');
  assert.equal(abbyFx.event.timing.dueAtMs-abbyFx.event.timing.phaseStartedAtMs,300);
  assert.equal(abbyFx.startedAtMs,pendingShake.dueAtMs);
  assert.equal(abbyFx.event.timing.delivery,'scheduled');
  const portraitFrames=portrait.observed.frames.filter(f=>f.nid===10);
  const firstShakeFrame=portraitFrames.find(f=>f.effects.some(e=>e.target==='portrait'));
  assert.ok(firstShakeFrame && firstShakeFrame.at>=pendingShake.dueAtMs && firstShakeFrame.at<pendingShake.dueAtMs+250, 'Observed activation follows the real phase clock');
  assert.ok(portraitFrames.some(f=>f.at<pendingShake.dueAtMs), 'Capture frames before the authored delay');
  assert.ok(portraitFrames.filter(f=>f.at<pendingShake.dueAtMs).every(f=>!f.effects.some(e=>e.target==='portrait')), 'No portrait Shake appears before +300 ms');
  assert.ok(portrait.engine.characters.filter(c=>c.who!=='1316').every(c=>c.position.every((v,i)=>v===c.sourcePosition[i])), 'All other actors retain their positions');
  assert.deepEqual(portrait.engine.effects.screenOffset,[0,0]); const abby=portrait.engine.characters.find(c=>c.who==='1316'); assert.ok(abby.position.some((v,i)=>v!==abby.sourcePosition[i])); assert.equal(abby.opacity,1); assert.equal(abby.brightness,1);
  assert.ok(portrait.portraitCanvases.some(c=>c.data.renderedWhos?.split(',').includes('1316')&&c.draws.length));
  assert.ok(portrait.observed.frames.filter(f=>f.nid===10).every(f=>f.player.transform==='none'));
  await screenshot('1001-10-abby-portrait-shake'); await delay(550);
  assert.ok((await vfx()).characters.every(c=>c.position.every((v,i)=>v===c.sourcePosition[i]))); await finishClip(); checks.push('1001/10 Abby-only portrait Shake at +300ms preserves brightness/alpha and stable screen');

  await sourceScene('11007'); await advanceTo(103); const sunStart=await record('11007-103-sunglow-start'); const sun=activeNamed(sunStart.engine,'SunGlow'); assert.ok(sun?.persistent); assert.ok(sunStart.canvas?.pixels.painted>100);
  await screenshot('11007-103-sunglow-start'); await checkpoint('save');
  for(const nid of [104,105,106,107]){await step();await advanceTo(nid);const m=await record('11007-'+nid+'-sunglow-persists');assert.equal(activeNamed(m.engine,'SunGlow')?.id,sun.id);}
  await screenshot('11007-107-sunglow-persists'); await step(); await advanceTo(108);
  const sunStop=await record('11007-108-sunglow-stopped'); assert.equal(activeNamed(sunStop.engine,'SunGlow'),undefined); assert.ok(sunStop.engine.cues.some(e=>e.operation.op==='stopScreenFx'&&e.nid===108&&e.operation.path===sun.path)); await screenshot('11007-108-sunglow-stopped');
  await checkpoint('restore'); const restored=await record('11007-103-sunglow-checkpoint-restored'); assert.equal(restored.engine.nid,103); assert.equal(activeNamed(restored.engine,'SunGlow')?.id,sun.id); assert.equal(restored.engine.cues.length,0); assert.ok(restored.canvas?.pixels.painted>100); await screenshot('11007-103-sunglow-checkpoint-restored');
  await advanceTo(108); assert.equal(activeNamed(await vfx(),'SunGlow'),undefined); checks.push('11007/103–108 persistent SunGlow survives dialogue advances, restores through Settings, and obeys exact authored stop both times');

  // Early normal advance consumes a not-yet-due portrait burst.
  await sourceScene('1001'); await advanceTo(9); await arm('normal advance consumes pending portrait burst'); await step(); await step();
  await advanceTo(11); const skipped=await record('1001-11-fast-advance-no-portrait-leak',{observed:await watch()}); assert.equal(skipped.engine.effects.active.some(e=>e.target==='portrait'),false); const consumed=skipped.engine.cues.find(e=>e.nid===10&&e.operation.op==='portraitFx'); assert.equal(consumed?.timing.delivery,'advance');
  checks.push('Early ordinary advance consumes +300ms portrait burst and leaves next line clean');
  // Existing debug setting configures the engine; all subsequent playback
  // still uses ordinary Reader controls and the same stage/renderers.
  await sourceScene('1006'); await advanceTo(14); await click('menu'); await click('switch-view');
  await click('instant-transitions'); await click('switch-view'); await step();
  const fast=await record('1006-15-instant-fast-forward'); assert.equal(fast.engine.effects.active.length,0); assert.ok(fast.engine.cues.filter(e=>e.nid===15&&e.operation.op==='screenFx').every(e=>e.timing.delivery==='instant')); await screenshot('1006-15-instant-fast-forward');
  await click('menu'); await click('switch-view'); await click('instant-transitions'); await click('switch-view'); checks.push('Configured instant playback consumes Butterfly/Huaban, does not replay completed bursts');
  await sourceScene('1002'); const next=await record('1002-new-stage-clean'); assert.equal(next.engine.effects.active.length,0); await screenshot('1002-new-stage-clean'); checks.push('Entering a new source stage clears persistent/transient effect state');

  assert.deepEqual(errors,[]);
} catch(error) {
  failure=error.stack??String(error); try{measurements.push({label:'failure',state:await state(),engine:await vfx(),audio:await audio(),observed:await watch()});}catch{}
  try{await screenshot('failure');}catch{}
} finally {
  if(client)try{await client.send('Browser.close');}catch{}
  if(browser&&browser.exitCode===null){browser.kill('SIGTERM');await Promise.race([new Promise(r=>browser.once('exit',r)),delay(1500)]);if(browser.exitCode===null)browser.kill('SIGKILL');}
  if(server)await new Promise(r=>server.close(r)); await rm(profile,{recursive:true,force:true});
  const index=await readFile(join(dist,'index.html')); const report={passed:!failure,failure,checks,errors,measurements,screenshots,clips,navigation,productionIndexSha256:createHash('sha256').update(index).digest('hex'),
    delivery:'localhost HTTP server',
    scope:'Production Reader gestures after source selection through the existing Developer UI, preserving an authored New playthrough baseline. Settings handles checkpoint save/restore. No synthetic VFX, actor injection, hidden-choice override, renderer motion override, or clock manipulation. Native particle/material/sequence equivalence remains unverified.'};
  await writeFile(join(resultDir,'production-browser-result.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,checks:checks.length,measurements:measurements.length,report:join(resultDir,'production-browser-result.json'),failure}));if(failure)process.exitCode=1;
}
