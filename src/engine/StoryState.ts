import type { Metadata, ScriptOption } from './types.ts';
import { effectiveAttributes } from './StoryAttributes.ts';
import { currentShopPurchaseCount } from './StoryItems.ts';

export type Truth = 'true' | 'false' | 'unknown';
export interface ConditionResult { readonly value: Truth; readonly reasons: readonly string[]; }
export interface ItemQuantity { readonly min: number; readonly max: number | null; }
export interface FavorState { readonly unlocked: boolean; readonly level: number; readonly points: number; }
export interface BehaviorProgress { readonly count: number; readonly successes: number; readonly unlocked?: boolean; readonly state?: string; readonly acceptedDay?: number; readonly finishDeadline?: number; readonly workDays?: readonly number[]; }
export interface RequestProgress { readonly status: 'available' | 'active' | 'completed' | 'expired'; readonly progress: number; readonly rewardClaimed: boolean; }
export interface ProgressBaseline {
  readonly attributes: Readonly<Record<string, number>>;
  readonly behaviors: Readonly<Record<string, BehaviorProgress>>;
  readonly gifts: Readonly<Record<string, number>>;
  readonly flowReads: Readonly<Record<string, number>>;
  readonly shopPurchases: Readonly<Record<string, number>>;
  readonly shopSelections: Readonly<Record<string, readonly number[]>>;
  readonly dayIndex: number | null;
}
export interface EndingSnapshot {
  readonly attributes: Readonly<Record<string, number>>;
  readonly favor: Readonly<Record<string, FavorState>>;
  readonly influences: Readonly<Record<string, number>>;
  readonly exams: Readonly<Record<string, number>>;
}
export interface StoryState extends ProgressBaseline {
  readonly shopPurchases: Readonly<Record<string, number>>;
  readonly shopSelections: Readonly<Record<string, readonly number[]>>;
  readonly scratchBoards: Readonly<Record<string, { readonly roundId: number; readonly rewards: readonly number[]; readonly revealed: Readonly<Record<string, boolean>>; readonly counter: number; readonly revCounter: number; readonly pending?: { readonly eventKey: string; readonly rewardIds: readonly number[]; readonly indices: readonly number[] } }>>;
  readonly prizeDraws: Readonly<Record<string, number>>;
  readonly prizeNoSCount: number | null;
  readonly items: Readonly<Record<string, ItemQuantity>>;
  readonly acquiredItems: Readonly<Record<string, boolean>>;
  readonly variables: Readonly<Record<string, boolean>>;
  /** Locally reached gallery endings, separate from currently chosen endings. */
  readonly endings: Readonly<Record<string, boolean>>;
  readonly selectedEndings: Readonly<Record<string, boolean>>;
  readonly specialTalkViewed?: Readonly<Record<string, boolean>>;
  readonly favor: Readonly<Record<string, FavorState>>;
  readonly influences: Readonly<Record<string, number>>;
  readonly locations: Readonly<Record<string, boolean>>;
  readonly requests: Readonly<Record<string, RequestProgress>>;
  readonly questNodes: Readonly<Record<string, boolean>>;
  /** Unlock listeners latch before delivery; availability remains a live check. */
  readonly pendingQuestNodes: Readonly<Record<string, boolean>>;
  readonly questRewards: Readonly<Record<string, number>>;
  readonly baselines: Readonly<Record<string, ProgressBaseline>>;
  readonly buffs: Readonly<Record<string, { readonly acquiredDay: number | null }>>;
  readonly exams: Readonly<Record<string, number>>;
  readonly examResults: Readonly<Record<string, { readonly examId: number; readonly score: number; readonly rank: number; readonly read: boolean }>>;
  readonly latestExamIds: Readonly<Record<string, number>>;
  readonly choices: Readonly<Record<string, boolean>>;
  readonly plotKeys: Readonly<Record<string, boolean>>;
  readonly applied: Readonly<Record<string, boolean>>;
  readonly importantAttributes: readonly number[];
  readonly initialized: boolean;
  readonly dayIndex: number | null;
  readonly timeSlot: number | null;
  readonly instanceId: number | null;
  readonly locationId: number | null;
  readonly playthroughCount: number | null;
  readonly endingSnapshot: EndingSnapshot | null;
}
type Table = Readonly<Record<string, Metadata>>;
export interface StorySource {
  readonly schema: 1;
  readonly actions: Table; readonly rewards: Table; readonly rewardGroups: Table;
  readonly items: Table; readonly conditions: Table; readonly groups: Table;
  readonly activity?: Metadata | null;
  readonly attrs?: Table; readonly roles?: Table; readonly favorLevels?: Table;
  readonly avgParams?: Table; readonly params?: Table; readonly requests?: Table;
  readonly questNodes?: Table; readonly questRewards?: Table; readonly mainConditions?: Table;
  readonly behaviors?: Table; readonly calendar?: Table; readonly timeSlots?: Table;
  readonly instances?: Table; readonly locations?: Table; readonly flows?: Table;
  readonly endingFlows?: Table; readonly endings?: Table; readonly buffs?: Table;
  readonly buffEffects?: Table; readonly influences?: Table; readonly influenceLevels?: Table;
  readonly exams?: Table; readonly examScoreRanks?: Table; readonly roleSchedules?: Table; readonly roleTalks?: Table; readonly roleSpines?: Table;
  readonly eventChecks?: Table; readonly eventCheckOptions?: Table; readonly datePeriods?: Table;
  readonly eventProbabilities?: Table;
  readonly shopGoods?: Table; readonly itemEffects?: Table; readonly roleGifts?: Table;
  readonly shops?: Table; readonly shopRefresh?: Table;
  readonly spans?: Table; readonly options?: Table; readonly affairs?: Table; readonly affairsOptions?: Table;
  readonly scratchTickets?: Table; readonly scratchRewards?: Table; readonly prizeActivities?: Table; readonly prizeAwards?: Table;
}
export const emptyStorySource: StorySource = Object.freeze({ schema: 1, actions: {}, rewards: {}, rewardGroups: {}, items: {}, conditions: {}, groups: {} });
export const sourceRecord = (x: unknown): Metadata | null => x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Metadata : null;
export function sourceParams(x: unknown): Record<string, string> | null {
  if (!Array.isArray(x)) return null;
  const out: Record<string, string> = {};
  for (const row of x) {
    const r = sourceRecord(row);
    if (!r || typeof r.Key !== 'string' || typeof r.Value !== 'string' || Object.hasOwn(out, r.Key)) return null;
    out[r.Key] = r.Value;
  }
  return out;
}
export const sourceInteger = (x: unknown): number | null => typeof x === 'number' && Number.isSafeInteger(x) ? x : typeof x === 'string' && /^-?\d+$/.test(x) && Number.isSafeInteger(Number(x)) ? Number(x) : null;
export function sourceList(x: unknown): number[] | null {
  const values = typeof x === 'string' && x.length ? x.split('|') : Array.isArray(x) ? x : null;
  return values?.every(i => sourceInteger(i) !== null) ? values.map(Number) : null;
}
const boolean = (x: unknown, fallback?: boolean): boolean | null => x === undefined ? fallback ?? null : ['true', '1', true, 1].some(v => v === x) ? true : ['false', '0', false, 0].some(v => v === x) ? false : null;
const freezeMap = <T = never>(x: Record<string, T>): Readonly<Record<string, T>> => Object.freeze(x);
export function initialStoryState(source: StorySource = emptyStorySource): StoryState {
  const initialized = source.activity?.Id === 111700001 && !!source.attrs && !!source.roles;
  const items: Record<string, ItemQuantity> = {}, variables: Record<string, boolean> = {}, endings: Record<string, boolean> = {}, attributes: Record<string, number> = {}, favor: Record<string, FavorState> = {}, influences: Record<string, number> = {};
  if (initialized) {
    for (const id of Object.keys(source.items)) items[id] = Object.freeze({ min: 0, max: 0 });
    for (const row of Object.values(source.avgParams ?? {})) if (typeof row.Key === 'string') variables[row.Key] = false;
    for (const id of Object.keys(source.endings ?? {})) endings[id] = false;
    for (const [id, row] of Object.entries(source.attrs ?? {})) if (sourceInteger(row.InitValue) !== null) attributes[id] = Number(row.InitValue);
    for (const id of Object.keys(source.roles ?? {})) favor[id] = Object.freeze({ unlocked: false, level: 0, points: 0 });
    for (const id of Object.keys(source.influences ?? {})) influences[id] = 0;
  }
  return Object.freeze({ items: freezeMap(items), acquiredItems: freezeMap({}), variables: freezeMap(variables), endings: freezeMap(endings), selectedEndings: freezeMap({}), attributes: freezeMap(attributes), favor: freezeMap(favor), influences: freezeMap(influences), locations: freezeMap({}), requests: freezeMap({}), questNodes: freezeMap({}), pendingQuestNodes: freezeMap({}), questRewards: freezeMap({}), baselines: freezeMap({}), buffs: freezeMap({}), exams: freezeMap({}), examResults: freezeMap({}), latestExamIds: freezeMap({}), gifts: freezeMap({}), behaviors: freezeMap({}), flowReads: freezeMap({}), choices: freezeMap({}), plotKeys: freezeMap({}), applied: freezeMap({}), shopPurchases: freezeMap({}), shopSelections: freezeMap({}), scratchBoards: freezeMap({}), prizeDraws: freezeMap({}), prizeNoSCount: initialized ? 0 : null, importantAttributes: Object.freeze([]), initialized, dayIndex: initialized ? 1 : null, timeSlot: initialized ? 1 : null, instanceId: initialized ? 1 : null, locationId: initialized ? 0 : null, playthroughCount: initialized ? 1 : null, endingSnapshot: null });
}
/** Next-cycle inventory is copied during initialization, before listeners and
 * rewards. Only currently owned Special items carry; no acquisition event is
 * fired by the native AddInheritedItem path. */
