/** Public Reader playback and real Web Audio replay; captures stay local. */
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
const resultDir = process.env.READER_RESULT_DIR ? resolve(process.env.READER_RESULT_DIR) : join(root, 'test-results', 'reader-vfx-review');
const profile = await mkdtemp(join(tmpdir(), 'solaris-review-'));
const sourceMode = process.argv.includes('--dev');
const checks = [], captures = [], measurements = [], errors = [];
const manifest = JSON.parse(await readFile(join(root, 'public/data/maps/audio-playback.json'), 'utf8'));
const tid = id => `[data-testid="${id}"]`;
let browser, client, server, vite;
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.ogg':'audio/ogg', '.opus':'audio/ogg' };

class CDP {
  nextId = 0; pending = new Map(); sessionId;
  constructor(input, output) {
    this.input = input; let buffer = '';
    output.setEncoding('utf8');
    output.on('data', chunk => {
      buffer += chunk; let end;
      while ((end = buffer.indexOf('\0')) >= 0) {
        const packet = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (packet) this.receive(JSON.parse(packet));
      }
    });
  }
  receive(message) {
    if (message.id) {
      const item = this.pending.get(message.id); if (!item) return;
      this.pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(Error(message.error.message)); else item.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) errors.push(`HTTP ${message.params.response.status}: ${new URL(message.params.response.url).pathname}`);
  }
  send(method, params = {}) {
    return new Promise((resolveResult, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 10000);
      this.pending.set(id, { resolve:resolveResult, reject, timer });
      this.input.write(JSON.stringify({ id, method, params, sessionId:method.startsWith('Target.') ? undefined : this.sessionId }) + '\0');
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
}
async function until(expression, label, timeout = 12000) {
  const deadline = Date.now() + timeout;
  do { if (await client.evaluate(expression)) return; await delay(40); } while (Date.now() < deadline);
  throw Error(`Timed out: ${label}`);
}
const settle = () => client.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const state = () => client.evaluate(`({...document.querySelector('${tid('runner-state')}').dataset})`);
// Scene effects keep their real clocks while Story Review is open. Compare
// Reader navigation separately from those transient presentation diagnostics.
const navigationState = ({ vfxScreenOffset, vfxPortraitTargets, ...navigation }) => navigation;
async function clickSelector(selector, touch = false) {
  await until(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e&&!e.disabled&&e.getClientRects().length;})()`, selector);
  const p = await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  if (touch) {
    await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[p] });
    await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
  } else {
    await client.send('Input.dispatchMouseEvent', { type:'mousePressed', button:'left', clickCount:1, ...p });
    await client.send('Input.dispatchMouseEvent', { type:'mouseReleased', button:'left', clickCount:1, ...p });
  }
  await settle();
}
const click = id => clickSelector(tid(id));
const probe = () => client.evaluate(`JSON.parse(document.querySelector('${tid('audio-probe')}').textContent)`);
async function screenshot(name) {
  await client.evaluate(`(()=>{const scroll=document.querySelector('${tid('history-scroll')}');if(scroll)scroll.scrollTop=scroll.scrollHeight;})()`);
  await settle();
  const r = await client.send('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
  const path = join(resultDir, `story-review-${name}.png`);
  await writeFile(path, Buffer.from(r.data, 'base64')); captures.push(path);
}
async function advanceTo(nid) {
  for (let i = 0; i < 40; i++) {
    const s = await state(); if (s.nid === String(nid)) return;
    assert.equal(s.status, 'dialogue'); await click('advance');
    await until(`document.querySelector('${tid('runner-state')}').dataset.visitId!==${JSON.stringify(s.visitId)}`, 'dialogue advance');
  }
  throw Error(`Did not reach ${nid}`);
}
async function geometry(label, mobile) {
  const rows = await client.evaluate(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};return Array.from(document.querySelectorAll('${tid('history-entry')}')).map(e=>{const b=e.querySelector('${tid('history-voice')}');return{text:rect(e.querySelector('.history-text')),heading:rect(e.querySelector('.history-line-heading')),speaker:rect(e.querySelector('.history-speaker')),button:b?{rect:rect(b),label:b.getAttribute('aria-label'),description:document.getElementById(b.getAttribute('aria-describedby'))?.textContent,focusable:b.tabIndex===0}:null};});})()`);
  const voiced = rows.filter(row => row.button), unvoiced = rows.filter(row => !row.button);
  assert.ok(voiced.length >= 2 && unvoiced.length > 0, 'normal playback records voiced and unvoiced lines');
  assert.ok(rows.every(row => Math.abs(row.text.width - rows[0].text.width) < 1 && Math.abs(row.text.x - rows[0].text.x) < 1), 'all dialogue lines use the same wide column');
  assert.ok(rows.every(row => row.text.width > (mobile ? 290 : 590)), 'dialogue stays wide');
  for (const row of voiced) {
    const b = row.button;
    assert.ok(b.label.startsWith('Replay ') && b.description && b.focusable);
    assert.ok(Math.abs(b.rect.y - row.speaker.y) <= (mobile ? 16 : 10), 'replay sits beside its speaker');
    assert.ok(b.rect.width >= (mobile ? 44 : 36) && b.rect.height >= (mobile ? 44 : 36));
  }
  assert.ok(await client.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'no horizontal page overflow');
  measurements.push({ label, rows }); checks.push(`${label}: equal wide dialogue columns, replay beside speaker, accessible name/description/hit target`);
}
async function replay(nid, mode) {
  const selector = `${tid('history-voice')}[data-script-id="1001"][data-node-id="${nid}"]`;
  const before = await state();
  const entriesBefore = await client.evaluate(`Array.from(document.querySelectorAll('${tid('history-entry')}')).map(e=>e.dataset.entryId)`);
  if (mode === 'keyboard') {
    await client.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await client.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, text:'\r', unmodifiedText:'\r' });
    await client.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
  } else await clickSelector(selector, mode === 'touch');
  const cue = `review:1001:${nid}`;
  await until(`(()=>{const p=JSON.parse(document.querySelector('${tid('audio-probe')}').textContent);return p.tracks.some(t=>t.cue===${JSON.stringify(cue)}&&t.sources>0)&&p.cueSignals[${JSON.stringify(cue)}]?.nonzeroSamples>0;})()`, cue + ' plays a real audible source');
  const p = await probe(), track = p.tracks.find(t => t.cue === cue);
  assert.deepEqual(track.assets, [manifest.lines[`1001:${nid}`].variants['ja:any']], 'replay uses the selected line\'s source voice');
  assert.equal(p.tracks.filter(t => t.slot === 'voice').length, 1, 'replay replaces previous voice');
  const after = await state();
  assert.deepEqual(navigationState(after), navigationState(before), 'replay leaves dialogue and stage navigation untouched');
  assert.deepEqual(await client.evaluate(`Array.from(document.querySelectorAll('${tid('history-entry')}')).map(e=>e.dataset.entryId)`), entriesBefore, 'replay leaves the captured dialogue history untouched');
  measurements.push({ label:`${mode} ${cue}`, track, signal:p.cueSignals[cue], readerBefore:before, readerAfter:after });
  checks.push(`${mode}: ${cue} plays its correct source asset with nonzero voice signal and keeps the Reader visit`);
}

