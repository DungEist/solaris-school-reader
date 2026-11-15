import type { Metadata } from './types.ts';
import type { ConditionResult, ItemQuantity, StoryEffect, StorySource, StoryState } from './StoryState.ts';
import { applyAttributeDelta, conditionResult, sourceInteger, storyEffect } from './StoryState.ts';
import { effectiveAttributes, mechanicUnavailable, mechanicValue } from './StoryAttributes.ts';
import type { MechanicValue } from './StoryAttributes.ts';

const INT_MAX = 2147483647;
const integer = (value: unknown) => sourceInteger(value);
const unknown = (reason: string) => conditionResult('unknown', reason);
const denied = (reason: string) => conditionResult('false', reason);
const applied = (state: StoryState, key?: string) => !!key && !!state.applied[key];
const marked = (state: StoryState, key: string): StoryState => Object.freeze({ ...state, applied: Object.freeze({ ...state.applied, [key]: true }) });
const rejected = (state: StoryState, condition: ConditionResult): StoryEffect => storyEffect(state, [], condition.value === 'unknown' ? condition.reasons : [], [], condition.value === 'false' ? condition.reasons : []);
const named = (row: Metadata | undefined) => ({ labelKey: typeof row?.Name === 'string' ? row.Name : '' });
const itemQuantity = (state: StoryState, itemId: number): ItemQuantity | undefined => state.items[String(itemId)] ?? (state.initialized ? { min: 0, max: 0 } : undefined);

export interface StoryGameCost { readonly kind: 'item' | 'attribute'; readonly targetId: number; readonly amount: number; readonly delta: number; readonly labelKey: string; }
export interface GameCostChoice { readonly cost: StoryGameCost | null; readonly condition: ConditionResult; }
function costDefinition(kind: StoryGameCost['kind'], targetId: unknown, delta: unknown, source: StorySource): MechanicValue<StoryGameCost> {
  const id = integer(targetId), value = integer(delta);
  const row = id === null ? undefined : kind === 'item' ? source.items[String(id)] : source.attrs?.[String(id)];
  if (id === null || value === null || !row) return mechanicUnavailable('Game cost definition is unavailable.');
  return mechanicValue(Object.freeze({ kind, targetId: id, delta: value, amount: Math.abs(value), ...named(row) }));
}
export function gameCostEligibility(state: StoryState, cost: StoryGameCost, source: StorySource): ConditionResult {
  if (cost.kind === 'attribute') {
    const attributes = effectiveAttributes(state, source), value = attributes.value?.[String(cost.targetId)];
    if (value === undefined) return Object.freeze({ value: 'unknown', reasons: attributes.unresolved.length ? attributes.unresolved : [`Game currency ${cost.targetId} baseline is unavailable.`] });
    return value >= cost.amount ? conditionResult('true') : denied('There is not enough currency.');
  }
  const bounds = itemQuantity(state, cost.targetId);
  if (bounds && bounds.min >= cost.amount) return conditionResult('true');
  return bounds?.max !== null && bounds?.max !== undefined && bounds.max < cost.amount ? denied('There are not enough tickets.') : unknown(`Game item ${cost.targetId} inventory is unavailable.`);
}
function chooseCost(state: StoryState, primary: MechanicValue<StoryGameCost>, secondary: MechanicValue<StoryGameCost>, source: StorySource): GameCostChoice {
  if (!primary.value) return Object.freeze({ cost: null, condition: Object.freeze({ value: 'unknown', reasons: primary.unresolved }) });
  const first = gameCostEligibility(state, primary.value, source);
  if (first.value !== 'false') return Object.freeze({ cost: first.value === 'true' ? primary.value : null, condition: first });
  if (!secondary.value) return Object.freeze({ cost: null, condition: Object.freeze({ value: 'unknown', reasons: secondary.unresolved }) });
  const second = gameCostEligibility(state, secondary.value, source);
  return Object.freeze({ cost: second.value === 'true' ? secondary.value : null, condition: second });
}
function changeItem(state: StoryState, itemId: number, delta: number, source: StorySource): StoryEffect {
  const id = String(itemId), row = source.items[id], cap = integer(row?.StackLimit);
  if (!row || cap === null || cap <= 0) return storyEffect(state, [], [`Game item ${id} definition is unavailable.`]);
  const before = itemQuantity(state, itemId) ?? { min: 0, max: null };
  if (delta < 0 && before.min < -delta) return storyEffect(state, [], [`Game item ${id} cost baseline is unavailable.`]);
  const min = Math.max(0, Math.min(cap, before.min + delta));
  const max = before.max === null ? min === cap ? cap : null : Math.max(0, Math.min(cap, before.max + delta));
  const bounds = Object.freeze({ min, max }), actual = before.min === before.max ? min - before.min : delta;
  const next = Object.freeze({ ...state, items: Object.freeze({ ...state.items, [id]: bounds }), acquiredItems: delta > 0 ? Object.freeze({ ...state.acquiredItems, [id]: true }) : state.acquiredItems });
  return storyEffect(next, actual ? [{ kind: 'item', itemId, value: actual, before: before.min, after: min, bounds, ...named(row) }] : []);
}
function consumeCost(state: StoryState, cost: StoryGameCost, source: StorySource): StoryEffect {
  return cost.kind === 'attribute' ? applyAttributeDelta(state, cost.targetId, cost.delta, source) : changeItem(state, cost.targetId, cost.delta, source);
}

