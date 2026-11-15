import assert from 'node:assert/strict';
import test from 'node:test';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import type { RunnerEvent } from '../src/engine/types.ts';
import { ReaderPresentations } from '../src/ui/ReaderPresentations.ts';
import { FakeClock } from './FakeClock.ts';
import { fixture, manifest, node } from './fixtures.ts';
import { playthroughHarness, realCatalog, realScript, realSource } from './PlaythroughHarness.ts';

const action = (actionId: number, t = 0, phase?: 'end') => ({ op: 'activityAction', kind: 'SolarSchool', actionId, t, ...(phase ? { phase } : {}) });
const portraits = (runner: ScriptRunner) => Object.values(runner.getSnapshot().stageState.characters).filter(c => c.portraitVisible).map(c => c.who).sort();
function advanceTo(runner: ScriptRunner, predicate: () => boolean, max = 400) {
  for (let i = 0; !predicate() && i < max; i++) {
    const s = runner.getSnapshot();
    assert.ok(['dialogue', 'choices'].includes(s.status), `Unexpected ${s.scriptId}/${s.nid}: ${s.status}`);
    const choice = s.choiceConditions.findIndex(c => c.value === 'true');
    assert.equal(s.status === 'choices' && !s.hiddenChoice ? runner.choose(choice, s) : runner.advance(s), true);
  }
  assert.ok(predicate());
}

test('normal opening earns Abby and Chisa at authored triggers, announces each only after its final stage, and Confirm resumes the next task', async () => {
  const h = playthroughHarness(), presentations = new ReaderPresentations(h.runner), events: RunnerEvent[] = [];
  h.journey.setContinuationGate(presentations);
  h.runner.onEvent(e => events.push(e));
  try {
    assert.equal(await h.start(), true);
    assert.equal(h.runner.getSnapshot().scriptId, '1001');
    assert.equal(h.runner.getSnapshot().nid, 1);
    assert.equal(h.runner.getSnapshot().storyState.favor['12'].level, 1, '5912 remains an entry-stage state change');
    assert.equal(presentations.getSnapshot().relationships.length, 0);
    await h.until(() => h.runner.getSnapshot().scriptId === '1001' && h.runner.getSnapshot().nid === 22);
    assert.equal(presentations.getSnapshot().relationships.length, 0);
    await h.step(); await h.journey.flush();
    const abby = presentations.getSnapshot().relationships[0];
    assert.equal(abby.change.roleId, 12); assert.equal(abby.change.after, 1);
    assert.equal(h.runner.getSnapshot().scriptId, '1001'); assert.equal(h.runner.getSnapshot().status, 'completed');
    const abbyExit = events.findLast(e => e.type === 'stage' && e.scriptId === '1001' && e.nid === 22 && e.phase === 'end' && e.operation.op === 'exit');
    assert.ok(abbyExit && abby.completionSequence! > abbyExit.sequence);
    const state = h.runner.getSnapshot().storyState;
    presentations.dismissRelationship(abby.id); await h.journey.flush();
    assert.equal(h.runner.getSnapshot().scriptId, '1003'); assert.equal(h.runner.getSnapshot().nid, 1);
    assert.deepEqual(h.runner.getSnapshot().storyState.favor['12'], state.favor['12']);
    presentations.dismissRelationship(abby.id);
    await h.until(() => h.runner.getSnapshot().scriptId === '1004' && h.runner.getSnapshot().nid === 1);
    assert.equal(presentations.getSnapshot().relationships.length, 0);
    await h.step();
    assert.equal(h.runner.getSnapshot().storyState.favor['11'].level, 1, '5911 remains the hidden option-stage trigger');
    assert.equal(presentations.getSnapshot().relationships.length, 0);
    await h.until(() => h.runner.getSnapshot().scriptId === '1004' && h.runner.getSnapshot().nid === 27);
    assert.equal(presentations.getSnapshot().relationships.length, 0);
    await h.step(); await h.journey.flush();
    const chisa = presentations.getSnapshot().relationships[0];
    assert.equal(chisa.change.roleId, 11); assert.equal(chisa.change.after, 1);
    assert.equal(h.runner.getSnapshot().scriptId, '1004'); assert.equal(h.runner.getSnapshot().status, 'completed');
    const completion = events.findLast(e => e.type === 'completed' && e.scriptId === '1004');
    assert.equal(chisa.completionSequence, completion?.sequence);
    presentations.dismissRelationship(chisa.id); await h.journey.flush();
    assert.equal(presentations.getSnapshot().relationships.length, 0);
    assert.equal(h.journey.getSnapshot().dayIndex, 2); assert.equal(h.journey.getSnapshot().timeSlot, 1);
    assert.equal(h.journey.getSnapshot().phase, 'planning');
    assert.deepEqual(events.filter(e => e.type === 'storyMutation').flatMap(e => e.type === 'storyMutation' ? e.changes.filter(c => c.kind === 'favorLevel').map(c => c.roleId) : []), [12, 11]);
  } finally { h.dispose(); presentations.dispose(); }
});

