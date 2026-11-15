import type { StagePosition, StageState } from './StageState.ts';
import type { StagePresentation } from './StageTransitions.ts';
import type { StageEvent, StageOp } from './types.ts';

export interface StageEffectDefinition {
  readonly sourceRef: string;
  readonly fxType: string;
  readonly sourceVerified: boolean;
  readonly behaviorVerified: boolean;
  /** Null means the prefab's native playback range has not been recovered. */
  readonly durationMs: number | null;
  readonly limitations?: readonly string[];
  /** Null explicitly records an effect without a verified drawable bitmap. */
  readonly primaryImage?: string | null;
  readonly images?: readonly { readonly url: string; readonly role?: string }[];
  /** Explicit Reader projections for native materials without a sprite. */
  readonly readerRenderer?: 'danger' | 'black' | 'speed-line' | 'speed-line-black' | 'fog';
}

export interface ActiveStageEffect {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly type: string;
  readonly path: string | null;
  readonly customType: string | null;
  readonly who: string | null;
  readonly target: 'screen' | 'portrait';
  readonly persistent: boolean;
  readonly startedAtMs: number;
  readonly durationMs: number | null;
  readonly event: StageEvent;
}

export interface PresentedStageEffect extends ActiveStageEffect {
  readonly elapsedMs: number;
  readonly progress: number | null;
  readonly offset: readonly [number, number];
}

export interface StageEffectIssue {
  readonly code: string;
  readonly message: string;
  readonly event: StageEvent;
}

export interface StageEffectsSnapshot {
  readonly sampledAtMs: number;
  readonly active: readonly PresentedStageEffect[];
  readonly screenOffset: readonly [number, number];
  readonly issues: readonly StageEffectIssue[];
}

const record = (value: unknown): Readonly<Record<string, unknown>> => value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
const string = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value : null;
const positive = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
const zeroOffset = Object.freeze([0, 0]) as readonly [number, number];
export const emptyStageEffects = (now = 0): StageEffectsSnapshot => Object.freeze({ sampledAtMs: now, active: Object.freeze([]), screenOffset: zeroOffset, issues: Object.freeze([]) });

/** These are explicitly Reader fallback lifetimes, never extracted timing.
 * StartTime, ordering, targets and stops always come from the delivered cue. */
export const readerEffectLifetimes = Object.freeze({ oneShot: 2200, screenShake: 640, portraitShake: 480, burstEye: 1000, portraitY: 160 });

function describe(operation: StageOp) {
  const config = record(operation.effectConfig ?? record(operation.raw).EffectConfig);
  const target = operation.op === 'portraitFx' ? 'portrait' as const : 'screen' as const;
  const type = target === 'portrait' ? 'Portrait' : string(operation.fxType) ?? string(config.Type) ?? '';
  const customType = string(operation.customType) ?? string(config.CustomType) ?? (type === 'Custom' ? string(operation.fx) : null);
  const path = string(operation.path) ?? (type === 'Persistent' ? string(operation.persistentEffectPath ?? config.PersistentEffectPath) : type === 'OneShot' ? string(operation.oneShotEffectPath ?? config.OneShotEffectPath) : null);
  const name = target === 'portrait' ? string(operation.fx) ?? '' : type === 'Custom' ? customType ?? '' : path?.split('/').at(-1)?.split('.')[0] ?? string(operation.fx) ?? '';
  const who = string(operation.who);
  const key = target === 'portrait' ? `portrait:${who}` : `${type}:${type === 'Custom' ? customType : path}`;
  return { target, type, customType, path, name, who, key };
}

/** Managed PortraitEffectAction maps Small/Medium/Large to 12/24/36.
 * Spine Shake instead uses the prefab's 'shake' sequence; its Reader curve is
 * provisional until that sequence is available. The original amplitude stays
 * in event.operation even when the native effect does not consume it. */
export function portraitEffectDistance(operation: StageOp): number {
  return operation.amp === 'Small' ? 12 : operation.amp === 'Large' ? 36 : 24;
}

