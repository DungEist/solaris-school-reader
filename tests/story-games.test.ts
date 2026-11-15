import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  beginScratchReveal, drawRaffle, ensureScratchBoard, generateScratchBoard,
  pickRaffleAward, raffleAwardChoices, raffleCostChoice, raffleDrawFilter,
  raffleEligibility, raffleProgress, scratchCellChoices, scratchCostChoice,
  scratchRevealPlan, settleScratchReveal,
} from '../src/engine/StoryGames.ts';
import { initialStoryState, validateStorySource } from '../src/engine/StoryState.ts';
import type { StorySource, StoryState } from '../src/engine/StoryState.ts';

const source = validateStorySource(JSON.parse(readFileSync(new URL('../public/data/maps/story-source.json', import.meta.url), 'utf8')));
const initial = () => initialStoryState(source);
const patch = (state: StoryState, changes: Partial<StoryState>): StoryState => Object.freeze({ ...state, ...changes });
const withTickets = (state: StoryState, count: number): StoryState => patch(state, {
  items: Object.freeze({ ...state.items, '48': Object.freeze({ min: count, max: count }) }),
  acquiredItems: Object.freeze({ ...state.acquiredItems, ...(count > 0 ? { '48': true } : {}) }),
});
const withMoney = (state: StoryState, amount: number): StoryState => patch(state, { attributes: Object.freeze({ ...state.attributes, '8': amount }) });
const preparedScratch = (tickets = 10): StoryState => ensureScratchBoard(withTickets(initial(), tickets), 1, source, () => 0, 'scratch:board').state;
const scratchItemCount = (state: StoryState): number => Object.entries(state.items).filter(([id]) => id !== '48').reduce((sum, [, bounds]) => sum + bounds.min, 0);

test('real scratch configuration keeps RoundId identity and a finite 49-copy reward pool', () => {
  assert.equal(source.scratchTickets?.['1'].RoundId, 1);
  assert.equal(source.scratchTickets?.['1'].Id, undefined);
  const generated = generateScratchBoard(1, source, () => 0);
  assert.deepEqual(generated.unresolved, []);
  assert.equal(generated.value?.rewards.length, 49);
  assert.equal(generated.value?.rewards[0], 50011);
  const counts = Object.fromEntries(Object.values(source.scratchRewards ?? {}).map(row => [String(row.RewardId), generated.value!.rewards.filter(id => id === row.RewardId).length]));
  assert.deepEqual(counts, { '50011': 1, '50012': 7, '50013': 5, '50014': 5, '50015': 5, '50016': 5, '50017': 10, '50018': 11 });
});

test('opening and reopening scratch tickets do not consume currency or grant prizes', () => {
  const checkpoint = withTickets(initial(), 2);
  const opened = ensureScratchBoard(checkpoint, 1, source, () => 0, 'scratch:open');
  assert.equal(opened.state.items['48'].min, 2);
  assert.equal(scratchItemCount(opened.state), 0);
  assert.equal(ensureScratchBoard(opened.state, 1, source, .99, 'scratch:reopen').state, opened.state);
  const restored: StoryState = JSON.parse(JSON.stringify(opened.state));
  assert.equal(ensureScratchBoard(restored, 1, source, .99, 'scratch:open').state, restored);
  assert.equal(scratchCellChoices(restored, 1, source).value?.some(cell => cell.rewardId !== undefined), false, 'Unrevealed cells do not expose the route reward layout.');
});

test('scratch costs resolve individual reward IDs and prefer one ticket over 3800 currency', () => {
  const ticket = scratchCostChoice(withMoney(withTickets(initial(), 1), 9000), 1, source);
  assert.equal(source.rewardGroups['50000'], undefined);
  assert.deepEqual(ticket.cost && { kind: ticket.cost.kind, targetId: ticket.cost.targetId, amount: ticket.cost.amount, delta: ticket.cost.delta }, { kind: 'item', targetId: 48, amount: 1, delta: -1 });
  const cash = scratchCostChoice(withMoney(initial(), 4000), 1, source);
  assert.deepEqual(cash.cost && { kind: cash.cost.kind, targetId: cash.cost.targetId, amount: cash.cost.amount, delta: cash.cost.delta }, { kind: 'attribute', targetId: 8, amount: 3800, delta: -3800 });
  assert.equal(scratchCostChoice(initial(), 1, source).condition.value, 'false');
});

