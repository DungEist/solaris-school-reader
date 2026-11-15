import type { Metadata } from './types.ts';
import type { ConditionResult, ItemQuantity, ProgressBaseline, StoryEffect, StorySource, StoryState } from './StoryState.ts';
import { applyAttributeDelta, combineConditions, conditionResult, evaluateConditionGroup, evaluateLocationUnlock, favorCap, favorLevelRow, sourceInteger, sourceList, sourceRecord, storyEffect } from './StoryState.ts';
import { effectiveAttributes, mechanicBonuses, mechanicUnavailable, mechanicValue } from './StoryAttributes.ts';
import type { MechanicValue } from './StoryAttributes.ts';

const INT_MAX = 2147483647;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const integer = (value: unknown) => sourceInteger(value);
const named = (row: Metadata | undefined) => ({ labelKey: typeof row?.Name === 'string' ? row.Name : '' });
const unknown = (reason: string) => conditionResult('unknown', reason);
const denied = (reason: string) => conditionResult('false', reason);
const marked = (state: StoryState, key?: string): StoryState => key ? Object.freeze({ ...state, applied: Object.freeze({ ...state.applied, [key]: true }) }) : state;
const applied = (state: StoryState, key?: string) => !!key && !!state.applied[key];
const rejected = (state: StoryState, result: ConditionResult): StoryEffect => storyEffect(state, [], result.value === 'unknown' ? result.reasons : [], [], result.value === 'false' ? result.reasons : []);
const quantity = (state: StoryState, itemId: number): ItemQuantity | undefined => state.items[String(itemId)] ?? (state.initialized ? { min: 0, max: 0 } : undefined);
function ownsOne(state: StoryState, itemId: number): ConditionResult {
  const bounds = quantity(state, itemId);
  if (bounds && bounds.min >= 1) return conditionResult('true');
  return bounds?.max !== null && bounds?.max !== undefined && bounds.max < 1 ? denied('No item is owned.') : unknown(`Inventory for item ${itemId} is unavailable.`);
}
function consumeOne(state: StoryState, itemId: number, source: StorySource): StoryEffect {
  const before = quantity(state, itemId)!;
  const bounds = Object.freeze({ min: before.min - 1, max: before.max === null ? null : before.max - 1 });
  const next = Object.freeze({ ...state, items: Object.freeze({ ...state.items, [String(itemId)]: bounds }) });
  return storyEffect(next, [{ kind: 'item', itemId, before: before.min, after: bounds.min, bounds, value: -1, ...named(source.items[String(itemId)]) }]);
}

export interface ItemChoice {
  readonly itemId: number;
  readonly labelKey: string;
  readonly descriptionKey: string;
  readonly quantity: ItemQuantity;
  readonly condition: ConditionResult;
  readonly favorValue?: number | null;
}

/** CanUseItem (0x060386B9) permits Common items only. CanUse alone is not enough. */
export function itemUseEligibility(state: StoryState, itemId: number, source: StorySource): ConditionResult {
  const item = source.items[String(itemId)];
  if (!item) return unknown(`Item ${itemId} definition is unavailable.`);
  if (item.ItemType !== 0 || item.CanUse !== true) return denied('This item cannot be used from the bag.');
  return ownsOne(state, itemId);
}
function sortedItems(source: StorySource): Metadata[] {
  return Object.values(source.items).sort((a, b) => Number(a.SortId ?? a.Id) - Number(b.SortId ?? b.Id) || Number(a.Id) - Number(b.Id));
}
export function itemChoices(state: StoryState, source: StorySource): readonly ItemChoice[] {
  return Object.freeze(sortedItems(source).filter(row => row.ItemType === 0 && row.CanUse === true).flatMap(row => {
    const itemId = Number(row.Id), bounds = quantity(state, itemId);
    return !bounds || bounds.max === 0 ? [] : [Object.freeze({ itemId, ...named(row), descriptionKey: String(row.Desc ?? ''), quantity: bounds, condition: itemUseEligibility(state, itemId, source) })];
  }));
}

