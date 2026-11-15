import assert from 'node:assert/strict';
import test from 'node:test';
import { initialStageState, reduceStageEvent } from '../src/engine/StageState.ts';
import { StageTransitions, staticStagePresentation } from '../src/engine/StageTransitions.ts';
import type { StageEvent, StageOp } from '../src/engine/types.ts';
import { changliBlinkCadence } from '../src/spine/ChangliBlinkCadence.ts';
import { ChangliSpineActor } from '../src/spine/ChangliSpineScene.ts';
import type { ChangliFrame, ChangliScene } from '../src/spine/ChangliSpineScene.ts';
import { ChangliStageAdapter } from '../src/spine/ChangliStageAdapter.ts';
import { FakeClock } from './FakeClock.ts';
import { changliAssets, changliResources, changliSkeletonData, finishLoads } from './changli-fixtures.ts';

const expression = changliResources.expressions.get(700039)!;
const blinkDuration = changliSkeletonData.findAnimation(expression.blink!)!.duration;
const enter: StageOp = { op: 'enter', who: '999', expr: expression.id, t: 0 };
function event(operation: StageOp, runId = 1, sequence = 1): StageEvent {
  return { type: 'stage', scriptId: 'blink-fixture', nid: 1, flowActionIndex: 1, runId, sequence, visitId: 1, phase: 'start', operation, source: 'node', disposition: 'state' };
}
const view = staticStagePresentation(reduceStageEvent(initialStageState(1), event(enter))).characters[0];
// Spine may materialize an all-zero deform after restoring the eye track.
// Empty and all-zero deforms both draw the attachment's original vertices.
const geometry = (actor: ChangliSpineActor) => JSON.stringify((actor.skeleton as any).slots.map((slot: any) => [slot.attachment?.name, slot.deform.some((value: number) => value !== 0) ? [...slot.deform] : []]));
function actorFor(id = expression.id, random = () => 0) {
  const actor = new ChangliSpineActor(changliResources.runtime, changliSkeletonData, { drawSkeleton() {} }, { random });
  actor.setExpression(changliResources.expressions.get(id)!);
  return actor;
}

test('700039 starts one-shot blinks 3–6 seconds apart on the native eye track at the original clip speed', () => {
  assert.equal(expression.eye, 'dongzuo1_jingya_zhengyan'); assert.equal(expression.blink, 'dongzuo1_jingya_zhayan');
  assert.equal(changliSkeletonData.findAnimation(expression.eye)!.duration, 0);
  assert.ok(Math.abs(blinkDuration - .5666666) < 1e-6);
  assert.equal(changliBlinkCadence.provisional, false); assert.deepEqual(changliBlinkCadence.intervalSeconds, [3, 6]);
  const samples = [0, 1, .5, 0]; let sampleCount = 0;
  const actor = actorFor(expression.id, () => samples[sampleCount++]);
  try {
    const openPose = geometry(actor), staticTracks = [0, 1].map(track => actor.animationState.getCurrent(track));
    actor.render(view, 2.9);
    assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.eye); assert.equal(geometry(actor), openPose);
    for (let i = 0; i < 20; i++) { actor.setExpression({ ...expression }); actor.setBlinkEnabled(true); actor.render(view, 0); }
    assert.equal(sampleCount, 1, 'Identical snapshots do not restart the wait or resample the cadence.');
    actor.render(view, .1);
    const blink = actor.animationState.getCurrent(2)!;
    assert.equal(blink.animation.name, expression.blink); assert.equal(blink.loop, false); assert.equal(blink.timeScale, 1);
    assert.equal(actor.animationState.getCurrent(3), null, 'Blinking replaces the authored eye track without an additional overlay track.');
    assert.equal(sampleCount, 2, 'The next interval starts when this blink starts.');
    actor.render(view, .2);
    assert.equal(actor.animationState.getCurrent(2), blink); assert.ok(Math.abs(blink.trackTime - .2) < 1e-9);
    assert.notEqual(geometry(actor), openPose, 'The original blink changes eye geometry.');
    actor.render(view, blinkDuration - .2);
    const reopened = actor.animationState.getCurrent(2)!;
    assert.equal(reopened.animation.name, expression.eye); assert.equal(reopened.loop, true); assert.equal(reopened.trackTime, 0);
    assert.equal(geometry(actor), openPose, 'Open-eye attachments and deformation are fully restored at phase zero.');
    assert.deepEqual([0, 1].map(track => actor.animationState.getCurrent(track)), staticTracks, 'Blink completion preserves body and mouth track instances.');
    assert.equal(sampleCount, 2, 'Blink completion does not restart the interval.');
    actor.render(view, 6 - blinkDuration - .01); assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.eye);
    actor.render(view, .01); assert.equal(actor.animationState.getCurrent(2)!.loop, false);
    actor.render(view, blinkDuration); assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.eye); assert.equal(geometry(actor), openPose);
    actor.render(view, 4.5 - blinkDuration - .01); assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.eye);
    actor.render(view, .01); assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.blink);
  } finally { actor.dispose(); }
});