test('the scratch reveal spends its ticket first and grants item19 only when the reveal finishes', () => {
  const checkpoint = preparedScratch(2);
  const begun = beginScratchReveal(checkpoint, 1, 0, source, .99, 'scratch:first');
  assert.equal(begun.state.items['48'].min, 1);
  assert.equal(begun.state.items['19'].min, 0);
  assert.deepEqual(begun.state.scratchBoards['1'].pending?.rewardIds, [50011]);
  assert.equal(begun.state.scratchBoards['1'].revealed['0'], true);
  assert.equal(begun.changes.some(change => change.kind === 'item' && change.itemId === 19), false);
  assert.equal(beginScratchReveal(begun.state, 1, 1, source, .99, 'scratch:whilePending').state, begun.state);
  const settled = settleScratchReveal(begun.state, 1, source);
  assert.deepEqual(settled.unresolved, []);
  assert.equal(settled.state.items['19'].min, 1);
  assert.equal(settled.state.acquiredItems['19'], true);
  assert.equal(settled.state.scratchBoards['1'].pending, undefined);
  assert.equal(settled.changes.find(change => change.kind === 'item')?.rewardId, 50011);
  assert.equal(settleScratchReveal(settled.state, 1, source).state, settled.state);
  assert.equal(beginScratchReveal(settled.state, 1, 0, source, .99, 'scratch:first').state, settled.state);
  assert.equal(beginScratchReveal(settled.state, 1, 0, source, .99, 'scratch:oldCell').state, settled.state);
  const restored: StoryState = JSON.parse(JSON.stringify(settled.state));
  assert.equal(settleScratchReveal(restored, 1, source).state, restored);
  assert.equal(restored.items['19'].min, 1);
});

test('two draws from the same scratch checkpoint preserve different reveals and later pity eligibility', () => {
  const checkpoint = preparedScratch(3);
  const normal = beginScratchReveal(checkpoint, 1, 24, source, .99, 'scratch:branch');
  const pity = beginScratchReveal(checkpoint, 1, 24, source, 0, 'scratch:branch');
  assert.deepEqual(normal.state.scratchBoards['1'].pending?.indices, [24]);
  assert.deepEqual(pity.state.scratchBoards['1'].pending?.indices, [24, 23, 25, 17, 31, 16, 30, 18, 32]);
  assert.equal(normal.state.items['48'].min, 2);
  assert.equal(pity.state.items['48'].min, 2, 'The whole nine-cell reveal costs one ticket.');
  const normalResult = settleScratchReveal(normal.state, 1, source).state;
  const pityResult = settleScratchReveal(pity.state, 1, source).state;
  assert.equal(scratchItemCount(normalResult), 1);
  assert.equal(scratchItemCount(pityResult), 9);
  assert.equal(scratchRevealPlan(normalResult.scratchBoards['1'], 40, source, 0).value?.type, 4);
  assert.equal(scratchRevealPlan(pityResult.scratchBoards['1'], 40, source, 0).value?.type, 0, 'MaxCondition1 prevents two consecutive chance pity reveals.');
});

test('six normal scratch reveals make the next NineGrid reveal mandatory even with a losing draw', () => {
  let state = preparedScratch();
  for (let index = 0; index < 6; index++) {
    state = beginScratchReveal(state, 1, index, source, .99, `scratch:normal:${index}`).state;
    state = settleScratchReveal(state, 1, source).state;
  }
  assert.equal(state.scratchBoards['1'].counter, 6);
  assert.equal(scratchRevealPlan(state.scratchBoards['1'], 24, source, .99).value?.type, 4);
  const forced = beginScratchReveal(state, 1, 24, source, .99, 'scratch:forced');
  assert.equal(forced.state.scratchBoards['1'].pending?.indices.length, 9);
  assert.equal(forced.state.scratchBoards['1'].counter, 0);
});

