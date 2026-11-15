import assert from 'node:assert/strict';
import test from 'node:test';
import { StoryPlaythrough } from '../src/engine/Playthrough.ts';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import { applyActivityAction, emptyStorySource, evaluateConditionLeaf, evaluateLocationUnlock, inheritSpecialItems, initialStoryState } from '../src/engine/StoryState.ts';
import type { StorySource, StoryState } from '../src/engine/StoryState.ts';
import { behaviorFatigueAvailability } from '../src/engine/StoryMechanics.ts';
import { completeQuestNode, defaultScheduledBehavior, eligibleQuestNodes, refreshStoryProgress, settleWeeklyRewards } from '../src/engine/StoryProgress.ts';
import type { EnglishCatalog } from '../src/data/EnglishScriptRepository.ts';
import type { Metadata } from '../src/engine/types.ts';
import { fixture, manifest, node } from './fixtures.ts';

const table = (rows: Metadata[]) => Object.fromEntries(rows.map(row => [String(row.Id), row]));
const params = (values: Record<string, string>) => Object.entries(values).map(([Key, Value]) => ({ Key, Value }));
const action = (Id: number, ActionType: number, values: Record<string, string>) => ({ Id, ActionType, ActionParams: params(values) });
const attrReward = (Id: number, TargetId: number, Value: number) => ({ Id, RewardType: 0, TargetId, Value });
const calendar = (Id: number, DayIndex: number, InstanceId = 1) => ({ Id, DayIndex, InstanceId, ConditionGroupId: 0, DawnActions: [], DayActions: [], NoonActions: [], DuskActions: [], NightActions: [], HasDayAction: true, HasDuskAction: false });
const behavior = (Id: number, BehaviorId = Id) => ({ Id, BehaviorId, Level: 1, RequireCount: 0, BehaviorType: 3, Name: 'class', ShowConditionGroupId: 0, ExecuteConditionGroupId: 0, AvailableTimeSlot: [2], AttrLower: [], AttrUpper: [], AttrWeight: [], SucAttrChange: [], FailAttrChange: [], RewardSuccess: 0, RewardFail: 0, FirstAction: 0, PreActionList: [] });
const base = (): StorySource => ({
  ...emptyStorySource, activity: { Id: 111700001 },
  attrs: table(Array.from({ length: 8 }, (_, i) => ({ Id: i + 1, InitValue: i < 5 ? 20 : 0, MinValue: i < 5 ? 1 : 0, MaxValue: i === 6 ? 100 : 9999 }))),
  roles: {}, params: table([{ Id: 1, Key: 'TotalDays', IntValue: 10 }, { Id: 2, Key: 'TiredThreshold', IntValue: 60 }, { Id: 3, Key: 'SickThreshold', IntValue: 90 }]),
  calendar: table([calendar(1, 1), calendar(2, 2)]), instances: { '1': { Id: 1, InstanceType: 0 } },
  locations: {}, requests: {}, questNodes: {}, questRewards: {}, behaviors: {}, spans: {}, buffs: {}, buffEffects: {},
});
function controller(source: StorySource) {
  const runner = new ScriptRunner({ instantTransitions: true }), journey = new StoryPlaythrough(runner, async id => ({ ...fixture([node(1)]), id }));
  const catalog: EnglishCatalog = { manifest, index: [], english: {}, speakers: {}, report: {}, storySource: source };
  return { runner, journey, start: () => journey.start(catalog), dispose: () => { journey.dispose(); runner.dispose(); } };
}