export function inheritSpecialItems(state: StoryState, previous: StoryState, source: StorySource): StoryEffect {
  const items = { ...state.items }, acquiredItems = { ...state.acquiredItems }, unresolved: string[] = [];
  for (const [id, quantity] of Object.entries(previous.items)) {
    if (source.items[id]?.ItemType !== 2 || quantity.min <= 0) continue;
    if (quantity.max !== quantity.min) { unresolved.push(`Inherited item ${id} exact quantity is unavailable.`); continue; }
    items[id] = Object.freeze({ min: quantity.min, max: quantity.min }); acquiredItems[id] = true;
  }
  return storyEffect(Object.freeze({ ...state, items: freezeMap(items), acquiredItems: freezeMap(acquiredItems) }), [], unresolved);
}
export const conditionResult = (value: Truth, reason?: string): ConditionResult => Object.freeze({ value, reasons: Object.freeze(reason ? [reason] : []) });
const unknown = (reason: string) => conditionResult('unknown', reason);
const testValue = (value: boolean) => conditionResult(value ? 'true' : 'false');
const knownBool = (map: Readonly<Record<string, boolean>>, key: string, state: StoryState): boolean | null => Object.hasOwn(map, key) ? map[key] : state.initialized ? false : null;
const range = (value: number | undefined | null, min: unknown, max: unknown, label: string): ConditionResult => {
  const lower = min === undefined ? -2147483648 : sourceInteger(min), upper = max === undefined ? 2147483647 : sourceInteger(max);
  if (lower === null || upper === null || lower > upper) return unknown(`Invalid ${label} range.`);
  return value === undefined || value === null ? unknown(`${label} is unavailable.`) : testValue(value >= lower && value <= upper);
};
export function combineConditions(logic: unknown, values: readonly ConditionResult[]): ConditionResult {
  if (![0, 1].includes(logic as number) || !values.length) return unknown('Unsupported or empty condition group.');
  const decisive = logic === 0 ? 'false' : 'true';
  if (values.some(v => v.value === decisive)) return conditionResult(decisive);
  if (values.some(v => v.value === 'unknown')) return Object.freeze({ value: 'unknown', reasons: Object.freeze(values.flatMap(v => v.reasons)) });
  return conditionResult(logic === 0 ? 'true' : 'false');
}
/** Original Utils date anchor is 2024-03-15, independent of host timezone. */
export function storyDate(dayIndex: number): { month: number; day: number; weekday: number } {
  const date = new Date(Date.UTC(2024, 2, 15 + dayIndex - 1));
  return { month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay() || 7 };
}
export function favorLevelRow(source: StorySource, roleId: number | string, level: number): Metadata | undefined {
  return Object.values(source.favorLevels ?? {}).find(r => String(r.RoleId) === String(roleId) && r.FavorLevel === level);
}
export function favorCap(source: StorySource, roleId: number | string, level: number): number | null {
  if (level >= Number(source.roles?.[String(roleId)]?.MaxFavorLevel)) return 0;
  return sourceInteger(favorLevelRow(source, roleId, level + 1)?.UpgradeFavorValue);
}
export function progressBaseline(state: StoryState): ProgressBaseline {
  return Object.freeze({ attributes: state.attributes, behaviors: state.behaviors, gifts: state.gifts, flowReads: state.flowReads, shopPurchases: state.shopPurchases, shopSelections: state.shopSelections, dayIndex: state.dayIndex });
}

