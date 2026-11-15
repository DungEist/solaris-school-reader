import type { Metadata } from './types.ts';
import { applyAttributeDelta, applyRewardGroup, conditionResult, sourceInteger, sourceList, sourceRecord, storyEffect } from './StoryState.ts';
import type { ConditionResult, StoryEffect, StorySource, StoryState } from './StoryState.ts';
import { effectiveAttributes, mechanicBonuses as bonuses, mechanicUnavailable as unavailable, mechanicValue as known } from './StoryAttributes.ts';
import type { MechanicValue } from './StoryAttributes.ts';
export { effectiveAttributes } from './StoryAttributes.ts';
export type { MechanicValue } from './StoryAttributes.ts';

const f = Math.fround;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const integer = sourceInteger;
const rows = (value: unknown): Metadata[] | null => Array.isArray(value) && value.every(v => sourceRecord(v)) ? value as Metadata[] : null;
const marked = (state: StoryState, key?: string) => key ? Object.freeze({ ...state, applied: Object.freeze({ ...state.applied, [key]: true }) }) : state;
const alreadyApplied = (state: StoryState, key?: string) => !!key && !!state.applied[key];

/** Math.Round(double) uses ties-to-even; the game converts float intermediates
 * to double before rounding exam scores (0x06038805). */
export function nativeRound(value: number): number {
  const floor = Math.floor(value), fraction = value - floor;
  return fraction === .5 ? floor % 2 === 0 ? floor : floor + 1 : Math.round(value);
}

/** SelectBehaviorRow (0x06038537) chooses the highest Level whose
 * RequireCount is met. Tied levels keep the first source row. */
export function currentBehaviorRow(state: StoryState, behaviorId: number, source: StorySource): Metadata | undefined {
  const count = state.behaviors[String(behaviorId)]?.count ?? 0;
  return Object.values(source.behaviors ?? {}).filter(r => r.BehaviorId === behaviorId && Number(r.RequireCount) <= count)
    .sort((a, b) => Number(b.Level) - Number(a.Level))[0];
}

export function behaviorSuccessRate(state: StoryState, behavior: Metadata, source: StorySource): MechanicValue<number> {
  const attributes = effectiveAttributes(state, source), derived = bonuses(state, source);
  if (!attributes.value || !derived.value) return known(null as never, [...attributes.unresolved, ...derived.unresolved]);
  const lower = rows(behavior.AttrLower), upper = rows(behavior.AttrUpper), weights = rows(behavior.AttrWeight);
  if (!lower || !upper || !weights) return unavailable(`Behavior ${String(behavior.BehaviorId)} check definitions are unavailable.`);
  const dictionary = (entries: Metadata[]) => Object.fromEntries(entries.map(r => [String(r.Key), r.Value]));
  const lo = dictionary(lower), hi = dictionary(upper), weight = dictionary(weights);
  const diagnostics: string[] = [];
  let weighted = f(0);
  for (let attr = 1; attr <= 5; attr++) {
    const key = String(attr), w = integer(weight[key] ?? 0), min = integer(lo[key] ?? 0), max = integer(hi[key] ?? 0), current = attributes.value[key];
    if (w === null || min === null || max === null || current === undefined) return unavailable(`Behavior ${String(behavior.BehaviorId)} attribute ${attr} check is unavailable.`);
    if (w <= 0) continue;
    // The original explicitly disables malformed dimensions and logs them.
    if (max <= min) { diagnostics.push(`Behavior ${String(behavior.BehaviorId)} attribute ${attr}: upper <= lower; dimension disabled by the source rule.`); continue; }
    const ratio = current <= min ? 0 : current >= max ? 1 : f(f(current - min) / f(max - min));
    weighted = f(weighted + f(f(w / 1000) * ratio));
  }
  const tired = Object.values(source.params ?? {}).find(r => r.Key === 'TiredThreshold')?.IntValue;
  const sick = Object.values(source.params ?? {}).find(r => r.Key === 'SickThreshold')?.IntValue;
  const fatigue = attributes.value['7'];
  if (integer(tired) === null || integer(sick) === null || fatigue === undefined) return unavailable('Fatigue thresholds or current fatigue are unavailable.');
  const factor = fatigue >= Number(sick) ? 0 : fatigue >= Number(tired) ? 1 : 2;
  const base = Math.min(f(Math.max(weighted, .5) * factor), 1);
  const id = integer(behavior.BehaviorId);
  if (id === null) return unavailable('Behavior ID is unavailable.');
  const bonus = (derived.value.global['9'] ?? 0) + (derived.value.scoped[`9:${id}`] ?? 0);
  return known(clamp(f(base + f(bonus / 10000)), 0, 1), diagnostics);
}

