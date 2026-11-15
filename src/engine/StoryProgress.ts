import type { Metadata } from './types.ts';
import { applyRewardGroup, conditionResult, evaluateConditionGroup, evaluateConditionLeaf, evaluateLocationUnlock, progressBaseline, sourceInteger, sourceList, sourceParams, storyDate, storyEffect } from './StoryState.ts';
import type { ConditionResult, StoryEffect, StorySource, StoryState } from './StoryState.ts';
import { effectiveAttributes } from './StoryAttributes.ts';

const rows = (table: Readonly<Record<string, Metadata>> | undefined): Metadata[] => Object.values(table ?? {});
const change = (kind: string, data: Metadata): Metadata => Object.freeze({ kind, ...data });
export interface CalendarSelection { readonly row: Metadata | null; readonly conditions: readonly { readonly id: number; readonly condition: ConditionResult }[]; readonly unresolved: readonly string[]; }

/** FindCalendarDay prefers the greatest matching conditioned ID. Only when
 * none match does it choose the greatest unconditional ID. */
export function selectCalendar(state: StoryState, source: StorySource, dayIndex = state.dayIndex): CalendarSelection {
  const candidates = rows(source.calendar).filter(r => r.DayIndex === dayIndex).sort((a, b) => Number(b.Id) - Number(a.Id));
  const conditions = candidates.filter(r => Number(r.ConditionGroupId)).map(r => ({ id: Number(r.Id), condition: evaluateConditionGroup(Number(r.ConditionGroupId), state, source) }));
  const match = conditions.find(c => c.condition.value === 'true');
  const uncertain = conditions.filter(c => c.condition.value === 'unknown' && (!match || c.id > match.id));
  const row = uncertain.length ? null : match ? candidates.find(r => r.Id === match.id)! : candidates.find(r => !Number(r.ConditionGroupId)) ?? null;
  return Object.freeze({ row, conditions: Object.freeze(conditions), unresolved: Object.freeze(uncertain.flatMap(c => c.condition.reasons)) });
}

