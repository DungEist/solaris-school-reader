import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyActivityAction, applyRewardGroup, combineConditions, emptyStorySource, evaluateCondition, evaluateConditionGroup, evaluateConditionLeaf, initialStoryState, readSystemOptionCondition, resolveHiddenBranch, validateStorySource } from '../src/engine/StoryState.ts';
import type { StorySource } from '../src/engine/StoryState.ts';
import type { Script, ScriptIndexEntry } from '../src/engine/types.ts';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import { ManualReader } from '../src/ui/ManualReader.ts';
import { DialogueBacklog } from '../src/ui/DialogueBacklog.ts';
import { interfaceHref, isDeveloperRoute } from '../src/ui/InterfaceRoute.ts';
import { FakeClock } from './FakeClock.ts';
import { fixture, manifest, node, option } from './fixtures.ts';

const read = (path: string) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const source = validateStorySource(read('public/data/maps/story-source.json'));
const condition = (id: number) => ({ Type: 'SystemCondition', System: { Type: 'SolarSchool', ConditionGroupId: id } });
const item10 = condition(26100048);
const hidden = (options = [option({ preCondition: item10 }), option()]) => node(2, { raw: { OptionInteractionType: 'HideAndAutoSelect' }, options });
const activity = (actionId: number, t = 0) => ({ op: 'activityAction', kind: 'SolarSchool', actionId, t });
const mutationEvents = (runner: ScriptRunner) => runner.getSnapshot().events.filter(e => e.type === 'storyMutation');

test('story export preserves raw source action, reward, item and hidden group identities', () => {
  const rawBase = 'WutheringWaves_Data/BinData/';
  for (const [table, path] of Object.entries({ actions: 'ActivityAction/activityaction.json', rewards: 'SolarSchool/solarschoolreward.json', rewardGroups: 'SolarSchool/solarschoolrewards.json', items: 'SolarSchool/solarschoolitem.json', groups: 'ActivityCondition/activityconditiongroup.json', conditions: 'ActivityCondition/activitycondition.json' })) {
    const raw = new Map(read(rawBase + path).map((r: { Id: number }) => [String(r.Id), r]));
    for (const [id, row] of Object.entries(source[table as keyof Pick<StorySource, 'actions' | 'rewards' | 'rewardGroups' | 'items' | 'groups' | 'conditions'>])) assert.deepEqual(row, raw.get(id));
  }
  assert.equal(source.actions['3510'].ActionType, 2);
  assert.equal(source.actions['4020'].ActionType, 28, 'popup is not a reward grant');
});

test('initial and missing state are unknown, including inventory and ending 4', () => {
  const state = initialStoryState();
  assert.equal(evaluateCondition(item10, state, source).value, 'unknown');
  assert.equal(evaluateCondition(condition(29000111), state, source).value, 'unknown');
  assert.equal(evaluateCondition(condition(123), state, source).value, 'unknown');
  assert.equal(evaluateCondition(null, state, source).value, 'unknown');
  assert.equal(evaluateCondition({ Type: 'Other' }, state, source).value, 'unknown');
});

test('authored playthrough initialization establishes exact empty inventory, false AVG/ending defaults, source attributes and locked roles', () => {
  const state = initialStoryState(source);
  assert.equal(state.initialized, true);
  assert.equal(evaluateCondition(item10, state, source).value, 'false');
  assert.equal(evaluateCondition(condition(29000111), state, source).value, 'false');
  assert.deepEqual(state.items['10'], { min: 0, max: 0 });
  assert.equal(state.variables.key31, false);
  assert.deepEqual(state.favor['11'], { unlocked: false, level: 0, points: 0 });
  for (const [id, row] of Object.entries(source.attrs!)) assert.equal(state.attributes[id], row.InitValue);
  assert.equal(state.dayIndex, 1); assert.equal(state.playthroughCount, 1);
  assert.equal(initialStoryState().initialized, false, 'an arbitrary scene import still has unavailable prior baselines');
});