export interface ScratchPending { readonly eventKey: string; readonly rewardIds: readonly number[]; readonly indices: readonly number[]; }
export interface ScratchBoard { readonly roundId: number; readonly rewards: readonly number[]; readonly revealed: Readonly<Record<string, boolean>>; readonly counter: number; readonly revCounter: number; readonly pending?: ScratchPending; }
export type ScratchDraw = number | ((cellIndex: number) => number);
const getBoard = (state: StoryState, roundId: number): ScratchBoard | undefined => state.scratchBoards[String(roundId)];
function readScratchCost(rewardId: unknown, source: StorySource): MechanicValue<StoryGameCost> {
  const id = integer(rewardId), row = id === null ? undefined : source.rewards[String(id)];
  if (!row) return mechanicUnavailable(`Scratch cost reward ${String(rewardId)} is unavailable.`);
  if (row.RewardType !== 0 && row.RewardType !== 2) return mechanicUnavailable(`Scratch cost reward ${id} type ${String(row.RewardType)} is unsupported by the native cost reader.`);
  return costDefinition(row.RewardType === 2 ? 'item' : 'attribute', row.TargetId, row.Value, source);
}
/** CostId1/2 are individual reward IDs. Native consumes a ticket first and
 * requests currency confirmation only when a ticket cannot be consumed. */
export function scratchCostChoice(state: StoryState, roundId: number, source: StorySource): GameCostChoice {
  const row = source.scratchTickets?.[String(roundId)];
  if (!row) return Object.freeze({ cost: null, condition: unknown(`Scratch round ${roundId} definition is unavailable.`) });
  return chooseCost(state, readScratchCost(row.CostId1, source), readScratchCost(row.CostId2, source), source);
}
function readerSequence(draw: ScratchDraw): ((index: number) => number) | null {
  if (typeof draw === 'function') return draw;
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) return null;
  let seed = Math.floor(draw * 4294967296) || 1;
  // Reader policy: retain a deterministic sequence. Native uses Random.Shared.
  return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
}
/** Scratch Weight is a count of copies in a finite pool. Select with the
 * remaining counts, decrement once, then place the individual reward ID. */