export function behaviorAttributeDeltas(state: StoryState, behavior: Metadata, success: boolean, source: StorySource): MechanicValue<Readonly<Record<string, number>>> {
  const entries = rows(behavior[success ? 'SucAttrChange' : 'FailAttrChange']), derived = bonuses(state, source), id = integer(behavior.BehaviorId);
  if (!entries || !derived.value || id === null) return known(null as never, derived.unresolved.length ? derived.unresolved : ['Behavior attribute deltas are unavailable.']);
  const deltas: Record<string, number> = {};
  for (const entry of entries) {
    const key = integer(entry.Key), value = integer(entry.Value);
    if (key === null || key < 1 || key > 8 || value === null) return unavailable('Behavior attribute change has an invalid definition.');
    deltas[String(key)] = (deltas[String(key)] ?? 0) + value;
  }
  for (let attr = 1; attr <= 8; attr++) {
    const value = (deltas[String(attr)] ?? 0) + (derived.value.scoped[`${attr}:${id}`] ?? 0);
    const reduction = (derived.value.global['11'] ?? 0) + (derived.value.scoped[`11:${id}`] ?? 0);
    const delta = attr === 7 && value > 0 ? Math.max(0, value - reduction) : value;
    if (delta) deltas[String(attr)] = delta;
    else delete deltas[String(attr)];
  }
  return known(Object.freeze(deltas));
}

/** Native manual-selection preflight uses the successful fatigue delta,
 * including item/buff reductions, before deciding whether a slot can run. */
export function behaviorFatigueAvailability(state: StoryState, behavior: Metadata, source: StorySource): ConditionResult {
  const attributes = effectiveAttributes(state, source), deltas = behaviorAttributeDeltas(state, behavior, true, source), max = integer(source.attrs?.['7']?.MaxValue);
  if (!attributes.value || !deltas.value || max === null || attributes.value['7'] === undefined) return conditionResult('unknown', [...attributes.unresolved, ...deltas.unresolved, 'Fatigue preflight is unavailable.'].join(' '));
  return attributes.value['7'] + (deltas.value['7'] ?? 0) > max ? conditionResult('false', 'This activity would exceed the fatigue limit.') : conditionResult('true');
}

/** Type10 is a flat bonus to each attribute/favor/item reward member; buff
 * grants keep their configured values (TryGiveReward 0x0603877F). */
export function applyMechanicReward(state: StoryState, groupId: number, source: StorySource, bonus = 0, eventKey?: string): StoryEffect {
  if (alreadyApplied(state, eventKey)) return storyEffect(state);
  if (!Number.isSafeInteger(bonus)) return storyEffect(state, [], ['Reward bonus is invalid.']);
  let rewardSource = source;
  if (bonus) {
    const ids = sourceList(source.rewardGroups[String(groupId)]?.RewardIds);
    if (!ids) return storyEffect(state, [], [`Reward group ${groupId} is unavailable.`]);
    const rewards = { ...source.rewards };
    for (const id of ids) {
      const row = rewards[String(id)];
      if (!row || integer(row.Value) === null) return storyEffect(state, [], [`Reward ${id} is unavailable.`]);
      rewards[String(id)] = [0, 1, 2].includes(Number(row.RewardType)) ? { ...row, Value: Number(row.Value) + bonus } : row;
    }
    rewardSource = { ...source, rewards };
  }
  const effect = applyRewardGroup(state, groupId, rewardSource);
  return storyEffect(marked(effect.state, eventKey), effect.changes, effect.unresolved, effect.commands, effect.blocked);
}

