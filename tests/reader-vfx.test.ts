import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import { StageEffects, portraitEffectDistance, readerEffectLifetimes } from '../src/engine/StageEffects.ts';
import { initialStageState, reduceStageEvent } from '../src/engine/StageState.ts';
import { validateManifest } from '../src/engine/validation.ts';
import { loadReaderVfxAssets, readerVfxImage, validateReaderVfxManifest } from '../src/assets/ReaderVfxAssets.ts';
import type { ReaderVfxAsset } from '../src/assets/ReaderVfxAssets.ts';
import type { StageEvent, StageOp } from '../src/engine/types.ts';
import { FakeClock } from './FakeClock.ts';
import { fixture, manifest, node, option } from './fixtures.ts';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const sourceManifest = validateManifest(read('../public/data/manifest.json'));
const speakers = read('../public/data/speakers.json');
const path = (name: string, persistent = false) => `/Game/Reader/Effects/${name}.${name}`;
const screen = (name: string, t = 0, persistent = false): StageOp => ({ op: 'screenFx', t, fxType: persistent ? 'Persistent' : 'OneShot', fx: name, path: path(name, persistent) });
const stop = (name: string, t = 0): StageOp => ({ ...screen(name, t, true), op: 'stopScreenFx' });
function start(nodes: Parameters<typeof fixture>[0], instantTransitions = false) {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock, instantTransitions });
  assert.equal(runner.load(fixture(nodes), manifest), true); runner.start();
  return { runner, clock };
}
function real(id: string) {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock });
  assert.equal(runner.load(read(`../public/data/scripts/${id}.json`), sourceManifest, { speakers }), true); runner.start();
  const to = (nid: number) => {
    for (let count = 0; count < 300; count++) {
      if (runner.getSnapshot().nid === nid) return;
      clock.advanceBy(3000);
      const state = runner.getSnapshot();
      if (state.status === 'choices') assert.equal(runner.overrideChoice(0), true);
      else if (state.status === 'dialogue') assert.equal(runner.advance(), true);
      else assert.fail(`Could not reach ${id}/${nid}: ${state.status} at ${state.nid}`);
    }
    assert.fail(`Did not reach ${id}/${nid}`);
  };
  return { runner, clock, to };
}

test('1006/15 starts Butterfly immediately, then distinct Huaban at exactly +200ms', () => {
  const { runner, clock, to } = real('1006');
  try {
    to(15);
    const first = runner.getSnapshot().effects.active;
    assert.deepEqual(first.map(effect => effect.name), ['UiItem_FxStart_Butterfly']);
    const firstId = first[0].id;
    clock.advanceBy(199); assert.equal(runner.getSnapshot().effects.active.length, 1);
    clock.advanceBy(1);
    const both = runner.getSnapshot().effects.active;
    assert.deepEqual(both.map(effect => effect.name), ['UiItem_FxStart_Butterfly', 'UiItem_FxStart_Huaban']);
    assert.equal(both[0].id, firstId); assert.equal(both[1].startedAtMs - both[0].startedAtMs, 200);
    assert.notEqual(both[0].path, both[1].path);
    assert.ok(both.every(effect => effect.event.operation.raw && effect.event.operation.effectConfig));
    clock.advanceBy(readerEffectLifetimes.oneShot + 300);
    assert.equal(runner.getSnapshot().effects.active.length, 0);
    assert.equal(runner.getSnapshot().nid, 15, 'effect completion does not advance dialogue');
  } finally { runner.dispose(); assert.equal(clock.pendingTimers, 0); }
});

test('1002/6 Custom Shake moves the screen while preserving portrait positions and CG state', () => {
  const { runner, clock, to } = real('1002');
  try {
    to(6);
    const before = runner.getSnapshot();
    clock.advanceBy(112);
    const during = runner.getSnapshot();
    assert.ok(during.effects.screenOffset.some(value => Math.abs(value) > .01));
    assert.deepEqual(during.presentation.characters.map(view => view.position), before.presentation.characters.map(view => view.position));
    assert.equal(during.stageState.cg, before.stageState.cg);
    const shake = during.effects.active.find(effect => effect.customType === 'Shake')!;
    assert.equal(shake.target, 'screen'); assert.deepEqual(shake.event.operation.effectConfig, { Type: 'Custom', CustomType: 'Shake' });
    clock.advanceBy(700); assert.deepEqual(runner.getSnapshot().effects.screenOffset, [0, 0]);
  } finally { runner.dispose(); }
});