/** UseItem consumes first, sums all attribute effects, then adds buffs. Missing
 * effect definitions are skipped by the game and retained in diagnostics here. */
export function useStoryItem(state: StoryState, itemId: number, source: StorySource, eventKey?: string): StoryEffect {
  if (applied(state, eventKey)) return storyEffect(state);
  const eligibility = itemUseEligibility(state, itemId, source);
  if (eligibility.value !== 'true') return rejected(state, eligibility);
  const consumed = consumeOne(state, itemId, source), ids = sourceList(source.items[String(itemId)].EffectIds);
  let next = consumed.state;
  const changes: Metadata[] = [...consumed.changes], unresolved: string[] = [];
  const deltas: Record<string, number> = {}, buffs: number[] = [];
  if (!ids) unresolved.push(`Item ${itemId} effects are unavailable.`);
  for (const id of ids ?? []) {
    const row = source.itemEffects?.[String(id)];
    if (!row) { unresolved.push(`Item effect ${id} is unavailable.`); continue; }
    const add = (attr: number, field: string) => {
      const value = integer(row[field]);
      if (value === null) unresolved.push(`Item effect ${id} ${field} is invalid.`);
      else deltas[String(attr)] = (deltas[String(attr)] ?? 0) + value;
    };
    if (row.EffectType === 0) for (let attr = 1; attr <= 5; attr++) add(attr, `Value${attr}`);
    else if (row.EffectType === 1) add(6, 'Popularity');
    else if (row.EffectType === 2) add(7, 'Fatigue');
    else if (row.EffectType === 3) {
      const buff = integer(row.Buff);
      if (buff === null) unresolved.push(`Item effect ${id} buff is invalid.`);
      else if (buff) buffs.push(buff);
    } else unresolved.push(`Item effect ${id} type ${String(row.EffectType)} is unverified.`);
  }
  for (let attr = 1; attr <= 7; attr++) if (deltas[String(attr)]) {
    const effect = applyAttributeDelta(next, attr, deltas[String(attr)], source);
    next = effect.state; changes.push(...effect.changes); unresolved.push(...effect.unresolved);
  }
  for (const buffId of buffs) {
    if (!source.buffs?.[String(buffId)]) { unresolved.push(`Buff ${buffId} definition is unavailable.`); continue; }
    if (next.buffs[String(buffId)]) continue;
    next = Object.freeze({ ...next, buffs: Object.freeze({ ...next.buffs, [String(buffId)]: Object.freeze({ acquiredDay: next.dayIndex }) }) });
    changes.push({ kind: 'buff', buffId });
  }
  return storyEffect(marked(next, eventKey), changes, unresolved);
}

/** Native GetGiftFavorValue reads FavorRoleList and the two activity params;
 * SolarSchoolRoleFavor.FavorValue is not the grant amount. */
