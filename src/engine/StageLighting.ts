import type { CharacterState } from './StageState.ts';
import type { ScriptNode, Speaker, StageEvent } from './types.ts';

/** The Reader's existing dim calibration. Native FColor is (128,128,128,255);
 * its conversion through Unreal/LGUI is outside the managed renderer trace. */
export const readerDimBrightness = .58;
export const speakerColorTransitionMs = 200;

export interface StageLightingSnapshot {
  readonly visitId: number | null;
  readonly speakerId: string | null;
  readonly overrides: Readonly<Record<string, string | null>>;
}

const emptyLighting = (): StageLightingSnapshot => Object.freeze({
  visitId: null, speakerId: null, overrides: Object.freeze({}),
});

/** Aki.Game.dll 3.8.9: TextAction first refreshes speaking state, then executes
 * start performances (0x06044006). SetSpeaking overwrites the old color effect
 * (0x06025277); later explicit Highlight/Darken cues last until the next visit.
 * This presentation state never changes the authored character or its alpha. */
export class StageLighting {
  private state: StageLightingSnapshot = emptyLighting();
  private speakers: Readonly<Record<string, Speaker>> = Object.freeze({});

  configureSpeakers(speakers: Readonly<Record<string, Speaker>>): void {
    this.speakers = speakers;
  }

  reset(): void { this.state = emptyLighting(); }

  begin(node: ScriptNode, visitId: number): void {
    this.state = Object.freeze({ visitId, speakerId: node.speakerId, overrides: Object.freeze({}) });
  }

  snapshot(): StageLightingSnapshot { return this.state; }

  restore(saved: StageLightingSnapshot): void {
    this.state = Object.freeze({
      visitId: saved.visitId, speakerId: saved.speakerId,
      overrides: Object.freeze({ ...saved.overrides }),
    });
  }

  apply(event: StageEvent): void {
    // NoText/option visits preserve speaking focus but can author new color
    // cues. The runner already rejects stale events and owns their ordering.
    if (this.state.visitId === null) return;
    const op = event.operation;
    if (typeof op.who !== 'string' || !['enter', 'modify', 'move'].includes(op.op)) return;
    let overrides = this.state.overrides;
    // Native Enter prepares an existing/new character's speaking state before
    // applying its explicit RoleConfig, so re-entry also clears an old cue.
    if (op.op === 'enter' && Object.hasOwn(overrides, op.who)) {
      const next = { ...overrides };
      delete next[op.who];
      overrides = Object.freeze(next);
    }
    if (op.effect === null || typeof op.effect === 'string') {
      overrides = Object.freeze({ ...overrides, [op.who]: op.effect });
    }
    if (overrides !== this.state.overrides) this.state = Object.freeze({ ...this.state, overrides });
  }

  brightness(character: CharacterState | undefined): number {
    if (!character) return 1;
    if (this.state.visitId === null) return character.effect === 'Darken' ? readerDimBrightness : 1;
    const effect = this.state.overrides[character.who];
    if (effect === 'Darken') return readerDimBrightness;
    if (effect && effect !== 'None') return 1;
    const speakerId = this.state.speakerId;
    if (!speakerId) return readerDimBrightness;
    const actorTalker = this.speakers[character.who]?.talkerId;
    const speakerTalker = this.speakers[speakerId]?.talkerId;
    // The native refresh compares resource talker IDs. This handles a named
    // speaker such as 701282 speaking through the entered Shorekeeper 1398.
    if (actorTalker != null || speakerTalker != null) {
      return actorTalker != null && actorTalker !== 0 && actorTalker === speakerTalker ? 1 : readerDimBrightness;
    }
    // Headless schema fixtures can omit the separate speaker catalog.
    return character.who === speakerId ? 1 : readerDimBrightness;
  }
}
