import assert from 'node:assert/strict';
import test from 'node:test';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import { StageTransitions } from '../src/engine/StageTransitions.ts';
import { initialStageState, reduceStageEvent } from '../src/engine/StageState.ts';
import type { StageEvent, StageOp } from '../src/engine/types.ts';
import { FakeClock } from './FakeClock.ts';
import { fixture, manifest, node, option } from './fixtures.ts';

function start(nodes: Parameters<typeof fixture>[0], options: { instantTransitions?: boolean; navigationDebounceMs?: number } = {}, flow?: Parameters<typeof fixture>[1]) {
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock, ...options });
  assert.equal(runner.load(fixture(nodes, flow), manifest), true, runner.getSnapshot().error?.message ?? 'Timed fixture failed to load');
  runner.start();
  return { runner, clock };
}
const stageOps = (runner: ScriptRunner) => runner.getSnapshot().stageEvents.map(event => event.operation.op);

test('delayed operations remain pending, then apply once in timestamp and source order', () => {
  const { runner, clock } = start([node(9, { stage: [
    { op: 'move', who: '500', t: .5, dur: .2, pos: [400, 0, 1] },
    { op: 'enter', who: '500', t: 0, expr: 701 },
    { op: 'modify', who: '500', t: .5, expr: 702 },
    { op: 'bg', mode: 'Load', id: 10, t: 1 },
  ] })]);
  const initial = runner.getSnapshot();
  assert.deepEqual(stageOps(runner), ['enter']);
  assert.equal(initial.pendingStage.length, 3);
  assert.deepEqual(initial.stageState.characters['500'].position, [0, 0, 1]);
  clock.advanceBy(499);
  assert.deepEqual(stageOps(runner), ['enter']);
  clock.advanceBy(1);
  assert.deepEqual(stageOps(runner), ['enter', 'move', 'modify']);
  assert.deepEqual(runner.getSnapshot().stageEvents.map(event => event.timing?.sourceOrder), [1, 0, 2]);
  assert.equal(runner.getSnapshot().stageState.characters['500'].expression, 702);
  assert.deepEqual(runner.getSnapshot().stageState.characters['500'].position, [400, 0, 1]);
  assert.equal(runner.getSnapshot().presentation.characters[0].position[0], 0, 'Logical target precedes its visual interpolation');
  clock.advanceBy(500);
  assert.equal(runner.getSnapshot().stageState.background?.id, 10);
  assert.equal(runner.getSnapshot().stageState.appliedEvents, 4);
  assert.equal(runner.getSnapshot().pendingStage.length, 0);
  clock.advanceBy(5000);
  assert.equal(runner.getSnapshot().stageEvents.length, 4);
  assert.equal(initial.stageState.appliedEvents, 1, 'Old immutable snapshots must remain unchanged');
  runner.dispose();
});

test('choosing settles pending starts, waits for timed ends, then continues later flow actions', () => {
  const { runner, clock } = start([
    node(2, { stage: [
      { op: 'enter', who: '500', expr: 701, t: 0 },
      { op: 'move', who: '500', pos: [800, 0, 1], dur: 2, t: 2 },
      { op: 'modify', who: '500', expr: 702, t: 2 },
      { op: 'exit', who: '500', fadeOut: .2, t: .4, phase: 'end' },
      { op: 'bg', mode: 'Clean', t: .6, phase: 'end' },
    ], options: [option({ next: { type: 'end' }, optionId: 5 })] }), node(3), node(90),
  ], {}, [{ op: 'configure', config: { initialBackground: 10 } }, { op: 'talk', nids: [2, 3] }, { op: 'configure', config: { initialBackground: 20 } }, { op: 'talk', nids: [90] }]);
  clock.advanceBy(100);
  assert.equal(runner.choose(0), true);
  const leaving = runner.getSnapshot();
  assert.equal(leaving.status, 'ending');
  assert.equal(leaving.nid, 2);
  assert.equal(leaving.choiceHistory.length, 1);
  assert.equal(leaving.stageState.characters['500'].expression, 702);
  assert.deepEqual(leaving.stageState.characters['500'].position, [800, 0, 1]);
  assert.equal(leaving.presentation.transitions.length, 0, 'Settled starts do not launch future animations');
  assert.deepEqual(leaving.pendingStage.map(task => [task.phase, task.dueAtMs]), [['end', 500], ['end', 700]]);
  assert.equal(runner.choose(0), false);
  assert.equal(runner.advance(), false);
  clock.advanceBy(399);
  assert.equal(runner.getSnapshot().stageState.characters['500'].present, true);
  clock.advanceBy(1);
  assert.equal(runner.getSnapshot().stageState.characters['500'].present, false);
  assert.equal(runner.getSnapshot().presentation.characters[0].portraitOpacity, 1, 'An applied exit can retain a fading visual placeholder');
  assert.equal(runner.getSnapshot().stageState.background?.id, 10);
  clock.advanceBy(200);
  const next = runner.getSnapshot();
  assert.equal(next.nid, 90);
  assert.equal(next.flowActionIndex, 3);
  assert.equal(next.stageState.background?.id, 20);
  assert.ok(!next.events.some(event => event.type === 'dialogue' && event.node.nid === 3));
  assert.deepEqual(next.stageEvents.filter(event => event.phase === 'start' && event.nid === 2).map(event => event.timing?.delivery), ['scheduled', 'choice', 'choice']);
  const chosen = next.events.find(event => event.type === 'choiceSelected')!;
  const end = next.stageEvents.find(event => event.phase === 'end')!;
  const done = next.events.find(event => event.type === 'talkComplete')!;
  assert.ok(chosen.sequence < end.sequence && end.sequence < done.sequence);
  runner.advance();
  assert.equal(runner.getSnapshot().status, 'completed');
  runner.dispose();
});

