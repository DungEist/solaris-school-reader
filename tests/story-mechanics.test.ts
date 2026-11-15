import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  addExamScore, applyMechanicReward, behaviorAttributeDeltas, behaviorPreActions,
  behaviorSuccessRate, currentBehaviorRow, deterministicReaderDraw,
  effectiveAttributes, eventCheckSuccessRate, examBaseScore, nativeRound,
  radarProbability, rollBehavior, settleBehavior, settleEventCheck, settleExam, startExam,
} from '../src/engine/StoryMechanics.ts';
import { initialStoryState, validateStorySource } from '../src/engine/StoryState.ts';
import type { StorySource, StoryState } from '../src/engine/StoryState.ts';
import type { Metadata } from '../src/engine/types.ts';

const read = (path: string) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const source = validateStorySource(read('public/data/maps/story-source.json'));
const initial = () => initialStoryState(source);
const withState = (state: StoryState, patch: Partial<StoryState>): StoryState => Object.freeze({ ...state, ...patch });
const withAttributes = (values: readonly number[], fatigue = 0): StoryState => withState(initial(), {
  attributes: Object.freeze({ ...initial().attributes, ...Object.fromEntries(values.map((value, index) => [String(index + 1), value])), '7': fatigue }),
});
const withBuffs = (state: StoryState, ids: readonly number[]): StoryState => withState(state, {
  buffs: Object.freeze(Object.fromEntries(ids.map(id => [String(id), Object.freeze({ acquiredDay: state.dayIndex })]))),
});
function behavior(id: number, level = 1): Metadata {
  const row = Object.values(source.behaviors ?? {}).find(row => row.BehaviorId === id && row.Level === level);
  assert.ok(row, `Behavior ${id} level ${level} must exist in the game data.`);
  return row;
}
const eventSource: StorySource & { readonly eventProbabilities: Readonly<Record<string, Metadata>> } = {
  ...source,
  eventProbabilities: Object.freeze(Object.fromEntries(read('WutheringWaves_Data/BinData/SolarSchool/solarschooleventprobability.json').map((row: Metadata) => [String(row.Id), row]))),
};
const near = (actual: number | null, expected: number, tolerance = 1e-7) => {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) < tolerance, `${actual} should equal ${expected}.`);
};

test('behavior levels follow completed counts and highest eligible Level, preserving a tied source row', () => {
  const progressed = (count: number) => withState(initial(), { behaviors: { '5001': { count, successes: 0 } } });
  assert.equal(currentBehaviorRow(progressed(6), 5001, source)?.Id, 1);
  assert.equal(currentBehaviorRow(progressed(7), 5001, source)?.Id, 2);
  assert.equal(currentBehaviorRow(progressed(13), 5001, source)?.Id, 3);
  const altered: StorySource = { ...source, behaviors: {
    '1': { Id: 1, BehaviorId: 5001, Level: 4, RequireCount: 1 },
    '2': { Id: 2, BehaviorId: 5001, Level: 3, RequireCount: 7 },
    '3': { Id: 3, BehaviorId: 5001, Level: 4, RequireCount: 2 },
  } };
  assert.equal(currentBehaviorRow(progressed(7), 5001, altered)?.Id, 1);
});

test('real classroom checks respond to healthy, tired, and sick fatigue stages', () => {
  const row = behavior(5007);
  assert.equal(behaviorSuccessRate(withAttributes([20, 20, 20, 20, 20], 29), row, source).value, 1);
  assert.equal(behaviorSuccessRate(withAttributes([20, 20, 20, 20, 20], 30), row, source).value, .5);
  assert.equal(behaviorSuccessRate(withAttributes([20, 20, 20, 20, 20], 80), row, source).value, 0);
  const boosted = withBuffs(withAttributes([20, 20, 20, 20, 20], 30), [9002]);
  near(behaviorSuccessRate(boosted, row, source).value, .6);
  assert.equal(behaviorSuccessRate(boosted, behavior(5001), source).value, .5, 'Scoped probability bonus only affects its authored behaviors.');
});

