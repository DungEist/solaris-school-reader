import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import type { PresentedCharacter } from '../src/engine/StageTransitions.ts';
import type { Script } from '../src/engine/types.ts';
import { validateManifest } from '../src/engine/validation.ts';
import type { ChangliExpression } from '../src/spine/ChangliAssets.ts';
import { changliTransform } from '../src/spine/ChangliCalibration.ts';
import { ChangliSpineActor } from '../src/spine/ChangliSpineScene.ts';
import type { ChangliFrame, ChangliScene } from '../src/spine/ChangliSpineScene.ts';
import { ChangliStageAdapter } from '../src/spine/ChangliStageAdapter.ts';
import type { ChangliRendererStatuses } from '../src/spine/ChangliStageAdapter.ts';
import { FakeClock } from './FakeClock.ts';
import { changliAssets, changliResources, changliSkeletonData, deferred, finishLoads } from './changli-fixtures.ts';

const dataRoot = new URL('../public/data/', import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, dataRoot), 'utf8'));
const manifest = validateManifest(read('manifest.json'));
const scripts = new Map<string, Script>(['1009', '3007', '9001'].map(id => [id, read(`scripts/${id}.json`)]));
const route = new Map([[5, 18], [13, 3], [23, 7], [33, 12]]);

// Real runner snapshots and supplied Spine math; GPU drawing is deliberately
// omitted. These regressions do not claim browser/texture-render verification.
class ObservedActor extends ChangliSpineActor {
  readonly expressions: ChangliExpression[] = [];
  readonly frames: PresentedCharacter[] = [];
  disposalCount = 0;
  constructor() { super(changliResources.runtime, changliSkeletonData, { drawSkeleton() {} }); }
  override setExpression(expression: ChangliExpression): void { super.setExpression(expression); this.expressions.push(expression); }
  override render(view: PresentedCharacter, delta: number): void { super.render(view, delta); this.frames.push(view); }
  override dispose(): void { super.dispose(); this.disposalCount++; }
}
class ObservedScene implements ChangliScene {
  readonly actors: ObservedActor[] = [];
  visible: readonly ChangliFrame[] = [];
  disposalCount = 0;
  createActor(): ObservedActor { const actor = new ObservedActor(); this.actors.push(actor); return actor; }
  render(characters: readonly ChangliFrame[], delta: number): void {
    this.visible = characters;
    for (const entry of characters) entry.actor.render(entry.view, delta);
  }
  dispose(): void { this.disposalCount++; }
}

function rig(id: string, load = () => Promise.resolve(changliResources)) {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock }), scenes: ObservedScene[] = [];
  let statuses: ChangliRendererStatuses = {}, loadCalls = 0;
  const adapter = new ChangliStageAdapter({} as HTMLCanvasElement, {
    load: () => { loadCalls++; return load(); },
    createScene: () => { const scene = new ObservedScene(); scenes.push(scene); return scene; },
    requestFrame: callback => clock.setTimeout(() => callback(clock.now()), 16), cancelFrame: handle => clock.clearTimeout(handle),
    onStatus: value => { statuses = value; },
  });
  const sync = () => { const snapshot = runner.getSnapshot(); adapter.sync(snapshot.stageState, snapshot.presentation.characters, changliAssets); };
  const unsubscribe = runner.subscribe(sync);
  assert.equal(runner.load(scripts.get(id), manifest), true);
  assert.equal(runner.start(), true);
  const tick = (ms: number) => { clock.advanceBy(ms); sync(); };
  const select = (optionId: number) => {
    const snapshot = runner.getSnapshot(), index = snapshot.choices.findIndex(option => option.optionId === optionId);
    assert.ok(index >= 0, `Script ${snapshot.scriptId}/${snapshot.nid} has no optionId ${optionId}`);
    // Portrait-stage traversal uses explicit Developer edges, without claiming
    // that a direct scene jump satisfies its management prerequisites.
    assert.equal(runner.overrideChoice(index), true);
  };
  const walkTo = (nid: number, dwell = 1100, selections = route) => {
    for (let step = 0; step < 150; step++) {
      const snapshot = runner.getSnapshot();
      if (snapshot.nid === nid && ['dialogue', 'choices'].includes(snapshot.status)) return;
      assert.notEqual(snapshot.status, 'error', snapshot.error?.message ?? `Script ${id} failed before nid ${nid}`);
      assert.notEqual(snapshot.status, 'completed', `Completed before reaching ${id}/${nid}`);
      if (snapshot.status === 'running' || snapshot.status === 'ending') { tick(50); continue; }
      if (dwell) tick(dwell);
      if (snapshot.status === 'choices') select(selections.get(snapshot.nid!) ?? snapshot.choices[0].optionId!);
      else assert.equal(runner.advance(), true);
    }
    assert.fail(`Did not reach ${id}/${nid}`);
  };
  return {
    adapter, clock, runner, scenes, tick, sync, select, walkTo,
    get statuses() { return statuses; }, get loadCalls() { return loadCalls; },
    get view() { return runner.getSnapshot().presentation.characters.find(view => view.character.who === '999')!; },
    dispose() { unsubscribe(); adapter.dispose(); runner.dispose(); assert.equal(clock.pendingTimers, 0); },
  };
}

