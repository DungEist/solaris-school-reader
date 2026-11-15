import { secondsToMs } from './Clock.ts';
import type { CharacterState, StagePosition, StageState } from './StageState.ts';
import type { StageEvent } from './types.ts';
import type { ScriptNode, Speaker } from './types.ts';
import { StageLighting, speakerColorTransitionMs } from './StageLighting.ts';
import type { StageLightingSnapshot } from './StageLighting.ts';

interface Tween<T> {
  readonly from: T;
  readonly to: T;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly event: StageEvent;
}

interface CharacterTracks {
  position: Tween<StagePosition> | null;
  portrait: Tween<number> | null;
  avatar: Tween<number> | null;
  brightness: Tween<number> | null;
}

export interface PresentedCharacter {
  readonly character: CharacterState;
  readonly position: StagePosition;
  readonly portraitOpacity: number;
  readonly avatarOpacity: number;
  /** Color dimming is independent of enter/exit and visibility alpha. */
  readonly brightness?: number;
}

export interface ActiveTransition {
  readonly target: string;
  readonly property: string;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly progress: number;
  readonly event: StageEvent;
}

export interface StagePresentation {
  readonly characters: readonly PresentedCharacter[];
  readonly blackOpacity: number;
  readonly transitions: readonly ActiveTransition[];
}

const progress = (tween: Tween<unknown>, now: number) => Math.min(1, Math.max(0, (now - tween.startedAtMs) / tween.durationMs));
const interpolate = (a: number, b: number, p: number) => a + (b - a) * p;
const numberAt = (tween: Tween<number> | null | undefined, target: number, now: number) => tween ? interpolate(tween.from, tween.to, progress(tween, now)) : target;
const positionAt = (tween: Tween<StagePosition> | null | undefined, target: StagePosition, now: number): StagePosition => tween ? Object.freeze(tween.from.map((value, index) => interpolate(value, tween.to[index], progress(tween, now)))) as StagePosition : target;
const opacity = (character: CharacterState | undefined, portrait: boolean) => character && (portrait ? character.portraitVisible : character.avatarVisible) ? 1 : 0;
const milliseconds = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? secondsToMs(value) : 0;
const equalPosition = (a: StagePosition, b: StagePosition) => a.every((value, index) => value === b[index]);

/** Presentation tracks are independent of persistent logical state. Durations
 * come from source fields. Linear interpolation is a viewer policy: numeric
 * EaseCurve presets and game opacity/pivot conventions are not decoded. */
export class StageTransitions {
  private characters = new Map<string, CharacterTracks>();
  private black: Tween<number> | null = null;
  private readonly lighting = new StageLighting();

  reset(): void { this.settle(); this.lighting.reset(); }
  settle(): void { this.characters.clear(); this.black = null; }

  configureSpeakers(speakers: Readonly<Record<string, Speaker>>): void { this.lighting.configureSpeakers(speakers); }
  lightingSnapshot(): StageLightingSnapshot { return this.lighting.snapshot(); }
  restoreLighting(saved: StageLightingSnapshot): void { this.lighting.restore(saved); }

  /** Runs for every text visit before its authored start performances. Voice
   * playback never calls this hook. Explicit color cues can then override it. */
  beginVisit(state: StageState, node: ScriptNode, visitId: number, now: number, instant = false): void {
    const before = new Map(Object.values(state.characters).map(character => [character.who, this.lighting.brightness(character)]));
    this.lighting.begin(node, visitId);
    for (const character of Object.values(state.characters)) {
      const target = this.lighting.brightness(character);
      const old = before.get(character.who)!;
      if (old === target) continue;
      const tracks = this.characters.get(character.who) ?? { position: null, portrait: null, avatar: null, brightness: null };
      // Implicit speaker refresh is presentation provenance, never an invented
      // entry in the authored stage-event stream.
      const event: StageEvent = Object.freeze({ ...character.lastEvent, nid: node.nid, visitId,
        operation: Object.freeze({ op: 'speakerFocus', who: character.who, t: 0, origin: 'dialogue-speaker' }) });
      const from = numberAt(tracks.brightness, old, now);
      tracks.brightness = !instant && character.present && from !== target
        ? Object.freeze({ from, to: target, startedAtMs: now, durationMs: speakerColorTransitionMs, event }) : null;
      this.characters.set(character.who, tracks);
    }
  }

