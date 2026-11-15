import type { StageEvent, StageOp } from './types.ts';

export type StagePosition = readonly [number, number, number];

export interface CharacterState {
  readonly who: string;
  /** Persistent entry identity survives batched snapshots and later modifies. */
  readonly entrySequence: number | null;
  readonly expression: number | null;
  readonly position: StagePosition;
  readonly present: boolean;
  readonly hidePortrait: boolean;
  readonly hideAvatar: boolean;
  readonly portraitVisible: boolean;
  readonly avatarVisible: boolean;
  readonly effect: string | null;
  readonly portraitEffect: StageOp | null;
  readonly lastEvent: StageEvent;
}

export interface BackgroundState {
  readonly id: number;
  readonly mode: 'Load';
  readonly lastEvent: StageEvent;
}

export type CGState =
  | { readonly kind: 'image'; readonly id: number; readonly mode: 'LoadImage'; readonly lastEvent: StageEvent }
  | { readonly kind: 'prefab'; readonly id: number | null; readonly mode: 'LoadPrefab'; readonly lastEvent: StageEvent };

export interface StageIssue {
  readonly code: string;
  readonly message: string;
  readonly event: StageEvent;
}

export interface StageState {
  readonly runId: number;
  readonly lastSequence: number;
  readonly appliedEvents: number;
  readonly background: BackgroundState | null;
  readonly cg: CGState | null;
  readonly blackScreen: { readonly visible: boolean; readonly lastEvent: StageEvent } | null;
  readonly characters: Readonly<Record<string, CharacterState>>;
  readonly issues: readonly StageIssue[];
}

export const originPosition: StagePosition = Object.freeze([0, 0, 1]);

export function initialStageState(runId = 0): StageState {
  return Object.freeze({
    runId, lastSequence: 0, appliedEvents: 0, background: null, cg: null, blackScreen: null,
    characters: Object.freeze({}), issues: Object.freeze([]),
  });
}

const id = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const characterOps = new Set(['enter', 'exit', 'move', 'modify', 'portraitFx']);
const deferredOps = new Set(['cgMove', 'roleIntro']);
const effectOps = new Set(['portraitFx', 'screenFx', 'stopScreenFx']);

export function isStagePosition(value: unknown): value is StagePosition {
  return Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'number' && Number.isFinite(item)) && value[2] >= 0;
}

