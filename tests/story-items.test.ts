import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buyStoryGoods, currentShopPurchaseCount, ensureShopStock, generateShopGoods,
  giftChoices, giftEligibility, giftFavorValue, giveStoryGift, itemChoices,
  itemUseEligibility, nativeShopNextRandom, nativeShopPrice, shopChoices,
  shopAvailability, shopPurchaseEligibility, shopRefreshContext, useStoryItem,
} from '../src/engine/StoryItems.ts';
import { favorCap, initialStoryState, progressBaseline, validateStorySource } from '../src/engine/StoryState.ts';
import type { StorySource, StoryState } from '../src/engine/StoryState.ts';

const source = validateStorySource(JSON.parse(readFileSync(new URL('../public/data/maps/story-source.json', import.meta.url), 'utf8')));
const initial = () => initialStoryState(source);
const patch = (state: StoryState, changes: Partial<StoryState>): StoryState => Object.freeze({ ...state, ...changes });
const owned = (state: StoryState, itemId: number, count: number): StoryState => patch(state, {
  items: Object.freeze({ ...state.items, [String(itemId)]: Object.freeze({ min: count, max: count }) }),
  acquiredItems: Object.freeze({ ...state.acquiredItems, [String(itemId)]: true }),
});
const role = (state: StoryState, roleId: number, points = 0, level = 1): StoryState => patch(state, {
  favor: Object.freeze({ ...state.favor, [String(roleId)]: Object.freeze({ unlocked: true, level, points }) }),
});
const atShop = (state: StoryState, money = 5000): StoryState => patch(state, {
  variables: Object.freeze({ ...state.variables, key1: true }),
  attributes: Object.freeze({ ...state.attributes, '8': money }),
});

test('shop availability reads live authored location access without a legacy map flag', () => {
  const accessible = atShop(initial());
  assert.deepEqual(accessible.locations, {});
  assert.equal(shopAvailability(accessible, 2, source).value, 'true');
  const locked = patch(accessible, { locations: { '1010': true }, variables: { ...accessible.variables, key1: false } });
  assert.equal(shopAvailability(locked, 2, source).value, 'false');
  assert.equal(shopChoices(ensureShopStock(accessible, 2, source, 0).state, 2, source).value?.length, 2);
});

test('the real bag permits a Common usable item, but not owned Gift or Special items', () => {
  const state = owned(owned(owned(initial(), 30, 1), 56, 1), 1, 1);
  assert.equal(itemUseEligibility(state, 30, source).value, 'true');
  assert.equal(itemUseEligibility(state, 56, source).value, 'false');
  assert.equal(itemUseEligibility(state, 1, source).value, 'false');
  const mislabeled: StorySource = { ...source, items: { ...source.items, '56': { ...source.items['56'], CanUse: true } } };
  assert.equal(itemUseEligibility(state, 56, mislabeled).value, 'false');
  assert.deepEqual(itemChoices(state, source).map(choice => choice.itemId), [30]);
});

test('real item30 consumes one, adds attr5, and reduces fatigue at its use trigger', () => {
  const checkpoint = owned(patch(initial(), { attributes: { ...initial().attributes, '7': 35 } }), 30, 2);
  const result = useStoryItem(checkpoint, 30, source, 'bag:30:1');
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.state.items['30'], { min: 1, max: 1 });
  assert.equal(result.state.attributes['5'], 21);
  assert.equal(result.state.attributes['7'], 25);
  assert.equal(result.state.acquiredItems['30'], true);
  assert.deepEqual(result.changes.map(change => change.kind), ['item', 'attribute', 'attribute']);
  assert.equal(useStoryItem(result.state, 30, source, 'bag:30:1').state, result.state);
  const restored: StoryState = JSON.parse(JSON.stringify(result.state));
  assert.equal(useStoryItem(restored, 30, source, 'bag:30:1').state, restored);
  assert.equal(checkpoint.items['30'].min, 2, 'The other checkpoint branch retains its unconsumed item.');
});

test('real item33 applies its cost and fatigue reduction with the original attribute bounds', () => {
  const state = owned(patch(initial(), { attributes: { ...initial().attributes, '5': 1, '7': 20 } }), 33, 1);
  const result = useStoryItem(state, 33, source, 'bag:33');
  assert.equal(result.state.attributes['5'], 1);
  assert.equal(result.state.attributes['7'], 0);
  assert.deepEqual(result.state.items['33'], { min: 0, max: 0 });
  assert.equal(result.state.acquiredItems['33'], true);
  assert.equal(useStoryItem(result.state, 33, source, 'bag:33:again').state, result.state);
});