test('all authored SolarSchool condition leaves and groups resolve against the known initial playthrough', () => {
  const state = initialStoryState(source);
  const leaves = Object.values(source.conditions).map(row => ({ id: row.Id, result: evaluateConditionLeaf(row, state, source) }));
  const groups = Object.values(source.groups).map(row => ({ id: row.Id, result: evaluateConditionGroup(Number(row.Id), state, source) }));
  assert.equal(leaves.length, 575); assert.equal(groups.length, 460);
  assert.deepEqual(leaves.filter(row => row.result.value === 'unknown'), []);
  assert.deepEqual(groups.filter(row => row.result.value === 'unknown'), []);
  assert.equal(leaves.filter(row => row.result.value === 'true').length, 88);
  assert.equal(groups.filter(row => row.result.value === 'true').length, 65);
});

test('all 76 authored outer option prerequisites resolve, including presentation metadata and native PreOption handling', () => {
  const fresh = initialStoryState(source), nextCycle = { ...fresh, playthroughCount: 2 };
  const prerequisites = (read('public/data/scripts.index.json') as ScriptIndexEntry[]).flatMap(entry => {
    const script = read(`public/data/scripts/${entry.id}.json`) as Script;
    return script.nodes.flatMap(n => (n.options ?? []).filter(o => o.preCondition !== undefined).map(o => ({ script: script.id, node: n.nid, option: o.optionId, condition: o.preCondition })));
  });
  assert.equal(prerequisites.length, 76);
  for (const row of prerequisites) {
    const key = `${row.script}/${row.node}/${row.option}`;
    for (const state of [fresh, nextCycle]) {
      const result = evaluateCondition(row.condition, state, source);
      assert.notEqual(result.value, 'unknown', `${key}: ${result.reasons.join(' ')}`);
      const system = readSystemOptionCondition(row.condition);
      if (system) assert.deepEqual(result, evaluateConditionGroup(system.groupId, state, source), key);
      else assert.equal(result.value, 'true', key);
    }
  }
  const gated = prerequisites.find(row => row.script === '3011' && row.node === 20 && row.option === 3)!;
  assert.equal(evaluateCondition(gated.condition, fresh, source).value, 'false');
  assert.equal(evaluateCondition(gated.condition, nextCycle, source).value, 'true');
});

test('known nullable choice presentation fields preserve eligibility and malformed or additional predicates remain explicit unknowns', () => {
  const state = initialStoryState(source), predicate = condition(29000036);
  assert.equal(evaluateCondition({ ...predicate, HideWhenUnmet: null, HideConditionTextWhenUnmet: false, TidReplaceTextWhenUnmet: null }, state, source).value, 'false');
  for (const extra of [{ HideWhenUnmet: 'true' }, { HideConditionTextWhenUnmet: 1 }, { TidReplaceTextWhenUnmet: false }, { OtherPredicate: true }]) {
    assert.equal(evaluateCondition({ ...predicate, ...extra }, state, source).value, 'unknown');
  }
  for (const value of [{ Type: 'PreOption', PreOptions: '1' }, { Type: 'PreOption', PreOptions: [1], OtherPredicate: true }]) {
    assert.equal(evaluateCondition(value, state, source).value, 'unknown');
  }
});

test('1006/12/option2 is selectable without a prior option1 record on the verified VisualNovel path', () => {
  const runner = new ScriptRunner({ instantTransitions: true });
  try {
    assert.equal(runner.load(read('public/data/scripts/1006.json'), read('public/data/manifest.json'), { storySource: source, initializeStory: true }), true);
    assert.equal(runner.start(), true);
    for (let steps = 0; runner.getSnapshot().nid !== 12 && steps < 30; steps++) assert.equal(runner.advance(), true);
    const before = runner.getSnapshot();
    assert.equal(before.nid, 12); assert.equal(before.status, 'choices');
    assert.equal(before.choiceHistory.length, 0);
    assert.equal(before.choiceConditions[0].value, 'true');
    assert.equal(before.choices[0].optionId, 2);
    assert.equal(runner.choose(0, before), true);
    assert.equal(runner.getSnapshot().nid, 13, 'this dialogue-only choice follows its authored sequence');
  } finally { runner.dispose(); }
});

