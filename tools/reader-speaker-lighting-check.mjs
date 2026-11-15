/** Production Reader lighting check. Drives ordinary UI controls; image bytes
 * and complete source dialogue remain in local evidence files. */
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
const resultDir = process.env.READER_RESULT_DIR ? resolve(process.env.READER_RESULT_DIR) : join(root, 'test-results/reader-speaker-lighting');
const profile = await mkdtemp(join(tmpdir(), 'reader-speaker-lighting-'));
const screenshots = [], measurements = [], navigation = [], errors = [], checks = [], boundaries = [];
let browser, client, server, origin, failure;
const tid = id => `[data-testid="${id}"]`;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm', '.opus': 'audio/ogg', '.wav': 'audio/wav' };

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
    } else if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    } else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
      errors.push(`HTTP ${message.params.response.status}: ${new URL(message.params.response.url).pathname}`);
    }
  }
  send(method, params = {}) {
    return new Promise((resolveResult, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15_000);
      this.pending.set(id, { resolve: resolveResult, reject, timer });
      this.input.write(JSON.stringify({ id, method, params, sessionId: method.startsWith('Target.') ? undefined : this.sessionId }) + '\0');
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
}

async function until(expression, label, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  do { if (await client.evaluate(expression)) return; await delay(45); } while (Date.now() < deadline);
  throw new Error('Timed out: ' + label);
}
const settle = () => client.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const state = () => client.evaluate(`({...document.querySelector('${tid('runner-state')}').dataset})`);
const model = () => client.evaluate('window.__lightingProbe.model()');
async function clickSelector(selector) {
  await until(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e&&!e.disabled&&e.getClientRects().length>0;})()`, selector);
  await client.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`);
  await settle();
  const point = await client.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  await settle();
}
const click = id => clickSelector(tid(id));
async function select(id, value) {
  await client.evaluate(`(()=>{const e=document.querySelector('${tid(id)}');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await settle();
}
async function screenshot(name) {
  await settle();
  const r = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const path = join(resultDir, name + '.png');
  await writeFile(path, Buffer.from(r.data, 'base64')); screenshots.push(path);
}
async function dismissNotices() {
  for (let i = 0; i < 12; i++) {
    const selector = await client.evaluate(`['relationship-confirm','letter-confirm','role-intro-confirm'].map(id=>'[data-testid="'+id+'"]').find(s=>document.querySelector(s)?.getClientRects().length)||null`);
    if (!selector) return;
    await clickSelector(selector);
  }
}
async function dialogueStep() {
  await until(`(()=>{const s=document.querySelector('${tid('runner-state')}');return ['dialogue','choices'].includes(s.dataset.status)&&s.dataset.textComplete==='true'&&s.dataset.inputReady==='true';})()`, 'Reader dialogue input ready');
  const before = await state();
  const choices = await client.evaluate(`Array.from(document.querySelectorAll('${tid('choice')}')).filter(e=>!e.disabled&&e.getClientRects().length).map(e=>e.dataset.optionId)`);
  if (before.status === 'choices' && before.hiddenChoice !== 'true') {
    assert.ok(choices.length, 'Normal Reader must have an eligible visible response.');
    await clickSelector(`${tid('choice')}:not(:disabled)`);
  } else await click('advance');
  navigation.push({ before, choices, after: await state() });
}
async function advanceTo(nid) {
  for (let i = 0; i < 240; i++) {
    await dismissNotices();
    const current = await state();
    if (current.scriptId === '1008' && current.nid === String(nid)) { await delay(600); await settle(); return; }
    assert.equal(current.scriptId, '1008', 'Central Square remains the active scene.');
    await dialogueStep();
  }
  throw new Error('Did not reach node ' + nid);
}

async function installProbe() {
  await until('!!window.spine?.SceneRenderer', 'local Spine runtime');
  await client.evaluate(`(()=>{
    const renderers=new Map(); const proto=spine.SceneRenderer.prototype;
    const canvasIds=new WeakMap();let nextCanvas=0;
    const canvasId=c=>{if(!canvasIds.has(c))canvasIds.set(c,++nextCanvas);return canvasIds.get(c);};
    const e=document.querySelector('[data-testid="runner-state"]');
    let fiber=e[Object.keys(e).find(k=>k.startsWith('__reactFiber$'))],owner;
    while(fiber){if(fiber.memoizedProps?.runner?.getSnapshot){owner=fiber.memoizedProps;break;}fiber=fiber.return;}
    if(!owner)throw new Error('Cannot locate passive Reader state probe');
    const runner=owner.runner,journey=owner.journey,events=[];
    runner.onEvent(e=>{if(['choiceSelected','checkpointRestored','completed'].includes(e.type)||e.type==='stage'&&['enter','exit','modify','move'].includes(e.operation.op))events.push({type:e.type,script:e.scriptId,node:e.nid,visit:e.visitId,sequence:e.sequence,mode:e.mode,option:e.optionIndex,operation:e.operation});});
    const model=()=>{
      const s=runner.getSnapshot(),j=journey?.getSnapshot();
      return{script:s.scriptId,node:s.nid,run:s.runId,scene:s.sceneId,visit:s.visitId,status:s.status,speaker:s.dialogue?.speakerId,
        actors:s.presentation.characters.map(v=>({who:v.character.who,sourceScript:v.character.lastEvent.scriptId,present:v.character.present,effect:v.character.effect,brightness:v.brightness,opacity:v.portraitOpacity})),
        transitions:s.presentation.transitions.map(t=>({target:t.target,property:t.property,startedAtMs:t.startedAtMs,durationMs:t.durationMs})),pending:s.pendingStage.length,stageEventCount:s.stageEvents.length,
        choiceHistory:s.choiceHistory,events:events.slice(),
        journey:j?{phase:j.phase,day:j.dayIndex,slot:j.timeSlot,options:j.options.map(o=>({id:o.id,kind:o.kind,condition:o.condition.value})),sceneCount:j.sceneCount}:null,
        canvases:Array.from(document.querySelectorAll('.visual-stage canvas')).map(c=>({id:canvasId(c),testid:c.dataset.testid,rendered:c.dataset.renderedWhos?.split(',').filter(Boolean)??[]}))};
    };
    const begin=proto.begin,draw=proto.drawSkeleton,end=proto.end;
    proto.begin=function(){this.__lightingDraws=[];return begin.apply(this,arguments);};
    proto.drawSkeleton=function(s,pma){this.__lightingDraws.push({color:{r:s.color.r,g:s.color.g,b:s.color.b,a:s.color.a},root:[s.x,s.y],scale:[s.scaleX,s.scaleY],pma});return draw.apply(this,arguments);};
    proto.end=function(){
      const drew=!!this.activeRenderer&&this.__lightingDraws?.length;
      const result=end.apply(this,arguments);renderers.set(this.canvas,this);
      if(drew&&this.__lightingRequest){
        const request=this.__lightingRequest;this.__lightingRequest=null;
        const gl=this.context.gl,w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,pixels=new Uint8Array(w*h*4);
        gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        const sum=[0,0,0],maximum=[0,0,0];let opaque=0,painted=0;
        for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]>8)painted++;if(pixels[i+3]>=250){opaque++;for(let c=0;c<3;c++){sum[c]+=pixels[i+c];maximum[c]=Math.max(maximum[c],pixels[i+c]);}}}
        const cr=this.canvas.getBoundingClientRect();
        request({id:canvasId(this.canvas),testid:this.canvas.dataset.testid,whos:this.canvas.dataset.renderedWhos?.split(',')??[],draws:this.__lightingDraws,css:{opacity:getComputedStyle(this.canvas).opacity,filter:getComputedStyle(this.canvas).filter},canvas:[w,h],rect:{x:cr.x,y:cr.y,width:cr.width,height:cr.height},pixels:{painted,opaque,opaqueFraction:painted?opaque/painted:0,meanRGB:sum.map(v=>opaque?v/opaque:0),maximumRGB:maximum,glError:gl.getError()}});
      }return result;
    };
    window.__lightingProbe={model,rememberStage(){this.outgoing=Array.from(document.querySelectorAll('.visual-stage canvas')).filter(c=>c.dataset.renderedWhos);return this.outgoing.map(canvasId);},outgoingRemoved(){return this.outgoing.every(c=>!c.isConnected);},sample(){return Promise.all(Array.from(renderers.entries()).filter(([c])=>c.isConnected&&!!c.closest('.visual-stage')&&c.dataset.renderedWhos).map(([c,r])=>new Promise(resolve=>r.__lightingRequest=resolve)));}};
  })()`);
}

async function measure(label, expected) {
  await until(`Object.keys(${JSON.stringify(expected)}).every(w=>Array.from(document.querySelectorAll('.visual-stage canvas')).some(c=>c.dataset.renderedWhos?.split(',').includes(w)))`, label + ' actors');
  await delay(500);
  const rendered = await client.evaluate('window.__lightingProbe.sample()');
  const s = await state();
  const measurement = { label, state: s, expected, rendered,
    model: await model(),
    dialogue: await client.evaluate(`document.querySelector('[data-testid="dialogue-text"]')?.textContent??document.querySelector('.dialogue-text')?.textContent??''`),
    interface: await client.evaluate(`document.querySelector('${tid('interface')}').dataset.interface`) };
  measurements.push(measurement);
  assert.equal(measurement.interface, 'reader');
  for (const [who, target] of Object.entries(expected)) {
    const canvas = rendered.find(c => c.whos.includes(who)); assert.ok(canvas, 'Rendered actor ' + who);
    const actor = canvas.draws[canvas.whos.indexOf(who)]; assert.ok(actor, 'Submitted Spine draw ' + who);
    assert.deepEqual([actor.color.r, actor.color.g, actor.color.b], [target, target, target], label + ' RGB ' + who);
    assert.equal(actor.color.a, 1, label + ' alpha ' + who);
    assert.ok(canvas.pixels.opaque > 100, label + ' has painted opaque pixels ' + who);
    assert.ok(canvas.pixels.maximumRGB.every(v => v <= Math.ceil(255 * target) + 2), label + ' framebuffer reflects dimming ' + who);
    assert.equal(canvas.pixels.glError, 0);
  }
  await screenshot(label + '-muted'); checks.push(label); console.log('Verified ' + label);
}

async function checkpoint(action) {
  await click('settings'); await click(action + '-checkpoint');
  if (action === 'save') await until(`document.querySelector('dialog[open]')?.textContent.includes('Checkpoint saved.')`, 'saved checkpoint');
  await click('settings-close');
}

async function routeToSquare() {
  let wentOut = false;
  const measured = new Set();
  // Narration 5 explicitly highlights Abby and darkens Chisa; line 6 then
  // refreshes focus to Chisa even though its RoleConfig omits a color cue.
  const paired = {3:[1,.58],4:[.58,1],5:[.58,1],6:[1,.58]};
  for (let i = 0; i < 300; i++) {
    await dismissNotices();
    const current = await state(), p = await model();
    assert.notEqual(current.status, 'error', 'Opening route remains playable.');
    if (current.scriptId === '1008' && current.nid === '1') {
      assert.ok(p.actors.every(a=>a.sourceScript==='1008'&&a.opacity===0), 'Central Square retains only its own authored hidden actors.');
      assert.ok(p.actors.every(a=>a.brightness===.58), 'Narration has no inherited highlighted street speaker.');
      assert.equal(p.canvases.flatMap(c=>c.rendered).length, 0);
      assert.ok(wentOut, 'Central Square is reached through the actual Go out route.');
      for (const key of ['1004-3','1004-4','1004-5','1004-6','1006-9','1006-10']) assert.ok(measured.has(key), 'The opening route verifies ' + key);
      boundaries.push({label:'central-square-entry',model:p}); await screenshot('central-square-entry-muted');
      return;
    }
    if (current.scriptId === '1004' && paired[current.nid] && !measured.has('1004-' + current.nid)) {
      const [chisa,abby] = paired[current.nid];
      await measure('1004-' + current.nid, {'50179':chisa,'1316':abby}); measured.add('1004-' + current.nid);
      if (current.nid === '5') {
        const cues = (await model()).events.filter(e=>e.script==='1004'&&e.node===5&&e.operation?.op==='modify');
        assert.ok(cues.some(e=>e.operation.who==='1316'&&e.operation.effect==='Highlight'));
        assert.ok(cues.some(e=>e.operation.who==='50179'&&e.operation.effect==='Darken'));
        checks.push('1004/5 narration obeys explicit Abby Highlight and Chisa Darken before line 6 refreshes speaker focus');
      }
    }
    if (current.scriptId === '1006' && ['6','9','10'].includes(current.nid) && !measured.has('1006-' + current.nid)) {
      await measure('1006-' + current.nid + '-alias', {'1398':current.nid === '10' ? .58 : 1}); measured.add('1006-' + current.nid);
      assert.ok((await model()).actors.every(a=>a.sourceScript==='1006'), 'Street actors come from the current scene.');
    }
    if (['dialogue','choices'].includes(current.status)) { await dialogueStep(); continue; }
    const explore = await client.evaluate(`Array.from(document.querySelectorAll('[data-testid="reader-actions"] [data-journey-option^="explore:"]')).find(e=>!e.disabled&&e.getClientRects().length)?.dataset.journeyOption??null`);
    if (explore && !wentOut) {
      assert.equal(p.journey.day, 2); assert.equal(p.journey.slot, 1);
      assert.ok(p.canvases.some(c=>c.rendered.includes('1316')), 'The departing interior still renders Abby.');
      const outgoing = {label:'go-out-interior',model:p,canvasIds:await client.evaluate('window.__lightingProbe.rememberStage()')};
      boundaries.push(outgoing); await screenshot('go-out-interior-muted');
      await clickSelector(`[data-testid="reader-actions"] [data-journey-option="${explore}"]`); wentOut = true;
      await until(`document.querySelector('${tid('runner-state')}').dataset.scriptId==='1006'&&document.querySelector('${tid('runner-state')}').dataset.nid==='1'`, 'Go out enters the street');
      await delay(200); await settle();
      const incoming = await model();
      assert.deepEqual(incoming.actors.map(a=>a.who), ['750088'], 'Street narration enters only its authored hidden Rover.');
      assert.ok(incoming.actors.every(a=>a.sourceScript==='1006'&&a.opacity===0&&a.effect==='Darken'&&a.brightness===.58), 'Go out removes interior actors and applies only the new street cues.');
      assert.equal(incoming.canvases.flatMap(c=>c.rendered).length, 0, 'The street entry does not render the interior portraits.');
      assert.equal(await client.evaluate('window.__lightingProbe.outgoingRemoved()'), true, 'Outgoing canvas objects are disconnected.');
      assert.notEqual(incoming.scene, p.scene);
      boundaries.push({label:'go-out-street-entry',model:incoming,outgoingRemoved:true}); await screenshot('go-out-street-entry-muted');
      checks.push('Actual Go out removes the outgoing interior canvases and clears speaker/explicit-cue state');
      continue;
    }
    const central = await client.evaluate(`Array.from(document.querySelectorAll('[data-testid="reader-actions"] [data-journey-option="location:1015"]')).some(e=>!e.disabled&&e.getClientRects().length)`);
    if (central) { await clickSelector('[data-testid="reader-actions"] [data-journey-option="location:1015"]'); continue; }
    const continueJourney = await client.evaluate(`!!document.querySelector('${tid('journey-continue')}')&&!document.querySelector('${tid('journey-continue')}').disabled`);
    if (continueJourney) { await click('journey-continue'); continue; }
    await delay(80);
  }
  throw new Error('The uninterrupted opening route did not reach Central Square.');
}

try {
  await mkdir(resultDir, { recursive: true });
  await readFile(join(dist, 'index.html'));
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      const filename = resolve(dist, '.' + (extname(pathname) ? pathname : '/index.html'));
      if (!filename.startsWith(dist + sep)) throw new Error('Invalid path');
      const bytes = await readFile(filename);
      res.writeHead(200, { 'Content-Type': mime[extname(filename)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(bytes);
    } catch { res.writeHead(404); res.end('Missing local fixture'); }
  });
  if (server) await new Promise((r,reject) => { server.once('error',reject); server.listen(0, '127.0.0.1', r); });
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = spawn(process.env.CHROMIUM_BIN ?? '/usr/bin/chromium', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', `--user-data-dir=${profile}`, '--remote-debugging-pipe', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  client = new CDP(browser.stdio[3], browser.stdio[4]);
  const target = await client.send('Target.createTarget', { url: 'about:blank' });
  client.sessionId = (await client.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
  for (const domain of ['Page', 'Runtime', 'Network']) await client.send(domain + '.enable');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await client.send('Page.navigate', { url: origin + '/' });
  await until(`!document.querySelector('${tid('reader-loading')}')&&!!document.querySelector('${tid('start')}')&&!document.querySelector('${tid('start')}').disabled`, 'entry ready');
  await click('settings');
  await client.evaluate(`(()=>{const e=document.querySelector('${tid('volume-voice')}');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'0');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  if (!await client.evaluate(`document.querySelector('${tid('instant-text')}').checked`)) await click('instant-text');
  assert.equal(await client.evaluate(`document.querySelector('${tid('volume-voice')}').value`), '0');
  await screenshot('settings-voice-muted'); await click('settings-close');
  await click('start'); await until(`document.querySelector('${tid('runner-state')}').dataset.scriptId==='1001'&&['dialogue','choices'].includes(document.querySelector('${tid('runner-state')}').dataset.status)`, 'authored New playthrough');
  for (let i=0;(await state()).nid!=='8';i++) {
    assert.ok(i<20, 'Opening reaches Abby through normal playback.');
    assert.equal((await state()).scriptId,'1001'); await dialogueStep();
  }
  await installProbe();
  await routeToSquare();
  for (const [nid, left, right] of [[61,.58,1],[62,.58,.58],[63,1,.58],[64,1,.58],[65,1,.58],[66,.58,1]]) {
    await advanceTo(nid); await measure('1008-' + nid, { '50074': left, '150036': right });
    if (nid === 65) {
      const explicit = (await model()).events.find(e=>e.script==='1008'&&e.node===65&&e.operation?.who==='50074'&&e.operation?.effect==='Highlight');
      assert.ok(explicit, 'Narration delivers its authored Highlight before checkpoint capture.');
      await checkpoint('save');
    }
  }
  await checkpoint('restore');
  const restored = await model();
  assert.equal(restored.node,65); assert.equal(restored.stageEventCount,0); assert.deepEqual(restored.transitions,[]);
  await measure('1008-65-checkpoint-restored', { '50074':1, '150036':.58 });
  await dialogueStep(); await advanceTo(66); await measure('1008-66-after-restore', { '50074':.58, '150036':1 });
  checks.push('Settings checkpoint restores narration Highlight without replaying starts or color transitions, then speaker focus returns on the next line');
  await click('settings'); assert.equal(await client.evaluate(`document.querySelector('${tid('volume-voice')}').value`), '0'); await click('settings-close');
  assert.equal(errors.length, 0, errors.join('\n')); checks.push('Voice volume remained0 throughout all source scenes');
} catch (error) {
  failure = error.stack ?? String(error);
  try { await screenshot('failure'); } catch {}
} finally {
  if (client) try { await client.send('Browser.close'); } catch {}
  if (browser && browser.exitCode === null) browser.kill('SIGTERM');
  if (server) await new Promise(r => server.close(r));
  await rm(profile, { recursive: true, force: true });
  const result = { passed: !failure, failure, checks, errors, measurements, screenshots, navigation, boundaries,
    delivery:'localhost HTTP server',
    scope: 'Uninterrupted normal Reader progression from New playthrough through the opening, the actual Go out route, and Central Square with voice muted. Settings handles checkpoint save/restore. No source jump, stage/action injection, hidden-choice override, clock fast-forward, or renderer brightness override.' };
  await writeFile(join(resultDir, 'production-browser-result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ passed: result.passed, checks: checks.length, measurements: measurements.length, report: join(resultDir, 'production-browser-result.json'), failure }));
  if (failure) process.exitCode = 1;
}