test('item effects are summed before clamping, and an authored buff follows consumption', () => {
  const effects = {
    '9901': { Id: 9901, EffectType: 0, Value1: -100, Value2: 0, Value3: 0, Value4: 0, Value5: 0 },
    '9902': { Id: 9902, EffectType: 0, Value1: 5, Value2: 0, Value3: 0, Value4: 0, Value5: 0 },
    '9903': { Id: 9903, EffectType: 3, Buff: 9005 },
  };
  const altered: StorySource = { ...source, items: { ...source.items, '13': { ...source.items['13'], EffectIds: [9901, 9902, 9903] } }, itemEffects: { ...source.itemEffects, ...effects } };
  const result = useStoryItem(owned(initial(), 13, 1), 13, altered, 'summed:item');
  assert.equal(result.state.attributes['1'], 1, 'Combined deltas clamp once to the authored minimum; sequential clamping would leave six points.');
  assert.deepEqual(result.state.buffs['9005'], { acquiredDay: 1 });
  assert.equal(result.changes.at(-1)?.kind, 'buff');
});

test('known owned lower bounds support consumption without inventing an imported inventory total', () => {
  const state = patch(owned(initial(), 30, 1), { initialized: false, items: { '30': { min: 2, max: null } } });
  const result = useStoryItem(state, 30, source, 'imported:30');
  assert.deepEqual(result.state.items['30'], { min: 1, max: null });
  const missing: StorySource = { ...source, itemEffects: {} };
  const diagnosed = useStoryItem(state, 30, missing, 'imported:missing');
  assert.deepEqual(diagnosed.state.items['30'], { min: 1, max: null });
  assert.match(diagnosed.unresolved.join(' '), /Item effect 301.*unavailable/);
});

test('real gift56 gives preferred20 or normal10 from the same checkpoint, without advancing a tier', () => {
  const checkpoint = role(role(owned(initial(), 56, 2), 1), 4);
  assert.equal(giftFavorValue(56, 1, source).value, 20);
  assert.equal(giftFavorValue(56, 4, source).value, 10);
  assert.equal(Object.values(source.roleGifts ?? {}).find(row => row.RoleId === 1 && row.ItemId === 56)?.FavorValue, 10, 'Display metadata has a different value from the native preferred grant.');
  const preferred = giveStoryGift(checkpoint, 56, 1, source, 'gift:checkpoint');
  const normal = giveStoryGift(checkpoint, 56, 4, source, 'gift:checkpoint');
  assert.deepEqual(preferred.state.favor['1'], { unlocked: true, level: 1, points: 20 });
  assert.deepEqual(normal.state.favor['4'], { unlocked: true, level: 1, points: 10 });
  assert.equal(preferred.state.gifts['1'], 1);
  assert.equal(normal.state.gifts['4'], 1);
  assert.deepEqual(preferred.state.items['56'], { min: 1, max: 1 });
  assert.equal(giveStoryGift(preferred.state, 56, 1, source, 'gift:checkpoint').state, preferred.state);
  assert.equal(giftChoices(checkpoint, 1, source)[0].favorValue, 20);
});

test('real favor cap clamps the received gift gain; full, locked and frozen relationships consume nothing', () => {
  const cap = favorCap(source, 1, 1)!;
  assert.equal(cap, 30);
  const state = role(owned(initial(), 56, 2), 1, cap - 3);
  const result = giveStoryGift(state, 56, 1, source, 'gift:cap');
  assert.equal(result.state.favor['1'].points, cap);
  assert.equal(result.state.favor['1'].level, 1);
  assert.equal(result.changes.find(change => change.kind === 'favor')?.value, 3);
  assert.equal(giveStoryGift(result.state, 56, 1, source, 'gift:full').state, result.state);
  const locked = owned(initial(), 56, 1);
  assert.equal(giveStoryGift(locked, 56, 1, source, 'gift:locked').state, locked);
  const frozen: StorySource = { ...source, favorLevels: { ...source.favorLevels, '102': { ...source.favorLevels!['102'], PreUnlockConditionId: 99901 } }, groups: { ...source.groups, '99901': { Id: 99901, Logic: 0, GroupId: [99902] } }, conditions: { ...source.conditions, '99902': { Id: 99902, Type: 1, Params: [{ Key: 'Attr', Value: '1' }, { Key: 'Min', Value: '500' }] } } };
  assert.equal(giftEligibility(state, 56, 1, frozen).value, 'false');
  assert.equal(giveStoryGift(state, 56, 1, frozen, 'gift:frozen').state, state);
});

