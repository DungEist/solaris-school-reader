import type { Metadata } from './types.ts';
import type { StorySource, StoryState } from './StoryState.ts';

export interface MechanicValue<T> { readonly value: T | null; readonly unresolved: readonly string[]; }
export const mechanicValue = <T>(value: T | null, unresolved: readonly string[] = []): MechanicValue<T> => Object.freeze({ value, unresolved: Object.freeze([...unresolved]) });
export const mechanicUnavailable = <T>(reason: string): MechanicValue<T> => mechanicValue<T>(null, [reason]);

// Keep this module independent of StoryState's runtime exports. Conditions
// call these derived attributes while StoryMechanics also consumes them.
const integer = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) ? value : typeof value === 'string' && /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
function list(value: unknown): number[] | null {
  const values = typeof value === 'string' && value.length ? value.split('|') : Array.isArray(value) ? value : null;
  return values?.every(entry => integer(entry) !== null) ? values.map(Number) : null;
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export interface MechanicBonuses {
  readonly global: Readonly<Record<string, number>>;
  readonly scoped: Readonly<Record<string, number>>;
}

/** Permanent-item bonuses use HasAcquiredItem, not current quantity. Buff
 * entries without BehaviorId are global; scoped types 1..8 add to behavior
 * deltas, rather than effective attributes. */
export function mechanicBonuses(state: StoryState, source: StorySource): MechanicValue<MechanicBonuses> {
  const global: Record<string, number> = {}, scoped: Record<string, number> = {};
  const reasons: string[] = [];
  const add = (map: Record<string, number>, key: string, value: number) => { map[key] = (map[key] ?? 0) + value; };
  for (const [id, acquired] of Object.entries(state.acquiredItems)) {
    if (!acquired) continue;
    const item = source.items[id];
    if (!item) { reasons.push(`Acquired item ${id} definition is unavailable.`); continue; }
    if (item.ItemType !== 2) continue;
    const effects = list(item.EffectIds);
    if (!effects) { reasons.push(`Permanent item ${id} effects are unavailable.`); continue; }
    for (const effectId of effects) {
      const effect = source.itemEffects?.[String(effectId)];
      if (!effect) { reasons.push(`Permanent item effect ${effectId} is unavailable.`); continue; }
      if (effect.EffectType === 0) {
        for (let attr = 1; attr <= 5; attr++) {
          const value = integer(effect[`Value${attr}`]);
          if (value === null) reasons.push(`Permanent item effect ${effectId} attribute ${attr} is invalid.`);
          else add(global, String(attr), value);
        }
      } else if (effect.EffectType === 1 || effect.EffectType === 2) {
        const value = integer(effect[effect.EffectType === 1 ? 'Popularity' : 'Fatigue']);
        if (value === null) reasons.push(`Permanent item effect ${effectId} is invalid.`);
        else add(global, effect.EffectType === 1 ? '6' : '7', value);
      } else reasons.push(`Permanent item effect type ${String(effect.EffectType)} is unsupported.`);
    }
  }
  for (const [id, entry] of Object.entries(state.buffs)) {
    const buff = source.buffs?.[id], duration = integer(buff?.DurationDays);
    if (!buff || duration === null || duration === 0 || duration < -1) { reasons.push(`Buff ${id} duration is unavailable.`); continue; }
    if (duration > 0) {
      if (state.dayIndex === null || entry.acquiredDay === null) { reasons.push(`Buff ${id} expiry date is unavailable.`); continue; }
      if (state.dayIndex - entry.acquiredDay >= duration) continue;
    }
    const ids = list(buff.EffectIds);
    if (!ids) { reasons.push(`Buff ${id} effects are unavailable.`); continue; }
    for (const effectId of ids) {
      const effect: Metadata | undefined = source.buffEffects?.[String(effectId)], targets = list(effect?.BehaviorId), type = integer(effect?.Type), value = integer(effect?.Value);
      if (!effect || !targets || type === null || value === null || type < 1 || type > 12) { reasons.push(`Buff effect ${effectId} is unavailable or unsupported.`); continue; }
      if (!targets.length) add(global, String(type), value);
      else for (const behavior of targets) add(scoped, `${type}:${behavior}`, value);
    }
  }
  return reasons.length ? mechanicValue<MechanicBonuses>(null, reasons) : mechanicValue(Object.freeze({ global: Object.freeze(global), scoped: Object.freeze(scoped) }));
}

/** GetAttr (0x0603800C) clamps base plus permanent-item/global-buff bonuses
 * to the authored attribute bounds. Base values remain separate in state. */
export function effectiveAttributes(state: StoryState, source: StorySource): MechanicValue<Readonly<Record<string, number>>> {
  const derived = mechanicBonuses(state, source);
  if (!derived.value) return mechanicValue<Readonly<Record<string, number>>>(null, derived.unresolved);
  const values: Record<string, number> = {};
  for (const [id, value] of Object.entries(state.attributes)) {
    const min = integer(source.attrs?.[id]?.MinValue), max = integer(source.attrs?.[id]?.MaxValue);
    if (min === null || max === null) return mechanicUnavailable(`Attribute ${id} bounds are unavailable.`);
    values[id] = clamp(value + (derived.value.global[id] ?? 0), min, max);
  }
  return mechanicValue(Object.freeze(values));
}