test('quest descendants keep their first constructed owner and require a completed local predecessor', () => {
  const source: StorySource = { ...base(),
    requests: table([
      { Id: 1, StartDayIndex: 1, EndDayIndex: 1, PreConditionGroupId: 0, QuestNodeList: [101], QuestRewardList: [], TargetProgress: 0 },
      { Id: 2, StartDayIndex: 2, EndDayIndex: 2, PreConditionGroupId: 0, QuestNodeList: [102, 201, 301], QuestRewardList: [], TargetProgress: 0 },
    ]),
    questNodes: table([
      { Id: 101, PreNodeId: 0, TriggerTiming: 0, Priority: 0 },
      { Id: 102, PreNodeId: 101, TriggerTiming: 0, Priority: 0 },
      { Id: 103, PreNodeId: 102, TriggerTiming: 0, Priority: 0 },
      { Id: 201, PreNodeId: 101, TriggerTiming: 0, Priority: 0 },
      { Id: 301, PreNodeId: 999, TriggerTiming: 0, Priority: 0 },
      { Id: 999, PreNodeId: 0, TriggerTiming: 0, Priority: 0 },
    ]),
  };
  let state = refreshStoryProgress(initialStoryState(source), source).state;
  assert.deepEqual(eligibleQuestNodes(state, source).nodes.map(n => n.Id), [101]);
  state = refreshStoryProgress(completeQuestNode(state, 101).state, source).state;
  assert.deepEqual(eligibleQuestNodes(state, source).nodes.map(n => n.Id), [102, 201], 'Implicit children are owned by the first quest, including another quest’s listed head.');
  state = refreshStoryProgress(completeQuestNode(completeQuestNode(state, 102).state, 201).state, source).state;
  assert.deepEqual(eligibleQuestNodes(state, source).nodes.map(n => n.Id), [103], 'A second implicit generation is discoverable without appearing in QuestNodeList.');
  state = refreshStoryProgress({ ...state, dayIndex: 2, questNodes: { ...state.questNodes, '999': true } }, source).state;
  assert.equal(state.requests['1'].status, 'expired');
  assert.equal(state.requests['2'].status, 'active');
  assert.deepEqual(eligibleQuestNodes(state, source).nodes, [], 'An expired owner cannot transfer its descendants; a global completion cannot replace a missing local predecessor.');
  assert.equal(state.pendingQuestNodes['103'], undefined);
});

test('quest unlocks stay pending across later prerequisite changes and checkpoint restoration', async () => {
  const source: StorySource = { ...base(),
    calendar: table([{ ...calendar(1, 1), DawnActions: [2] }, calendar(2, 2)]),
    requests: { '1': { Id: 1, PreConditionGroupId: 0, QuestNodeList: [101], QuestRewardList: [], TargetProgress: 0 } },
    questNodes: { '101': { Id: 101, PreNodeId: 0, TriggerTiming: 5, TriggerParam: 101, UnlockConditionGroupId: 1, AvailableConditionGroupId: 2, ActionId: 1, Priority: 0 } },
    locations: { '101': { Id: 101, InstanceId: 1, ConditionGroupId: 0, ShowConditionGroupId: 0 } },
    conditions: table([
      { Id: 1, Type: 1, Params: params({ Attr: '1', Max: '20' }) },
      { Id: 2, Type: 1, Params: params({ Attr: '1', Min: '21' }) },
    ]),
    groups: table([{ Id: 1, Logic: 0, GroupId: [1] }, { Id: 2, Logic: 0, GroupId: [2] }]),
    flows: { '999': { Id: 999 } },
    actions: table([action(1, 2, { SolarSchoolRewardId: '1' }), action(2, 1, { SolarSchoolFlow: '999' })]),
    rewards: table([attrReward(1, 2, 7)]), rewardGroups: table([{ Id: 1, RewardIds: [1] }]),
  };
  const h = controller(source);
  try {
    assert.equal(await h.start(), true);
    assert.equal(h.runner.advance(h.runner.getSnapshot()), true); await h.journey.flush();
    assert.equal(h.runner.getSnapshot().storyState.pendingQuestNodes['101'], true);
    assert.deepEqual(eligibleQuestNodes(h.runner.getSnapshot().storyState, source, 5, 101).nodes, [], 'Live availability blocks the pending node.');
    const saved = h.journey.createCheckpoint(); assert.ok(saved);
    h.runner.applyStoryEffect({ state: { ...h.runner.getSnapshot().storyState, attributes: { ...h.runner.getSnapshot().storyState.attributes, '1': 21 } }, changes: [], unresolved: [] });
    await h.journey.flush();
    assert.equal(h.runner.getSnapshot().storyState.pendingQuestNodes['101'], true, 'The unlock does not fall false with its original attribute condition.');
    assert.equal(await h.journey.select('location:101'), true);
    assert.equal(h.runner.getSnapshot().storyState.attributes['2'], 27);
    assert.equal(h.runner.getSnapshot().storyState.pendingQuestNodes['101'], undefined);
    assert.equal(await h.journey.restoreCheckpoint(saved), true);
    assert.equal(h.runner.getSnapshot().storyState.attributes['2'], 20);
    assert.equal(h.runner.getSnapshot().storyState.pendingQuestNodes['101'], true);
  } finally { h.dispose(); }
});