test('native prices truncate each discount stage and preserve authored minimum prices', () => {
  assert.equal(nativeShopPrice({ Price: 101, Discount: 0 }, 1000).value, 90);
  assert.equal(nativeShopPrice({ Price: 101, Discount: 333 }, 1000).value, 29);
  assert.equal(nativeShopPrice({ Price: 101, Discount: 333 }, 10000).value, 1);
  assert.equal(nativeShopPrice({ Price: 101, Discount: 1000 }, 10000).value, 0);
  assert.equal(nativeShopPrice({ Price: 0, Discount: 333 }, 10000).value, 0);
  assert.equal(nativeShopPrice(source.shopGoods!['1'], 1000).value, 1692);
});

const sampledSource: StorySource = {
  ...source,
  shops: { '9': { Id: 9, ActivityId: 111700001, LocationId: 1010, RefreshIntervalDays: 7, GroupMaxCount: 2, OpenConditionId: 0 } },
  shopRefresh: { '9': { Id: 9, ShopId: 9, Week: 1, GroupWeights: [{ Key: 10, Value: 1 }, { Key: 20, Value: 0 }] }, '10': { Id: 10, ShopId: 9, Week: 2, GroupWeights: [{ Key: 10, Value: 1 }] } },
  shopGoods: Object.fromEntries([10, 11, 12, 13].map(Id => [String(Id), { Id, GroupId: 10, ItemId: 26, Price: 1000, Discount: 0, BuyLimit: 2, ShowConditionId: 0 }])),
};

test('stock uses a native partial shuffle, retains the cycle selection, and sorts only its visible presentation', () => {
  assert.equal(nativeShopNextRandom(1), 270369);
  assert.equal(nativeShopNextRandom(270369), 67634689);
  const result = generateShopGoods(sampledSource.shops!['9'], sampledSource.shopRefresh!['9'], sampledSource, 1);
  assert.deepEqual(result.value, [11, 10]);
  const prepared = ensureShopStock(atShop(initial()), 9, sampledSource, 0, 'shop:9:1');
  assert.deepEqual(prepared.state.shopSelections['9:1'], [11, 10]);
  assert.deepEqual(shopChoices(prepared.state, 9, sampledSource).value?.map(choice => choice.goodsId), [10, 11]);
  assert.equal(ensureShopStock(prepared.state, 9, sampledSource, .99, 'shop:9:reopen').state, prepared.state);
  assert.equal(ensureShopStock(prepared.state, 9, sampledSource, .99, 'shop:9:1').state, prepared.state);
  const noWeight = generateShopGoods(sampledSource.shops!['9'], { GroupWeights: [{ Key: 10, Value: 0 }] }, sampledSource, 1);
  assert.deepEqual(noWeight.value, []);
});

test('shop ShowCondition filters retained stock after sampling, including explicit unknown diagnostics', () => {
  const altered: StorySource = { ...sampledSource, shopGoods: { ...sampledSource.shopGoods, '11': { ...sampledSource.shopGoods!['11'], ShowConditionId: 99901 } }, groups: { ...source.groups, '99901': { Id: 99901, Logic: 0, GroupId: [99902] } }, conditions: { ...source.conditions, '99902': { Id: 99902, Type: 1, Params: [{ Key: 'Attr', Value: '1' }, { Key: 'Min', Value: '500' }] } } };
  const state = ensureShopStock(atShop(initial()), 9, altered, 0).state;
  assert.deepEqual(state.shopSelections['9:1'], [11, 10]);
  assert.deepEqual(shopChoices(state, 9, altered).value?.map(choice => choice.goodsId), [10]);
  const unknownSource: StorySource = { ...altered, conditions: { ...altered.conditions, '99902': { Id: 99902, Type: 999, Params: [] } } };
  assert.equal(shopChoices(state, 9, unknownSource).unresolved.length > 0, true);
});