export function refreshStoryProgress(state: StoryState, source: StorySource): StoryEffect {
  if (!state.initialized || state.dayIndex === null) return storyEffect(state, [], ['Journey progress requires an initialized playthrough.']);
  let next = state;
  const changes: Metadata[] = [], unresolved: string[] = [];
  // Activation captures local progress once; checks latch when their authored
  // leaf is reached. ParentIdList is presentation, not a prerequisite write.
  for (let pass = 0; pass < 32; pass++) {
    const beforePass = next;
    for (const row of rows(source.requests)) {
      const id = String(row.Id), day = state.dayIndex, before = next.requests[id];
      const inWindow = (!Number(row.StartDayIndex) || day >= Number(row.StartDayIndex)) && (!Number(row.EndDayIndex) || day <= Number(row.EndDayIndex));
      if (!inWindow) {
        if (before && before.status !== 'expired') {
          const prerequisite = evaluateConditionGroup(Number(row.PreConditionGroupId ?? 0), next, source);
          if (prerequisite.value === 'false') next = resetQuestProgress(next, Number(row.Id), source);
          else if (prerequisite.value === 'unknown') unresolved.push(`Quest ${id} deactivation: ${prerequisite.reasons.join(' ')}`);
          next = Object.freeze({ ...next, requests: Object.freeze({ ...next.requests, [id]: Object.freeze({ ...next.requests[id], status: 'expired' as const }) }) });
          changes.push(change('requestExpired', { questId: Number(id), labelKey: row.Name }));
        }
        continue;
      }
      const prerequisite = evaluateConditionGroup(Number(row.PreConditionGroupId ?? 0), next, source);
      if ((!before || before.status === 'expired') && prerequisite.value !== 'true') { if (prerequisite.value === 'unknown') unresolved.push(`Quest ${id}: ${prerequisite.reasons.join(' ')}`); continue; }
      if (!before || before.status === 'expired') {
        next = Object.freeze({ ...next, requests: Object.freeze({ ...next.requests, [id]: Object.freeze({ progress: before?.progress ?? 0, rewardClaimed: before?.rewardClaimed ?? false, status: 'active' as const }) }), baselines: Object.freeze({ ...next.baselines, [`quest:${id}`]: next.baselines[`quest:${id}`] ?? progressBaseline(next) }) });
        if (typeof row.Name === 'string' && row.Name && row.ShowType === 2) changes.push(change('requestUnlocked', { requestId: Number(id), questId: Number(id), labelKey: row.Name }));
      }
      for (const rewardId of sourceList(row.QuestRewardList) ?? []) {
        const key = `${id}:${rewardId}`, reward = source.questRewards?.[String(rewardId)];
        if (next.questRewards[key] || !reward) continue;
        const condition = evaluateConditionLeaf(source.conditions[String(reward.ConditionId)], next, source, reward.LocalCondition ? next.baselines[`quest:${id}`] : undefined);
        if (condition.value === 'true') next = Object.freeze({ ...next, questRewards: Object.freeze({ ...next.questRewards, [key]: 1 }) });
        else if (condition.value === 'unknown') unresolved.push(`Quest ${id} reward check ${rewardId}: ${condition.reasons.join(' ')}`);
      }
      const rewardIds = sourceList(row.QuestRewardList) ?? [], target = Number(row.TargetProgress ?? 0);
      const progress = Math.min(target, rewardIds.reduce((sum, rewardId) => sum + (next.questRewards[`${id}:${rewardId}`] ? Number(source.questRewards?.[String(rewardId)]?.RewardProgress ?? 0) : 0), 0));
      const current = next.requests[id], completed = target > 0 && progress >= target;
      if (current.progress !== progress || completed && current.status !== 'completed') {
        next = Object.freeze({ ...next, requests: Object.freeze({ ...next.requests, [id]: Object.freeze({ ...current, progress, status: completed ? 'completed' as const : 'active' as const }) }) });
        changes.push(change(completed ? 'requestCompleted' : 'requestProgress', { questId: Number(id), requestId: Number(id), value: progress, target, labelKey: row.Name }));
      }
    }
    if (next === beforePass) break;
    if (pass === 31) unresolved.push('Quest activation did not settle within the native 32-pass limit.');
  }
  for (const row of rows(source.locations).filter(row => row.InstanceId === next.instanceId)) {
    const unlock = evaluateLocationUnlock(Number(row.Id), next, source), visible = evaluateConditionGroup(Number(row.ShowConditionGroupId ?? 0), next, source);
    if (unlock.value === 'unknown' || visible.value === 'unknown') unresolved.push(`Location ${row.Id}: ${[...unlock.reasons, ...visible.reasons].join(' ')}`);
  }
  // Behavior appearance is recorded; map eligibility reads live source conditions.
  for (const row of rows(source.behaviors)) {
    const id = String(row.BehaviorId), before = next.behaviors[id];
    const condition = evaluateConditionGroup(Number(row.ShowConditionGroupId ?? 0), next, source);
    if (row.BehaviorType === 4) {
      if (before?.state === 'Finished' || before?.state === 'Failed') continue;
      if (!before?.state && Number(row.AppearDay) > 0 && state.dayIndex >= Number(row.AppearDay) && condition.value === 'true') {
        next = Object.freeze({ ...next, behaviors: Object.freeze({ ...next.behaviors, [id]: Object.freeze({ count: before?.count ?? 0, successes: before?.successes ?? 0, unlocked: true, state: 'Appeared' }) }) });
        changes.push(change('requestUnlocked', { requestId: Number(id), labelKey: row.Name }));
      }
      const current = next.behaviors[id];
      if (current?.state === 'Appeared' && Number(row.AcceptDeadline) > 0 && state.dayIndex > Number(row.AcceptDeadline)) {
        next = Object.freeze({ ...next, behaviors: Object.freeze({ ...next.behaviors, [id]: Object.freeze({ ...current, state: 'Failed' }) }) });
        changes.push(change('requestExpired', { requestId: Number(id), labelKey: row.Name }));
      }
    } else if (!before?.unlocked && condition.value === 'true') {
      next = Object.freeze({ ...next, behaviors: Object.freeze({ ...next.behaviors, [id]: Object.freeze({ ...before, count: before?.count ?? 0, successes: before?.successes ?? 0, unlocked: true }) }) });
    }
  }
  const listeners = refreshQuestNodeListeners(next, source);
  return storyEffect(listeners.state, changes, [...new Set([...unresolved, ...listeners.unresolved])]);
}