test('quest activation stays active after its prerequisite falls false and resets only at deactivation', () => {
  const source: StorySource = { ...base(),
    avgParams: { '1': { Id: 1, Key: 'key1' } },
    requests: { '1': { Id: 1, StartDayIndex: 1, EndDayIndex: 1, PreConditionGroupId: 1, QuestNodeList: [101], QuestRewardList: [1], TargetProgress: 1 } },
    questNodes: { '101': { Id: 101, PreNodeId: 0, TriggerTiming: 0, Priority: 0 } },
    questRewards: { '1': { Id: 1, ConditionId: 2, RewardProgress: 1, LocalCondition: false } },
    groups: { '1': { Id: 1, Logic: 0, GroupId: [1] } },
    conditions: table([{ Id: 1, Type: 15, Params: params({ Key: 'key1' }) }, { Id: 2, Type: 1, Params: params({ Attr: '1', Min: '20' }) }]),
  };
  const active = refreshStoryProgress({ ...initialStoryState(source), variables: { key1: true } }, source).state;
  const completed = completeQuestNode(active, 101).state;
  const changed = refreshStoryProgress({ ...completed, variables: { key1: false } }, source).state;
  assert.equal(changed.requests['1'].status, 'completed');
  assert.equal(changed.questNodes['101'], true, 'An already-active quest does not deactivate inside its window.');
  const reset = refreshStoryProgress({ ...changed, dayIndex: 2 }, source).state;
  assert.equal(reset.requests['1'].status, 'expired');
  assert.equal(reset.requests['1'].progress, 0);
  assert.equal(reset.questNodes['101'], undefined); assert.equal(reset.questRewards['1:1'], undefined);
  const retained = refreshStoryProgress({ ...completed, dayIndex: 2 }, source).state;
  assert.equal(retained.requests['1'].status, 'expired');
  assert.equal(retained.requests['1'].progress, 1); assert.equal(retained.questNodes['101'], true);
  assert.equal(retained.questRewards['1:1'], 1, 'Date expiry alone preserves completed progress when the prerequisite remains true.');
});

test('the first normal location click delivers a quest unlocked by that current location', async () => {
  const source: StorySource = { ...base(),
    requests: { '1': { Id: 1, PreConditionGroupId: 0, QuestNodeList: [101], QuestRewardList: [], TargetProgress: 0 } },
    questNodes: { '101': { Id: 101, PreNodeId: 0, TriggerTiming: 1, TriggerParam: 101, UnlockConditionGroupId: 1, AvailableConditionGroupId: 0, ActionId: 1, Priority: 0 } },
    locations: { '101': { Id: 101, InstanceId: 1, ConditionGroupId: 0, ShowConditionGroupId: 0 } },
    groups: { '1': { Id: 1, Logic: 0, GroupId: [1] } },
    conditions: { '1': { Id: 1, Type: 14, Params: params({ LocationIds: '101' }) } },
    actions: table([action(1, 2, { SolarSchoolRewardId: '1' })]),
    rewards: table([attrReward(1, 1, 7)]), rewardGroups: table([{ Id: 1, RewardIds: [1] }]),
  };
  const h = controller(source);
  try {
    assert.equal(await h.start(), true);
    assert.equal(h.runner.getSnapshot().storyState.pendingQuestNodes['101'], undefined);
    assert.equal(await h.journey.select('location:101'), true);
    assert.equal(h.runner.getSnapshot().storyState.questNodes['101'], true);
    assert.equal(h.runner.getSnapshot().storyState.attributes['1'], 27, 'Location listeners update before timing1 delivery, rather than requiring a second click.');
    assert.equal(await h.journey.select('location:101'), true);
    assert.equal(h.runner.getSnapshot().storyState.attributes['1'], 27);
  } finally { h.dispose(); }
});