test('currency scratch fallback charges before its item grant and stops when neither cost is affordable', () => {
  const checkpoint = ensureScratchBoard(withMoney(initial(), 4000), 1, source, () => 0).state;
  const begun = beginScratchReveal(checkpoint, 1, 0, source, .99, 'scratch:cash');
  assert.equal(begun.state.attributes['8'], 200);
  assert.equal(begun.state.items['19'].min, 0);
  const settled = settleScratchReveal(begun.state, 1, source).state;
  assert.equal(settled.items['19'].min, 1);
  assert.equal(beginScratchReveal(settled, 1, 1, source, .99, 'scratch:poor').state, settled);
  const imported = patch(checkpoint, { initialized: false, items: { ...checkpoint.items, '48': { min: 0, max: null } } });
  assert.equal(scratchCostChoice(imported, 1, source).condition.value, 'unknown', 'Unknown primary ticket ownership cannot silently fall back to spending currency.');
});

test('one complete real scratch board gives its authored inventory exactly once and cannot reset on reopen', () => {
  let state = preparedScratch(99), paid = 0;
  while (paid < 49) {
    const cell = scratchCellChoices(state, 1, source).value?.find(cell => cell.condition.value === 'true');
    if (!cell) break;
    state = beginScratchReveal(state, 1, cell.index, source, .99, `scratch:complete:${paid}`).state;
    state = settleScratchReveal(state, 1, source).state;
    paid++;
  }
  assert.equal(Object.values(state.scratchBoards['1'].revealed).filter(Boolean).length, 49);
  assert.equal(scratchItemCount(state), 49);
  assert.equal(state.items['19'].min, 1);
  assert.equal(state.items['26'].min, 7);
  assert.equal(state.items['33'].min, 11);
  assert.equal(state.items['48'].min, 99 - paid);
  assert.equal(ensureScratchBoard(state, 1, source, .99, 'scratch:again').state, state);
  assert.equal(scratchCellChoices(state, 1, source).value?.some(cell => cell.condition.value === 'true'), false);
});

test('missing scratch reward definitions remain explicit and do not invent an item grant', () => {
  const { '50011': _missing, ...rewards } = source.rewards;
  const incomplete: StorySource = { ...source, rewards };
  const result = generateScratchBoard(1, incomplete, () => 0);
  assert.equal(result.value?.rewards[0], 0);
  assert.match(result.unresolved.join(' '), /Scratch reward 50011.*unavailable/);
});

test('real raffle awards form a finite 22-draw pool with flat eligible group weights', () => {
  assert.deepEqual(raffleProgress(initial(), 12001, source).value, { drawn: 0, total: 22, noSCount: 0, finished: false });
  assert.equal(raffleDrawFilter(initial(), 12001, source).value, 'nonS');
  assert.deepEqual(raffleAwardChoices(initial(), 12001, source).value?.map(row => [row.groupId, row.remaining, row.weight]), [[5, 3, 137], [6, 4, 182], [7, 5, 228], [8, 6, 273]]);
  const state = drawRaffle(withTickets(initial(), 5), 12001, source, 0, 'raffle:first').state;
  const group = raffleAwardChoices(state, 12001, source).value?.find(row => row.groupId === 5);
  assert.equal(group?.remaining, 2);
  assert.equal(group?.weight, 137, 'Weight does not multiply by the remaining stock.');
  assert.equal(state.items['27'].min, 1, 'Amount3 is the group supply, not three items per draw.');
});

test('raffle spends tickets first, releases S prizes after two draws, and resolves RewardId as an item ID', () => {
  let state = withMoney(withTickets(initial(), 3), 18000);
  assert.equal(raffleCostChoice(state, 12001, source).cost?.targetId, 48);
  state = drawRaffle(state, 12001, source, 0, 'raffle:1').state;
  assert.equal(state.attributes['8'], 18000);
  assert.equal(state.items['48'].min, 2);
  assert.equal(raffleDrawFilter(state, 12001, source).value, 'nonS');
  state = drawRaffle(state, 12001, source, 0, 'raffle:2').state;
  assert.equal(raffleDrawFilter(state, 12001, source).value, 'all');
  const third = drawRaffle(state, 12001, source, 0, 'raffle:3');
  assert.equal(third.state.prizeDraws['1'], 1);
  assert.equal(source.prizeAwards!['1'].RewardId, 23);
  assert.equal(third.state.items['23'].min, 1);
  assert.equal(third.state.prizeNoSCount, 0);
  assert.equal(drawRaffle(third.state, 12001, source, .99, 'raffle:3').state, third.state);
  const restored: StoryState = JSON.parse(JSON.stringify(third.state));
  assert.equal(drawRaffle(restored, 12001, source, .99, 'raffle:3').state, restored);
});