export function generateScratchBoard(roundId: number, source: StorySource, draw: ScratchDraw): MechanicValue<ScratchBoard> {
  const config = source.scratchTickets?.[String(roundId)], size = integer(config?.Size), nextDraw = readerSequence(draw);
  if (!config || size === null || size <= 0 || size > 100 || !source.scratchRewards || !nextDraw) return mechanicUnavailable(`Scratch round ${roundId} configuration or Reader random draw is unavailable.`);
  const rows = Object.values(source.scratchRewards).filter(row => row.RoundId === roundId);
  const pool: { rewardId: number; count: number }[] = [], unresolved: string[] = [];
  for (const row of rows) {
    const rewardId = integer(row.RewardId), count = integer(row.Weight);
    if (rewardId === null || count === null) return mechanicUnavailable(`Scratch pool row ${row.Id} definition is invalid.`);
    if (rewardId > 0 && count > 0) pool.push({ rewardId, count });
  }
  const rewards = Array<number>(size * size).fill(0);
  for (let index = 0; index < rewards.length; index++) {
    const total = pool.reduce((sum, row) => sum + row.count, 0);
    if (!total) break;
    const value = nextDraw(index);
    if (!Number.isFinite(value) || value < 0 || value >= 1 || !Number.isSafeInteger(total)) return mechanicUnavailable('Scratch Reader draws must be in [0,1) and its reward pool must be finite.');
    let cursor = Math.floor(value * total), selected = pool[0];
    for (const row of pool) { if (cursor < row.count) { selected = row; break; } cursor -= row.count; }
    selected.count--;
    const reward = source.rewards[String(selected.rewardId)];
    if (!reward) unresolved.push(`Scratch reward ${selected.rewardId} definition is unavailable; the native board skips this cell's reward.`);
    else if (reward.RewardType !== 0 && reward.RewardType !== 2) unresolved.push(`Scratch reward ${selected.rewardId} type ${String(reward.RewardType)} is skipped by the native board.`);
    else rewards[index] = selected.rewardId;
  }
  return mechanicValue(Object.freeze({ roundId, rewards: Object.freeze(rewards), revealed: Object.freeze({}), counter: 0, revCounter: 0 }), unresolved);
}
export function ensureScratchBoard(state: StoryState, roundId: number, source: StorySource, draw: ScratchDraw, eventKey?: string): StoryEffect {
  if (applied(state, eventKey) || getBoard(state, roundId)) return storyEffect(state);
  const board = generateScratchBoard(roundId, source, draw);
  if (!board.value) return storyEffect(state, [], board.unresolved);
  const next: StoryState = Object.freeze({ ...state, scratchBoards: Object.freeze({ ...state.scratchBoards, [String(roundId)]: board.value }) });
  return storyEffect(eventKey ? marked(next, eventKey) : next, [{ kind: 'scratchBoard', roundId, size: source.scratchTickets![String(roundId)].Size, randomPolicy: 'Reader deterministic draws; native uses Random.Shared.' }], board.unresolved);
}
export function scratchCellEligibility(state: StoryState, roundId: number, index: number, source: StorySource): ConditionResult {
  const board = getBoard(state, roundId);
  if (!board) return unknown(`Scratch round ${roundId} board has not been prepared.`);
  if (board.pending) return denied('Finish the current reveal first.');
  if (!Number.isSafeInteger(index) || index < 0 || index >= board.rewards.length) return denied('This scratch cell is outside the board.');
  if (board.revealed[String(index)]) return denied('This scratch cell has already been revealed.');
  return scratchCostChoice(state, roundId, source).condition;
}
export interface ScratchCellChoice { readonly index: number; readonly row: number; readonly column: number; readonly revealed: boolean; readonly condition: ConditionResult; readonly rewardId?: number; }
export function scratchCellChoices(state: StoryState, roundId: number, source: StorySource): MechanicValue<readonly ScratchCellChoice[]> {
  const board = getBoard(state, roundId), size = integer(source.scratchTickets?.[String(roundId)]?.Size);
  if (!board || size === null || size <= 0) return mechanicUnavailable(`Scratch round ${roundId} board is unavailable.`);
  return mechanicValue(Object.freeze(board.rewards.map((rewardId, index) => Object.freeze({ index, row: Math.floor(index / size) + 1, column: index % size + 1, revealed: !!board.revealed[String(index)], condition: scratchCellEligibility(state, roundId, index, source), ...(board.revealed[String(index)] ? { rewardId } : {}) }))));
}
export interface ScratchRevealPlan { readonly type: number; readonly counter: number; readonly revCounter: number; readonly indices: readonly number[]; }
/** Type4's source order is center, left/right/top/bottom, then the diagonals.
 * Its animation lists preview these neighbors twice; Unlock deduplicates them. */