interface OwnedQuestNodes { readonly nodes: readonly Metadata[]; readonly ids: ReadonlySet<number>; readonly unresolved: readonly string[]; }
const constructedQuestNodes = new WeakMap<StorySource, ReadonlyMap<number, OwnedQuestNodes>>();

/** Native BuildNodes starts with each quest's heads and walks the activity-wide
 * PreNodeId child map. The first constructed quest owns a node and its listeners;
 * encountering an already-owned head does not traverse its children again. */
function questNodesByOwner(source: StorySource): ReadonlyMap<number, OwnedQuestNodes> {
  const cached = constructedQuestNodes.get(source);
  if (cached) return cached;
  const children = new Map<number, number[]>(), owners = new Set<number>(), quests = new Map<number, OwnedQuestNodes>();
  for (const node of rows(source.questNodes)) {
    const parent = Number(node.PreNodeId);
    if (!parent) continue;
    const list = children.get(parent) ?? [];
    list.push(Number(node.Id)); children.set(parent, list);
  }
  for (const quest of rows(source.requests)) {
    const pending = [...sourceList(quest.QuestNodeList) ?? []], nodes: Metadata[] = [], ids = new Set<number>(), unresolved: string[] = [];
    for (let index = 0; index < pending.length; index++) {
      const id = pending[index];
      if (owners.has(id)) continue;
      const node = source.questNodes?.[String(id)];
      if (!node) { unresolved.push(`Quest ${quest.Id} node ${id} is unavailable.`); continue; }
      owners.add(id); ids.add(id); nodes.push(node);
      pending.push(...children.get(id) ?? []);
    }
    quests.set(Number(quest.Id), { nodes: Object.freeze(nodes), ids, unresolved: Object.freeze(unresolved) });
  }
  constructedQuestNodes.set(source, quests);
  return quests;
}

/** Deactivation retains progress unless its activation prerequisite is false. */
function resetQuestProgress(state: StoryState, questId: number, source: StorySource): StoryState {
  const id = String(questId), row = source.requests?.[id], completed = { ...state.questNodes }, pending = { ...state.pendingQuestNodes }, rewards = { ...state.questRewards }, baselines = { ...state.baselines }, applied = { ...state.applied };
  for (const node of questNodesByOwner(source).get(questId)?.nodes ?? []) { delete completed[String(node.Id)]; delete pending[String(node.Id)]; }
  for (const reward of sourceList(row?.QuestRewardList) ?? []) delete rewards[`${id}:${reward}`];
  delete rewards[id]; delete baselines[`quest:${id}`]; delete applied[`questReward:${id}`];
  return Object.freeze({ ...state, questNodes: Object.freeze(completed), pendingQuestNodes: Object.freeze(pending), questRewards: Object.freeze(rewards), baselines: Object.freeze(baselines), applied: Object.freeze(applied), requests: Object.freeze({ ...state.requests, [id]: Object.freeze({ ...state.requests[id], progress: 0, rewardClaimed: false }) }) });
}

function questInWindow(state: StoryState, quest: Metadata): boolean {
  return state.dayIndex !== null && (!Number(quest.StartDayIndex) || state.dayIndex >= Number(quest.StartDayIndex)) && (!Number(quest.EndDayIndex) || state.dayIndex <= Number(quest.EndDayIndex));
}

function refreshQuestNodeListeners(state: StoryState, source: StorySource): StoryEffect {
  const pending = { ...state.pendingQuestNodes }, unresolved: string[] = [];
  let changed = false;
  const constructed = questNodesByOwner(source);
  for (const quest of rows(source.requests)) {
    const owned = constructed.get(Number(quest.Id)), current = state.requests[String(quest.Id)];
    if (!owned) continue;
    const active = current && current.status !== 'expired' && questInWindow(state, quest);
    if (!active) {
      for (const node of owned.nodes) if (pending[String(node.Id)]) { delete pending[String(node.Id)]; changed = true; }
      continue;
    }
    unresolved.push(...owned.unresolved);
    for (const node of owned.nodes) {
      const id = String(node.Id), predecessor = Number(node.PreNodeId);
      if (state.questNodes[id] || pending[id] || predecessor && (!owned.ids.has(predecessor) || !state.questNodes[String(predecessor)])) continue;
      const unlock = evaluateConditionGroup(Number(node.UnlockConditionGroupId ?? 0), state, source);
      if (unlock.value === 'true') { pending[id] = true; changed = true; }
      else if (unlock.value === 'unknown') unresolved.push(`Quest node ${id} unlock: ${unlock.reasons.join(' ')}`);
    }
  }
  return storyEffect(changed ? Object.freeze({ ...state, pendingQuestNodes: Object.freeze(pending) }) : state, [], unresolved);
}