test('exploration waits for Go out, retains separate-location progress, and closes only after required content', async () => {
  const source = base();
  const rewards = table([attrReward(1, 1, 3), attrReward(2, 2, 5), attrReward(3, 4, 7), attrReward(4, 4, 11), attrReward(5, 5, 13), attrReward(6, 5, 17), attrReward(7, 1, -1000), attrReward(8, 1, 20)]);
  const configured: StorySource = { ...source,
    rewards, rewardGroups: table(Object.values(rewards).map(row => ({ Id: row.Id, RewardIds: [row.Id] }))),
    actions: table(Object.values(rewards).map(row => action(Number(row.Id), 2, { SolarSchoolRewardId: String(row.Id) }))),
    calendar: table([calendar(1, 1, 2), calendar(2, 2)]),
    instances: { ...source.instances, '2': { Id: 2, InstanceType: 1, EnterActionIdList: [1], MapActionIdList: [2], EndActionIdList: [7] } },
    locations: table([
      { Id: 101, InstanceId: 2, ActionIdList: [3, 4], ConditionGroupId: 0, ShowConditionGroupId: 0, IsSeparate: false },
      { Id: 102, InstanceId: 2, ActionIdList: [5, 6], ConditionGroupId: 0, ShowConditionGroupId: 0, IsSeparate: true },
      { Id: 103, InstanceId: 2, ActionIdList: [], ConditionGroupId: 0, ShowConditionGroupId: 0, IsEndLocation: true },
    ]),
    requests: { '1': { Id: 1, PreConditionGroupId: 0, QuestNodeList: [901], QuestRewardList: [], TargetProgress: 1 } },
    questNodes: { '901': { Id: 901, TriggerTiming: 3, TriggerParam: 2, ActionId: 8, UnlockConditionGroupId: 0, AvailableConditionGroupId: 1, Priority: 0 } },
    groups: { '1': { Id: 1, Logic: 0, GroupId: [1] } }, conditions: { '1': { Id: 1, Type: 1, Params: params({ Attr: '1', Max: '1' }) } },
  };
  const h = controller(configured);
  try {
    assert.equal(await h.start(), true);
    assert.equal(h.runner.getSnapshot().storyState.attributes['1'], 23);
    assert.equal(h.runner.getSnapshot().storyState.attributes['2'], 20, 'Map actions have not fired.');
    assert.deepEqual(h.journey.getSnapshot().options.map(row => row.id), ['explore:2']);
    assert.equal(await h.journey.continue(), false);
    assert.equal(await h.journey.select('explore:2'), true);
    assert.equal(h.runner.getSnapshot().storyState.attributes['2'], 25);
    assert.equal(await h.journey.select('explore:2'), false, 'Map entry cannot repeat.');
    assert.equal(await h.journey.select('location:103'), false, 'The end location cannot skip required scenes.');
    assert.equal(await h.journey.select('location:102'), true);
    assert.equal(h.runner.getSnapshot().storyState.attributes['5'], 33);
    assert.equal(h.journey.getSnapshot().canContinue, false);
    assert.equal(await h.journey.select('location:101'), true);
    assert.equal(h.runner.getSnapshot().storyState.attributes['4'], 38, 'Nonseparate actions run together in source order.');
    assert.equal(h.journey.getSnapshot().canContinue, true, 'One separate segment satisfies the authored required threshold.');
    assert.equal(await h.journey.select('location:102'), true);
    assert.equal(h.runner.getSnapshot().storyState.attributes['5'], 50, 'The next visit plays the remaining segment.');
    assert.equal(await h.journey.select('location:102'), true);
    assert.equal(h.runner.getSnapshot().storyState.attributes['5'], 50, 'A completed location grants nothing on revisit.');
    assert.equal(await h.journey.continue(), true);
    const state = h.runner.getSnapshot().storyState;
    assert.equal(state.dayIndex, 2);
    assert.equal(state.questNodes['901'], true);
    assert.equal(state.attributes['1'], 21, 'End actions precede timing3: the quest reads the cost-clamped attribute before its reward.');
  } finally { h.dispose(); }
});

test('Continue performs the highest-priority authored default class, while manual selection can replace it', async () => {
  const source = { ...base(), behaviors: table([{ ...behavior(1, 7001), BehaviorType: 2 }, { ...behavior(2, 7002), BehaviorType: 2 }, behavior(3, 5001)]),
    spans: table([{ Id: 1, ModifierType: 'AutoPlaceBehavior', StartDayIndex: 1, EndDayIndex: 1, Priority: 0, ModifierParams: params({ BehaviorId: '7001' }) }, { Id: 2, ModifierType: 'AutoPlaceBehavior', StartDayIndex: 1, EndDayIndex: 1, Priority: 2, ModifierParams: params({ BehaviorId: '7002' }) }]),
  };
  const h = controller(source);
  try {
    assert.equal(await h.start(), true);
    assert.equal(defaultScheduledBehavior(h.runner.getSnapshot().storyState, source), 7002);
    assert.equal(await h.journey.continue(), true);
    assert.equal(h.runner.getSnapshot().storyState.behaviors['7002'].count, 1);
    assert.equal(h.runner.getSnapshot().storyState.behaviors['7001']?.count ?? 0, 0);
    assert.equal(await h.start(), true);
    assert.equal(await h.journey.select('behavior:5001'), true);
    assert.equal(h.runner.getSnapshot().storyState.behaviors['5001'].count, 1);
    assert.equal(h.runner.getSnapshot().storyState.behaviors['7002']?.count ?? 0, 0);
  } finally { h.dispose(); }
});

