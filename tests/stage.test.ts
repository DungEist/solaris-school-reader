import assert from 'node:assert/strict';
import test from 'node:test';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import { characterCoordinates } from '../src/engine/StageCoordinates.ts';
import { initialStageState, reduceStageEvent } from '../src/engine/StageState.ts';
import type { StageEvent, StageOp } from '../src/engine/types.ts';
import { fixture, manifest, node, option } from './fixtures.ts';

function event(sequence: number, operation: StageOp, runId = 1): StageEvent {
  return { type: 'stage', scriptId: 'fixture', flowActionIndex: 3, nid: 27, runId, sequence, source: 'node', visitId: 1, phase: operation.phase ?? 'start', operation, disposition: 'state' };
}

test('persistent stage survives dialogue nodes, choices, talk boundaries and script completion', () => {
  const runner = new ScriptRunner({ instantTransitions: true });
  runner.load(fixture([
    node(11, { stage: [{ op: 'enter', who: '500', expr: 701, pos: [-560, 0, 1], t: .4, fadeIn: .2 }, { op: 'cg', mode: 'LoadImage', id: 20, t: 0 }] }),
    node(27, { options: [option()] }), node(39, { next: { type: 'end' } }), node(91),
  ], [{ op: 'configure', config: { initialBackground: 10 } }, { op: 'talk', nids: [11, 27, 39] }, { op: 'talk', nids: [91] }]), manifest);
  runner.start();
  const initial = runner.getSnapshot().stageState;
  assert.equal(initial.background?.id, 10);
  assert.equal(initial.cg?.id, 20);
  assert.equal(initial.characters['500'].expression, 701);
  runner.advance();
  assert.equal(runner.getSnapshot().status, 'choices');
  assert.equal(runner.getSnapshot().stageState, initial);
  runner.choose(0);
  assert.equal(runner.getSnapshot().nid, 39);
  runner.advance();
  assert.equal(runner.getSnapshot().flowActionIndex, 2);
  assert.equal(runner.getSnapshot().nid, 91);
  assert.equal(runner.getSnapshot().stageState, initial);
  runner.advance();
  assert.equal(runner.getSnapshot().status, 'completed');
  assert.equal(runner.getSnapshot().stageState, initial);
  assert.equal(initial.appliedEvents, 3);
});

test('stage reset abandons the old ending and clears CG/characters on load and restart', () => {
  const runner = new ScriptRunner({ instantTransitions: true });
  const script = fixture([node(11), node(27, { stage: [
    { op: 'cg', mode: 'LoadImage', id: 20, t: 0 }, { op: 'enter', who: '500', expr: 701, t: 0 },
    { op: 'bg', mode: 'Load', id: 12, t: 8, phase: 'end' },
  ] })], [{ op: 'configure', config: { initialBackground: 10 } }, { op: 'talk', nids: [11, 27] }]);
  runner.load(script, manifest);
  runner.start(); runner.advance();
  const previous = runner.getSnapshot();
  assert.equal(previous.stageState.cg?.id, 20);
  runner.restart();
  const reset = runner.getSnapshot();
  assert.ok(reset.runId > previous.runId);
  assert.equal(reset.stageState.runId, reset.runId);
  assert.equal(reset.stageState.cg, null);
  assert.deepEqual(reset.stageState.characters, {});
  assert.equal(reset.stageState.background?.id, 10);
  assert.equal(reset.stageEvents.length, 1);
  assert.equal(reset.stageEvents.some(item => item.phase === 'end'), false);
  runner.load({ ...fixture([node(1)]), id: 'x2' }, manifest);
  assert.equal(runner.getSnapshot().stageState.background, null);
  runner.start();
  assert.equal(runner.getSnapshot().stageState.appliedEvents, 0);
  assert.equal(runner.getSnapshot().stageState.cg, null);
});