test('1001/10 portrait Shake waits +300ms, moves only Abby, and leaves author state/alpha intact', () => {
  const { runner, clock, to } = real('1001');
  try {
    to(10);
    const entered = runner.getSnapshot(), startMs = clock.now();
    const pending = entered.pendingStage.find(task => task.operation.op === 'portraitFx' && task.operation.who === '1316')!;
    const move = entered.stageEvents.find(event => event.nid === 10 && event.operation.op === 'move' && event.operation.who === '1316')!;
    assert.equal(pending.phase, 'start'); assert.equal(pending.operation.t, .3);
    assert.equal(pending.phaseStartedAtMs, startMs);
    assert.equal(move.timing?.phaseStartedAtMs, startMs);
    assert.equal(move.timing?.dueAtMs, startMs, 'The move and Shake share the node start-performance clock.');
    assert.equal(pending.dueAtMs, startMs + 300);
    clock.advanceBy(299);
    const before = runner.getSnapshot();
    assert.equal(before.effects.active.some(effect => effect.target === 'portrait'), false);
    assert.ok(before.presentation.characters.find(view => view.character.who === '1316')!.position[1] < 0, 'Abby is still arriving before the 300 ms boundary.');
    clock.advanceBy(1);
    const delivered = runner.getSnapshot(), shake = delivered.effects.active.find(effect => effect.target === 'portrait')!;
    const sourcePosition = delivered.stageState.characters['1316'].position;
    assert.equal(shake.startedAtMs, startMs + 300);
    assert.equal(shake.event.timing?.appliedAtMs, startMs + 300);
    assert.deepEqual(delivered.presentation.characters.find(view => view.character.who === '1316')!.position, sourcePosition, 'The move finishes when Shake starts, before its first nonzero displacement.');
    clock.advanceBy(112); const during = runner.getSnapshot();
    const abby = during.presentation.characters.find(view => view.character.who === '1316')!;
    assert.notDeepEqual(abby.position, sourcePosition);
    assert.equal(abby.portraitOpacity, 1); assert.equal(abby.character.expression, 700212);
    assert.deepEqual(during.effects.screenOffset, [0, 0]);
    assert.deepEqual(during.stageState.characters['1316'].position, sourcePosition);
    for (const view of during.presentation.characters.filter(view => view.character.who !== '1316')) assert.deepEqual(view.position, view.character.position);
    clock.advanceBy(500); assert.deepEqual(runner.getSnapshot().presentation.characters.find(view => view.character.who === '1316')!.position, sourcePosition);
  } finally { runner.dispose(); }
});

test('11007/103–108 SunGlow survives dialogue and stable restore, then clears on its authored stop', () => {
  const { runner, clock, to } = real('11007');
  try {
    to(103); const sun = runner.getSnapshot().effects.active.find(effect => effect.name === 'UiItem_FxLoop_SunGlow')!;
    assert.ok(sun); clock.advanceBy(400); const saved = runner.createCheckpoint(); assert.ok(saved);
    for (const nid of [104, 105, 106, 107]) {
      to(nid); assert.equal(runner.getSnapshot().effects.active.find(effect => effect.name === sun.name)!.id, sun.id);
    }
    to(108); assert.equal(runner.getSnapshot().effects.active.some(effect => effect.name === sun.name), false);
    assert.equal(runner.restoreCheckpoint(saved), true);
    const restored = runner.getSnapshot().effects.active.find(effect => effect.name === sun.name)!;
    assert.equal(restored.id, sun.id); assert.equal(restored.elapsedMs, saved.snapshot.effects.active.find(effect => effect.id === sun.id)!.elapsedMs);
    assert.equal(runner.getSnapshot().stageEvents.length, 0, 'restore redelivers no authored starts or audio');
    to(108); assert.equal(runner.getSnapshot().effects.active.some(effect => effect.name === sun.name), false);
  } finally { runner.dispose(); }
});

test('advance consumes pending bursts, persistent starts and matching stops retain source order', () => {
  const { runner, clock } = start([
    node(1, { stage: [screen('Burst', .5), screen('Sun', .6, true), stop('Sun', .7), screen('Petals', .8, true)] }), node(2),
  ]);
  try {
    runner.advance();
    assert.deepEqual(runner.getSnapshot().effects.active.map(effect => effect.name), ['Petals']);
    assert.ok(runner.getSnapshot().stageEvents.every(event => event.timing?.delivery === 'advance'));
    clock.advanceBy(2000); assert.deepEqual(runner.getSnapshot().effects.active.map(effect => effect.name), ['Petals']);
    assert.equal(runner.getSnapshot().stageEvents.length, 4);
  } finally { runner.dispose(); }
});

