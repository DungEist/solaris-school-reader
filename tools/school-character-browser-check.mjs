/** Focused real-reader portrait checks, reusing the existing local CDP client.
 * Run after npm run build. Only loopback HTTP and the local Chromium are used.
 * Small screenshots/records go to /tmp; no dialogue or large evidence export.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = '/tmp/solarschool-all-characters/browser';
await mkdir(out, { recursive: true });
const profile = await mkdtemp('/tmp/solarschool-character-browser-');
const failures = [];
const helper = await readFile(join(root, 'tools/browser-check.mjs'), 'utf8');
const CDP = new Function('failures', helper.slice(helper.indexOf('class CDP {'), helper.indexOf('async function until(')) + '\nreturn CDP;')(failures);
const port = 4179;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let browser, client, processErrors = '';
server.stderr.on('data', data => { processErrors += data; });
const results = [];

async function until(check, description) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await check()) return; await delay(50); }
  throw new Error(`Timed out: ${description}`);
}
const evaluate = source => client.evaluate(source);
const state = () => evaluate(`(() => { const e = document.querySelector('[data-testid="runner-state"]'); return e ? {...e.dataset} : null; })()`);
async function click(selector) {
  await until(() => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return Boolean(e && !e.disabled); })()`), `enabled ${selector}`);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await delay(30);
}
async function start(id) {
  const previous = await state();
  await evaluate(`(() => { const e = document.querySelector('[data-testid="script-select"]'); e.value = ${JSON.stringify(id)}; e.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await click('[data-testid="start"]');
  await until(async () => { const current = await state(); return current.scriptId === id && current.runId !== previous.runId && ['dialogue','choices','completed'].includes(current.status); }, `new ${id} run loaded`);
}
async function walkTo(nid) {
  for (let step = 0; step < 180; step++) {
    const current = await state();
    assert.notEqual(current.status, 'error');
    assert.notEqual(current.status, 'completed', `Completed before node ${nid}`);
    if (Number(current.nid) === nid && ['dialogue', 'choices'].includes(current.status)) return;
    if (current.status === 'running' || current.status === 'ending') { await delay(25); continue; }
    await until(async () => (await state()).inputReady === 'true', 'reading input');
    await click(current.status === 'choices' ? current.hiddenChoice === 'true' ? '[data-testid="hidden-choice-override"][data-option-index="0"]' : '[data-testid="choice"][data-option-index="0"]' : '[data-testid="advance"]');
  }
  throw new Error(`Could not reach node ${nid}`);
}
async function pixels(slug) {
  return evaluate(`new Promise(resolve => requestAnimationFrame(() => {
    const canvas = document.querySelector('[data-testid="${slug}-canvas"]');
    const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
    if (!gl) return resolve({error:'WebGL context missing'});
    const bytes = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    let count=0, minX=canvas.width, minY=canvas.height, maxX=-1, maxY=-1, maxAlpha=0;
    for (let y=0; y<canvas.height; y++) for (let x=0; x<canvas.width; x++) {
      const a=bytes[(y*canvas.width+x)*4+3];
      if (a>8) { count++; minX=Math.min(minX,x); minY=Math.min(minY,y); maxX=Math.max(maxX,x); maxY=Math.max(maxY,y); maxAlpha=Math.max(maxAlpha,a); }
    }
    resolve({width:canvas.width,height:canvas.height,alphaPixels:count,bounds:[minX,minY,maxX,maxY],maxAlpha,glError:gl.getError()});
  }))`);
}
async function screenshot(name) {
  const rect = await evaluate(`(() => { const r=document.querySelector('[data-testid="visual-stage"]').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
  const shot = await client.send('Page.captureScreenshot', { format:'png', clip:{...rect,scale:1} });
  await writeFile(join(out, name + '.png'), Buffer.from(shot.data, 'base64'));
}

try {
  await until(async () => { try { return (await fetch(base)).ok; } catch { return false; } }, 'local production preview');
  browser = spawn(process.env.CHROMIUM_BIN ?? '/usr/bin/chromium', ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--enable-unsafe-swiftshader','--use-angle=swiftshader',`--user-data-dir=${profile}`,'--remote-debugging-pipe','about:blank'], { stdio:['ignore','ignore','pipe','pipe','pipe'] });
  browser.stderr.on('data', data => { processErrors += data; });
  client = new CDP(browser.stdio[3], browser.stdio[4]);
  const target = await client.send('Target.createTarget', {url:'about:blank'});
  client.sessionId = (await client.send('Target.attachToTarget', {targetId:target.targetId,flatten:true})).sessionId;
  for (const domain of ['Page','Runtime','Log','Network']) await client.send(domain+'.enable');
  await client.send('Emulation.setDeviceMetricsOverride', {width:1280,height:960,deviceScaleFactor:1,mobile:false});
  await client.send('Page.navigate', {url:base+'/?script=1024'});
  await until(() => evaluate(`Boolean(document.querySelector('[data-testid="script-select"] option[value="1024"]'))`), 'English catalog');
  await click('[data-testid="instant-text"]');
  const cases = [
    ['cartethyia','1024',1], ['shorekeeper','1002',4], ['phoebe','4003',1],
    ['buling','1041',1], ['roccia','1030',1], ['verina','1016',1],
    ['xiangli-yao','1034',1], ['galbrena','1038',1], ['ciaccona','4021',1],
    ['chisa','1011',2], ['abby','1001',10], ['changli','1009',5],
  ];
  for (const [slug,id,nid] of cases) {
    await start(id); await walkTo(nid);
    await until(() => evaluate(`document.querySelector('[data-testid="${slug}-canvas"]')?.dataset.rendererState === 'ready'`), `${slug} ready`);
    await delay(450);
    const drawing = await pixels(slug);
    assert.ok(drawing.alphaPixels > 500, `${slug}: assembled opaque pixels required: ${JSON.stringify(drawing)}`);
    assert.equal(drawing.glError,0);
    const runtimeScripts = await evaluate(`[...document.scripts].filter(s=>s.src.endsWith('/characters/changli/spine-player.js')).length`);
    assert.equal(runtimeScripts,1);
    const placeholders = await evaluate(`[...document.querySelectorAll('[data-testid="character-placeholder"]')].map(e=>e.dataset.who)`);
    const renderedWhos = await evaluate(`document.querySelector('[data-testid="${slug}-canvas"]').dataset.renderedWhos.split(',')`);
    assert.ok(renderedWhos.every(who=>!placeholders.includes(who)), `${slug}: duplicate fallback`);
    const roverVisible = await evaluate(`Boolean(document.querySelector('[data-testid="rover-male-canvas"][data-renderer-state="ready"], [data-testid="rover-female-canvas"][data-renderer-state="ready"]'))`);
    assert.equal(roverVisible,false,'Source-hidden Rover must stay hidden');
    if (slug==='cartethyia' || slug==='abby' || slug==='changli') await screenshot(slug);
    results.push({character:slug,script:id,nid,drawing,runtimeScripts,placeholders});
    process.stdout.write(`${slug}: drawn at ${id}/${nid}\n`);
  }

  await start('1011'); await walkTo(27); await delay(1150);
  for (const slug of ['chisa','buling']) {
    await until(() => evaluate(`document.querySelector('[data-testid="${slug}-canvas"]')?.dataset.rendererState==='ready'`), `simultaneous ${slug}`);
    assert.ok((await pixels(slug)).alphaPixels>500);
  }
  await screenshot('chisa-buling');
  results.push({check:'simultaneous independent Chisa and Buling',script:'1011',nid:27});

  await start('9011'); await walkTo(1); await delay(450);
  await until(() => evaluate(`document.querySelector('[data-testid="npc-portrait"][data-who="1764"]')?.dataset.rendererState==='ready'`), 'source static NPC portrait');
  assert.equal(await evaluate(`document.querySelector('[data-testid="npc-portrait"][data-who="1764"]').dataset.talker`),'700031');
  assert.ok((await pixels('cartethyia')).alphaPixels>500);
  await screenshot('cartethyia-npc');
  results.push({check:'source static NPC alongside Spine',script:'9011',nid:1,talkerId:700031});

  const catalog = JSON.parse(await readFile(join(root,'public/data/assets.character-catalog.json'),'utf8'));
  const manifest = JSON.parse(await readFile(join(root,'public/data/assets.manifest.json'),'utf8'));
  assert.equal(catalog.requiredTalkerIds.length,37);
  const textureFiles = (await import('../src/spine/SchoolPortraitCatalog.ts')).schoolStaticPortraitData;
  const uniqueTextures = [...new Map(textureFiles.map(d=>[d.textureFile,d])).values()];
  for (const definition of uniqueTextures) {
    const loaded = await evaluate(`new Promise(resolve=>{const im=new Image();im.onload=()=>resolve([im.naturalWidth,im.naturalHeight]);im.onerror=()=>resolve(null);im.src=${JSON.stringify(base+'/assets/solarschool/characters/npc/'+definition.textureFile)};})`);
    assert.deepEqual(loaded,[definition.width,definition.height]);
  }
  const female = (await import('../src/spine/SchoolPortraitCatalog.ts')).additionalSchoolPortraitData.find(d=>d.talkerId===850002);
  for (const file of [female.stem+'.skel',female.stem+'.atlas',female.metadataFile,female.textureFile]) {
    assert.equal(await evaluate(`fetch(${JSON.stringify(base+'/assets/solarschool/characters/'+female.slug+'/'+file)}).then(r=>r.ok)`),true);
  }
  assert.ok(manifest.talkers['850002'].spineSkeleton.includes('SolarSchool_Female'));
  results.push({check:'all 10 static image paths decode and source-hidden female resources load; GPU female drawing not checked'});
  await start('1009'); await walkTo(5);
  await until(() => evaluate(`document.querySelector('[data-testid="changli-canvas"]')?.dataset.rendererState==='ready'`), 'Changli before restart');
  await click('[data-testid="restart"]');
  await until(() => evaluate(`!document.querySelector('canvas[data-renderer-state="ready"], [data-testid="npc-portrait"][data-renderer-state="ready"]')`), 'restart clears completed entries');
  assert.deepEqual(failures,[]);
  await writeFile(join(out,'result.json'),JSON.stringify({mode:'production-http',results,errors:failures,restartCleared:true,visualInspection:'Separate screenshot review required; GPU alpha checks do not verify appearance.'},null,2)+'\n');
  process.stdout.write(`PASS ${results.length} focused production-browser checks; no resource or JavaScript errors.\n`);
} catch (error) {
  await writeFile(join(out,'failure.json'),JSON.stringify({error:String(error.stack),processErrors:processErrors.slice(-6000),results,errors:failures},null,2)+'\n');
  process.stderr.write(String(error.stack)+'\n'+processErrors.slice(-1600)+'\n');
  process.exitCode=1;
} finally {
  client?.close(); browser?.kill('SIGTERM'); server.kill('SIGTERM');
  await delay(200); await rm(profile,{recursive:true,force:true});
}
