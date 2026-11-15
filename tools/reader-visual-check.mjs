/** Focused Reader visual measurements. Image bytes never enter reports/stdout. */
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
const remaining = process.argv.includes('--remaining');
const zoomOnly = process.argv.includes('--zoom-only');
const roverOnly = process.argv.includes('--rover-only');
const avatarGeometry = process.argv.includes('--avatar-geometry');
const geometryRemaining = process.argv.includes('--geometry-remaining');
const resultDir = join(root, avatarGeometry ? 'test-results/avatar-geometry' : roverOnly ? 'test-results/rover-avatars' : remaining || zoomOnly ? 'test-results/reader-rendering' : 'test-results/reader-visual-fixes');
const alphaOnly = process.argv.includes('--alpha-only');
const avatarsOnly = process.argv.includes('--avatars-only');
const phase = geometryRemaining ? 'after-remaining' : zoomOnly ? 'zoom-after' : (avatarsOnly ? 'avatars-' : alphaOnly ? 'alpha-' : '') + (process.argv.includes('--after') ? 'after' : 'before');
const profile = await mkdtemp(join(tmpdir(), 'solaris-reader-visual-'));
const captures = [], checks = [], errors = [], measurements = [];
const navigation = [];
let browser, client, server;
let zoomStep, roverStep, failure;
const tid = id => `[data-testid="${id}"]`;
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.webp':'image/webp', '.png':'image/png', '.jpg':'image/jpeg' };