test('irregular frame deltas preserve blink speed, reopened eye phase and blink-start intervals', () => {
  const actor = actorFor();
  try {
    const openPose = geometry(actor);
    actor.render(view, 3.2);
    assert.ok(Math.abs(actor.animationState.getCurrent(2)!.trackTime - .2) < 1e-9);
    actor.render(view, 1);
    assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.eye); assert.equal(geometry(actor), openPose);
    const alreadyOpen = 1 - (blinkDuration - .2);
    assert.ok(Math.abs(actor.animationState.getCurrent(2)!.trackTime - alreadyOpen) < 1e-9);
    actor.render(view, 3 - blinkDuration - alreadyOpen - .01); assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.eye);
    actor.render(view, .02); assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.blink);
    assert.ok(Math.abs(actor.animationState.getCurrent(2)!.trackTime - .01) < 1e-9);
  } finally { actor.dispose(); }
});

test('changed eye/blink mappings cancel pending/active blinks and preserve static closed eyes', () => {
  const actor = actorFor(), closed = actorFor(700051), replacement = actorFor(700048);
  try {
    actor.render(view, 2.8);
    actor.setExpression(changliResources.expressions.get(700050)!);
    actor.render(view, .3); assert.equal(actor.animationState.getCurrent(2)!.animation.name, changliResources.expressions.get(700050)!.eye, 'The old expression deadline is canceled.');
    actor.render(view, 2.7); actor.render(view, .2); assert.equal(actor.animationState.getCurrent(2)!.animation.name, changliResources.expressions.get(700050)!.blink);
    actor.setExpression(changliResources.expressions.get(700051)!);
    assert.equal(actor.animationState.getCurrent(2)!.animation.name, changliResources.expressions.get(700051)!.eye); assert.equal(geometry(actor), geometry(closed));
    actor.render(view, 12); assert.equal(actor.animationState.getCurrent(2)!.animation.name, changliResources.expressions.get(700051)!.eye); assert.equal(geometry(actor), geometry(closed));
    actor.setExpression(expression); actor.render(view, 3.2); assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.blink);
    actor.setExpression(changliResources.expressions.get(700048)!);
    assert.equal(actor.animationState.getCurrent(2)!.animation.name, changliResources.expressions.get(700048)!.eye); assert.equal(geometry(actor), geometry(replacement));
    actor.render(view, .6); assert.equal(actor.animationState.getCurrent(2)!.animation.name, changliResources.expressions.get(700048)!.eye); assert.equal(geometry(actor), geometry(replacement));
    actor.render(view, 2.4); assert.equal(actor.animationState.getCurrent(2)!.animation.name, changliResources.expressions.get(700048)!.blink);
  } finally { actor.dispose(); closed.dispose(); replacement.dispose(); }
});

test('body-only expression changes preserve the pending blink and an active eye-track blink', () => {
  const actor = actorFor();
  try {
    actor.render(view, 2.8);
    const eye = actor.animationState.getCurrent(2), mouth = actor.animationState.getCurrent(1), bodyName = actor.animationState.getCurrent(0)!.animation.name;
    actor.setExpression(changliResources.expressions.get(700043)!);
    assert.equal(actor.animationState.getCurrent(2), eye); assert.equal(actor.animationState.getCurrent(1), mouth);
    // Spine may recycle a cleared TrackEntry object. Check the authored
    // channel and its new clock rather than that pool object's identity.
    assert.notEqual(actor.animationState.getCurrent(0)!.animation.name, bodyName);
    assert.equal(actor.animationState.getCurrent(0)!.trackTime, 0);
    assert.ok(Math.abs(eye!.trackTime - 2.8) < 1e-9, 'A new expression ID does not restart its unchanged eye clip.');
    actor.render(view, .3);
    const blink = actor.animationState.getCurrent(2)!;
    assert.equal(blink.animation.name, expression.blink); assert.ok(Math.abs(blink.trackTime - .1) < 1e-9);
    actor.setExpression(changliResources.expressions.get(700046)!);
    assert.equal(actor.animationState.getCurrent(2), blink, 'A second body pose retains the currently playing blink.');
    actor.render(view, blinkDuration - .1);
    assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.eye);
    assert.equal(actor.animationState.getCurrent(2)!.trackTime, 0);
    actor.render(view, 3 - blinkDuration - .01);
    assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.eye);
    actor.render(view, .02);
    assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.blink);
    assert.ok(Math.abs(actor.animationState.getCurrent(2)!.trackTime - .01) < 1e-9, 'Body changes retain the original blink-start deadline.');
  } finally { actor.dispose(); }
});