export function scratchRevealPlan(board: ScratchBoard, index: number, source: StorySource, draw: number): MechanicValue<ScratchRevealPlan> {
  const config = source.scratchTickets?.[String(board.roundId)], size = integer(config?.Size), minimum = integer(config?.MinCondition), maximum = integer(config?.MaxCondition), probability = integer(config?.Probability), configuredType = integer(config?.Type);
  if (!config || size === null || minimum === null || maximum === null || probability === null || configuredType === null || !Number.isFinite(draw) || draw < 0 || draw >= 1) return mechanicUnavailable('Scratch reveal conditions or Reader draw are unavailable.');
  const pity = board.counter >= minimum || Math.floor(draw * 100) < probability && board.revCounter < maximum;
  const type = pity ? configuredType : 0;
  if (type !== 0 && type !== 4) return mechanicUnavailable(`Scratch reveal type ${type} geometry has not been verified for this dataset.`);
  const row = Math.floor(index / size), column = index % size;
  const offsets = type === 0 ? [[0, 0]] : [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  const indices = offsets.flatMap(([r, c]) => { const y = row + r, x = column + c; return y < 0 || x < 0 || y >= size || x >= size ? [] : [y * size + x]; }).filter(id => !board.revealed[String(id)]);
  return mechanicValue(Object.freeze({ type, counter: pity ? 0 : board.counter + 1, revCounter: pity ? board.revCounter + 1 : 0, indices: Object.freeze(indices) }));
}
/** HandleCostAndReveal -> EnterPlayReveal: charge and lock in the pending
 * reward list. Received-item events deliberately wait for settleScratchReveal. */
export function beginScratchReveal(state: StoryState, roundId: number, index: number, source: StorySource, draw: number, eventKey?: string): StoryEffect {
  const key = eventKey ?? `scratch:${roundId}:cell:${index}`;
  if (applied(state, key)) return storyEffect(state);
  const eligibility = scratchCellEligibility(state, roundId, index, source);
  if (eligibility.value !== 'true') return rejected(state, eligibility);
  const board = getBoard(state, roundId)!, plan = scratchRevealPlan(board, index, source, draw);
  if (!plan.value) return storyEffect(state, [], plan.unresolved);
  const cost = scratchCostChoice(state, roundId, source).cost!, consumed = consumeCost(state, cost, source);
  if (consumed.unresolved.length) return consumed;
  const revealed = Object.freeze({ ...board.revealed, ...Object.fromEntries(plan.value.indices.map(id => [String(id), true])) });
  const pending = Object.freeze({ eventKey: key, indices: plan.value.indices, rewardIds: Object.freeze(plan.value.indices.map(id => board.rewards[id]).filter(Boolean)) });
  const nextBoard: ScratchBoard = Object.freeze({ ...board, counter: plan.value.counter, revCounter: plan.value.revCounter, revealed, pending });
  const next: StoryState = Object.freeze({ ...consumed.state, scratchBoards: Object.freeze({ ...consumed.state.scratchBoards, [String(roundId)]: nextBoard }) });
  return storyEffect(marked(next, key), [...consumed.changes, { kind: 'scratchReveal', roundId, index, indices: plan.value.indices, type: plan.value.type, cost: cost.amount, costKind: cost.kind }]);
}
function giveScratchRewards(state: StoryState, ids: readonly number[], source: StorySource): StoryEffect {
  const rows = ids.map(id => source.rewards[String(id)]), unresolved: string[] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], target = integer(row?.TargetId), value = integer(row?.Value);
    if (!row || target === null || value === null) { unresolved.push(`Scratch reward ${ids[index]} definition is unavailable.`); continue; }
    if (row.RewardType === 0) { if (!source.attrs?.[String(target)] || state.attributes[String(target)] === undefined) unresolved.push(`Scratch attribute ${target} baseline is unavailable.`); }
    else if (row.RewardType === 2) { if (!source.items[String(target)] || value <= 0 || (integer(source.items[String(target)].StackLimit) ?? 0) <= 0) unresolved.push(`Scratch item reward ${row.Id} definition is invalid.`); }
    else unresolved.push(`Scratch reward ${row.Id} type ${String(row.RewardType)} is unsupported.`);
  }
  if (unresolved.length) return storyEffect(state, [], unresolved);
  let next = state;
  const changes: Metadata[] = [];
  for (const row of rows) {
    const result = row.RewardType === 0 ? applyAttributeDelta(next, Number(row.TargetId), Number(row.Value), source) : changeItem(next, Number(row.TargetId), Number(row.Value), source);
    next = result.state; changes.push(...result.changes.map(change => ({ ...change, rewardId: row.Id }))); unresolved.push(...result.unresolved);
  }
  return storyEffect(next, changes, unresolved);
}
/** Native OnRevealAnimFinished (0x0603850A) grants PendingRewards, clears them,
 * then selects ShowResult if the board is finished, otherwise WaitScratch. */
export function settleScratchReveal(state: StoryState, roundId: number, source: StorySource, eventKey?: string): StoryEffect {
  const board = getBoard(state, roundId), pending = board?.pending;
  if (!board || !pending) return storyEffect(state);
  const key = eventKey ?? `${pending.eventKey}:reward`;
  if (applied(state, key)) return storyEffect(state);
  const effect = giveScratchRewards(state, pending.rewardIds, source);
  const { pending: _pending, ...settled } = board;
  const next: StoryState = Object.freeze({ ...effect.state, scratchBoards: Object.freeze({ ...effect.state.scratchBoards, [String(roundId)]: Object.freeze(settled) }) });
  const finished = board.rewards.every((_, index) => board.revealed[String(index)]);
  return storyEffect(marked(next, key), [...effect.changes, ...(finished ? [{ kind: 'scratchComplete', roundId }] : [])], effect.unresolved);
}

