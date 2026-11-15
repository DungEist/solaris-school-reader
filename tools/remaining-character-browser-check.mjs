/** Four-blocker production checks using the existing CDP/extraction-free helper.
 * Run after npm run build. Only loopback HTTP and local Chromium are used. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = '/tmp/solarschool-four-blockers/browser';
await mkdir(out, { recursive: true });
const profile = await mkdtemp('/tmp/solarschool-blocker-browser-');
const failures = [], checks = [];
const helper = await readFile(join(root, 'tools/browser-check.mjs'), 'utf8');
const CDP = new Function('failures', helper.slice(helper.indexOf('class CDP {'), helper.indexOf('async function until(')) + '\nreturn CDP;')(failures);
const base = 'http://127.0.0.1:4181';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4181', '--strictPort'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
let browser, client, processErrors = '';
server.stderr.on('data', data => { processErrors += data; });
async function until(check, description) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await check()) return; await delay(50); }
  throw new Error(`Timed out: ${description}`);
}
const evaluate = source => client.evaluate(source);
const state = () => evaluate(`({...document.querySelector('[data-testid="runner-state"]').dataset})`);
async function click(selector) {
  await until(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled)`), selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(30);
}
async function select(selector, value) {
  await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event('change',{bubbles:true})); })()`); await delay(30);
}
async function start(id) {
  const previous = await state(); await select('[data-testid="script-select"]', id); await click('[data-testid="start"]');
  await until(async () => { const s=await state(); return s.scriptId===id && s.runId!==previous.runId && ['dialogue','choices'].includes(s.status); }, `start ${id}`);
}
async function walkTo(nid) {
  for (let step=0; step<160; step++) {
    const s=await state(); assert.notEqual(s.status,'error'); assert.notEqual(s.status,'completed');
    if (Number(s.nid)===nid && ['dialogue','choices'].includes(s.status)) return;
    if (['running','ending'].includes(s.status)) { await delay(25); continue; }
    await until(async () => (await state()).inputReady==='true','reading input');
    await click(s.status==='choices' ? s.hiddenChoice==='true' ? '[data-testid="hidden-choice-override"][data-option-index="0"]' : '[data-testid="choice"][data-option-index="0"]' : '[data-testid="advance"]');
  }
  throw new Error(`Could not reach ${nid}`);
}
async function drawing(slug) {
  await until(() => evaluate(`document.querySelector('[data-testid="${slug}-canvas"]')?.dataset.rendererState==='ready'`), `${slug} ready`);
  const pixels = await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>{const c=document.querySelector('[data-testid="${slug}-canvas"]');const gl=c.getContext('webgl2')||c.getContext('webgl');const bytes=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);let n=0;for(let i=3;i<bytes.length;i+=4)if(bytes[i]>8)n++;resolve({alphaPixels:n,glError:gl.getError()});}))`);
  assert.ok(pixels.alphaPixels>500); assert.equal(pixels.glError,0); return pixels;
}
async function noUnknownPortrait() {
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-testid="character-placeholder"][data-talker="850013"], [data-testid="npc-portrait"][data-talker="850013"]'))`),false);
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-testid="debug-character"][data-who="178"]'))`),false);
}
try {
  await until(async () => { try { return (await fetch(base)).ok; } catch { return false; } }, 'production preview');
  process.stdout.write('Production preview ready.\n');
  browser = spawn(process.env.CHROMIUM_BIN ?? '/usr/bin/chromium', ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--enable-unsafe-swiftshader','--use-angle=swiftshader',`--user-data-dir=${profile}`,'--remote-debugging-pipe','about:blank'], { stdio: ['ignore','ignore','pipe','pipe','pipe'] });
  browser.stderr.on('data',data=>{processErrors+=data;}); client=new CDP(browser.stdio[3],browser.stdio[4]);
  const target=await client.send('Target.createTarget',{url:'about:blank'});
  client.sessionId=(await client.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
  for (const domain of ['Page','Runtime','Log','Network']) await client.send(domain+'.enable');
  await client.send('Page.navigate',{url:base+'/?script=1001'});
  await until(() => evaluate(`Boolean(document.querySelector('[data-testid="script-select"] option[value="1001"]'))`),'catalog');
  await click('[data-testid="instant-text"]');
  process.stdout.write('Reader and Chromium ready.\n');
  for (const gender of ['male','female']) {
    await select('[data-testid="gender"]',gender); await start('1001');
    for (const [nid,expression] of [[1,700131],[11,700133],[16,700134],[21,700129]]) {
      await walkTo(nid);
      await until(() => evaluate(`Boolean(document.querySelector('[data-testid="rover-${gender}-canvas"]'))`),'selected Rover resource');
      assert.equal(await evaluate(`document.querySelector('[data-testid="rover-${gender}-canvas"]').dataset.rendererState`),'empty');
      assert.equal(await evaluate(`Boolean(document.querySelector('[data-testid="rover-${gender==='male'?'female':'male'}-canvas"]'))`),false);
      const source=await evaluate(`(()=>{const e=document.querySelector('[data-testid="debug-character"][data-who="750088"]');return {portrait:e.dataset.portrait,text:e.textContent};})()`);
      assert.equal(source.portrait,'false'); assert.ok(source.text.includes('expr '+expression));
      assert.equal(await evaluate(`Boolean(document.querySelector('[data-testid="character-placeholder"][data-who="750088"]'))`),false);
      checks.push({script:'1001',nid,gender,expression,portrait:'source-hidden'});
      process.stdout.write(`${gender}: source-hidden Rover at 1001/${nid}.\n`);
    }
  }
  await start('1007'); await walkTo(13);
  const orphan=await evaluate(`({...document.querySelector('[data-testid="debug-character"][data-who="1759"]').dataset})`);
  assert.equal(orphan.present,'false'); assert.equal(orphan.portrait,'false'); assert.equal(orphan.avatar,'false');
  await click('[data-testid="choice"][data-option-id="2"]'); await walkTo(19);
  assert.equal(await evaluate(`document.querySelector('[data-testid="debug-character"][data-who="1759"]').dataset.present`),'false');
  checks.push({script:'1007',nids:[13,19],orphanRemainsOffstage:true,shorekeeper:await drawing('shorekeeper')});
  process.stdout.write('1007/13,19: unnamed stage remains absent; Shorekeeper draws.\n');
  await start('9004'); await walkTo(29); await noUnknownPortrait(); await walkTo(30);
  checks.push({script:'9004',nids:[29,30],unknownRemainsTextOnly:true,changli:await drawing('changli')});
  process.stdout.write('9004/29,30: unknown voice has no portrait; Changli draws.\n');
  await start('9014'); await walkTo(7); await click('[data-testid="choice"][data-option-id="9"]'); await walkTo(15); await noUnknownPortrait();
  checks.push({script:'9014',nid:15,unknownRemainsTextOnly:true,cartethyia:await drawing('cartethyia')});
  process.stdout.write('9014/15: unknown voice has no portrait; Cartethyia draws.\n');
  await start('1001');
  await until(() => evaluate(`!document.querySelector('canvas[data-renderer-state="ready"]')`),'script switch cleanup');
  const previousRun = (await state()).runId;
  await click('[data-testid="restart"]');
  await until(async () => (await state()).runId!==previousRun && await evaluate(`!document.querySelector('canvas[data-renderer-state="ready"]')`),'restart cleanup');
  assert.deepEqual(failures,[]);
  await writeFile(join(out,'result.json'),JSON.stringify({mode:'production-http',checks,errors:failures,restartCleared:true,limits:'Rover remains source-hidden; GPU Rover drawing and comparison with game appearance are unverified.'},null,2)+'\n');
  await rm(join(out,'failure.json'),{force:true});
  process.stdout.write(`PASS ${checks.length} four-target production-browser checkpoints; no resource or JavaScript errors.\n`);
} catch(error) {
  await writeFile(join(out,'failure.json'),JSON.stringify({error:String(error.stack),checks,failures,processErrors:processErrors.slice(-3000)},null,2)+'\n');
  process.stderr.write(String(error.stack)+'\n'); process.exitCode=1;
} finally {
  client?.close(); browser?.kill('SIGTERM'); server.kill('SIGTERM'); await delay(200); await rm(profile,{recursive:true,force:true});
}
