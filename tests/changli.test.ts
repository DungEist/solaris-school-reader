import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { initialStageState, reduceStageEvent } from '../src/engine/StageState.ts';
import { StageTransitions, staticStagePresentation } from '../src/engine/StageTransitions.ts';
import type { StageEvent, StageOp } from '../src/engine/types.ts';
import { changliAssetUrls, ChangliAssetCache, composeChangliExpression, readChangliExpressions, resolveChangli } from '../src/spine/ChangliAssets.ts';
import { changliCalibration, changliTransform } from '../src/spine/ChangliCalibration.ts';
import { ChangliSpineActor } from '../src/spine/ChangliSpineScene.ts';
import { ChangliStageAdapter } from '../src/spine/ChangliStageAdapter.ts';
import type { ChangliRendererStatuses } from '../src/spine/ChangliStageAdapter.ts';
import { FakeClock } from './FakeClock.ts';
import { changliAssets, changliMetadata, changliResources, changliSkeletonData, deferred, finishLoads, TestChangliScene } from './changli-fixtures.ts';

function rig(load = () => Promise.resolve(changliResources)) {
  const clock = new FakeClock(), transitions = new StageTransitions(), scenes: TestChangliScene[] = [];
  let state = initialStageState(1), sequence = 0, statuses: ChangliRendererStatuses = {}, loadCalls = 0;
  const notifications: ChangliRendererStatuses[] = [];
  const adapter = new ChangliStageAdapter({} as HTMLCanvasElement, {
    load: () => { loadCalls++; return load(); },
    createScene: () => { const scene = new TestChangliScene(); scenes.push(scene); return scene; },
    requestFrame: callback => clock.setTimeout(() => callback(clock.now()), 16), cancelFrame: id => clock.clearTimeout(id),
    onStatus: value => { statuses = value; notifications.push(value); },
  });
  const sync = () => adapter.sync(state, transitions.project(state, clock.now()).characters, changliAssets);
  const apply = (operation: StageOp) => {
    const event: StageEvent = { type: 'stage', scriptId: 'fixture', flowActionIndex: 1, nid: 1, runId: state.runId, sequence: ++sequence, source: 'node', visitId: 1, phase: operation.phase ?? 'start', operation, disposition: 'state' };
    const previous = state;
    state = reduceStageEvent(state, event); transitions.apply(previous, state, event, false, clock.now()); sync();
  };
  return {
    adapter, clock, scenes, notifications, sync, apply,
    get state() { return state; }, get statuses() { return statuses; }, get loadCalls() { return loadCalls; },
    reset(runId: number) { state = initialStageState(runId); transitions.reset(); sync(); },
    advance(ms: number) { clock.advanceBy(ms); sync(); },
  };
}
const enter = (expr = 700048): StageOp => ({ op: 'enter', who: '999', expr, t: 0 });

test('Changli identity joins persistent who → expression → manifest talker; numeric who never identifies a talker', () => {
  const current = rig(); current.apply(enter());
  const resolution = resolveChangli(current.state.characters['999'], changliAssets);
  assert.equal(resolution.kind, 'changli');
  assert.equal(changliAssets.manifest.expressions['700048'].talkerId, 850006);
  assert.equal(changliAssets.manifest.talkers?.['850006'].defaultExpressionId, 700048);
  const other = Object.entries(changliAssets.manifest.expressions).find(([, expression]) => expression.talkerId !== 850006 && expression.talkerId !== null)!;
  current.apply({ op: 'enter', who: '850006', expr: Number(other[0]), t: 0 });
  assert.equal(resolveChangli(current.state.characters['850006'], changliAssets).kind, 'other');
  const wrongSpeaker = { ...current.state.characters['999'], who: 'another-stage-slot' };
  assert.equal(resolveChangli(wrongSpeaker, changliAssets).kind, 'changli');
  current.adapter.dispose();
});