export type RaffleFilter = 'all' | 'nonS' | 'onlyS';
export interface RaffleProgress { readonly drawn: number; readonly total: number; readonly noSCount: number; readonly finished: boolean; }
export interface RaffleAwardChoice { readonly groupId: number; readonly itemId: number; readonly rank: number; readonly remaining: number; readonly weight: number; }
function raffleRows(activityId: number, source: StorySource): MechanicValue<readonly Metadata[]> {
  const config = source.prizeActivities?.[String(activityId)], amount = integer(config?.AwardsAmount);
  if (!config || amount === null || amount < 0 || amount > 10000 || !source.prizeAwards) return mechanicUnavailable(`Raffle ${activityId} award configuration is unavailable.`);
  const rows: Metadata[] = [], unresolved: string[] = [];
  for (let id = 1; id <= amount; id++) {
    const row = source.prizeAwards[String(id)];
    if (!row) unresolved.push(`Raffle award group ${id} definition is unavailable.`);
    else rows.push(row);
  }
  return unresolved.length ? mechanicValue<readonly Metadata[]>(null, unresolved) : mechanicValue(Object.freeze(rows));
}
export function raffleProgress(state: StoryState, activityId: number, source: StorySource): MechanicValue<RaffleProgress> {
  const rows = raffleRows(activityId, source);
  if (!rows.value) return mechanicValue<RaffleProgress>(null, rows.unresolved);
  if (state.prizeNoSCount === null) return mechanicUnavailable('Raffle rare-prize counter is unavailable.');
  let drawn = 0, total = 0;
  for (const row of rows.value) {
    const count = integer(state.prizeDraws[String(row.Id)] ?? (state.initialized ? 0 : null)), amount = integer(row.Amount);
    if (count === null || amount === null || count < 0 || amount < 0) return mechanicUnavailable(`Raffle group ${row.Id} draw baseline is unavailable.`);
    drawn += count; total += amount;
  }
  return mechanicValue(Object.freeze({ drawn: Math.min(INT_MAX, drawn), total: Math.min(INT_MAX, total), noSCount: state.prizeNoSCount, finished: drawn >= total }));
}
export function raffleCostChoice(state: StoryState, activityId: number, source: StorySource): GameCostChoice {
  const config = source.prizeActivities?.[String(activityId)];
  if (!config) return Object.freeze({ cost: null, condition: unknown(`Raffle ${activityId} cost definition is unavailable.`) });
  const read = (type: unknown, id: unknown, amount: unknown): MechanicValue<StoryGameCost> => {
    const number = integer(amount);
    if (type !== 1 && type !== 2 || number === null || number <= 0) return mechanicUnavailable('Raffle cost currency is unsupported or invalid.');
    return costDefinition(type === 1 ? 'item' : 'attribute', id, -number, source);
  };
  return chooseCost(state, read(config.CostItem1Type, config.CostItem1Id, 1), read(config.CostItem2Type, config.CostItem2Id, config.CostItem2Num), source);
}
export function raffleDrawFilter(state: StoryState, activityId: number, source: StorySource): MechanicValue<RaffleFilter> {
  const progress = raffleProgress(state, activityId, source), config = source.prizeActivities?.[String(activityId)];
  const notS = integer(config?.NotSGroup), mustS = integer(config?.MustSGroup);
  if (!progress.value || notS === null || mustS === null) return mechanicValue<RaffleFilter>(null, progress.unresolved.length ? progress.unresolved : ['Raffle rare-prize conditions are invalid.']);
  return mechanicValue(progress.value.drawn < notS ? 'nonS' : mustS > 0 && progress.value.noSCount >= mustS ? 'onlyS' : 'all');
}
export function raffleAwardChoices(state: StoryState, activityId: number, source: StorySource, filter?: RaffleFilter): MechanicValue<readonly RaffleAwardChoice[]> {
  const rows = raffleRows(activityId, source), selected = filter ? mechanicValue(filter) : raffleDrawFilter(state, activityId, source);
  if (!rows.value || !selected.value) return mechanicValue<readonly RaffleAwardChoice[]>(null, [...rows.unresolved, ...selected.unresolved]);
  const choices: RaffleAwardChoice[] = [];
  for (const row of rows.value) {
    const groupId = integer(row.Id), itemId = integer(row.RewardId), rank = integer(row.Rank), amount = integer(row.Amount), weight = integer(row.Weight), count = integer(state.prizeDraws[String(row.Id)] ?? (state.initialized ? 0 : null));
    if (groupId === null || itemId === null || rank === null || rank < 0 || amount === null || weight === null || count === null) return mechanicUnavailable(`Raffle award ${row.Id} definition or draw baseline is unavailable.`);
    if (amount <= count || weight <= 0 || selected.value === 'onlyS' && rank !== 0 || selected.value === 'nonS' && rank === 0) continue;
    if (!source.items[String(itemId)]) return mechanicUnavailable(`Raffle reward item ${itemId} definition is unavailable.`);
    choices.push(Object.freeze({ groupId, itemId, rank, remaining: amount - count, weight }));
  }
  return mechanicValue(Object.freeze(choices));
}
export function raffleEligibility(state: StoryState, activityId: number, source: StorySource): ConditionResult {
  const progress = raffleProgress(state, activityId, source);
  if (!progress.value) return Object.freeze({ value: 'unknown', reasons: progress.unresolved });
  if (progress.value.finished) return denied('Every prize in this raffle has been drawn.');
  return raffleCostChoice(state, activityId, source).condition;
}
/** Native selects RandomSystem.GetRandomInteger()%totalWeight. Reader maps a
 * retained [0,1) draw onto that weight total; it does not reproduce a game seed.
 * Weight is flat per eligible group, and Amount is its finite supply. */
