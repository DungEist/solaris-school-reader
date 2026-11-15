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
const resultDir = process.env.READER_RESULT_DIR ? resolve(process.env.READER_RESULT_DIR) : join(root, 'test-results/reader-runtime-playback');
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
  const r = await client.send('Page.captureScreenshot', { format:'jpeg', quality:80, captureBeyondViewport:false });
  const path = join(resultDir, name + '.jpg');
  await writeFile(path, Buffer.from(r.data, 'base64')); screenshots.push(path);
}
async function startClip(label) {
  client.clip = { label, frames:[] };
  await client.send('Page.startScreencast', { format:'jpeg', quality:75, maxWidth:1280, maxHeight:720, everyNthFrame:3 });
}
async function finishClip() {
  await client.send('Page.stopScreencast'); const clip=client.clip;client.clip=null;
  assert.ok(clip.frames.length>=3,'real compositor frames: '+clip.label);
  const directory=await mkdtemp(join(tmpdir(),'reader-runtime-frames-')),rows=[];
  for(const [i,f]of clip.frames.entries()){
    const path=join(directory,String(i).padStart(5,'0')+'.jpg');await writeFile(path,Buffer.from(f.data,'base64'));
    rows.push("file '"+path+"'");
    const duration=i+1<clip.frames.length?clip.frames[i+1].metadata.timestamp-f.metadata.timestamp:.1;rows.push('duration '+Math.max(.01,duration));
  }
  const input=join(directory,'frames.txt');await writeFile(input,rows.join('\n'));
  const output=join(resultDir,clip.label+'.mp4'),args=['-v','error','-y','-f','concat','-safe','0','-i',input];
  if(clip.label==='1008-central-square-audio')args.push('-i',join(resultDir,'1008-output.webm'));
  args.push('-vf','scale=1280:720','-c:v','libx264','-preset','veryfast','-crf','26','-pix_fmt','yuv420p');
  if(clip.label==='1008-central-square-audio')args.push('-c:a','aac','-b:a','128k','-shortest');
  args.push('-movflags','+faststart',output);
  await new Promise((resolve,reject)=>{const child=spawn('/usr/bin/ffmpeg',args,{stdio:['ignore','ignore','pipe']});let err='';child.stderr.on('data',d=>err+=d);child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(err)))});
  clips.push({label:clip.label,path:output,frames:clip.frames.length,firstTimestamp:clip.frames[0].metadata.timestamp,lastTimestamp:clip.frames.at(-1).metadata.timestamp});
  await rm(directory,{recursive:true,force:true});
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
  if(await client.evaluate(`!!document.querySelector('${tid('quiz')}')`)){const answer=await client.evaluate(`document.querySelector('${tid('quiz')}').dataset.phase==='question'`);await click(answer?'quiz-answer':'quiz-continue');return;}
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

