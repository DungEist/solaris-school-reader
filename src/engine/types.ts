/** The engine consumes the neutral schema 2 format, never raw game tables. */
import type { StageState } from './StageState.ts';
import type { PendingStageOperation, StageTiming } from './StageScheduler.ts';
import type { StagePresentation } from './StageTransitions.ts';
import type { StageEffectsSnapshot } from './StageEffects.ts';
import type { QuizDefinition, QuizState } from './Quiz.ts';
import type { BranchResolution, ConditionResult, StoryCommand, StoryState } from './StoryState.ts';
export type ScriptId = string;
export type Metadata = Readonly<Record<string, unknown>>;
export type StagePhase = 'start' | 'option' | 'end';

export type Navigation =
  | { readonly type: 'seq' }
  | { readonly type: 'jump'; readonly to: number }
  | { readonly type: 'end' };

export interface StageOp extends Metadata {
  readonly op: string;
  readonly t: number;
  readonly phase?: StagePhase;
  readonly quiz?: QuizDefinition;
}

export interface ScriptOption {
  readonly textKey: string | null;
  /** Compatibility metadata only. Navigation always uses next. */
  readonly to?: number | null;
  readonly next: Navigation;
  /** AVG metadata; Phase 1 records this without setting game flags. */
  readonly optionId: number | null;
  readonly actions?: readonly Metadata[];
  readonly preCondition?: unknown;
  readonly typeParams?: Metadata;
  readonly performances?: readonly StageOp[];
  readonly raw?: Metadata;
}

export interface ScriptNode {
  readonly nid: number;
  readonly kind: 'line' | 'narration' | 'centerText' | 'silent' | 'option';
  readonly style: string;
  readonly speakerId: string | null;
  readonly textKey: string | null;
  readonly stage: readonly StageOp[];
  readonly voice?: string | readonly string[];
  readonly options?: readonly ScriptOption[];
  readonly next: Navigation;
  readonly actions?: readonly Metadata[];
  readonly raw?: Metadata;
}

export interface ScriptConfig extends Metadata {
  readonly initialBackground?: number | null;
  readonly initialAudio?: readonly (string | null)[];
  readonly subtype?: string | null;
}

export type FlowAction =
  | { readonly op: 'configure'; readonly config: ScriptConfig; readonly raw?: Metadata }
  | { readonly op: 'talk'; readonly nids: readonly number[] }
  | { readonly op: 'movie'; readonly videoName: string | null; readonly raw?: Metadata }
  | { readonly op: 'unsupported'; readonly raw: Metadata };

export interface Script {
  readonly id: ScriptId;
  readonly stateKey: string;
  readonly group: string;
  readonly needSave: boolean;
  readonly registered: boolean;
  /** Convenience metadata; only ordered configure actions apply configuration. */
  readonly config: ScriptConfig;
  readonly flowActions: readonly FlowAction[];
  readonly nodes: readonly ScriptNode[];
}

export interface Manifest extends Metadata {
  readonly schema: 2;
  readonly activityId: number;
  readonly titleKey: string;
  readonly source: Metadata;
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly scripts: string;
  readonly report: string;
}

export interface ScriptIndexEntry {
  readonly id: ScriptId;
  readonly stateKey: string;
  readonly group: string;
  readonly nodes: number;
  readonly registered: boolean;
}

export interface Speaker {
  readonly nameKey: string | null;
  readonly talkerId: number | null;
  readonly nameZh?: string | null;
}

export interface EventContext {
  readonly scriptId: ScriptId;
  readonly flowActionIndex: number;
  readonly nid: number | null;
}

export interface ErrorInfo {
  readonly code: string;
  readonly message: string;
  readonly fatal: boolean;
  readonly scriptId: ScriptId | null;
  readonly flowActionIndex: number | null;
  readonly nid: number | null;
  readonly optionIndex?: number;
  readonly path?: string;
  readonly target?: number;
}

export interface NavigationEntry extends EventContext {
  readonly from: number | null;
  readonly to: number | null;
  readonly reason: 'start' | 'seq' | 'jump' | 'end' | 'invalid-target';
  readonly requestedNext?: Navigation;
  readonly optionIndex?: number;
}

export interface ChoiceEntry extends EventContext {
  readonly nid: number;
  readonly optionIndex: number;
  readonly optionId: number | null;
  readonly textKey: string | null;
  readonly next: Navigation;
  readonly actions: readonly Metadata[];
  readonly preCondition?: unknown;
  readonly typeParams?: Metadata;
  readonly performances?: readonly StageOp[];
  readonly raw?: Metadata;
  readonly debugOverride?: boolean;
  readonly decision?: 'player' | 'automatic' | 'debug-override';
}