test('instant fast-forward clears an active burst and settles persistence without changing audio policy or Spine movement', () => {
  const { runner, clock } = start([node(1, { stage: [
    { op: 'enter', t: 0, who: 'left', expr: 1 }, screen('Burst'), screen('Sun', .3, true),
    { op: 'move', t: .4, who: 'left', pos: [120, 40, 1.2], dur: 1 },
    { op: 'audio', t: .5, cue: 'skip_sfx', skipOnUltraFastForward: true },
    { op: 'audio', t: .6, cue: 'stop_sfx', skipOnUltraFastForward: true },
  ] })]);
  try {
    assert.equal(runner.getSnapshot().effects.active.length, 1);
    runner.setInstantTransitions(true);
    assert.deepEqual(runner.getSnapshot().effects.active.map(effect => effect.name), ['Sun']);
    assert.deepEqual(runner.getSnapshot().presentation.characters[0].position, [120, 40, 1.2]);
    assert.equal(runner.getSnapshot().presentation.characters[0].character.expression, 1);
    assert.deepEqual(runner.getSnapshot().audioHistory, ['stop_sfx']);
    runner.setInstantTransitions(false); clock.advanceBy(3000);
    assert.deepEqual(runner.getSnapshot().effects.active.map(effect => effect.name), ['Sun']);
  } finally { runner.dispose(); }
});

test('checkpoints never restart completed or in-flight bursts, while persistent elapsed time is restored', () => {
  const { runner, clock } = start([node(1, { stage: [screen('Sun', 0, true), screen('Burst')] }), node(2)]);
  try {
    const early = runner.createCheckpoint(); assert.ok(early);
    clock.advanceBy(3000); const saved = runner.createCheckpoint(); assert.ok(saved);
    runner.advance(); clock.advanceBy(1000);
    runner.restoreCheckpoint(saved);
    assert.deepEqual(runner.getSnapshot().effects.active.map(effect => effect.name), ['Sun']);
    assert.equal(runner.getSnapshot().effects.active[0].elapsedMs, saved.snapshot.effects.active[0].elapsedMs);
    runner.restoreCheckpoint(early); assert.deepEqual(runner.getSnapshot().effects.active.map(effect => effect.name), ['Sun']);
  } finally { runner.dispose(); }
});

test('late timers sample original deadlines and stale callbacks cannot leak into a new scene', () => {
  const { runner, clock } = start([node(1, { stage: [{ op: 'screenFx', fxType: 'Custom', customType: 'Shake', fx: 'Shake', t: .1 }] })]);
  try {
    const stale = [...clock.callbacks]; clock.elapseWithoutCallbacks(2000); stale[0]();
    assert.equal(runner.getSnapshot().effects.active.length, 0);
    assert.equal(runner.getSnapshot().stageEvents[0].timing!.dueAtMs, 100);
    runner.load(fixture([node(2)]), manifest, { continuation: true, preserveStoryState: true }); runner.start();
    for (const callback of stale) callback();
    assert.equal(runner.getSnapshot().nid, 2); assert.equal(runner.getSnapshot().effects.active.length, 0);
  } finally { runner.dispose(); }
});

test('normal option performances use the same timed path and do not replay on the following line', () => {
  const { runner, clock } = start([node(1, { options: [option({ performances: [screen('Burst', .2), screen('Sun', .3, true)] })] }), node(2)]);
  try {
    assert.equal(runner.choose(0), true); clock.advanceBy(200);
    assert.equal(runner.getSnapshot().effects.active[0].event.source, 'option');
    clock.advanceBy(100); assert.equal(runner.getSnapshot().nid, 2);
    assert.deepEqual(runner.getSnapshot().effects.active.map(effect => effect.name), ['Sun']);
  } finally { runner.dispose(); }
});

test('stage handoff, exploration exit and disposal clear persistent effects and actors without resetting story', () => {
  const { runner, clock } = start([node(1, { speakerId: 'left', stage: [
    { op: 'enter', who: 'left', t: 0, effect: 'Darken', fadeIn: 1 }, screen('Sun', 0, true),
  ] })]);
  try {
    clock.advanceBy(2000); const before = runner.getSnapshot();
    runner.endStagePlayback();
    assert.equal(runner.getSnapshot().effects.active.length, 0);
    assert.equal(runner.getSnapshot().storyState, before.storyState);
    assert.deepEqual(runner.getSnapshot().presentation.characters, []);
    assert.deepEqual(runner.getSnapshot().stageState.characters, {});
    assert.notEqual(runner.getSnapshot().sceneId, before.sceneId);
    runner.load(fixture([node(2)]), manifest, { continuation: true, preserveStoryState: true }); runner.start();
    assert.equal(runner.getSnapshot().effects.active.length, 0); assert.deepEqual(runner.getSnapshot().presentation.characters, []);
  } finally { runner.dispose(); assert.equal(clock.pendingTimers, 0); }
});