export function evaluateLocationUnlock(locationId: number, state: StoryState, source: StorySource, baseline?: ProgressBaseline, dependencyChecks: ReadonlySet<string> = new Set()): ConditionResult {
  if (!source.locations) return unknown(`Location ${locationId} definition is unavailable.`);
  const row = source.locations[String(locationId)], key = `location:${locationId}`;
  if (!row) return conditionResult('false');
  if (dependencyChecks.has(key)) return unknown(`Location ${locationId} has a cyclic unlock prerequisite.`);
  return evaluateConditionGroup(Number(row.ConditionGroupId ?? 0), state, source, baseline, new Set([...dependencyChecks, key]));
}

export function evaluateConditionLeaf(row: Metadata | undefined, state: StoryState, source: StorySource, baseline?: ProgressBaseline, dependencyChecks: ReadonlySet<string> = new Set()): ConditionResult {
  if (!row) return unknown('Condition definition is unavailable.');
  const p = sourceParams(row.Params);
  if (!p) return unknown('Condition parameters are unsupported.');
  const valid = (...keys: string[]) => Object.keys(p).every(k => keys.includes(k));
  const effective = state.endingSnapshot ? null : effectiveAttributes(state, source);
  const attrs = state.endingSnapshot?.attributes ?? effective?.value ?? {};
  const favors = state.endingSnapshot?.favor ?? state.favor;
  const counts = (ids: number[], read: (id: string) => number | null, count: unknown = ids.length) => {
    const need = sourceInteger(count), values = ids.map(id => read(String(id)));
    if (need === null || values.some(n => n === null)) return unknown('Required progress is unavailable.');
    return testValue(Math.min(2147483647, (values as number[]).reduce((a, b) => a + b, 0)) >= need);
  };
  switch (row.Type) {
    case 1: if (valid('Attr', 'Min', 'Max')) return effective && !effective.value && effective.unresolved.length ? unknown(effective.unresolved.join(' ')) : range(attrs[p.Attr], p.Min, p.Max, `Attribute ${p.Attr}`); break;
    case 2: {
      const ids = sourceList(p.BehaviorId), successes = boolean(p.OnlySuccess, true);
      if (!valid('BehaviorId', 'Count', 'OnlySuccess') || !ids || successes === null) break;
      return counts(ids, id => { const value = state.behaviors[id]; if (!value && !state.initialized) return null; const key = successes ? 'successes' : 'count'; return Math.max(0, (value?.[key] ?? 0) - (baseline?.behaviors[id]?.[key] ?? 0)); }, p.Count ?? 1);
    }
    case 3: {
      const ids = sourceList(p.RoleId);
      if (!valid('RoleId', 'Min', 'Max', 'Count') || !ids || sourceInteger(p.Count ?? ids.length) === null) break;
      const values = ids.map(id => range(favors[String(id)]?.level, p.Min, p.Max, `Favor tier ${id}`));
      if (values.some(v => v.value === 'unknown')) return unknown('Required favor tiers are unavailable.');
      return testValue(values.filter(v => v.value === 'true').length >= Number(p.Count ?? ids.length));
    }
    case 4: if (valid('ExamId', 'Min', 'Max')) return range((state.endingSnapshot?.exams ?? state.exams)[p.ExamId] ?? (state.initialized ? 0 : undefined), p.Min, p.Max, `Exam ${p.ExamId} score`); break;
    case 5: if (valid('RoleId')) { const role = state.favor[p.RoleId]; return role ? testValue(role.unlocked) : unknown(`Role ${p.RoleId} is unavailable.`); } break;
    case 6: {
      if (!valid('StartMonth', 'StartDay', 'EndMonth', 'EndDay') || state.dayIndex === null) return unknown('Playthrough date is unavailable.');
      const date = storyDate(state.dayIndex), current = date.month * 100 + date.day, start = Number(p.StartMonth) * 100 + Number(p.StartDay), end = Number(p.EndMonth) * 100 + Number(p.EndDay);
      if (![start, end].every(Number.isFinite)) break;
      return testValue(start <= end ? current >= start && current <= end : current >= start || current <= end);
    }
    case 7: {
      if (!valid('Month', 'Day', 'IncludeSelf') || state.dayIndex === null) return unknown('Playthrough date is unavailable.');
      const include = boolean(p.IncludeSelf, false), date = storyDate(state.dayIndex), current = date.month * 100 + date.day, target = Number(p.Month) * 100 + Number(p.Day);
      if (include === null || !Number.isFinite(target)) break;
      return testValue(include ? current >= target : current > target);
    }
    case 8: if (valid('BehaviorId', 'State')) { const b = state.behaviors[p.BehaviorId]; return b?.state ? testValue(b.state === p.State) : state.initialized ? testValue(p.State === 'None') : unknown(`Request ${p.BehaviorId} state is unavailable.`); } break;
    case 9: if (valid('Count')) return state.initialized ? testValue(Object.values(state.behaviors).filter(b => b.state === 'Finished').length >= Number(p.Count)) : unknown('Completed request count is unavailable.'); break;
    case 10: {
      if (!valid('ItemId', 'Count')) break;
      const id = sourceInteger(p.ItemId), count = p.Count === undefined ? 1 : sourceInteger(p.Count);
      if (id === null || count === null || count < 0) break;
      const bounds = state.items[String(id)] ?? (state.initialized ? { min: 0, max: 0 } : undefined);
      if (bounds && bounds.min >= count) return conditionResult('true');
      if (bounds?.max !== null && bounds?.max !== undefined && bounds.max < count) return conditionResult('false');
      return unknown(`Inventory for item ${id} is unavailable.`);
    }
    case 11: if (valid('Min', 'Max')) return range(state.playthroughCount, p.Min, p.Max, 'Playthrough count'); break;
    case 12: {
      const ids = sourceList(p.LocationId);
      if (!valid('LocationId') || !ids) break;
      return ids.length ? combineConditions(0, ids.map(id => evaluateLocationUnlock(id, state, source, baseline, dependencyChecks))) : conditionResult('true');
    }
    case 13: if (valid('Weekdays') && sourceList(p.Weekdays)) return state.dayIndex === null ? unknown('Playthrough weekday is unavailable.') : testValue(sourceList(p.Weekdays)!.includes(storyDate(state.dayIndex).weekday)); break;
    case 14: {
      if (!valid('LocationIds', 'StartMonth', 'StartDay', 'EndMonth', 'EndDay') || !sourceList(p.LocationIds)) break;
      if (state.locationId === null) return unknown('Current location is unavailable.');
      const location = testValue(sourceList(p.LocationIds)!.includes(state.locationId));
      return p.StartMonth ? combineConditions(0, [location, evaluateConditionLeaf({ Type: 6, Params: Object.entries(p).filter(([k]) => k !== 'LocationIds').map(([Key, Value]) => ({ Key, Value })) }, state, source)]) : location;
    }
    case 15: {
      if (!valid('Key', 'Value')) break;
      const expected = boolean(p.Value, true), value = knownBool(state.variables, p.Key, state);
      if (expected === null) break;
      return value === null ? unknown(`AVG variable ${p.Key} is unavailable.`) : testValue(value === expected);
    }
    case 16: if (valid('InstanceIds') && sourceList(p.InstanceIds)) return state.instanceId === null ? unknown('Current instance is unavailable.') : testValue(sourceList(p.InstanceIds)!.includes(state.instanceId)); break;
    case 17: if (valid('EndingIds') && sourceList(p.EndingIds)) return testValue(sourceList(p.EndingIds)!.some(id => state.selectedEndings[String(id)])); break;
    case 19: {
      if (!valid('RoleId', 'FavorLevel')) break;
      const role = state.favor[p.RoleId], cap = role ? favorCap(source, p.RoleId, role.level) : null;
      if (!role || cap === null) return unknown(`Favor progress for role ${p.RoleId} is unavailable.`);
      return testValue(role.level + 1 === Number(p.FavorLevel) && role.points >= cap);
    }
    case 20: {
      if (!valid('Stages') || !sourceList(p.Stages) || attrs['7'] === undefined) break;
      const tired = Number(Object.values(source.params ?? {}).find(r => r.Key === 'TiredThreshold')?.IntValue), sick = Number(Object.values(source.params ?? {}).find(r => r.Key === 'SickThreshold')?.IntValue);
      if (![tired, sick].every(Number.isFinite)) break;
      return testValue(sourceList(p.Stages)!.includes(attrs['7'] >= sick ? 2 : attrs['7'] >= tired ? 1 : 0));
    }
    case 21: if (valid('TimeSlots') && sourceList(p.TimeSlots)) return state.timeSlot === null ? unknown('Current time slot is unavailable.') : testValue(sourceList(p.TimeSlots)!.includes(state.timeSlot)); break;
    case 22: {
      const ids = sourceList(p.BehaviorId), needed = sourceInteger(p.Count ?? ids?.length);
      if (!valid('BehaviorId', 'Count') || !ids || needed === null) break;
      const checks = ids.map(id => {
        const key = `behavior:${id}`;
        if (dependencyChecks.has(key)) return unknown(`Behavior ${id} has a cyclic unlock prerequisite.`);
        const count = state.behaviors[String(id)]?.count ?? (state.initialized ? 0 : null);
        if (count === null || !source.behaviors) return unknown(`Behavior ${id} unlock is unavailable.`);
        const row = Object.values(source.behaviors).filter(row => row.BehaviorId === id && Number(row.RequireCount) <= count).sort((a, b) => Number(b.Level) - Number(a.Level))[0];
        return row ? evaluateConditionGroup(Number(row.ShowConditionGroupId ?? 0), state, source, baseline, new Set([...dependencyChecks, key])) : conditionResult('false');
      });
      const passed = checks.filter(check => check.value === 'true').length, uncertain = checks.filter(check => check.value === 'unknown');
      if (passed >= needed) return conditionResult('true');
      if (passed + uncertain.length < needed) return conditionResult('false');
      return unknown(uncertain.flatMap(check => check.reasons).join(' '));
    }
    case 23: if (valid('InfluenceId', 'Level', 'Min', 'Max')) { const value = (state.endingSnapshot?.influences ?? state.influences)[p.InfluenceId]; return p.Level !== undefined ? range(value, p.Level, p.Level, `Influence ${p.InfluenceId}`) : range(value, p.Min, p.Max, `Influence ${p.InfluenceId}`); } break;
    case 24: if (valid('Attr', 'Count')) { const value = state.attributes[p.Attr]; return value === undefined ? unknown(`Attribute ${p.Attr} progress is unavailable.`) : range(baseline ? Math.max(0, value - (baseline.attributes[p.Attr] ?? value)) : value, p.Count, undefined, `Attribute ${p.Attr} progress`); } break;
    case 25: {
      if (!valid('ShopId', 'GoodsId', 'Count')) break;
      const shopId = sourceInteger(p.ShopId ?? 0), need = sourceInteger(p.Count ?? 0), goodsIds = p.GoodsId === undefined ? null : sourceList(p.GoodsId);
      if (shopId === null || need === null || p.GoodsId !== undefined && !goodsIds) break;
      const count = currentShopPurchaseCount(state, shopId, source, goodsIds, baseline);
      return count.value === null ? unknown(count.unresolved.join(' ')) : testValue(count.value >= need);
    }
    case 26: { const ids = sourceList(p.RoleId); if (valid('RoleId', 'Count') && ids) return counts(ids, id => state.initialized || state.gifts[id] !== undefined ? Math.max(0, (state.gifts[id] ?? 0) - (baseline?.gifts[id] ?? 0)) : null, p.Count ?? 1); break; }
    case 27: if (valid('QuestId', 'Count')) return state.initialized || state.questRewards[p.QuestId] !== undefined ? testValue((state.questRewards[p.QuestId] ?? 0) >= Number(p.Count ?? 1)) : unknown(`Quest ${p.QuestId} reward progress is unavailable.`); break;
    case 28: { const ids = sourceList(p.QuestNodeId); if (valid('QuestNodeId', 'Count') && ids) return counts(ids, id => { const value = knownBool(state.questNodes, id, state); return value === null ? null : Number(value); }, p.Count ?? ids.length); break; }
    case 29: {
      if (!valid('ItemId', 'Min', 'Max')) break;
      const b = state.items[p.ItemId] ?? (state.initialized ? { min: 0, max: 0 } : undefined), min = p.Min === undefined ? 0 : sourceInteger(p.Min), max = p.Max === undefined ? 2147483647 : sourceInteger(p.Max);
      if (min === null || max === null) break;
      if (!b) return unknown(`Inventory for item ${p.ItemId} is unavailable.`);
      if (b.min >= min && b.max !== null && b.max <= max) return conditionResult('true');
      if (b.min > max || b.max !== null && b.max < min) return conditionResult('false');
      return unknown(`Inventory range for item ${p.ItemId} is unavailable.`);
    }
    case 30: if (valid('EndingId') && sourceInteger(p.EndingId) !== null) { const value = knownBool(state.endings, p.EndingId, state); return value === null ? unknown(`Ending ${p.EndingId} achievement is unavailable.`) : testValue(value); } break;
  }
  return unknown(`Condition type ${String(row.Type)} or its parameters have unverified semantics.`);
}