test('advancing settles active visual tracks and pending starts without clearing persistent state', () => {
  const { runner, clock } = start([node(1, { stage: [
    { op: 'enter', who: '500', fadeIn: 2, t: 0 }, { op: 'bg', mode: 'Load', id: 10, t: 3 },
  ] }), node(2)]);
  clock.advanceBy(100);
  assert.ok(runner.getSnapshot().presentation.characters[0].portraitOpacity < 1);
  runner.advance();
  const state = runner.getSnapshot();
  assert.equal(state.nid, 2);
  assert.equal(state.stageState.background?.id, 10);
  assert.equal(state.presentation.characters[0].portraitOpacity, 1);
  assert.equal(state.presentation.transitions.length, 0);
  const late = state.stageEvents.at(-1)!;
  assert.equal(late.timing?.delivery, 'advance');
  assert.equal(late.timing?.appliedAtMs, 100);
  assert.equal(late.timing?.dueAtMs, 3000);
  clock.advanceBy(10_000);
  assert.equal(runner.getSnapshot().stageEvents.length, 2);
  runner.dispose();
});

test('late timer delivery preserves logical order and samples transitions at their source deadlines', () => {
  const { runner, clock } = start([node(1, { stage: [
    { op: 'enter', who: '500', pos: [0, 0, 1], t: 0 },
    { op: 'move', who: '500', pos: [1000, 0, 1], dur: .5, t: .25 },
    { op: 'modify', who: '500', expr: 702, t: .5 },
  ] })]);
  clock.elapseWithoutCallbacks(1000);
  clock.advanceBy(0);
  assert.deepEqual(stageOps(runner), ['enter', 'move', 'modify']);
  assert.deepEqual(runner.getSnapshot().stageEvents.slice(1).map(event => [event.timing?.dueAtMs, event.timing?.appliedAtMs]), [[250, 1000], [500, 1000]]);
  assert.equal(runner.getSnapshot().presentation.characters[0].position[0], 1000);
  assert.equal(runner.getSnapshot().presentation.transitions.length, 0);
  runner.dispose();
});

test('restart, script switch and disposal cancel timers even if cleared callbacks race', () => {
  const { runner, clock } = start([node(1, { stage: [
    { op: 'enter', who: '500', fadeIn: 3, t: 0 },
    { op: 'bg', mode: 'Load', id: 99, t: 2 }, { op: 'exit', who: '500', t: 2, phase: 'end' },
  ] })]);
  runner.advance();
  assert.equal(runner.getSnapshot().status, 'ending');
  const stale = [...clock.callbacks];
  runner.restart();
  const reset = runner.getSnapshot();
  stale.forEach(callback => callback());
  assert.equal(runner.getSnapshot(), reset);
  assert.equal(reset.stageEvents.length, 1);
  const staleRestart = [...clock.callbacks];
  runner.load({ ...fixture([node(7)]), id: 'x3' }, manifest);
  runner.start();
  const switched = runner.getSnapshot();
  staleRestart.forEach(callback => callback());
  clock.advanceBy(10_000);
  assert.equal(runner.getSnapshot(), switched);
  assert.equal(switched.scriptId, 'x3');
  assert.equal(switched.stageEvents.length, 0);
  runner.load(fixture([node(1, { stage: [{ op: 'bg', id: 10, mode: 'Load', t: 1 }] })]), manifest);
  runner.start();
  const disposalCallbacks = [...clock.callbacks];
  runner.dispose();
  const disposed = runner.getSnapshot();
  assert.equal(disposed.status, 'disposed');
  disposalCallbacks.forEach(callback => callback());
  clock.advanceBy(5000);
  assert.equal(clock.pendingTimers, 0);
  assert.equal(runner.getSnapshot(), disposed);
  assert.equal(runner.load(fixture([]), manifest), false);
  assert.equal(runner.restart(), false);
});