  apply(previous: StageState, next: StageState, event: StageEvent, instant: boolean, now: number): void {
    const operation = event.operation;
    const oldBrightness = typeof operation.who === 'string' ? this.lighting.brightness(previous.characters[operation.who]) : 1;
    this.lighting.apply(event);
    const animate = !instant && (!event.timing || event.timing.delivery === 'scheduled');
    // Late callbacks sample the source timeline instead of extending a fade.
    const startedAtMs = event.timing?.delivery === 'scheduled' ? event.timing.dueAtMs : now;
    const tween = <T>(from: T, to: T, durationMs: number): Tween<T> | null => animate && durationMs > 0 ? Object.freeze({ from, to, startedAtMs, durationMs, event }) : null;
    if (typeof operation.who === 'string' && ['enter', 'exit', 'move', 'modify'].includes(operation.op)) {
      const who = operation.who;
      const before = previous.characters[who];
      const after = next.characters[who];
      if (!after || before === after) return;
      const tracks = this.characters.get(who) ?? { position: null, portrait: null, avatar: null, brightness: null };
      for (const field of ['portrait', 'avatar'] as const) {
        const oldTarget = opacity(before, field === 'portrait'), newTarget = opacity(after, field === 'portrait');
        if (oldTarget !== newTarget) {
          const duration = milliseconds(newTarget > oldTarget ? operation.fadeIn : operation.fadeOut);
          tracks[field] = tween(numberAt(tracks[field], oldTarget, startedAtMs), newTarget, duration);
        }
      }
      const newBrightness = this.lighting.brightness(after);
      if (oldBrightness !== newBrightness) {
        // Native Modify and SetSpeaking both use ApplyColor's independent
        // 200ms color track. Visibility fade fields only control opacity.
        const duration = before?.present && after.present ? speakerColorTransitionMs : 0;
        tracks.brightness = tween(numberAt(tracks.brightness, oldBrightness, startedAtMs), newBrightness, duration);
      }
      if (before && !equalPosition(before.position, after.position)) {
        tracks.position = tween(positionAt(tracks.position, before.position, startedAtMs), after.position, operation.op === 'move' ? milliseconds(operation.dur) : 0);
      }
      this.characters.set(who, tracks);
    }
    if (previous.blackScreen?.visible !== next.blackScreen?.visible && ['blackIn', 'blackOut'].includes(operation.op)) {
      const oldTarget = previous.blackScreen?.visible ? 1 : 0, newTarget = next.blackScreen?.visible ? 1 : 0;
      this.black = tween(numberAt(this.black, oldTarget, startedAtMs), newTarget, milliseconds(operation.fade));
    }
  }

  project(state: StageState, now: number): StagePresentation {
    const transitions: ActiveTransition[] = [];
    const record = (target: string, property: string, tween: Tween<unknown> | null | undefined) => {
      if (tween && progress(tween, now) < 1) transitions.push(Object.freeze({ target, property, startedAtMs: tween.startedAtMs, durationMs: tween.durationMs, progress: progress(tween, now), event: tween.event }));
    };
    const characters = Object.values(state.characters).map(character => {
      const tracks = this.characters.get(character.who);
      record(character.who, 'position', tracks?.position);
      record(character.who, 'portrait', tracks?.portrait);
      record(character.who, 'avatar', tracks?.avatar);
      record(character.who, 'brightness', tracks?.brightness);
      return Object.freeze({
        character, position: positionAt(tracks?.position, character.position, now),
        portraitOpacity: numberAt(tracks?.portrait, opacity(character, true), now),
        avatarOpacity: numberAt(tracks?.avatar, opacity(character, false), now),
        brightness: numberAt(tracks?.brightness, this.lighting.brightness(character), now),
      });
    });
    record('screen', 'black', this.black);
    return Object.freeze({ characters: Object.freeze(characters), blackOpacity: numberAt(this.black, state.blackScreen?.visible ? 1 : 0, now), transitions: Object.freeze(transitions) });
  }
}

export function staticStagePresentation(state: StageState): StagePresentation {
  return new StageTransitions().project(state, 0);
}