test('real 1009 joins stage slot 999 to Changli and preserves expressions, dimming, scale fades, exit and restart', async () => {
  assert.equal(read('speakers.json')['999'].talkerId, 850006, 'Use the explicit source speaker config; expressions still select the portrait independently.');
  const current = rig('1009');
  try {
    current.walkTo(5); await finishLoads();
    const scene = current.scenes[0], actor = scene.actors[0];
    assert.equal(current.statuses['999'].kind, 'ready');
    assert.equal(actor.expressions[0].id, 700048);
    current.tick(160); assert.ok(actor.skeleton.color.a > 0 && actor.skeleton.color.a < 1);
    current.tick(160); assert.equal(actor.skeleton.color.a, 1);
    current.select(18); current.walkTo(8);
    assert.equal(actor.expressions.at(-1)!.id, 700045);
    const changes = actor.expressions.length, body = actor.animationState.getCurrent(0)!, bodyTime = body.trackTime;
    current.walkTo(11);
    assert.equal(actor.skeleton.color.a, 1);
    assert.equal(actor.skeleton.color.r, 1, 'Darken starts an independent 200 ms color fade.');
    current.tick(100);
    assert.ok(actor.skeleton.color.r > .58 && actor.skeleton.color.r < 1, 'Actual Spine frames render intermediate brightness.');
    assert.equal(actor.skeleton.color.a, 1);
    current.tick(124); // Include the runner publication and the next Spine frame.
    assert.equal(actor.skeleton.color.r, .58);
    assert.equal(actor.expressions.length, changes);
    assert.equal(actor.animationState.getCurrent(0), body); assert.ok(body.trackTime >= bodyTime);
    current.walkTo(12); assert.equal(actor.expressions.at(-1)!.id, 700039); assert.equal(actor.skeleton.color.a, 1);
    current.walkTo(20);
    assert.equal(actor.expressions.at(-1)!.id, 700050);
    current.tick(350);
    assert.ok(current.view.position[2] > 1.02 && current.view.position[2] < 1.1);
    assert.equal(actor.skeleton.scaleX, changliTransform(current.view.position).scale);
    current.tick(370); assert.equal(current.view.position[2], 1.1);
    current.walkTo(21); current.tick(224);
    assert.equal(actor.skeleton.color.a, 1); assert.equal(actor.skeleton.color.r, .58);
    current.walkTo(22); current.tick(350);
    assert.ok(current.view.position[2] > 1.02 && current.view.position[2] < 1.1);
    assert.equal(actor.skeleton.color.a, 1);
    current.walkTo(44);
    assert.equal(scene.actors.length, 1, 'Expressions and presentation changes reuse the original instance.');
    assert.equal(current.runner.advance(), true);
    assert.equal(current.view.character.present, false);
    current.tick(140); assert.ok(actor.skeleton.color.a > 0 && actor.skeleton.color.a < 1); assert.equal(actor.disposalCount, 0);
    current.tick(160); assert.equal(actor.disposalCount, 1); assert.equal(scene.visible.length, 0);
    assert.equal(current.runner.restart(), true); current.walkTo(5);
    assert.equal(scene.actors.length, 2); assert.equal(current.loadCalls, 1);
    assert.equal(scene.actors[1].expressions[0].id, 700048);
  } finally { current.dispose(); }
});

test('real 3007/5 source movement pulses the stable Changli instance while other talkers stay placeholders', async () => {
  const current = rig('3007');
  try {
    await finishLoads(); current.walkTo(4);
    const scene = current.scenes[0], actor = scene.actors[0];
    assert.equal(Object.keys(current.runner.getSnapshot().stageState.characters).length, 3);
    assert.equal(scene.actors.length, 1);
    current.select(2); assert.equal(current.runner.getSnapshot().nid, 5); assert.equal(actor.expressions.at(-1)!.id, 700050);
    current.tick(170); assert.ok(current.view.position[1] < 0 && current.view.position[1] > -16);
    assert.equal(actor.skeleton.y, changliTransform(current.view.position).y);
    current.tick(120); assert.equal(current.view.position[1], -16);
    current.tick(160); assert.ok(current.view.position[1] > -16 && current.view.position[1] < 0);
    current.tick(130); assert.equal(current.view.position[1], 0);
    assert.equal(scene.actors.length, 1); assert.equal(actor.expressions.length, 2);
  } finally { current.dispose(); }
});

