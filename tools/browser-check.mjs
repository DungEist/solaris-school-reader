/** Chromium/CDP smoke tests use a pipe; no browser package or debug port is needed. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = new URL('../', import.meta.url);
const resultDir = new URL('../test-results/', import.meta.url);
const profileDir = await mkdtemp(join(tmpdir(), 'solaris-browser-'));
const browserPath = process.env.CHROMIUM_BIN ?? '/usr/bin/chromium';
const baseUrl = process.env.SOLARIS_TEST_URL ?? 'http://127.0.0.1:4175/';
let server;
let browser;
let client;
let processErrors = '';
const failures = [];
const checks = [];
const historyOnly = process.argv.includes('--history-only');
const interfacesOnly = process.argv.includes('--interfaces-only');
const resultsFile = interfacesOnly ? 'phase7-browser-results.json' : historyOnly ? 'phase5-browser-results.json' : 'phase4-browser-results.json';
let mode = 'http';

class CDP {
  nextId = 0;
  pending = new Map();
  sessionId;
  constructor(input, output) {
    this.input = input;
    let buffered = '';
    output.setEncoding('utf8');
    output.on('data', chunk => {
      buffered += chunk;
      let delimiter;
      while ((delimiter = buffered.indexOf('\0')) >= 0) {
        const packet = buffered.slice(0, delimiter);
        buffered = buffered.slice(delimiter + 1);
        if (packet) this.receive(JSON.parse(packet));
      }
    });
    const brokenPipe = error => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(error);
      }
      this.pending.clear();
    };
    input.on('error', brokenPipe);
    output.on('error', brokenPipe);
  }
  receive(message) {
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timeout);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      } else if (message.method === 'Runtime.exceptionThrown') {
        failures.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
      } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        failures.push(message.params.entry.text);
      } else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
        failures.push(`HTTP ${message.params.response.status}: ${message.params.response.url}`);
      }
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10_000);
      this.pending.set(id, { resolve, reject, timeout });
      const sessionId = method.startsWith('Target.') ? undefined : this.sessionId;
      this.input.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() {
    for (const { timeout } of this.pending.values()) clearTimeout(timeout);
    this.input.end();
  }
}

async function until(check, description, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  do {
    try { if (await check()) return; } catch (error) { lastError = error; }
    await delay(75);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}${lastError ? ` (${lastError.message})` : ''}`);
}

async function waitFor(expression, description) {
  await until(() => client.evaluate(expression), description);
}

async function settle() {
  await client.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}

async function click(selector) {
  if (/data-testid="(?:advance|choice|hidden-choice-override)"/.test(selector)) await waitForInput();
  const found = await client.evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element || element.disabled) return false; element.click(); return true; })()`);
  assert.ok(found, `Clickable element missing: ${selector}`);
  await settle();
}

async function input(testId, value) {
  await client.evaluate(`(() => {
    const element = document.querySelector('[data-testid="${testId}"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await settle();
}

async function select(testId, value) {
  await client.evaluate(`(() => {
    const element = document.querySelector('[data-testid="${testId}"]');
    element.value = ${JSON.stringify(value)};
    element.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await settle();
}

async function state() {
  return client.evaluate(`(() => {
    const text = id => document.querySelector('[data-testid="' + id + '"]')?.textContent;
    return {
      status: document.querySelector('[data-testid="runner-state"]').dataset.status,
      scriptId: text('debug-script-id'), nid: text('debug-nid'), flow: Number(text('debug-flow-index')),
      stages: Number(text('debug-stage-count')), choices: Number(text('debug-choice-count')),
      dialogue: text('dialogue-text'), speaker: text('speaker-name'),
      navigation: [...document.querySelectorAll('[data-testid="navigation-entry"]')].map(entry => entry.dataset.to),
      background: document.querySelector('[data-testid="visual-stage"]').dataset.backgroundId,
      cg: document.querySelector('[data-testid="visual-stage"]').dataset.cgId,
      applied: Number(text('debug-stage-applied')),
      hiddenChoice: document.querySelector('[data-testid="runner-state"]').dataset.hiddenChoice === 'true',
      pending: Number(text('debug-pending-count')), transitions: Number(text('debug-transition-count')),
      textComplete: document.querySelector('[data-testid="runner-state"]').dataset.textComplete === 'true',
      visibleGraphemes: Number(document.querySelector('[data-testid="dialogue-text"]')?.dataset.visibleGraphemes ?? 0),
    };
  })()`);
}

async function waitForInput() {
  await waitFor(`(() => {
    const player = document.querySelector('[data-testid="runner-state"]');
    return player?.dataset.status === 'completed' || player?.dataset.status === 'error' || player?.dataset.inputReady === 'true';
  })()`, 'scheduled phases finish and the navigation guard releases');
}

async function nextInput() {
  await waitForInput();
  const current = await state();
  assert.ok(['choices', 'dialogue'].includes(current.status), `Cannot navigate from ${current.status}`);
  const selector = current.status === 'choices' ? current.hiddenChoice ? '[data-testid="hidden-choice-override"][data-option-index="0"]' : '[data-testid="choice"]' : '[data-testid="advance"]';
  await click(selector);
}

async function instant(value) {
  if (await client.evaluate('document.querySelector(\'[data-testid="instant-transitions"]\').checked') !== value) await click('[data-testid="instant-transitions"]');
}

async function instantText(value) {
  if (await client.evaluate('document.querySelector(\'[data-testid="instant-text"]\').checked') !== value) await click('[data-testid="instant-text"]');
}

async function mouseClick(selector) {
  const point = await client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return null;
    element.scrollIntoView({ block: 'center' });
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  assert.ok(point, `Mouse target missing: ${selector}`);
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  await settle();
}

async function pressKey(key, autoRepeat = false) {
  const code = key === ' ' ? 'Space' : key;
  const keyCode = { ' ': 32, Enter: 13, Escape: 27, Tab: 9, End: 35, PageDown: 34 }[key];
  assert.ok(keyCode, `Unsupported browser test key: ${key}`);
  const event = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
  await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...event, autoRepeat });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
  await settle();
}

async function historyEntries() {
  return client.evaluate(`Array.from(document.querySelectorAll('[data-testid="history-entry"]'), entry => ({
    id: entry.dataset.entryId, kind: entry.dataset.entryKind,
    speaker: entry.querySelector('.history-speaker').textContent,
    text: entry.querySelector('.history-text').textContent,
  }))`);
}

function logicalReadingState(current) {
  const { dialogue, textComplete, visibleGraphemes, transitions, ...logical } = current;
  return logical;
}

async function openHistory() {
  await mouseClick('[data-testid="history"]');
  assert.ok(await client.evaluate('document.querySelector(\'[data-testid="history-panel"]\').matches(":modal")'));
  assert.ok(await client.evaluate('document.activeElement.matches(\'[data-testid="history-close"]\')'));
}

async function closeHistoryWithEscape() {
  await pressKey('Escape');
  assert.equal(await client.evaluate('Boolean(document.querySelector(\'[data-testid="history-panel"]\'))'), false);
  assert.ok(await client.evaluate('document.activeElement.matches(\'[data-testid="history"]\')'), 'Escape restores focus to History');
}

async function checkHistory() {
  await openHistory();
  assert.equal((await historyEntries()).length, 0);
  assert.ok(await client.evaluate('document.querySelector(\'[data-testid="history-panel"]\').textContent.includes("No dialogue yet.")'));
  await closeHistoryWithEscape();
  assert.equal((await state()).status, 'idle');

  await input('player-name', 'Archive Sol e\u0301 👩🏽‍🚀');
  await select('gender', 'male');
  await input('text-speed', '5');
  await startScript('x1');
  const first = await state();
  assert.equal(first.textComplete, false);
  await openHistory();
  const captured = await historyEntries();
  assert.equal(captured.length, 1);
  assert.ok(captured[0].text.includes('Welcome back, Archive Sol e\u0301 👩🏽‍🚀.'));
  await pressKey('Tab');
  assert.ok(await client.evaluate('document.activeElement.matches(\'[data-testid="history-scroll"]\')'));
  await pressKey(' ');
  await pressKey('Enter');
  await pressKey('Enter', true);
  await mouseClick('[data-testid="history-entry"]');
  await client.evaluate(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    document.querySelector('[data-testid="dialogue-text-area"]').click();
  })()`);
  await settle();
  assert.deepEqual(logicalReadingState(await state()), logicalReadingState(first));
  assert.deepEqual(await historyEntries(), captured);
  await pressKey('Tab');
  assert.ok(await client.evaluate('document.activeElement.closest(\'[data-testid="history-panel"]\')'), 'Tab stays inside the modal');
  await closeHistoryWithEscape();
  assert.deepEqual(logicalReadingState(await state()), logicalReadingState(first));
  checks.push('History opens empty or during reveal, shows full Unicode text once, traps focus, isolates keyboard/clicks, and restores focus on Escape');

  await input('player-name', 'Later Luna');
  await select('gender', 'female');
  await instantText(true);
  await openHistory();
  assert.deepEqual(await historyEntries(), captured, 'Player edits must not rewrite older text');
  await mouseClick('[data-testid="history-close"]');
  assert.ok(await client.evaluate('document.activeElement.matches(\'[data-testid="history"]\')'));
  await instant(true);
  for (let i = 0; i < 8; i++) await nextInput();
  await instantText(false);
  await nextInput();
  const beforePanel = await state();
  assert.equal(beforePanel.textComplete, false);
  await openHistory();
  const accumulated = await historyEntries();
  assert.equal(accumulated.length, 10);
  assert.equal(new Set(accumulated.map(entry => entry.id)).size, accumulated.length);
  assert.deepEqual(accumulated[0], captured[0]);
  await pressKey('Tab');
  await pressKey('End');
  const scrollTop = await client.evaluate('document.querySelector(\'[data-testid="history-scroll"]\').scrollTop');
  assert.ok(scrollTop > 0, 'History is scrollable by keyboard');
  const visible = (await state()).visibleGraphemes;
  await delay(500);
  assert.ok((await state()).visibleGraphemes > visible, 'Text reveal continues while history is open');
  assert.equal(await client.evaluate('document.querySelector(\'[data-testid="history-scroll"]\').scrollTop'), scrollTop, 'Text ticks cannot reset history scrolling');
  assert.deepEqual(await historyEntries(), accumulated);
  assert.deepEqual(logicalReadingState(await state()), logicalReadingState(beforePanel));
  await screenshot('phase5-history-desktop.png');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await settle();
  assert.ok(await client.evaluate('document.querySelector(\'[data-testid="history-panel"]\').getBoundingClientRect().width <= window.innerWidth'));
  await screenshot('phase5-history-mobile.png');
  await closeHistoryWithEscape();
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 960, deviceScaleFactor: 1, mobile: false });
  await client.evaluate('document.body.tabIndex = -1; document.body.focus()');
  await pressKey(' ');
  assert.equal((await state()).nid, beforePanel.nid, 'Closing history does not count as an advance input');
  assert.equal((await state()).textComplete, true);
  await waitForInput();
  await pressKey('Enter');
  assert.notEqual((await state()).nid, beforePanel.nid, 'Reading shortcuts resume after closing history');
  checks.push('Older name/gender snapshots stay fixed; visits stay unique; keyboard scroll survives typewriter ticks; desktop/mobile panel fits and reading resumes');

  await instantText(true);
  await startScript('17048');
  await nextInput();
  const choices = await state();
  await openHistory();
  assert.equal((await historyEntries()).length, 2, 'Start clears the previous script history');
  assert.equal(await client.evaluate('document.querySelectorAll(\'[data-testid="choice"]:enabled\').length'), 0);
  await pressKey('Tab');
  await pressKey(' ');
  await pressKey('Enter');
  assert.deepEqual(logicalReadingState(await state()), logicalReadingState(choices));
  await closeHistoryWithEscape();
  await mouseClick('[data-testid="choice"][data-option-id="5"]');
  assert.equal((await state()).status, 'completed');
  assert.equal((await state()).choices, 1);
  assert.equal((await state()).navigation.includes('3'), false);
  await openHistory();
  const completed = await historyEntries();
  assert.deepEqual(completed.map(entry => entry.kind), ['dialogue', 'dialogue', 'choice']);
  assert.equal(completed[2].text, 'Maybe another time.');
  await closeHistoryWithEscape();
  await click('[data-testid="restart"]');
  await openHistory();
  assert.equal((await historyEntries()).length, 1);
  await closeHistoryWithEscape();
  checks.push('Visible choices remain unselected in History; 17048 optionId 5 records once, completes without nid 3, and retains history until Restart');

  await startScript('1004');
  await openHistory();
  assert.deepEqual((await historyEntries()).map(entry => entry.kind), ['dialogue']);
  await client.evaluate('document.querySelector(\'[data-testid="hidden-choice-override"]\').click()');
  assert.equal((await state()).choices, 0);
  await closeHistoryWithEscape();
  await click('[data-testid="hidden-choice-override"][data-option-index="0"]');
  await waitFor('document.querySelector(\'[data-testid="debug-nid"]\').textContent === "2"', 'hidden override finishes');
  await openHistory();
  assert.deepEqual((await historyEntries()).map(entry => entry.kind), ['dialogue', 'dialogue']);
  assert.equal((await state()).choices, 1);
  assert.equal(await client.evaluate('document.querySelectorAll(\'[data-testid="stage-event"][data-phase="option"]\').length'), 5);
  await closeHistoryWithEscape();
  await startScript('1053');
  await openHistory();
  assert.equal((await historyEntries()).length, 0);
  await closeHistoryWithEscape();
  checks.push('1004 hidden overrides and technical performances remain in Debug; movie-only completion has no readable entries');
}

async function checkManualReading() {
  assert.equal(await client.evaluate('document.querySelector(\'[data-testid="instant-text"]\').checked'), false);
  await input('text-speed', '5');
  await startScript('17048');
  assert.equal((await state()).textComplete, false);
  const first = await state();
  await mouseClick('[data-testid="dialogue-text-area"]');
  const revealed = await state();
  assert.equal(revealed.textComplete, true);
  assert.equal(revealed.nid, '1');
  assert.deepEqual(revealed.navigation, first.navigation);
  assert.equal(revealed.stages, first.stages);
  await client.evaluate('document.activeElement?.blur()');
  await waitForInput();
  await pressKey(' ', true);
  assert.equal((await state()).nid, '1', 'Held-key repeat must not advance after the guard expires');
  await pressKey(' ');
  assert.equal((await state()).nid, '2');
  assert.equal((await state()).textComplete, false);
  await waitForInput();
  const pending = await state();
  await client.evaluate(`(() => {
    for (const selector of ['[data-testid="player-name"]', '[data-testid="gender"]', '[data-testid="text-speed"]', '[data-testid="instant-text"]', 'summary']) {
      const element = document.querySelector(selector);
      element?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      element?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    }
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    editable.innerHTML = '<span>Editable test content</span>';
    document.body.append(editable);
    editable.firstChild.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    editable.remove();
    document.querySelector('[data-testid="player-name"]').focus();
  })()`);
  await pressKey('Enter');
  assert.equal((await state()).textComplete, false, 'Editing and interactive controls must not complete dialogue');
  assert.deepEqual((await state()).navigation, pending.navigation);
  await client.evaluate('document.activeElement?.blur()');
  await pressKey('Enter');
  assert.equal((await state()).textComplete, true);
  assert.deepEqual((await state()).navigation, pending.navigation);
  await waitForInput();
  await mouseClick('[data-testid="choice"][data-option-id="5"]');
  const finished = await state();
  assert.equal(finished.status, 'completed');
  assert.equal(finished.choices, 1);
  assert.equal(finished.navigation.includes('3'), false);
  checks.push('Physical dialogue mouse click reveals only text; Space advances; Enter reveals choices; optionId 5 finishes 17048 without nid 3');
  checks.push('Held keys and keyboard events in input/select/range/checkbox/summary/editable content leave navigation untouched');

  await startScript('1004');
  const hidden = await state();
  await click('[data-testid="advance"]');
  assert.equal((await state()).textComplete, true);
  assert.equal((await state()).nid, '1');
  assert.equal((await state()).choices, 0);
  assert.equal(await client.evaluate('document.querySelectorAll(\'[data-testid="choice"]\').length'), 0);
  assert.deepEqual((await state()).navigation, hidden.navigation);
  await waitForInput();
  await mouseClick('[data-testid="hidden-choice-override"][data-option-id="11"]');
  await waitFor('document.querySelector(\'[data-testid="debug-nid"]\').textContent === "2"', '1004 explicit hidden option performances');
  assert.equal((await state()).choices, 1);
  assert.equal(await client.evaluate('document.querySelectorAll(\'[data-testid="stage-event"][data-phase="option"]\').length'), 5);
  checks.push('1004/1 Advance completes text without selecting a hidden branch; explicit optionId 11 schedules exactly five performances');

  await startScript('17048');
  await client.evaluate('document.querySelector(\'[data-testid="advance"]\').focus()');
  await pressKey('Enter');
  assert.equal((await state()).nid, '1');
  assert.equal((await state()).textComplete, true);
  await waitForInput();
  await pressKey('Enter');
  assert.equal((await state()).nid, '2', 'Focused Advance must navigate once without a native/bubbling duplicate');
  await waitForInput();
  await pressKey('Enter', true);
  assert.equal((await state()).textComplete, false);
  await instantText(true);
  const instantState = await state();
  assert.equal(instantState.textComplete, true);
  await input('player-name', 'Unicode e\u0301 👩🏽‍🚀');
  assert.deepEqual((await state()).navigation, instantState.navigation);
  assert.equal((await state()).stages, instantState.stages);
  await click('[data-testid="restart"]');
  assert.equal((await state()).textComplete, true);
  await screenshot('phase4-reading-desktop.png');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await settle();
  assert.ok(await client.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'Text settings or dialogue overflow on mobile');
  await screenshot('phase4-reading-mobile.png');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 960, deviceScaleFactor: 1, mobile: false });
  checks.push('Focused Advance handles Enter once, rejects repeats, and instant text survives rerenders/restart; desktop/mobile remain readable');
  await instantText(false);
  await click('[data-testid="restart"]');
  assert.equal((await state()).textComplete, false);
  await startScript('1004');
  assert.equal((await state()).textComplete, false);
  assert.equal((await state()).nid, '1');
  checks.push('Restart and script switch begin fresh text reveal; stale cancellation is additionally verified with fake-clock races');
  await instantText(true);
}

async function advanceTo(nid) {
  for (let i = 0; i < 200 && (await state()).nid !== String(nid); i++) {
    await nextInput();
    await waitForInput();
  }
  assert.equal((await state()).nid, String(nid));
}

async function checkImage(kind) {
  const imageSelector = `[data-testid="${kind}-image"]`;
  if (await client.evaluate(`Boolean(document.querySelector(${JSON.stringify(imageSelector)}))`)) {
    await waitFor(`(() => { const image = document.querySelector(${JSON.stringify(imageSelector)}); return image?.complete && image.naturalWidth > 0; })()`, `${kind} WebP browser decode`);
    checks.push(`${kind} WebP loads and decodes with nonzero dimensions`);
    return true;
  }
  assert.equal(await client.evaluate(`Boolean([...document.querySelectorAll('[data-testid="asset-image-error"]')].find(entry => entry.textContent.startsWith(${JSON.stringify(kind === 'cg' ? 'CG ' : 'Background ')})))`), false, `A mapped ${kind} failed to decode`);
  assert.ok(await client.evaluate(`Boolean(document.querySelector('[data-testid="asset-fallback"][data-kind="${kind}"]'))`), `Missing ${kind} needs a labeled fallback`);
  checks.push(`${kind} is unavailable in this cache; labeled fallback is present`);
  return false;
}

async function startScript(id) {
  await input('script-search', id);
  await select('group-filter', '');
  await select('script-select', id);
  await click('[data-testid="start"]');
  await waitFor(`document.querySelector('[data-testid="debug-script-id"]').textContent === ${JSON.stringify(id)} && document.querySelector('[data-testid="runner-state"]').dataset.status !== 'idle'`, `start script ${id}`);
}

async function finish() {
  for (let i = 0; i < 300; i++) {
    await waitForInput();
    const current = await state();
    if (current.status === 'completed') return current;
    assert.notEqual(current.status, 'error', 'Page entered an error state');
    await nextInput();
  }
  throw new Error('Page did not complete in 300 manual inputs');
}

async function screenshot(name) {
  const result = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(new URL(name, resultDir), Buffer.from(result.data, 'base64'));
}

async function checkInterfaces() {
  await instantText(true);
  await startScript('17048');
  await nextInput();
  const before = await state();
  const token = await client.evaluate('document.querySelector(\'[data-testid="runner-state"]\').dataset.runId');
  await mouseClick('[data-testid="switch-view"]');
  assert.equal(await client.evaluate('document.querySelector(\'[data-testid="interface"]\').dataset.interface'), 'reader');
  assert.equal(await client.evaluate('Boolean(document.querySelector(\'[data-testid="script-select"], .debug-panel, .stage-caption, .changli-placement-note\'))'), false);
  assert.equal(await client.evaluate('document.querySelector(\'[data-testid="runner-state"]\').dataset.runId'), token);
  assert.equal(await client.evaluate('document.querySelector(\'[data-testid="runner-state"]\').dataset.nid'), '2');
  await mouseClick('[data-testid="settings"]');
  assert.ok(await client.evaluate('document.querySelector(\'[data-testid="settings-panel"]\').matches(":modal")'));
  await client.evaluate('document.querySelector(\'[data-testid="player-name"]\').focus()');
  await pressKey('Enter');
  await client.evaluate('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))');
  assert.equal(await client.evaluate('document.querySelector(\'[data-testid="runner-state"]\').dataset.nid'), '2');
  await pressKey('Escape');
  assert.ok(await client.evaluate('document.activeElement.matches(\'[data-testid="settings"]\')'));
  await openHistory();
  await client.evaluate('document.querySelector(\'[data-testid="history-scroll"]\').focus()');
  await pressKey('Enter');
  await closeHistoryWithEscape();
  await mouseClick('[data-testid="switch-view"]');
  assert.deepEqual(await state(), before, 'view/modal inputs cannot alter settled playback or create another run');
  await waitForInput();
  await mouseClick('[data-testid="switch-view"]');
  await mouseClick('[data-testid="choice"][data-option-id="5"]');
  await waitFor('document.querySelector(\'[data-testid="runner-state"]\').dataset.status === "completed"', 'reader FinishTalk');
  assert.ok(await client.evaluate('document.querySelector(\'[data-testid="completion"]\').textContent.includes("end of this scene")'));
  await mouseClick('[data-testid="switch-view"]');
  assert.equal((await state()).choices, 1);
  assert.ok(!(await state()).navigation.includes('3'));
  await startScript('1004');
  await mouseClick('[data-testid="switch-view"]');
  assert.equal(await client.evaluate('document.querySelectorAll(\'[data-testid="hidden-choice-override"], [data-testid="choice"]\').length'), 0);
  await mouseClick('[data-testid="hidden-choice-notice"] a');
  assert.equal(await client.evaluate('document.querySelectorAll(\'[data-testid="hidden-choice-override"]\').length'), 2);
  await mouseClick('[data-testid="switch-view"]');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await settle();
  assert.ok(await client.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'));
  await screenshot('phase7-reader-mobile.png');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 960, deviceScaleFactor: 1, mobile: false });
  await screenshot('phase7-reader-desktop.png');
  checks.push('reader/debug views share one run; Settings and History isolate inputs and restore focus; FinishTalk and hidden override separation survive view switches on desktop/mobile');
}

async function canListen() {
  return new Promise(resolve => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(0, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

async function offlinePage() {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const scriptPath = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
  const cssPath = html.match(/<link[^>]+href="([^"]+\.css)"/)?.[1];
  assert.ok(scriptPath && cssPath, 'Expected a built page with one JS bundle and CSS');
  const bundle = await readFile(new URL(`../dist/${scriptPath.replace(/^\//, '')}`, import.meta.url), 'utf8');
  const css = await readFile(new URL(`../dist/${cssPath.replace(/^\//, '')}`, import.meta.url), 'utf8');
  const page = html.replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/, '').replace(/<link[^>]+href="[^"]+\.css"[^>]*>/, `<style>${css}</style>`);
  const filename = join(profileDir, 'test-page.html');
  await writeFile(filename, page);
  // Relative Vite URLs resolve to the same production media cache via this
  // local-file layout. No images are fabricated or downloaded by this check.
  await mkdir(join(profileDir, 'assets'), { recursive: true });
  await symlink(fileURLToPath(new URL('../dist/assets/solarschool/', import.meta.url)), join(profileDir, 'assets', 'solarschool'));
  const files = {};
  for (const path of ['manifest.json', 'scripts.index.json', 'speakers.json', 'build-report.json', 'assets.manifest.json', 'maps/story-source.json', 'locales/en.json', ...['17048', '1004', '1001', '1002', '9015', '6012', '3018', '1053', '4015', '7025', 'x1'].map(id => `scripts/${id}.json`)]) {
    files[`data/${path}`] = JSON.parse(await readFile(new URL(`../public/data/${path}`, import.meta.url), 'utf8'));
  }
  try { files['assets/solarschool/asset-map.json'] = JSON.parse(await readFile(new URL('../public/assets/solarschool/asset-map.json', import.meta.url), 'utf8')); }
  catch { /* Optional cache: the reader should display missing-asset labels. */ }
  const bootstrap = `(() => {
    // Local-file delivery cannot exercise HTTP routes. Keep these methods
    // inert for this fixture; the interface switch still updates React state.
    window.history.pushState = () => {};
    window.history.replaceState = () => {};
    const files = ${JSON.stringify(files)};
    window.fetch = async input => {
      const path = String(input).replace(/^\\.?\\//, '');
      return new Response(JSON.stringify(files[path] ?? { error: 'Missing offline test data' }), {
        status: Object.hasOwn(files, path) ? 200 : 404, headers: { 'Content-Type': 'application/json' },
      });
    };
  })()`;
  return { url: `${new URL(`file://${filename}`).href}?script=17048`, bootstrap, bundle };
}