/** Pure ordered event reducer. Repeated/stale events never update visual state. */
export function reduceStageEvent(previous: StageState, event: StageEvent): StageState {
  if (event.runId < previous.runId) return previous;
  const state = event.runId > previous.runId ? initialStageState(event.runId) : previous;
  if (event.sequence <= state.lastSequence) return state;

  let background = state.background;
  let cg = state.cg;
  let blackScreen = state.blackScreen;
  let characters = state.characters;
  const issues: StageIssue[] = [];
  const issue = (code: string, message: string) => issues.push(Object.freeze({ code, message, event }));
  const operation = event.operation;

  if (operation.op === 'bg') {
    const mode = operation.mode ?? (event.source === 'configure' ? 'Load' : null);
    if (mode === 'Load') {
      if (id(operation.id)) background = Object.freeze({ id: operation.id, mode, lastEvent: event });
      else issue('invalid-background-id', `Background Load needs a non-negative integer id; received ${String(operation.id)}. Existing state is preserved.`);
    }
    else if (mode === 'Clean') background = null;
    else issue('unsupported-background-mode', `Background mode ${String(mode)} with id ${String(operation.id)} is unsupported; existing state is preserved.`);
  } else if (operation.op === 'cg') {
    if (operation.mode === 'LoadImage') {
      if (id(operation.id)) cg = Object.freeze({ kind: 'image', id: operation.id, mode: operation.mode, lastEvent: event });
      else issue('invalid-cg-id', `CG LoadImage needs a non-negative integer id; received ${String(operation.id)}. Existing state is preserved.`);
    } else if (operation.mode === 'Clean') cg = null;
    else if (operation.mode === 'LoadPrefab') {
      cg = Object.freeze({ kind: 'prefab', id: id(operation.id) ? operation.id : null, mode: operation.mode, lastEvent: event });
      issue('unsupported-cg-prefab', 'CG LoadPrefab requests a prefab rather than an image. A labeled placeholder replaces the CG image; prefab behavior is deferred.');
    } else issue('unsupported-cg-mode', `CG mode ${String(operation.mode)} with id ${String(operation.id)} is unsupported; existing state is preserved.`);
  } else if (operation.op === 'blackIn' || operation.op === 'blackOut') {
    if ((operation.op === 'blackIn' || operation.screen !== undefined) && operation.screen !== 'Black') issue('unsupported-screen-type', `Only the explicit source ScreenType Black is supported; received ${String(operation.screen)}.`);
    else blackScreen = Object.freeze({ visible: operation.op === 'blackIn', lastEvent: event });
  } else if (characterOps.has(operation.op)) {
    if (typeof operation.who !== 'string' || !operation.who) {
      issue('invalid-character-identity', `Character operation ${operation.op} has no stage who; it cannot identify a character.`);
    } else {
      const old = Object.hasOwn(characters, operation.who) ? characters[operation.who] : undefined;
      if (!old && operation.op !== 'enter') issue('character-before-enter', `${operation.op} references stage who ${operation.who} before Enter; metadata is tracked without inventing a visible character.`);
      let position = old?.position ?? originPosition;
      if (operation.pos !== undefined) {
        if (isStagePosition(operation.pos)) position = Object.freeze([...operation.pos]) as StagePosition;
        else issue('invalid-character-position', `Invalid position for stage who ${operation.who}; its previous position is preserved.`);
      }
      const present = operation.op === 'enter' ? true : operation.op === 'exit' ? false : old?.present ?? false;
      const hidePortrait = typeof operation.hidePortrait === 'boolean' ? operation.hidePortrait : old?.hidePortrait ?? false;
      const hideAvatar = typeof operation.hideAvatar === 'boolean' ? operation.hideAvatar : old?.hideAvatar ?? false;
      for (const field of ['hidePortrait', 'hideAvatar']) {
        if (operation[field] !== undefined && typeof operation[field] !== 'boolean') issue('invalid-character-visibility', `${field} for stage who ${operation.who} must be boolean; existing state is preserved.`);
      }
      const expression = operation.expr === null ? null : id(operation.expr) ? operation.expr : old?.expression ?? null;
      if (operation.expr !== undefined && operation.expr !== null && !id(operation.expr)) issue('invalid-character-expression', `Expression for stage who ${operation.who} must be a non-negative integer or null; existing state is preserved.`);
      const effect = operation.effect === null ? null : typeof operation.effect === 'string' ? operation.effect : old?.effect ?? null;
      if (operation.effect !== undefined && operation.effect !== null && typeof operation.effect !== 'string') issue('invalid-character-effect', `Effect for stage who ${operation.who} must be a string or null; existing state is preserved.`);
      else if (typeof operation.effect === 'string' && !['Highlight', 'Darken', 'None'].includes(operation.effect)) issue('unsupported-character-effect', `Character effect ${effect} is retained as metadata; its visual behavior is unsupported.`);
      const character: CharacterState = Object.freeze({
        who: operation.who, entrySequence: operation.op === 'enter' ? state.appliedEvents + 1 : old?.entrySequence ?? null,
        expression, position, present, hidePortrait, hideAvatar,
        portraitVisible: present && !hidePortrait, avatarVisible: present && !hideAvatar,
        effect, portraitEffect: operation.op === 'portraitFx' ? operation : old?.portraitEffect ?? null,
        lastEvent: event,
      });
      characters = Object.freeze({ ...characters, [character.who]: character });
    }
  } else if (!['audio', 'activityAction'].includes(operation.op) && !deferredOps.has(operation.op) && !effectOps.has(operation.op)) {
    issue('unsupported-stage-operation', `Stage operation ${operation.op} has no static visual handler; its metadata is preserved.`);
  }

  if (deferredOps.has(operation.op)) issue('deferred-stage-operation', `${operation.op} timing and parameters are preserved; animated/auxiliary stage behavior is deferred.`);

  return Object.freeze({
    runId: event.runId, lastSequence: event.sequence, appliedEvents: state.appliedEvents + 1,
    background, cg, blackScreen, characters,
    issues: issues.length ? Object.freeze([...state.issues, ...issues]) : state.issues,
  });
}