test('source reward grant establishes bounded inventory; acquisition popup cannot grant it again', () => {
  const effect = applyActivityAction(initialStoryState(), 3510, source);
  assert.deepEqual(effect.state.items['10'], { min: 1, max: 1 });
  assert.equal(evaluateCondition(item10, effect.state, source).value, 'true');
  assert.equal(applyActivityAction(effect.state, 4011, source).state, effect.state);
  const repeated = applyActivityAction(effect.state, 3510, source);
  assert.deepEqual(repeated.state.items['10'], { min: 1, max: 1 });
  assert.equal(effect.changes[0].rewardId, 60010);
});

test('explicit AVG assignment preserves key; PlotOptionId is not used as a variable write', () => {
  const effect = applyActivityAction(initialStoryState(), 10024, source);
  assert.equal(effect.state.variables.key31, true);
  const avgSource: StorySource = { ...source, groups: { '1': { Id: 1, Logic: 0, GroupId: [2] } }, conditions: { '2': { Id: 2, Type: 15, Params: [{ Key: 'Key', Value: 'key31' }, { Key: 'Value', Value: 'true' }] } } };
  assert.equal(evaluateCondition(condition(1), initialStoryState(), avgSource).value, 'unknown');
  assert.equal(evaluateCondition(condition(1), effect.state, avgSource).value, 'true');
});

test('AND/OR keep unknown values and honor decisive operands without collapsing unknown to false', () => {
  const u = { value: 'unknown' as const, reasons: ['missing'] }, t = { value: 'true' as const, reasons: [] }, f = { value: 'false' as const, reasons: [] };
  assert.equal(combineConditions(0, [u, t]).value, 'unknown');
  assert.equal(combineConditions(0, [u, f]).value, 'false');
  assert.equal(combineConditions(1, [u, t]).value, 'true');
  assert.equal(combineConditions(1, [u, f]).value, 'unknown');
  assert.equal(combineConditions(9, [t]).value, 'unknown');
  assert.equal(combineConditions(0, []).value, 'unknown');
});

test('unknown condition types, malformed parameters and unsupported group semantics stay unknown', () => {
  const bad: StorySource = { ...source, groups: { '1': { Id: 1, GroupId: [2], Logic: 0 } }, conditions: { '2': { Id: 2, Type: 999, Params: [] } } };
  assert.equal(evaluateCondition(condition(1), initialStoryState(), bad).value, 'unknown');
  const extra = { ...source, conditions: { ...source.conditions, '16100048': { ...source.conditions['16100048'], Params: [{ Key: 'ItemId', Value: '10' }, { Key: 'Count', Value: '1' }, { Key: 'Unknown', Value: 'x' }] } } };
  assert.equal(evaluateCondition(item10, applyActivityAction(initialStoryState(), 3510, source).state, extra).value, 'unknown');
  assert.throws(() => validateStorySource({ ...source, groups: { '1': { Id: 2 } } }), /groups/);
});

test('authored hidden precedence selects the first eligible option while an earlier unknown blocks conservative traversal', () => {
  const opts = hidden().options!;
  assert.equal(resolveHiddenBranch(opts, initialStoryState(), source).optionIndex, null);
  const state = applyActivityAction(initialStoryState(), 3510, source).state;
  assert.equal(resolveHiddenBranch(opts, state, source).reason, 'determined');
  assert.equal(resolveHiddenBranch(opts, state, source).optionIndex, 0);
  assert.equal(resolveHiddenBranch([...opts].reverse(), state, source).optionIndex, 0, 'an authored unconditional first candidate outranks later true conditions');
  const absent = { ...initialStoryState(), items: { '10': { min: 0, max: 0 } } };
  assert.equal(resolveHiddenBranch(opts, absent, source).optionIndex, 1);
  assert.equal(resolveHiddenBranch([...opts].reverse(), absent, source).optionIndex, 0);
});