test('background changes and CG clears apply at their own lifecycle phase once, with timing retained', () => {
  const runner = new ScriptRunner({ instantTransitions: true });
  runner.load(fixture([node(11, { stage: [
    { op: 'cg', mode: 'LoadImage', id: 20, t: .8 },
    { op: 'bg', mode: 'Load', id: 12, t: 1.5, phase: 'end' },
    { op: 'cg', mode: 'Clean', id: null, t: 2.2, phase: 'end' },
  ] }), node(27)], [{ op: 'configure', config: { initialBackground: 10 } }, { op: 'talk', nids: [11, 27] }]), manifest);
  runner.start();
  assert.equal(runner.getSnapshot().stageState.background?.id, 10);
  assert.equal(runner.getSnapshot().stageState.cg?.id, 20);
  for (let i = 0; i < 5; i++) {
    const unsubscribe = runner.subscribe(() => {}); runner.getSnapshot(); unsubscribe();
  }
  assert.equal(runner.getSnapshot().stageState.appliedEvents, 2);
  runner.advance();
  const state = runner.getSnapshot();
  assert.equal(state.stageState.background?.id, 12);
  assert.equal(state.stageState.cg, null);
  assert.equal(state.stageState.appliedEvents, 4);
  assert.deepEqual(state.stageEvents.filter(item => item.phase === 'end').map(item => item.operation.t), [1.5, 2.2]);
  runner.advance();
  assert.equal(runner.getSnapshot().stageState, state.stageState);
});

test('pure stage reducer ignores duplicate/out-of-order events and rejects older runs', () => {
  const firstEvent = event(4, { op: 'bg', mode: 'Load', id: 10, t: 0 });
  const first = reduceStageEvent(initialStageState(), firstEvent);
  assert.equal(reduceStageEvent(first, firstEvent), first);
  assert.equal(reduceStageEvent(first, event(3, { op: 'bg', mode: 'Clean', t: 0 })), first);
  const second = reduceStageEvent(first, event(9, { op: 'cg', mode: 'LoadImage', id: 20, t: 0 }));
  const reset = reduceStageEvent(second, event(1, { op: 'enter', who: '500', t: 0 }, 2));
  assert.equal(reset.background, null);
  assert.equal(reset.cg, null);
  assert.equal(reset.appliedEvents, 1);
  assert.equal(reduceStageEvent(reset, event(100, { op: 'bg', mode: 'Load', id: 10, t: 0 })), reset);
  assert.equal(first.cg, null, 'A later event mutated the previous state');
  assert.ok(Object.isFrozen(reset) && Object.isFrozen(reset.characters));
});

test('character enter/move/modify/exit patches preserve stage who, visibility, expression and effects', () => {
  let state = reduceStageEvent(initialStageState(), event(1, { op: 'enter', who: '500', expr: 701, pos: [-560, 0, 1], hideAvatar: true, effect: 'Highlight', t: 0 }));
  const original = state.characters['500'];
  assert.equal(original.present, true); assert.equal(original.portraitVisible, true); assert.equal(original.avatarVisible, false);
  state = reduceStageEvent(state, event(2, { op: 'modify', who: '500', expr: 702, hidePortrait: true, hideAvatar: false, effect: 'Darken', t: 0 }));
  state = reduceStageEvent(state, event(3, { op: 'move', who: '500', pos: [400, -500, .8], dur: 2, t: .4 }));
  assert.deepEqual(state.characters['500'].position, [400, -500, .8]);
  assert.equal(state.characters['500'].expression, 702);
  assert.equal(state.characters['500'].effect, 'Darken');
  assert.equal(state.characters['500'].portraitVisible, false); assert.equal(state.characters['500'].avatarVisible, true);
  state = reduceStageEvent(state, event(4, { op: 'exit', who: '500', fadeOut: .3, phase: 'end', t: 1 }));
  assert.equal(state.characters['500'].present, false);
  assert.equal(state.characters['500'].portraitVisible, false); assert.equal(state.characters['500'].avatarVisible, false);
  assert.equal(state.characters['500'].expression, 702);
  assert.equal(state.characters['500'].lastEvent.operation.fadeOut, .3);
  assert.equal(original.expression, 701); assert.equal(original.present, true);
  state = reduceStageEvent(state, event(5, { op: 'enter', who: 'constructor', expr: 701, t: 0 }));
  assert.ok(Object.values(state.characters).some(character => character.who === 'constructor'), 'String who must not collide with object prototype keys');
});

