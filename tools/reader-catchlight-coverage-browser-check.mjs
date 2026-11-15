/** Representative production Reader recordings for the route coverage audit.
 * Uses ordinary script selection, advances and choices. The probe only observes
 * source attachments/clocks and copies actual renderer pixels into a fixed crop.
 * Run after npm run build. Optional --case=name and --resume select saved cases.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const resultDir = process.env.READER_RESULT_DIR ? resolve(process.env.READER_RESULT_DIR) : join(root, 'test-results/reader-catchlights/coverage/playback');
const profile = await mkdtemp(join(tmpdir(), 'reader-catchlight-coverage-'));
const manifest = JSON.parse(await readFile(join(root, 'public/data/assets.manifest.json'), 'utf8'));
const allCases = [
  { name: 'buling-pose-change', character: 'Buling', slug: 'buling', script: '1011', nid: 29, afterNid: 30, composition: 'stage', who: '250004', fromExpression: 700082, toExpression: 700074, irisSlots: ['eye_眼珠'], catchlightSlots: ['eye_高亮'], choices: { 8: '2' }, durationSeconds: 2.4, advanceAtSeconds: .8 },
  { name: 'ciaccona-wink', character: 'Ciaccona', slug: 'ciaccona', script: '12003', nid: 9, afterNid: 10, composition: 'stage', who: '150036', fromExpression: 700061, toExpression: 700064, irisSlots: ['A_眼珠'], catchlightSlots: ['A_高亮'], extraEyeSlots: ['参考'], durationSeconds: 2.4, advanceAtSeconds: .8 },
  { name: 'abby-avatar-pose-change', character: 'Abby', slug: 'abby', script: '1034', nid: 56, afterNid: 57, composition: 'avatar', who: '1316', fromExpression: 700212, toExpression: 700222, irisSlots: ['01_A_眼珠', '3_抬头_眼珠'], catchlightSlots: ['01_A_高光'], durationSeconds: 2.4, advanceAtSeconds: .8 },
  { name: 'rover-male-avatar', character: 'Male Rover', slug: 'rover-male', script: '1001', nid: 2, composition: 'avatar', who: '750088', gender: 'male', fromExpression: 700131, irisSlots: ['01_眼珠'], catchlightSlots: ['01_高亮'], durationSeconds: 2 },
  { name: 'rover-female-avatar', character: 'Female Rover', slug: 'rover-female', script: '1001', nid: 2, composition: 'avatar', who: '750088', gender: 'female', fromExpression: 700056, sourceExpression: 700131, irisSlots: ['eye_眼珠'], catchlightSlots: ['eye_高亮'], durationSeconds: 2 },
  { name: 'rover-male-stage', character: 'Male Rover', slug: 'rover-male', script: '1051', nid: 35, composition: 'stage', who: '750088', gender: 'male', fromExpression: 700127, irisSlots: ['01_眼珠'], catchlightSlots: ['01_高亮'], choices: { 19: '5' }, durationSeconds: 2 },
  { name: 'rover-female-stage', character: 'Female Rover', slug: 'rover-female', script: '1051', nid: 35, composition: 'stage', who: '750088', gender: 'female', fromExpression: 700127, irisSlots: ['eye_眼珠'], catchlightSlots: ['eye_高亮'], choices: { 19: '5' }, durationSeconds: 2 },
  { name: 'ciaccona-natural-blink', character: 'Ciaccona', slug: 'ciaccona', script: '12003', nid: 6, composition: 'stage', who: '150036', mode: 'blink', fromExpression: 700063, irisSlots: ['A_眼珠'], catchlightSlots: ['A_高亮'], durationSeconds: 2 },
];
const requested = process.argv.find(value => value.startsWith('--case='))?.slice(7);
const cases = allCases.filter(item => !requested || item.name === requested).map(item => ({
  ...item, cropPoses: [item.fromExpression, item.toExpression].filter(Boolean).map(id => {
    const expression = manifest.expressions[String(id)];
    assert.ok(expression, `Recorded source expression ${id} exists.`);
    return { id, body: expression.body, mouth: expression.mouth, eye: expression.eye };
  }),
}));
assert.ok(cases.length, 'Requested recording case exists.');
const resume = process.argv.includes('--resume');
let previousReport;
try{previousReport=JSON.parse(await readFile(join(resultDir,'production-browser-result.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const measurements = [], navigation = resume ? [...(previousReport?.navigation ?? [])] : [], errors = [];
const servedResources = new Map();
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
  for (let index = 0; index < 180; index++) {
    await dismissNotices();
    await until(`(()=>{const s=document.querySelector('${tid('runner-state')}');return ['dialogue','choices'].includes(s.dataset.status)&&s.dataset.textComplete==='true'&&s.dataset.inputReady==='true';})()`, 'dialogue input');
    const before = await state(); assert.equal(before.scriptId, target.script);
    if (before.nid === String(target.nid)) return;
    const choices = await client.evaluate(`Array.from(document.querySelectorAll('${tid('choice')}')).filter(e=>!e.disabled&&e.getClientRects().length).map(e=>e.dataset.optionId)`);
    if (before.status === 'choices' && before.hiddenChoice !== 'true') {
      const selected = target.choices?.[before.nid] ?? choices[0];
      assert.ok(selected && choices.includes(selected), 'An authored eligible choice is available.');
      await clickSelector(`${tid('choice')}[data-option-id="${selected}"]:not(:disabled)`);
    } else await click('advance');
    navigation.push({ case: target.name, before, choices, after: await state() });
  }
  throw new Error('Did not reach ' + target.script + '/' + target.nid);
}
async function openStory(script) {
  await dismissNotices(); await click('menu'); await click('switch-view');
  await until(`document.querySelector('${tid('interface')}').dataset.interface==='developer'&&!!document.querySelector('${tid('script-select')}')`, 'source scene selector');
  await client.evaluate(`(()=>{const e=document.querySelector('${tid('script-select')}');e.value=${JSON.stringify(script)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await settle(); await click('continue-script');
  await until(`document.querySelector('${tid('runner-state')}').dataset.scriptId===${JSON.stringify(script)}&&['dialogue','choices'].includes(document.querySelector('${tid('runner-state')}').dataset.status)`, 'story ' + script);
  await click('switch-view');
  await until(`document.querySelector('${tid('interface')}').dataset.interface==='reader'`, 'normal Reader');
}
async function setGender(gender) {
  await click('settings');
  await client.evaluate(`(()=>{const e=document.querySelector('${tid('gender')}');e.value=${JSON.stringify(gender)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await settle(); await click('settings-close');
}

function browserProbe() {
  const states = new WeakMap(), observations = new Map();
  const apply = spine.AnimationState.prototype.apply;
  spine.AnimationState.prototype.apply = function(skeleton) { const value = apply.apply(this, arguments); states.set(skeleton, this); return value; };
  const proto = spine.SceneRenderer.prototype, draw = proto.drawSkeleton, end = proto.end, begin = proto.begin;
  proto.begin = function() { this.__coverageDraws = []; return begin.apply(this, arguments); };
  proto.drawSkeleton = function(skeleton) { this.__coverageDraws.push(skeleton); return draw.apply(this, arguments); };
  const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  function points(slot, renderer) {
    const attachment = slot?.attachment; if (!attachment) return [];
    const values = new Float32Array(attachment.worldVerticesLength ?? 8);
    if (attachment.worldVerticesLength) attachment.computeWorldVertices(slot, 0, values.length, values, 0, 2);
    else if (attachment.computeWorldVertices) attachment.computeWorldVertices(slot, values, 0, 2);
    else return [];
    return Array.from({ length: values.length / 2 }, (_, index) => {
      const value = renderer.camera.worldToScreen(new spine.Vector3(values[2 * index], values[2 * index + 1], 0), renderer.canvas.width, renderer.canvas.height);
      return [value.x, renderer.canvas.height - value.y];
    });
  }
  function bounds(values) {
    const x = Math.min(...values.map(p => p[0])), y = Math.min(...values.map(p => p[1]));
    const width = Math.max(...values.map(p => p[0])) - x, height = Math.max(...values.map(p => p[1])) - y;
    return { x, y, width, height, centerX: x + width / 2, centerY: y + height / 2 };
  }
  function partition(values) {
    const sorted = values.map((point, index) => ({ point, index })).sort((a,b) => a.point[0] - b.point[0]);
    let cut = 0, gap = 0;
    for (let index = 2; index < sorted.length - 2; index++) {
      const current = sorted[index].point[0] - sorted[index - 1].point[0];
      if (current > gap) { cut = index; gap = current; }
    }
    if (!cut || gap < bounds(values).width / 5) throw new Error('Cannot separate the two native iris guides.');
    return [sorted.slice(0,cut), sorted.slice(cut)].map((items,index) => ({ name: index ? 'screen-right' : 'screen-left', indices: items.map(item=>item.index), bounds: bounds(items.map(item=>item.point)) }));
  }
  function start(observation, renderer, skeleton) {
    const target = observation.target;
    let irises = target.irisSlots.flatMap(name => points(skeleton.findSlot(name), renderer));
    // Fresh, undrawn source poses only determine a union crop. No actual actor,
    // stage entry, clip, phase, camera or animation scheduler is modified.
    const union = [...irises];
    let sourceOpenIrises = [];
    for (const pose of target.cropPoses) {
      const source = new spine.Skeleton(skeleton.data);
      if (skeleton.data.skins.length) source.setSkinByName(skeleton.data.skins[0].name);
      for (const name of [pose.body,pose.mouth,pose.eye]) {
        const clip = skeleton.data.findAnimation(name); if (!clip) continue;
        clip.apply(source,0,0,true,[],1,spine.MixBlend.replace,spine.MixDirection.mixIn);
      }
      source.x = skeleton.x; source.y = skeleton.y; source.scaleX = skeleton.scaleX; source.scaleY = skeleton.scaleY; source.updateWorldTransform();
      const sourceIrises = target.irisSlots.flatMap(name => points(source.findSlot(name), renderer));
      union.push(...sourceIrises);
      if (pose.id === target.fromExpression) sourceOpenIrises = sourceIrises;
    }
    // A naturally occurring blink can detach or collapse the iris before its
    // first observed frame. Fixed guides come from the undrawn open-eye source
    // pose in that case; the real blink and its recorded geometry stay intact.
    if (target.mode === 'blink') irises = sourceOpenIrises;
    if (!irises.length || !union.length) return false;
    const output = document.createElement('canvas'); output.width = 960; output.height = 420;
    const context = output.getContext('2d'), all = bounds(union), margin = all.height * .5;
    const crop = { x: all.x-margin, y: all.y-margin, width: all.width+2*margin, height: all.height+2*margin };
    const zoom = Math.min(912/crop.width, 300/crop.height);
    const destination = { x: 24+(912-crop.width*zoom)/2, y: 52+(300-crop.height*zoom)/2, width: crop.width*zoom, height: crop.height*zoom };
    const mapPoint = p => [destination.x+(p[0]-crop.x)*zoom, destination.y+(p[1]-crop.y)*zoom];
    const eyes = partition(irises).map(eye => ({ ...eye, irisBBox: bounds(eye.indices.map(i=>mapPoint(irises[i]))) }));
    for (const eye of eyes) eye.irisCenter = { x: eye.irisBBox.centerX, y: eye.irisBBox.centerY };
    observation.capture = { output, context, crop, destination, zoom, eyes, mapPoint,
      initialIrisGuideSource: target.mode === 'blink' ? 'undrawn-source-open-eye-pose' : 'actual-first-captured-iris' };
    observation.startedAt = performance.now(); observation.frames = [];
    return true;
  }
  function eyeLayers(skeleton, renderer, capture, target) {
    return skeleton.slots.filter(slot => /眼|高亮|高光|睫|眉|wink/i.test(slot.data.name+' '+(slot.attachment?.name??'')) || slot.attachment?.constructor.name==='ClippingAttachment' || target.extraEyeSlots?.includes(slot.data.name))
      .map(slot => {
        const attachment = slot.attachment;
        return { slot: slot.data.name, slotIndex: slot.data.index, attachment: attachment?.name ?? null, type: attachment?.constructor.name ?? null,
          region: attachment?.region?.name ?? null, clippingEndSlot:attachment?.endSlot?.name??null, sourceUVs: attachment?.uvs ? Array.from(attachment.uvs) : [], sourceTriangles: attachment?.triangles ? Array.from(attachment.triangles) : [],
          deform: Array.from(slot.deform), color: { r: slot.color.r, g: slot.color.g, b: slot.color.b, a: slot.color.a }, drawOrderIndex: skeleton.drawOrder.indexOf(slot),
          vertices: points(slot,renderer).map(capture.mapPoint) };
      });
  }
  function finish(observation) {
    observation.stopping = true;
    const {context,output} = observation.capture;
    // Compress only after the interval, preserving the actual frame clock.
    for (const frame of observation.frames) {
      context.putImageData(frame.imageData,0,0); frame.png = output.toDataURL('image/png').split(',')[1]; delete frame.imageData;
    }
    observation.done = true;
  }
  proto.end = function() {
    const drew = !!this.activeRenderer && this.__coverageDraws?.length, skeletons = this.__coverageDraws?.slice() ?? [];
    const value = end.apply(this,arguments); if (!drew) return value;
    for (const observation of observations.values()) {
      if (observation.done || observation.stopping || !this.canvas.isConnected) continue;
      const target = observation.target, inAvatar = !!this.canvas.closest('.speaker-avatar');
      if ((target.composition==='avatar')!==inAvatar || this.canvas.dataset.testid!==target.slug+'-canvas') continue;
      const whos = this.canvas.dataset.renderedWhos?.split(',') ?? [], whoIndex = whos.indexOf(target.who);
      if (whoIndex < 0) continue;
      const skeleton = skeletons[whoIndex]; if (!skeleton) continue;
      const animationState = states.get(skeleton), current = animationState?.getCurrent(2);
      if (!current) continue;
      const runner = document.querySelector('[data-testid="runner-state"]')?.dataset;
      if (!observation.capture) {
        if (performance.now()-observation.armedAt<250 || runner?.nid!==String(target.nid)) continue;
        if (target.mode==='blink' ? current.loop!==false || current.trackTime>.07 : current.animation.name!==target.cropPoses[0].eye) continue;
        if (!target.afterNid && target.mode!=='blink' && current.trackTime>.07) continue;
        if (!start(observation,this,skeleton)) continue;
      }
      const capture = observation.capture, context = capture.context;
      const timeSeconds = (performance.now()-observation.startedAt)/1000;
      const layers = eyeLayers(skeleton,this,capture,target);
      const currentExpression = Number(this.canvas.dataset.expressions?.split(',')[whoIndex]);
      context.fillStyle='#f8f1e7'; context.fillRect(0,0,960,420);
      context.fillStyle='#27302e'; context.font='bold 20px sans-serif';
      context.fillText(target.character+' — '+target.composition+' · '+(target.afterNid?'pose / expression change':target.mode==='blink'?'natural blink / original speed':'original eye playback'),24,31);
      context.drawImage(this.canvas,capture.crop.x,capture.crop.y,capture.crop.width,capture.crop.height,capture.destination.x,capture.destination.y,capture.destination.width,capture.destination.height);
      context.strokeStyle='#168a8a'; context.lineWidth=1;
      for(const eye of capture.eyes){const b=eye.irisBBox; context.beginPath();context.moveTo(b.centerX-4,b.centerY);context.lineTo(b.centerX+4,b.centerY);context.moveTo(b.centerX,b.centerY-4);context.lineTo(b.centerX,b.centerY+4);context.stroke();}
      context.fillStyle='#27302e'; context.font='14px sans-serif';
      context.fillText('t '+timeSeconds.toFixed(3)+' s · '+target.script+'/'+runner.nid+' · rendered expression '+currentExpression+' · '+current.animation.name,24,380);
      context.fillText('Fixed source crop / teal iris guides · actual Reader frames · original playback speed',24,402);
      const irisVertices = target.irisSlots.flatMap(name=>points(skeleton.findSlot(name),this)).map(capture.mapPoint);
      const catchlightVertices = target.catchlightSlots.flatMap(name=>points(skeleton.findSlot(name),this)).map(capture.mapPoint);
      observation.frames.push({ timeSeconds, scriptId:runner.scriptId, nid:Number(runner.nid), sourceExpression:Number(this.canvas.closest('.speaker-avatar')?.dataset.expression??currentExpression), renderedExpression:currentExpression,
        eyeTrackTime:current.trackTime, animation:current.animation.name, loop:current.loop, timeScale:current.timeScale,
        tracks:[0,1,2].map(track=>{const x=animationState.getCurrent(track);return x?{track,name:x.animation.name,time:x.trackTime,loop:x.loop,timeScale:x.timeScale}:null;}),
        root:[skeleton.x,skeleton.y],scale:[skeleton.scaleX,skeleton.scaleY],color:{r:skeleton.color.r,g:skeleton.color.g,b:skeleton.color.b,a:skeleton.color.a},
        camera:{zoom:this.camera.zoom,x:this.camera.position.x,y:this.camera.position.y},canvasRect:rect(this.canvas),canvasSize:[this.canvas.width,this.canvas.height],
        irisVertices,catchlightVertices,eyeLayers:layers,drawOrder:skeleton.drawOrder.map(slot=>slot.data.name),
        slotAttachments:skeleton.slots.map(slot=>({slot:slot.data.name,attachment:slot.attachment?.name??null,type:slot.attachment?.constructor.name??null})),
        imageData:context.getImageData(0,0,960,420) });
      if(timeSeconds>=target.durationSeconds)finish(observation);
    }
    return value;
  };
  window.__catchlightCoverageProbe = {
    arm(target){observations.set(target.name,{target,armedAt:performance.now(),done:false});},
    recording(name){return !!observations.get(name)?.capture;},
    elapsed(name){const o=observations.get(name);return o?.capture?(performance.now()-o.startedAt)/1000:0;},
    ready(name){return observations.get(name)?.done===true;},
    release(name){observations.delete(name);},
    result(name){const o=observations.get(name);return {target:o.target,frames:o.frames,recordingCanvas:{width:960,height:420},eyes:o.capture.eyes.map(({name,irisBBox,irisCenter})=>({name,irisBBox,irisCenter})),initialIrisGuideSource:o.capture.initialIrisGuideSource,mapping:{crop:o.capture.crop,destination:o.capture.destination,zoom:o.capture.zoom}};},
  };
}

const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const resourceCache=new Map();let sourceRuntime;
async function replaySource(recording) {
  if(!sourceRuntime)sourceRuntime=runInNewContext((await readFile(join(root,'public/assets/solarschool/characters/changli/spine-player.js'),'utf8'))+'\nspine;',{performance,console,setTimeout,clearTimeout});
  const s=sourceRuntime,slug=recording.target.slug;
  if(!resourceCache.has(slug)){
    const audit=JSON.parse(await readFile(join(root,'test-results/reader-catchlights/source-assets.json'),'utf8'));
    const resource=audit.characters.find(item=>item.slug===slug);assert.ok(resource,'Native resource '+slug+' is audited.');
    const atlas=new s.TextureAtlas(await readFile(join(root,resource.assets.atlas.path),'utf8'));for(const page of atlas.pages)page.texture=new s.Texture({width:page.width,height:page.height});
    const data=new s.SkeletonBinary(new s.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(await readFile(join(root,resource.assets.skeleton.path))));
    const identities={};for(const [key,asset] of Object.entries(resource.assets)){assert.equal(await hash(join(root,asset.path)),asset.sha256,'Native asset identity '+asset.path);identities[key]={path:asset.path,sha256:asset.sha256};}
    resourceCache.set(slug,{data,identities});
  }
  const {data,identities}=resourceCache.get(slug),maximum={verticesPixels:0,effectiveDeform:0,UVs:0,colors:0};let comparedLayers=0,differingRawDeformBuffers=0;
  const tolerance=.02;
  const compareNumbers=(actual,expected,field,label)=>{assert.equal(actual.length,expected.length,label+' count');for(let i=0;i<actual.length;i++){const error=Math.abs(actual[i]-expected[i]);assert.ok(Number.isFinite(error),label+' finite');maximum[field]=Math.max(maximum[field],error);assert.ok(error<=(field==='verticesPixels'?tolerance:1e-5),label+' source discrepancy '+error);}};
  for(let frameIndex=0;frameIndex<recording.frames.length;frameIndex++){
    const frame=recording.frames[frameIndex],native=new s.Skeleton(data);if(data.skins.length)native.setSkinByName(data.skins[0].name);
    for(const track of frame.tracks.filter(Boolean)){const clip=data.findAnimation(track.name);assert.ok(clip,'Recorded native clip '+track.name+' exists.');clip.apply(native,0,track.time,track.loop,[],1,s.MixBlend.replace,s.MixDirection.mixIn);}
    [native.x,native.y]=frame.root;[native.scaleX,native.scaleY]=frame.scale;native.updateWorldTransform();
    const camera=new s.OrthoCamera(...frame.canvasSize);camera.zoom=frame.camera.zoom;camera.position.x=frame.camera.x;camera.position.y=frame.camera.y;camera.update();
    assert.deepEqual(frame.drawOrder,Array.from(native.drawOrder,slot=>slot.data.name),'Native draw order at frame '+frameIndex);
    assert.equal(frame.slotAttachments.length,native.slots.length);
    for(let i=0;i<native.slots.length;i++){const expected=native.slots[i],actual=frame.slotAttachments[i];assert.equal(actual.slot,expected.data.name);assert.equal(actual.attachment,expected.attachment?.name??null,'Native attachment at '+frameIndex+'/'+actual.slot);assert.equal(actual.type,expected.attachment?.constructor.name??null);}
    for(const actual of frame.eyeLayers){
      const slot=native.findSlot(actual.slot),attachment=slot.attachment;assert.equal(actual.attachment,attachment?.name??null);assert.equal(actual.drawOrderIndex,native.drawOrder.indexOf(slot));
      const values=new Float32Array(attachment?.worldVerticesLength??(attachment?.computeWorldVertices?8:0));
      if(attachment?.worldVerticesLength)attachment.computeWorldVertices(slot,0,values.length,values,0,2);else if(attachment?.computeWorldVertices)attachment.computeWorldVertices(slot,values,0,2);
      const projected=[];for(let i=0;i<values.length;i+=2){const p=camera.worldToScreen(new s.Vector3(values[i],values[i+1],0),...frame.canvasSize);projected.push(recording.mapping.destination.x+(p.x-recording.mapping.crop.x)*recording.mapping.zoom,recording.mapping.destination.y+(frame.canvasSize[1]-p.y-recording.mapping.crop.y)*recording.mapping.zoom);}
      compareNumbers(actual.vertices.flat(),projected,'verticesPixels','Native eye geometry '+frameIndex+'/'+actual.slot);
      compareNumbers(actual.sourceUVs,Array.from(attachment?.uvs??[]),'UVs','Native UVs '+actual.slot);
      // Empty buffers and explicit identity deformation render identically.
      // Weighted meshes use zero offsets; unweighted meshes use rest vertices.
      if(actual.deform.length!==slot.deform.length)differingRawDeformBuffers++;
      if(attachment?.worldVerticesLength){const identity=attachment.bones?new Array(attachment.vertices.length/3*2).fill(0):Array.from(attachment.vertices);compareNumbers(actual.deform.length?actual.deform:identity,slot.deform.length?Array.from(slot.deform):identity,'effectiveDeform','Native deformation '+actual.slot);}
      compareNumbers(Object.values(actual.color),[slot.color.r,slot.color.g,slot.color.b,slot.color.a],'colors','Native slot color '+actual.slot);
      assert.deepEqual(actual.sourceTriangles,Array.from(attachment?.triangles??[]));assert.equal(actual.clippingEndSlot,attachment?.endSlot?.name??null);comparedLayers++;
    }
  }
  const wall=recording.frames.map(frame=>frame.timeSeconds),gaps=wall.slice(1).map((value,i)=>value-wall[i]);
  return {passed:true,authority:'independent-source-replay-of-recorded-effective-native-clips',frames:recording.frames.length,comparedEyeLayers:comparedLayers,maximumDiscrepancy:maximum,differingRawDeformBuffers,coordinateTolerancePixels:tolerance,assets:identities,
    originalRuntime:{path:'public/assets/solarschool/characters/changli/spine-player.js',sha256:await hash(join(root,'public/assets/solarschool/characters/changli/spine-player.js'))},
    sampling:{maximumWallFrameGapSeconds:Math.max(...gaps),minimumWallFrameGapSeconds:Math.min(...gaps)},
    scope:'Fresh source skeleton per actual retained frame; recorded effective body/mouth/eye clips applied directly at their own clocks, bypassing Reader actor/mixing/scheduler. All attachments and draw order, plus every captured eye/eyelid/clipping layer geometry, effective deformations, UVs, triangles and colors are compared. Empty and explicit identity deformation buffers are normalized; raw buffers remain in recorded frames. Existing Rover avatar fallback remains explicit in source/render expression IDs. This compares captured geometry and source attachments; RGB/occlusion pixels and original-game framebuffer output are separate evidence.'};
}
async function run(executable, args) {
  const command = spawn(executable,args,{cwd:root,stdio:['ignore','pipe','pipe']}); let stdout='',stderr='';
  command.stdout.on('data',value=>{stdout+=value;}); command.stderr.on('data',value=>{stderr+=value;});
  const code = await new Promise((resolveCode,reject)=>{command.on('error',reject);command.on('exit',resolveCode);});
  assert.equal(code,0,`${executable}: ${stderr}`); return stdout;
}
async function encode(folder,frames) {
  const listing=join(folder,'close-up.ffconcat'), lines=['ffconcat version 1.0'];
  for(let i=0;i<frames.length;i++){
    lines.push("file '"+join(folder,frames[i].file).replaceAll("'","'\\''")+"'",'option framerate 1000');
    if(i+1<frames.length){const duration=frames[i+1].timeSeconds-frames[i].timeSeconds;assert.ok(duration>0);lines.push('duration '+duration.toFixed(9));}
  }
  await writeFile(listing,lines.join('\n')+'\n'); const output=join(folder,'close-up.mp4');
  await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',listing,'-an','-c:v','libx264','-preset','veryfast','-crf','14','-pix_fmt','yuv420p','-enc_time_base','1:1000','-fps_mode','vfr','-video_track_timescale','1000000','-movflags','+faststart',output]);
  const probe=JSON.parse(await run('ffprobe',['-v','error','-count_frames','-show_frames','-show_entries','stream=codec_name,width,height,time_base,nb_read_frames:format=duration:frame=pts_time','-of','json',output]));
  assert.equal(probe.frames.length,frames.length);assert.equal(probe.streams[0].width,960);assert.equal(probe.streams[0].height,420);
  const maximumTimestampErrorSeconds=Math.max(...probe.frames.map((frame,index)=>Math.abs(Number(frame.pts_time)-(frames[index].timeSeconds-frames[0].timeSeconds))));
  assert.ok(maximumTimestampErrorSeconds<=.0011);
  return {file:output,sha256:await hash(output),frames:frames.length,durationSeconds:Number(probe.format.duration),maximumTimestampErrorSeconds,sourceFrameSha256:await Promise.all(frames.map(frame=>hash(join(folder,frame.file))))};
}
function verify(result) {
  const {frames,target}=result; assert.ok(frames.length>=25,'Enough actual frames cover the representative interval.');
  const first=frames[0],last=frames.at(-1);assert.ok(last.timeSeconds>=target.durationSeconds&&last.timeSeconds<target.durationSeconds+.2);
  assert.ok(frames.every(frame=>frame.timeScale===1),'The original animation time scale is retained.');
  assert.ok(frames.some(frame=>frame.nid===target.nid&&frame.renderedExpression===target.fromExpression));
  const drift={root:0,scale:0,camera:0,canvasRect:0,irisPixels:target.afterNid?null:0};
  const diff=(a,b)=>Math.max(...a.map((value,i)=>Math.abs(value-b[i])));
  for(const frame of frames){
    for(const field of ['root','scale'])drift[field]=Math.max(drift[field],diff(frame[field],first[field]));
    for(const field of ['camera','canvasRect'])drift[field]=Math.max(drift[field],diff(Object.values(frame[field]),Object.values(first[field])));
    if(!target.afterNid&&frame.irisVertices.length===first.irisVertices.length)drift.irisPixels=Math.max(drift.irisPixels,diff(frame.irisVertices.flat(),first.irisVertices.flat()));
  }
  for(const field of ['camera','canvasRect'])assert.ok(drift[field]<1e-6,'Fixed '+field);
  const changes=[];
  for(let i=1;i<frames.length;i++)if(frames[i].renderedExpression!==frames[i-1].renderedExpression){
    const before=frames[i-1],after=frames[i];
    changes.push({timeSeconds:after.timeSeconds,nid:after.nid,fromExpression:before.renderedExpression,toExpression:after.renderedExpression,
      trackNamesBefore:before.tracks.map(x=>x?.name??null),trackNamesAfter:after.tracks.map(x=>x?.name??null),
      changedAttachments:after.slotAttachments.flatMap((slot,j)=>slot.attachment!==before.slotAttachments[j]?.attachment?[{slot:slot.slot,before:before.slotAttachments[j]?.attachment??null,after:slot.attachment}]:[])});
  }
  if(target.afterNid){assert.ok(frames.some(frame=>frame.nid===target.afterNid&&frame.renderedExpression===target.toExpression));assert.ok(changes.length&&changes.some(change=>change.changedAttachments.length),'Actual ordinary advance switches authored attachments.');}
  else{assert.ok(frames.every(frame=>frame.nid===target.nid&&frame.renderedExpression===target.fromExpression));for(const field of ['root','scale'])assert.ok(drift[field]<1e-6,'Steady '+field);if(target.mode==='blink')assert.ok(frames.some(frame=>frame.animation!==target.cropPoses[0].eye&&frame.loop===false),'An original natural blink is captured');else{assert.ok(frames.every(frame=>frame.animation===target.cropPoses[0].eye&&frame.loop===true));assert.ok(drift.irisPixels<.02,'Fixed iris during open-eye interval');}}
  const reflectionVertexMotionPixels=!target.afterNid?Math.max(...frames.map(frame=>diff(frame.catchlightVertices.flat(),first.catchlightVertices.flat()))):null;
  const groups=new Map();for(const frame of frames){const key=frame.renderedExpression+'|'+frame.animation;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(frame);}
  const phaseSummaries=[...groups.values()].map(group=>{const base=group[0];const motion=field=>base[field].length&&group.every(frame=>frame[field].length===base[field].length)?Math.max(...group.map(frame=>diff(frame[field].flat(),base[field].flat()))):null;return {expression:base.renderedExpression,eyeClip:base.animation,loop:base.loop,frames:group.length,firstTimeSeconds:base.timeSeconds,lastTimeSeconds:group.at(-1).timeSeconds,irisVertexMotionPixels:motion('irisVertices'),separateReflectionVertexMotionPixels:motion('catchlightVertices')};});
  return {passed:true,frames:frames.length,durationSeconds:last.timeSeconds-first.timeSeconds,drift,reflectionVertexMotionPixels,expressionChanges:changes,phaseSummaries,allNativeTimeScalesOne:true,openEyeOnly:!target.afterNid&&target.mode!=='blink',observedEyeClips:[...new Set(frames.map(frame=>frame.animation))]};
}

try {
  await mkdir(resultDir,{recursive:true});
  const captureHashes={renderer:await hash(join(root,'src/spine/ChangliSpineScene.ts')),profiles:await hash(join(root,'src/spine/SchoolPortraitAssets.ts')),html:await hash(join(root,'dist/index.html')),harness:await hash(fileURLToPath(import.meta.url))};
  server=createServer(async(request,response)=>{
    try{const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);if(pathname==='/favicon.ico'){response.writeHead(204);response.end();return;}
      const filename=resolve(dist,'.'+(extname(pathname)?pathname:'/index.html'));if(!filename.startsWith(dist+sep))throw new Error('Invalid path');
      const bytes=await readFile(filename),contentType=mime[extname(filename)]??'application/octet-stream';
      servedResources.set(pathname,{requestPath:pathname,file:filename,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),contentType});
      response.writeHead(200,{'Content-Type':contentType,'Cache-Control':'no-store'});response.end(bytes);
    }catch{response.writeHead(404);response.end('Missing local fixture');}
  });
  await new Promise((resolveServer,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolveServer);});origin=`http://127.0.0.1:${server.address().port}`;
  browser=spawn(process.env.CHROMIUM_BIN??'/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader',`--user-data-dir=${profile}`,'--remote-debugging-pipe','about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
  client=new CDP(browser.stdio[3],browser.stdio[4]);const target=await client.send('Target.createTarget',{url:'about:blank'});client.sessionId=(await client.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
  for(const domain of ['Page','Runtime','Network'])await client.send(domain+'.enable');
  await client.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await client.send('Page.navigate',{url:origin+'/?script=1001'});await until(`!!document.querySelector('${tid('start')}')&&!document.querySelector('${tid('start')}').disabled`,'Reader entry');
  await click('settings');
  for(const id of ['volume-voice','volume-music','volume-effects'])await client.evaluate(`(()=>{const e=document.querySelector('${tid(id)}');if(!e)return;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'0');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  if(!await client.evaluate(`document.querySelector('${tid('instant-text')}').checked`))await click('instant-text');await click('settings-close');await click('start');
  await advanceTo({script:'1001',nid:8});await until('!!window.spine?.SceneRenderer','local Spine runtime');await client.evaluate(`(${browserProbe.toString()})()`);
  for(const item of cases){
    const folder=join(resultDir,item.name);
    if(resume){try{const saved=JSON.parse(await readFile(join(folder,'measurements.json'),'utf8'));if(saved.verification?.passed){saved.verification=verify(saved);saved.captureHashes??=previousReport?.hashes;for(const key of ['renderer','profiles','html'])assert.equal(saved.captureHashes?.[key],captureHashes[key],'Reused recording matches current production '+key);saved.reused=true;measurements.push(saved);await writeFile(join(folder,'measurements.json'),JSON.stringify(saved,null,2)+'\n');console.log(JSON.stringify({progress:'Reused',case:item.name}));continue;}}catch(error){if(error.code!=='ENOENT')throw error;}}
    console.log(JSON.stringify({progress:'Reader route',case:item.name,script:item.script,nid:item.nid}));
    if(item.gender)await setGender(item.gender);await openStory(item.script);await advanceTo(item);await dismissNotices();await delay(1300);await settle();
    await until(`Array.from(document.querySelectorAll('${tid(item.slug+'-canvas')}')).some(c=>c.dataset.renderedWhos?.split(',').includes(${JSON.stringify(item.who)})&&c.closest('.speaker-avatar')${item.composition==='avatar'?'':'===null'})`,item.slug+' actual rendered actor');
    await mkdir(folder,{recursive:true});const contextBefore=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(folder,'reader-context-before.png'),Buffer.from(contextBefore.data,'base64'));const before=await state();
    await client.evaluate(`window.__catchlightCoverageProbe.arm(${JSON.stringify(item)})`);await until(`window.__catchlightCoverageProbe.recording(${JSON.stringify(item.name)})`,item.name+' observation start');
    if(item.afterNid){await until(`window.__catchlightCoverageProbe.elapsed(${JSON.stringify(item.name)})>=${item.advanceAtSeconds}`,item.name+' ordinary advance time');await click('advance');await until(`document.querySelector('${tid('runner-state')}').dataset.nid===${JSON.stringify(String(item.afterNid))}`,item.name+' target expression');}
    await until(`window.__catchlightCoverageProbe.ready(${JSON.stringify(item.name)})`,item.name+' captured frames',20_000);const result=await client.evaluate(`window.__catchlightCoverageProbe.result(${JSON.stringify(item.name)})`);await client.evaluate(`window.__catchlightCoverageProbe.release(${JSON.stringify(item.name)})`);
    for(let i=0;i<result.frames.length;i++){const frame=result.frames[i],filename=`frame-${String(i).padStart(4,'0')}.png`;await writeFile(join(folder,filename),Buffer.from(frame.png,'base64'));delete frame.png;frame.file=filename;}
    const after=await state(),contextAfter=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(folder,'reader-context-after.png'),Buffer.from(contextAfter.data,'base64'));
    const measurement={...result,before,after,directory:folder,captureHashes};await writeFile(join(folder,'measurements.json'),JSON.stringify(measurement,null,2)+'\n');measurement.verification=verify(measurement);measurement.sourceReplay=await replaySource(measurement);measurement.encoding=await encode(folder,measurement.frames);measurements.push(measurement);await writeFile(join(folder,'measurements.json'),JSON.stringify(measurement,null,2)+'\n');
    console.log(JSON.stringify({progress:'Recorded',case:item.name,...measurement.verification,encoding:{frames:measurement.encoding.frames,durationSeconds:measurement.encoding.durationSeconds}}));
  }
  assert.equal(errors.length,0,errors.join('\n'));
}catch(error){failure=error.stack??String(error);}
finally{
  if(client)try{await client.send('Browser.close');}catch{}if(browser&&browser.exitCode===null)browser.kill('SIGTERM');if(server)await new Promise(resolveServer=>server.close(resolveServer));await rm(profile,{recursive:true,force:true});
  const result={passed:!failure,failure,errors,measurements:measurements.map(item=>({target:item.target,directory:item.directory,verification:item.verification,sourceReplay:item.sourceReplay,encoding:item.encoding,captureHashes:item.captureHashes,reused:item.reused??false})),navigation,
    servedResources:[...servedResources.values()].sort((a,b)=>a.requestPath.localeCompare(b.requestPath)),
    hashes:{renderer:await hash(join(root,'src/spine/ChangliSpineScene.ts')),profiles:await hash(join(root,'src/spine/SchoolPortraitAssets.ts')),html:await hash(join(root,'dist/index.html')),harness:await hash(fileURLToPath(import.meta.url))},
    scope:'Production Reader over local HTTP. Existing source scene selector, ordinary advances/eligible choices and ordinary gender setting; no stage entry, expression or animation injection. Fixed union crop predicted from undrawn original source poses; actual rendered pixels/attachments/geometry/clocks recorded. Native blinks remain enabled. PNG frames compressed after recording and encoded at original observation timestamps without interpolation or stabilization.'};
  await mkdir(resultDir,{recursive:true});await writeFile(join(resultDir,'production-browser-result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.passed,recordings:measurements.length,report:join(resultDir,'production-browser-result.json'),failure}));if(failure)process.exitCode=1;
}
