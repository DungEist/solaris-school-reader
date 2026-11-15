import assert from 'node:assert/strict';
import test from 'node:test';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import type { Metadata, RunnerEvent } from '../src/engine/types.ts';
import { ReaderPresentations } from '../src/ui/ReaderPresentations.ts';
import { FakeClock } from './FakeClock.ts';
import { fixture, manifest, node } from './fixtures.ts';

const gains: readonly Metadata[] = [
  { kind: 'attribute', attributeId: 4, value: 1, before: 20, after: 21, labelKey: 'feeling' },
  { kind: 'favor', roleId: 2, value: 10, before: 0, after: 10, labelKey: 'cartethyia' },
  { kind: 'favorLevel', roleId: 2, before: 0, after: 1, labelKey: 'cartethyia', tierLabelKey: 'acquainted' },
  { kind: 'item', itemId: 4, value: 1, bounds: { min: 1, max: 1 }, labelKey: 'gift' },
  { kind: 'requestUnlocked', requestId: 1105, questId: 1105, labelKey: 'request' },
];
function mutation(runner: ScriptRunner, sequence: number, changes: readonly Metadata[] = gains): RunnerEvent {
  const snapshot = runner.getSnapshot();
  assert.ok(snapshot.scriptId, 'the presentation fixture must have a loaded script');
  return { type: 'storyMutation', runId: snapshot.runId, sequence, scriptId: snapshot.scriptId, flowActionIndex: snapshot.flowActionIndex, nid: snapshot.nid,
    actionId: 20000224, visitId: snapshot.visitId, stageSequence: sequence - 1, changes };
}
function observed(runner: ScriptRunner, clock: FakeClock) {
  let delivery: (event: RunnerEvent) => void = () => {};
  const source = { getSnapshot: runner.getSnapshot, subscribe: runner.subscribe, onEvent: (listener: (event: RunnerEvent) => void) => { delivery = listener; return runner.onEvent(listener); } };
  return { presentations: new ReaderPresentations(source, clock), deliver: (event: RunnerEvent) => delivery(event) };
}

test('combined stat/favor cards, item and request receipt, and tier confirmation project one delivered event without granting anything', () => {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock, instantTransitions: true });
  runner.load(fixture([node(1)]), manifest); runner.start();
  const { presentations, deliver } = observed(runner, clock);
  try {
    const before = runner.getSnapshot(), event = mutation(runner, 1000);
    deliver(event);
    const state = presentations.getSnapshot();
    assert.deepEqual(state.consequences[0].changes.map(change => change.kind), ['attribute', 'favor', 'item', 'requestUnlocked']);
    assert.equal(state.relationships.length, 0, 'an earned scene tier waits for completion');
    assert.equal(runner.getSnapshot(), before);
    deliver(event); deliver(event);
    assert.equal(presentations.getSnapshot(), state, 'event deduplication survives repeated delivery');
    presentations.setSource({ schema: 1, introductions: {}, lettersByAction: {}, english: {} });
    assert.equal(presentations.getSnapshot(), state, 'late labels cannot discard a tier waiting for scene completion');
    runner.advance();
    const completed = runner.getSnapshot(), ready = presentations.getSnapshot();
    assert.equal(ready.relationships.length, 1);
    assert.equal(ready.relationships[0].change.after, 1);
    presentations.dismissRelationship('stale');
    assert.equal(presentations.getSnapshot(), ready);
    const id = ready.relationships[0].id;
    presentations.dismissRelationship(id); presentations.dismissRelationship(id);
    deliver(event);
    assert.equal(presentations.getSnapshot().relationships.length, 0, 'confirmation and rereading cannot show the same tier again');
    clock.advanceBy(5999);
    assert.equal(presentations.getSnapshot().consequences.length, 1);
    clock.advanceBy(1);
    assert.equal(presentations.getSnapshot().consequences.length, 0);
    assert.equal(runner.getSnapshot().storyState, completed.storyState, 'card expiry does not change playthrough state');
  } finally { presentations.dispose(); runner.dispose(); }
});

test('attachment reads existing mutations once, source metadata does not replay them, and a new run rejects stale deliveries and timers', () => {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock, instantTransitions: true });
  runner.load(fixture([node(1)]), manifest); runner.start();
  const event = mutation(runner, 1000), snapshot = { ...runner.getSnapshot(), events: Object.freeze([...runner.getSnapshot().events, event]) };
  let delivery: (event: RunnerEvent) => void = () => {};
  const source = { getSnapshot: () => runner.getSnapshot().runId === snapshot.runId ? snapshot : runner.getSnapshot(), subscribe: runner.subscribe,
    onEvent: (listener: (event: RunnerEvent) => void) => { delivery = listener; return runner.onEvent(listener); } };
  const presentations = new ReaderPresentations(source, clock);
  try {
    assert.equal(presentations.getSnapshot().consequences.length, 1);
    assert.equal(presentations.getSnapshot().relationships.length, 0, 'historical mutations cannot announce an existing tier');
    presentations.setSource({ schema: 1, introductions: {}, lettersByAction: {}, english: {} });
    const before = presentations.getSnapshot();
    delivery(event);
    assert.equal(presentations.getSnapshot(), before);
    const expiredCallback = clock.callbacks.at(-1)!;
    runner.restart();
    const reset = presentations.getSnapshot();
    assert.equal(reset.consequences.length, 0); assert.equal(reset.relationships.length, 0);
    delivery(event); expiredCallback();
    assert.equal(presentations.getSnapshot(), reset);
    const newEvent = mutation(runner, 1000);
    delivery(newEvent);
    assert.equal(presentations.getSnapshot().relationships.length, 0);
    runner.advance();
    assert.equal(presentations.getSnapshot().relationships.length, 1);
    const oldId = `${event.runId}:${event.sequence}:relationship:2`;
    assert.notEqual(presentations.getSnapshot().relationships[0].id, oldId);
    presentations.dismissRelationship(oldId);
    assert.equal(presentations.getSnapshot().relationships.length, 1, 'a stale confirmation cannot dismiss the new run');
  } finally { presentations.dispose(); runner.dispose(); }
});

test('distinct authored rewards stay distinct while zero gains, unchanged tiers and diagnostics remain absent from Reader notices', () => {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock, instantTransitions: true });
  runner.load(fixture([node(1)]), manifest); runner.start();
  const { presentations, deliver } = observed(runner, clock);
  try {
    deliver(mutation(runner, 1000, [{ kind: 'favor', roleId: 2, value: 10 }]));
    deliver(mutation(runner, 1001, [{ kind: 'favor', roleId: 2, value: 10 }]));
    assert.equal(presentations.getSnapshot().consequences.length, 2);
    const before = presentations.getSnapshot();
    deliver(mutation(runner, 1002, [
      { kind: 'attribute', attributeId: 1, value: 0 }, { kind: 'favor', roleId: 2, value: 0 },
      { kind: 'favorLevel', roleId: 2, before: 1, after: 1 }, { kind: 'item', itemId: 1, value: 0 },
      { kind: 'ending', endingId: 4 }, { kind: 'variable', key: 'key1', value: true }, { kind: 'conditionTrace', groupId: 100 },
    ]));
    assert.equal(presentations.getSnapshot(), before);
  } finally { presentations.dispose(); runner.dispose(); }
});