function motion(effect: ActiveStageEffect, elapsedMs: number): readonly [number, number] {
  const p = effect.durationMs ? Math.min(1, Math.max(0, elapsedMs / effect.durationMs)) : 0;
  if (p >= 1 || elapsedMs <= 0) return zeroOffset;
  if (effect.target === 'portrait' && ['Jump', 'Sigh'].includes(effect.name)) {
    // The native effect goes out and returns in two 80ms tweens. Its easing
    // enum is retained in the source audit; this interpolation is a fallback.
    const amplitude = portraitEffectDistance(effect.event.operation);
    const triangle = p < .5 ? p * 2 : (1 - p) * 2;
    return Object.freeze([0, (effect.name === 'Sigh' ? -1 : 1) * amplitude * triangle]);
  }
  if (effect.name === 'Shake') {
    const amplitude = effect.target === 'portrait' ? portraitEffectDistance(effect.event.operation) : 18;
    const envelope = Math.sin(Math.PI * p);
    return Object.freeze([
      Math.sin(elapsedMs / 1000 * Math.PI * 28) * amplitude * envelope,
      Math.sin(elapsedMs / 1000 * Math.PI * 36) * amplitude * .35 * envelope,
    ]);
  }
  return zeroOffset;
}

/** One engine-owned lifetime for every Reader stage. Rendering consumes this
 * projection, never stage history, so rerenders and restores cannot replay a
 * burst. The scheduler remains the sole owner of authored StartTime delivery. */
export class StageEffects {
  private active: ActiveStageEffect[] = [];
  private issues: StageEffectIssue[] = [];
  private definitions: Readonly<Record<string, StageEffectDefinition>> = Object.freeze({});
  private consumed = new Set<string>();

  configure(definitions: Readonly<Record<string, StageEffectDefinition>>): void { this.definitions = definitions; }
  reset(): void { this.active = []; this.issues = []; this.consumed.clear(); }
  finishBursts(): void { this.active = this.active.filter(effect => effect.persistent); }
  finishVisit(visitId: number): void { this.active = this.active.filter(effect => effect.persistent || effect.event.visitId !== visitId); }

  apply(event: StageEvent, state: StageState, now: number): readonly StageEffectIssue[] {
    const operation = event.operation;
    if (!['screenFx', 'stopScreenFx', 'portraitFx'].includes(operation.op)) {
      if (operation.op === 'exit' && typeof operation.who === 'string') this.active = this.active.filter(effect => effect.who !== operation.who);
      return [];
    }
    const eventId = `${event.runId}:${event.sequence}`;
    if (this.consumed.has(eventId)) return [];
    this.consumed.add(eventId);
    const cue = describe(operation);
    if (operation.op === 'stopScreenFx') {
      // An explicit stop is applied even when fast-forward consumes starts.
      this.active = this.active.filter(effect => effect.key !== cue.key);
      return [];
    }
    const problems: StageEffectIssue[] = [];
    const issue = (code: string, message: string) => problems.push(Object.freeze({ code, message, event }));
    const persistent = cue.target === 'screen' && cue.type === 'Persistent';
    const definition = cue.path ? this.definitions[cue.path] : undefined;
    const startedAtMs = event.timing?.delivery === 'scheduled' ? event.timing.dueAtMs : now;
    const authoredDuration = positive(operation.dur ?? operation.duration ?? record(operation.effectConfig).Duration);
    let durationMs = persistent ? null : authoredDuration ? authoredDuration * 1000 : positive(definition?.durationMs);
    if (cue.target === 'portrait') {
      if (!cue.who || !state.characters[cue.who]?.present) {
        issue('vfx-target-unavailable', `Portrait ${cue.name} targets ${cue.who ?? 'an unspecified actor'} without an entered portrait.`);
      } else if (!['Shake', 'Jump', 'Sigh'].includes(cue.name)) {
        issue('vfx-behavior-unverified', `Portrait effect ${cue.name || '(unspecified)'} has no verified Reader behavior.`);
      } else durationMs ??= cue.name === 'Shake' ? readerEffectLifetimes.portraitShake : readerEffectLifetimes.portraitY;
      if (cue.name === 'Shake') issue('vfx-native-sequence-unverified', 'Portrait Shake targets the authored actor; the native prefab shake curve and duration are not verified. The Reader uses a finite motion preview.');
    } else if (cue.type === 'Custom') {
      if (!['Shake', 'BurstEye'].includes(cue.name)) issue('vfx-behavior-unverified', `Custom screen effect ${cue.name || '(unspecified)'} has no verified Reader behavior. Its parameters are preserved.`);
      else {
        durationMs ??= cue.name === 'Shake' ? readerEffectLifetimes.screenShake : readerEffectLifetimes.burstEye;
        issue('vfx-native-sequence-unverified', `Custom ${cue.name} uses the original ${cue.name === 'Shake' ? 'RootView Shake' : 'EyeOpen'} sequence. Its native curve is unverified; the Reader uses a finite preview.`);
      }
    } else if (['OneShot', 'Persistent'].includes(cue.type)) {
      if (!cue.path) issue('vfx-source-path-missing', `${cue.type} effect has no authored asset path.`);
      else if (!definition?.sourceVerified) issue('vfx-asset-unverified', `Effect asset ${cue.path} has not been verified against the supplied source assets.`);
      else if (!definition.readerRenderer && definition.images && !definition.images.some(image => image.url === definition.primaryImage && ['sprite', 'mask'].includes(image.role ?? ''))) issue('vfx-render-asset-unavailable', `${cue.name}: the prefab is resolved, but its visible sprite or procedural material cannot be verified for bitmap playback. Its lifetime and authored stop are preserved.`);
      if (!definition?.behaviorVerified) issue('vfx-native-behavior-unverified', `${cue.name}: native Niagara/material/sequence behavior is not verified; resolved sprite assets use the Reader preview.`);
      if (!persistent) durationMs ??= readerEffectLifetimes.oneShot;
    } else issue('vfx-behavior-unverified', `Screen effect type ${cue.type || '(unspecified)'} has no verified Reader behavior.`);
    this.issues.push(...problems);
    if (problems.some(problem => ['vfx-target-unavailable', 'vfx-behavior-unverified', 'vfx-source-path-missing'].includes(problem.code))) return problems;
    // Fast-forward consumes completed bursts, while preserving the logical
    // state of persistent starts and authored stops. Late wakes sample their
    // original deadline rather than restarting an already completed burst.
    if (!persistent && (event.timing && event.timing.delivery !== 'scheduled' || durationMs !== null && now - startedAtMs >= durationMs)) return problems;
    const effect: ActiveStageEffect = Object.freeze({ ...cue, id: `${event.runId}:${event.sequence}`, persistent, startedAtMs, durationMs, event });
    if (persistent || cue.type === 'Custom' || cue.target === 'portrait') this.active = this.active.filter(old => old.key !== cue.key);
    if (!this.active.some(old => old.id === effect.id)) this.active.push(effect);
    return problems;
  }