test('an exact stop leaves other assets with the same basename active; duplicate consumed cues stay consumed', () => {
  const effects = new StageEffects(); let state = initialStageState(1), sequence = 0;
  const apply = (operation: StageOp): StageEvent => {
    const event: StageEvent = { type: 'stage', runId: 1, sequence: ++sequence, scriptId: 'fixture', flowActionIndex: 1, nid: 1, source: 'node', visitId: 1, phase: 'start', disposition: 'state', operation };
    state = reduceStageEvent(state, event); effects.apply(event, state, 0); return event;
  };
  apply(screen('Sun', 0, true)); apply({ ...screen('Sun', 0, true), path: '/Game/Other/Sun.Sun' }); apply(stop('Sun'));
  assert.deepEqual(effects.snapshot(0).active.map(effect => effect.path), ['/Game/Other/Sun.Sun']);
  const burst = apply(screen('Burst')); effects.snapshot(3000); effects.apply(burst, state, 3000);
  assert.equal(effects.snapshot(3000).active.some(effect => effect.name === 'Burst'), false);
});

test('portrait Jump/Sigh use original distances and two 80ms phases independent of brightness', () => {
  assert.equal(portraitEffectDistance({ op: 'portraitFx', t: 0, amp: 'Small' }), 12);
  assert.equal(portraitEffectDistance({ op: 'portraitFx', t: 0, amp: 'Medium' }), 24);
  assert.equal(portraitEffectDistance({ op: 'portraitFx', t: 0, amp: 'Large' }), 36);
  for (const [name, target] of [['Jump', 24], ['Sigh', -24]] as const) {
    const { runner, clock } = start([node(1, { speakerId: 'left', stage: [
      { op: 'enter', who: 'left', t: 0, effect: 'Darken' }, { op: 'portraitFx', who: 'left', t: 0, fx: name, amp: 'Medium' },
    ] })]);
    try {
      clock.advanceBy(80); assert.equal(runner.getSnapshot().presentation.characters[0].position[1], target);
      assert.equal(runner.getSnapshot().presentation.characters[0].brightness, .58); assert.equal(runner.getSnapshot().presentation.characters[0].portraitOpacity, 1);
      clock.advanceBy(96); assert.deepEqual(runner.getSnapshot().presentation.characters[0].position, [0, 0, 1]);
    } finally { runner.dispose(); }
  }
});

test('unverified assets and custom behavior stay explicit, raw parameters remain unchanged', () => {
  const config = { Type: 'Custom', CustomType: 'Unresolved', Parameters: { axis: 'X', samples: [1, 0, -1] } };
  const { runner } = start([node(1, { stage: [{ op: 'screenFx', t: 0, fxType: 'Custom', customType: 'Unresolved', effectConfig: config }, screen('Missing')] })]);
  try {
    const snapshot = runner.getSnapshot();
    assert.ok(snapshot.effects.issues.some(issue => issue.code === 'vfx-behavior-unverified'));
    assert.ok(snapshot.effects.issues.some(issue => issue.code === 'vfx-asset-unverified'));
    assert.equal(snapshot.effects.active.some(effect => effect.name === 'Unresolved'), false);
    assert.deepEqual(snapshot.stageEvents[0].operation.effectConfig, config);
  } finally { runner.dispose(); }
});

test('VFX assets require exact source identities and validated dimensions; non-sprite data stays out of playback', () => {
  const ref = path('Sun');
  const texture = { url: 'assets/reader-vfx/sun.png', sourceRef: '/Game/Textures/Sun.Sun', width: 128, height: 128, sha256: 'a'.repeat(64), role: 'mask' };
  const raw = { schema: 1, effects: { [ref]: { name: 'Sun', sourceRef: ref, fxType: 'Persistent', status: 'resolved', sourceVerified: true, behaviorVerified: false, durationMs: null, primaryImage: texture.url, images: [texture] } } };
  const parsed = validateReaderVfxManifest(raw); assert.ok(Object.isFrozen(parsed.effects[ref]));
  assert.equal(readerVfxImage(parsed.effects[ref])!.url, texture.url);
  assert.throws(() => validateReaderVfxManifest({ ...raw, effects: { [ref]: { ...raw.effects[ref], sourceRef: '/Game/Other.Other' } } }), /mismatch/);
  assert.throws(() => validateReaderVfxManifest({ ...raw, effects: { [ref]: { ...raw.effects[ref], images: [{ ...texture, width: 0 }] } } }), /Unvalidated/);
  assert.equal(readerVfxImage({ ...parsed.effects[ref], images: [{ ...texture, role: 'vat' }] } as ReaderVfxAsset), null);
  assert.equal(readerVfxImage({ ...parsed.effects[ref], primaryImage: undefined } as ReaderVfxAsset), null, 'a dependency mask is not a verified visible sprite');
});