export function giftFavorValue(itemId: number, roleId: number, source: StorySource): MechanicValue<number> {
  const item = source.items[String(itemId)], preferred = sourceList(item?.FavorRoleList);
  if (!item || !preferred || !source.params) return mechanicUnavailable(`Gift ${itemId} preference or activity parameters are unavailable.`);
  const key = preferred.includes(roleId) ? 'HighLikeVal' : 'NormalLikeVal';
  const row = Object.values(source.params).find(row => row.Key === key);
  const value = row ? integer(row.IntValue) : 0;
  return value === null ? mechanicUnavailable(`Gift parameter ${key} is invalid.`) : mechanicValue(value);
}
export function giftEligibility(state: StoryState, itemId: number, roleId: number, source: StorySource): ConditionResult {
  const item = source.items[String(itemId)], role = state.favor[String(roleId)], roleRow = source.roles?.[String(roleId)];
  if (!item || !role || !roleRow) return unknown(`Gift or favor baseline for role ${roleId} is unavailable.`);
  if (item.ItemType !== 1) return denied('This item is not a gift.');
  const owned = ownsOne(state, itemId);
  if (owned.value !== 'true') return owned;
  if (!role.unlocked) return denied('This relationship has not been unlocked.');
  const max = integer(roleRow.MaxFavorLevel);
  if (max === null) return unknown(`Maximum favor tier for role ${roleId} is unavailable.`);
  if (role.level >= max) return denied('This relationship is at its maximum tier.');
  const tier = favorLevelRow(source, roleId, role.level + 1), cap = favorCap(source, roleId, role.level);
  if (!tier || cap === null) return unknown(`Favor cap for role ${roleId} is unavailable.`);
  const precondition = evaluateConditionGroup(Number(tier.PreUnlockConditionId ?? 0), state, source);
  if (precondition.value !== 'true') return precondition.value === 'unknown' ? precondition : denied('This relationship is awaiting its next story event.');
  if (role.points >= cap) return denied('Favor points are full for the current tier.');
  const value = giftFavorValue(itemId, roleId, source);
  return value.value === null ? Object.freeze({ value: 'unknown', reasons: value.unresolved }) : value.value <= 0 ? denied('This gift grants no favor.') : conditionResult('true');
}
export function giftChoices(state: StoryState, roleId: number, source: StorySource): readonly ItemChoice[] {
  return Object.freeze(sortedItems(source).filter(row => row.ItemType === 1).flatMap(row => {
    const itemId = Number(row.Id), bounds = quantity(state, itemId);
    return !bounds || bounds.max === 0 ? [] : [Object.freeze({ itemId, ...named(row), descriptionKey: String(row.Desc ?? ''), quantity: bounds, condition: giftEligibility(state, itemId, roleId, source), favorValue: giftFavorValue(itemId, roleId, source).value })];
  }));
}
export function giveStoryGift(state: StoryState, itemId: number, roleId: number, source: StorySource, eventKey?: string): StoryEffect {
  if (applied(state, eventKey)) return storyEffect(state);
  const eligibility = giftEligibility(state, itemId, roleId, source);
  if (eligibility.value !== 'true') return rejected(state, eligibility);
  const id = String(roleId), before = state.favor[id], configured = giftFavorValue(itemId, roleId, source).value!;
  const value = Math.min(configured, favorCap(source, roleId, before.level)! - before.points);
  let next: StoryState = Object.freeze({ ...state, favor: Object.freeze({ ...state.favor, [id]: Object.freeze({ ...before, points: before.points + value }) }) });
  const consumed = consumeOne(next, itemId, source);
  next = consumed.state;
  const unresolved: string[] = [];
  const previousCount = state.gifts[id] ?? (state.initialized ? 0 : null);
  if (previousCount === null) unresolved.push(`Gift count baseline for role ${roleId} is unavailable.`);
  else next = Object.freeze({ ...next, gifts: Object.freeze({ ...next.gifts, [id]: Math.min(INT_MAX, previousCount + 1) }) });
  return storyEffect(marked(next, eventKey), [{ kind: 'favor', roleId, before: before.points, after: before.points + value, value, itemId, ...named(source.roles?.[id]) }, ...consumed.changes, { kind: 'gift', roleId, itemId, value }], unresolved);
}