test('manifest tracks match local expression rows and missing/conflicting expressions produce explicit failures', () => {
  for (const [id, expression] of Object.entries(changliAssets.manifest.expressions)) {
    if (expression.talkerId !== 850006) continue;
    const mapped = composeChangliExpression({ id: Number(id), body: expression.body!, mouth: expression.mouth!, eye: expression.eye! }, changliResources.expressions);
    assert.equal(mapped.id, Number(id));
  }
  const expression = changliResources.expressions.get(700048)!;
  assert.throws(() => composeChangliExpression({ ...expression, id: 999999 }, changliResources.expressions), /no local composition/);
  assert.throws(() => composeChangliExpression({ ...expression, mouth: 'unrelated-mouth' }, changliResources.expressions), /conflicts/);
  assert.equal(changliResources.expressions.get(700051)!.blink, null, 'Closed eyes remain a static pose.');
  const bad = structuredClone(changliMetadata); bad.dataset_animation_rows[0].AvgTalkerId = 850001;
  assert.throws(() => readChangliExpressions(bad), /Malformed/);
  const blink = structuredClone(changliMetadata); blink.dataset_animation_rows[0].BlinkAnimation = 'invented-blink';
  assert.throws(() => readChangliExpressions(blink), /Unverified/);
});

test('local asset loads share pending and completed resources across stage instances, with derived texture provenance', async () => {
  let reads = 0; const pending = deferred<typeof changliResources>();
  const cache = new ChangliAssetCache(() => { reads++; return pending.promise; });
  const first = cache.load('/assets/solarschool');
  assert.equal(cache.load('/assets/solarschool/'), first);
  pending.resolve(changliResources); assert.equal(await first, changliResources);
  assert.equal(cache.load('/assets/solarschool'), first); assert.equal(reads, 1);
  assert.ok(Object.values(changliAssetUrls('./assets/solarschool/')).every(url => url.startsWith('./assets/solarschool/characters/changli/')));
  const provenance = JSON.parse(readFileSync(new URL('../public/assets/solarschool/characters/changli/provenance.json', import.meta.url), 'utf8'));
  assert.match(provenance.texture.origin, /Decoded earlier.*not a game texture export/);
  assert.equal(provenance.runtime.version, '4.1.56');
});

test('loaded skeleton stays stable through rerenders, fades, moves, dimming and hide/show without replaying expression tracks', async () => {
  const current = rig(); current.apply({ ...enter(), fadeIn: 1 }); await finishLoads();
  const scene = current.scenes[0], actor = scene.actors[0];
  current.advance(500);
  assert.equal(actor.frames.at(-1)!.view.portraitOpacity, .5);
  for (let i = 0; i < 10; i++) current.sync();
  assert.equal(scene.actors.length, 1); assert.equal(actor.expressions.length, 1); assert.equal(current.loadCalls, 1);
  current.advance(500);
  current.apply({ op: 'move', who: '999', pos: [800, -60, 1.1], dur: 1, t: 0 });
  current.advance(500);
  assert.deepEqual(actor.frames.at(-1)!.view.position, [400, -30, 1.05]);
  current.apply({ op: 'modify', who: '999', effect: 'Darken', t: 0 });
  assert.equal(actor.frames.at(-1)!.view.portraitOpacity, 1);
  assert.equal(actor.frames.at(-1)!.view.brightness, 1);
  current.advance(100); assert.equal(actor.frames.at(-1)!.view.brightness, .79);
  current.advance(100);
  assert.equal(actor.frames.at(-1)!.view.brightness, .58);
  assert.equal(actor.frames.at(-1)!.view.portraitOpacity, 1);
  assert.ok(actor.frames.at(-1)!.view.position[0] > 400 && actor.frames.at(-1)!.view.position[0] < 800, 'Dimming leaves movement running.');
  assert.equal(actor.expressions.length, 1);
  current.apply({ op: 'modify', who: '999', expr: 700050, effect: 'Highlight', t: 0 });
  assert.equal(scene.actors[0], actor); assert.deepEqual(actor.expressions.map(value => value.id), [700048, 700050]);
  current.apply({ op: 'modify', who: '999', hidePortrait: true, fadeOut: .5, t: 0 });
  current.advance(500);
  assert.equal(actor.disposed, 0); assert.equal(scene.frames.at(-1)!.length, 0); assert.equal(current.clock.pendingTimers, 0);
  current.apply({ op: 'modify', who: '999', hidePortrait: false, t: 0 });
  assert.equal(scene.actors.length, 1); assert.equal(actor.expressions.length, 2);
  current.adapter.dispose(); assert.equal(actor.disposed, 1); assert.equal(scene.disposed, 1);
});