test('a real shop purchase deducts its buff-adjusted price, grants an item, and cannot repeat on restore', () => {
  const checkpoint = patch(atShop(initial()), { buffs: { '9005': { acquiredDay: 1 } } });
  const prepared = ensureShopStock(checkpoint, 2, source, 0, 'shop:2:1').state;
  const choices = shopChoices(prepared, 2, source);
  assert.deepEqual(choices.unresolved, []);
  assert.equal(choices.value?.length, 2);
  const choice = choices.value![0];
  assert.equal(choice.price, 1692);
  const result = buyStoryGoods(prepared, 2, choice.goodsId, 1, source, 'buy:2:1');
  assert.deepEqual(result.unresolved, []);
  assert.equal(result.state.attributes['8'], 5000 - 1692);
  assert.equal(result.state.items[String(choice.itemId)].min, 1);
  assert.equal(result.state.acquiredItems[String(choice.itemId)], true);
  assert.equal(currentShopPurchaseCount(result.state, 2, source).value, 1);
  assert.equal(buyStoryGoods(result.state, 2, choice.goodsId, 1, source, 'buy:2:1').state, result.state);
  const restored: StoryState = JSON.parse(JSON.stringify(result.state));
  assert.equal(buyStoryGoods(restored, 2, choice.goodsId, 1, source, 'buy:2:1').state, restored);
  assert.equal(buyStoryGoods(result.state, 2, choice.goodsId, 1, source, 'buy:2:extra').state, result.state, 'A sold-out row cannot be bought again under a new event key.');
});

test('purchase preflight checks stock, limits, currency and full stack capacity before changing any state', () => {
  const prepared = ensureShopStock(atShop(initial()), 9, sampledSource, 0).state;
  for (const [goodsId, count] of [[12, 1], [10, 3], [10, 0]]) assert.equal(shopPurchaseEligibility(prepared, 9, goodsId, count, sampledSource).value, 'false');
  const poor = atShop(prepared, 999), full = owned(prepared, 26, 99);
  assert.equal(buyStoryGoods(poor, 9, 10, 1, sampledSource, 'buy:poor').state, poor);
  assert.equal(buyStoryGoods(full, 9, 10, 1, sampledSource, 'buy:full').state, full);
  const first = buyStoryGoods(prepared, 9, 10, 2, sampledSource, 'buy:two');
  assert.equal(first.state.items['26'].min, 2);
  assert.equal(first.state.attributes['8'], 3000);
  assert.equal(shopPurchaseEligibility(first.state, 9, 10, 1, sampledSource).value, 'false');
  const empty = patch(prepared, { shopSelections: { '9:1': [] } });
  assert.deepEqual(shopChoices(empty, 9, sampledSource).value, []);
  assert.equal(buyStoryGoods(empty, 9, 10, 1, sampledSource, 'buy:empty').state, empty);
});

test('current-cycle purchase conditions reset on Monday and subtract the baseline captured in its original cycle', () => {
  const prepared = ensureShopStock(atShop(initial()), 9, sampledSource, 0).state;
  const first = buyStoryGoods(prepared, 9, 10, 2, sampledSource, 'buy:cycle1').state;
  const baseline = progressBaseline(first);
  assert.equal(shopRefreshContext(first, 9, sampledSource).value?.week, 1);
  assert.equal(currentShopPurchaseCount(first, 9, sampledSource, [10, 10]).value, 2);
  assert.equal(currentShopPurchaseCount(first, 9, sampledSource, []).value, 0);
  const monday = patch(first, { dayIndex: 4 });
  assert.equal(shopRefreshContext(monday, 9, sampledSource).value?.cycle, 2);
  assert.equal(currentShopPurchaseCount(monday, 9, sampledSource).value, 0);
  const secondStock = ensureShopStock(monday, 9, sampledSource, 0).state;
  const second = buyStoryGoods(secondStock, 9, 10, 1, sampledSource, 'buy:cycle2').state;
  assert.equal(currentShopPurchaseCount(second, 9, sampledSource).value, 1);
  assert.equal(currentShopPurchaseCount(second, 9, sampledSource, null, baseline).value, 0, 'Native local progress retains the numeric two-purchase baseline from the previous cycle.');
  assert.equal(shopRefreshContext(patch(initial(), { dayIndex: 25 }), 1, source).value?.cycle, 2, 'The 28-day shop aligns to Monday weeks.');
});

test('a new playthrough has fresh inventory, stock, purchase counts, favor and event identities', () => {
  const fresh = initial();
  assert.equal(fresh.items['30'].min, 0);
  assert.deepEqual(fresh.shopSelections, {});
  assert.deepEqual(fresh.shopPurchases, {});
  assert.deepEqual(fresh.applied, {});
  assert.deepEqual(fresh.favor['1'], { unlocked: false, level: 0, points: 0 });
});