export type BehaviorCompletionStep = { readonly kind: 'activityAction'; readonly actionId: number } | { readonly kind: 'requestDone'; readonly behaviorId: number } | { readonly kind: 'rewardGroup'; readonly rewardGroupId: number };
export interface BehaviorSettlement extends StoryEffect { readonly completionSteps: readonly BehaviorCompletionStep[]; }
const settlement = (effect: StoryEffect, completionSteps: readonly BehaviorCompletionStep[] = []): BehaviorSettlement => Object.freeze({ ...effect, completionSteps: Object.freeze([...completionSteps]) });

/** Count/deltas and success/fail rewards settle together. Special completion
 * queues FinishAction, confirmation, then RewardFinish: the controller must
 * execute completionSteps in order, after any authored dialogue completes. */
export function settleBehavior(state: StoryState, behavior: Metadata, success: boolean, source: StorySource, eventKey?: string): BehaviorSettlement {
  if (alreadyApplied(state, eventKey)) return settlement(storyEffect(state));
  const id = integer(behavior.BehaviorId), deltas = behaviorAttributeDeltas(state, behavior, success, source), derived = bonuses(state, source);
  if (id === null || !deltas.value || !derived.value) return settlement(storyEffect(state, [], [...deltas.unresolved, ...derived.unresolved]));
  const previous = state.behaviors[String(id)] ?? { count: 0, successes: 0 };
  let next: StoryState = Object.freeze({ ...state, behaviors: Object.freeze({ ...state.behaviors, [String(id)]: Object.freeze({ ...previous, count: previous.count + 1, successes: previous.successes + Number(success) }) }) });
  const changes: Metadata[] = [{ kind: 'behavior', behaviorId: id, before: previous.count, after: previous.count + 1, success, labelKey: behavior.Name }];
  const unresolved: string[] = [], blocked: string[] = [];
  for (let attr = 1; attr <= 8; attr++) if (deltas.value[String(attr)]) {
    const effect = applyAttributeDelta(next, attr, deltas.value[String(attr)], source);
    next = effect.state; changes.push(...effect.changes); unresolved.push(...effect.unresolved);
  }
  const rewardId = integer(behavior[success ? 'RewardSuccess' : 'RewardFail']);
  if (rewardId === null) unresolved.push(`Behavior ${id} reward definition is unavailable.`);
  else if (rewardId) {
    const bonus = behavior.BehaviorType === 4 ? 0 : (derived.value.global['10'] ?? 0) + (derived.value.scoped[`10:${id}`] ?? 0);
    const reward = applyMechanicReward(next, rewardId, source, bonus);
    next = reward.state; changes.push(...reward.changes); unresolved.push(...reward.unresolved); blocked.push(...(reward.blocked ?? []));
  }
  const completionSteps: BehaviorCompletionStep[] = [];
  const goal = integer(behavior.FinishCount);
  if (behavior.BehaviorType === 4 && previous.state === 'Accepted' && goal !== null && goal > 0 && previous.count + 1 >= goal) {
    next = Object.freeze({ ...next, behaviors: Object.freeze({ ...next.behaviors, [String(id)]: Object.freeze({ ...next.behaviors[String(id)], state: 'Finished' }) }) });
    changes.push({ kind: 'requestCompleted', behaviorId: id, labelKey: behavior.Name, count: previous.count + 1 });
    const finish = integer(behavior.FinishAction), reward = integer(behavior.RewardFinish);
    if (finish === null || reward === null) unresolved.push(`Behavior ${id} completion definitions are unavailable.`);
    else {
      if (finish) completionSteps.push({ kind: 'activityAction', actionId: finish });
      completionSteps.push({ kind: 'requestDone', behaviorId: id });
      if (reward) completionSteps.push({ kind: 'rewardGroup', rewardGroupId: reward });
    }
  }
  const commands = completionSteps.filter((s): s is Extract<BehaviorCompletionStep, { kind: 'activityAction' }> => s.kind === 'activityAction');
  return settlement(storyEffect(marked(next, eventKey), changes, unresolved, commands, blocked), completionSteps);
}