export interface ShopRefreshContext { readonly shopId: number; readonly week: number; readonly cycle: number; readonly refreshWeek: number; readonly selectionKey: string; }
/** GetWeek uses the first Monday, day4, rather than a seven-day block from day1. */
export function shopRefreshContext(state: Pick<ProgressBaseline, 'dayIndex'>, shopId: number, source: StorySource): MechanicValue<ShopRefreshContext> {
  const shop = source.shops?.[String(shopId)], days = integer(shop?.RefreshIntervalDays), day = integer(state.dayIndex);
  if (!shop || days === null || day === null) return mechanicUnavailable(`Shop ${shopId} refresh definition or playthrough date is unavailable.`);
  const currentDay = Math.max(1, day), week = currentDay < 4 ? 1 : Math.floor((currentDay - 4) / 7) + 2;
  const intervalWeeks = Math.ceil(Math.max(1, days) / 7), cycle = Math.floor((week - 1) / intervalWeeks) + 1;
  return mechanicValue(Object.freeze({ shopId, week, cycle, refreshWeek: (cycle - 1) * intervalWeeks + 1, selectionKey: `${shopId}:${cycle}` }));
}
function rawShopPurchaseCount(state: StoryState | ProgressBaseline, shopId: number, source: StorySource, goodsIds: readonly number[] | null): MechanicValue<number> {
  if (!source.shops) return mechanicUnavailable('Shop definitions are unavailable.');
  if (!source.shops[String(shopId)]) return mechanicValue(0);
  const context = shopRefreshContext(state, shopId, source);
  if (!context.value) return mechanicValue<number>(null, context.unresolved);
  const stock = state.shopSelections[context.value.selectionKey];
  if (!stock) return 'initialized' in state && !state.initialized ? mechanicUnavailable(`Shop ${shopId} purchase baseline is unavailable.`) : mechanicValue(0);
  const filter = goodsIds === null ? null : new Set(goodsIds);
  const prefix = `${context.value.selectionKey}:`, ids = stock.length ? new Set(stock) : new Set(Object.keys(state.shopPurchases).filter(key => key.startsWith(prefix)).map(key => Number(key.slice(prefix.length))));
  let count = 0;
  for (const id of ids) {
    if (filter && !filter.has(id)) continue;
    const value = integer(state.shopPurchases[`${prefix}${id}`] ?? 0);
    if (value === null || value < 0) return mechanicUnavailable(`Shop ${shopId} goods ${id} purchase count is unavailable.`);
    count = Math.min(INT_MAX, count + value);
  }
  return mechanicValue(count);
}
/** Condition25 reads the current cycle, then subtracts a captured numeric
 * baseline for local progress. Optional GoodsId is a set, not an item ID. */
export function currentShopPurchaseCount(state: StoryState | ProgressBaseline, shopId: number, source: StorySource, goodsIds: readonly number[] | null = null, baseline?: ProgressBaseline): MechanicValue<number> {
  const current = rawShopPurchaseCount(state, shopId, source, goodsIds);
  if (current.value === null || !baseline) return current;
  const previous = rawShopPurchaseCount(baseline, shopId, source, goodsIds);
  return previous.value === null ? mechanicValue<number>(null, previous.unresolved) : mechanicValue(Math.max(0, current.value - previous.value));
}
export function shopAvailability(state: StoryState, shopId: number, source: StorySource): ConditionResult {
  const shop = source.shops?.[String(shopId)], locationId = integer(shop?.LocationId), location = locationId === null ? undefined : source.locations?.[String(locationId)];
  if (!shop || locationId === null || !location) return unknown(`Shop ${shopId} location definition is unavailable.`);
  return combineConditions(0, [evaluateLocationUnlock(locationId, state, source), evaluateConditionGroup(Number(location.ShowConditionGroupId ?? 0), state, source), evaluateConditionGroup(Number(shop.OpenConditionId ?? 0), state, source)]);
}

/** GetPrice truncates twice. Discount0 means no authored discount. */
export function nativeShopPrice(goods: Metadata, buffDiscount = 0): MechanicValue<number> {
  const original = integer(goods.Price), discount = integer(goods.Discount);
  if (original === null || discount === null || integer(buffDiscount) === null) return mechanicUnavailable('Shop price or discount is invalid.');
  let price = Math.max(0, original);
  if (price > 0 && discount > 0) price = Math.max(1, Math.trunc(price * clamp(discount, 0, 1000) / 1000));
  price = Math.trunc(price * (10000 - clamp(buffDiscount, 0, 10000)) / 10000);
  if (original > 0 && discount > 0 && discount < 1000) price = Math.max(1, price);
  return Number.isSafeInteger(price) ? mechanicValue(price) : mechanicUnavailable('Shop price exceeds the supported integer range.');
}
export function nativeShopNextRandom(seed: number): number {
  let value = seed >>> 0;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  return value >>> 0;
}
/** GenerateShopGoods picks one weighted group, then a partial Fisher-Yates
 * sample. Visibility conditions apply later, after the stock is retained. */