test('fatigue preflight reads effective fatigue and successful deltas including authored reductions', () => {
  const source: StorySource = { ...base(), buffs: { '1': { Id: 1, DurationDays: -1, EffectIds: [1] } }, buffEffects: { '1': { Id: 1, Type: 11, BehaviorId: [], Value: 5 } } };
  const b = { ...behavior(1), SucAttrChange: [{ Key: 7, Value: 25 }], FailAttrChange: [{ Key: 7, Value: 1 }] }, initial = initialStoryState(source);
  const at = (fatigue: number, reduced = false): StoryState => ({ ...initial, attributes: { ...initial.attributes, '7': fatigue }, buffs: reduced ? { '1': { acquiredDay: 1 } } : {} });
  assert.equal(behaviorFatigueAvailability(at(75), b, source).value, 'true');
  assert.equal(behaviorFatigueAvailability(at(76), b, source).value, 'false', 'Failure delta cannot permit an otherwise overflowing selection.');
  assert.equal(behaviorFatigueAvailability(at(80, true), b, source).value, 'true');
  assert.equal(behaviorFatigueAvailability(at(81, true), b, source).value, 'false');
});

test('date jumps settle skipped days without activating their quests and emit destination-week rewards once', async () => {
  const source: StorySource = { ...base(),
    calendar: table([{ ...calendar(1, 1), DawnActions: [1, 2] }, calendar(5, 5)]),
    actions: table([action(1, 2, { SolarSchoolRewardId: '1' }), action(2, 27, { TargetDayIndex: '5' }), action(3, 2, { SolarSchoolRewardId: '3' })]),
    rewards: table([{ Id: 1, RewardType: 4, TargetId: 1, Value: 1 }, attrReward(2, 1, 10), attrReward(3, 1, 100)]),
    rewardGroups: table([{ Id: 1, RewardIds: [1] }, { Id: 2, RewardIds: [2] }, { Id: 3, RewardIds: [3] }]),
    buffs: { '1': { Id: 1, DurationDays: -1, EffectIds: [], WeeklyRewardId: 2 } },
    requests: { '1': { Id: 1, StartDayIndex: 2, EndDayIndex: 2, PreConditionGroupId: 0, QuestNodeList: [1], QuestRewardList: [], TargetProgress: 1 } },
    questNodes: { '1': { Id: 1, TriggerTiming: 0, ActionId: 3, UnlockConditionGroupId: 0, AvailableConditionGroupId: 0, Priority: 0 } },
  };
  const h = controller(source);
  try {
    assert.equal(await h.start(), true); assert.equal(await h.journey.continue(), true);
    const state = h.runner.getSnapshot().storyState;
    assert.equal(state.dayIndex, 5);
    assert.equal(state.attributes['1'], 30);
    assert.equal(state.requests['1'], undefined, 'A quest confined to a skipped date never activates.');
    assert.equal(state.questNodes['1'], undefined);
    assert.equal(settleWeeklyRewards(state, source, 4).state, state);
  } finally { h.dispose(); }
});

