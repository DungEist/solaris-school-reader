/** Uninterrupted production Reader: boundaries, --places, and all --decisions. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dist=join(root,'dist');
const before=process.argv.includes('--before'),placesMode=process.argv.includes('--places'),decisionsMode=process.argv.includes('--decisions'),mode=decisionsMode?'decisions':placesMode?'places':before?'before':'after';
const resultRelative=decisionsMode?'test-results/reader-decisions':placesMode?'test-results/reader-places':`test-results/phase8-boundaries/${mode}`;
const resultDir=join(root,resultRelative),screenshotDir=join(resultDir,'captures');
const profile=await mkdtemp(join(tmpdir(),'solaris-boundary-'));
const checks=[],screenshots=[],errors=[],route=[];
const testId=id=>`[data-testid="${id}"]`;
let browser,client,server,browserErrors='',lastControl=null,lastScene=null;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.wasm':'application/wasm'};
const source=JSON.parse(await readFile(join(dist,'data','maps','story-source.json'),'utf8'));
const english=JSON.parse(await readFile(join(dist,'data','locales','en.json'),'utf8'));
const feelingId=Number(Object.values(source.attrs).find(row=>english[row.Name]==='Feeling').Id);
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
const settle = () => client.evaluate('new Promise(resolve => { const timer=setTimeout(resolve,100);requestAnimationFrame(() => requestAnimationFrame(() => {clearTimeout(timer);resolve();})); })');
const state = () => client.evaluate(`(() => { const e = document.querySelector('${testId('runner-state')}'); return { run: e.dataset.runId, visit: e.dataset.visitId, nid: e.dataset.nid, status: e.dataset.status, script: e.dataset.scriptId }; })()`).then(value=>{lastScene=value;return value;});
async function clickSelector(selector) {
  lastControl=selector;
  await until(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return e && !e.disabled && e.getClientRects().length > 0; })()`, `enabled ${selector}`);
  const point = await client.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,height:innerHeight}; })()`);
  assert.ok(point.x >= 0 && point.y >= 0 && point.x < point.width && point.y < point.height, `Control is offscreen: ${selector}`);
  delete point.width;delete point.height;
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


const installProbe=`(() => {
  const e=document.querySelector('[data-testid="runner-state"]');
  const key=Object.keys(e).find(k=>k.startsWith('__reactFiber$'));
  let fiber=e[key],owner;
  while(fiber){if(fiber.memoizedProps?.runner?.getSnapshot){owner=fiber.memoizedProps;break;}fiber=fiber.return;}
  if(!owner)throw new Error('Cannot locate read-only runner probe');
  const runner=owner.runner,journey=owner.journey,presentations=owner.presentations;
  const ids=new WeakMap();let next=0;
  const canvasId=e=>{if(!ids.has(e))ids.set(e,++next);return ids.get(e);};
const trace={events:[],handoffs:[],removedCanvases:[],schoolYearMounts:[],errors:[]};
  const actors=s=>Object.values(s.stageState.characters).map(c=>({who:c.who,present:c.present,portraitVisible:c.portraitVisible,avatarVisible:c.avatarVisible,entry:c.entrySequence,sourceScript:c.lastEvent.scriptId,sourceNode:c.lastEvent.nid,expression:c.expression}));
  const model=s=>({script:s.scriptId,node:s.nid,run:s.runId,scene:s.sceneId,visit:s.visitId,status:s.status,phase:s.stagePhase,pending:s.pendingStage.length,actors:actors(s),attributes:s.storyState.attributes,favor:s.storyState.favor,items:Object.fromEntries(Object.entries(s.storyState.items).filter(([,v])=>v.min>0)),flowReads:s.storyState.flowReads,initialized:s.storyState.initialized,day:s.storyState.dayIndex,slot:s.storyState.timeSlot,instance:s.storyState.instanceId,location:s.storyState.locationId,cycle:s.storyState.playthroughCount});
  let previous=model(runner.getSnapshot());
  runner.subscribe(()=>{try{const s=model(runner.getSnapshot());if(s.script!==previous.script && s.script)trace.handoffs.push({from:previous,to:s});previous=s;}catch(e){trace.errors.push(String(e));}});
  runner.onEvent(e=>{try{
    if(e.type==='storyMutation')trace.events.push({type:e.type,script:e.scriptId,node:e.nid,sequence:e.sequence,stageSequence:e.stageSequence,action:e.actionId,changes:e.changes});
    else if(['completed','talkComplete','checkpointRestored'].includes(e.type))trace.events.push({type:e.type,script:e.scriptId,node:e.nid,sequence:e.sequence});
    else if(e.type==='stage' && ['enter','exit','modify','activityAction'].includes(e.operation.op))trace.events.push({type:e.type,script:e.scriptId,node:e.nid,sequence:e.sequence,phase:e.phase,op:e.operation.op,who:e.operation.who,action:e.operation.actionId});
  }catch(e){trace.errors.push(String(e));}});
  new MutationObserver(records=>{for(const record of records){
    for(const n of record.removedNodes){if(n.nodeType!==1)continue;const cs=[...(n.matches?.('canvas')?[n]:[]),...n.querySelectorAll('canvas')];for(const c of cs)if(c.dataset.testid)trace.removedCanvases.push({id:canvasId(c),name:c.dataset.testid,connected:c.isConnected});}
    for(const n of record.addedNodes){if(n.nodeType===1&&(n.matches?.('[data-testid="journey-panel"]')||n.querySelector('[data-testid="journey-panel"]')))trace.schoolYearMounts.push({script:runner.getSnapshot().scriptId,node:runner.getSnapshot().nid,day:runner.getSnapshot().storyState.dayIndex});}
  }}).observe(document.getElementById('root'),{subtree:true,childList:true});
  const actions=()=>[...document.querySelectorAll('[data-testid="reader-actions"] button')].map(e=>({id:e.dataset.journeyOption,kind:e.dataset.journeyKind,control:e.dataset.journeyControl,text:e.innerText.replace(/\\s+/g,' ').trim(),disabled:e.disabled}));
  trace.snapshot=()=>({
    url:location.pathname+location.search,model:model(runner.getSnapshot()),
    journey:journey?{phase:journey.getSnapshot().phase,busy:journey.getSnapshot().busy,day:journey.getSnapshot().dayIndex,slot:journey.getSnapshot().timeSlot,instance:journey.getSnapshot().instanceId,interaction:journey.getSnapshot().interaction,selectingLocation:journey.getSnapshot().selectingLocation,sceneCount:journey.getSnapshot().sceneCount,canContinue:journey.getSnapshot().canContinue,options:journey.getSnapshot().options.map(o=>({id:o.id,kind:o.kind,sourceId:o.sourceId,contextId:o.contextId,labelKey:o.labelKey,condition:o.condition.value,progress:o.progress,target:o.target,price:o.price}))}:null,
    notices:presentations?.getSnapshot().relationships??[],card:document.querySelector('[data-testid="reader-relationship"]')?.innerText??null,
    places:[...document.querySelectorAll('[data-testid="reader-actions"] [data-journey-kind="location"],[data-testid="reader-places"] button')].map(e=>({id:e.dataset.journeyOption,text:e.innerText.replace(/\\s+/g,' ').trim(),disabled:e.disabled})),
    actions:actions(),context:document.querySelector('[data-testid="journey-context"]')?.innerText??null,
    schoolYearMounts:trace.schoolYearMounts.length,panel:document.querySelector('dialog[open]')?.innerText??null,
    canvas:[...document.querySelectorAll('.visual-stage canvas')].map(c=>({id:canvasId(c),name:c.dataset.testid,instances:c.dataset.instanceWhos??'',rendered:c.dataset.renderedWhos??'',state:c.dataset.rendererState,connected:c.isConnected})),
    dialogue:document.querySelector('[data-testid="dialogue-text"]')?.innerText
  });
  window.__boundaryTrace=trace;
  return trace.snapshot();
})()`;
const probe=()=>client.evaluate('window.__boundaryTrace.snapshot()');
const capture=async name=>{await screenshot(name);const p=await probe();checks.push({name,capture:`${resultRelative}/captures/${name}.jpg`,...p});return p;};
const enabledControls=()=>client.evaluate(`Array.from(document.querySelectorAll('button')).filter(e=>e.getClientRects().length&&!e.disabled).map(e=>({test:e.dataset.testid,option:e.dataset.optionId,answer:e.dataset.answerId,journey:e.dataset.journeyOption,text:e.innerText}))`);
async function checkpoint(action){await click('settings');await click(action+'-checkpoint');await click('settings-close');}
let abby=false,chisa=false,goOut=false,street1=false,street6=false,square=false,pair=false,checkpointSaved=false;
let outgoing,afterStreet,atSquare,finishedSquare,confirmationChecks=[];
const placesChecks=[];
const decisionChecks=[];
async function normalStep(){
  const p=await probe(),s=p.model;
  if((placesMode||decisionsMode) && ['1006','1007'].includes(s.script) && s.status!=='completed')assert.deepEqual(p.places,[],'Street dialogue plays before the destination selector');
  if(p.card){
    const role=p.notices?.[0]?.change?.roleId;
    if(role===12&&!abby || role===11&&!chisa){
      const name=role===12?'abby-card':'chisa-card';const shot=await capture(name);
      const trace=await client.evaluate('window.__boundaryTrace.events');
      const earned=trace.filter(e=>e.type==='storyMutation'&&e.changes.some(c=>c.kind==='favorLevel'&&c.roleId===role)).at(-1);
      const completed=trace.filter(e=>e.type==='completed'&&e.script===earned.script).at(-1);
      confirmationChecks.push({role,earned,display:{script:s.script,node:s.node,status:s.status,pending:s.pending},completed:completed??null});
      if(!before){assert.equal(s.script,role===12?'1001':'1004');assert.equal(s.status,'completed');assert.equal(s.node,null);assert.equal(s.pending,0);assert.ok(completed&&completed.sequence>earned.sequence);}
      else assert.equal(completed,undefined,'before reproduction captures the early card');
      if(role===12)abby=true;else chisa=true;
    }
    const origin=s.script,confirmedId=p.notices[0].id;await click('relationship-confirm');
    if(!before&&role===12)await until(`window.__boundaryTrace.snapshot().model.script==='1003'&&window.__boundaryTrace.snapshot().model.node===1`,'Abby Confirm resumes 1003/1');
    if(!before&&role===11)await until(`window.__boundaryTrace.snapshot().journey.phase==='planning'&&window.__boundaryTrace.snapshot().model.day===2&&window.__boundaryTrace.snapshot().model.slot===1`,'Chisa Confirm resumes Morning planning');
    const next=await probe();
    assert.notEqual(next.notices?.[0]?.id,confirmedId,'Confirm dismisses the earned card once');
    if(role===12||role===11)assert.equal(next.card,null);
    confirmationChecks.push({confirmFrom:origin,resumedAt:{script:next.model.script,node:next.model.node,status:next.model.status}});
    return;
  }
  if(['1001','1004'].includes(s.script)&&!checks.some(c=>c.name===s.script+'-entry')&&(s.node===1||s.node===2)){
    await capture(s.script+'-entry');if(!before)assert.equal(p.card,null);
  }
  if(s.script==='1001'&&s.node===22&&!checks.some(c=>c.name==='abby-final-dialogue')){await capture('abby-final-dialogue');if(!before)assert.equal(p.card,null);}
  if(s.script==='1004'&&s.node===27&&!checks.some(c=>c.name==='chisa-final-dialogue')){await capture('chisa-final-dialogue');if(!before)assert.equal(p.card,null);}
  if((s.script==='1006'||s.script==='1007')&&s.node===1&&!street1){
    await until(`Array.from(document.querySelectorAll('.visual-stage canvas')).some(c=>c.dataset.rendererState==='ready')||!Object.values(window.__boundaryTrace.snapshot().model.actors).some(c=>c.portraitVisible)`,'street canvas settled');
    await delay(350);afterStreet=await capture('street-node-1');street1=true;
    if(!before){
      assert.equal(afterStreet.model.actors.some(c=>c.who==='1316'),false);assert.equal(afterStreet.canvas.some(c=>c.rendered.split(',').includes('1316')),false);
      assert.notEqual(afterStreet.model.scene,outgoing.model.scene);assert.equal(afterStreet.model.run,outgoing.model.run);
      const oldCanvas=outgoing.canvas.find(c=>c.rendered.split(',').includes('1316'));assert.ok(oldCanvas,'Outgoing interior rendered Abby');
      assert.equal(afterStreet.canvas.some(c=>c.id===oldCanvas.id),false,'Outgoing canvas is unmounted');
      assert.ok(await client.evaluate(`window.__boundaryTrace.removedCanvases.some(c=>c.id===${oldCanvas.id}&&!c.connected)`),'DOM removal confirms the old Abby canvas is disconnected');
    }
    else assert.ok(afterStreet.model.actors.some(c=>c.who==='1316'&&c.portraitVisible));
  }
  if((s.script==='1006'||s.script==='1007')&&s.node===6&&!street6){
    await until(`window.__boundaryTrace.snapshot().canvas.some(c=>c.rendered.split(',').includes('1398'))`,'Shorekeeper rendered');
    const shot=await capture('street-node-6');street6=true;
    const actors=[...new Set(shot.canvas.flatMap(c=>c.rendered.split(',').filter(Boolean)))].sort();
    if(!before)assert.deepEqual(actors,['1398']);else assert.ok(actors.includes('1316')&&actors.includes('1398'));
  }
  if(s.script==='1008'&&s.node===5&&!square){
    await until(`window.__boundaryTrace.snapshot().canvas.some(c=>c.rendered.split(',').includes('50074'))`,'Cartethyia rendered');
    atSquare=await capture('central-square-node-5');square=true;
    const actors=[...new Set(atSquare.canvas.flatMap(c=>c.rendered.split(',').filter(Boolean)))].sort();
    if(!before)assert.deepEqual(actors,['50074']);else assert.ok(actors.includes('1316')&&actors.includes('50074'));
  }
  if(s.script==='1008'&&s.node===54&&!pair){
    await until(`window.__boundaryTrace.snapshot().canvas.some(c=>c.rendered.split(',').includes('150036'))`,'Ciaccona rendered');
    const shot=await capture('central-square-two-characters');pair=true;
    if(!before)assert.deepEqual([...new Set(shot.canvas.flatMap(c=>c.rendered.split(',').filter(Boolean)))].sort(),['150036','50074']);
  }
  const buttons=await enabledControls();
  if(s.status==='dialogue'||s.status==='choices'){
    const choice=buttons.find(b=>b.test==='choice');
    if(s.status==='choices'&&choice){route.push({script:s.script,node:s.node,option:choice.option});await clickSelector(`[data-testid="choice"][data-option-id="${choice.option}"]`);return;}
    if(buttons.some(b=>b.test==='advance')){await click('advance');return;}
  }
  if(buttons.some(b=>b.test==='letter-confirm')){await click('letter-confirm');return;}
  if(p.journey?.phase==='planning'){
    if(!goOut && p.model.day===2&&p.model.slot===1){
      outgoing=await capture('morning-interior');
      if(decisionsMode){
        assert.equal(p.panel,null);assert.equal(p.schoolYearMounts,0);
        await recordDecision('morning-go-out',p);
      }else{
        await checkpoint('save');checkpointSaved=true;
        await click('menu');await click('menu-stories');
        await until(`document.querySelector('dialog[open]')?.innerText.includes('School year')`,'School year menu');
        await capture('school-year-explore');
      }
      const explore=buttons.find(b=>b.journey?.startsWith('explore:'))??(await enabledControls()).find(b=>b.journey?.startsWith('explore:'));
      assert.ok(explore,'Morning exposes Go out');route.push({script:s.script,node:s.node,journey:explore.journey,text:explore.text});
      await clickSelector(`[data-journey-option="${explore.journey}"]`);goOut=true;
      if((await enabledControls()).some(b=>b.test==='stories-close'))await click('stories-close');
      return;
    }
    const locations=buttons.filter(b=>b.journey?.startsWith('location:'));
    if(goOut&&street6&&!square){
      const central=locations.find(b=>b.text.includes('Central Square'));assert.ok(central,'Places exposes Central Square');
      if(placesMode||decisionsMode){
        assert.equal(s.script,'1006');assert.equal(s.status,'completed');assert.equal(p.panel,null);assert.equal(p.journey.selectingLocation,true);
        assert.deepEqual(p.places,[{id:'location:1015',text:'Central Square 0/1',disabled:false},{id:'location:1016',text:'School Store 0/1',disabled:false}]);
        const layout=await client.evaluate(`(() => {const p=document.querySelector('[data-testid="reader-actions"]')??document.querySelector('[data-testid="reader-places"]'),stage=document.querySelector('[data-testid="runner-state"]'),r=p.getBoundingClientRect(),s=stage.getBoundingClientRect();return {withinStage:stage.contains(p),right:r.left>s.left+s.width/2,visible:r.top>=0&&r.bottom<=innerHeight,planningPanel:!!document.querySelector('[data-testid="journey-panel"]')};})()`);
        assert.deepEqual(layout,{withinStage:true,right:true,visible:true,planningPanel:false});
        placesChecks.push({name:'street-completed-places',script:s.script,node:s.node,source:p.journey.options.filter(o=>o.kind==='location'),buttons:p.places,layout});
        await capture('street-completed-places');
        if(decisionsMode)await recordDecision('street-completed-destinations',p,false);
      }
      route.push({script:s.script,node:s.node,journey:central.journey,text:central.text});await clickSelector(`${placesMode||decisionsMode?'[data-testid="place-choice"]':''}[data-journey-option="${central.journey}"]`);
      if(placesMode||decisionsMode){await until(`window.__boundaryTrace.snapshot().model.script==='1008'&&window.__boundaryTrace.snapshot().model.node===1`,'Stage destination opens Central Square');const next=await capture('destination-opened-once');assert.deepEqual(next.places,[]);assert.equal(next.journey.sceneCount,p.journey.sceneCount+1);placesChecks.push({name:'selection',script:next.model.script,node:next.model.node,sceneCountBefore:p.journey.sceneCount,sceneCountAfter:next.journey.sceneCount});}
      return;
    }
    if(buttons.some(b=>b.test==='journey-continue')){await click('journey-continue');return;}
  }
  if(buttons.some(b=>b.test==='stories-close')){await click('stories-close');return;}
  await delay(100);
}

async function recordDecision(name,p,saveCapture=true){
  p??=await probe();
  assert.equal(p.schoolYearMounts,0,'Progression has never mounted School year.');
  assert.equal(p.panel,null,'The current decision keeps the normal stage visible.');
  const expected=p.journey.options.filter(o=>o.kind!=='scratchReveal').map(o=>({id:o.id,disabled:o.condition!=='true'})).sort((a,b)=>a.id.localeCompare(b.id));
  const actual=p.actions.filter(o=>o.id).map(o=>({id:o.id,disabled:o.disabled})).sort((a,b)=>a.id.localeCompare(b.id));
  assert.deepEqual(actual,expected,'Every current source action and eligibility is available on stage.');
  const layout=await client.evaluate(`(() => {const e=document.querySelector('[data-testid="reader-actions"]'),stage=document.querySelector('[data-testid="runner-state"]');if(!e)return null;const r=e.getBoundingClientRect(),s=stage.getBoundingClientRect();return {withinStage:stage.contains(e),right:r.left>s.left+s.width/2,visible:r.top>=0&&r.bottom<=innerHeight};})()`);
  assert.deepEqual(layout,{withinStage:true,right:true,visible:true});
  if(saveCapture)await capture(name);
  decisionChecks.push({name,day:p.model.day,slot:p.model.slot,instance:p.model.instance,location:p.model.location,script:p.model.script,node:p.model.node,phase:p.journey.phase,canContinue:p.journey.canContinue,actions:p.actions,layout});
}

const decisionDispatches={};
let openingFinished=false,laterDestinations=false,returnedRestaurant=false,regularActions=false,paidActivity=false,storeVisited=false,storeOption=false,shopSeen=false,shopPurchased=false,explicitFinish=false;
const visitedLocations=new Set(),visitedOptions=new Set(),playedGames=new Set();
async function chooseStage(p,action){
  assert.ok(action&&!action.disabled);
  assert.equal(p.schoolYearMounts,0);
  const kind=action.kind??action.control;
  decisionDispatches[kind]=(decisionDispatches[kind]??0)+1;
  if(action.id)route.push({day:p.model.day,slot:p.model.slot,script:p.model.script,node:p.model.node,journey:action.id,text:action.text});
  await clickSelector('[data-testid="reader-actions"] '+(action.id?`[data-journey-option="${action.id}"]`:`[data-journey-control="${action.control}"]`));
}
async function remainingStep(){
  const p=await probe(),s=p.model,j=p.journey;
  assert.equal(p.schoolYearMounts,0,'The uninterrupted playthrough does not open School year.');
  assert.notEqual(j.phase,'blocked','The live journey engine can progress.');
  const buttons=await enabledControls(),available=p.actions.filter(action=>!action.disabled);
  if(p.card){assert.deepEqual(p.actions,[],'Tier confirmation precedes the next stage decision.');await click('relationship-confirm');return;}
  if(buttons.some(b=>b.test==='letter-confirm')){assert.deepEqual(p.actions,[]);await click('letter-confirm');return;}
  if(j.interaction?.kind==='requestDone'||j.interaction?.kind==='requestFailed'){
    assert.deepEqual(p.actions,[],'Native reward/expiry confirmations retain their input boundary.');await click('journey-confirm');return;
  }
  if(j.interaction){
    const kind=j.interaction.kind;
    if(kind==='shop'){
      if(!shopSeen){await recordDecision('school-store-shop-actions',p);shopSeen=true;}
      const item=available.filter(action=>action.kind==='shopItem').sort((a,b)=>{
        const left=j.options.find(o=>o.id===a.id),right=j.options.find(o=>o.id===b.id);return left.price-right.price;
      })[0];
      if(item&&!shopPurchased){
        const eventIndex=await client.evaluate('window.__boundaryTrace.events.length');
        await chooseStage(p,item);shopPurchased=true;
        const receipt=await capture('on-stage-purchase-receipt');
        assert.ok(receipt.context?.includes('Received'),'The actual item receipt is visible in the stage shop.');
        assert.equal(receipt.panel,null);
        const visible=await client.evaluate(`(() => {const e=document.querySelector('[data-testid="journey-context"] [data-testid="consequence-item"]'),region=e.closest('[data-testid="reader-consequences"]'),r=e.getBoundingClientRect(),s=region.getBoundingClientRect();return r.top>=s.top&&r.bottom<=s.bottom&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()`);
        assert.equal(visible,true,'The received item stays in view ahead of earlier gain notices.');
        const grants=await client.evaluate(`window.__boundaryTrace.events.slice(${eventIndex}).filter(e=>e.type==='storyMutation').flatMap(e=>e.changes).filter(c=>c.kind==='item')`);
        assert.equal(grants.length,1,'One click receives the purchased item once.');
        decisionChecks.push({name:'shop-reward-once',script:receipt.model.script,node:receipt.model.node,selected:item.id,changes:grants,schoolBadgesBefore:s.attributes['8'],schoolBadgesAfter:receipt.model.attributes['8'],capture:resultRelative+'/captures/on-stage-purchase-receipt.jpg'});
        return;
      }
    }
    if(kind==='scratch'){
      const settlement=available.find(action=>action.kind==='scratchSettle');
      if(settlement){await chooseStage(p,settlement);return;}
      const cell=buttons.find(button=>button.test==='scratch-cell');
      if(cell&&!playedGames.has('scratch')){playedGames.add('scratch');await clickSelector(`[data-testid="scratch-cell"][data-journey-option="${cell.journey}"]`);return;}
    }
    const control=available.find(action=>action.control==='dismiss');
    const required=kind==='ending'||kind==='event'||j.interaction.requiresChoice;
    if(!required&&control){
      if(kind==='request'&&!playedGames.has('request')){
        const request=available.find(action=>action.kind==='request');if(request){playedGames.add('request');await recordDecision('request-acceptance',p);await chooseStage(p,request);return;}
      }
      if(kind==='raffle'&&!playedGames.has('raffle')){
        const draw=available.find(action=>action.kind==='raffle');if(draw){playedGames.add('raffle');await recordDecision('prize-draw',p);await chooseStage(p,draw);return;}
      }
      await chooseStage(p,control);return;
    }
    const action=available.find(action=>action.id);
    if(action){await chooseStage(p,action);return;}
  }
  if(j.phase==='planning'){
    if(s.day===2){
      assert.deepEqual(p.places,[{id:'location:1016',text:'School Store 0/1',disabled:false}]);
      await recordDecision('returned-central-square',p);
      const store=available.find(a=>a.id==='location:1016');await chooseStage(p,store);
      const entry=await capture('school-store-opened-once');
      assert.equal(entry.model.script,'1010');assert.equal(entry.journey.sceneCount,j.sceneCount+1);
      assert.deepEqual(entry.actions,[]);
      return;
    }
    if(!openingFinished&&s.day===3){
      assert.equal(s.flowReads['1006'],1);assert.equal(s.flowReads['1008'],1);assert.equal(s.flowReads['1010'],1);
      await recordDecision('opening-outing-finished',p);openingFinished=true;
      decisionChecks.push({name:'03-16-auto-finish',completed:['1006','1008','1010'],readCounts:Object.fromEntries(['1006','1008','1010'].map(id=>[id,s.flowReads[id]])),nextDay:s.day,schoolYearMounts:p.schoolYearMounts});
    }
    const explore=available.find(action=>action.kind==='explore');
    if(explore){await chooseStage(p,explore);return;}
    if(s.day===3&&j.selectingLocation){
      if(!laterDestinations){
        assert.deepEqual(p.places,[{id:'location:1029',text:'Family Restaurant 0/1',disabled:false},{id:'location:1030',text:'Teaching Building 0/1',disabled:false}]);
        await recordDecision('03-17-different-destinations',p);laterDestinations=true;
      }
      if(s.flowReads['1011']===1&&!returnedRestaurant){
        assert.deepEqual(p.places,[{id:'location:1030',text:'Teaching Building 0/1',disabled:false}]);
        await recordDecision('returned-family-restaurant',p);returnedRestaurant=true;
      }
    }
    if(s.day>=4&&j.instance===1){
      if(!regularActions&&available.some(action=>action.kind==='behavior')){await recordDecision('later-date-activities',p);regularActions=true;}
      const work=available.find(action=>action.kind==='behavior'&&Object.values(source.behaviors).some(row=>row.BehaviorId===j.options.find(o=>o.id===action.id)?.sourceId&&row.SucAttrChange.some(change=>change.Key===8&&change.Value>0)));
      if(work&&!paidActivity){await recordDecision('paid-activity',p);await chooseStage(p,work);paidActivity=true;return;}
      const store=available.find(action=>action.id==='location:1010');
      if(store&&!storeVisited&&s.attributes['8']>0){await recordDecision('later-school-store-destination',p);await chooseStage(p,store);storeVisited=true;return;}
      const browse=available.find(action=>action.id==='locationOption:401');
      if(browse&&storeVisited&&!storeOption){await recordDecision('actions-at-school-store',p);await chooseStage(p,browse);storeOption=true;return;}
    }
    if(s.day===70&&j.instance===6&&j.canContinue){
      const finish=available.find(action=>action.control==='continue');
      assert.equal(finish?.text,'Finish exploring');
      await recordDecision('eligible-finish-exploring',p);await chooseStage(p,finish);explicitFinish=true;return;
    }
    if(j.instance!==1){
      const location=available.find(action=>action.kind==='location'&&!source.locations[j.options.find(o=>o.id===action.id)?.sourceId]?.IsEndLocation&&
        !visitedLocations.has(s.day+':'+s.slot+':'+action.id));
      if(location){
        const o=j.options.find(o=>o.id===location.id),row=source.locations[o.sourceId];
        if(!row.IsSeparate||(o.progress??0)+1>=(o.target??0))visitedLocations.add(s.day+':'+s.slot+':'+location.id);
        await chooseStage(p,location);return;
      }
      const extra=available.find(action=>action.kind==='locationOption'&&!visitedOptions.has(s.day+':'+s.slot+':'+action.id));
      if(extra){visitedOptions.add(s.day+':'+s.slot+':'+extra.id);await chooseStage(p,extra);return;}
    }
    const reward=available.find(action=>action.kind==='reward');
    if(reward){await chooseStage(p,reward);return;}
    const continuation=available.find(action=>action.control==='continue');
    if(continuation){await chooseStage(p,continuation);return;}
  }
  const choice=buttons.find(b=>b.test==='choice');
  if(choice){route.push({day:s.day,script:s.script,node:s.node,option:choice.option});await clickSelector(`[data-testid="choice"][data-option-id="${choice.option}"]`);return;}
  const quiz=buttons.find(b=>b.test==='quiz-answer');
  if(quiz){await clickSelector(`[data-testid="quiz-answer"][data-answer-id="${quiz.answer??''}"]`);return;}
  if(buttons.some(b=>b.test==='quiz-continue')){await click('quiz-continue');return;}
  if(buttons.some(b=>b.test==='advance')){await click('advance');return;}
  await delay(100);
}

async function verifyRemainingJourney(){
  for(let step=0;step<12000;step++){
    await remainingStep();
    const p=await probe();
    if(step%40===0){console.log(`Decisions ${step}: day${p.model.day} ${p.model.script}/${p.model.node} ${p.journey.phase}`);await writeFile(join(resultDir,'progress.json'),JSON.stringify({step,day:p.model.day,slot:p.model.slot,script:p.model.script,node:p.model.node,lastControl})+'\n');}
    if(explicitFinish&&p.model.day>70&&!p.card&&!p.journey.interaction&&p.journey.phase==='planning'){
      await recordDecision('after-explicit-exploration-finish',p);
      assert.ok(openingFinished&&laterDestinations&&returnedRestaurant&&regularActions&&storeOption&&shopSeen&&shopPurchased);
      assert.equal(p.schoolYearMounts,0);
      return;
    }
  }
  throw new Error('Normal stage controls did not complete the later exploration.');
}

try{
 await mkdir(screenshotDir,{recursive:true});
 server=createServer(async(req,res)=>{try{const p=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);if(p==='/favicon.ico'){res.writeHead(204);res.end();return;}const f=resolve(dist,'.'+(extname(p)?p:'/index.html'));if(!f.startsWith(dist+sep))throw new Error('Invalid path');res.writeHead(200,{'Content-Type':mime[extname(f)]??'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(f));}catch{res.writeHead(404);res.end('Missing fixture');}});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 browser=spawn('/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader',`--user-data-dir=${profile}`,'--remote-debugging-pipe','about:blank'],{stdio:['ignore','ignore','pipe','pipe','pipe']});
 browser.stderr.on('data',c=>{browserErrors=(browserErrors+c).slice(-2000);});
 client=new CDP(browser.stdio[3],browser.stdio[4]);const t=await client.send('Target.createTarget',{url:'about:blank'});client.sessionId=(await client.send('Target.attachToTarget',{targetId:t.targetId,flatten:true})).sessionId;
 for(const d of ['Page','Runtime','Log','Network'])await client.send(d+'.enable');
 await client.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
 await client.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?script=1001`});await client.send('Page.bringToFront');
 await until(`document.querySelector('[data-testid="start"]')&&!document.querySelector('[data-testid="start"]').disabled&&!document.querySelector('[data-testid="reader-loading"]')`,'Reader ready');
 await client.evaluate(installProbe);await click('settings');await click('instant-text');await click('settings-close');
 await capture('fresh-reader-entry');await click('start');
 for(let step=0;step<600;step++){
  await normalStep();
  const p=await probe();
  if(step%20===0){console.log(`Boundary ${mode} ${step}: ${p.model.script}/${p.model.node} ${p.model.status}`);await writeFile(join(resultDir,'progress.json'),JSON.stringify({step,script:p.model.script,node:p.model.node,lastControl})+'\n');}
  const events=await client.evaluate('window.__boundaryTrace.events');
  if(square&&pair&&events.some(e=>e.type==='completed'&&e.script==='1008')&&!p.card){finishedSquare=await capture('after-square-completion');break;}
 }
 assert.ok(abby&&chisa&&goOut&&street1&&street6&&square&&pair&&finishedSquare,'Uninterrupted route reaches both cards, street, and Central Square completion');
 let trace=await client.evaluate('({events:window.__boundaryTrace.events,handoffs:window.__boundaryTrace.handoffs,removedCanvases:window.__boundaryTrace.removedCanvases,schoolYearMounts:window.__boundaryTrace.schoolYearMounts,errors:window.__boundaryTrace.errors})');
 assert.deepEqual(trace.errors,[]);
 if(!before){
   const oldCanvas=outgoing.canvas.find(c=>c.rendered.split(',').includes('1316'));
   for(const name of ['street-node-1','street-node-6','central-square-node-5','central-square-two-characters','after-square-completion']){
     const shot=checks.find(c=>c.name===name);assert.equal(shot.canvas.some(c=>c.id===oldCanvas.id),false,`${name}: the outgoing canvas never returns`);
   }
 }
 const feeling=trace.events.filter(e=>e.type==='storyMutation').flatMap(e=>e.changes.filter(c=>c.kind==='attribute'&&Number(c.attributeId)===feelingId).map(c=>({script:e.script,node:e.node,action:e.action,value:c.value})));
 assert.deepEqual(feeling.filter(e=>e.script==='1006'&&e.action===20000207).map(e=>e.value),[1],'The authored street Feeling +1 fires exactly once');
 assert.equal(atSquare.model.attributes[feelingId],outgoing.model.attributes[feelingId]+1);
 assert.deepEqual(afterStreet.model.items,outgoing.model.items,'Scene handoff preserves actual inventory');
 for(const id of ['11','12']){
   assert.deepEqual(afterStreet.model.favor[id],outgoing.model.favor[id],'Scene handoff preserves actual friendships');
   assert.deepEqual(atSquare.model.favor[id],outgoing.model.favor[id],'Street completion and Central Square entry retain actual friendships');
   const earned=trace.events.filter(e=>e.type==='storyMutation').flatMap(e=>e.changes.filter(c=>c.kind==='favorLevel'&&String(c.roleId)===id));
   assert.equal(earned.length,1,'Opening friendship tiers are earned exactly once');
 }
 assert.deepEqual(atSquare.model.items,outgoing.model.items,'Central Square retains the outing inventory');
 if(placesMode){
   assert.equal(finishedSquare.panel,null);assert.equal(finishedSquare.journey.selectingLocation,true);
   assert.deepEqual(finishedSquare.places,[{id:'location:1016',text:'School Store 0/1',disabled:false}]);
   assert.equal(finishedSquare.model.flowReads['1008'],1);assert.equal(trace.handoffs.filter(h=>h.to.script==='1008').length,1);
   const returned=await capture('returned-places');
   placesChecks.push({name:'returned-places',script:returned.model.script,node:returned.model.node,source:returned.journey.options.filter(o=>o.kind==='location'),buttons:returned.places,centralSquareReadCount:returned.model.flowReads['1008']});
   await click('menu');await click('menu-stories');await until(`document.querySelector('dialog[open]')?.innerText.includes('School year')`,'School year remains available from Menu');
   const panel=await capture('school-year-after-return');
   const controls=await client.evaluate(`({places:[...document.querySelectorAll('dialog[open] [data-journey-option^="location:"]')].map(e=>({id:e.dataset.journeyOption,text:e.innerText.replace(/\\s+/g,' ').trim(),disabled:e.disabled})),finish:{text:document.querySelector('dialog[open] [data-testid="journey-continue"]').innerText,disabled:document.querySelector('dialog[open] [data-testid="journey-continue"]').disabled}})`);
   assert.deepEqual(controls.places,returned.places);assert.equal(controls.finish.text,'Finish exploring');assert.equal(controls.finish.disabled,!panel.journey.canContinue);
   assert.deepEqual(panel.places,[],'Places stage controls are hidden behind the native panel');placesChecks.push({name:'school-year-menu',...controls});
   await click('stories-close');assert.deepEqual((await probe()).places,returned.places);
 }
 if(decisionsMode){
   await verifyRemainingJourney();
   trace=await client.evaluate('({events:window.__boundaryTrace.events,handoffs:window.__boundaryTrace.handoffs,removedCanvases:window.__boundaryTrace.removedCanvases,schoolYearMounts:window.__boundaryTrace.schoolYearMounts,errors:window.__boundaryTrace.errors})');
   assert.equal(trace.schoolYearMounts.length,0,'All progression through both outings, destination actions and explicit Finish used the stage.');
   assert.deepEqual(trace.errors,[]);
   const stage=await probe();
   await click('menu');await click('menu-stories');await until(`!!document.querySelector('[data-testid="journey-panel"]')`,'School year remains accessible for review');
   const review=await capture('school-year-review');
   assert.ok(review.panel.includes('Friendships')&&review.panel.includes('Inventory')&&review.panel.includes('Requests')&&review.panel.includes('Journeys'));
   const panelActions=await client.evaluate(`[...document.querySelectorAll('dialog[open] [data-journey-option]')].map(e=>({id:e.dataset.journeyOption,disabled:e.disabled})).sort((a,b)=>a.id.localeCompare(b.id))`);
   assert.deepEqual(panelActions,stage.actions.filter(action=>action.id).map(action=>({id:action.id,disabled:action.disabled})).sort((a,b)=>a.id.localeCompare(b.id)),'The review panel uses the same live actions and eligibility.');
   assert.deepEqual(review.actions,[],'Native panels hide stage action controls.');
   decisionChecks.push({name:'school-year-review-after-route',day:review.model.day,script:review.model.script,node:review.model.node,actions:panelActions,progressionSchoolYearOpens:trace.schoolYearMounts.length});
   await click('stories-close');
 }
 const beforeHistory=await probe();await click('history');await click('history-close');const afterHistory=await probe();
 assert.deepEqual(afterHistory.model.attributes,beforeHistory.model.attributes);assert.deepEqual(afterHistory.model.favor,beforeHistory.model.favor);assert.deepEqual(afterHistory.model.items,beforeHistory.model.items);
 if(checkpointSaved){await checkpoint('restore');await delay(400);const restored=await capture('existing-tiers-checkpoint-restored');assert.equal(restored.card,null);assert.equal(restored.model.favor['12'].level,1);assert.equal(restored.model.favor['11'].level,1);}
 await writeFile(join(resultDir,'trace.json'),JSON.stringify(trace,null,2)+'\n');
 await writeFile(join(resultDir,'result.json'),JSON.stringify({passed:errors.length===0,mode,entry:'/?script=1001',controls:'public Reader mouse controls; passive runner/renderer inspection only',decisionChecks,decisionDispatches,placesChecks,confirmationChecks,outgoing,afterStreet,atSquare,finishedSquare,feeling,checks,route,screenshots,errors},null,2)+'\n');
}catch(e){errors.push(String(e));console.log('Boundary failed: '+e);if(client)try{await screenshot('failure');await writeFile(join(resultDir,'failure-state.json'),JSON.stringify(await probe(),null,2)+'\n');await writeFile(join(resultDir,'trace.json'),JSON.stringify(await client.evaluate('({events:window.__boundaryTrace?.events,handoffs:window.__boundaryTrace?.handoffs})'),null,2)+'\n');}catch{}}
finally{
 if(client)try{await client.send('Browser.close');}catch{}
 if(browser&&browser.exitCode===null){browser.kill('SIGTERM');await Promise.race([new Promise(done=>browser.once('exit',done)),delay(1000)]);if(browser.exitCode===null)browser.kill('SIGKILL');}
 if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}
 await rm(profile,{recursive:true,force:true,maxRetries:6,retryDelay:100}).catch(e=>errors.push(String(e)));
 if(errors.length)await writeFile(join(resultDir,'result.json'),JSON.stringify({passed:false,mode,decisionChecks,decisionDispatches,placesChecks,confirmationChecks,outgoing,afterStreet,atSquare,finishedSquare,checks,route,screenshots,errors,lastScene,lastControl,browserErrors},null,2)+'\n');
 console.log(`${errors.length?'FAIL':'PASS'} boundary ${mode}: ${checks.length} captures, ${route.length} route choices. ${resultDir}/result.json`);if(errors.length)process.exitCode=1;
}