export function generateShopGoods(shop: Metadata, refresh: Metadata, source: StorySource, seed: number): MechanicValue<readonly number[]> {
  if (!Number.isInteger(seed) || seed < -2147483648 || seed > 4294967295 || !Array.isArray(refresh.GroupWeights)) return mechanicUnavailable('Shop random seed or group weights are invalid.');
  const weights: { key: number; weight: number }[] = [];
  for (const raw of refresh.GroupWeights) {
    const row = sourceRecord(raw), key = integer(row?.Key), weight = integer(row?.Value);
    if (key === null || weight === null) return mechanicUnavailable('Shop group weight definition is invalid.');
    if (weight > 0) weights.push({ key, weight });
  }
  const total = weights.reduce((sum, row) => sum + row.weight, 0), max = integer(shop.GroupMaxCount);
  if (!Number.isSafeInteger(total) || max === null) return mechanicUnavailable('Shop group total or stock limit is invalid.');
  if (!total) return mechanicValue(Object.freeze([]));
  let random = nativeShopNextRandom(seed), cursor = random % total, groupId = 0;
  for (const row of weights) { if (cursor < row.weight) { groupId = row.key; break; } cursor -= row.weight; }
  if (!groupId) return mechanicValue(Object.freeze([]));
  if (!source.shopGoods) return mechanicUnavailable('Shop goods definitions are unavailable.');
  const candidates = Object.values(source.shopGoods).filter(row => row.GroupId === groupId);
  if (max > 0 && candidates.length > max) {
    for (let index = 0; index < max; index++) {
      random = nativeShopNextRandom(random);
      const selected = index + random % (candidates.length - index);
      [candidates[index], candidates[selected]] = [candidates[selected], candidates[index]];
    }
    candidates.length = max;
  }
  const missing = candidates.filter(row => !source.items[String(row.ItemId)]);
  return mechanicValue(Object.freeze(candidates.filter(row => source.items[String(row.ItemId)]).map(row => Number(row.Id))), missing.map(row => `Shop goods ${row.Id} item ${row.ItemId} definition is unavailable; native stock skips it.`));
}
/** The draw-to-seed conversion is a reproducible Reader policy. Native games
 * acquire a random integer once and retain the same stock through this cycle. */
export function ensureShopStock(state: StoryState, shopId: number, source: StorySource, draw: number, eventKey?: string): StoryEffect {
  if (applied(state, eventKey)) return storyEffect(state);
  const context = shopRefreshContext(state, shopId, source);
  if (!context.value) return storyEffect(state, [], context.unresolved);
  if (Object.hasOwn(state.shopSelections, context.value.selectionKey)) return storyEffect(state);
  if (!source.shopRefresh) return storyEffect(state, [], ['Shop refresh definitions are unavailable.']);
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) return storyEffect(state, [], ['Shop random draw must be in [0,1).']);
  const refresh = Object.values(source.shopRefresh).find(row => row.ShopId === shopId && row.Week === context.value!.refreshWeek);
  const stock = refresh ? generateShopGoods(source.shops![String(shopId)], refresh, source, Math.floor(draw * 4294967296) || 1) : mechanicValue<readonly number[]>(Object.freeze([]));
  if (!stock.value) return storyEffect(state, [], stock.unresolved);
  const purchases = { ...state.shopPurchases };
  for (const id of stock.value) purchases[`${context.value.selectionKey}:${id}`] ??= 0;
  const next: StoryState = Object.freeze({ ...state, shopSelections: Object.freeze({ ...state.shopSelections, [context.value.selectionKey]: stock.value }), shopPurchases: Object.freeze(purchases) });
  return storyEffect(marked(next, eventKey), [{ kind: 'shopStock', shopId, cycle: context.value.cycle, goodsIds: stock.value }], stock.unresolved);
}