test('a real behavior carries fatigue and its different result into the next check', () => {
  const row = behavior(5007), checkpoint = withAttributes([20, 20, 20, 20, 20], 30);
  const failed = rollBehavior(checkpoint, row, source, .55, 'classroom:1');
  const succeeded = rollBehavior(withBuffs(checkpoint, [9002]), row, source, .55, 'classroom:1');
  assert.equal(failed.state.behaviors['5007'].successes, 0);
  assert.equal(succeeded.state.behaviors['5007'].successes, 1);
  assert.equal(failed.state.attributes['2'], 21);
  assert.equal(succeeded.state.attributes['2'], 22);
  assert.equal(succeeded.state.attributes['7'], 55);
  near(behaviorSuccessRate(succeeded.state, row, source).value, .6);
  const second = rollBehavior(succeeded.state, row, source, .55, 'classroom:2');
  assert.equal(second.state.behaviors['5007'].count, 2);
  assert.equal(second.state.attributes['7'], 80);
  near(behaviorSuccessRate(second.state, row, source).value, .1);
  assert.equal(rollBehavior(second.state, row, source, .55, 'classroom:2').state, second.state);
});

test('real scoped attribute buffs add to behavior gains and fatigue reduction is flat', () => {
  const state = withBuffs(initial(), [9001, 9011]);
  assert.deepEqual(behaviorAttributeDeltas(state, behavior(5007), true, source).value, { '1': 3, '2': 4, '7': 20 });
  assert.deepEqual(behaviorAttributeDeltas(state, behavior(5007), false, source).value, { '1': 3, '2': 3, '7': 20 });
  assert.equal(effectiveAttributes(state, source).value?.['1'], 20, 'Scoped gains do not become global attributes.');
  const work = withBuffs(initial(), [9015, 9016, 9024]);
  assert.deepEqual(behaviorAttributeDeltas(work, behavior(5015), true, source).value, { '6': 100, '7': 20, '8': 3500 });
  assert.deepEqual(behaviorAttributeDeltas(work, behavior(5015), false, source).value, { '6': 100, '7': 20, '8': 3300 });
});

test('permanent item bonuses use acquired history even after inventory quantity becomes zero', () => {
  const state = withState(initial(), {
    acquiredItems: { '16': true, '17': true },
    items: { ...initial().items, '16': { min: 0, max: 0 }, '17': { min: 0, max: 0 } },
  });
  const values = effectiveAttributes(state, source);
  assert.deepEqual(values.unresolved, []);
  assert.equal(values.value?.['1'], 30);
  assert.equal(values.value?.['2'], 30);
  assert.equal(values.value?.['6'], 5000);
  const onlyQuantity = withState(initial(), { items: { ...initial().items, '17': { min: 1, max: 1 } } });
  assert.equal(effectiveAttributes(onlyQuantity, source).value?.['1'], 20);
});

test('global attribute buffs clamp derived values and expire after their configured day ends', () => {
  const finite: StorySource = { ...source,
    buffs: { ...source.buffs, '9900': { Id: 9900, DurationDays: 2, EffectIds: [990001] } },
    buffEffects: { ...source.buffEffects, '990001': { Id: 990001, Type: 1, Value: 20000, BehaviorId: [] } },
  };
  const acquired = withBuffs(initial(), [9900]);
  assert.equal(effectiveAttributes(acquired, finite).value?.['1'], 9999);
  assert.equal(effectiveAttributes(withState(acquired, { dayIndex: 2 }), finite).value?.['1'], 9999);
  assert.equal(effectiveAttributes(withState(acquired, { dayIndex: 3 }), finite).value?.['1'], 20);
  const unknown = effectiveAttributes(withBuffs(initial(), [999999]), source);
  assert.equal(unknown.value, null);
  assert.match(unknown.unresolved.join(' '), /999999/);
});