test('expression changes during loading apply only the latest expression; hidden pending portraits never materialize', async () => {
  const pending = deferred<typeof changliResources>(), current = rig(() => pending.promise);
  current.apply(enter()); current.apply({ op: 'modify', who: '999', expr: 700050, t: 0 }); current.apply({ op: 'modify', who: '999', expr: 700051, t: 0 });
  pending.resolve(changliResources); await finishLoads();
  assert.deepEqual(current.scenes[0].actors[0].expressions.map(value => value.id), [700051]);
  assert.equal(current.scenes[0].actors[0].expressions[0].blink, null); current.adapter.dispose();
  const hidden = deferred<typeof changliResources>(), hiding = rig(() => hidden.promise);
  hiding.apply(enter()); hiding.apply({ op: 'modify', who: '999', hidePortrait: true, fadeOut: 1, t: 0 });
  hidden.resolve(changliResources); await finishLoads();
  assert.equal(hiding.scenes.length, 0); assert.equal(hiding.statuses['999'].kind, 'hidden'); hiding.adapter.dispose();
});

test('exit fades retain an existing actor only until opacity reaches zero, and a late exit load cannot resurrect it', async () => {
  const current = rig(); current.apply(enter()); await finishLoads();
  const actor = current.scenes[0].actors[0];
  current.apply({ op: 'exit', who: '999', fadeOut: .5, t: 0 });
  current.advance(250);
  assert.equal(actor.disposed, 0); assert.equal(actor.frames.at(-1)!.view.character.present, false); assert.equal(actor.frames.at(-1)!.view.portraitOpacity, .5);
  current.advance(250); assert.equal(actor.disposed, 1); assert.equal(current.clock.pendingTimers, 0); assert.deepEqual(current.statuses, {}); current.adapter.dispose();
  const pending = deferred<typeof changliResources>(), late = rig(() => pending.promise);
  late.apply(enter()); late.apply({ op: 'exit', who: '999', fadeOut: 1, t: 0 });
  pending.resolve(changliResources); await finishLoads();
  assert.equal(late.scenes.length, 0); late.advance(1000); assert.deepEqual(late.statuses, {}); late.adapter.dispose();
});

test('restart, script switch, re-entry and unmount invalidate old actor and frame/loading callbacks', async () => {
  const current = rig(); current.apply(enter()); await finishLoads();
  const actor = current.scenes[0].actors[0], staleFrames = [...current.clock.callbacks];
  const firstEntry = current.state.characters['999'].entrySequence;
  current.apply({ op: 'exit', who: '999', t: 0 }); current.apply(enter(700050));
  assert.notEqual(current.state.characters['999'].entrySequence, firstEntry); assert.equal(actor.disposed, 1);
  current.reset(2); current.apply(enter());
  const frameCount = current.scenes[0].frames.length;
  staleFrames.forEach(callback => callback()); assert.equal(current.scenes[0].frames.length, frameCount);
  current.reset(3); assert.equal(current.scenes[0].frames.at(-1)!.length, 0); current.adapter.dispose(); assert.equal(current.clock.pendingTimers, 0);
  for (const action of ['restart', 'switch', 'unmount'] as const) {
    const pending = deferred<typeof changliResources>(), late = rig(() => pending.promise);
    late.apply(enter());
    if (action === 'unmount') late.adapter.dispose(); else late.reset(action === 'restart' ? 2 : 3);
    const notifications = late.notifications.length;
    pending.resolve(changliResources); await finishLoads();
    assert.equal(late.scenes.length, 0); assert.equal(late.notifications.length, notifications); late.adapter.dispose();
  }
});

test('entry identity survives intervening modifies in a batched exit/re-enter snapshot', async () => {
  const current = rig(); current.apply(enter()); await finishLoads();
  const previous = current.scenes[0].actors[0];
  let state = current.state;
  for (const [index, operation] of [
    { op: 'exit', who: '999', t: 0 }, enter(), { op: 'modify', who: '999', expr: 700050, t: 0 },
  ].entries()) state = reduceStageEvent(state, { ...state.characters['999'].lastEvent, sequence: 100 + index, operation });
  current.adapter.sync(state, staticStagePresentation(state).characters, changliAssets);
  assert.equal(previous.disposed, 1); assert.equal(current.scenes[0].actors.length, 2); assert.equal(current.scenes[0].actors[1].expressions[0].id, 700050);
  current.adapter.dispose();
});