export interface ShopChoice {
  readonly shopId: number; readonly goodsId: number; readonly itemId: number;
  readonly labelKey: string; readonly descriptionKey: string;
  readonly price: number | null; readonly remaining: number | null; readonly maxQuantity: number | null;
  readonly quantity: ItemQuantity; readonly condition: ConditionResult;
}
interface PurchaseFacts { readonly row: Metadata; readonly itemId: number; readonly bounds: ItemQuantity; readonly context: ShopRefreshContext; readonly price: number; readonly remaining: number; readonly capacity: number; readonly money: number; }
function purchaseFacts(state: StoryState, shopId: number, goodsId: number, source: StorySource): MechanicValue<PurchaseFacts> {
  const context = shopRefreshContext(state, shopId, source), row = source.shopGoods?.[String(goodsId)];
  if (!context.value || !row) return mechanicValue<PurchaseFacts>(null, context.unresolved.length ? context.unresolved : [`Shop goods ${goodsId} definition is unavailable.`]);
  const itemId = integer(row.ItemId), stack = itemId === null ? null : integer(source.items[String(itemId)]?.StackLimit), limit = integer(row.BuyLimit);
  const bounds = itemId === null ? undefined : quantity(state, itemId), bought = integer(state.shopPurchases[`${context.value.selectionKey}:${goodsId}`] ?? (state.initialized ? 0 : null));
  if (itemId === null || stack === null || stack <= 0 || limit === null || !bounds || bought === null) return mechanicUnavailable(`Shop goods ${goodsId} inventory or purchase baseline is unavailable.`);
  const derived = mechanicBonuses(state, source), attributes = effectiveAttributes(state, source);
  if (!derived.value || !attributes.value || attributes.value['8'] === undefined) return mechanicValue<PurchaseFacts>(null, [...derived.unresolved, ...attributes.unresolved, ...(attributes.value?.['8'] === undefined && !derived.unresolved.length && !attributes.unresolved.length ? ['Shop currency baseline is unavailable.'] : [])]);
  const price = nativeShopPrice(row, derived.value.global['12'] ?? 0);
  if (price.value === null) return mechanicValue<PurchaseFacts>(null, price.unresolved);
  return mechanicValue({ row, itemId, bounds, context: context.value, price: price.value, remaining: limit <= 0 ? INT_MAX : Math.max(0, limit - bought), capacity: stack, money: attributes.value['8'] });
}
export function shopPurchaseEligibility(state: StoryState, shopId: number, goodsId: number, count: number, source: StorySource): ConditionResult {
  if (!Number.isSafeInteger(count) || count <= 0) return denied('Purchase quantity must be positive.');
  const available = shopAvailability(state, shopId, source);
  if (available.value !== 'true') return available;
  const facts = purchaseFacts(state, shopId, goodsId, source);
  if (!facts.value) return Object.freeze({ value: 'unknown', reasons: facts.unresolved });
  const stock = state.shopSelections[facts.value.context.selectionKey];
  if (!stock) return unknown(`Shop ${shopId} stock has not been prepared.`);
  if (!stock.includes(goodsId)) return denied('This item is not in the current shop stock.');
  if (count > facts.value.remaining) return denied('This purchase exceeds the current stock limit.');
  const total = count * facts.value.price;
  if (!Number.isSafeInteger(total)) return unknown('Purchase cost exceeds the supported integer range.');
  if (total > facts.value.money) return denied('There is not enough currency for this purchase.');
  if (facts.value.bounds.min + count > facts.value.capacity) return denied('The item stack is full.');
  if (facts.value.bounds.max === null || facts.value.bounds.max + count > facts.value.capacity) return unknown(`Item ${facts.value.itemId} stack capacity is unavailable.`);
  return conditionResult('true');
}
export function shopChoices(state: StoryState, shopId: number, source: StorySource): MechanicValue<readonly ShopChoice[]> {
  const context = shopRefreshContext(state, shopId, source);
  if (!context.value) return mechanicValue<readonly ShopChoice[]>(null, context.unresolved);
  const stock = state.shopSelections[context.value.selectionKey];
  if (!stock) return mechanicUnavailable(`Shop ${shopId} stock has not been prepared.`);
  const availability = shopAvailability(state, shopId, source);
  if (availability.value !== 'true') return mechanicValue(Object.freeze([]), availability.value === 'unknown' ? availability.reasons : []);
  const choices: ShopChoice[] = [], unresolved: string[] = [];
  for (const goodsId of [...stock].sort((a, b) => a - b)) {
    const row = source.shopGoods?.[String(goodsId)];
    if (!row) { unresolved.push(`Shop goods ${goodsId} definition is unavailable.`); continue; }
    const visible = evaluateConditionGroup(Number(row.ShowConditionId ?? 0), state, source);
    if (visible.value !== 'true') { if (visible.value === 'unknown') unresolved.push(...visible.reasons); continue; }
    const itemId = Number(row.ItemId), item = source.items[String(itemId)], facts = purchaseFacts(state, shopId, goodsId, source);
    if (!item) { unresolved.push(`Shop item ${itemId} definition is unavailable.`); continue; }
    const value = facts.value;
    const maxQuantity = value && value.bounds.max !== null ? Math.max(0, Math.min(value.remaining, value.capacity - value.bounds.max, value.price > 0 ? Math.floor(value.money / value.price) : INT_MAX)) : null;
    unresolved.push(...facts.unresolved);
    choices.push(Object.freeze({ shopId, goodsId, itemId, ...named(item), descriptionKey: String(item.Desc ?? ''), price: value?.price ?? null, remaining: value?.remaining ?? null, maxQuantity, quantity: quantity(state, itemId) ?? { min: 0, max: null }, condition: shopPurchaseEligibility(state, shopId, goodsId, 1, source) }));
  }
  return mechanicValue(Object.freeze(choices), unresolved);
}
export function buyStoryGoods(state: StoryState, shopId: number, goodsId: number, count: number, source: StorySource, eventKey?: string): StoryEffect {
  if (applied(state, eventKey)) return storyEffect(state);
  const eligibility = shopPurchaseEligibility(state, shopId, goodsId, count, source);
  if (eligibility.value !== 'true') return rejected(state, eligibility);
  const facts = purchaseFacts(state, shopId, goodsId, source).value!, key = `${facts.context.selectionKey}:${goodsId}`, bought = state.shopPurchases[key] ?? 0;
  let next: StoryState = Object.freeze({ ...state, shopPurchases: Object.freeze({ ...state.shopPurchases, [key]: bought + count }) });
  const cost = applyAttributeDelta(next, 8, -facts.price * count, source);
  next = cost.state;
  const bounds = Object.freeze({ min: facts.bounds.min + count, max: facts.bounds.max! + count });
  next = Object.freeze({ ...next, items: Object.freeze({ ...next.items, [String(facts.itemId)]: bounds }), acquiredItems: Object.freeze({ ...next.acquiredItems, [String(facts.itemId)]: true }) });
  return storyEffect(marked(next, eventKey), [...cost.changes, { kind: 'item', itemId: facts.itemId, before: facts.bounds.min, after: bounds.min, bounds, value: count, ...named(source.items[String(facts.itemId)]), shopId, goodsId }, { kind: 'shopPurchase', shopId, goodsId, quantity: count, cost: facts.price * count }], cost.unresolved);
}