export function rollBehavior(state: StoryState, behavior: Metadata, source: StorySource, draw: number, eventKey?: string): BehaviorSettlement {
  if (alreadyApplied(state, eventKey)) return settlement(storyEffect(state));
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) return settlement(storyEffect(state, [], ['Behavior random draw must be in [0,1).']));
  const rate = behaviorSuccessRate(state, behavior, source);
  if (rate.value === null) return settlement(storyEffect(state, [], rate.unresolved));
  const effect = settleBehavior(state, behavior, draw < rate.value, source, eventKey);
  return settlement(storyEffect(effect.state, effect.changes, [...rate.unresolved, ...effect.unresolved], effect.commands, effect.blocked), effect.completionSteps);
}

/** BeforeBehavior timing2 events precede these actions. Select ONE pre-action
 * using the supplied draw. FirstAction fires at this row's RequireCount. */
export function behaviorPreActions(state: StoryState, behavior: Metadata, draw: number): MechanicValue<readonly number[]> {
  const id = integer(behavior.BehaviorId), first = integer(behavior.FirstAction), required = integer(behavior.RequireCount), pre = sourceList(behavior.PreActionList);
  if (id === null || first === null || required === null || !pre || !Number.isFinite(draw) || draw < 0 || draw >= 1) return unavailable('Behavior pre-action definition or random draw is unavailable.');
  const actions: number[] = [];
  if (first && (state.behaviors[String(id)]?.count ?? 0) === required) actions.push(first);
  if (pre.length && pre[Math.floor(draw * pre.length)]) actions.push(pre[Math.floor(draw * pre.length)]);
  return known(Object.freeze(actions));
}

export function examBaseScore(state: StoryState, examId: number, source: StorySource): MechanicValue<number> {
  const exam = source.exams?.[String(examId)], attributes = effectiveAttributes(state, source), maxima = sourceList(exam?.AttrMax), weights = sourceList(exam?.AttrWeight), scoreMax = integer(exam?.ScoreMax);
  if (!exam || !attributes.value || !maxima || !weights || scoreMax === null) return known(null as never, attributes.unresolved.length ? attributes.unresolved : [`Exam ${examId} definition is unavailable.`]);
  let total = 0, weighted = f(0);
  const diagnostics: string[] = [];
  for (let attr = 1; attr <= Math.min(5, maxima.length, weights.length); attr++) {
    const weight = weights[attr - 1], max = maxima[attr - 1], current = attributes.value[String(attr)];
    if (!weight) continue;
    if (current === undefined) return unavailable(`Exam ${examId} attribute ${attr} is unavailable.`);
    if (max <= 0) { diagnostics.push(`Exam ${examId} attribute ${attr}: weighted dimension without a positive maximum is disabled by the source rule.`); continue; }
    weighted = f(weighted + f(Math.min(f(current / max), 1) * weight));
    total += weight;
  }
  return known(total > 0 ? nativeRound(f(f(scoreMax * weighted) / total)) : 0, diagnostics);
}

export function startExam(state: StoryState, examId: number, source: StorySource, eventKey?: string): StoryEffect {
  if (alreadyApplied(state, eventKey)) return storyEffect(state);
  const score = examBaseScore(state, examId, source);
  if (score.value === null) return storyEffect(state, [], score.unresolved);
  return storyEffect(marked(Object.freeze({ ...state, exams: Object.freeze({ ...state.exams, [String(examId)]: score.value }) }), eventKey), [{ kind: 'exam', examId, before: state.exams[String(examId)], after: score.value, value: score.value, source: 'base' }], score.unresolved);
}