test('revisiting a nid creates a new timed visit while cancelled callbacks cannot replay prior operations', () => {
  const { runner, clock } = start([node(9, { next: { type: 'jump', to: 9 }, stage: [
    { op: 'enter', who: '500', t: 0, expr: 701 },
    { op: 'modify', who: '500', t: .2, expr: 702 },
    { op: 'exit', who: '500', t: .1, phase: 'end' },
  ] })]);
  clock.advanceBy(200);
  const stale = [...clock.callbacks];
  runner.advance();
  clock.advanceBy(100);
  assert.equal(runner.getSnapshot().visitId, 2);
  assert.equal(runner.getSnapshot().stageState.characters['500'].expression, 701);
  stale.forEach(callback => callback());
  clock.advanceBy(200);
  assert.equal(runner.getSnapshot().stageState.characters['500'].expression, 702);
  assert.deepEqual(runner.getSnapshot().stageEvents.map(event => [event.visitId, event.operation.op]), [[1, 'enter'], [1, 'modify'], [1, 'exit'], [2, 'enter'], [2, 'modify']]);
  runner.dispose();
});

test('instant toggle settles pending phases in order and turning timing back on never replays applied events', () => {
  const { runner, clock } = start([node(1, { stage: [
    { op: 'enter', who: '500', t: 0, fadeIn: 2 }, { op: 'modify', who: '500', t: 1, expr: 701 },
    { op: 'exit', who: '500', t: 1, phase: 'end' },
  ] }), node(2, { stage: [{ op: 'bg', mode: 'Load', id: 10, t: 1 }] })]);
  runner.advance();
  assert.equal(runner.getSnapshot().status, 'ending');
  runner.setInstantTransitions(true);
  const instant = runner.getSnapshot();
  assert.equal(instant.nid, 2);
  assert.equal(instant.stageState.background?.id, 10);
  assert.equal(instant.presentation.transitions.length, 0);
  assert.deepEqual(stageOps(runner), ['enter', 'modify', 'exit', 'bg']);
  runner.setInstantTransitions(false);
  clock.advanceBy(5000);
  assert.deepEqual(stageOps(runner), ['enter', 'modify', 'exit', 'bg']);
  assert.equal(runner.getSnapshot().instantTransitions, false);
  runner.dispose();
});

test('a clock-delayed silent node waits for its starts and automatic loop detection survives timer boundaries', () => {
  const { runner, clock } = start([node(41, { kind: 'silent', textKey: null, next: { type: 'jump', to: 41 }, stage: [{ op: 'audio', cue: 'muted', t: .1 }] })]);
  assert.equal(runner.getSnapshot().status, 'running');
  clock.advanceBy(100);
  assert.equal(runner.getSnapshot().status, 'error');
  assert.equal(runner.getSnapshot().error?.code, 'AUTOMATIC_LOOP');
  assert.equal(runner.getSnapshot().error?.nid, 41);
  assert.equal(runner.getSnapshot().stageEvents.length, 1);
  assert.equal(clock.pendingTimers, 0);
});

test('visit tokens and an injectable input guard reject rapid duplicate navigation in timed and instant modes', () => {
  for (const instantTransitions of [false, true]) {
    const { runner, clock } = start([node(1), node(2), node(3)], { navigationDebounceMs: 200, instantTransitions });
    const first = runner.getSnapshot();
    assert.equal(runner.advance(first), true);
    assert.equal(runner.getSnapshot().nid, 2);
    assert.equal(runner.advance(first), false);
    assert.equal(runner.advance(runner.getSnapshot()), false);
    clock.advanceBy(199);
    assert.equal(runner.advance(), false);
    clock.advanceBy(1);
    assert.equal(runner.getSnapshot().inputReady, true);
    assert.equal(runner.advance(first), false, 'A stale handler remains invalid after the cooldown');
    assert.equal(runner.advance(runner.getSnapshot()), true);
    assert.equal(runner.getSnapshot().nid, 3);
    assert.deepEqual(runner.getSnapshot().navigationHistory.map(entry => entry.to), [1, 2, 3]);
    runner.dispose();
  }
});