test('multiple matching options use authored order and a later unknown cannot outrank an earlier true candidate', () => {
  const state = applyActivityAction(initialStoryState(), 3510, source).state;
  assert.equal(resolveHiddenBranch([option({ preCondition: item10 }), option({ preCondition: item10 })], state, source).optionIndex, 0);
  assert.equal(resolveHiddenBranch([option({ preCondition: item10 }), option({ preCondition: condition(123) })], state, source).optionIndex, 0);
  assert.equal(resolveHiddenBranch([option({ preCondition: condition(123) }), option({ preCondition: item10 })], state, source).optionIndex, null);
  assert.equal(resolveHiddenBranch([option({ preCondition: item10 })], state, source).optionIndex, 0);
  assert.equal(resolveHiddenBranch([], state, source).reason, 'no-match');
});

test('prior choice effects apply at scheduled selection performances once; reveal does not mutate or navigate', () => {
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock });
  const reading = new ManualReader(runner, { clock, inputDebounceMs: 0 });
  const backlog = new DialogueBacklog(runner);
  reading.setTextContext({ 'line-1': 'Choose.', 'line-2': 'Hidden dialogue.', choice: 'Grant' }, { playerName: 'Sol', gender: 'male' });
  backlog.setTextContext({ 'line-1': 'Choose.', 'line-2': 'Hidden dialogue.', choice: '' }, {}, { playerName: 'Sol', gender: 'male' });
  runner.load(fixture([node(1, { options: [option({ optionId: 31, performances: [activity(3510, .2)] })] }), hidden([option({ preCondition: item10, performances: [activity(10024, .1)], next: { type: 'end' } })])]), manifest, { storySource: source });
  runner.start();
  assert.equal(reading.advance(), 'revealed');
  assert.equal(mutationEvents(runner).length, 0);
  const token = runner.getSnapshot();
  assert.equal(reading.choose(0, token), true);
  assert.equal(reading.choose(0, token), false);
  assert.equal(runner.getSnapshot().storyState.variables.key31, undefined);
  assert.equal(runner.getSnapshot().storyState.choices['fixture:31'], true, 'selection is retained separately from AVG variables');
  assert.equal(mutationEvents(runner).length, 0);
  clock.advanceBy(200);
  assert.equal(mutationEvents(runner).length, 1);
  assert.equal(runner.getSnapshot().nid, 2);
  assert.equal(runner.getSnapshot().branchResolution?.optionIndex, 0);
  assert.equal(reading.advance(), 'revealed');
  assert.equal(mutationEvents(runner).length, 1);
  const branchToken = runner.getSnapshot();
  assert.equal(reading.advance(branchToken), 'advanced');
  assert.equal(reading.advance(branchToken), 'ignored');
  clock.advanceBy(100);
  assert.equal(mutationEvents(runner).length, 2);
  assert.equal(runner.getSnapshot().choiceHistory[1].decision, 'automatic');
  assert.equal(runner.getSnapshot().choiceHistory[1].debugOverride, false);
  assert.equal(backlog.getSnapshot().filter(e => e.kind === 'choice').length, 1, 'automatic empty hidden text is never a player response');
  backlog.dispose(); reading.dispose(); runner.dispose();
});