export function eligibleQuestNodes(state: StoryState, source: StorySource, timing = 0, param = 0): { readonly nodes: readonly Metadata[]; readonly unresolved: readonly string[] } {
  const nodes: Metadata[] = [], unresolved: string[] = [];
  const constructed = questNodesByOwner(source);
  for (const quest of rows(source.requests)) {
    if (!state.requests[String(quest.Id)] || state.requests[String(quest.Id)].status === 'expired') continue;
    if (!questInWindow(state, quest)) continue;
    const owned = constructed.get(Number(quest.Id));
    if (!owned) continue;
    unresolved.push(...owned.unresolved);
    for (const node of owned.nodes) {
      const id = Number(node.Id), predecessor = Number(node.PreNodeId);
      if (state.questNodes[String(id)] || !state.pendingQuestNodes[String(id)] || Number(node.TriggerTiming) !== timing || timing && Number(node.TriggerParam) !== param) continue;
      if (predecessor && (!owned.ids.has(predecessor) || !state.questNodes[String(predecessor)])) continue;
      const available = evaluateConditionGroup(Number(node.AvailableConditionGroupId ?? 0), state, source);
      if (available.value === 'true') nodes.push(node);
      else if (available.value === 'unknown') unresolved.push(`Quest node ${id}: ${available.reasons.join(' ')}`);
    }
  }
  // Native pending comparator only compares descending Priority. Stable source
  // enumeration preserves a tie without claiming another authored priority.
  nodes.sort((a, b) => Number(b.Priority) - Number(a.Priority));
  return { nodes: Object.freeze(nodes), unresolved: Object.freeze(unresolved) };
}
export function completeQuestNode(state: StoryState, nodeId: number): StoryEffect {
  if (state.questNodes[String(nodeId)]) return storyEffect(state);
  const pending = { ...state.pendingQuestNodes }; delete pending[String(nodeId)];
  return storyEffect(Object.freeze({ ...state, questNodes: Object.freeze({ ...state.questNodes, [String(nodeId)]: true }), pendingQuestNodes: Object.freeze(pending) }), [change('questNodeCompleted', { nodeId })]);
}
export function claimJourneyReward(state: StoryState, questId: number, source: StorySource): StoryEffect {
  const id = String(questId), row = source.requests?.[id], progress = state.requests[id];
  if (!row || !progress || progress.rewardClaimed || progress.status === 'expired' || !Number(row.RewardItem) || progress.progress < Number(row.TargetProgress) || state.dayIndex === null || Number(row.EndDayIndex) > 0 && state.dayIndex > Number(row.EndDayIndex)) return storyEffect(state);
  const effect = applyRewardGroup(state, Number(row.RewardItem), source);
  if (effect.unresolved.length || effect.blocked?.length) return effect;
  return storyEffect(Object.freeze({ ...effect.state, requests: Object.freeze({ ...effect.state.requests, [id]: Object.freeze({ ...progress, rewardClaimed: true }) }), questRewards: Object.freeze({ ...effect.state.questRewards, [id]: (effect.state.questRewards[id] ?? 0) + 1 }), applied: Object.freeze({ ...effect.state.applied, [`questReward:${id}`]: true }) }), [...effect.changes, change('requestReward', { questId, requestId: questId, labelKey: row.Name })]);
}