export function addExamScore(state: StoryState, examId: number, value: number, source: StorySource, eventKey?: string): StoryEffect {
  if (alreadyApplied(state, eventKey)) return storyEffect(state);
  const exam = source.exams?.[String(examId)], before = state.exams[String(examId)], min = integer(exam?.ScoreMin), max = integer(exam?.ScoreMax);
  if (before === undefined || min === null || max === null || integer(value) === null) return storyEffect(state, [], [`Exam ${examId} score has not been initialized or its bounds are unavailable.`]);
  const after = clamp(before + value, min, max);
  return storyEffect(marked(Object.freeze({ ...state, exams: Object.freeze({ ...state.exams, [String(examId)]: after }) }), eventKey), after === before ? [] : [{ kind: 'exam', examId, before, after, value: after - before, source: 'answer' }]);
}

/** Original exam completion picks the first inclusive score band, then an
 * inclusive rank. Result rows carry no reward; quest actions grant rewards. */
export function settleExam(state: StoryState, examId: number, source: StorySource, eventKey?: string, draw = 0): StoryEffect {
  if (alreadyApplied(state, eventKey)) return storyEffect(state);
  const exam = source.exams?.[String(examId)], score = state.exams[String(examId)];
  if (!exam || score === undefined || !Number.isFinite(draw) || draw < 0 || draw >= 1) return storyEffect(state, [], [`Exam ${examId} result or rank draw is unavailable.`]);
  const row = Object.values(source.examScoreRanks ?? {}).find(row => row.GroupId === exam.ScoreRankGroupId && score >= Number(row.ScoreMin) && score <= Number(row.ScoreMax));
  if (!row) return storyEffect(state, [], [`Exam ${examId} has no authored score band for ${score}.`]);
  const lower = integer(row.RankRandMin), upper = integer(row.RankRandMax);
  if (lower === null || upper === null) return storyEffect(state, [], [`Exam ${examId} rank range is unavailable.`]);
  const min = Math.min(lower, upper), max = Math.max(lower, upper), rank = min + Math.floor(draw * (max - min + 1));
  const result = Object.freeze({ examId, score, rank, read: false });
  const next = Object.freeze({ ...state, examResults: Object.freeze({ ...state.examResults, [String(examId)]: result }), latestExamIds: Object.freeze({ ...state.latestExamIds, [String(exam.ExamType)]: examId }) });
  return storyEffect(marked(next, eventKey), [{ kind: 'examResult', examId, score, rank }]);
}

interface Point { readonly x: number; readonly y: number; }
const cross = (a: Point, b: Point, p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
const polygonArea = (points: readonly Point[]) => Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - p.y * q.x; }, 0)) / 2;
function clipConvex(subject: readonly Point[], clip: readonly Point[]): Point[] {
  let output = [...subject];
  for (let edge = 0; edge < clip.length && output.length; edge++) {
    const a = clip[edge], b = clip[(edge + 1) % clip.length], input = output;
    output = [];
    let previous = input[input.length - 1], previousCross = cross(a, b, previous);
    for (const current of input) {
      const currentCross = cross(a, b, current), inside = currentCross >= -1e-8, previousInside = previousCross >= -1e-8;
      if (inside !== previousInside) {
        const ratio = previousCross / (previousCross - currentCross);
        output.push({ x: previous.x + ratio * (current.x - previous.x), y: previous.y + ratio * (current.y - previous.y) });
      }
      if (inside) output.push(current);
      previous = current; previousCross = currentCross;
    }
  }
  return output;
}
/** Original radar intersection clips one pair of origin/axis triangles per
 * sector. Clamping each independent radial ratio gives incorrect crossings. */
export function radarProbability(current: readonly number[], required: readonly number[]): MechanicValue<number> {
  if (current.length < 3 || current.length !== required.length || [...current, ...required].some(v => !Number.isFinite(v) || v < 0)) return unavailable('Radar attributes or requirements are invalid.');
  const n = current.length, angle = 2 * Math.PI / n;
  let targetArea = 0, intersection = 0;
  const point = (index: number, values: readonly number[]): Point => ({ x: Math.cos(index * angle) * values[index], y: Math.sin(index * angle) * values[index] });
  for (let index = 0; index < n; index++) {
    const next = (index + 1) % n;
    targetArea += .5 * required[index] * required[next] * Math.sin(angle);
    intersection += polygonArea(clipConvex([{ x: 0, y: 0 }, point(index, current), point(next, current)], [{ x: 0, y: 0 }, point(index, required), point(next, required)]));
  }
  return known(targetArea <= 1e-8 ? 0 : clamp(intersection / targetArea, 0, 1));
}