test('real pre-action lists choose exactly one entry and FirstAction fires at the row threshold', () => {
  const real = behavior(6001, 0);
  assert.deepEqual(behaviorPreActions(initial(), real, .1).value, [5003]);
  assert.deepEqual(behaviorPreActions(initial(), real, .99).value, [5004]);
  const tier = { ...real, FirstAction: 1086, RequireCount: 7 };
  const at = (count: number) => withState(initial(), { behaviors: { '6001': { count, successes: 0 } } });
  assert.deepEqual(behaviorPreActions(at(0), tier, .1).value, [5003]);
  assert.deepEqual(behaviorPreActions(at(7), tier, .1).value, [1086, 5003]);
  assert.deepEqual(behaviorPreActions(at(8), tier, .1).value, [5003]);
});

test('real request 1901 defers its final reward until FinishAction and confirmation complete', () => {
  const row = behavior(1901, 0);
  const accepted = withState(initial(), { behaviors: { '1901': { count: 5, successes: 5, state: 'Accepted' } } });
  const completed = settleBehavior(accepted, row, true, source, 'request:1901:6');
  assert.deepEqual(completed.unresolved, []);
  assert.equal(completed.state.behaviors['1901'].state, 'Finished');
  assert.equal(completed.state.attributes['1'], 23);
  assert.equal(completed.state.attributes['2'], 23);
  assert.equal(completed.state.attributes['6'], 100);
  assert.deepEqual(completed.completionSteps, [
    { kind: 'activityAction', actionId: 1086 },
    { kind: 'requestDone', behaviorId: 1901 },
    { kind: 'rewardGroup', rewardGroupId: 9001901 },
  ]);
  const claimed = applyMechanicReward(completed.state, 9001901, source, 0, 'request:1901:finishReward');
  assert.equal(claimed.state.attributes['1'], 29);
  assert.equal(claimed.state.attributes['2'], 29);
  assert.equal(claimed.state.attributes['6'], 700);
  assert.equal(applyMechanicReward(claimed.state, 9001901, source, 0, 'request:1901:finishReward').state, claimed.state);
  assert.equal(settleBehavior(completed.state, row, true, source, 'request:1901:6').state, completed.state);
});

test('reward bonus is flat for every attribute, favor, and item member, while buff grants stay unchanged', () => {
  const altered: StorySource = { ...source,
    rewardGroups: { ...source.rewardGroups, '9900': { Id: 9900, RewardIds: [99001, 99002, 99003, 99004] } },
    rewards: { ...source.rewards,
      '99001': { Id: 99001, RewardType: 0, TargetId: 1, Value: 1 },
      '99002': { Id: 99002, RewardType: 1, TargetId: 1, Value: 3 },
      '99003': { Id: 99003, RewardType: 2, TargetId: 26, Value: 2 },
      '99004': { Id: 99004, RewardType: 4, TargetId: 9001, Value: 1 },
    },
  };
  const state = withState(initial(), { favor: { ...initial().favor, '1': { unlocked: true, level: 1, points: 0 } } });
  const effect = applyMechanicReward(state, 9900, altered, 3, 'reward:9900');
  assert.deepEqual(effect.unresolved, []);
  assert.equal(effect.state.attributes['1'], 24);
  assert.equal(effect.state.favor['1'].points, 6);
  assert.deepEqual(effect.state.items['26'], { min: 5, max: 5 });
  assert.ok(effect.state.buffs['9001']);
  assert.equal(applyMechanicReward(effect.state, 9900, altered, 3, 'reward:9900').state, effect.state);
  assert.deepEqual(initial().items['26'], { min: 0, max: 0 }, 'A new playthrough has no reward inventory.');
});