test('pure transition projection uses authored motion/fade durations and the independent native color duration', () => {
  const model = new StageTransitions();
  let state = initialStageState(1);
  let sequence = 0;
  function apply(operation: StageOp, now: number) {
    const event: StageEvent = { type: 'stage', scriptId: 'fixture', flowActionIndex: 1, nid: 9, runId: 1, sequence: ++sequence, source: 'node', visitId: 1, phase: operation.phase ?? 'start', operation, disposition: 'state' };
    const next = reduceStageEvent(state, event);
    model.apply(state, next, event, false, now);
    state = next;
  }
  apply({ op: 'enter', who: '500', fadeIn: 1, pos: [0, 0, 1], t: 0 }, 0);
  assert.equal(model.project(state, 500).characters[0].portraitOpacity, .5);
  apply({ op: 'move', who: '500', pos: [1000, 0, 1], dur: 2, t: 0 }, 1000);
  assert.equal(model.project(state, 2000).characters[0].position[0], 500);
  apply({ op: 'modify', who: '500', effect: 'Darken', t: 0 }, 2000);
  assert.equal(model.project(state, 2000).characters[0].portraitOpacity, 1);
  assert.equal(model.project(state, 2000).characters[0].brightness, 1);
  assert.equal(model.project(state, 2100).characters[0].brightness, .79);
  assert.equal(model.project(state, 2200).characters[0].brightness, .58);
  assert.equal(model.project(state, 2000).characters[0].position[0], 500, 'Expression/effect changes do not restart a move');
  apply({ op: 'move', who: '500', pos: [0, 0, 1], dur: 1, t: 0 }, 2000);
  assert.equal(model.project(state, 2500).characters[0].position[0], 250);
  apply({ op: 'exit', who: '500', fadeOut: .5, t: 0 }, 2500);
  assert.equal(state.characters['500'].present, false);
  assert.equal(model.project(state, 2750).characters[0].portraitOpacity, .5);
  assert.equal(model.project(state, 2750).characters[0].brightness, .58);
  apply({ op: 'blackIn', screen: 'Black', fade: .5, t: 0 }, 3000);
  assert.equal(model.project(state, 3250).blackOpacity, .5);
  apply({ op: 'blackOut', fade: .5, t: 0 }, 3500);
  assert.equal(model.project(state, 3750).blackOpacity, .5);
  apply({ op: 'bg', mode: 'Load', id: 10, t: 0 }, 4000);
  apply({ op: 'cg', mode: 'LoadImage', id: 20, t: 0 }, 4000);
  assert.equal(model.project(state, 4000).transitions.length, 0, 'Image configs have no verified fade fields');
});

test('malformed timing reports script, node and exact field; unsupported screen/easing data remain visible', () => {
  for (const [field, value] of [['dur', -1], ['fadeIn', 'fast'], ['fadeOut', Infinity], ['fade', 1e308], ['t', 1e308]] as const) {
    const runner = new ScriptRunner({ clock: new FakeClock() });
    runner.load(fixture([node(9, { stage: [{ op: 'move', t: 0, [field]: value } as StageOp] })]), manifest);
    assert.equal(runner.getSnapshot().status, 'error');
    assert.equal(runner.getSnapshot().error?.nid, 9);
    assert.equal(runner.getSnapshot().error?.path, `script.nodes[0].stage[0].${field}`);
  }
  const { runner } = start([node(1, { stage: [{ op: 'blackIn', screen: 'FutureColor', fade: 1, t: 0 }, { op: 'move', who: '500', pos: [0, 0, 1], dur: 1, ease: { Type: 'Preset', PresetType: 3 }, t: 0 }] })]);
  assert.equal(runner.getSnapshot().stageState.blackScreen, null);
  assert.ok(runner.getSnapshot().events.some(event => event.type === 'debug' && event.code === 'unsupported-screen-type'));
  assert.ok(runner.getSnapshot().events.some(event => event.type === 'debug' && event.code === 'unsupported-move-easing'));
  runner.dispose();
});