test('tier confirmation waits for delayed final exit and reward; state changes still fire at their authored times', () => {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock }), presentations = new ReaderPresentations(runner, clock);
  try {
    runner.load(fixture([
      node(1, { stage: [action(5912), { op: 'enter', who: '1316', expr: 700212, t: 0 }] }),
      node(2, { stage: [action(103090, .25, 'end'), { op: 'exit', who: '1316', t: .75, phase: 'end' }] }),
    ]), manifest, { storySource: realSource, initializeStory: true }); runner.start();
    assert.equal(runner.getSnapshot().storyState.favor['12'].level, 1);
    assert.equal(presentations.getSnapshot().relationships.length, 0);
    runner.advance(); runner.advance();
    clock.advanceBy(250);
    assert.equal(runner.getSnapshot().storyState.items['49'].min, 1);
    assert.equal(presentations.getSnapshot().relationships.length, 0);
    clock.advanceBy(499);
    assert.equal(presentations.getSnapshot().relationships.length, 0);
    clock.advanceBy(1);
    assert.equal(runner.getSnapshot().status, 'completed');
    assert.equal(presentations.getSnapshot().relationships.length, 1);
    const notice = presentations.getSnapshot().relationships[0], state = runner.getSnapshot().storyState;
    const exit = runner.getSnapshot().events.findLast(e => e.type === 'stage' && e.operation.op === 'exit');
    assert.ok(exit && notice.completionSequence! > exit.sequence);
    presentations.dismissRelationship(notice.id); presentations.dismissRelationship(notice.id);
    assert.equal(presentations.getSnapshot().relationships.length, 0);
    assert.equal(runner.getSnapshot().storyState, state);
  } finally { presentations.dispose(); runner.dispose(); }
});

test('attaching to an existing tier and restoring a checkpoint cannot announce it as newly earned', () => {
  const runner = new ScriptRunner({ instantTransitions: true }), presentations = new ReaderPresentations(runner);
  let late: ReaderPresentations | null = null;
  try {
    runner.load(fixture([node(1, { stage: [action(5912)] })]), manifest, { storySource: realSource, initializeStory: true }); runner.start();
    assert.equal(runner.getSnapshot().storyState.favor['12'].level, 1);
    late = new ReaderPresentations(runner);
    assert.equal(late.getSnapshot().relationships.length, 0);
    const checkpoint = runner.createCheckpoint(); assert.ok(checkpoint);
    assert.equal(runner.restoreCheckpoint(checkpoint), true); runner.advance();
    assert.equal(presentations.getSnapshot().relationships.length, 0);
    assert.equal(late.getSnapshot().relationships.length, 0);
    assert.equal(runner.getSnapshot().storyState.favor['12'].level, 1);
    runner.restart(); runner.advance();
    assert.equal(presentations.getSnapshot().relationships.length, 1, 'replaying a fresh scene entry legitimately earns its reset tier once');
  } finally { late?.dispose(); presentations.dispose(); runner.dispose(); }
});

test('scene handoff clears actors and fading tracks while preserving inventory, favor, flags and intentional compositions within a scene', () => {
  const runner = new ScriptRunner({ instantTransitions: true });
  try {
    runner.load(fixture([
      node(1, { stage: [{ op: 'enter', who: '1316', expr: 700212, t: 0 }, action(5912)] }),
      node(2, { stage: [{ op: 'enter', who: '1398', expr: 700098, t: 0 }] }),
      node(3, { stage: [action(103090), action(20000207)] }),
    ]), manifest, { storySource: realSource, initializeStory: true }); runner.start();
    const abbyEntry = runner.getSnapshot().stageState.characters['1316'].entrySequence;
    runner.advance(); assert.deepEqual(portraits(runner), ['1316', '1398']);
    assert.equal(runner.getSnapshot().stageState.characters['1316'].entrySequence, abbyEntry);
    runner.advance(); runner.advance();
    const outgoing = runner.getSnapshot();
    assert.equal(outgoing.storyState.items['49'].min, 1);
    runner.load(realScript('1006'), realCatalog.manifest, { continuation: true, preserveStoryState: true, storySource: realSource });
    const ready = runner.getSnapshot();
    assert.equal(ready.runId, outgoing.runId); assert.notEqual(ready.sceneId, outgoing.sceneId);
    assert.equal(ready.storyState, outgoing.storyState);
    assert.deepEqual(ready.stageState.characters, {}); assert.deepEqual(ready.presentation.characters, []);
    runner.start(); assert.deepEqual(portraits(runner), []);
    advanceTo(runner, () => runner.getSnapshot().nid === 6);
    assert.deepEqual(portraits(runner), ['1398']);
    assert.equal(runner.getSnapshot().presentation.characters.some(v => v.character.who === '1316'), false);
    advanceTo(runner, () => runner.getSnapshot().status === 'completed');
    const streetState = runner.getSnapshot().storyState;
    runner.load(realScript('1008'), realCatalog.manifest, { continuation: true, preserveStoryState: true, storySource: realSource }); runner.start();
    advanceTo(runner, () => runner.getSnapshot().nid === 5);
    assert.deepEqual(portraits(runner), ['50074']);
    assert.deepEqual(runner.getSnapshot().storyState.items, streetState.items);
    assert.deepEqual(runner.getSnapshot().storyState.favor['12'], streetState.favor['12']);
    assert.equal(runner.getSnapshot().storyState.variables.key31, true);
    advanceTo(runner, () => runner.getSnapshot().nid === 54);
    assert.deepEqual(portraits(runner), ['150036', '50074']);
  } finally { runner.dispose(); }
});