export function evaluateConditionGroup(groupId: number | string, state: StoryState, source: StorySource, baseline?: ProgressBaseline, dependencyChecks?: ReadonlySet<string>): ConditionResult {
  if (String(groupId) === '0') return conditionResult('true');
  const group = source.groups[String(groupId)];
  if (!group || !Array.isArray(group.GroupId)) return unknown(`Condition group ${groupId} is unavailable.`);
  return combineConditions(group.Logic, group.GroupId.map(id => evaluateConditionLeaf(source.conditions[String(id)], state, source, baseline, dependencyChecks)));
}
export interface SystemOptionCondition {
  readonly groupId: number;
  readonly hideWhenUnmet: boolean;
  readonly hideConditionTextWhenUnmet: boolean;
  readonly unmetTextKey: string | null;
}
/** The native option wrapper copies these nullable presentation fields separately from its predicate. */
export function readSystemOptionCondition(condition: unknown): SystemOptionCondition | null {
  const c = sourceRecord(condition), system = sourceRecord(c?.System);
  if (c?.Type !== 'SystemCondition' || system?.Type !== 'SolarSchool'
    || Object.keys(c).some(k => !['Type', 'System', 'HideWhenUnmet', 'HideConditionTextWhenUnmet', 'TidReplaceTextWhenUnmet'].includes(k))
    || Object.keys(system).some(k => !['Type', 'ConditionGroupId'].includes(k))
    || ['HideWhenUnmet', 'HideConditionTextWhenUnmet'].some(k => c[k] != null && typeof c[k] !== 'boolean')
    || (c.TidReplaceTextWhenUnmet != null && typeof c.TidReplaceTextWhenUnmet !== 'string')) return null;
  const groupId = sourceInteger(system.ConditionGroupId);
  if (groupId === null) return null;
  return Object.freeze({ groupId, hideWhenUnmet: c.HideWhenUnmet === true, hideConditionTextWhenUnmet: c.HideConditionTextWhenUnmet === true, unmetTextKey: typeof c.TidReplaceTextWhenUnmet === 'string' && c.TidReplaceTextWhenUnmet.length ? c.TidReplaceTextWhenUnmet : null });
}
export function evaluateCondition(condition: unknown, state: StoryState, source: StorySource): ConditionResult {
  if (condition === undefined) return conditionResult('true');
  const c = sourceRecord(condition);
  // VisualNovelOption.Create only casts ITalkOptionSystemCondition. The authored
  // PreOption in 1006/12 therefore has a null native Condition and is eligible.
  if (c?.Type === 'PreOption' && Object.keys(c).every(k => ['Type', 'PreOptions'].includes(k))
    && Array.isArray(c.PreOptions) && c.PreOptions.every(id => sourceInteger(id) !== null)) {
    return conditionResult('true', 'The original VisualNovel path does not evaluate PreOption metadata.');
  }
  const system = readSystemOptionCondition(condition);
  return system ? evaluateConditionGroup(system.groupId, state, source) : unknown('Unsupported condition structure.');
}
export interface BranchResolution {
  readonly optionIndex: number | null;
  readonly reason: 'determined' | 'unavailable-state' | 'no-match';
  readonly conditions: readonly ConditionResult[];
}
/** First eligible source option wins; only an earlier unknown can block it. */
export function resolveHiddenBranch(options: readonly ScriptOption[], state: StoryState, source: StorySource): BranchResolution {
  const conditions = Object.freeze(options.map(o => evaluateCondition(o.preCondition, state, source)));
  for (let i = 0; i < conditions.length; i++) {
    if (conditions[i].value === 'unknown') return Object.freeze({ optionIndex: null, conditions, reason: 'unavailable-state' });
    if (conditions[i].value === 'true') return Object.freeze({ optionIndex: i, conditions, reason: 'determined' });
  }
  return Object.freeze({ optionIndex: null, conditions, reason: 'no-match' });
}