test('raffle guarantees an S prize after five consecutive non-S draws, then falls back if S stock is depleted', () => {
  let state = withTickets(initial(), 10);
  for (let index = 0; index < 5; index++) state = drawRaffle(state, 12001, source, .99, `raffle:nonS:${index}`).state;
  assert.equal(state.prizeNoSCount, 5);
  assert.equal(raffleDrawFilter(state, 12001, source).value, 'onlyS');
  assert.deepEqual(raffleAwardChoices(state, 12001, source).value?.map(row => row.groupId), [1, 2, 3, 4]);
  const guaranteed = drawRaffle(state, 12001, source, .99, 'raffle:S');
  assert.equal(guaranteed.state.prizeDraws['4'], 1);
  assert.equal(guaranteed.state.items['28'].min, 1);
  assert.equal(guaranteed.state.prizeNoSCount, 0);
  const depleted = patch(withTickets(initial(), 1), { prizeDraws: { '1': 1, '2': 1, '3': 1, '4': 1 }, prizeNoSCount: 5 });
  assert.equal(raffleDrawFilter(depleted, 12001, source).value, 'onlyS');
  assert.equal(pickRaffleAward(depleted, 12001, source, 0).value?.groupId, 5);
});

test('raffle currency fallback costs 9000 per draw and insufficient funds leave state untouched', () => {
  const checkpoint = withMoney(initial(), 18000);
  assert.deepEqual(raffleCostChoice(checkpoint, 12001, source).cost && { kind: raffleCostChoice(checkpoint, 12001, source).cost!.kind, amount: raffleCostChoice(checkpoint, 12001, source).cost!.amount }, { kind: 'attribute', amount: 9000 });
  const first = drawRaffle(checkpoint, 12001, source, 0, 'raffle:cash:1').state;
  assert.equal(first.attributes['8'], 9000);
  const second = drawRaffle(first, 12001, source, 0, 'raffle:cash:2').state;
  assert.equal(second.attributes['8'], 0);
  assert.equal(raffleEligibility(second, 12001, source).value, 'false');
  assert.equal(drawRaffle(second, 12001, source, 0, 'raffle:poor').state, second);
});

test('a complete real raffle exhausts every authored group and a new playthrough resets it', () => {
  let state = withTickets(initial(), 50);
  for (let index = 0; index < 22; index++) {
    const result = drawRaffle(state, 12001, source, .99, `raffle:complete:${index}`);
    assert.deepEqual(result.unresolved, []);
    assert.notEqual(result.state, state);
    state = result.state;
  }
  assert.equal(raffleProgress(state, 12001, source).value?.finished, true);
  assert.equal(state.items['48'].min, 28);
  assert.deepEqual(state.prizeDraws, { '1': 1, '2': 1, '3': 1, '4': 1, '5': 3, '6': 4, '7': 5, '8': 6 });
  assert.equal(state.items['23'].min, 1);
  assert.equal(state.items['28'].min, 3);
  assert.equal(drawRaffle(state, 12001, source, 0, 'raffle:exhausted').state, state);
  const fresh = initial();
  assert.deepEqual(fresh.prizeDraws, {});
  assert.equal(fresh.prizeNoSCount, 0);
  assert.deepEqual(fresh.scratchBoards, {});
  assert.equal(fresh.items['23'].min, 0);
});

test('unknown raffle progress or missing award definitions remain diagnostics and grant nothing', () => {
  const unknownState = patch(withTickets(initial(), 1), { prizeNoSCount: null });
  assert.equal(raffleEligibility(unknownState, 12001, source).value, 'unknown');
  assert.equal(drawRaffle(unknownState, 12001, source, 0, 'raffle:unknown').state, unknownState);
  const { '6': _missing, ...prizeAwards } = source.prizeAwards!;
  const incomplete: StorySource = { ...source, prizeAwards };
  assert.match(raffleProgress(initial(), 12001, incomplete).unresolved.join(' '), /Raffle award group 6.*unavailable/);
});