try {
  await access(browserPath);
  await mkdir(resultDir, { recursive: true });
  let offline;
  if (!process.env.SOLARIS_TEST_URL && !await canListen()) {
    mode = 'local files (HTTP ports restricted)';
    offline = await offlinePage();
  } else if (!process.env.SOLARIS_TEST_URL) {
    await access(new URL('../dist/index.html', import.meta.url));
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4175', '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', data => { processErrors += String(data); });
    server.stderr.on('data', data => { processErrors += String(data); });
  }
  if (!offline) await until(async () => (await fetch(baseUrl)).ok, 'preview server');
  browser = spawn(browserPath, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profileDir}`, '--remote-debugging-pipe', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  browser.stderr.on('data', data => { processErrors += String(data); });
  client = new CDP(browser.stdio[3], browser.stdio[4]);
  const target = await client.send('Target.createTarget', { url: 'about:blank' });
  client.sessionId = (await client.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable');
  await client.send('Network.enable');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 960, deviceScaleFactor: 1, mobile: false });
  await client.send('Page.navigate', { url: offline?.url ?? `${new URL('debug?script=17048', baseUrl).href}` });
  if (offline) {
    await waitFor('Boolean(document.getElementById("root"))', 'local page document');
    await client.evaluate(offline.bootstrap);
    await client.evaluate(offline.bundle);
    await waitFor('Boolean(document.querySelector(\'[data-testid="switch-view"]\'))', 'offline reader entry');
    await mouseClick('[data-testid="switch-view"]');
  }
  await waitFor('Boolean(document.querySelector(\'[data-testid="script-select"] option[value="17048"]\'))', 'English catalog');
  await waitFor('document.querySelector(\'[data-testid="asset-cache-status"]\').dataset.loaded === "true"', 'optional visual asset catalog');
  assert.equal((await state()).status, 'idle');

  if (interfacesOnly) await checkInterfaces();
  else if (historyOnly) await checkHistory();
  else await checkManualReading();
  if (!interfacesOnly && !historyOnly && !process.argv.includes('--reading-only')) {
  await startScript('17048');

  await input('script-search', '17048');
  assert.equal(await client.evaluate('document.querySelector(\'[data-testid="script-select"]\').value'), '17048');
  await click('[data-testid="start"]');
  await waitFor('document.querySelector(\'[data-testid="debug-nid"]\').textContent === "1"', '17048 node 1');
  assert.ok((await state()).dialogue.includes('popularity'));
  assert.ok((await state()).speaker);
  await click('[data-testid="advance"]');
  assert.equal((await state()).nid, '2');
  assert.equal((await state()).status, 'choices');
  assert.equal(await client.evaluate('document.querySelector(\'[data-testid="advance"]\').disabled'), true);
  const pending = await state();
  await input('player-name', 'Browser Rover');
  await select('gender', 'female');
  assert.equal((await state()).stages, pending.stages, 'React rerenders replayed start stages at a choice');
  assert.equal((await state()).applied, pending.applied, 'React rerenders consumed stage events again');
  assert.deepEqual((await state()).navigation, pending.navigation, 'React rerenders navigated a pending node');
  await click('[data-testid="choice"][data-option-id="5"]');
  assert.equal((await state()).status, 'completed');
  assert.equal((await state()).choices, 1);
  assert.equal((await state()).navigation.includes('3'), false);
  checks.push('17048 optionId 5 ends the talk without showing node 3; choices wait and record once');

  await click('[data-testid="restart"]');
  assert.equal((await state()).choices, 0);
  await click('[data-testid="advance"]');
  await click('[data-testid="choice"][data-option-id="3"]');
  assert.equal((await state()).nid, '6');
  const branched = await finish();
  assert.equal(branched.status, 'completed');
  assert.ok(branched.navigation.includes('6'));
  assert.equal(branched.navigation.includes('3'), false);
  checks.push('17048 branching playthrough completes through node 6; restart clears prior history');

  await startScript('1004');
  assert.equal((await state()).status, 'choices');
  assert.equal((await state()).hiddenChoice, true);
  assert.ok((await state()).dialogue, 'Hidden branches keep the current dialogue readable');
  assert.equal(await client.evaluate('document.querySelectorAll(\'[data-testid="choice"]\').length'), 0);
  assert.equal(await client.evaluate('document.querySelectorAll(\'[data-testid="hidden-choice-override"]\').length'), 2);
  assert.ok(!await client.evaluate('document.querySelector(\'.dialogue-box\').textContent.includes("[Missing English:")'));
  await waitFor('document.querySelector(\'[data-testid="visual-stage"]\').dataset.activeTransitions === "0"', 'source Enter fades complete');
  assert.equal((await state()).nid, '1', 'No hidden branch is selected automatically');
  assert.equal((await state()).choices, 0);
  await waitForInput();
  await client.evaluate(`(() => {
    const button = document.querySelector('[data-testid="hidden-choice-override"][data-option-index="0"]');
    button.click(); button.click(); button.click();
  })()`);
  await waitFor('document.querySelector(\'[data-testid="debug-nid"]\').textContent === "2"', 'selected option performances complete');
  assert.equal((await state()).nid, '2');
  assert.equal((await state()).choices, 1);
  assert.equal(await client.evaluate('document.querySelectorAll(\'[data-testid="stage-event"][data-phase="option"]\').length'), 5);
  checks.push('1004/1 hides empty option text, waits for a debug override and schedules all five selected performances once despite rapid clicks');

  await advanceTo(4);
  assert.ok((await state()).pending > 0);
  assert.equal(await client.evaluate('document.querySelector(\'[data-testid="character-placeholder"][data-who="1316"]\').dataset.expression'), '700224');
  await instant(true);
  assert.equal((await state()).pending, 0);
  assert.equal(await client.evaluate('document.querySelector(\'[data-testid="character-placeholder"][data-who="1316"]\').dataset.expression'), '700212');
  const settled = await state();
  await instant(false);
  assert.equal((await state()).stages, settled.stages, 'Turning timing back on must not replay settled operations');
  await advanceTo(7);
  await click('[data-testid="advance"]');
  assert.equal((await state()).status, 'ending');
  assert.equal((await state()).nid, '7');
  assert.ok((await state()).dialogue, 'Timed end phases keep the departed node readable until navigation completes');
  await waitFor('document.querySelector(\'[data-testid="debug-nid"]\').textContent === "8"', 'delayed end Move starts before nid 8');
  assert.equal(await client.evaluate('document.querySelectorAll(\'[data-testid="stage-event"][data-nid="7"][data-phase="end"][data-op="move"]\').length'), 1);
  await finish();
  checks.push('1004 delayed expression, instant toggle, timed exit fade and end Move preserve stage order and dialogue');

  await startScript('1001');
  await advanceTo(8);
  assert.equal((await state()).nid, '8');
  await waitFor(`(() => {
    const actor = document.querySelector('[data-testid="character-placeholder"][data-who="1316"]');
    const y = Number(actor?.dataset.visualPosition.split(',')[1]);
    return y > -1200 && y < -500;
  })()`, 'delayed Move has an intermediate visual position');
  await screenshot('phase4-movement.png');
  checks.push('1001/8 source Move interpolates the placeholder between its raw endpoints');
  const endSelector = '[data-testid="stage-event"][data-nid="8"][data-phase="end"][data-op="portraitFx"]';
  assert.equal(await client.evaluate(`document.querySelectorAll(${JSON.stringify(endSelector)}).length`), 0);
  const atEight = await state();
  await input('player-name', 'Rerender test');
  await select('gender', 'male');
  await input('script-search', '1001');
  assert.equal((await state()).stages, atEight.stages);
  assert.equal((await state()).nid, '8');
  await click('[data-testid="advance"]');
  assert.equal(await client.evaluate(`document.querySelectorAll(${JSON.stringify(endSelector)}).length`), 1);
  await input('player-name', 'Another rerender');
  assert.equal(await client.evaluate(`document.querySelectorAll(${JSON.stringify(endSelector)}).length`), 1);
  await waitForInput();
  const beforeRapid = await state();
  await client.evaluate(`(() => {
    const button = document.querySelector('[data-testid="advance"]');
    button.click(); button.click(); button.click();
  })()`);
  await settle();
  const afterRapid = await state();
  assert.equal(afterRapid.navigation.length, beforeRapid.navigation.length + 1, 'Rapid input must accept exactly one departure');
  checks.push('1001 node 8 end stage runs exactly once on exit, never on React rerenders');
  checks.push('Rapid Advance clicks accept one departure and preserve the navigation guard');

  await startScript('9015');
  await advanceTo(5);
  await click('[data-testid="advance"]');
  await waitFor('Number(document.querySelector(\'[data-testid="black-screen"]\').dataset.opacity) > 0 && Number(document.querySelector(\'[data-testid="black-screen"]\').dataset.opacity) < 1', 'explicit Black-screen fade is visible');
  await screenshot('phase4-black-fade.png');
  await waitForInput();
  await waitFor('document.querySelector(\'[data-testid="visual-stage"]\').dataset.activeTransitions === "0" && document.querySelector(\'[data-testid="debug-pending-count"]\').textContent === "0"', 'Black-screen source operations and fades complete');
  assert.equal(await client.evaluate('document.querySelector(\'[data-testid="black-screen"]\').dataset.opacity'), '0.0000');
  assert.equal((await state()).nid, '6');
  assert.ok((await state()).dialogue);
  assert.equal(await client.evaluate('document.querySelectorAll(\'[data-testid="stage-event"][data-nid="5"][data-phase="end"][data-op="blackIn"]\').length'), 1);
  assert.equal(await client.evaluate('document.querySelectorAll(\'[data-testid="stage-event"][data-nid="6"][data-phase="start"][data-op="blackOut"]\').length'), 1);
  checks.push('9015/5→6 explicit Black-screen fades cross the end/start boundary once while dialogue stays readable');

  await instant(true);
  await startScript('6012');
  assert.equal((await state()).background, '700004');
  const hasBackground = await checkImage('background');
  const daySource = await client.evaluate('document.querySelector(\'[data-testid="background-image"]\')?.getAttribute("src")');
  const dayStage = await state();
  await select('background-variant', 'night');
  assert.equal((await state()).applied, dayStage.applied);
  assert.deepEqual((await state()).navigation, dayStage.navigation);
  if (hasBackground) {
    await checkImage('background');
    assert.notEqual(await client.evaluate('document.querySelector(\'[data-testid="background-image"]\').getAttribute("src")'), daySource);
  }
  await select('background-variant', 'day');
  for (const [nid, background] of [[2, '700020'], [4, '700010'], [6, '700004']]) {
    await advanceTo(nid);
    assert.equal((await state()).background, background);
    await checkImage('background');
  }
  await advanceTo(10);
  assert.equal((await state()).cg, '700047');
  await select('gender', 'male');
  const hasCG = await checkImage('cg');
  const maleSource = await client.evaluate('document.querySelector(\'[data-testid="cg-image"]\')?.getAttribute("src")');
  const cgStage = await state();
  await select('gender', 'female');
  assert.equal((await state()).applied, cgStage.applied);
  if (hasCG) {
    await checkImage('cg');
    assert.notEqual(await client.evaluate('document.querySelector(\'[data-testid="cg-image"]\').getAttribute("src")'), maleSource);
  }
  await screenshot('phase4-cg.png');
  await advanceTo(25);
  assert.equal((await state()).cg, '700047');
  await advanceTo(26);
  assert.equal((await state()).cg, '');
  await click('[data-testid="restart"]');
  assert.equal((await state()).nid, '1');
  assert.equal((await state()).cg, '');
  assert.equal((await state()).background, '700004');
  checks.push('6012 background changes, persistent CG/Clean, explicit gender variants, day/night override and stage reset');

  await startScript('1002');
  await advanceTo(5);
  assert.equal((await state()).cg, '700012');
  const cgDecoded = await checkImage('cg');
  if (cgDecoded) {
    const beforeError = await state();
    // Dispatch the actual image error event to exercise the React fallback
    // without deliberately making a failing network request.
    await client.evaluate('document.querySelector(\'[data-testid="cg-image"]\').dispatchEvent(new Event("error"))');
    await settle();
    assert.ok(await client.evaluate('document.querySelector(\'[data-testid="asset-fallback"][data-kind="cg"]\').textContent.includes("failed to load or decode")'));
    assert.equal((await state()).applied, beforeError.applied);
    assert.equal((await state()).nid, beforeError.nid);
    assert.equal(await client.evaluate('document.querySelectorAll(\'[data-testid="asset-image-error"]\').length'), 1);
    await click('[data-testid="restart"]');
    assert.equal(await client.evaluate('document.querySelectorAll(\'[data-testid="asset-image-error"]\').length'), 0);
    await advanceTo(5);
    await checkImage('cg');
  }
  await advanceTo(12);
  assert.equal((await state()).cg, '');
  await finish();
  checks.push('1002 CG load/clear and image-error fallback preserve playback and stage event counts');

  await startScript('3018');
  assert.equal((await state()).background, '800001');
  assert.ok(await client.evaluate('document.querySelector(\'[data-testid="asset-fallback"][data-kind="background"]\').textContent.includes("800001")'));
  await finish();
  checks.push('real 3018 missing background 800001 has a labeled fallback and the script completes');

  await startScript('1053');
  assert.equal((await state()).status, 'completed');
  assert.equal((await state()).flow, 2);
  assert.ok(await client.evaluate('document.body.textContent.includes("Skipped movie VideoSolarSchoolOP01 and its audio.")'));
  assert.equal(await client.evaluate('document.querySelectorAll(\'[data-testid="stage-event"][data-op="audio"]\').length'), 0);
  checks.push('1053 movie-only script skips media/audio and clearly completes');

  await startScript('x1');
  await input('player-name', 'Solaris Tester');
  assert.equal((await state()).scriptId, 'x1');
  assert.ok((await state()).dialogue.includes('Solaris Tester'));
  await select('group-filter', '索拉学院_后日谈');
  assert.ok(await client.evaluate('document.querySelector(\'[data-testid="search-count"]\').textContent.startsWith("1 matching")'));
  await select('group-filter', '');
  checks.push('string ID x1, group filtering, English speaker/text, and live PlayerName substitution');
  await startScript('1001');
  await advanceTo(10);
  await screenshot('phase4-desktop.png');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await settle();
  assert.ok(await client.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'Mobile page overflows horizontally');
  await screenshot('phase4-mobile.png');
  checks.push('desktop and mobile page layouts remain readable without horizontal overflow');
  }

  assert.deepEqual(failures, [], 'Browser reported JavaScript or HTTP errors');
  await writeFile(new URL(resultsFile, resultDir), `${JSON.stringify({ mode, checks, errors: failures }, null, 2)}\n`);
  for (const check of checks) process.stdout.write(`PASS ${check}\n`);
  process.stdout.write(`PASS ${checks.length} browser checks (${mode}); no JavaScript or resource errors. Screenshots: test-results/${historyOnly ? 'phase5-history' : 'phase4-reading'}-*.png\n`);
} catch (error) {
  await writeFile(new URL(resultsFile, resultDir), `${JSON.stringify({ mode, status: 'failed', completedChecks: checks, error: error.message, diagnostics: processErrors.slice(-2500) }, null, 2)}\n`).catch(() => {});
  process.stderr.write(`${error.stack ?? error}\n${processErrors.slice(-2500)}\n`);
  process.exitCode = 1;
} finally {
  client?.close();
  browser?.kill('SIGTERM');
  server?.kill('SIGTERM');
  await delay(150);
  await rm(profileDir, { recursive: true, force: true });
}