export type StoryCommand = { readonly kind: 'flow'; readonly flowId: number } | { readonly kind: 'activityAction'; readonly actionId: number } | { readonly kind: 'selectEnding'; readonly endingType: number } | { readonly kind: 'jumpDay'; readonly dayIndex: number } | { readonly kind: 'eventCheck'; readonly id: number } | { readonly kind: 'affairs' | 'scratch' | 'raffle'; readonly id: number } | { readonly kind: 'requestAccept'; readonly behaviorId: number } | { readonly kind: 'behavior'; readonly behaviorId: number } | { readonly kind: 'gift'; readonly roleId: number } | { readonly kind: 'shop'; readonly locationId: number } | { readonly kind: 'presentation'; readonly actionId: number };
export interface StoryEffect { readonly state: StoryState; readonly changes: readonly Metadata[]; readonly unresolved: readonly string[]; readonly blocked?: readonly string[]; readonly commands?: readonly StoryCommand[]; }
export function storyEffect(state: StoryState, changes: readonly Metadata[] = [], unresolved: readonly string[] = [], commands: readonly StoryCommand[] = [], blocked: readonly string[] = []): StoryEffect {
  return Object.freeze({ state, changes: Object.freeze([...changes]), unresolved: Object.freeze([...unresolved]), commands: Object.freeze([...commands]), blocked: Object.freeze([...blocked]) });
}
const change = (kind: string, data: Metadata) => Object.freeze({ kind, ...data });
const named = (row: Metadata | undefined) => ({ labelKey: typeof row?.Name === 'string' ? row.Name : undefined });

