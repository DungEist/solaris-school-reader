import type { Metadata, Navigation, StagePhase, VisitToken } from './types.ts';

/** Exam answers have their own IDs and correctness fields, not AVG choices. */
export interface QuizAnswer {
  readonly id: number;
  readonly textKey: string | null;
  readonly correct: boolean | null;
  readonly raw: Metadata;
}

export interface QuizDefinition {
  readonly id: number;
  readonly actionId: number;
  readonly titleKey: string | null;
  readonly questionKey: string | null;
  readonly illustration: string | null;
  readonly answers: readonly QuizAnswer[];
  /** Source metadata only; this phase does not update event/exam scores. */
  readonly addScore: number | null;
  /** Source result-display duration, not an answer deadline or auto-continue. */
  readonly resultHoldMs: number | null;
  readonly raw: Metadata;
}

export type QuizResult = 'correct' | 'incorrect';
export interface QuizToken extends VisitToken { readonly instanceId: number; }
export interface QuizState extends QuizToken {
  readonly definition: QuizDefinition;
  readonly phase: 'question' | 'unresolved' | 'result' | 'continued';
  readonly selectedAnswerId: number | null;
  readonly result: QuizResult | null;
  readonly resultSource: 'data' | 'debug-override' | null;
  /** Resume the existing node/phase path; answers do not supply jump targets. */
  readonly continuation: { readonly phase: StagePhase; readonly next: Navigation };
}

export type QuizAction =
  | { readonly type: 'answer'; readonly token: QuizToken; readonly answerId: number }
  | { readonly type: 'overrideResult'; readonly token: QuizToken; readonly result: QuizResult }
  | { readonly type: 'continue'; readonly token: QuizToken };

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function initialQuizState(definition: QuizDefinition, token: QuizToken, continuation: QuizState['continuation']): QuizState {
  return freeze({
    runId: token.runId, visitId: token.visitId, instanceId: token.instanceId,
    definition: structuredClone(definition), continuation: structuredClone(continuation),
    phase: 'question' as const, selectedAnswerId: null, result: null, resultSource: null,
  });
}

export function matchesQuizToken(state: QuizToken, token: QuizToken): boolean {
  return state.runId === token.runId && state.visitId === token.visitId && state.instanceId === token.instanceId;
}

/** Pure, idempotent state changes. Neither grading nor Continue navigates here. */
export function reduceQuiz(state: QuizState, action: QuizAction): QuizState {
  if (!matchesQuizToken(state, action.token)) return state;
  if (action.type === 'answer' && state.phase === 'question') {
    const answer = Number.isSafeInteger(action.answerId) ? state.definition.answers.find(answer => answer.id === action.answerId) : undefined;
    if (!answer) return state;
    const known = typeof answer.correct === 'boolean';
    return Object.freeze({
      ...state, selectedAnswerId: answer.id, phase: known ? 'result' : 'unresolved',
      result: known ? answer.correct ? 'correct' : 'incorrect' : null,
      resultSource: known ? 'data' : null,
    });
  }
  if (action.type === 'overrideResult' && state.phase === 'unresolved' && ['correct', 'incorrect'].includes(action.result)) {
    return Object.freeze({ ...state, phase: 'result', result: action.result, resultSource: 'debug-override' });
  }
  if (action.type === 'continue' && state.phase === 'result') return Object.freeze({ ...state, phase: 'continued' });
  return state;
}