export interface SpecialDeadline { readonly deadline: number | null; readonly workDays: readonly number[]; readonly unresolved: readonly string[]; }
export function specialDeadline(row: Metadata, state: StoryState, source: StorySource): SpecialDeadline {
  const weekdays = sourceList(row.OccupyDayOfWeek), totalDays = Number(rows(source.params).find(r => r.Key === 'TotalDays')?.IntValue);
  if (!weekdays?.length || weekdays.some(d => d < 1 || d > 5) || !Number.isSafeInteger(totalDays)) return { deadline: null, workDays: [], unresolved: ['Invalid request schedule definition.'] };
  const anchor = Number(row.AcceptDeadline), firstMonday = anchor - storyDate(anchor).weekday + 1 + 7, maxDay = Math.max(...weekdays), requiredWeeks = Number(row.FinishValidWeek);
  const workDays: number[] = [], explicit = Number(row.FinishDeadline), unresolved: string[] = [];
  let validWeeks = 0, deadline: number | null = explicit > 0 ? explicit : null;
  for (let monday = firstMonday; monday + maxDay - 1 <= (explicit > 0 ? explicit : totalDays); monday += 7) {
    let usable = true;
    for (const weekday of weekdays) {
      const selection = selectCalendar(state, source, monday + weekday - 1);
      if (!selection.row) { unresolved.push(...selection.unresolved); usable = false; break; }
      if (![0, 1].includes(Number(selection.row.InstanceId))) { usable = false; break; }
    }
    if (!usable) continue;
    workDays.push(...weekdays.map(d => monday + d - 1)); validWeeks++;
    if (explicit <= 0 && validWeeks >= requiredWeeks) { deadline = monday + maxDay - 1; break; }
  }
  if (!deadline) unresolved.push('The authored request cannot fit its required weeks before year end.');
  return { deadline, workDays: Object.freeze(workDays), unresolved: Object.freeze([...new Set(unresolved)]) };
}
export function requestAcceptance(row: Metadata, state: StoryState, source: StorySource): ConditionResult {
  const current = state.behaviors[String(row.BehaviorId)];
  if (!state.initialized || state.dayIndex === null) return conditionResult('unknown', 'Request state is unavailable.');
  if (current?.state !== 'Appeared' || Number(row.AcceptDeadline) > 0 && state.dayIndex > Number(row.AcceptDeadline)) return conditionResult('false');
  if (Array.isArray(row.AttrRequire)) for (const raw of row.AttrRequire) {
    const effective = effectiveAttributes(state, source);
    if (!effective.value) return conditionResult('unknown', effective.unresolved.join(' '));
    const p = raw as { Key: number; Value: number }, value = effective.value[String(p.Key)];
    if (value === undefined) return conditionResult('unknown', `Attribute ${p.Key} is unavailable.`);
    if (value < p.Value) return conditionResult('false');
  }
  const deadline = specialDeadline(row, state, source);
  return deadline.deadline === null ? conditionResult('unknown', deadline.unresolved.join(' ')) : conditionResult('true');
}
export function acceptSpecialRequest(state: StoryState, behaviorId: number, source: StorySource): StoryEffect {
  const id = String(behaviorId), row = rows(source.behaviors).find(r => r.BehaviorId === behaviorId);
  if (!row) return storyEffect(state, [], [`Request ${behaviorId} is unavailable.`]);
  const eligible = requestAcceptance(row, state, source);
  if (eligible.value !== 'true') return storyEffect(state, [], eligible.value === 'unknown' ? eligible.reasons : [], [], eligible.value === 'false' ? ['Request prerequisites are unmet.'] : []);
  const before = state.behaviors[id], deadline = specialDeadline(row, state, source);
  const next = Object.freeze({ ...state, behaviors: Object.freeze({ ...state.behaviors, [id]: Object.freeze({ ...before, state: 'Accepted', acceptedDay: state.dayIndex!, finishDeadline: deadline.deadline!, workDays: deadline.workDays }) }) });
  return storyEffect(next, [change('requestAccepted', { requestId: behaviorId, labelKey: row.Name })], [], Number(row.AcceptAction) ? [{ kind: 'activityAction', actionId: Number(row.AcceptAction) }] : []);
}

/** Span defaults are authored schedule entries, not neighboring scene IDs. */
export function defaultScheduledBehavior(state: StoryState, source: StorySource): number | null {
  if (state.dayIndex === null || state.timeSlot === null) return null;
  const candidates = rows(source.spans).filter(row => row.ModifierType === 'AutoPlaceBehavior' && state.dayIndex! >= Number(row.StartDayIndex) && state.dayIndex! <= Number(row.EndDayIndex)).sort((a, b) => Number(b.Priority) - Number(a.Priority));
  for (const span of candidates) {
    const id = sourceInteger(sourceParams(span.ModifierParams)?.BehaviorId);
    const row = rows(source.behaviors).find(row => row.BehaviorId === id);
    const slots = sourceList(row?.AvailableTimeSlot);
    if (id !== null && slots?.length === 1 && slots[0] === state.timeSlot) return id;
  }
  return null;
}

