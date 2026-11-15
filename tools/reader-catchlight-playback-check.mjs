/** Record actual Reader eye pixels and iris-relative geometry during a steady
 * open-eye interval. UI navigation and the production renderer stay intact.
 * Run after npm run build: node tools/reader-catchlight-playback-check.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), dist = join(root, 'dist');
const resultDir = process.env.READER_RESULT_DIR ? resolve(process.env.READER_RESULT_DIR) : join(root, 'test-results/reader-catchlights/playback');
const profile = await mkdtemp(join(tmpdir(), 'reader-catchlights-'));
const resume = process.argv.includes('--resume');
const cases = [
  { name: 'abby-stage', character: 'Abby', script: '1001', nid: 10, composition: 'stage', who: '1316', expression: 700212, iris: '01_A_眼珠', catchlight: '01_A_高光', eye: 'dongzuo1_zhengchang_zhengyan', cycle: .20000001788139343 },
  { name: 'verina-stage', character: 'Verina', script: '1016', nid: 1, composition: 'stage', who: '968', expression: 700136, iris: 'A_03_眼珠', catchlight: 'A_03_高亮', eye: 'dongzuo1_zhengchang_zhengyan', cycle: 1.3333333730697632 },
  { name: 'abby-avatar', character: 'Abby', script: '1034', nid: 56, composition: 'avatar', who: '1316', expression: 700212, iris: '01_A_眼珠', catchlight: '01_A_高光', eye: 'dongzuo1_zhengchang_zhengyan', cycle: .20000001788139343, durationSeconds: 3.2 },
];
const measurements = [], navigation = [], errors = [];
let browser, client, server, origin, failure;
const tid = id => `[data-testid="${id}"]`;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.opus': 'audio/ogg', '.wav': 'audio/wav' };

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
    const broken = error => { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); } this.pending.clear(); };
    input.on('error', broken); output.on('error', broken);
  }
  receive(message) {
    if (message.id) {
      const item = this.pending.get(message.id); if (!item) return;
      this.pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) errors.push(`HTTP ${message.params.response.status}: ${new URL(message.params.response.url).pathname}`);
  }
  send(method, params = {}) {
    return new Promise((resolveResult, reject) => {
      const id = ++this.next, timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 20_000);
      this.pending.set(id, { resolve: resolveResult, reject, timer });
      this.input.write(JSON.stringify({ id, method, params, sessionId: method.startsWith('Target.') ? undefined : this.sessionId }) + '\0');
    });
  }
  async evaluate(expression) {
    const value = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
    return value.result.value;
  }
}

async function until(expression, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  do { if (await client.evaluate(expression)) return; await delay(50); } while (Date.now() < deadline);
  throw new Error('Timed out: ' + label);
}
const settle = () => client.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const state = () => client.evaluate(`({...document.querySelector('${tid('runner-state')}').dataset})`);
async function clickSelector(selector) {
  await until(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e&&!e.disabled&&e.getClientRects().length;})()`, selector);
  await client.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`);
  await settle();
  const point = await client.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  await settle();
}
const click = id => clickSelector(tid(id));
async function dismissNotices() {
  for (let index = 0; index < 12; index++) {
    const selector = await client.evaluate(`['relationship-confirm','letter-confirm','role-intro-confirm'].map(id=>'[data-testid="'+id+'"]').find(s=>document.querySelector(s)?.getClientRects().length)||null`);
    if (!selector) return; await clickSelector(selector);
  }
}
async function advanceTo(target) {
  for (let index = 0; index < 160; index++) {
    await dismissNotices();
    await until(`(()=>{const s=document.querySelector('${tid('runner-state')}');return ['dialogue','choices'].includes(s.dataset.status)&&s.dataset.textComplete==='true'&&s.dataset.inputReady==='true';})()`, 'dialogue input');
    const before = await state(); assert.equal(before.scriptId, target.script);
    if (before.nid === String(target.nid)) return;
    const choices = await client.evaluate(`Array.from(document.querySelectorAll('${tid('choice')}')).filter(e=>!e.disabled&&e.getClientRects().length).map(e=>e.dataset.optionId)`);
    if (before.status === 'choices' && before.hiddenChoice !== 'true') {
      assert.ok(choices.length, 'An authored eligible choice is available.');
      await clickSelector(`${tid('choice')}:not(:disabled)`);
    } else await click('advance');
    navigation.push({ before, choices, after: await state() });
  }
  throw new Error('Did not reach ' + target.script + '/' + target.nid);
}
async function openStory(script) {
  // Full playthrough's Handbook opens the school year. Use the existing
  // source scene selector, then return to Reader for all rendering/advances.
  await dismissNotices(); await click('menu'); await click('switch-view');
  await until(`document.querySelector('${tid('interface')}').dataset.interface==='developer'&&!!document.querySelector('${tid('script-select')}')`, 'source scene selector');
  await client.evaluate(`(()=>{const e=document.querySelector('${tid('script-select')}');e.value=${JSON.stringify(script)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await settle(); await click('continue-script');
  await until(`document.querySelector('${tid('runner-state')}').dataset.scriptId===${JSON.stringify(script)}&&['dialogue','choices'].includes(document.querySelector('${tid('runner-state')}').dataset.status)`, 'story ' + script);
  await click('switch-view');
  await until(`document.querySelector('${tid('interface')}').dataset.interface==='reader'`, 'normal Reader');
}

async function installProbe() {
  await until('!!window.spine?.SceneRenderer', 'local Spine runtime');
  await client.evaluate(`(${browserProbe.toString()})()`);
}

function browserProbe() {
  const states = new WeakMap(), observations = new Map();
  const apply = spine.AnimationState.prototype.apply;
  spine.AnimationState.prototype.apply = function (skeleton) { const value = apply.apply(this, arguments); states.set(skeleton, this); return value; };
  const proto = spine.SceneRenderer.prototype, draw = proto.drawSkeleton, end = proto.end, begin = proto.begin;
  proto.begin = function () { this.__catchlightDraws = []; return begin.apply(this, arguments); };
  proto.drawSkeleton = function (skeleton) { this.__catchlightDraws.push(skeleton); return draw.apply(this, arguments); };
  const rect = element => { const value = element.getBoundingClientRect(); return { x: value.x, y: value.y, width: value.width, height: value.height }; };
  function points(skeleton, slotName, renderer) {
    const slot = skeleton.findSlot(slotName), attachment = slot?.attachment;
    if (!attachment?.worldVerticesLength) return null;
    const values = new Float32Array(attachment.worldVerticesLength);
    attachment.computeWorldVertices(slot, 0, values.length, values, 0, 2);
    return Array.from({ length: values.length / 2 }, (_, index) => {
      const value = renderer.camera.worldToScreen(new spine.Vector3(values[2 * index], values[2 * index + 1], 0), renderer.canvas.width, renderer.canvas.height);
      return [value.x, renderer.canvas.height - value.y];
    });
  }
  function bounds(values) {
    const x = Math.min(...values.map(point => point[0])), y = Math.min(...values.map(point => point[1]));
    const width = Math.max(...values.map(point => point[0])) - x, height = Math.max(...values.map(point => point[1])) - y;
    return { x, y, width, height, centerX: x + width / 2, centerY: y + height / 2 };
  }
  function partition(values) {
    const sorted = values.map((point, index) => ({ point, index })).sort((a, b) => a.point[0] - b.point[0]);
    let cut = 0, gap = 0;
    for (let index = 2; index < sorted.length - 2; index++) {
      const current = sorted[index].point[0] - sorted[index - 1].point[0];
      if (current > gap) { cut = index; gap = current; }
    }
    if (gap < bounds(values).width / 5) throw new Error('Cannot separate the two original iris meshes.');
    return [sorted.slice(0, cut), sorted.slice(cut)].map((items, index) => ({ name: index ? 'screen-right' : 'screen-left', indices: items.map(item => item.index), bounds: bounds(items.map(item => item.point)) }));
  }
  function start(observation, renderer, irises) {
    const output = document.createElement('canvas'); output.width = 720; output.height = 320;
    const context = output.getContext('2d'), all = bounds(irises), margin = all.height * .22;
    const crop = { x: all.x - margin, y: all.y - margin, width: all.width + 2 * margin, height: all.height + 2 * margin };
    const zoom = Math.min(672 / crop.width, 220 / crop.height);
    const destination = { x: 24 + (672 - crop.width * zoom) / 2, y: 52 + (220 - crop.height * zoom) / 2, width: crop.width * zoom, height: crop.height * zoom };
    const mapPoint = point => [destination.x + (point[0] - crop.x) * zoom, destination.y + (point[1] - crop.y) * zoom];
    const eyes = partition(irises).map(eye => ({ ...eye, irisBBox: bounds(eye.indices.map(index => mapPoint(irises[index]))) }));
    for (const eye of eyes) eye.irisCenter = { x: eye.irisBBox.centerX, y: eye.irisBBox.centerY };
    const stream = output.captureStream(0), track = stream.getVideoTracks()[0], chunks = [];
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'].find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3_000_000 });
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      for (const item of stream.getTracks()) item.stop();
      if (observation.discard) {
        observation.rejectedIntervals ??= [];
        observation.rejectedIntervals.push({ durationSeconds: observation.frames.at(-1)?.timeSeconds, reason: 'Natural blink before the requested recording ended.' });
        observation.capture = null; observation.frames = []; observation.discard = false; observation.stopping = false;
        observation.armedAt = performance.now() - 1000;
        return;
      }
      // PNG compression happens after recording. Keeping it off the frame
      // path avoids slowing the authored eye cycle during observation.
      for (const frame of observation.frames) {
        context.putImageData(frame.imageData, 0, 0);
        frame.png = output.toDataURL('image/png').split(',')[1];
        delete frame.imageData;
      }
      const data = await new Promise(resolveData => { const reader = new FileReader(); reader.onload = () => resolveData(reader.result.split(',')[1]); reader.readAsDataURL(new Blob(chunks, { type: mimeType })); });
      observation.video = data; observation.done = true;
    };
    observation.capture = { output, context, crop, destination, zoom, eyes, mapPoint, recorder, track };
    observation.startedAt = performance.now(); observation.frames = []; observation.mimeType = mimeType;
    recorder.start();
  }
  proto.end = function () {
    const drew = !!this.activeRenderer && this.__catchlightDraws?.length;
    const skeletons = this.__catchlightDraws?.slice() ?? [], value = end.apply(this, arguments);
    if (!drew) return value; // Renderer switches also end an empty batch before drawing.
    for (const observation of observations.values()) {
      if (observation.done || observation.stopping) continue;
      const inAvatar = !!this.canvas.closest('.speaker-avatar');
      if ((observation.target.composition === 'avatar') !== inAvatar || !this.canvas.isConnected) continue;
      if (!this.canvas.dataset.renderedWhos?.split(',').includes(observation.target.who)) continue;
      const skeleton = skeletons.find(item => item.findSlot(observation.target.iris)?.attachment);
      if (!skeleton) continue;
      const current = states.get(skeleton)?.getCurrent(2);
      if (!current || current.animation.name !== observation.target.eye) {
        if (observation.capture) {
          // Select another natural open interval if this one was too short.
          // Keep the source blink timer and animation running untouched.
          observation.discard = true; observation.stopping = true; observation.capture.recorder.stop();
        }
        continue;
      }
      const irises = points(skeleton, observation.target.iris, this), catches = points(skeleton, observation.target.catchlight, this);
      if (!irises || !catches) continue;
      // Wait for the queued eye clip to resume after a natural blink, with all
      // entrance/movement effects already settled. No clock is changed.
      if (!observation.capture) {
        if (performance.now() - observation.armedAt < 1000 || current.trackTime > .07) continue;
        start(observation, this, irises);
      }
      const capture = observation.capture, context = capture.context;
      const timeSeconds = (performance.now() - observation.startedAt) / 1000;
      context.fillStyle = '#f8f1e7'; context.fillRect(0, 0, 720, 320);
      context.fillStyle = '#27302e'; context.font = 'bold 18px sans-serif';
      context.fillText(observation.target.character + ' — ' + observation.target.composition + ' · open eyes · original speed', 24, 30);
      context.drawImage(this.canvas, capture.crop.x, capture.crop.y, capture.crop.width, capture.crop.height, capture.destination.x, capture.destination.y, capture.destination.width, capture.destination.height);
      context.strokeStyle = '#168a8a'; context.lineWidth = 1;
      for (const eye of capture.eyes) {
        const box = eye.irisBBox;
        context.beginPath(); context.moveTo(box.centerX - 4, box.centerY); context.lineTo(box.centerX + 4, box.centerY);
        context.moveTo(box.centerX, box.centerY - 4); context.lineTo(box.centerX, box.centerY + 4); context.stroke();
      }
      context.font = '14px sans-serif'; context.fillStyle = '#27302e';
      context.fillText('Fixed iris guides · ' + observation.target.script + '/' + observation.target.nid + ' · ' + observation.target.cycle.toFixed(3) + ' s eye cycle', 24, 300);
      capture.track.requestFrame();
      observation.frames.push({ timeSeconds, eyeTrackTime: current.trackTime, animation: current.animation.name, loop: current.loop, timeScale: current.timeScale,
        root: [skeleton.x, skeleton.y], scale: [skeleton.scaleX, skeleton.scaleY], camera: { zoom: this.camera.zoom, x: this.camera.position.x, y: this.camera.position.y },
        canvasRect: rect(this.canvas), canvasSize: [this.canvas.width, this.canvas.height],
        irisVertices: irises.map(capture.mapPoint), catchlightVertices: catches.map(capture.mapPoint),
        perEyeIrisBounds: capture.eyes.map(eye => ({ name: eye.name, ...bounds(eye.indices.map(index => capture.mapPoint(irises[index]))) })),
        imageData: context.getImageData(0, 0, 720, 320) });
      if (timeSeconds >= (observation.target.durationSeconds ?? 2)) { observation.stopping = true; capture.recorder.stop(); }
    }
    return value;
  };
  window.__catchlightProbe = {
    arm(target) { observations.set(target.name, { target, armedAt: performance.now(), done: false }); },
    ready(name) { return observations.get(name)?.done === true; },
    result(name) { const item = observations.get(name); return { target: item.target, error: item.error, rejectedIntervals: item.rejectedIntervals ?? [], mimeType: item.mimeType, video: item.video, frames: item.frames,
      recordingCanvas: { width: 720, height: 320 }, eyes: item.capture.eyes.map(({ name: side, irisBBox, irisCenter }) => ({ name: side, irisBBox, irisCenter })),
      mapping: { crop: item.capture.crop, destination: item.capture.destination, zoom: item.capture.zoom } }; },
  };
}

function assertSteady(result) {
  assert.equal(result.error, undefined); assert.ok(result.frames.length >= 60, 'Enough original-speed video frames were recorded.');
  const first = result.frames[0], last = result.frames.at(-1);
  const duration = result.target.durationSeconds ?? 2;
  assert.ok(last.timeSeconds >= duration && last.timeSeconds < duration + .15);
  const drift = { irisPixels: 0, root: 0, scale: 0, camera: 0, canvasRect: 0 };
  const difference = (left, right) => Math.max(...left.map((value, index) => Math.abs(value - right[index])));
  for (const frame of result.frames) {
    assert.equal(frame.animation, result.target.eye); assert.equal(frame.loop, true); assert.equal(frame.timeScale, 1);
    drift.irisPixels = Math.max(drift.irisPixels, difference(frame.irisVertices.flat(), first.irisVertices.flat()));
    for (const field of ['root', 'scale']) drift[field] = Math.max(drift[field], difference(frame[field], first[field]));
    for (const field of ['camera', 'canvasRect']) drift[field] = Math.max(drift[field], difference(Object.values(frame[field]), Object.values(first[field])));
  }
  assert.ok(drift.irisPixels < .02, 'Iris mesh stays fixed in the recording.');
  for (const field of ['root', 'scale', 'camera', 'canvasRect']) assert.ok(drift[field] < 1e-6, 'Steady ' + field);
  assert.ok(Math.abs((last.eyeTrackTime - first.eyeTrackTime) - last.timeSeconds) < .06, 'Animation runs at original wall-clock speed.');
  const motion = Math.max(...result.frames.map(frame => difference(frame.catchlightVertices.flat(), first.catchlightVertices.flat())));
  assert.ok(motion > .25, 'Reflection mesh moves while the iris remains fixed.');
  return { drift, reflectionVertexMotionPixels: motion, durationSeconds: last.timeSeconds, frames: result.frames.length,
    eyeTrackTimeRange: [first.eyeTrackTime, last.eyeTrackTime], openEyeOnly: true };
}

try {
  await mkdir(resultDir, { recursive: true });
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      const filename = resolve(dist, '.' + (extname(pathname) ? pathname : '/index.html'));
      if (!filename.startsWith(dist + sep)) throw new Error('Invalid path');
      response.writeHead(200, { 'Content-Type': mime[extname(filename)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(await readFile(filename));
    } catch { response.writeHead(404); response.end('Missing local fixture'); }
  });
  await new Promise((resolveServer, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveServer); });
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = spawn(process.env.CHROMIUM_BIN ?? '/usr/bin/chromium', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', `--user-data-dir=${profile}`, '--remote-debugging-pipe', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  client = new CDP(browser.stdio[3], browser.stdio[4]);
  const target = await client.send('Target.createTarget', { url: 'about:blank' });
  client.sessionId = (await client.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
  for (const domain of ['Page', 'Runtime', 'Network']) await client.send(domain + '.enable');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await client.send('Page.navigate', { url: origin + '/?script=1001' });
  await until(`!!document.querySelector('${tid('start')}')&&!document.querySelector('${tid('start')}').disabled`, 'Reader entry');
  await click('settings');
  for (const id of ['volume-voice', 'volume-music', 'volume-sfx']) {
    await client.evaluate(`(()=>{const e=document.querySelector('${tid(id)}');if(!e)return;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'0');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  }
  if (!await client.evaluate(`document.querySelector('${tid('instant-text')}').checked`)) await click('instant-text');
  await click('settings-close'); await click('start');
  await advanceTo({ script: '1001', nid: 8 }); await installProbe();
  for (const item of cases) {
    const folder = join(resultDir, item.name);
    if (resume) {
      try {
        const saved = JSON.parse(await readFile(join(folder, 'measurements.json'), 'utf8'));
        if (saved.verification && saved.target.name === item.name) {
          assertSteady(saved); measurements.push(saved);
          console.log(JSON.stringify({ progress: 'Retained verified recording', case: item.name })); continue;
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    console.log(JSON.stringify({ progress: 'Reader route', case: item.name, script: item.script, nid: item.nid }));
    if ((await state()).scriptId !== item.script) await openStory(item.script);
    await advanceTo(item); await dismissNotices(); await delay(1200); await settle();
    await mkdir(folder, { recursive: true });
    const page = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(join(folder, 'reader-context.png'), Buffer.from(page.data, 'base64'));
    const before = await state();
    await client.evaluate(`window.__catchlightProbe.arm(${JSON.stringify(item)})`);
    await until(`window.__catchlightProbe.ready(${JSON.stringify(item.name)})`, item.name + ' natural open-eye recording', 45_000);
    const result = await client.evaluate(`window.__catchlightProbe.result(${JSON.stringify(item.name)})`);
    await writeFile(join(folder, 'close-up.webm'), Buffer.from(result.video, 'base64'));
    delete result.video;
    for (let index = 0; index < result.frames.length; index++) {
      const frame = result.frames[index], filename = `frame-${String(index).padStart(4, '0')}.png`;
      await writeFile(join(folder, filename), Buffer.from(frame.png, 'base64')); delete frame.png; frame.file = filename;
    }
    const after = await state(); assert.equal(after.scriptId, before.scriptId); assert.equal(after.nid, before.nid);
    measurements.push({ ...result, before, after, directory: folder });
    await writeFile(join(folder, 'measurements.json'), JSON.stringify(measurements.at(-1), null, 2) + '\n');
    console.log(JSON.stringify({ progress: 'Capture samples', case: item.name, frames: result.frames.length, duration: result.frames.at(-1)?.timeSeconds }));
    const verification = assertSteady(result); measurements.at(-1).verification = verification;
    await writeFile(join(folder, 'measurements.json'), JSON.stringify(measurements.at(-1), null, 2) + '\n');
    console.log(JSON.stringify({ progress: 'Recorded', case: item.name, ...verification }));
  }
  assert.equal(errors.length, 0, errors.join('\n'));
} catch (error) {
  failure = error.stack ?? String(error);
} finally {
  if (client) try { await client.send('Browser.close'); } catch {}
  if (browser && browser.exitCode === null) browser.kill('SIGTERM');
  if (server) await new Promise(resolveServer => server.close(resolveServer));
  await rm(profile, { recursive: true, force: true });
  const hash = async path => createHash('sha256').update(await readFile(join(root, path))).digest('hex');
  const result = { passed: !failure, failure, errors, measurements: measurements.map(item => ({ target: item.target, directory: item.directory, verification: item.verification })), navigation,
    hashes: { renderer: await hash('src/spine/ChangliSpineScene.ts'), profiles: await hash('src/spine/SchoolPortraitAssets.ts'), html: await hash('dist/index.html') },
    scope: 'Production Reader over local HTTP; normal opening playback and existing source-scene selector, returning to Reader for ordinary advances and eligible choices. Natural blink completion selects a short open-eye interval at original speed; intervals interrupted by a natural blink are discarded. Fixed crop from actual WebGL framebuffer with steady iris guides; per-frame iris/catchlight geometry, camera, root and canvas position retained. No stage injection, clock change, animation disabling, camera motion or expression override.' };
  await mkdir(resultDir, { recursive: true }); await writeFile(join(resultDir, 'production-browser-result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ passed: result.passed, recordings: measurements.length, report: join(resultDir, 'production-browser-result.json'), failure }));
  if (failure) process.exitCode = 1;
}