const baseline = process.env.READER_BASELINE === '1';
const hook = `(()=>{
  const connect=AudioNode.prototype.connect;
  window.__outputGains=[];
  AudioNode.prototype.connect=function(destination){
    if(destination instanceof AudioDestinationNode && this instanceof GainNode && !window.__outputGains.includes(this))window.__outputGains.push(this);
    return connect.apply(this,arguments);
  };
  window.__startAudioCapture=()=>{
    const gains=window.__outputGains,context=gains[0].context,destination=context.createMediaStreamDestination();
    gains.forEach(g=>g.connect(destination));
    const parts=[],recorder=new MediaRecorder(destination.stream,{mimeType:'audio/webm;codecs=opus'});
    recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};
    window.__finishAudioCapture=()=>new Promise(resolve=>{recorder.onstop=async()=>{gains.forEach(g=>g.disconnect(destination));const bytes=new Uint8Array(await new Blob(parts).arrayBuffer());let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));resolve(btoa(s))};recorder.stop()});
    recorder.start(200);return {startedAt:performance.now(),channels:gains.length};
  };
})();`;
async function openScene(id, gender='male') {
  await client.send('Page.navigate',{url:origin+'/?script='+id+'&audioProbe=1&vfxProbe=1'});
  await until(`!document.querySelector('${tid('reader-loading')}')&&!!document.querySelector('${tid('start')}')&&!document.querySelector('${tid('start')}').disabled`,'entry '+id);
  await click('settings');await select('gender',gender);
  if(!await client.evaluate(`document.querySelector('${tid('instant-text')}').checked`))await click('instant-text');
  await click('settings-close');await click('start');
  await until(`['dialogue','choices'].includes(document.querySelector('${tid('runner-state')}').dataset.status)`,'scene '+id);
  if(id!=='1001')await sourceScene(id);
}
async function installPixels(){
  await until('!!window.spine?.SceneRenderer','Spine runtime');
  if (await client.evaluate('!!window.__samplePixels')) return;
  await client.evaluate(`(()=>{
    window.__pixelRenderers=new Map();const proto=spine.SceneRenderer.prototype,end=proto.end,draw=proto.drawSkeleton,begin=proto.begin;
    proto.begin=function(){this.__draws=[];return begin.apply(this,arguments)};
    proto.drawSkeleton=function(s){this.__draws.push({color:{r:s.color.r,g:s.color.g,b:s.color.b,a:s.color.a},root:[s.x,s.y],scale:[s.scaleX,s.scaleY]});return draw.apply(this,arguments)};
    proto.end=function(){const result=end.apply(this,arguments);window.__pixelRenderers.set(this.canvas,this);
      if(this.__pixelSample&&this.__draws.length){const request=this.__pixelSample;this.__pixelSample=null;const gl=this.context.gl,w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,bytes=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
        const r=this.canvas.getBoundingClientRect(),stage=document.querySelector('[data-testid="runner-state"]').getBoundingClientRect(),paper=document.querySelector('.dialogue-box').getBoundingClientRect();let painted=0,visible=0,abovePaper=0;const maximum=[0,0,0];
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(bytes[i+3]<16)continue;painted++;for(let c=0;c<3;c++)maximum[c]=Math.max(maximum[c],bytes[i+c]);const sx=r.x+x/w*r.width,sy=r.y+(1-y/h)*r.height;if(sx>=stage.left&&sx<stage.right&&sy>=stage.top&&sy<stage.bottom){visible++;if(sy<paper.top)abovePaper++;}}
        request({data:{...this.canvas.dataset},draws:this.__draws,painted,visible,abovePaper,maximum,glError:gl.getError(),rect:{x:r.x,y:r.y,width:r.width,height:r.height}});
      }return result};
    window.__samplePixels=()=>Promise.all([...window.__pixelRenderers].filter(([c,r])=>c.isConnected&&c.dataset.renderedWhos&&r.__draws?.length).map(([c,r])=>new Promise(resolve=>r.__pixelSample=resolve)));
  })()`);
}
async function avatarRecord(label,expression='700129'){
  await delay(550);const p=await client.evaluate(`(async()=>({avatar:document.querySelector('[data-testid="speaker-avatar"]')?{...document.querySelector('[data-testid="speaker-avatar"]').dataset}:null,engine:JSON.parse(document.querySelector('[data-testid="vfx-probe"]').textContent),pixels:await window.__samplePixels(),canvases:[...document.querySelectorAll("canvas")].map(c=>({...c.dataset})),paperZ:getComputedStyle(document.querySelector('.dialogue-box')).zIndex,avatarZ:document.querySelector('.reader-avatar-layer')?getComputedStyle(document.querySelector('.reader-avatar-layer')).zIndex:null}))()`);
  measurements.push({label,...p});await screenshot(label);console.log(label,p.avatar,p.pixels.map(x=>({whos:x.data.renderedWhos,visible:x.visible,abovePaper:x.abovePaper})));
  if(!baseline){assert.equal(p.avatar.who,'750088');assert.equal(p.avatar.expression,expression);assert.equal(p.avatar.avatarOpacity,'1.0000');assert.ok(p.pixels.some(x=>x.data.renderedWhos==='750088'&&x.visible>1000&&x.abovePaper>500),'visible avatar framebuffer above dialogue paper');assert.ok(Number(p.avatarZ)>Number(p.paperZ));}
  return p;
}
async function audioRecord(label,dwell=1200){
  const samples=[];for(let i=0;i<6;i++){await delay(dwell/6);const a=await audio();samples.push({...a.samples.at(-1),context:a.context,observations:a.observations.slice(-16)});}
  const m={label,state:await state(),samples};measurements.push(m);console.log(label,samples.at(-1).tracks,samples.at(-1).signal);return m;
}
let origin;
async function routeToSquare(){
  let wentOut=false;
  for(let i=0;i<600;i++){
    await dismissNotices();const s=await state();
    if(s.scriptId==='1008'&&s.nid==='1'){assert.ok(wentOut,'Central Square entered through Go out');return;}
    if(['dialogue','choices'].includes(s.status)){await step();continue;}
    const go=await client.evaluate(`Array.from(document.querySelectorAll('[data-testid="reader-actions"] [data-journey-option^="explore:"]')).find(e=>!e.disabled&&e.getClientRects().length)?.dataset.journeyOption??null`);
    if(go&&!wentOut){await clickSelector('[data-journey-option="'+go+'"]');wentOut=true;continue;}
    const central='[data-testid="reader-actions"] [data-journey-option="location:1015"]';
    if(await client.evaluate(`!!document.querySelector('${central}')&&!document.querySelector('${central}').disabled&&document.querySelector('${central}').getClientRects().length>0`)){await clickSelector(central);continue;}
    if(await client.evaluate(`!!document.querySelector('${tid('journey-continue')}')&&!document.querySelector('${tid('journey-continue')}').disabled`)){await click('journey-continue');continue;}
    await delay(80);
  }throw new Error('Could not reach Central Square by normal play');
}
async function audioScene(){
  await openScene('1001','female');await routeToSquare();
  await startClip('1008-central-square-audio');const recording=await client.evaluate('window.__startAudioCapture()');
  const marks=[];const mark=async label=>marks.push({label,at:await client.evaluate('performance.now()')-recording.startedAt});
  await mark('1008 entry: spring_day + square_quiet');const entry=await audioRecord('1008-1-entry',1600);
  assert.ok(entry.samples.some(s=>s.tracks.some(t=>t.cue==='play_avg_music_3_8_spring_day'&&t.channel==='music'&&t.sources>0)&&s.signal.music.rms>0.0001),'Original spring_day PCM reaches the music output');
  assert.ok(entry.samples.some(s=>s.tracks.some(t=>t.cue==='play_amb_avg_solarschool_square_quiet')));
  await advanceTo(4,0);await mark('1008/4 audition');const audition=await audioRecord('1008-4-audition',1800);
  assert.ok(audition.samples.some(s=>Object.values(s.trackSignal).some(t=>t.cue==='play_ui_solarschool_avg_audition'&&t.rms>0.0001)));
  await advanceTo(33,0);await mark('1008/33 slience');const quiet=await audioRecord('1008-33-slience',700);assert.ok(quiet.samples.every(s=>!s.tracks.some(t=>t.slot==='music')&&s.signal.music.rms===0));
  await advanceTo(35,0);await mark('1008/35 singing starts at +3s');const sing=await audioRecord('1008-35-katixiya-sing',28000);
  assert.ok(sing.samples.some(s=>Object.values(s.trackSignal).some(t=>t.cue==='play_ui_solarschool_avg_katixiya_sing'&&t.rms>0.0001&&t.volume>0)&&s.signal.effects.rms>0.0001),'Original singing PCM, separate from ambience, reaches the effects output');
  await advanceTo(44,0);await mark('1008/44 slience');const quiet44=await audioRecord('1008-44-slience',800);assert.ok(quiet44.samples.every(s=>!s.tracks.some(t=>t.slot==='music'||t.cue==='play_ui_solarschool_avg_katixiya_sing')&&s.signal.music.rms===0));
  await advanceTo(45,0);await mark('1008/45 spring_day returns');const restored=await audioRecord('1008-45-spring-day-return',2000);assert.ok(restored.samples.some(s=>s.tracks.some(t=>t.cue==='play_avg_music_3_8_spring_day')&&s.signal.music.rms>0.0001));
  const bytes=await client.evaluate('window.__finishAudioCapture()');await writeFile(join(resultDir,'1008-output.webm'),Buffer.from(bytes,'base64'));await finishClip();
  await writeFile(join(resultDir,'1008-recording-chapters.json'),JSON.stringify({recording,marks},null,2));await screenshot('1008-45-original-music-restored');
  checks.push('1008 via Go out: original spring_day on entry and /45, square ambience, /4 audition, /33 and /44 music silence, /35 real singing PCM and audio recording');
}
async function canvasFrame(){return client.evaluate(`(()=>{const c=document.querySelector('${tid('reader-vfx-canvas')}');if(!c)return{painted:0,hash:0,data:null,engine:JSON.parse(document.querySelector('${tid('vfx-probe')}').textContent)};const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let painted=0,hash=2166136261;for(let i=0;i<p.length;i+=4){painted+=Number(p[i+3]>0);hash=Math.imul(hash^p[i],16777619);hash=Math.imul(hash^p[i+3],16777619);}return{painted,hash:hash>>>0,data:{...c.dataset},engine:JSON.parse(document.querySelector('${tid('vfx-probe')}').textContent)};})()`)}
async function effectScene(id,nid,name,stopNid=null){
  await sourceScene(id);const source=JSON.parse(await readFile(join(root,'public/data/scripts',id+'.json'),'utf8')),block=source.flowActions.find(a=>a.nids?.includes(nid));const index=block.nids.indexOf(nid),previous=block.nids[Math.max(0,index-1)];await advanceTo(index===0?nid:previous,0);
  const label=id+'-'+nid+'-'+name.replace('UiItem_Fx','');await startClip(label);
  if(index!==0)await step();
  await until(`JSON.parse(document.querySelector('${tid('vfx-probe')}').textContent).effects.active.some(e=>e.name===${JSON.stringify(name)})`,'real '+name+' at '+id+'/'+nid);
  await delay(180);const onset=await canvasFrame();assert.ok(onset.painted>10,name+' paints screen pixels');await screenshot(label+'-onset');
  await delay(420);const motion=await canvasFrame();assert.notEqual(motion.hash,onset.hash,name+' moves actual screen pixels');
  if(stopNid===0){for(let i=0;i<500&&(await vfx()).effects.active.some(e=>e.name===name);i++){const status=(await state()).status;if(['dialogue','choices'].includes(status))await step();else if(status==='completed')break;else await delay(50);}await delay(200);}
  else if(stopNid!==null){await advanceTo(stopNid,0);const active=(await vfx()).effects.active.some(e=>e.name===name);if(active)await step();await delay(200);}
  else await delay(1900);
  const removed=await canvasFrame();assert.ok(!removed.engine.effects.active.some(e=>e.name===name),name+' obeys authored stop or burst lifetime');
  measurements.push({label,onset,motion,removed});await screenshot(label+'-removed');await finishClip();checks.push(id+'/'+nid+' '+name+' onset, moving pixels, removal');console.log('Verified',label);
}
async function customEffects(){
  await openScene('1001');
  for(const [id,nid,name,target]of [['3010',31,'BurstEye','screen'],['1002',6,'Shake','screen'],['1001',10,'Shake','portrait'],['1008',10,'Sigh','portrait'],['1001',12,'Jump','portrait']].filter(c=>!process.env.READER_CUSTOM_EFFECTS||process.env.READER_CUSTOM_EFFECTS.split(',').includes(c[2]))){
    await sourceScene(id);const source=JSON.parse(await readFile(join(root,'public/data/scripts',id+'.json'),'utf8')),block=source.flowActions.find(a=>a.nids?.includes(nid)),previous=block.nids[block.nids.indexOf(nid)-1];await advanceTo(previous,0);await installPixels();
    await until('[...window.__pixelRenderers].some(([c,r])=>c.isConnected&&c.dataset.renderedWhos&&r.__draws?.length)','initial portrait draw before effect');
    const beforePixels=await client.evaluate('window.__samplePixels()');
    const label=id+'-'+nid+'-'+target+'-'+name;await startClip(label);await step();await until(`JSON.parse(document.querySelector('${tid('vfx-probe')}').textContent).effects.active.some(e=>e.name===${JSON.stringify(name)}&&e.target===${JSON.stringify(target)})`,label);
    await delay(name==='Shake'?80:30);const during=await vfx(),scene=await client.evaluate(`({transform:getComputedStyle(document.querySelector('${tid('runner-state')}')).transform,pixels:await window.__samplePixels()})`.replace('({transform:','(async()=>({transform:').replace('})','}))()'));
    assert.ok(during.effects.active.some(e=>e.name===name&&e.target===target));
    if(name==='BurstEye')assert.ok((await canvasFrame()).painted>100);
    else if(target==='screen')assert.notEqual(scene.transform,'none');
    else {
      assert.ok(during.characters.some(c=>c.position.some((p,i)=>p!==c.sourcePosition[i])));
      console.log(label+' rendered roots',beforePixels.map(p=>[p.data.renderedWhos,p.draws[0].root]),scene.pixels.map(p=>[p.data.renderedWhos,p.draws[0].root]));
      assert.ok(scene.pixels.some(p=>beforePixels.some(b=>b.data.renderedWhos===p.data.renderedWhos&&b.draws[0].root.some((value,i)=>Math.abs(value-p.draws[0].root[i])>.1))),label+' changes the actual rendered skeleton root');
    }
    await screenshot(label+'-motion');await delay(1200);const removed=await vfx(),removedPixels=await client.evaluate('window.__samplePixels()');assert.ok(!removed.effects.active.some(e=>e.name===name&&e.target===target));await screenshot(label+'-removed');await finishClip();measurements.push({label,beforePixels,during,scene,removed,removedPixels});checks.push(label+' authored target, rendered motion, removal');
  }
}