test('disabling a portrait cancels the blink and disposal rejects future frame updates', () => {
  let draws = 0;
  const actor = new ChangliSpineActor(changliResources.runtime, changliSkeletonData, { drawSkeleton() { draws++; } }, { intervalSeconds: [3, 3] });
  actor.setExpression(expression);
  const openPose = geometry(actor);
  actor.render(view, 3.2); assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.blink);
  actor.setBlinkEnabled(false);
  assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.eye); assert.equal(geometry(actor), openPose);
  actor.render({ ...view, portraitOpacity: .5 }, 8);
  assert.equal(actor.skeleton.color.a, .5); assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.eye);
  actor.setBlinkEnabled(true);
  actor.render(view, 2.9); assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.eye);
  actor.render(view, .2); assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.blink);
  actor.dispose(); const drawn = draws;
  actor.setExpression(expression); actor.setBlinkEnabled(true); actor.render(view, 20);
  assert.equal(draws, drawn); assert.equal(actor.animationState.getCurrent(2), null);
});

test('adapter state updates preserve cadence and exit/restart/script switch/disposal invalidate pending or active blinks', async () => {
  for (const phase of ['waiting', 'blinking'] as const) for (const lifecycle of ['exit', 'restart', 'script-switch', 'dispose'] as const) {
    const clock = new FakeClock(), transitions = new StageTransitions(), actors: ChangliSpineActor[] = [];
    let state = initialStageState(1), sequence = 0, draws = 0;
    const scene: ChangliScene = {
      createActor() { const actor = new ChangliSpineActor(changliResources.runtime, changliSkeletonData, { drawSkeleton() { draws++; } }, { intervalSeconds: [3, 3] }); actors.push(actor); return actor; },
      render(frames: readonly ChangliFrame[], delta: number) { for (const frame of frames) frame.actor.render(frame.view, delta); },
      dispose() {},
    };
    const adapter = new ChangliStageAdapter({} as HTMLCanvasElement, {
      load: () => Promise.resolve(changliResources), createScene: () => scene,
      requestFrame: callback => clock.setTimeout(() => callback(clock.now()), 16), cancelFrame: id => clock.clearTimeout(id),
    });
    const sync = () => adapter.sync(state, transitions.project(state, clock.now()).characters, changliAssets);
    const apply = (operation: StageOp) => {
      const stageEvent = event(operation, state.runId, ++sequence), previous = state;
      state = reduceStageEvent(state, stageEvent); transitions.apply(previous, state, stageEvent, false, clock.now()); sync();
    };
    const tick = (ms: number) => { clock.advanceBy(ms); sync(); };
    try {
      apply(enter); await finishLoads();
      const actor = actors[0], openPose = geometry(actor);
      tick(2800); assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.eye);
      for (let i = 0; i < 20; i++) sync();
      apply({ op: 'modify', who: '999', expr: expression.id, effect: 'Darken', t: 0 });
      apply({ op: 'move', who: '999', pos: [20, 0, 1.02], dur: .3, t: 0 });
      if (phase === 'blinking') { tick(400); assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.blink, 'Dimming/moving/snapshots do not postpone the pending blink.'); }
      const staleFrames = [...clock.callbacks];
      if (lifecycle === 'exit') {
        apply({ op: 'exit', who: '999', fadeOut: .8, t: 0 });
        assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.eye); assert.equal(geometry(actor), openPose);
        tick(400); assert.equal(actor.animationState.getCurrent(2)!.animation.name, expression.eye); assert.ok(actor.skeleton.color.a > 0);
        tick(420);
      } else if (lifecycle === 'dispose') adapter.dispose();
      else { state = initialStageState(state.runId + (lifecycle === 'restart' ? 1 : 2)); transitions.reset(); sync(); }
      assert.equal(actor.animationState.getCurrent(0), null);
      const beforeStaleFrames = draws;
      staleFrames.forEach(callback => callback()); assert.equal(draws, beforeStaleFrames);
      assert.equal(clock.pendingTimers, 0);
      if (lifecycle !== 'dispose') {
        apply(enter); const newActor = actors.at(-1)!;
        staleFrames.forEach(callback => callback());
        tick(2800); assert.equal(newActor.animationState.getCurrent(2)!.animation.name, expression.eye, 'A new entry gets its own full interval.');
        tick(400); assert.equal(newActor.animationState.getCurrent(2)!.animation.name, expression.blink);
      }
    } finally { adapter.dispose(); assert.equal(clock.pendingTimers, 0); }
  }
});