test('the real VFX catalog loads drawable effects alongside explicit null bitmap primaries', async () => {
  const raw = read('../public/assets/reader-vfx/manifest.json');
  const loaded = await loadReaderVfxAssets('/', async () => new Response(JSON.stringify(raw)));
  assert.ok(loaded.manifest, loaded.issues.join('\n'));
  assert.deepEqual(loaded.issues, []);
  const effects = Object.values(loaded.manifest.effects);
  assert.equal(effects.length, 18, 'All authored prefab references remain in the shared catalog.');
  for (const name of ['UiItem_FxStart_Butterfly', 'UiItem_FxStart_Huaban', 'UiItem_FxLoop_SunGlow']) {
    const effect = effects.find(effect => effect.name === name)!;
    assert.equal(effect.sourceVerified, true);
    assert.ok(readerVfxImage(effect), `${name} retains its verified drawable sprite.`);
  }
  const unavailable = effects.filter(effect => effect.primaryImage === null);
  assert.ok(unavailable.length > 0, 'Native procedural or unresolved effects explicitly lack a bitmap.');
  assert.ok(unavailable.every(effect => readerVfxImage(effect) === null), 'Missing primaries never select an arbitrary dependency texture.');
});

test('resolved procedural effects report missing bitmap behavior while keeping their authored lifetime and stop', () => {
  const { runner, clock } = start([node(1, { stage: [screen('Procedural', .1, true), stop('Procedural', .3)] })]);
  try {
    runner.setVfxDefinitions({ [path('Procedural')]: { sourceRef: path('Procedural'), fxType: 'Persistent', sourceVerified: true, behaviorVerified: false, durationMs: null, images: [] } });
    clock.advanceBy(100);
    assert.equal(runner.getSnapshot().effects.active.length, 1);
    assert.ok(runner.getSnapshot().effects.issues.some(issue => issue.code === 'vfx-render-asset-unavailable'));
    clock.advanceBy(200);
    assert.equal(runner.getSnapshot().effects.active.length, 0);
  } finally { runner.dispose(); }
});

test('all eighteen authored prefabs have a drawable sprite or an explicit material projection', () => {
  const raw = validateReaderVfxManifest(read('../public/assets/reader-vfx/manifest.json'));
  for (const effect of Object.values(raw.effects)) assert.ok(readerVfxImage(effect) || effect.readerRenderer, effect.name);
  const procedural = Object.values(raw.effects).filter(effect => effect.readerRenderer);
  assert.deepEqual(procedural.map(effect => effect.readerRenderer).sort(), ['black','danger','fog','speed-line','speed-line-black']);
  assert.ok(procedural.every(effect => effect.sourceVerified && !effect.behaviorVerified));
  assert.ok(procedural.filter(effect => effect.readerRenderer !== 'fog').every(effect => effect.primaryImage === null));
});

test('real Black at silent 1015/40 remains visible across automatic traversal to /44, then expires once', () => {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock });
  runner.setVfxDefinitions(validateReaderVfxManifest(read('../public/assets/reader-vfx/manifest.json')).effects);
  runner.load(read('../public/data/scripts/1015.json'), validateManifest(read('../public/data/manifest.json'))); runner.start();
  try {
    for (let i=0;i<100 && runner.getSnapshot().nid!==43;i++) {
      clock.advanceBy(2000);
      const snapshot = runner.getSnapshot();
      if(snapshot.status==='choices') runner.choose(0); else runner.advance();
    }
    assert.equal(runner.getSnapshot().nid,43);runner.advance();
    const next=runner.getSnapshot();assert.equal(next.nid,44);
    const black=next.effects.active.find(effect=>effect.name==='UiItem_FxStart_Black')!;
    assert.ok(black);assert.equal(black.event.nid,40);assert.equal(black.event.timing?.delivery,'scheduled');
    clock.advanceBy(500);assert.equal(runner.getSnapshot().effects.active.find(effect=>effect.name===black.name)?.id,black.id);
    clock.advanceBy(2000);assert.ok(!runner.getSnapshot().effects.active.some(effect=>effect.name===black.name));
  } finally {runner.dispose();assert.equal(clock.pendingTimers,0);}
});
