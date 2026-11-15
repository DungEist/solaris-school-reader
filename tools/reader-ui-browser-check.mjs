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
const resultDir = join(root, 'test-results', 'reader-ui');
const screenshotDir = join(resultDir, 'screenshots');
const profile = await mkdtemp(join(tmpdir(), 'solaris-reader-ui-'));
const checks = [], screenshots = [], errors = [];
const scenesOnly = process.argv.includes('--scenes-only');
const remainingOnly = scenesOnly || process.argv.includes('--remaining-only');
let browser, client, server, slowNextScript = false;
let browserErrors = '';
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
const settle = () => client.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
const state = () => client.evaluate(`(() => { const e = document.querySelector('${testId('runner-state')}'); return { run: e.dataset.runId, visit: e.dataset.visitId, nid: e.dataset.nid, status: e.dataset.status, script: e.dataset.scriptId }; })()`);
async function clickSelector(selector) {
  await until(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return e && !e.disabled && e.getClientRects().length > 0; })()`, `enabled ${selector}`);
  const point = await client.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:'nearest'}); const r = e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  assert.ok(point.x >= 0 && point.y >= 0, `Control is offscreen: ${selector}`);
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
async function ready() {
  await until(`!document.querySelector('${testId('reader-loading')}') && !!document.querySelector('${testId('open-stories')}') && !document.querySelector('${testId('open-stories')}').disabled`, 'entry ready');
}
async function instantText() {
  await click('settings');
  if (!await client.evaluate(`document.querySelector('${testId('instant-text')}').checked`)) await click('instant-text');
  await click('settings-close');
}
async function advanceTo(nid, choiceAt = {}) {
  for (let i = 0; i < 28; i++) {
    await until(`['dialogue','choices'].includes(document.querySelector('${testId('runner-state')}').dataset.status)`, 'scheduled navigation');
    const current = await state();
    if (current.nid === String(nid)) return;
    if (current.status === 'choices' && choiceAt[current.nid] !== undefined) {
      await clickSelector(`${testId('choice')}[data-option-index="${choiceAt[current.nid]}"]`);
      continue;
    }
    assert.equal(current.status, 'dialogue', `Expected ordinary dialogue before ${nid}`);
    await until(`!document.querySelector('${testId('advance')}').disabled`, 'Advance readiness');
    await click('advance');
  }
  throw new Error(`Did not reach ${nid}`);
}
async function openStory(id) {
  await click('menu'); await click('menu-stories');
  await input('script-search', ''); await select('script-select', id);
  await click('library-start');
  await until(`document.querySelector('${testId('runner-state')}').dataset.scriptId === ${JSON.stringify(id)} && !document.querySelector('dialog[open]') && !document.querySelector('${testId('reader-loading')}')`, `story ${id}`);
}
async function cookieLetter() {
  await openStory('14237'); await advanceTo(7, { '3': 0 });
  assert.ok(!await client.evaluate(`!!document.querySelector('${testId('reader-letter')}')`), 'End-phase letter appeared before departure');
  await until(`!document.querySelector('${testId('advance')}').disabled`, 'letter departure readiness');
  await click('advance');
  await until(`!!document.querySelector('${testId('reader-letter')}')`, 'delivered source letter');
  await until(`document.querySelector('${testId('runner-state')}').dataset.status === 'completed'`, 'source departure continues behind letter');
}
async function modalIsolation(id) {
  const before = await state();
  await click(id);
  assert.ok(await client.evaluate("!!document.querySelector('dialog[open]')"));
  await client.evaluate("document.querySelector('dialog[open]').focus()");
  await key(' ', 'Space', 32);
  assert.deepEqual(await state(), before, `${id}: modal Space advanced the scene`);
  await key('Escape', 'Escape', 27);
  assert.ok(!await client.evaluate("!!document.querySelector('dialog[open]')"));
  assert.equal(await client.evaluate('document.activeElement.dataset.testid'), id, `${id}: opener focus`);
  assert.deepEqual(await state(), before);
  checks.push(`${id}: keyboard isolation and Escape focus restoration`);
}

try {
  await mkdir(screenshotDir, { recursive: true });
  await readFile(join(dist, 'index.html'));
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      if (slowNextScript && pathname === '/data/scripts/1001.json') { slowNextScript = false; await delay(900); }
      const filename = resolve(dist, '.' + (extname(pathname) ? pathname : '/index.html'));
      if (!filename.startsWith(dist + sep)) throw new Error('Invalid local path');
      const bytes = await readFile(filename);
      response.writeHead(200, { 'Content-Type': mime[extname(filename)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(bytes);
    } catch { response.writeHead(404); response.end('Missing fixture file'); }
  });
  await new Promise(resolveServer => server.listen(0, '127.0.0.1', resolveServer));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = spawn(process.env.CHROMIUM_BIN ?? '/usr/bin/chromium', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', `--user-data-dir=${profile}`, '--remote-debugging-pipe', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  browser.stderr.on('data', chunk => { browserErrors = (browserErrors + chunk).slice(-3000); });
  client = new CDP(browser.stdio[3], browser.stdio[4]);
  const target = await client.send('Target.createTarget', { url: 'about:blank' });
  client.sessionId = (await client.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
  for (const domain of ['Page', 'Runtime', 'Log', 'Network']) await client.send(domain + '.enable');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await client.send('Page.navigate', { url: origin + '/?script=1001' });
  await ready(); await instantText();
  if (!remainingOnly) {
  await screenshot('entry-desktop'); await layout('entry desktop');

  await click('open-stories'); await input('script-search', 'no-such-scene-000'); await click('stories-close');
  assert.ok(await client.evaluate(`document.querySelector('${testId('start')}').disabled`));
  assert.ok(!await client.evaluate(`document.querySelector('${testId('open-stories')}').disabled`));
  await click('open-stories'); await input('script-search', ''); await select('script-select', '1001'); await click('stories-close');
  checks.push('empty story search disables Open and keeps selection recovery available');

  slowNextScript = true; await click('start');
  await until(`!!document.querySelector('${testId('reader-loading')}')`, 'loading screen');
  await screenshot('loading-desktop');
  await until(`document.querySelector('${testId('runner-state')}').dataset.nid === '1' && !document.querySelector('${testId('reader-loading')}')`, 'opening dialogue');
  await modalIsolation('settings'); await modalIsolation('history');
  const hiddenBefore = await state(); await click('hide-ui'); await key('Escape', 'Escape', 27);
  assert.deepEqual(await state(), hiddenBefore);
  assert.equal(await client.evaluate('document.activeElement.dataset.testid'), 'hide-ui');
  await click('menu'); await screenshot('handbook-desktop'); await click('menu-entry');
  await key(' ', 'Space', 32); assert.deepEqual(await state(), hiddenBefore);
  await click('resume'); assert.deepEqual(await state(), hiddenBefore);
  checks.push('Hide/Escape and Handbook entry/resume preserve the active visit');

  await advanceTo(9);
  await until(`!!document.querySelector('${testId('reader-introduction')}')`, 'source introduction');
  assert.equal(await client.evaluate(`document.querySelector('${testId('reader-introduction')}').dataset.introId`), '12');
  await screenshot('introduction-desktop'); await layout('introduction desktop');
  const introductionVisit = await state();
  await until(`!document.querySelector('${testId('reader-introduction')}')`, 'source introduction expiry', 6000);
  assert.deepEqual(await state(), introductionVisit);
  assert.equal(await client.evaluate("document.querySelector('.calendar-frame strong').textContent"), '—');
  checks.push('Abby introduction expires at its source duration; calendar retains unknown source date');

  await click('menu'); await clickSelector('.handbook-secondary a');
  assert.equal(await client.evaluate(`document.querySelector('${testId('interface')}').dataset.interface`), 'developer');
  assert.deepEqual(await state(), introductionVisit);
  const counts = await client.evaluate(`['debug-stage-count','debug-stage-applied','debug-choice-count'].map(id=>document.querySelector('[data-testid="'+id+'"]').textContent)`);
  await click('switch-view'); assert.deepEqual(await state(), introductionVisit);
  await click('menu'); await clickSelector('.handbook-secondary a');
  assert.deepEqual(await client.evaluate(`['debug-stage-count','debug-stage-applied','debug-choice-count'].map(id=>document.querySelector('[data-testid="'+id+'"]').textContent)`), counts);
  await click('switch-view');
  checks.push('Reader/Debug switches preserve run, visit, emitted/applied stage counts and choices');
  } else {
    await click('start');
    await until(`document.querySelector('${testId('runner-state')}').dataset.nid === '1' && !document.querySelector('${testId('reader-loading')}')`, 'remaining checks entry');
    if (!scenesOnly) { await screenshot('calendar-desktop'); await layout('calendar desktop after artwork sizing fix'); }
  }

  await cookieLetter();
  await screenshot('letter-desktop'); await layout('letter desktop');
  const letterVisit = await state();
  await client.evaluate(`document.querySelector('.reader-letter-pages').focus()`); await key(' ', 'Space', 32);
  assert.deepEqual(await state(), letterVisit);
  await click('letter-confirm'); assert.deepEqual(await state(), letterVisit);
  assert.ok(!await client.evaluate(`!!document.querySelector('${testId('reader-letter')}')`));
  checks.push('source letter displays once, blocks reading, and Confirm preserves the visit');

  await openStory('17048'); await advanceTo(2);
  await screenshot('choices-desktop'); await layout('choices desktop');
  assert.equal(await client.evaluate(`document.querySelectorAll('${testId('choice')}').length`), 4);
  await until(`!document.querySelector('${testId('choice')}').disabled`, 'choice readiness');
  await click('choice');
  await until(`document.querySelector('${testId('runner-state')}').dataset.nid !== '2'`, 'choice navigation');
  checks.push('four real dialogue choices remain readable and selectable');

  await openStory('7025'); await advanceTo(7);
  await until(`!document.querySelector('${testId('advance')}').disabled`, 'quiz departure readiness');
  await click('advance');
  await until(`!!document.querySelector('${testId('quiz')}')`, 'source quiz');
  await screenshot('quiz-desktop'); await layout('quiz desktop');
  assert.equal(await client.evaluate(`document.querySelectorAll('${testId('quiz-answer')}').length`), 3);
  const quizVisit = await state(); await click('quiz-answer');
  await until(`!!document.querySelector('${testId('quiz-result')}')`, 'quiz result');
  assert.deepEqual(await state(), quizVisit); await click('quiz-continue');
  checks.push('paper quiz shows three answers; result waits for Continue on the same visit');

  await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await client.send('Page.navigate', { url: origin + '/?script=1001' });
  await ready(); await screenshot('entry-mobile'); await layout('entry mobile');
  await instantText(); await click('start');
  await until(`document.querySelector('${testId('runner-state')}').dataset.nid === '1' && !document.querySelector('${testId('reader-loading')}')`, 'mobile dialogue');
  await advanceTo(8);
  await screenshot('reading-mobile'); await layout('reading mobile');
  await click('history'); await screenshot('history-mobile'); await layout('History mobile'); await click('history-close');
  await cookieLetter();
  await screenshot('letter-mobile'); await layout('letter mobile'); await click('letter-confirm');
  assert.deepEqual(errors, [], 'Unexpected page/resource errors');
} catch (error) {
  errors.push(error.message);
  if (client) { try { await screenshot('failure'); } catch { /* Preserve the original failure. */ } }
} finally {
  if (client) { try { await client.send('Browser.close'); } catch { /* The owned process may already have exited. */ } }
  if (browser && browser.exitCode === null) {
    browser.kill('SIGTERM');
    await Promise.race([new Promise(resolveExit => browser.once('exit', resolveExit)), delay(1500)]);
    if (browser.exitCode === null) browser.kill('SIGKILL');
  }
  if (server) await new Promise(resolveClose => server.close(resolveClose));
  await rm(profile, { recursive: true, force: true });
  const result = { passed: errors.length === 0, mode: 'production HTTP, Chromium/SwiftShader', scope: scenesOnly ? 'remaining source scenes and mobile layouts' : remainingOnly ? 'remaining source scenes and changed calendar styling' : 'all focused Reader checks', checks, screenshots, errors, ...(errors.length ? { browserErrors } : {}) };
  await writeFile(join(resultDir, 'focused-browser-result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`${result.passed ? 'PASS' : 'FAIL'}: ${checks.length} focused Reader checks; ${screenshots.length} binary screenshots. Result: test-results/reader-ui/focused-browser-result.json`);
  if (errors.length) { console.log(errors.join('\n').slice(0, 1500)); process.exitCode = 1; }
}