  snapshot(now: number): StageEffectsSnapshot {
    this.active = this.active.filter(effect => effect.durationMs === null || now - effect.startedAtMs < effect.durationMs);
    const active = this.active.map(effect => {
      const elapsedMs = Math.max(0, now - effect.startedAtMs);
      return Object.freeze({ ...effect, elapsedMs, progress: effect.durationMs === null ? null : Math.min(1, elapsedMs / effect.durationMs), offset: motion(effect, elapsedMs) });
    });
    const screenOffset = active.reduce((offset, effect) => effect.target === 'screen' ? [offset[0] + effect.offset[0], offset[1] + effect.offset[1]] as [number, number] : offset, [0, 0] as [number, number]);
    return Object.freeze({ sampledAtMs: now, active: Object.freeze(active), screenOffset: Object.freeze(screenOffset), issues: Object.freeze([...this.issues]) });
  }

  restore(saved: StageEffectsSnapshot, now: number): void {
    this.reset();
    const shift = now - saved.sampledAtMs;
    this.active = saved.active.filter(effect => effect.persistent).map(effect => Object.freeze({ ...effect, startedAtMs: effect.startedAtMs + shift }));
    for (const effect of this.active) this.consumed.add(effect.id);
    this.issues = [...saved.issues];
  }

  animating(now: number): boolean { return this.active.some(effect => effect.durationMs !== null && now - effect.startedAtMs < effect.durationMs); }
}

/** Portrait motion composes with the current move/fade/light projection and
 * never changes character state, expression clocks, or portrait opacity. */
export function presentStageEffects(presentation: StagePresentation, effects: StageEffectsSnapshot): StagePresentation {
  const motions = new Map(effects.active.filter(effect => effect.target === 'portrait' && effect.who).map(effect => [effect.who, effect.offset]));
  if (!motions.size) return presentation;
  return Object.freeze({ ...presentation, characters: Object.freeze(presentation.characters.map(view => {
    const offset = motions.get(view.character.who);
    return offset ? Object.freeze({ ...view, position: Object.freeze([view.position[0] + offset[0], view.position[1] + offset[1], view.position[2]]) as StagePosition }) : view;
  })) });
}
