import assert from 'node:assert/strict';
import test from 'node:test';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import type { ScriptOption, StageOp } from '../src/engine/types.ts';
import { FakeClock } from './FakeClock.ts';
import { fixture, manifest, node, option } from './fixtures.ts';

const condition = { Type: 'SystemCondition', System: { Type: 'SolarSchool', ConditionGroupId: 26100048 } };
const rawPerformances = [
  { Type: 'ActivityAction', StartTime: .1, ActivityActionConfig: { Type: 'SolarSchool', SolarSchoolActionId: 5911 } },
  { Type: 'ActivityAction', StartTime: .1, ActivityActionConfig: { Type: 'SolarSchool', SolarSchoolActionId: 5913 } },
  { Type: 'ActivityAction', StartTime: .2, ActivityActionConfig: { Type: 'SolarSchool', SolarSchoolActionId: 5911 } },
];
const performances: StageOp[] = rawPerformances.map(source => ({ op: 'activityAction', t: source.StartTime, phase: 'option', kind: 'SolarSchool', actionId: source.ActivityActionConfig.SolarSchoolActionId, raw: source }));
const hiddenOption = (overrides: Partial<ScriptOption> = {}) => option({ preCondition: condition, typeParams: { Type: 'VisualNovel', OptionPerformances: rawPerformances }, performances, raw: { PreCondition: condition, TypeParams: { OptionPerformances: rawPerformances } }, ...overrides });

test('HideAndAutoSelect waits for an explicit debug override and never chooses an unconditional fallback', () => {
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock });
  runner.load(fixture([node(1, { raw: { OptionInteractionType: 'HideAndAutoSelect' }, options: [hiddenOption({ optionId: 11 }), option({ optionId: 12 })] }), node(2)]), manifest);
  runner.start();
  clock.advanceBy(10_000);
  assert.equal(runner.getSnapshot().nid, 1);
  assert.equal(runner.getSnapshot().hiddenChoice, true);
  assert.equal(runner.getSnapshot().choiceHistory.length, 0);
  assert.equal(runner.choose(0), false);
  assert.equal(runner.choose(1), false);
  assert.equal(runner.advance(), false);
  assert.equal(runner.overrideHiddenChoice(1), true);
  assert.equal(runner.getSnapshot().nid, 2);
  assert.equal(runner.getSnapshot().choiceHistory[0].debugOverride, true);
  assert.equal(runner.getSnapshot().choiceHistory[0].optionId, 12);
  assert.ok(!runner.getSnapshot().stageEvents.some(event => event.source === 'option'), 'Unselected branch performances must never execute');
  assert.ok(runner.getSnapshot().events.some(event => event.type === 'debug' && event.code === 'hidden-auto-selection-unresolved'));
  runner.dispose();
});

test('selected option performances use their own clock and preserve equal-time order, raw metadata and repeated activity IDs', () => {
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock });
  runner.load(fixture([node(2, {
    raw: { OptionInteractionType: 'HideAndAutoSelect' },
    stage: [{ op: 'bg', id: 10, mode: 'Load', t: 0 }, { op: 'bg', id: 11, mode: 'Load', t: .1, phase: 'end' }],
    options: [hiddenOption({ optionId: 11, next: { type: 'end' } })],
  }), node(3), node(90)], [{ op: 'talk', nids: [2, 3] }, { op: 'configure', config: { initialBackground: 20 } }, { op: 'talk', nids: [90] }]), manifest);
  runner.start();
  clock.advanceBy(1000);
  assert.equal(runner.overrideHiddenChoice(0), true);
  assert.equal(runner.getSnapshot().stagePhase, 'option');
  assert.equal(runner.getSnapshot().nid, 2);
  assert.equal(runner.getSnapshot().choiceHistory.length, 1);
  assert.deepEqual(runner.getSnapshot().choiceHistory[0].preCondition, condition);
  assert.ok(Object.isFrozen(runner.getSnapshot().choiceHistory[0].typeParams));
  assert.equal(runner.overrideHiddenChoice(0), false);
  clock.advanceBy(99);
  assert.equal(runner.getSnapshot().stageEvents.filter(event => event.source === 'option').length, 0);
  clock.advanceBy(1);
  const first = runner.getSnapshot().stageEvents.filter(event => event.source === 'option');
  assert.deepEqual(first.map(event => [event.operation.actionId, event.timing?.sourceOrder, event.timing?.appliedAtMs]), [[5911, 0, 1100], [5913, 1, 1100]]);
  assert.ok(first.every(event => event.phase === 'option' && event.optionIndex === 0 && event.disposition === 'metadata'));
  assert.deepEqual(first[0].operation.raw, rawPerformances[0]);
  clock.advanceBy(100);
  assert.equal(runner.getSnapshot().stagePhase, 'end');
  assert.equal(runner.getSnapshot().stageState.background?.id, 10);
  clock.advanceBy(100);
  const done = runner.getSnapshot();
  assert.equal(done.nid, 90);
  assert.equal(done.stageState.background?.id, 20);
  assert.ok(!done.events.some(event => event.type === 'dialogue' && event.node.nid === 3));
  assert.deepEqual(done.stageEvents.filter(event => event.phase === 'option').map(event => event.operation.actionId), [5911, 5913, 5911]);
  assert.equal('avgVars' in done, false);
  assert.equal(done.events.filter(event => event.type === 'flow').length, 3, 'ActivityAction never dispatches nested game flows');
  runner.dispose();
});