test('real 3007/9 clears blink for static closed eyes, then applies the mapped expression at 0.9 seconds', async () => {
  const current = rig('3007');
  try {
    await finishLoads(); current.walkTo(4); current.select(3);
    const actor = current.scenes[0].actors[0];
    assert.equal(current.runner.getSnapshot().nid, 9);
    assert.equal(actor.expressions.at(-1)!.id, 700051); assert.equal(actor.animationState.getCurrent(3), null);
    assert.ok([0, 1, 2].every(track => actor.animationState.getCurrent(track)!.animation.duration === 0));
    current.tick(450); assert.equal(actor.expressions.at(-1)!.id, 700051);
    current.tick(450); assert.equal(actor.expressions.at(-1)!.id, 700041);
    assert.equal(actor.animationState.getCurrent(2)!.animation.name, changliResources.expressions.get(700041)!.eye);
    assert.equal(actor.animationState.getCurrent(3), null, 'The newly mapped open-eye expression waits before its first blink.');
    assert.equal(current.scenes[0].actors.length, 1);
  } finally { current.dispose(); }
});

test('real 9001 loading uses the latest expression, moves in the source pipeline, exits/re-enters and respects hidden portraits', async () => {
  const pending = deferred<typeof changliResources>(), current = rig('9001', () => pending.promise);
  try {
    current.walkTo(1); current.tick(300); assert.equal(current.loadCalls, 0);
    current.tick(250); assert.equal(current.loadCalls, 1); assert.equal(current.scenes.length, 0);
    current.walkTo(21, 0); assert.equal(current.view.character.expression, 700045);
    current.tick(400); assert.equal(current.view.character.expression, 700050);
    pending.resolve(changliResources); await finishLoads();
    const scene = current.scenes[0], actor = scene.actors[0];
    assert.deepEqual(actor.expressions.map(expression => expression.id), [700050]);
    current.walkTo(23); current.tick(330);
    assert.ok(current.view.position[0] < 20 && current.view.position[0] > -15);
    assert.ok(current.view.position[2] > 1.02 && current.view.position[2] < 1.04);
    assert.equal(actor.skeleton.x, changliTransform(current.view.position).x);
    current.tick(340); assert.deepEqual(current.view.position, [-15, 0, 1.04]);
    current.runner.advance(); current.tick(300); assert.equal(actor.disposalCount, 1);
    current.walkTo(26); assert.equal(scene.actors.length, 2, 'Silent nid 9004 creates a new entry.');
    current.walkTo(28); current.tick(300);
    assert.equal(scene.actors[1].disposalCount, 1); assert.equal(scene.visible.length, 0);
    current.tick(1800);
    assert.equal(current.view.character.present, true); assert.equal(current.view.character.hidePortrait, true);
    assert.equal(scene.actors.length, 2); assert.equal(current.statuses['999'].kind, 'hidden');
    current.walkTo(30, 0);
    assert.equal(current.view.character.expression, 700048); assert.equal(current.view.character.hidePortrait, true);
    assert.equal(scene.visible.length, 0); assert.equal(scene.actors.length, 2);
  } finally { current.dispose(); }
});

test('real rapid advancement and restart/script-switch/unmount cancel stale runner, loading and frame callbacks', async () => {
  for (const lifecycle of ['rapid-exit', 'restart', 'script-switch', 'unmount'] as const) {
    const pending = deferred<typeof changliResources>(), current = rig('9001', () => pending.promise);
    let disposed = false;
    try {
      current.walkTo(1); current.tick(550); const stale = [...current.clock.callbacks];
      if (lifecycle === 'rapid-exit') { current.walkTo(24, 0); current.tick(300); }
      if (lifecycle === 'restart') assert.equal(current.runner.restart(), true);
      if (lifecycle === 'script-switch') assert.equal(current.runner.load(scripts.get('1009'), manifest), true);
      if (lifecycle === 'unmount') { current.dispose(); disposed = true; }
      const snapshot = current.runner.getSnapshot();
      stale.forEach(callback => callback());
      assert.equal(current.runner.getSnapshot(), snapshot, `${lifecycle}: stale engine frames cannot change a run.`);
      pending.resolve(changliResources); await finishLoads();
      assert.equal(current.scenes.length, 0, `${lifecycle}: a late load cannot resurrect the exited portrait.`);
      assert.notEqual(current.runner.getSnapshot().status, 'error');
    } finally { if (!disposed) current.dispose(); }
  }
});