export function pickRaffleAward(state: StoryState, activityId: number, source: StorySource, draw: number): MechanicValue<RaffleAwardChoice> {
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) return mechanicUnavailable('Raffle Reader draw must be in [0,1).');
  let candidates = raffleAwardChoices(state, activityId, source);
  if (!candidates.value) return mechanicValue<RaffleAwardChoice>(null, candidates.unresolved);
  if (!candidates.value.length) candidates = raffleAwardChoices(state, activityId, source, 'all');
  if (!candidates.value) return mechanicValue<RaffleAwardChoice>(null, candidates.unresolved);
  const total = candidates.value.reduce((sum, row) => sum + row.weight, 0);
  if (!total || !Number.isSafeInteger(total)) return mechanicUnavailable('No raffle group has a positive eligible weight.');
  let cursor = Math.floor(draw * total);
  for (const row of candidates.value) { if (cursor < row.weight) return mechanicValue(row); cursor -= row.weight; }
  return mechanicUnavailable('Raffle selection did not resolve.');
}
/** Native Draw chooses a group before charging, adds ONE item, increments the
 * chosen group's draw count, emits the event, then updates the no-S counter. */
export function drawRaffle(state: StoryState, activityId: number, source: StorySource, draw: number, eventKey?: string): StoryEffect {
  if (applied(state, eventKey)) return storyEffect(state);
  const eligibility = raffleEligibility(state, activityId, source);
  if (eligibility.value !== 'true') return rejected(state, eligibility);
  const award = pickRaffleAward(state, activityId, source, draw);
  if (!award.value) return storyEffect(state, [], award.unresolved);
  const consumed = consumeCost(state, raffleCostChoice(state, activityId, source).cost!, source);
  if (consumed.unresolved.length) return consumed;
  const received = changeItem(consumed.state, award.value.itemId, 1, source);
  const groupId = String(award.value.groupId), count = state.prizeDraws[groupId] ?? 0;
  let next: StoryState = Object.freeze({ ...received.state, prizeDraws: Object.freeze({ ...received.state.prizeDraws, [groupId]: count + 1 }), prizeNoSCount: award.value.rank === 0 ? 0 : (state.prizeNoSCount ?? 0) + 1 });
  const key = eventKey ?? `raffle:${activityId}:${raffleProgress(state, activityId, source).value!.drawn}`;
  next = marked(next, key);
  return storyEffect(next, [...consumed.changes, ...received.changes, { kind: 'raffleDraw', activityId, groupId: award.value.groupId, itemId: award.value.itemId, rank: award.value.rank, quantity: 1, randomPolicy: 'Reader draw over authored weights; native uses an integer remainder.' }], received.unresolved);
}