test('restart rolls back script consequences, preserve-story load keeps earlier facts, fresh load and reset forget them', () => {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock });
  const first = fixture([node(1, { options: [option({ performances: [activity(3510, .2)], next: { type: 'end' } })] })]);
  runner.load(first, manifest, { storySource: source }); runner.start(); runner.choose(0);
  const old = [...clock.callbacks];
  runner.restart(); old.forEach(callback => callback()); clock.advanceBy(300);
  assert.equal(runner.getSnapshot().storyState.items['10'], undefined);
  assert.equal(mutationEvents(runner).length, 0);
  runner.choose(0); clock.advanceBy(200);
  assert.equal(mutationEvents(runner).length, 1);
  runner.load(fixture([hidden()]), manifest, { preserveStoryState: true }); runner.start();
  assert.equal(runner.getSnapshot().storyState.items['10'].min, 1);
  runner.overrideHiddenChoice(0);
  assert.equal(runner.getSnapshot().choiceHistory[0].decision, 'debug-override');
  runner.restart();
  assert.equal(runner.getSnapshot().storyState.items['10'].min, 1, 'entry checkpoint includes earlier script facts');
  runner.resetStory();
  assert.equal(runner.getSnapshot().storyState.items['10'], undefined);
  runner.load(first, manifest); runner.start();
  assert.equal(runner.getSnapshot().storyState.items['10'], undefined);
  runner.dispose();
});

test('all 11 hidden nodes retain unknown imports, resolve authored fresh-state fallbacks, and use acquired item 10 at 1004/1', () => {
  const index = read('public/data/scripts.index.json');
  let count = 0;
  for (const entry of index) for (const n of read(`public/data/scripts/${entry.id}.json`).nodes) {
    if (n.raw?.OptionInteractionType !== 'HideAndAutoSelect') continue;
    count++;
    const decision = resolveHiddenBranch(n.options, initialStoryState(), source);
    assert.equal(decision.optionIndex, null, `${entry.id}/${n.nid}`);
    assert.deepEqual(decision.conditions.map(c => c.value), ['unknown', 'true']);
    const freshDecision = resolveHiddenBranch(n.options, initialStoryState(source), source);
    assert.equal(freshDecision.optionIndex, 1, `${entry.id}/${n.nid}: known fresh fallback`);
    assert.deepEqual(freshDecision.conditions.map(c => c.value), ['false', 'true']);
  }
  assert.equal(count, 11);
  const runner = new ScriptRunner({ instantTransitions: true });
  runner.load(read('public/data/scripts/4015.json'), manifest, { storySource: source }); runner.start();
  while (runner.getSnapshot().status === 'dialogue') runner.advance();
  assert.deepEqual(runner.getSnapshot().storyState.items['10'], { min: 1, max: 1 });
  runner.load(read('public/data/scripts/1004.json'), manifest, { preserveStoryState: true }); runner.start();
  assert.equal(runner.getSnapshot().branchResolution?.reason, 'determined');
  assert.equal(runner.getSnapshot().branchResolution?.optionIndex, 0);
  assert.equal(runner.advance(), true);
  assert.equal(runner.getSnapshot().choiceHistory[0].decision, 'automatic');
  assert.deepEqual(runner.getSnapshot().stageEvents.filter(e => e.phase === 'option').map(e => e.operation.actionId), [5911, 5913, 5911, 5914, 5911]);
  assert.equal(runner.getSnapshot().nid, 2);
  runner.dispose();
});

test('real 17048 optionId 5 FinishTalk records once without node 3 or inferred story flags', () => {
  const runner = new ScriptRunner({ instantTransitions: true });
  runner.load(read('public/data/scripts/17048.json'), manifest, { storySource: source }); runner.start();
  while (runner.getSnapshot().status === 'dialogue') runner.advance();
  const token = runner.getSnapshot();
  assert.equal(token.nid, 2);
  const index = token.choices.findIndex(o => o.optionId === 5);
  assert.equal(runner.choose(index, token), true);
  assert.equal(runner.choose(index, token), false);
  assert.equal(runner.getSnapshot().status, 'completed');
  assert.ok(!runner.getSnapshot().navigationHistory.some(e => e.to === 3));
  assert.equal(mutationEvents(runner).length, 0);
  const state = runner.getSnapshot().storyState;
  assert.deepEqual(state.variables, {}, 'read history does not create AVG flags');
  assert.deepEqual(state.choices, { '17048:5': true });
  assert.deepEqual(state.plotKeys, { '17048:1': true });
  assert.deepEqual(state.flowReads, { '17048': 1 });
  runner.dispose();
});