export interface StageEvent extends EventContext {
  readonly type: 'stage';
  readonly runId: number;
  readonly sequence: number;
  readonly timing?: StageTiming;
  readonly source: 'configure' | 'node' | 'option';
  readonly visitId: number | null;
  readonly phase: StagePhase;
  readonly optionIndex?: number;
  readonly operation: StageOp;
  readonly disposition: 'state' | 'placeholder' | 'muted' | 'metadata' | 'unsupported';
}

type EventPayload =
  | { readonly type: 'flow'; readonly action: FlowAction }
  | { readonly type: 'configure'; readonly config: ScriptConfig }
  | { readonly type: 'dialogue'; readonly node: ScriptNode; readonly visitId: number }
  | { readonly type: 'choices'; readonly options: readonly ScriptOption[] }
  | Omit<StageEvent, keyof EventContext | 'runId' | 'sequence'>
  | { readonly type: 'navigation'; readonly entry: NavigationEntry }
  | { readonly type: 'choiceSelected'; readonly entry: ChoiceEntry; readonly visitId: number }
  | { readonly type: 'storyMutation'; readonly actionId: number; readonly changes: readonly Metadata[]; readonly visitId: number | null; readonly stageSequence: number }
  | { readonly type: 'storyCommand'; readonly command: StoryCommand; readonly actionId: number }
  | { readonly type: 'checkpointRestored'; readonly history: readonly RunnerEvent[]; readonly audioHistory?: readonly string[] }
  | { readonly type: 'interactionVoice'; readonly cue: string | null; readonly textKey?: string; readonly speakerId?: string; readonly interactionId?: number }
  | { readonly type: 'quizOpened'; readonly quiz: QuizState }
  | { readonly type: 'quizAnswered'; readonly quiz: QuizState }
  | { readonly type: 'quizResultOverridden'; readonly quiz: QuizState }
  | { readonly type: 'quizContinued'; readonly quiz: QuizState }
  | { readonly type: 'talkComplete'; readonly reason: 'end' | 'exhausted' }
  | { readonly type: 'movieSkipped'; readonly videoName: string | null; readonly suppressedAudio: readonly string[]; readonly raw?: Metadata }
  | { readonly type: 'completed' }
  | { readonly type: 'error'; readonly error: ErrorInfo }
  | { readonly type: 'debug'; readonly code: string; readonly message: string; readonly data?: unknown };

export type RunnerEvent = EventContext & {
  readonly runId: number;
  readonly sequence: number;
} & EventPayload;

export type RunnerStatus = 'idle' | 'ready' | 'running' | 'dialogue' | 'choices' | 'quiz' | 'ending' | 'completed' | 'error' | 'disposed';

export interface VisitToken { readonly runId: number; readonly visitId: number; }

export interface RunnerSnapshot {
  readonly status: RunnerStatus;
  readonly runId: number;
  /** Each loaded/restarted/restored scene owns a separate renderer lifetime. */
  readonly sceneId: number;
  readonly visitId: number;
  readonly clockMs: number;
  readonly inputReady: boolean;
  readonly instantTransitions: boolean;
  readonly stagePhase: StagePhase | null;
  readonly hiddenChoice: boolean;
  readonly branchResolution: BranchResolution | null;
  readonly storyState: StoryState;
  readonly pendingStage: readonly PendingStageOperation[];
  readonly presentation: StagePresentation;
  readonly effects: StageEffectsSnapshot;
  readonly scriptId: ScriptId | null;
  readonly flowActionIndex: number;
  readonly nid: number | null;
  readonly node: ScriptNode | null;
  readonly dialogue: ScriptNode | null;
  readonly choices: readonly ScriptOption[];
  readonly choiceConditions: readonly ConditionResult[];
  readonly quiz: QuizState | null;
  readonly config: ScriptConfig;
  readonly navigationHistory: readonly NavigationEntry[];
  readonly choiceHistory: readonly ChoiceEntry[];
  readonly stageEvents: readonly StageEvent[];
  readonly audioHistory?: readonly string[];
  readonly stageState: StageState;
  readonly events: readonly RunnerEvent[];
  readonly diagnostics: readonly ErrorInfo[];
  readonly error: ErrorInfo | null;
}