test('special requests ignore Type10 reward bonuses that ordinary behaviors receive', () => {
  const boostedSource: StorySource = { ...source,
    buffs: { ...source.buffs, '9900': { Id: 9900, DurationDays: -1, EffectIds: [990001] } },
    buffEffects: { ...source.buffEffects, '990001': { Id: 990001, Type: 10, Value: 3, BehaviorId: [] } },
  };
  const state = withBuffs(initial(), [9900]);
  const special = settleBehavior(state, { ...behavior(1901, 0), RewardSuccess: 1001 }, true, boostedSource);
  assert.equal(special.state.attributes['1'], 24, 'Request gains 3 from its authored delta and 1 from its reward.');
  const ordinary = settleBehavior(state, { ...behavior(5007), RewardSuccess: 1001 }, true, boostedSource);
  assert.equal(ordinary.state.attributes['1'], 25, 'Ordinary behavior gains 1 from its delta and 4 from the bonus reward.');
});

test('direct reward group 20000224 stays distinct from the individual reward and action namespaces', () => {
  assert.deepEqual(source.actions['20000224'].ActionParams, [{ Key: 'SolarSchoolRewardId', Value: '20000229' }]);
  assert.equal(source.rewards['20000224'].TargetId, 12, 'Individual row belongs to favor role 12.');
  const effect = applyMechanicReward(initial(), 20000224, source, 0, 'directGroup:20000224');
  assert.deepEqual(effect.unresolved, []);
  assert.equal(effect.state.attributes['5'], 21);
  assert.equal(effect.state.favor['12'].points, 0);
  assert.equal(effect.changes[0].rewardId, 20000278);
  assert.equal(applyMechanicReward(effect.state, 20000224, source, 0, 'directGroup:20000224').state, effect.state);
});

test('real exams initialize from all weighted effective attributes before answer scores, with caps and replay protection', () => {
  const half = withAttributes([200, 200, 50, 50, 30]);
  assert.equal(examBaseScore(half, 1, source).value, 50);
  const started = startExam(half, 1, source, 'exam:1:start');
  const answered = addExamScore(started.state, 1, 3, source, 'quiz:1:correct');
  assert.equal(answered.state.exams['1'], 53);
  assert.equal(addExamScore(answered.state, 1, 3, source, 'quiz:1:correct').state, answered.state);
  assert.equal(startExam(answered.state, 1, source, 'exam:1:start').state, answered.state);
  assert.equal(addExamScore(answered.state, 1, 100, source).state.exams['1'], 100);
  assert.equal(addExamScore(answered.state, 1, -100, source).state.exams['1'], 0);
  assert.match(addExamScore(initial(), 1, 3, source).unresolved.join(' '), /initialized/);
  assert.deepEqual(initial().exams, {});
});

test('exam rounding follows native ties-to-even and disables malformed weighted maxima explicitly', () => {
  assert.deepEqual([.5, 1.5, 2.5, 3.5, -.5, -1.5, -2.5].map(nativeRound), [0, 2, 2, 4, 0, -2, -2]);
  const half = withAttributes([200, 200, 50, 50, 30]);
  assert.equal(examBaseScore(half, 1, { ...source, exams: { ...source.exams, '1': { ...source.exams!['1'], ScoreMax: 5 } } }).value, 2);
  assert.equal(examBaseScore(half, 1, { ...source, exams: { ...source.exams, '1': { ...source.exams!['1'], ScoreMax: 7 } } }).value, 4);
  const malformed = examBaseScore(half, 1, { ...source, exams: { ...source.exams, '1': { ...source.exams!['1'], AttrMax: [0, 400, 100, 100, 60] } } });
  assert.equal(malformed.value, 50);
  assert.match(malformed.unresolved.join(' '), /disabled/);
});