/** Group and individual IDs are separate namespaces. Preflight every member
 * before applying any; a locked role blocks its whole reward group. */
export function applyRewardGroup(state: StoryState, groupId: number | string, source: StorySource): StoryEffect {
  const group = source.rewardGroups[String(groupId)];
  if (!Array.isArray(group?.RewardIds) || !group.RewardIds.length) return storyEffect(state, [], [`Reward group ${groupId} is unavailable or empty.`]);
  const rewards = group.RewardIds.map(id => source.rewards[String(id)]);
  const unresolved: string[] = [], blocked: string[] = [];
  for (let i = 0; i < rewards.length; i++) {
    const r = rewards[i], target = sourceInteger(r?.TargetId), value = sourceInteger(r?.Value);
    if (!r || target === null || value === null) { unresolved.push(`Reward ${group.RewardIds[i]} has an invalid definition.`); continue; }
    if (r.RewardType === 0) { if (!source.attrs?.[String(target)] || state.attributes[String(target)] === undefined) unresolved.push(`Attribute ${target} baseline is unavailable.`); }
    else if (r.RewardType === 1) { const role = state.favor[String(target)]; if (!source.roles?.[String(target)] || !role) unresolved.push(`Favor ${target} baseline is unavailable.`); else if (!role.unlocked) blocked.push(`Role ${target} has not been unlocked.`); }
    else if (r.RewardType === 2) { if (!source.items[String(target)] || value <= 0 || (sourceInteger(source.items[String(target)].StackLimit) ?? 0) <= 0) unresolved.push(`Reward ${r.Id} has an invalid item definition.`); }
    else if (r.RewardType === 4) { if (!source.buffs?.[String(target)] || value <= 0) unresolved.push(`Buff ${target} definition is unavailable.`); }
    else unresolved.push(`Reward type ${String(r.RewardType)} has unverified semantics.`);
  }
  if (unresolved.length || blocked.length) return storyEffect(state, [], unresolved, [], blocked);
  let next = state;
  const changes: Metadata[] = [];
  for (const r of rewards) {
    const id = String(r.TargetId), value = Number(r.Value), identity = { rewardId: r.Id, rewardGroupId: group.Id };
    if (r.RewardType === 0) {
      const effect = applyAttributeDelta(next, Number(r.TargetId), value, source);
      next = effect.state; changes.push(...effect.changes.map(c => change(String(c.kind), { ...c, ...identity })));
    } else if (r.RewardType === 1) {
      const before = next.favor[id], cap = favorCap(source, id, before.level), level = favorLevelRow(source, id, before.level + 1);
      if (cap === null) { unresolved.push(`Favor cap for role ${id} is unavailable.`); continue; }
      const eligible = evaluateConditionGroup(Number(level?.PreUnlockConditionId ?? 0), next, source);
      if (value > 0 && eligible.value !== 'true') { if (eligible.value === 'unknown') unresolved.push(...eligible.reasons); continue; }
      const points = Math.max(0, Math.min(cap, before.points + value));
      if (points !== before.points) {
        next = Object.freeze({ ...next, favor: freezeMap({ ...next.favor, [id]: Object.freeze({ ...before, points }) }) });
        changes.push(change('favor', { roleId: Number(id), before: before.points, after: points, value: points - before.points, ...named(source.roles?.[id]), ...identity }));
      }
    } else if (r.RewardType === 2) {
      const cap = Number(source.items[id].StackLimit), before = next.items[id] ?? { min: 0, max: next.initialized ? 0 : null };
      const min = Math.min(cap, before.min + value), max = before.max === null ? min === cap ? cap : null : Math.min(cap, before.max + value);
      const bounds = Object.freeze({ min, max });
      next = Object.freeze({ ...next, items: freezeMap({ ...next.items, [id]: bounds }), acquiredItems: freezeMap({ ...next.acquiredItems, [id]: true }) });
      const actual = before.max === before.min ? min - before.min : value;
      if (actual > 0) changes.push(change('item', { itemId: Number(id), value: actual, before: before.min, after: min, bounds, ...named(source.items[id]), ...identity }));
    } else if (r.RewardType === 4 && !next.buffs[id]) {
      next = Object.freeze({ ...next, buffs: freezeMap({ ...next.buffs, [id]: Object.freeze({ acquiredDay: next.dayIndex }) }) });
      changes.push(change('buff', { buffId: Number(id), ...identity }));
    }
  }
  return storyEffect(next, changes, unresolved);
}
export function applyAttributeDelta(state: StoryState, attributeId: number, value: number, source: StorySource): StoryEffect {
  const id = String(attributeId), row = source.attrs?.[id], before = state.attributes[id];
  const min = sourceInteger(row?.MinValue), max = sourceInteger(row?.MaxValue);
  if (before === undefined || min === null || max === null || !Number.isSafeInteger(value)) return storyEffect(state, [], [`Attribute ${id} baseline or bounds are unavailable.`]);
  const after = Math.max(min, Math.min(max, before + value));
  if (after === before) return storyEffect(state);
  return storyEffect(Object.freeze({ ...state, attributes: freezeMap({ ...state.attributes, [id]: after }) }), [change('attribute', { attributeId, before, after, value: after - before, ...named(row) })]);
}
export function applyFavorLevel(state: StoryState, roleId: number, source: StorySource): StoryEffect {
  const id = String(roleId), current = state.favor[id];
  if (!current || !source.roles?.[id]) return storyEffect(state, [], [`Favor baseline for role ${id} is unavailable.`]);
  let next = Object.freeze({ ...state, favor: freezeMap({ ...state.favor, [id]: Object.freeze({ ...current, unlocked: true }) }) });
  const changes: Metadata[] = [], unresolved: string[] = [];
  for (let limit = 0; limit < Number(source.roles[id].MaxFavorLevel); limit++) {
    const before = next.favor[id], row = favorLevelRow(source, id, before.level + 1), cap = favorCap(source, id, before.level);
    if (!row || cap === null || before.points < cap) break;
    const condition = evaluateConditionGroup(Number(row.PreUnlockConditionId ?? 0), next, source);
    if (condition.value !== 'true') { if (condition.value === 'unknown') unresolved.push(...condition.reasons); break; }
    const level = before.level + 1;
    next = Object.freeze({ ...next, favor: freezeMap({ ...next.favor, [id]: Object.freeze({ unlocked: true, level, points: 0 }) }) });
    changes.push(change('favorLevel', { roleId, before: before.level, after: level, ...named(source.roles[id]), tierLabelKey: `SolarSchool_humanitiesClassFavor_${level}`, descriptionKey: row.SkillDesc }));
    if (Number(row.UnlockRewardId)) {
      const effect = applyRewardGroup(next, Number(row.UnlockRewardId), source);
      next = effect.state; changes.push(...effect.changes); unresolved.push(...effect.unresolved);
    }
  }
  return storyEffect(next, changes, unresolved);
}
/** The original PlotOptionId/PlotKeyId records are read history, not AVG flags. */
export function recordStoryChoice(state: StoryState, scriptId: string, optionId: number | null): StoryState {
  if (optionId === null) return state;
  return Object.freeze({ ...state, choices: freezeMap({ ...state.choices, [`${scriptId}:${optionId}`]: true }) });
}
export function recordPlotKey(state: StoryState, scriptId: string, plotKeyId: unknown): StoryState {
  if (sourceInteger(plotKeyId) === null) return state;
  return Object.freeze({ ...state, plotKeys: freezeMap({ ...state.plotKeys, [`${scriptId}:${plotKeyId}`]: true }) });
}