try {
  await mkdir(resultDir, { recursive:true });
  let origin;
  if (sourceMode) {
    const { createServer:createViteServer } = await import('vite');
    vite = await createViteServer({ root, server:{ host:'127.0.0.1', port:0 } });
    await vite.listen(); origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  } else {
    await readFile(join(dist, 'index.html'));
    server = createServer(async (request, response) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
        if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
        const path = resolve(dist, '.' + (extname(pathname) ? pathname : '/index.html'));
        if (!path.startsWith(dist + sep)) throw Error('Invalid path');
        const bytes = await readFile(path);
        response.writeHead(200, { 'Content-Type':mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control':'no-store' }); response.end(bytes);
      } catch { response.writeHead(404); response.end(); }
    });
    if (server) await new Promise((r,reject) => { server.once('error',reject); server.listen(0, '127.0.0.1', r); });
    origin = `http://127.0.0.1:${server.address().port}`;
  }
  browser = spawn(process.env.CHROMIUM_BIN ?? '/usr/bin/chromium', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', `--user-data-dir=${profile}`, '--remote-debugging-pipe', 'about:blank'], { stdio:['ignore','ignore','pipe','pipe','pipe'] });
  client = new CDP(browser.stdio[3], browser.stdio[4]);
  const target = await client.send('Target.createTarget', { url:'about:blank' });
  client.sessionId = (await client.send('Target.attachToTarget', { targetId:target.targetId, flatten:true })).sessionId;
  for (const domain of ['Page','Runtime','Network']) await client.send(domain + '.enable');
  await client.send('Emulation.setDeviceMetricsOverride', { width:1280, height:720, deviceScaleFactor:1, mobile:false });
  await client.send('Page.navigate', { url:origin + '/?script=1001&audioProbe=1' });
  await until(`!document.querySelector('${tid('reader-loading')}')&&document.querySelector('${tid('start')}')&&!document.querySelector('${tid('start')}').disabled`, 'Reader ready');
  await click('settings'); await click('instant-text'); await click('settings-close'); await click('start');
  await until(`document.querySelector('${tid('runner-state')}').dataset.nid==='1'&&!document.querySelector('${tid('reader-loading')}')`, '1001 starts normally');
  await advanceTo(10); await click('history');
  await geometry('desktop', false); await replay(9, 'mouse'); await replay(10, 'keyboard'); await screenshot('desktop');
  await click('history-close');
  await client.send('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:true });
  await client.send('Emulation.setTouchEmulationEnabled', { enabled:true, maxTouchPoints:1 });
  await clickSelector(tid('history'), true);
  await geometry('mobile', true); await replay(9, 'touch'); await replay(10, 'touch'); await screenshot('mobile');
  await clickSelector(tid('history-close'), true);
  assert.ok(!await client.evaluate(`document.querySelector('${tid('history-panel')}')`));
  await until(`!JSON.parse(document.querySelector('${tid('audio-probe')}').textContent).tracks.some(t=>t.slot==='voice')`, 'closing review stops voice');
  checks.push('closing Story Review stops its replay voice and preserves reading');
  assert.deepEqual(errors, []);
} catch (error) {
  errors.push(error.stack ?? error.message);
  if (client) { try { measurements.push({ label:'failure audio state', probe:await probe() }); } catch { /* preserve original failure */ } }
  if (client) { try { await screenshot('failure'); } catch { /* keep original failure */ } }
} finally {
  if (client) { try { await client.send('Browser.close'); } catch { /* already exited */ } }
  if (browser && browser.exitCode === null) {
    browser.kill('SIGTERM'); await Promise.race([new Promise(r => browser.once('exit', r)), delay(1500)]);
    if (browser.exitCode === null) browser.kill('SIGKILL');
  }
  if (server) await new Promise(r => server.close(r));
  if (vite) await vite.close();
  await rm(profile, { recursive:true, force:true });
  const report = { passed:errors.length === 0, mode:sourceMode ? 'source Vite HTTP, Chromium/SwiftShader' : 'production HTTP, Chromium/SwiftShader', checks, captures, measurements, errors };
  await writeFile(join(resultDir, 'story-review-report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${report.passed ? 'PASS' : 'FAIL'} Story Review: ${checks.length} checks. Report: ${join(resultDir, 'story-review-report.json')}\n`);
  if (errors.length) { process.stderr.write(errors.join('\n') + '\n'); process.exitCode = 1; }
}