test('radar checks use triangle intersections when neighboring axes cross', () => {
  near(radarProbability([2, 1, 2, 1, 1], [1, 2, 1, 2, 1]).value, 2 / 3, 1e-12);
  near(radarProbability([50, 50, 50, 50, 50], [100, 100, 100, 100, 100]).value, .25, 1e-12);
  near(radarProbability([200, 200, 200, 200, 200], [100, 100, 100, 100, 100]).value, 1, 1e-12);
  assert.equal(radarProbability([20, 20, 20, 20, 20], [0, 0, 0, 0, 0]).value, 0);
  assert.equal(radarProbability([1, -1, 1], [1, 1, 1]).value, null);
});

test('event probability mapping uses authored inclusive minima and exclusive maxima without UI field bonuses', () => {
  const row = { ...source.eventCheckOptions!['1'], AttrRequire: [100, 100, 100, 100, 100], FocusAttr: [1], LowSuccessRate: 9999 };
  near(eventCheckSuccessRate(withAttributes([24, 100, 100, 100, 100]), row, eventSource).value, .696);
  assert.equal(eventCheckSuccessRate(withAttributes([25, 100, 100, 100, 100]), row, eventSource).value, .9);
  assert.equal(eventCheckSuccessRate(withAttributes([74, 100, 100, 100, 100]), row, eventSource).value, .9);
  assert.equal(eventCheckSuccessRate(withAttributes([75, 100, 100, 100, 100]), row, eventSource).value, 1);
  assert.equal(eventCheckSuccessRate(withAttributes([100, 100, 100, 100, 100]), row, eventSource).value, 1);
  assert.equal(eventCheckSuccessRate(withAttributes([1, 1, 1, 1, 1]), row, eventSource).value, .3);
  const missing = eventCheckSuccessRate(initial(), row, { ...source, eventProbabilities: undefined } as StorySource);
  assert.equal(missing.value, null);
  assert.match(missing.unresolved.join(' '), /mapping table/);
});

test('event settlement grants its real reward once before queueing selected actions in source order', () => {
  const row: Metadata = { ...source.eventCheckOptions!['1'], SuccessActionList: [10024, 3510], FailActionList: [10026] };
  const effect = settleEventCheck(initial(), row, true, source, 'event:1');
  assert.equal(effect.state.attributes['1'], 21);
  assert.equal(effect.state.variables.key31, false, 'Queued actions have not run yet.');
  assert.deepEqual(effect.commands, [{ kind: 'activityAction', actionId: 10024 }, { kind: 'activityAction', actionId: 3510 }]);
  assert.equal(effect.changes[0].labelKey, row.SuccessDescKey);
  assert.equal(settleEventCheck(effect.state, row, true, source, 'event:1').state, effect.state);
  const failed = settleEventCheck(initial(), row, false, source);
  assert.equal(failed.state.attributes['1'], 20);
  assert.deepEqual(failed.commands, [{ kind: 'activityAction', actionId: 10026 }]);
});

test('exam event option 4 adds score on success and replaces reward branches even on failure', () => {
  const examState = withState(withAttributes([30, 30, 200, 200, 30]), { instanceId: 5 });
  const started = startExam(examState, 2, source);
  assert.equal(started.state.exams['2'], 50);
  const row = { ...source.eventCheckOptions!['4'], RewardSuccess: 1001, RewardFail: 1001 };
  const succeeded = settleEventCheck(started.state, row, true, source, 'exam:2:event4');
  assert.equal(succeeded.state.exams['2'], 53);
  assert.equal(succeeded.state.attributes['1'], 30);
  const failed = settleEventCheck(started.state, row, false, source);
  assert.equal(failed.state.exams['2'], 50);
  assert.equal(failed.state.attributes['1'], 30);
  const ordinary = settleEventCheck(initial(), row, true, source);
  assert.equal(ordinary.state.attributes['1'], 21);
  assert.deepEqual(ordinary.state.exams, {});
});