async function allEffects(){
  await openScene('1001');
  const cases=[
    ['6012',19,'UiItem_FxLoop_Danger',26],['1015',40,'UiItem_FxStart_Black'],['9013',13,'UiItem_FxStart_SpeedLine'],['8018',11,'UiItem_FxStart_SpeedLineBlack'],
    ['1002',5,'UiItem_FxLoop_PurpleHuaban',11],['1002',15,'UiItem_FxStart_Butterfly'],['1006',15,'UiItem_FxStart_Huaban'],['1008',36,'UiItem_FxStart_Sound'],
    ['3016',1,'UiItem_FxLoop_Fog',3],['11007',103,'UiItem_FxLoop_SunGlow',108],['3016',9,'UiItem_FxLoop_SunGlowBig_2',28],['6006',4,'UiItem_FxLoop_SunLight',21],
    ['3009',1,'UiItem_FxStart_Celebrate'],['3009',2,'UiItem_FxLoop_Celebrate',8],['6003',27,'UiItem_FxLoop_Huaban',0],['6018',6,'UiItem_FxLoop_Star',0],['7045',30,'UiItem_FxLoop_BUG',39],['12003',84,'UiItem_FxStart_GreenHuaban'],
  ];
  for(const args of cases.filter(c=>!process.env.READER_EFFECTS||process.env.READER_EFFECTS.split(',').some(name=>c[2].includes(name))))await effectScene(...args);
}

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
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = spawn(process.env.CHROMIUM_BIN ?? '/usr/bin/chromium', ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader',`--user-data-dir=${profile}`,'--remote-debugging-pipe','about:blank'], { stdio:['ignore','ignore','ignore','pipe','pipe'] });
  client = new CDP(browser.stdio[3], browser.stdio[4]);
  const target = await client.send('Target.createTarget', { url:'about:blank' });
  client.sessionId = (await client.send('Target.attachToTarget', { targetId:target.targetId, flatten:true })).sessionId;
  for (const domain of ['Page','Runtime','Network']) await client.send(domain + '.enable');
  await client.send('Emulation.setDeviceMetricsOverride', { width:1600,height:900,deviceScaleFactor:1,mobile:false });

  await client.send('Page.addScriptToEvaluateOnNewDocument',{source:hook});
  if(!process.env.READER_PART || process.env.READER_PART==='avatar')for(const id of ['1001','1002'])for(const gender of ['male','female']){
    await openScene(id,gender);const first=id==='1001'?21:35;await advanceTo(first-5,0);await installPixels();
    if(!baseline){await startClip(id+'-'+gender+'-other-inherited-avatar');await avatarRecord(id+'-'+(first-5)+'-'+gender+'-inherited','700134');await step();await avatarRecord(id+'-'+(first-4)+'-'+gender+'-inherited','700134');await finishClip();}
    await advanceTo(first,0);
    await startClip(id+'-'+gender+'-avatar');await avatarRecord(id+'-'+first+'-'+gender);await step();await avatarRecord(id+'-'+(first+1)+'-'+gender);await delay(450);await step();await delay(600);await screenshot(id+'-'+(await state()).nid+'-'+gender+'-after-advance');await finishClip();
  }
  if(process.env.READER_PART==='audio')await audioScene();
  if(process.env.READER_PART==='vfx')await allEffects();
  if(process.env.READER_PART==='custom')await customEffects();
  if(!baseline && (!process.env.READER_PART||process.env.READER_PART==='avatar'))checks.push('Both Rover genders render 700129 dialogue avatars through both requested consecutive-line pairs');
} catch(error){ failure=error; console.error(error.stack); }
finally {
  await writeFile(join(resultDir,baseline?'baseline.json':'playback.json'),JSON.stringify({baseline,checks,measurements,navigation,errors,screenshots,clips,failure:failure?.message},null,2));
  if(browser)browser.kill('SIGKILL');if(server)await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
if(failure)process.exitCode=1;