test('real 4003 item grant waits for node 5 end performance; text reveal and restart cannot grant it', () => {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock, instantTransitions: true });
  const reading = new ManualReader(runner, { clock, inputDebounceMs: 0 });
  const english = read('public/data/locales/en.json');
  reading.setTextContext(english, { playerName: 'Sol', gender: 'male' });
  runner.load(read('public/data/scripts/4003.json'), manifest, { storySource: source }); runner.start();
  while (runner.getSnapshot().nid !== 5 && runner.getSnapshot().status === 'dialogue') runner.advance();
  assert.equal(runner.getSnapshot().nid, 5);
  assert.equal(runner.getSnapshot().storyState.items['1'], undefined);
  assert.equal(reading.advance(), 'revealed');
  assert.equal(runner.getSnapshot().storyState.items['1'], undefined);
  const token = runner.getSnapshot();
  assert.equal(reading.advance(token), 'advanced');
  assert.equal(reading.advance(token), 'ignored');
  assert.deepEqual(runner.getSnapshot().storyState.items['1'], { min: 1, max: 1 });
  assert.equal(mutationEvents(runner).filter(e => e.actionId === 3501).length, 1);
  runner.restart();
  assert.equal(runner.getSnapshot().storyState.items['1'], undefined);
  reading.dispose(); runner.dispose();
});

test('numeric ActivityAction/flow ID collisions never invoke another script', () => {
  assert.ok(Object.values(source.actions).some(a => a.ActionType === 1), 'the complete source export includes explicit flow dispatchers');
  assert.equal(source.actions['5913'].ActionType, 2);
  assert.deepEqual(applyActivityAction(initialStoryState(), 5913, source).commands, [], 'a reward action cannot become a call to a numerically equal flow');
  const runner = new ScriptRunner({ instantTransitions: true });
  runner.load(fixture([node(1, { stage: [activity(5913)] })]), manifest, { storySource: source }); runner.start(); runner.advance();
  assert.equal(runner.getSnapshot().scriptId, 'fixture');
  assert.equal(runner.getSnapshot().status, 'completed');
  assert.equal(runner.getSnapshot().storyState.items['10'], undefined);
  runner.dispose();
});

test('1011 option action 20000224 resolves its parameter group to Chisa +5 rather than either overlapping numeric reward row', () => {
  assert.equal(source.actions['20000224'].ActionParams instanceof Array, true);
  assert.deepEqual(source.rewardGroups['20000229'].RewardIds, [20000282]);
  assert.deepEqual(source.rewards['20000282'], { Id: 20000282, RewardType: 1, TargetId: 11, Value: 5 });
  const fresh = initialStoryState(source);
  const locked = applyActivityAction(fresh, 20000224, source);
  assert.equal(locked.state, fresh); assert.equal(locked.changes.length, 0);
  assert.ok(locked.blocked?.some(reason => reason.includes('Role 11')));
  const introduction = applyActivityAction(fresh, 5911, source);
  assert.equal(source.actions['5911'].ActionType, 9);
  assert.deepEqual(introduction.state.favor['11'], { unlocked: true, level: 1, points: 0 });
  const effect = applyActivityAction(introduction.state, 20000224, source, '1011:10:start:20000224');
  assert.deepEqual(effect.state.favor['11'], { unlocked: true, level: 1, points: 5 });
  assert.deepEqual(effect.state.favor['12'], introduction.state.favor['12'], 'individual reward 20000224 would target Abby, and is not selected');
  assert.deepEqual(effect.state.attributes, introduction.state.attributes, 'group 20000224 and individual reward 20000229 are not selected');
  assert.deepEqual(effect.changes.map(change => [change.kind, change.roleId, change.value, change.rewardGroupId, change.rewardId]), [['favor', 11, 5, 20000229, 20000282]]);
  const duplicate = applyActivityAction(effect.state, 20000224, source, '1011:10:start:20000224');
  assert.equal(duplicate.state, effect.state); assert.equal(duplicate.changes.length, 0);
  const differentlyNamedGroup = applyRewardGroup(introduction.state, 20000224, source);
  assert.equal(differentlyNamedGroup.state.attributes['5'], introduction.state.attributes['5'] + 1);
  assert.equal(differentlyNamedGroup.state.favor['11'].points, 0);
  const rewardGroups = { ...source.rewardGroups }; delete rewardGroups['20000229'];
  const missing = applyActivityAction(introduction.state, 20000224, { ...source, rewardGroups });
  assert.equal(missing.state, introduction.state); assert.equal(missing.changes.length, 0);
  assert.ok(missing.unresolved.some(reason => reason.includes('20000229')));
});