test('Reader random draws are reproducible at a checkpoint and vary between distinct authored events', () => {
  const draw = deterministicReaderDraw('playthrough-1', 'behavior:5007:1');
  assert.ok(draw >= 0 && draw < 1);
  assert.equal(deterministicReaderDraw('playthrough-1', 'behavior:5007:1'), draw);
  assert.notEqual(deterministicReaderDraw('playthrough-1', 'behavior:5007:2'), draw);
  assert.notEqual(deterministicReaderDraw('playthrough-2', 'behavior:5007:1'), draw);
});

test('exam settlement uses real inclusive score bands and inclusive rank endpoints', () => {
  const cases = [[0, 700, 999], [50, 700, 999], [51, 300, 699], [70, 300, 699], [71, 100, 299], [80, 100, 299], [81, 20, 50], [90, 20, 50], [91, 2, 19], [98, 2, 19], [99, 1, 1], [100, 1, 1]];
  for (const [score, lower, upper] of cases) {
    const state = withState(initial(), { exams: { '1': score } });
    const minimum = settleExam(state, 1, source, `exam:1:finish:${score}`, 0);
    const maximum = settleExam(state, 1, source, `exam:1:finish:${score}`, .999999);
    assert.deepEqual(minimum.unresolved, [], `Score ${score}`);
    assert.deepEqual(minimum.state.examResults['1'], { examId: 1, score, rank: lower, read: false });
    assert.equal(maximum.state.examResults['1'].rank, upper, `Score ${score}`);
    assert.equal(minimum.state.latestExamIds['1'], 1);
    assert.deepEqual(minimum.changes, [{ kind: 'examResult', examId: 1, score, rank: lower }]);
    assert.equal(minimum.state.attributes, state.attributes, 'Exam rank itself has no authored attribute reward.');
    assert.equal(minimum.state.favor, state.favor, 'Exam rank itself has no authored relationship tier change.');
    assert.equal(minimum.state.items, state.items, 'Exam rank itself has no authored item reward.');
  }
});

test('later exams replace only the latest result of their own exam type and checkpoint replay cannot reroll rank', () => {
  const state = withState(initial(), { exams: { '1': 75, '2': 85, '3': 99 } });
  const academic = settleExam(state, 1, source, 'exam:1:finish', .5);
  const cultural = settleExam(academic.state, 2, source, 'exam:2:finish', .5);
  const later = settleExam(cultural.state, 3, source, 'exam:3:finish', .5);
  assert.deepEqual(later.state.latestExamIds, { '1': 3, '2': 2 });
  assert.equal(later.state.examResults['1'].rank, 200);
  assert.equal(later.state.examResults['2'].rank, 35);
  assert.equal(later.state.examResults['3'].rank, 1);
  const replayed = settleExam(later.state, 3, source, 'exam:3:finish', .99);
  assert.equal(replayed.state, later.state);
  assert.deepEqual(replayed.changes, []);
  assert.deepEqual(initial().examResults, {});
  assert.deepEqual(initial().latestExamIds, {});
});

test('exam rank selection keeps the first matching band and normalizes reversed rank endpoints', () => {
  const altered: StorySource = { ...source, examScoreRanks: {
    '1': { Id: 1, GroupId: 1, ScoreMin: 50, ScoreMax: 80, RankRandMin: 699, RankRandMax: 300 },
    '2': { Id: 2, GroupId: 1, ScoreMin: 60, ScoreMax: 90, RankRandMin: 1, RankRandMax: 1 },
  } };
  const state = withState(initial(), { exams: { '1': 75 } });
  assert.equal(settleExam(state, 1, altered, undefined, 0).state.examResults['1'].rank, 300);
  assert.equal(settleExam(state, 1, altered, undefined, .999999).state.examResults['1'].rank, 699);
  const missing = settleExam(state, 1, { ...source, examScoreRanks: {} }, 'missing');
  assert.match(missing.unresolved.join(' '), /authored score band/);
  const invalid = settleExam(state, 1, source, 'invalid-draw', 1);
  assert.match(invalid.unresolved.join(' '), /draw/);
  assert.equal(invalid.state, state);
});