export function settleWeeklyRewards(state: StoryState, source: StorySource, monday: number): StoryEffect {
  const key = `weekly-rewards:${monday}`;
  if (state.applied[key]) return storyEffect(state);
  let next = state;
  const changes: Metadata[] = [], unresolved: string[] = [], blocked: string[] = [];
  for (const id of Object.keys(state.buffs)) {
    const reward = sourceInteger(source.buffs?.[id]?.WeeklyRewardId);
    if (reward === null || reward < 0) { unresolved.push(`Buff ${id} weekly reward definition is unavailable.`); continue; }
    if (!reward) continue;
    const effect = applyRewardGroup(next, reward, source);
    next = effect.state; changes.push(...effect.changes); unresolved.push(...effect.unresolved); blocked.push(...(effect.blocked ?? []));
  }
  return storyEffect(Object.freeze({ ...next, applied: Object.freeze({ ...next.applied, [key]: true }) }), changes, unresolved, [], blocked);
}

export function freezeEndingState(state: StoryState, source?: StorySource): StoryState {
  const attributes = source ? effectiveAttributes(state, source).value : state.attributes;
  return state.endingSnapshot || !attributes ? state : Object.freeze({ ...state, endingSnapshot: Object.freeze({ attributes, favor: state.favor, influences: state.influences, exams: state.exams }) });
}
export interface EndingTraversal { readonly path: readonly number[]; readonly actions: readonly number[]; readonly nextNode: number | null; readonly terminal: 3 | 4 | null; readonly unresolved: readonly string[]; }
/** Walk conditions until an action boundary, preserving graph precedence. */
export function nextEndingAction(state: StoryState, source: StorySource, startNode?: number | null): EndingTraversal {
  let id = startNode ?? Number(rows(source.endingFlows).find(r => r.IsStart)?.Id), terminal: 3 | 4 | null = null;
  const path: number[] = [], actions: number[] = [], unresolved: string[] = [], seen = new Set<number>();
  while (id) {
    if (seen.has(id)) { unresolved.push(`Ending graph cycle at node ${id}.`); break; }
    seen.add(id); path.push(id);
    const row = source.endingFlows?.[String(id)];
    if (!row) { unresolved.push(`Ending node ${id} is unavailable.`); break; }
    if (row.NodeType === 1) { actions.push(Number(row.ActionId)); id = Number(row.NextId); return { path, actions, nextNode: id, terminal, unresolved }; }
    if (row.NodeType === 2) {
      const condition = evaluateConditionGroup(Number(row.ConditionId), state, source);
      if (condition.value === 'unknown') { unresolved.push(`Ending node ${id}: ${condition.reasons.join(' ')}`); break; }
      id = Number(condition.value === 'true' ? row.TrueNextId : row.FalseNextId); continue;
    }
    if (row.NodeType === 3 || row.NodeType === 4) { terminal = row.NodeType; id = 0; break; }
    unresolved.push(`Ending node ${id} type is unavailable.`); break;
  }
  return { path, actions, nextNode: unresolved.length ? id : null, terminal, unresolved };
}
export function availableEndings(state: StoryState, source: StorySource, endingType: number): { readonly endings: readonly Metadata[]; readonly unresolved: readonly string[] } {
  const endings: Metadata[] = [], unresolved: string[] = [];
  for (const row of rows(source.endings).filter(r => r.EndingType === endingType).sort((a, b) => Number(a.Sort) - Number(b.Sort) || Number(a.Id) - Number(b.Id))) {
    const condition = evaluateConditionGroup(Number(row.ConditionId ?? 0), state, source);
    if (condition.value === 'true') endings.push(row);
    else if (condition.value === 'unknown') unresolved.push(`Ending ${row.Id}: ${condition.reasons.join(' ')}`);
  }
  return { endings: Object.freeze(endings), unresolved: Object.freeze(unresolved) };
}