test('affairs parse authored ID lists and settle sequential choices in their original order', async () => {
  const source: StorySource = { ...base(),
    calendar: table([{ ...calendar(1, 1), DawnActions: [1] }, calendar(2, 2)]),
    actions: table([action(1, 5, { IdList: '[3,4]' })]),
    affairs: table([{ Id: 3, OptionGroupId: 3 }, { Id: 4, OptionGroupId: 4 }]),
    affairsOptions: table([{ Id: 31, GroupId: 3, Reward: 1 }, { Id: 41, GroupId: 4, Reward: 2 }]),
    rewards: table([attrReward(1, 1, -1000), attrReward(2, 1, 20)]), rewardGroups: table([{ Id: 1, RewardIds: [1] }, { Id: 2, RewardIds: [2] }]),
  };
  assert.deepEqual(applyActivityAction(initialStoryState(source), 1, source).commands, [{ kind: 'affairs', id: 3 }, { kind: 'affairs', id: 4 }]);
  const h = controller(source);
  try {
    assert.equal(await h.start(), true);
    assert.equal(h.journey.getSnapshot().interaction?.sourceId, 3);
    await h.journey.dismissInteraction();
    assert.equal(h.journey.getSnapshot().interaction?.sourceId, 3, 'An authored decision cannot be skipped.');
    assert.equal(await h.journey.select('affairs:31'), true);
    assert.equal(h.journey.getSnapshot().interaction?.sourceId, 4);
    assert.equal(h.runner.getSnapshot().storyState.attributes['1'], 1);
    assert.equal(await h.journey.select('affairs:41'), true);
    assert.equal(h.runner.getSnapshot().storyState.attributes['1'], 21);
    assert.equal(h.journey.getSnapshot().phase, 'planning');
  } finally { h.dispose(); }
});

test('behavior-unlock list conditions count current row eligibility rather than historical unlock flags', () => {
  const source: StorySource = { ...base(), behaviors: table([behavior(1), { ...behavior(2), ShowConditionGroupId: 1 }, behavior(3)]),
    conditions: { '1': { Id: 1, Type: 1, Params: params({ Attr: '1', Min: '100' }) } }, groups: { '1': { Id: 1, Logic: 0, GroupId: [1] } },
  };
  const state = { ...initialStoryState(source), behaviors: { '2': { count: 0, successes: 0, unlocked: true } } };
  const leaf = (count: string) => ({ Id: 2, Type: 22, Params: params({ BehaviorId: '1|2|3', Count: count }) });
  assert.equal(evaluateConditionLeaf(leaf('2'), state, source).value, 'true');
  assert.equal(evaluateConditionLeaf(leaf('3'), state, source).value, 'false');
  assert.equal(evaluateConditionLeaf({ Id: 2, Type: 22, Params: params({ BehaviorId: '1|3' }) }, state, source).value, 'true');
  assert.equal(evaluateConditionLeaf(leaf('3'), { ...state, attributes: { ...state.attributes, '1': 100 } }, source).value, 'true');
});

test('location-list conditions read all current unlocks, and map notifications cannot force access', () => {
  const source: StorySource = { ...base(),
    locations: table([{ Id: 1, ConditionGroupId: 0, Name: 'home' }, { Id: 2, ConditionGroupId: 1, Name: 'school' }, { Id: 3, ConditionGroupId: 2, Name: 'cycle' }]),
    groups: table([{ Id: 1, Logic: 0, GroupId: [1] }, { Id: 2, Logic: 0, GroupId: [2] }]),
    conditions: table([{ Id: 1, Type: 1, Params: params({ Attr: '1', Min: '21' }) }, { Id: 2, Type: 12, Params: params({ LocationId: '3' }) }]),
    actions: table([action(1, 24, { SolarSchoolLocationIds: '2' })]),
  };
  const state = { ...initialStoryState(source), locations: { '2': true } }, leaf = { Type: 12, Params: params({ LocationId: '1|2' }) };
  assert.equal(evaluateConditionLeaf(leaf, state, source).value, 'false', 'A stored map notification cannot satisfy current access.');
  const unlocked = { ...state, attributes: { ...state.attributes, '1': 21 } };
  assert.equal(evaluateConditionLeaf(leaf, unlocked, source).value, 'true', 'Every listed location must be unlocked.');
  assert.equal(evaluateConditionLeaf(leaf, { ...unlocked, attributes: state.attributes }, source).value, 'false', 'Access follows later state changes.');
  const notification = applyActivityAction(state, 1, source);
  assert.equal(notification.state, state);
  assert.deepEqual(notification.changes.map(c => c.kind), ['locationUnlocked']);
  assert.equal(evaluateLocationUnlock(2, notification.state, source).value, 'false');
  assert.equal(evaluateLocationUnlock(3, state, source).value, 'unknown');
  assert.match(evaluateLocationUnlock(3, state, source).reasons.join(' '), /cyclic/);
});