test('ordinary choices retain readable selection and FinishTalk waits for option/end performances before later talks', () => {
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock });
  // Ordinary timing is isolated with a genuinely unconditional option. Source
  // condition enforcement and explicit Developer traversal have separate tests.
  const ordinary = option({ next: { type: 'end' }, optionId: 5, typeParams: { Type: 'VisualNovel', OptionPerformances: rawPerformances }, performances });
  runner.load(fixture([node(2, { options: [ordinary], stage: [{ op: 'audio', cue: 'muted', t: .1, phase: 'end' }] }), node(3), node(90)], [{ op: 'talk', nids: [2, 3] }, { op: 'talk', nids: [90] }]), manifest);
  runner.start();
  assert.equal(runner.getSnapshot().hiddenChoice, false);
  assert.equal(runner.overrideHiddenChoice(0), false);
  assert.equal(runner.choose(0), true);
  clock.advanceBy(199);
  assert.equal(runner.getSnapshot().nid, 2);
  clock.advanceBy(101);
  assert.equal(runner.getSnapshot().nid, 90);
  assert.equal(runner.getSnapshot().choiceHistory[0].debugOverride, false);
  assert.equal(runner.getSnapshot().choiceHistory[0].optionId, 5);
  assert.ok(!runner.getSnapshot().navigationHistory.some(entry => entry.to === 3));
  runner.dispose();
});

test('instant toggle and restart/script switch cancel option callbacks without replaying selection or metadata', () => {
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock });
  const script = fixture([node(1, { raw: { OptionInteractionType: 'HideAndAutoSelect' }, options: [hiddenOption()] }), node(2)]);
  runner.load(script, manifest); runner.start(); runner.overrideHiddenChoice(0);
  const callbacks = [...clock.callbacks];
  runner.setInstantTransitions(true);
  assert.equal(runner.getSnapshot().nid, 2);
  assert.equal(runner.getSnapshot().choiceHistory.length, 1);
  assert.equal(runner.getSnapshot().stageEvents.filter(event => event.source === 'option').length, 3);
  callbacks.forEach(callback => callback());
  assert.equal(runner.getSnapshot().stageEvents.filter(event => event.source === 'option').length, 3);
  runner.setInstantTransitions(false);
  runner.restart(); runner.overrideHiddenChoice(0);
  const oldOptionCallbacks = [...clock.callbacks];
  runner.restart();
  const restarted = runner.getSnapshot();
  oldOptionCallbacks.forEach(callback => callback());
  assert.equal(runner.getSnapshot(), restarted);
  assert.equal(restarted.choiceHistory.length, 0);
  assert.equal(restarted.stageEvents.length, 0);
  runner.load({ ...fixture([node(99)]), id: 'x2' }, manifest); runner.start();
  clock.advanceBy(10_000);
  assert.equal(runner.getSnapshot().scriptId, 'x2');
  assert.equal(runner.getSnapshot().stageEvents.length, 0);
  runner.dispose();
});

test('malformed option performances retain option/node/field context instead of dropping effects', () => {
  for (const malformed of [undefined, [], performances.slice(0, 2), [{ op: 'activityAction', t: -1, phase: 'option' }], [{ op: 'activityAction', t: 0, phase: 'start' }]]) {
    const runner = new ScriptRunner({ clock: new FakeClock() });
    runner.load(fixture([node(7, { options: [hiddenOption({ performances: malformed as ScriptOption['performances'] })] })]), manifest);
    const error = runner.getSnapshot().error!;
    assert.equal(error.nid, 7);
    assert.equal(error.optionIndex, 0);
    assert.ok(error.path?.includes('.options[0].performances'));
  }
});

test('partially rebuilt option metadata is rejected with the missing field in context', () => {
  for (const field of ['preCondition', 'typeParams'] as const) {
    const choice = { ...hiddenOption() };
    delete choice[field];
    const runner = new ScriptRunner({ clock: new FakeClock() });
    assert.equal(runner.load(fixture([node(7, { options: [choice] })]), manifest), false);
    const error = runner.getSnapshot().error!;
    assert.equal(error.nid, 7);
    assert.equal(error.optionIndex, 0);
    assert.ok(error.path?.endsWith(`.options[0].${field}`));
    assert.match(error.message, /rebuild schema 2 data/);
    runner.dispose();
  }
});