class CDP {
  nextId = 0; pending = new Map(); sessionId;
  constructor(input, output) {
    this.input = input;
    let buffer = '';
    output.setEncoding('utf8');
    output.on('data', chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\0')) >= 0) {
        const packet = buffer.slice(0,end); buffer = buffer.slice(end+1);
        if (packet) this.receive(JSON.parse(packet));
      }
    });
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
    } else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
      errors.push(`HTTP ${message.params.response.status}: ${new URL(message.params.response.url).pathname}`);
    }
  }
  send(method, params = {}) {
    return new Promise((resolveResult,reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}${method==='Runtime.evaluate'?' '+params.expression.slice(0,120):''}`)); },10000);
      this.pending.set(id,{ resolve:resolveResult,reject,timer });
      this.input.write(JSON.stringify({ id,method,params,sessionId:method.startsWith('Target.') ? undefined : this.sessionId })+'\0');
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate',{ expression,returnByValue:true,awaitPromise:true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
}
async function until(expression, label, timeout=9000) {
  const deadline = Date.now()+timeout;
  do { if (await client.evaluate(expression)) return; await delay(40); } while (Date.now()<deadline);
  throw new Error(`Timed out: ${label}`);
}
const settle = () => client.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const state = () => client.evaluate(`({...document.querySelector('${tid('runner-state')}').dataset})`);
async function clickSelector(selector) {
  await until(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e&&!e.disabled&&e.getClientRects().length;})()`,selector);
  const beforeScroll = selector.includes('data-option-id') ? await client.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,viewport:[innerWidth,innerHeight]};})()`) : null;
  await client.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'center',behavior:'instant'})`);
  await settle();
  const p = await client.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  if(beforeScroll)navigation.push({selector,state:await state(),beforeScroll,clickPoint:p});
  await client.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});
  await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});
  await settle();
}
const click = id => clickSelector(tid(id));
async function select(id,value) {
  await client.evaluate(`(()=>{const e=document.querySelector('${tid(id)}');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await settle();
}
async function advanceTo(nid) {
  for (let i=0;i<100;i++) {
    await until(`['dialogue','choices'].includes(document.querySelector('${tid('runner-state')}').dataset.status)`,'dialogue ready');
    const s = await state();
    if (s.nid===String(nid)) return;
    if (s.status==='choices') await clickSelector(`${tid('choice')}:not(:disabled)`);
    else await click('advance');
  }
  throw new Error(`Did not reach ${nid}`);
}
async function openStory(id) {
  await click('menu'); await click('menu-stories'); await select('script-select',id); await click('library-start');
  await until(`document.querySelector('${tid('runner-state')}').dataset.scriptId===${JSON.stringify(id)}&&!document.querySelector('dialog[open]')&&!document.querySelector('${tid('reader-loading')}')`,'story '+id);
}
async function screenshot(name,clip) {
  await settle();
  const r = await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,...(clip ? {clip:{...clip,scale:1}}:{})});
  const path = join(resultDir,`${phase}-${name}.png`);
  await writeFile(path,Buffer.from(r.data,'base64'));
  captures.push(path);
}

async function installProbe() {
  await until('!!window.spine?.SceneRenderer','local Spine runtime');
  await client.evaluate(`(()=>{
    const renderers=new Map(), actorIds=new WeakMap();let nextActor=0;
    const proto=spine.SceneRenderer.prototype, begin=proto.begin,draw=proto.drawSkeleton,end=proto.end;
    const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
    proto.begin=function(){this.__probeActors=[];return begin.apply(this,arguments);};
    proto.drawSkeleton=function(s,pma){if(!actorIds.has(s))actorIds.set(s,++nextActor);this.__probeActors.push({s,pma});return draw.apply(this,arguments);};
    proto.end=function(){
      const drew=!!this.activeRenderer&&this.__probeActors?.length;
      const result=end.apply(this,arguments);renderers.set(this.canvas,this);
      // enableRenderer also calls end before drawing. Sample only the finished
      // draw, while the non-preserved WebGL buffer still contains its pixels.
      const request=this.__alphaRequest;if(request&&drew){this.__alphaRequest=null;
        const gl=this.context.gl,c=this.canvas,cr=rect(c),ar=c.closest('.speaker-avatar'),clip=ar?rect(ar):cr;
        const x=0,y=0,w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
        const pixels=new Uint8Array(w*h*4);gl.readPixels(x,y,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        let painted=0,opaque=0,min=255,max=0;const histogram=Array(16).fill(0);let left=w,right=-1,bottom=h,top=-1;
        for(let p=0;p<w*h;p++){const a=pixels[p*4+3];if(a>8){painted++;opaque+=a>=250?1:0;min=Math.min(min,a);max=Math.max(max,a);histogram[Math.floor(a/16)]++;left=Math.min(left,p%w);right=Math.max(right,p%w);bottom=Math.min(bottom,Math.floor(p/w));top=Math.max(top,Math.floor(p/w));}}
        request({painted,opaque,min,max,opaqueFraction:painted?opaque/painted:0,histogram,pixelBounds:painted?{x:(x+left)/c.width,y:1-(y+top+1)/c.height,width:(right-left+1)/c.width,height:(top-bottom+1)/c.height}:null,
          gl:{error:gl.getError(),bufferSize:[w,h],canvasRect:cr,avatarRect:clip,attributes:gl.getContextAttributes(),unpackPremultiply:gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL),srcRGB:gl.getParameter(gl.BLEND_SRC_RGB),dstRGB:gl.getParameter(gl.BLEND_DST_RGB),srcAlpha:gl.getParameter(gl.BLEND_SRC_ALPHA),dstAlpha:gl.getParameter(gl.BLEND_DST_ALPHA)}});
      }return result;
    };
    window.__portraitProbe={renderers,actors(){return Array.from(renderers.entries()).filter(([c])=>c.isConnected).map(([c,r])=>({canvas:c.dataset.testid,inAvatar:!!c.closest('.speaker-avatar'),canvasSize:[c.width,c.height],camera:{zoom:r.camera.zoom,x:r.camera.position.x,y:r.camera.position.y},draws:r.__probeActors.map(({s,pma})=>{const offset=new spine.Vector2(),size=new spine.Vector2();s.getBounds(offset,size);return{id:actorIds.get(s),pma,root:[s.x,s.y],scale:[s.scaleX,s.scaleY],color:{...s.color},bounds:{x:offset.x,y:offset.y,width:size.x,height:size.y},attachments:s.slots.filter(v=>v.attachment&&v.color.a>0).map(v=>({slot:v.data.name,attachment:v.attachment.name,alpha:v.color.a}))};})}));},alpha(selector){const c=document.querySelector(selector),r=renderers.get(c);if(!r)throw Error('No observed renderer for '+selector);return new Promise(resolve=>r.__alphaRequest=resolve);}};
  })()`);
}
async function measure(label,alphaSelector) {
  await settle();
  const dom=await client.evaluate(`(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
    const stage=document.querySelector('${tid('visual-stage')}'),av=document.querySelector('.speaker-avatar');
    return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,fullscreen:!!document.fullscreenElement},stage:rect(stage),
      layers:Array.from(document.querySelectorAll('.stage-image-layer,.character-layer,.reader-avatar-layer,.reader-presentation-layer,.school-spine-canvas,.changli-canvas,.dialogue-box')).map(e=>({name:e.dataset.testid??e.className,bounds:rect(e),css:{zIndex:getComputedStyle(e).zIndex,isolation:getComputedStyle(e).isolation,overflow:getComputedStyle(e).overflow,transform:getComputedStyle(e).transform}})),
      images:Array.from(stage.querySelectorAll('img')).map(e=>({kind:e.dataset.testid,natural:[e.naturalWidth,e.naturalHeight],bounds:rect(e),fit:getComputedStyle(e).objectFit,border:getComputedStyle(e).border,position:getComputedStyle(e).objectPosition})),
      avatar:av?{dataset:{...av.dataset},bounds:rect(av),opacityAncestors:Array.from((function*(e){while(e){yield e;e=e.parentElement;}})(av)).map(e=>({name:e.className,opacity:getComputedStyle(e).opacity,filter:getComputedStyle(e).filter})),canvases:av.querySelectorAll('canvas').length,placeholders:av.querySelectorAll('[data-testid="character-placeholder"]').length}:null};
  })()`);
  const actors=await client.evaluate('window.__portraitProbe.actors()');
  for (const actor of actors) {
    const canvas=dom.layers.find(layer=>layer.name===actor.canvas&&Math.abs(layer.bounds.width-actor.canvasSize[0])<3)?.bounds
      ?? await client.evaluate(`(()=>{const c=Array.from(document.querySelectorAll('canvas')).find(c=>c.dataset.testid===${JSON.stringify(actor.canvas)}&&!!c.closest('.speaker-avatar')===${actor.inAvatar});const r=c.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})()`);
    for(const draw of actor.draws){
      const b=draw.bounds, c=actor.camera, size=actor.canvasSize, stage=dom.stage;
      draw.normalizedStageBounds={
        left:(canvas.x+(size[0]/2+(b.x-c.x)/c.zoom)*canvas.width/size[0]-stage.x)/stage.width,
        top:(canvas.y+(size[1]/2-(b.y+b.height-c.y)/c.zoom)*canvas.height/size[1]-stage.y)/stage.height,
        width:b.width/c.zoom*canvas.width/size[0]/stage.width,
        height:b.height/c.zoom*canvas.height/size[1]/stage.height,
      };
    }
  }
  // Attachment names are kept local for overlapping-pose diagnosis.
  const alpha=alphaSelector?await client.evaluate(`window.__portraitProbe.alpha(${JSON.stringify(alphaSelector)})`):null;
  const measurement={label,state:await state(),...dom,actors,alpha};
  measurements.push(measurement);
  return measurement;
}

async function overlapProof(name) {
  const clip=await client.evaluate(`(()=>{const a=document.querySelector('.speaker-avatar').getBoundingClientRect(),p=document.querySelector('.dialogue-box').getBoundingClientRect();const x=Math.ceil(Math.max(a.x,p.x)),y=Math.ceil(Math.max(a.y,p.y));return{x,y,width:Math.floor(Math.min(a.right,p.right)-x),height:Math.floor(Math.min(a.bottom,p.bottom)-y)};})()`);
  assert.ok(clip.width>0&&clip.height>0,'Authored avatar/paper rectangles overlap.');
  await screenshot(name+'-overlap',clip);
  await client.evaluate(`document.querySelector('.reader-avatar-layer').style.visibility='hidden'`);
  await screenshot(name+'-overlap-paper',clip);
  await client.evaluate(`document.querySelector('.reader-avatar-layer').style.visibility='';document.querySelector('.dialogue-box').style.visibility='hidden'`);
  await screenshot(name+'-overlap-avatar',clip);
  await client.evaluate(`document.querySelector('.dialogue-box').style.visibility=''`);
  checks.push({name:'avatar overlap pixel comparison',clip});
}

async function remainingScenes() {
  await openStory('1002');await advanceTo(4);await installProbe();await delay(1600);
  const shorekeeper=await measure('1002-4');await screenshot('1002-4');await fullscreen('1002-4-fullscreen');
  if(phase==='after'){
    const actor=shorekeeper.actors.find(a=>a.canvas==='shorekeeper-canvas'&&!a.inAvatar).draws[0];
    assert.deepEqual(actor.root,[1270,-30]);assert.deepEqual(actor.scale,[.45,.45]);
    assert.ok(actor.normalizedStageBounds.width>.28&&actor.normalizedStageBounds.height>1.6,'Source torso framing survives the canvas/CSS chain.');
  }
  await advanceTo(7);await avatarReady('male',700131);await delay(100);
  const rover=await measure('1002-7','.speaker-avatar [data-testid="rover-male-canvas"]');
  assert.ok(rover.alpha.opaqueFraction>.97,'Darken preserves opaque painted Rover pixels.');
  await screenshot('1002-7');await overlapProof('rover');await contrastingAvatar('rover-male-700131');
  await advanceTo(23);
  await until(`document.querySelector('.speaker-avatar')?.dataset.who==='1316'&&document.querySelector('.speaker-avatar [data-testid="abby-canvas"]')?.dataset.renderedWhos==='1316'`,'1002/23 Abby avatar');
  const abby=await measure('1002-23','.speaker-avatar [data-testid="abby-canvas"]');await screenshot('1002-23');
  assert.equal(abby.actors.filter(a=>a.inAvatar).flatMap(a=>a.draws).length,1);
  assert.equal(abby.actors.filter(a=>!a.inAvatar&&a.canvas==='abby-canvas').flatMap(a=>a.draws).length,0);
  await click('advance');await until(`document.querySelector('[data-testid="runner-state"]').dataset.nid==='24'`,'1002/24');
  assert.equal(await client.evaluate(`document.querySelectorAll('.speaker-avatar').length`),0,'1002/24 immediately clears the avatar element.');
  await until(`document.querySelector('.visual-stage [data-testid="abby-canvas"]')?.dataset.renderedWhos==='1316'`,'1002/24 stage Abby');
  const next=await measure('1002-24');await screenshot('1002-24');
  assert.equal(next.actors.filter(a=>a.inAvatar).flatMap(a=>a.draws).length,0);
  assert.equal(next.actors.filter(a=>!a.inAvatar&&a.canvas==='abby-canvas').flatMap(a=>a.draws).length,1);
  await click('menu');await click('restart');await advanceTo(23);
  await until(`document.querySelector('.speaker-avatar [data-testid="abby-canvas"]')?.dataset.renderedWhos==='1316'`,'restarted Abby avatar');
  const restart=await measure('1002-23-restarted');
  assert.equal(restart.actors.filter(a=>a.inAvatar).flatMap(a=>a.draws).length,1);
  await openStory('1001');await advanceTo(8);await delay(2200);await measure('1001-8');
  await advanceTo(9);await delay(250);const nine=await measure('1001-9');await screenshot('1001-9');
  await advanceTo(10);await delay(350);const ten=await measure('1001-10');await screenshot('1001-10');
  assert.equal(nine.avatar,null);assert.equal(ten.avatar,null);
  const stageAbby=m=>m.actors.filter(a=>!a.inAvatar&&a.canvas==='abby-canvas').flatMap(a=>a.draws);
  assert.equal(stageAbby(nine).length,1);assert.equal(stageAbby(ten).length,1);
  assert.equal(stageAbby(nine)[0].id,stageAbby(ten)[0].id);
  assert.ok(Math.abs(stageAbby(ten)[0].root[1]-stageAbby(nine)[0].root[1]-400)<.01,'1001 preserves the upward 400-unit move.');
  await openStory('1007');await advanceTo(6);await delay(5200);
  await measure('1007-6');await screenshot('1007-6');await fullscreen('1007-6-fullscreen');
  await openStory('1004');await advanceTo(1);await delay(1500);await measure('1004-1');await screenshot('1004-1');
  await openStory('1009');await advanceTo(5);await delay(1500);await measure('1009-5');await screenshot('1009-5');
  const readerState=await state();await click('menu');await click('switch-view');
  const developerState=await state();assert.equal(developerState.runId,readerState.runId);assert.equal(developerState.visitId,readerState.visitId);assert.equal(developerState.nid,readerState.nid);
  assert.ok(await client.evaluate(`!!document.querySelector('.developer-app')&&!document.querySelector('.reader-app')`),'Separate Developer interface remains accessible.');
  if(phase==='after')await sourceZoom();
  checks.push('matching 1002 stage and CG states; Abby 23→24 no duplicate/stale avatar; restart/switch cleanup; separate 1001 movement; original 1007/6 Shorekeeper; normal/fullscreen normalization; Chisa/Changli; shared Developer run');
}
async function sourceZoom() {
    zoomStep={kind:'navigation',at:'1009/5 Developer option 18'};
    assert.equal((await state()).scriptId,'1009');assert.equal((await state()).nid,'5');
    // The real source route has a hidden choice at /5. Use its explicit
    // Developer override; preserve that decision and the shared run on return.
    await until(`!!document.querySelector('[data-testid="hidden-choice-override"][data-option-id="18"]')`,'1009/5 Developer option 18');
    await client.evaluate(`document.querySelector('[data-testid="hidden-choice-override"][data-option-id="18"]').closest('details').open=true`);
    await clickSelector('[data-testid="hidden-choice-override"][data-option-id="18"]');
    await until(`document.querySelector('${tid('runner-state')}').dataset.nid==='6'`,'1009/5 option 18 reaches /6');
    checks.push({name:'explicit Developer branch selection',script:'1009',nid:5,optionId:18,reachedNid:6});
    await click('switch-view');await advanceTo(13);
    zoomStep={kind:'navigation',at:'1009/13 Developer option 3'};
    // /13 is a normal source choice. Keep the explicit option-3 decision
    // in Developer and select its ordinary choice control, which jumps to /15.
    await click('menu');await click('switch-view');
    await clickSelector('[data-testid="choice"][data-option-id="3"]');
    await until(`document.querySelector('${tid('runner-state')}').dataset.nid==='15'`,'1009/13 option 3 reaches /15');
    checks.push({name:'explicit Developer branch selection',script:'1009',nid:13,optionId:3,reachedNid:15});
    zoomStep={kind:'navigation',at:'1009/19 before zoom'};
    await click('switch-view');await advanceTo(19);await delay(500);
    checks.push({name:'1009 zoom investigation uses explicit Developer branch selections',optionIds:[18,3]});
    const pre=await measure('1009-19-before-zoom');await screenshot('1009-19-before-zoom');
    zoomStep={kind:'navigation',at:'1009/20 source zoom'};
    await click('advance');await until(`document.querySelector('[data-testid="runner-state"]').dataset.nid==='20'`,'1009/20 source zoom');
    assert.equal((await state()).scriptId,'1009');
    checks.push({name:'intended zoom node reached',script:'1009',nid:20,textKey:'EVENT_AVGmain_40_23'});
    zoomStep={kind:'rendering',at:'1009/20 intermediate and final scale'};
    await delay(260);const middle=await measure('1009-20-mid-zoom');
    const draws=m=>m.actors.filter(a=>!a.inAvatar&&a.canvas==='changli-canvas').flatMap(a=>a.draws);
    assert.equal(draws(middle).length,1);
    const mid=draws(middle)[0],authored=mid.scale[0]/.34;
    assert.ok(authored>1.02&&authored<1.1,'Source .7-second zoom has an intermediate rendered frame.');
    assert.equal(mid.scale[0],mid.scale[1]);
    assert.ok(Math.abs(mid.root[0]-(1280-20*authored))<.01&&Math.abs(mid.root[1]-(720-700*authored))<.01,'Root zoom includes the inner resource offset.');
    await delay(600);const zoomed=await measure('1009-20-settled');await screenshot('1009-20-settled');
    assert.equal(draws(pre)[0].id,draws(zoomed)[0].id,'Authored zoom retains the existing actor.');
    assert.ok(Math.abs(draws(zoomed)[0].scale[0]-.374)<1e-9);
    assert.ok(Math.abs(draws(zoomed)[0].root[1]+50)<1e-9);
    await fullscreen('1009-20-fullscreen');
    zoomStep={kind:'navigation',at:'1009/22 restored framing'};
    await advanceTo(22);await delay(800);const restored=await measure('1009-22-restored');await screenshot('1009-22-restored');
    zoomStep={kind:'rendering',at:'1009/22 restored framing'};
    assert.equal(draws(restored)[0].id,draws(pre)[0].id);
    assert.ok(Math.abs(draws(restored)[0].scale[0]-.3468)<1e-9&&Math.abs(draws(restored)[0].root[1]-6)<1e-9);
    checks.push('actual 1009/20→22 source zoom, intermediate frame, nested resource offset, proportional scale, same actor and restored framing');
    zoomStep={kind:'complete',at:'1009/20→22'};
}
async function fullscreen(name) {
  await client.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await client.send('Runtime.evaluate',{expression:'document.querySelector("main").requestFullscreen()',awaitPromise:true,userGesture:true});
  await until('!!document.fullscreenElement','fullscreen entered');
  await measure(name); await screenshot(name);
  await client.evaluate('document.exitFullscreen()');
  await client.send('Emulation.setDeviceMetricsOverride',{width:1920,height:933,deviceScaleFactor:1,mobile:false});
}

async function contrastingAvatar(name) {
  const clip=await client.evaluate(`(()=>{
    const av=document.querySelector('.speaker-avatar'),scene=av.querySelector('.speaker-avatar-scene');
    av.style.isolation='isolate';scene.style.zIndex='1';
    const back=document.createElement('div');back.dataset.visualProbe='true';back.style.cssText='position:absolute;inset:0;z-index:0';av.prepend(back);
    document.querySelector('.dialogue-box').style.visibility='hidden';
    const r=av.getBoundingClientRect();return{x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)};
  })()`);
  for(const color of ['black','white']){
    await client.evaluate(`document.querySelector('[data-visual-probe]').style.background=${JSON.stringify(color)}`);
    await screenshot(name+'-'+color,clip);
  }
  await client.evaluate(`document.querySelector('[data-visual-probe]').remove();document.querySelector('.dialogue-box').style.visibility='';`);
}
async function gender(value) {
  const before=await state();await click('settings');await select('gender',value);await click('settings-close');
  const after=await state();assert.equal(after.runId,before.runId);assert.equal(after.nid,before.nid);assert.equal(after.visitId,before.visitId);
}
async function avatarReady(genderName,expression) {
  await until(`(()=>{const av=document.querySelector('.speaker-avatar'),c=av?.querySelector('[data-testid="rover-${genderName}-canvas"]');return av?.dataset.expression==='${expression}'&&c?.dataset.rendererState==='ready';})()`,'Rover '+genderName+'/'+expression);
  const active=await client.evaluate(`Array.from(document.querySelectorAll('.speaker-avatar canvas')).filter(c=>c.dataset.renderedWhos).map(c=>({...c.dataset}))`);
  assert.equal(active.length,1);assert.equal(active[0].renderedWhos,'750088');
  const draws=await client.evaluate('window.__portraitProbe.actors().filter(a=>a.inAvatar).flatMap(a=>a.draws)');
  assert.equal(draws.length,1);assert.equal(draws[0].color.a,1);assert.equal(draws[0].color.r,1);
}
async function unresolvedAvatar(expression) {
  await until(`document.querySelector('.speaker-avatar')?.dataset.expression==='${expression}'`,'unresolved source expression');await settle();
  assert.equal(await client.evaluate(`document.querySelector('.speaker-avatar').querySelectorAll('[data-testid="character-placeholder"]').length`),0);
  assert.equal(await client.evaluate(`Array.from(document.querySelectorAll('.speaker-avatar canvas')).filter(c=>c.dataset.renderedWhos).length`),0);
  assert.equal(await client.evaluate(`window.__portraitProbe.actors().filter(a=>a.inAvatar).flatMap(a=>a.draws).length`),0);
}

async function roverScenes() {
  roverStep='initial Reader route to 1001/7';await advanceTo(7);
  roverStep='install portrait probe';await installProbe();
  const verify=(m,genderName)=>{
    const actors=m.actors.filter(a=>a.inAvatar&&a.draws.length);
    assert.equal(actors.length,1);assert.equal(actors[0].canvas,`rover-${genderName}-canvas`);
    assert.equal(actors[0].draws.length,1);assert.deepEqual(actors[0].draws[0].color,{r:1,g:1,b:1,a:1});
    assert.equal(m.avatar.dataset.expression,'700131');
    assert.equal(m.avatar.dataset.renderExpression,genderName==='female'?'700056':'700131');
    assert.equal(m.avatar.dataset.avatarFallback,genderName==='female'?'700056':'');
    assert.ok(m.avatar.opacityAncestors.every(e=>e.opacity==='1'&&e.filter==='none'));
    assert.ok(m.alpha.opaqueFraction>.95,'Painted avatar pixels retain opaque alpha.');
    assert.equal(m.actors.filter(a=>!a.inAvatar&&a.canvas.startsWith('rover-')).flatMap(a=>a.draws).length,0);
  };
  for(const genderName of ['male','female']){
    roverStep=`${genderName}: Reader restart route at /1`;
    await gender(genderName);await openStory('1001');
    assert.equal((await state()).nid,'1','Reproduction starts at the authored node 1.');
    roverStep=`${genderName}: measure /1`;await measure(`1001-1-${genderName}`);
    roverStep=`${genderName}: reach /7`;
    await advanceTo(7);await delay(800);
    const selector=`.speaker-avatar [data-testid="rover-${genderName}-canvas"]`;
    const ready=await client.evaluate(`document.querySelector(${JSON.stringify(selector)})?.dataset.renderedWhos==='750088'`);
    roverStep=`${genderName}: measure /7`;const m=await measure(`1001-7-${genderName}`,ready?selector:undefined);
    if(phase==='after')verify(m,genderName);
    roverStep=`${genderName}: capture /7`;await screenshot(`1001-7-${genderName}`);await fullscreen(`1001-7-${genderName}-fullscreen`);
    checks.push({name:'normal Reader reproduction from node 1',script:'1001',nid:7,gender:genderName,avatarDraws:m.actors.filter(a=>a.inAvatar).flatMap(a=>a.draws).length});
    await click('menu');await click('switch-view');
    const debug=await client.evaluate(`(()=>{const e=document.querySelector('[data-testid="avatar-asset-resolution"][data-who="750088"]');return e?{dataset:{...e.dataset},text:e.textContent}:null;})()`);
    checks.push({name:'Rover avatar Debug resolution',gender:genderName,debug});
    if(phase==='after'&&genderName==='female'){
      assert.equal(debug.dataset.avatarFallback,'700056');assert.equal(debug.dataset.renderExpression,'700056');
      assert.ok(debug.text.includes('Reader avatar fallback')&&debug.text.includes('native missing-clip behavior is unverified'));
    }
    await click('switch-view');
    if(phase==='after'){
      roverStep=`${genderName}: overlap controls`;
      await overlapProof(`1001-7-${genderName}`);await contrastingAvatar(`1001-7-${genderName}`);
      const other=genderName==='male'?'female':'male';
      roverStep=`${genderName}: switch to ${other}`;
      await gender(other);await avatarReady(other,700131);await delay(800);
      verify(await measure(`1001-7-${genderName}-switched-to-${other}`,`.speaker-avatar [data-testid="rover-${other}-canvas"]`),other);
      await gender(genderName);await avatarReady(genderName,700131);
      roverStep=`${genderName}: restart`;
      const previous=(await client.evaluate('window.__portraitProbe.actors().filter(a=>a.inAvatar).flatMap(a=>a.draws)'))[0].id;
      await click('menu');await click('restart');assert.equal((await state()).nid,'1');
      assert.equal(await client.evaluate(`document.querySelectorAll('.speaker-avatar').length`),0,'Restart begins with the non-Rover speaker at /1.');
      await advanceTo(7);await avatarReady(genderName,700131);await delay(800);
      const restarted=await measure(`1001-7-${genderName}-restarted`,selector);verify(restarted,genderName);
      assert.notEqual(restarted.actors.filter(a=>a.inAvatar).flatMap(a=>a.draws)[0].id,previous,'Restart disposes the previous avatar actor.');
      roverStep=`${genderName}: hidden-avatar node /9`;await advanceTo(9);await delay(800);
      const hidden=await measure(`1001-9-${genderName}-hidden`);await screenshot(`1001-9-${genderName}-hidden`);
      assert.equal(hidden.avatar,null);assert.equal(hidden.actors.filter(a=>a.inAvatar).flatMap(a=>a.draws).length,0);
      checks.push({name:'selected Rover avatar stays bright through gender switching and restart, then clears on hidden-avatar dialogue',gender:genderName,hiddenNode:'1001/9'});
    }
  }
  roverStep='complete';
}

async function avatarGeometryScene(label, slug) {
  roverStep=label;
  const selector=`.speaker-avatar [data-testid="${slug}-canvas"]`;
  await until(`document.querySelector(${JSON.stringify(selector)})?.dataset.rendererState==='ready'`,label+' avatar');
  await delay(400);
  const m=await measure(label,selector);
  const geometry=await client.evaluate(`(()=>{
    const c=document.querySelector(${JSON.stringify(selector)}),rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
    const parents=[];for(let p=c;p;p=p.parentElement){const s=getComputedStyle(p);parents.push({name:p.dataset.testid||p.className||p.tagName,rect:rect(p),overflowX:s.overflowX,overflowY:s.overflowY,transform:s.transform,clipPath:s.clipPath});}
    return{canvas:rect(c),parents};
  })()`);
  const p=m.alpha.pixelBounds,c=geometry.canvas;
  m.geometry={...geometry,paintedBounds:{x:c.x+p.x*c.width,y:c.y+p.y*c.height,width:p.width*c.width,height:p.height*c.height}};
  assert.equal(m.actors.filter(a=>a.inAvatar).flatMap(a=>a.draws).length,1);
  await screenshot(label);
  // Control reveals artwork cut by an internal CSS rectangle, retaining the
  // original renderer, source translation, clocks, and facing.
  await client.evaluate("document.querySelector('.speaker-avatar').style.overflow='visible';document.querySelector('.reader-avatar-layer').style.overflow='hidden'");
  await screenshot(label+'-stage-clip-control');
  await client.evaluate("document.querySelector('.speaker-avatar').style.overflow='';document.querySelector('.reader-avatar-layer').style.overflow=''");
  await overlapProof(label);await contrastingAvatar(label);
  checks.push({name:'normal Reader avatar geometry',label,avatarDraws:1,head:m.avatar.dataset.headTransform,paintedBounds:m.geometry.paintedBounds});
  return m;
}

async function avatarGeometryScenes() {
  await advanceTo(2);await installProbe();
  if(!geometryRemaining){
  for(const genderName of ['male','female']){
    await gender(genderName);await openStory('1001');await advanceTo(2);
    await avatarGeometryScene('1001-2-'+genderName,'rover-'+genderName);
  }
  await openStory('1002');await advanceTo(23);await avatarGeometryScene('1002-23-abby','abby');
  }
  await openStory('3010');await advanceTo(16);await avatarGeometryScene('3010-16-shorekeeper','shorekeeper');
  if(phase==='after'){
    await verifyAbbyEntrance();
  }else if(geometryRemaining){
    await verifyAbbyEntrance();
  }
  roverStep='complete';
}

async function verifyAbbyEntrance() {
    roverStep='Abby upward stage entrance';
    await openStory('1001');
    const movement=[];
    for(const nid of [8,9,10]){
      await advanceTo(nid);
      const expected=nid===8?220:nid===9?320:720;
      await until(`window.__portraitProbe.actors().filter(a=>!a.inAvatar&&a.canvas==='abby-canvas').flatMap(a=>a.draws).some(d=>Math.abs(d.root[1]-${expected})<.001)`,'settled Abby entrance '+nid,20000);
      const m=await measure('1001-'+nid+'-abby-entrance');
      const d=m.actors.filter(a=>!a.inAvatar&&a.canvas==='abby-canvas').flatMap(a=>a.draws)[0];
      movement.push({nid,id:d.id,root:d.root,scale:d.scale});
    }
    assert.equal(new Set(movement.map(m=>m.id)).size,1);
    assert.ok(movement.every((m,i)=>Math.abs(m.root[1]-[220,320,720][i])<1e-6));
    assert.ok(movement.every(m=>m.scale[0]===.25&&m.scale[1]===.25));
    checks.push({name:'Abby original upward stage entrance',result:'PASS',movement});
}

try {
  if(roverOnly)roverStep='launch Reader';
  await mkdir(resultDir,{recursive:true});
  server=createServer(async(request,response)=>{
    try{
      const pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
      if(pathname==='/favicon.ico'){response.writeHead(204);response.end();return;}
      const filename=resolve(dist,'.'+(extname(pathname)?pathname:'/index.html'));
      if(!filename.startsWith(dist+sep))throw Error('Invalid local path');
      response.writeHead(200,{'Content-Type':mime[extname(filename)]??'application/octet-stream','Cache-Control':'no-store'});response.end(await readFile(filename));
    }catch{response.writeHead(404);response.end('Missing fixture');}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=spawn('/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader', '--window-size=1920,1080', '--force-device-scale-factor=1', '--disable-gpu-vsync',`--user-data-dir=${profile}`,'--remote-debugging-pipe','about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
  client=new CDP(browser.stdio[3],browser.stdio[4]);
  const t=await client.send('Target.createTarget',{url:'about:blank'});
  client.sessionId=(await client.send('Target.attachToTarget',{targetId:t.targetId,flatten:true})).sessionId;
  for(const d of ['Page','Runtime','Network'])await client.send(d+'.enable');
  await client.send('Emulation.setDeviceMetricsOverride',{width:1920,height:933,deviceScaleFactor:1,mobile:false});
  await client.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?script=1001`});
  await until(`!!document.querySelector('${tid('open-stories')}')&&!document.querySelector('${tid('open-stories')}').disabled&&!document.querySelector('${tid('reader-loading')}')`,'Reader ready');
  await click('settings');await click('instant-text');await click('settings-close');await click('start');
  if(avatarGeometry){
    await avatarGeometryScenes();
  }else if(roverOnly){
    await roverScenes();
  }else if(zoomOnly){
    zoomStep={kind:'navigation',at:'open 1009/5'};
    await openStory('1009');await advanceTo(5);await installProbe();await delay(1500);
    const readerState=await state();await click('menu');await click('switch-view');
    const developerState=await state();
    for(const key of ['scriptId','runId','visitId','nid'])assert.equal(developerState[key],readerState[key]);
    assert.ok(await client.evaluate(`!!document.querySelector('.developer-app')&&!document.querySelector('.reader-app')`));
    await sourceZoom();
  }else if(remaining){
    await remainingScenes();
  }else if(alphaOnly||avatarsOnly){
  await openStory('1002');await advanceTo(7);await installProbe();await delay(100);
  await measure('1002-7','.speaker-avatar [data-testid="rover-male-canvas"]');
  await contrastingAvatar('rover-male-700131');
  checks.push('full drawing-buffer alpha inspection');
  if(avatarsOnly){
    await avatarReady('male',700131);
    await gender('female');await avatarReady('female',700131);await measure('1002-7-female-reader-fallback');
    await openStory('1024');await advanceTo(2);await avatarReady('female',700127);
    await measure('1024-2-female','.speaker-avatar [data-testid="rover-female-canvas"]');await contrastingAvatar('rover-female-700127');
    await click('menu');await click('restart');await advanceTo(2);await avatarReady('female',700127);await measure('1024-2-female-restarted');
    await gender('male');await avatarReady('male',700127);
    await measure('1024-2-male','.speaker-avatar [data-testid="rover-male-canvas"]');await contrastingAvatar('rover-male-700127');
    await openStory('1001');await advanceTo(11);await unresolvedAvatar(700133);await measure('1001-11-unresolved-after-switch');
    await click('menu');await click('switch-view');
    assert.ok(await client.evaluate(`document.querySelector('[data-testid="avatar-asset-resolution"][data-who="750088"]').textContent.includes('dongzuo1_yansu_zui')`));
    const debugState=await state();await click('switch-view');assert.equal((await state()).visitId,debugState.visitId);
    await advanceTo(14);await avatarReady('male',700131);await measure('1001-14-recovered');
    await screenshot('1001-14-recovered');
    checks.push('both supported Rover genders over contrasting backgrounds; source-unresolved gender/expression clears; restart; script switching; exact Debug diagnosis; expression recovery has one actor');
  }
  }else{
  await advanceTo(8);await installProbe();await delay(2200);await measure('1001-8');
  await advanceTo(9);await delay(250);await measure('1001-9');
  await advanceTo(10);await delay(350);await measure('1001-10');
  await advanceTo(11);await measure('1001-11');await screenshot('1001-11');
  await advanceTo(20);await delay(3500);await advanceTo(21);await measure('1001-21');await screenshot('1001-21');
  await fullscreen('1001-21-fullscreen');
  await openStory('1002');await advanceTo(7);await delay(300);
  await measure('1002-7','.speaker-avatar [data-testid="rover-male-canvas"]');await screenshot('1002-7');
  await fullscreen('1002-7-fullscreen');
  await openStory('1004');await advanceTo(1);await delay(600);await measure('1004-1');await screenshot('1004-1');
  await openStory('1009');await advanceTo(5);await delay(350);await measure('1009-5');await screenshot('1009-5');
  checks.push('matching reported states; normal/fullscreen bounds; Abby movement; Chisa and Changli representative states');
  }
}catch(error){
  errors.push(String(error));process.exitCode=1;
  if(avatarGeometry){
    failure={at:roverStep,state:await state().catch(()=>null)};
    await screenshot('geometry-failure').catch(()=>{});
  }
  if(zoomStep){
    failure={...zoomStep,state:await state().catch(()=>null)};
    await screenshot('zoom-failure').catch(()=>{});
  }
}
finally{
  await writeFile(join(resultDir,`${phase}-measurements.json`),JSON.stringify({phase,completedAt:new Date().toISOString(),zoomStep,roverStep,failure,checks,navigation,captures,measurements,errors},null,2)+'\n');
  if(client&&browser?.exitCode===null)await client.send('Browser.close').catch(()=>{});
  if(browser?.exitCode===null)browser.kill('SIGTERM');
  await new Promise(r=>server?.close(r)??r());
  await rm(profile,{recursive:true,force:true}).catch(()=>{});
  console.log(JSON.stringify({phase,checks:checks.length,captures:captures.length,measurements:measurements.length,errors}));
}