export function applyActivityAction(state: StoryState, actionId: number, source: StorySource, eventKey?: string): StoryEffect {
  if (eventKey && state.applied[eventKey]) return storyEffect(state);
  const action = source.actions[String(actionId)], p = sourceParams(action?.ActionParams);
  if (!action || !p) return storyEffect(state, [], [`ActivityAction ${actionId} definition is unavailable.`]);
  let effect: StoryEffect;
  switch (action.ActionType) {
    case 1: case 14: effect = sourceInteger(p.SolarSchoolFlow) === null ? storyEffect(state, [], ['Invalid flow action.']) : storyEffect(state, [], [], [{ kind: 'flow', flowId: Number(p.SolarSchoolFlow) }]); break;
    case 2: effect = sourceInteger(p.SolarSchoolRewardId) === null ? storyEffect(state, [], ['Invalid reward action.']) : applyRewardGroup(state, p.SolarSchoolRewardId, source); break;
    case 9: effect = sourceInteger(p.SolarSchoolRoleId) === null ? storyEffect(state, [], ['Invalid favor action.']) : applyFavorLevel(state, Number(p.SolarSchoolRoleId), source); break;
    case 13: {
      const assignments = (p.Params ?? '').split('|').map(s => s.trim().split('=').map(v => v.trim()));
      if (!assignments.length || assignments.some(a => a.length !== 2 || !/^key\d+$/.test(a[0]) || !['true', 'false'].includes(a[1]))) { effect = storyEffect(state, [], ['Unsupported AVG assignments.']); break; }
      const variables = { ...state.variables }, changes: Metadata[] = [];
      for (const [key, value] of assignments) { const next = value === 'true'; if (variables[key] !== next) changes.push(change('variable', { key, value: next, actionId })); variables[key] = next; }
      effect = storyEffect(Object.freeze({ ...state, variables: freezeMap(variables) }), changes); break;
    }
    case 16: effect = sourceInteger(p.SolarSchoolBehaviorId) === null ? storyEffect(state, [], ['Invalid request acceptance action.']) : storyEffect(state, [], [], [{ kind: 'requestAccept', behaviorId: Number(p.SolarSchoolBehaviorId) }]); break;
    case 3: effect = sourceInteger(p.SolarSchoolBehaviorId) === null ? storyEffect(state, [], ['Invalid behavior action.']) : storyEffect(state, [], [], [{ kind: 'behavior', behaviorId: Number(p.SolarSchoolBehaviorId) }]); break;
    case 17: effect = sourceInteger(p.LocationId) === null ? storyEffect(state, [], ['Invalid shop action.']) : storyEffect(state, [], [], [{ kind: 'shop', locationId: Number(p.LocationId) }]); break;
    case 19: effect = sourceInteger(p.SolarSchoolRoleId) === null ? storyEffect(state, [], ['Invalid gift action.']) : storyEffect(state, [], [], [{ kind: 'gift', roleId: Number(p.SolarSchoolRoleId) }]); break;
    case 20: {
      const month = sourceInteger(p.Month), day = sourceInteger(p.Day), slot = sourceInteger(p.SolarSchoolTimeSlot);
      if (month === null || day === null || slot === null) { effect = storyEffect(state, [], ['Invalid ending presentation date.']); break; }
      const index = Math.round((Date.UTC(2024, month - 1, day) - Date.UTC(2024, 2, 15)) / 86400000) + 1;
      effect = storyEffect(Object.freeze({ ...state, dayIndex: index, timeSlot: slot })); break;
    }
    case 24: {
      const ids = sourceList(p.SolarSchoolLocationIds);
      if (!ids) { effect = storyEffect(state, [], ['Invalid location unlock action.']); break; }
      if (ids.some(id => !source.locations?.[String(id)])) { effect = storyEffect(state, [], ['A location notification names an unavailable location.']); break; }
      effect = storyEffect(state, ids.map(locationId => change('locationUnlocked', { locationId, ...named(source.locations![String(locationId)]) }))); break;
    }
    case 22: {
      const id = p.InfluenceId, level = sourceInteger(p.Level);
      effect = level === null || !source.influences?.[id] ? storyEffect(state, [], ['Invalid influence assignment.']) : storyEffect(Object.freeze({ ...state, influences: freezeMap({ ...state.influences, [id]: level }) }), [change('influence', { influenceId: Number(id), value: level })]); break;
    }
    case 26: {
      const ids = sourceList(p.AttrType);
      effect = !ids ? storyEffect(state, [], ['Invalid important attribute list.']) : storyEffect(Object.freeze({ ...state, importantAttributes: Object.freeze(ids) })); break;
    }
    case 11: effect = sourceInteger(p.EndingType) === null ? storyEffect(state, [], ['Invalid ending selection action.']) : storyEffect(state, [], [], [{ kind: 'selectEnding', endingType: Number(p.EndingType) }]); break;
    case 27: effect = sourceInteger(p.TargetDayIndex) === null ? storyEffect(state, [], ['Invalid calendar jump.']) : storyEffect(state, [], [], [{ kind: 'jumpDay', dayIndex: Number(p.TargetDayIndex) }]); break;
    case 4: effect = sourceInteger(p.Id) === null ? storyEffect(state, [], ['Invalid event check.']) : storyEffect(state, [], [], [{ kind: 'eventCheck', id: Number(p.Id) }]); break;
    case 5: {
      const ids = Object.values(p).flatMap(value => value.trim().replace(/^[\[\]]+|[\[\]]+$/g, '').split(',').filter(value => value.trim()).map(value => sourceInteger(value.trim())).filter((id): id is number => id !== null));
      effect = !ids.length ? storyEffect(state, [], ['Affairs action has no parsed IDs.']) : storyEffect(state, [], [], ids.map(id => ({ kind: 'affairs', id }))); break;
    }
    case 15: case 18: {
      const kind = action.ActionType === 15 ? 'scratch' : 'raffle';
      effect = sourceInteger(p.Id) === null ? storyEffect(state, [], [`Invalid ${kind} action.`]) : storyEffect(state, [], [], [{ kind, id: Number(p.Id) }]); break;
    }
    // Display actions observe rewards; they cannot grant them again.
    case 6: case 7: case 8: case 10: case 12: case 21: case 23: case 25: case 28: effect = storyEffect(state, [], [], [{ kind: 'presentation', actionId }]); break;
    default: effect = storyEffect(state, [], [`ActivityAction ${actionId} type ${String(action.ActionType)} has unverified execution semantics.`]);
  }
  const next = eventKey ? Object.freeze({ ...effect.state, applied: freezeMap({ ...effect.state.applied, [eventKey]: true }) }) : effect.state;
  return storyEffect(next, effect.changes.map(c => change(String(c.kind), { ...c, actionId })), effect.unresolved, effect.commands, effect.blocked);
}

export function validateStorySource(value: unknown): StorySource {
  const x = sourceRecord(value);
  if (x?.schema !== 1) throw new Error('Story source schema 1 is required.');
  for (const key of ['actions', 'rewards', 'rewardGroups', 'items', 'conditions', 'groups']) if (!sourceRecord(x[key])) throw new Error(`Invalid story source table: ${key}`);
  for (const [key, value] of Object.entries(x)) {
    if (key === 'schema' || key === 'activity') continue;
    const table = sourceRecord(value);
    if (!table || Object.entries(table).some(([id, row]) => !/^\d+$/.test(id) || !sourceRecord(row) || String(sourceRecord(row)?.[key === 'scratchTickets' ? 'RoundId' : 'Id']) !== id)) throw new Error(`Invalid story source table: ${key}`);
  }
  return value as StorySource;
}