test('asset, expression and GPU failures are visible fallbacks without retries on every snapshot', async () => {
  const current = rig(() => Promise.reject(new Error('HTTP 404 local PNG'))); current.apply(enter()); await finishLoads();
  assert.equal(current.statuses['999'].kind, 'fallback'); assert.match(current.statuses['999'].reason!, /HTTP 404/);
  for (let i = 0; i < 5; i++) current.sync(); assert.equal(current.loadCalls, 1); current.adapter.dispose();
  const bad = rig(() => { throw new Error('missing runtime'); }); assert.doesNotThrow(() => bad.apply(enter())); assert.equal(bad.statuses['999'].kind, 'fallback'); bad.adapter.dispose();
  const expression = rig(); expression.apply(enter()); await finishLoads();
  expression.apply({ op: 'modify', who: '999', expr: 999999, t: 0 });
  assert.equal(expression.statuses['999'].kind, 'fallback'); assert.match(expression.statuses['999'].reason!, /missing/); assert.equal(expression.scenes[0].actors[0].disposed, 1); expression.adapter.dispose();
  const gpu = rig(); gpu.apply(enter()); await finishLoads(); gpu.scenes[0].failRender = true;
  assert.doesNotThrow(() => gpu.sync()); assert.equal(gpu.statuses['999'].kind, 'fallback'); assert.match(gpu.statuses['999'].reason!, /rendering failed/); gpu.adapter.dispose();
});

test('one provisional coordinate calibration applies to all expressions and preserves stage movement/scale', () => {
  const base = changliTransform([0, 0, 1]), moved = changliTransform([400, -60, 1]);
  assert.equal(changliCalibration.provisional, true); assert.equal(moved.x - base.x, 400); assert.ok(Math.abs(moved.y - base.y + 60) < 1e-9);
  assert.ok(Math.abs(changliTransform([0, 0, 1.1]).scale / base.scale - 1.1) < 1e-12);
});

test('actual local Spine actor composes static tracks, moves verified blink geometry, avoids restarts and clears obsolete blink tracks', () => {
  const actor = new ChangliSpineActor(changliResources.runtime, changliSkeletonData, { drawSkeleton: () => {} }, { intervalSeconds: [3, 3] });
  const current = rig(); current.apply(enter()); const view = staticStagePresentation(current.state).characters[0]; current.adapter.dispose();
  const expression = changliResources.expressions.get(700048)!;
  actor.setExpression(expression);
  assert.deepEqual([0, 1, 2].map(index => actor.animationState.getCurrent(index)?.animation.name), [expression.body, expression.mouth, expression.eye]);
  assert.equal(actor.animationState.getCurrent(3), null);
  actor.render(view, 3);
  assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.blink);
  const geometry = () => JSON.stringify((actor.skeleton as any).slots.map((slot: any) => [slot.attachment?.name, [...slot.deform]]));
  const frames = new Set<string>();
  for (let i = 0; i < 8; i++) { actor.render(view, .07); frames.add(geometry()); }
  assert.ok(frames.size > 1, 'Blink deforms/attachments must actually change, not just advance a clock.');
  const time = actor.animationState.getCurrent(2)!.trackTime; actor.setExpression({ ...expression }); assert.equal(actor.animationState.getCurrent(2)!.trackTime, time);
  actor.render({ ...view, position: [400, -60, 1.1], portraitOpacity: .58 }, 0);
  assert.equal(actor.skeleton.color.a, .58); assert.equal(actor.skeleton.x, changliTransform([400, -60, 1.1]).x);
  actor.setExpression(changliResources.expressions.get(700051)!); assert.equal(actor.animationState.getCurrent(3), null);
  const staticPose = geometry(); actor.render(view, 1); assert.equal(geometry(), staticPose);
  const fresh = new ChangliSpineActor(changliResources.runtime, changliSkeletonData, { drawSkeleton: () => {} });
  fresh.setExpression(changliResources.expressions.get(700051)!);
  assert.equal(JSON.stringify((fresh.skeleton as any).slots.map((slot: any) => [slot.attachment?.name, [...slot.deform]])), staticPose, 'Switching expressions clears old attachments and blink deformation.');
  fresh.dispose();
  assert.throws(() => actor.setExpression({ ...expression, body: 'missing-body' }), /clip missing-body is missing/);
  actor.dispose(); assert.equal(actor.animationState.getCurrent(0), null);
});