test('updates before Enter are tracked without creating a visible character; malformed fields stay contextual', () => {
  let state = reduceStageEvent(initialStageState(), event(1, { op: 'move', who: '500', pos: [400, 0, 1], t: 0 }));
  assert.equal(state.characters['500'].present, false);
  assert.equal(state.issues[0].code, 'character-before-enter');
  state = reduceStageEvent(state, event(2, { op: 'modify', who: '500', pos: [Infinity, 0, 1], expr: -1, hideAvatar: 'true', t: 0 }));
  assert.deepEqual(state.characters['500'].position, [400, 0, 1]);
  assert.equal(state.characters['500'].expression, null);
  assert.equal(state.characters['500'].hideAvatar, false);
  assert.deepEqual(state.issues.slice(1).map(issue => issue.code), ['invalid-character-position', 'invalid-character-visibility', 'invalid-character-expression']);
  assert.ok(state.issues.every(issue => issue.event.scriptId === 'fixture' && issue.event.flowActionIndex === 3 && issue.event.nid === 27));
});

test('source Load/Clean modes clear state; unknown modes and deferred operations remain diagnostic metadata', () => {
  let state = reduceStageEvent(initialStageState(), event(1, { op: 'bg', id: 10, mode: 'Load', t: 0 }));
  state = reduceStageEvent(state, event(2, { op: 'cg', id: 20, mode: 'LoadImage', t: 0 }));
  state = reduceStageEvent(state, event(3, { op: 'bg', id: 12, mode: 'GuessNight', t: 0 }));
  assert.equal(state.background?.id, 10);
  state = reduceStageEvent(state, event(4, { op: 'cg', id: null, mode: 'LoadPrefab', t: 0 }));
  assert.equal(state.cg?.kind, 'prefab');
  assert.equal(state.issues.at(-1)?.code, 'unsupported-cg-prefab');
  state = reduceStageEvent(state, event(5, { op: 'cgMove', from: [0, 0, 1], to: [40, 0, 2], dur: 3, t: .2 }));
  assert.equal(state.cg?.kind, 'prefab');
  assert.equal(state.issues.at(-1)?.event.operation.dur, 3);
  state = reduceStageEvent(state, event(6, { op: 'FutureEffect', t: 0 }));
  assert.equal(state.issues.at(-1)?.code, 'unsupported-stage-operation');
  state = reduceStageEvent(state, event(7, { op: 'bg', mode: 'Clean', t: 0 }));
  state = reduceStageEvent(state, event(8, { op: 'cg', mode: 'Clean', t: 0 }));
  assert.equal(state.background, null); assert.equal(state.cg, null);
});

test('coordinate conversion is centralized, preserves scale, and allows offstage positions', () => {
  assert.deepEqual(characterCoordinates([0, 0, 1]), { leftPercent: 50, bottomPercent: 5, scale: 1 });
  assert.deepEqual(characterCoordinates([-640, -720, .8]), { leftPercent: 25, bottomPercent: -45, scale: .8 });
  assert.deepEqual(characterCoordinates([640, 720, 1.2]), { leftPercent: 75, bottomPercent: 55, scale: 1.2 });
  assert.ok(characterCoordinates([-1700, 0, 1]).leftPercent < 0);
  assert.throws(() => characterCoordinates([0, 0, 1], { width: 0, height: 1440, floorPercent: 5 }), /coordinate frame/);
});