test('a locked role rejects the entire mixed source reward group before any attribute member is granted', () => {
  const fresh = initialStoryState(source);
  assert.deepEqual(source.rewardGroups['111'].RewardIds, [111, 122]);
  assert.equal(source.rewards['111'].RewardType, 1); assert.equal(source.rewards['122'].RewardType, 0);
  const blocked = applyRewardGroup(fresh, 111, source);
  assert.equal(blocked.state, fresh); assert.equal(blocked.changes.length, 0);
  assert.equal(blocked.state.attributes['1'], 20);
  const unlocked = applyActivityAction(fresh, 5911, source).state;
  const granted = applyRewardGroup(unlocked, 111, source);
  assert.equal(granted.state.favor['11'].points, 20);
  assert.equal(granted.state.attributes['1'], 21);
});

test('favor gains cap at the next threshold without an automatic tier; only explicit level-up resets points and grants its tier reward', () => {
  const introduced = applyActivityAction(initialStoryState(source), 5911, source).state;
  const full = applyActivityAction(introduced, 5913, source);
  assert.deepEqual(full.state.favor['11'], { unlocked: true, level: 1, points: 30 });
  assert.ok(!full.changes.some(change => change.kind === 'favorLevel'));
  const capped = applyActivityAction(full.state, 20000224, source);
  assert.equal(capped.state, full.state); assert.equal(capped.changes.length, 0);
  const upgraded = applyActivityAction(full.state, 5911, source);
  assert.deepEqual(upgraded.state.favor['11'], { unlocked: true, level: 2, points: 0 });
  assert.deepEqual(upgraded.changes.filter(change => change.kind === 'favorLevel').map(change => [change.before, change.after]), [[1, 2]]);
  assert.equal(upgraded.state.buffs['9016'].acquiredDay, 1, 'source tier 2 unlock group 41102 grants its authored buff');
  assert.ok(upgraded.changes.some(change => change.rewardGroupId === 41102 && change.kind === 'buff'));
  const nextFull = applyActivityAction(upgraded.state, 5914, source);
  assert.deepEqual(nextFull.state.favor['11'], { unlocked: true, level: 2, points: 50 });
  assert.deepEqual(applyActivityAction(nextFull.state, 5911, source).state.favor['11'], { unlocked: true, level: 3, points: 0 });
});

test('interface routes preserve query links and do not infer neighboring script IDs', () => {
  assert.equal(isDeveloperRoute('/debug'), true);
  assert.equal(isDeveloperRoute('/'), false);
  assert.equal(interfaceHref(true, '?script=x1&test=hello', '17048'), '/debug?script=17048&test=hello');
  assert.equal(interfaceHref(false, '?script=x1', null), '/?script=x1');
  assert.equal(resolveHiddenBranch([option({ preCondition: condition(1) })], initialStoryState(), emptyStorySource).optionIndex, null);
});