export function eventCheckSuccessRate(state: StoryState, option: Metadata, source: StorySource): MechanicValue<number> {
  const attributes = effectiveAttributes(state, source), require = sourceList(option.AttrRequire);
  if (!attributes.value || !require) return known(null as never, attributes.unresolved.length ? attributes.unresolved : ['Event-check requirements are unavailable.']);
  const current = [1, 2, 3, 4, 5].map(id => attributes.value![String(id)]);
  if (current.some(v => v === undefined)) return unavailable('Event-check attributes are unavailable.');
  const geometric = radarProbability(current, [0, 1, 2, 3, 4].map(i => require[i] ?? 0));
  if (geometric.value === null) return geometric;
  const raw = nativeRound(geometric.value * 10000);
  // Kept as an optional export to remain compatible with older source schema.
  const table = sourceRecord((source as StorySource & { eventProbabilities?: unknown }).eventProbabilities);
  if (!table) return unavailable('Event probability mapping table is unavailable.');
  for (const value of Object.values(table)) {
    const row = sourceRecord(value), min = integer(row?.ProbabilityRangeMin), max = integer(row?.ProbabilityRangeMax), mapped = integer(row?.ProbabilityMapping);
    if (min === null || max === null || mapped === null) return unavailable('Event probability mapping has an invalid definition.');
    if (raw >= min && raw < max) return known(mapped / 10000);
  }
  return known(raw / 10000);
}

/** EnterShowResult (0x060382FD) settles score OR reward, then queues the
 * selected action list in source order. AddScore in an exam replaces both
 * success and failure rewards; a failed check adds no score. */
export function settleEventCheck(state: StoryState, option: Metadata, success: boolean, source: StorySource, eventKey?: string): StoryEffect {
  if (alreadyApplied(state, eventKey)) return storyEffect(state);
  const id = integer(option.Id), score = integer(option.AddScore), actionIds = sourceList(option[success ? 'SuccessActionList' : 'FailActionList']);
  if (id === null || score === null || !actionIds) return storyEffect(state, [], ['Event-check settlement definitions are unavailable.']);
  let next = state;
  const changes: Metadata[] = [{ kind: 'eventCheckResult', optionId: id, success, labelKey: option[success ? 'SuccessDescKey' : 'FailDescKey'] }];
  const unresolved: string[] = [], blocked: string[] = [];
  const isExam = source.instances?.[String(state.instanceId)]?.InstanceType === 2;
  if (score && isExam) {
    if (success) {
      const exam = Object.values(source.exams ?? {}).find(row => row.InstanceId === state.instanceId);
      const examId = integer(exam?.Id);
      if (examId === null) unresolved.push('Current exam ID is unavailable.');
      else {
        const effect = addExamScore(next, examId, score, source);
        next = effect.state; changes.push(...effect.changes); unresolved.push(...effect.unresolved);
      }
    }
  } else {
    const groupId = integer(option[success ? 'RewardSuccess' : 'RewardFail']);
    if (groupId === null) unresolved.push(`Event-check option ${id} reward definition is unavailable.`);
    else if (groupId > 0) {
      const effect = applyMechanicReward(next, groupId, source);
      next = effect.state; changes.push(...effect.changes); unresolved.push(...effect.unresolved); blocked.push(...(effect.blocked ?? []));
    }
  }
  const commands = actionIds.filter(actionId => actionId > 0).map(actionId => ({ kind: 'activityAction' as const, actionId }));
  return storyEffect(marked(next, eventKey), changes, unresolved, commands, blocked);
}

/** Reader reproducibility policy, not the original game's random generator. */
export function deterministicReaderDraw(seed: string, eventKey: string): number {
  let hash = 2166136261;
  for (const char of `${seed}\u0000${eventKey}`) { hash ^= char.codePointAt(0)!; hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) / 4294967296;
}