test('ending entry waits for deadline actions, and NextCycle inherits only owned Special items without received events', async () => {
  const source: StorySource = { ...base(), params: table([{ Id: 1, Key: 'TotalDays', IntValue: 1 }, { Id: 2, Key: 'TiredThreshold', IntValue: 60 }, { Id: 3, Key: 'SickThreshold', IntValue: 90 }]),
    calendar: table([{ ...calendar(1, 1), DawnActions: [1, 2, 3] }]),
    flows: { '9000': { Id: 9000 } },
    actions: table([action(1, 1, { SolarSchoolFlow: '9000' }), action(2, 2, { SolarSchoolRewardId: '1' }), action(3, 13, { Params: 'key31=true' }), action(4, 2, { SolarSchoolRewardId: '2' })]),
    items: table([{ Id: 10, ItemType: 2, StackLimit: 1, EffectIds: [] }, { Id: 11, ItemType: 0, StackLimit: 10 }, { Id: 12, ItemType: 1, StackLimit: 10 }]),
    rewards: table([{ Id: 1, RewardType: 2, TargetId: 10, Value: 1 }, { Id: 2, RewardType: 2, TargetId: 11, Value: 2 }, { Id: 3, RewardType: 2, TargetId: 12, Value: 1 }, attrReward(4, 1, -7)]),
    rewardGroups: table([{ Id: 1, RewardIds: [1, 2, 3] }, { Id: 2, RewardIds: [4] }]),
    avgParams: { '1': { Id: 1, Key: 'key31' } },
    behaviors: table([{ ...behavior(9), BehaviorType: 4, AppearDay: 1, AcceptDeadline: 1, FinishDeadline: 1, FinishCount: 1, OccupyDayOfWeek: [5], AttrRequire: [], AcceptAction: 0, FailAction: 4 }]),
    groups: { '1': { Id: 1, Logic: 0, GroupId: [1] } }, conditions: { '1': { Id: 1, Type: 1, Params: params({ Attr: '1', Max: '13' }) } },
    endingFlows: table([{ Id: 1, IsStart: true, NodeType: 2, ConditionId: 1, TrueNextId: 2, FalseNextId: 3 }, { Id: 2, NodeType: 4 }, { Id: 3, NodeType: 3 }]),
  };
  const h = controller(source); let receivedEvents = 0;
  h.runner.onEvent(event => { if (event.type === 'storyMutation') receivedEvents += event.changes.filter(change => change.kind === 'item').length; });
  try {
    assert.equal(await h.start(), true);
    assert.equal(h.runner.advance(h.runner.getSnapshot()), true); await h.journey.flush();
    assert.equal(await h.journey.select('request:9'), true);
    assert.equal(await h.journey.continue(), true);
    assert.equal(h.journey.getSnapshot().interaction?.kind, 'requestFailed');
    assert.equal(h.runner.getSnapshot().storyState.endingSnapshot, null);
    await h.journey.dismissInteraction();
    const ended = h.runner.getSnapshot().storyState;
    assert.equal(h.journey.getSnapshot().phase, 'complete');
    assert.equal(ended.endingSnapshot?.attributes['1'], 13);
    assert.equal(h.journey.getSnapshot().nextCycle, true);
    const receivedBefore = receivedEvents;
    assert.equal(await h.journey.startNextCycle(), true);
    const inherited = h.runner.getSnapshot().storyState;
    assert.equal(inherited.playthroughCount, 2);
    assert.equal(inherited.items['10'].min, 1);
    assert.equal(inherited.acquiredItems['10'], true);
    assert.equal(inherited.items['11'].min, 0); assert.equal(inherited.items['12'].min, 0);
    assert.equal(inherited.variables.key31, false);
    assert.equal(inherited.attributes['1'], 20);
    assert.equal(receivedEvents, receivedBefore, 'Inheritance is initialization, not another received-item reward.');
    const consumed = { ...ended, items: { ...ended.items, '10': { min: 0, max: 0 } } };
    assert.equal(inheritSpecialItems(initialStoryState(source), consumed, source).state.items['10'].min, 0, 'Acquisition history alone cannot inherit an absent item.');
    assert.equal(await h.start(), true);
    assert.equal(h.runner.getSnapshot().storyState.playthroughCount, 1);
    assert.equal(h.runner.getSnapshot().storyState.items['10'].min, 0);
  } finally { h.dispose(); }
});
