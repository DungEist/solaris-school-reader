import { EngineError, errorInfo } from './EngineError.ts';
import { skipAudioDelivery } from './AudioDelivery.ts';
import { FlowDispatcher, movieAudioCues } from './FlowDispatcher.ts';
import { StageEngine } from './StageEngine.ts';
import { systemClock } from './Clock.ts';
import type { Clock } from './Clock.ts';
import type { StageTiming } from './StageScheduler.ts';
import { StageTransitions } from './StageTransitions.ts';
import { StageEffects, presentStageEffects } from './StageEffects.ts';
import type { StageEffectDefinition } from './StageEffects.ts';
import type { StageLightingSnapshot } from './StageLighting.ts';
import { initialStageState, reduceStageEvent } from './StageState.ts';
import type { StageState } from './StageState.ts';
import { initialQuizState, reduceQuiz } from './Quiz.ts';
import type { QuizResult, QuizState, QuizToken } from './Quiz.ts';
import { emptyConfig, prepareScript } from './validation.ts';
import type { PreparedScript, TalkBlock } from './validation.ts';
import type { ChoiceEntry, ErrorInfo, EventContext, Metadata, Navigation, NavigationEntry, RunnerEvent, RunnerSnapshot, RunnerStatus, ScriptConfig, ScriptNode, ScriptOption, Speaker, StageEvent, StageOp, StagePhase, VisitToken } from './types.ts';
import { applyActivityAction, emptyStorySource, evaluateCondition, initialStoryState, recordPlotKey, recordStoryChoice, resolveHiddenBranch } from './StoryState.ts';
import type { BranchResolution, StoryEffect, StorySource, StoryState } from './StoryState.ts';

export interface RunnerCheckpoint {
  readonly owner: symbol;
  readonly prepared: PreparedScript;
  readonly source: StorySource;
  readonly snapshot: RunnerSnapshot;
  readonly entryStoryState: StoryState;
  readonly lighting: StageLightingSnapshot;
}

type EventPayload = RunnerEvent extends infer E ? E extends RunnerEvent ? Omit<E, keyof EventContext | 'runId' | 'sequence'> : never : never;

const staticOps = new Set(['bg', 'cg', 'enter', 'exit', 'move', 'modify', 'blackIn', 'blackOut', 'portraitFx', 'screenFx', 'stopScreenFx']);
const knownStageOps = new Set([...staticOps, 'portraitFx', 'screenFx', 'stopScreenFx', 'cgMove', 'roleIntro']);

/** Headless script engine. Commands and clock callbacks own lifecycle;
 * React only reads immutable snapshots and sends user commands. */
export class ScriptRunner {
  private prepared: PreparedScript | null = null;
  private dispatcher: FlowDispatcher | null = null;
  private block: TalkBlock | null = null;
  private status: RunnerStatus = 'idle';
  private scriptId: string | null = null;
  private flowActionIndex = -1;
  private nid: number | null = null;
  private node: ScriptNode | null = null;
  private dialogue: ScriptNode | null = null;
  private choices: readonly ScriptOption[] = [];
  private quiz: QuizState | null = null;
  private quizQueue: QuizState[] = [];
  private quizResumeStatus: RunnerStatus | null = null;
  private config: ScriptConfig = emptyConfig;
  private runId = 0;
  private sceneId = 0;
  private visitId = 0;
  private sequence = 0;
  private error: ErrorInfo | null = null;
  private events: RunnerEvent[] = [];
  private stages: StageEvent[] = [];
  private stageState: StageState = initialStageState();
  private navigation: NavigationEntry[] = [];
  private selections: ChoiceEntry[] = [];
  private storyState: StoryState = initialStoryState();
  private storyCheckpoint: StoryState = this.storyState;
  private storySource: StorySource = emptyStorySource;
  private branchResolution: BranchResolution | null = null;
  private diagnostics: ErrorInfo[] = [];
  private movieCues = new Set<string>();
  private busy = false;
  private disposed = false;
  private readonly clock: Clock;
  private readonly navigationDebounceMs: number;
  private inputReadyAtMs = 0;
  private instantTransitions: boolean;
  private pendingNavigation: { next: Navigation; optionIndex?: number } | null = null;
  private automaticSeen = new Set<string>();
  private automaticSteps = 0;
  private readonly transitions = new StageTransitions();
  private readonly effects = new StageEffects();
  private frameTimer: unknown = null;
  private frameEpoch = 0;
  private readonly maxAutomaticSteps: number;
  private readonly stage: StageEngine;
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: RunnerEvent) => void>();
  private snapshot: RunnerSnapshot;
  private readonly checkpointOwner = Symbol('reader-checkpoint');

  constructor(options: { maxAutomaticSteps?: number; clock?: Clock; instantTransitions?: boolean; navigationDebounceMs?: number } = {}) {
    this.clock = options.clock ?? systemClock;
    this.instantTransitions = options.instantTransitions ?? false;
    this.navigationDebounceMs = options.navigationDebounceMs ?? 0;
    if (!Number.isFinite(this.navigationDebounceMs) || this.navigationDebounceMs < 0) throw new Error('navigationDebounceMs must be a nonnegative number');
    this.maxAutomaticSteps = options.maxAutomaticSteps ?? 10_000;
    if (!Number.isSafeInteger(this.maxAutomaticSteps) || this.maxAutomaticSteps < 1) throw new Error('maxAutomaticSteps must be a positive integer');
    this.stage = new StageEngine((operation, phase, context, visitId, timing, optionIndex) => this.emitStage(operation, phase, context, phase === 'option' ? 'option' : 'node', visitId, timing, optionIndex), {
      clock: this.clock, instant: this.instantTransitions,
      wake: () => { this.command(() => { this.stage.runDue(); this.resume(); return true; }); },
    });
    this.snapshot = this.makeSnapshot();
  }

  getSnapshot = (): RunnerSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  onEvent(listener: (event: RunnerEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); };
  }

  setStageSpeakers(speakers: Readonly<Record<string, Speaker>>): void { this.transitions.configureSpeakers(speakers); }
  setVfxDefinitions(definitions: Readonly<Record<string, StageEffectDefinition>>): void { this.effects.configure(definitions); }

  /** Exploration leaves the visual-novel composition even when its next map
   * action does not load a script. Never carry its effects or speaker focus. */
  endStagePlayback(): boolean {
    return this.command(() => {
      this.stage.reset(); this.cancelFrame(); this.effects.reset(); this.transitions.reset();
      this.sceneId++;
      this.stageState = Object.freeze({ ...this.stageState, characters: Object.freeze({}), cg: null, blackScreen: null });
      this.pendingNavigation = null; this.clearQuizzes(); this.node = null; this.dialogue = null; this.nid = null; this.choices = Object.freeze([]);
      this.status = 'completed';
      return true;
    });
  }

  /** Schema is mandatory. Malformed input becomes an error event and state. */
  load(script: unknown, manifest: unknown, options: { preserveStoryState?: boolean; storySource?: StorySource; initializeStory?: boolean; continuation?: boolean; speakers?: Readonly<Record<string, Speaker>> } = {}): boolean {
    return this.command(() => {
      this.prepared = null;
      if (options.storySource) this.storySource = options.storySource;
      if (options.speakers) this.setStageSpeakers(options.speakers);
      this.reset(options.continuation);
      if (!options.preserveStoryState) this.storyState = initialStoryState(options.initializeStory ? this.storySource : emptyStorySource);
      this.storyCheckpoint = this.storyState;
      if (script && typeof script === 'object' && 'id' in script && typeof script.id === 'string') this.scriptId = script.id;
      this.prepared = prepareScript(script, manifest);
      this.scriptId = this.prepared.script.id;
      this.status = 'ready';
      this.emitDiagnostics();
      return true;
    });
  }

  /** Start the authored activity with known defaults; arbitrary developer
   * scene loads continue to have an explicitly unknown prior baseline. */
  beginPlaythrough(source: StorySource): boolean {
    return this.command(() => {
      this.prepared = null; this.reset(); this.storySource = source;
      this.storyState = initialStoryState(source); this.storyCheckpoint = this.storyState;
      return this.storyState.initialized;
    });
  }

  applyStoryEffect(effect: StoryEffect, actionId = 0): boolean {
    return this.command(() => { this.deliverStoryEffect(effect, actionId, null, this.sequence); return true; });
  }

  dispatchActivityAction(actionId: number, eventKey: string): boolean {
    return this.command(() => {
      const operation = Object.freeze({ op: 'activityAction', kind: 'SolarSchool', actionId, t: 0 });
      const event = this.emit({ type: 'stage', source: 'configure', visitId: null, phase: 'start', operation, disposition: 'metadata' });
      this.deliverStoryEffect(applyActivityAction(this.storyState, actionId, this.storySource, eventKey), actionId, null, event.sequence);
      return true;
    });
  }

  /** Explicit authored character interaction; it does not advance story dialogue. */
  presentRoleVoice(cue: string | null, textKey?: string, speakerId?: string, interactionId?: number): boolean {
    return this.command(() => { this.emit({ type: 'interactionVoice', cue, textKey, speakerId, interactionId }); return true; });
  }

  get canCheckpoint(): boolean { return !!this.prepared && ['dialogue', 'choices', 'completed'].includes(this.status) && !this.stage.pending.length && !this.quiz; }

  createCheckpoint(): RunnerCheckpoint | null {
    if (!this.canCheckpoint) return null;
    // Persistent visuals run without publishing a Reader snapshot every
    // frame. Sample the save boundary so restoration retains their phase.
    return Object.freeze({ owner: this.checkpointOwner, prepared: this.prepared!, source: this.storySource, snapshot: this.makeSnapshot(), entryStoryState: this.storyCheckpoint, lighting: this.transitions.lightingSnapshot() });
  }

  restoreCheckpoint(checkpoint: RunnerCheckpoint): boolean {
    return this.command(() => {
      if (checkpoint.owner !== this.checkpointOwner) return false;
      const saved = checkpoint.snapshot;
      this.reset(); this.prepared = checkpoint.prepared; this.storySource = checkpoint.source;
      this.storyState = saved.storyState; this.storyCheckpoint = checkpoint.entryStoryState;
      this.scriptId = saved.scriptId; this.flowActionIndex = saved.flowActionIndex;
      this.nid = saved.nid; this.node = saved.node; this.dialogue = saved.dialogue; this.choices = saved.choices;
      this.status = saved.status; this.config = saved.config; this.visitId = saved.visitId;
      this.stageState = Object.freeze({ ...saved.stageState, runId: this.runId });
      this.transitions.restoreLighting(checkpoint.lighting);
      this.effects.restore(saved.effects, this.clock.now());
      this.block = this.prepared.blocks.get(this.flowActionIndex) ?? null;
      this.dispatcher = this.createDispatcher(this.flowActionIndex);
      this.navigation = [...saved.navigationHistory]; this.selections = [...saved.choiceHistory];
      // Keep readable history for subsequent checkpoint restores, without
      // redelivering its stage operations or mutation events.
      const history = saved.events.filter(e => e.type === 'dialogue' || e.type === 'choiceSelected' || e.type === 'interactionVoice').map(e => Object.freeze({ ...e, runId: this.runId }));
      this.events = [...history]; this.sequence = history.at(-1)?.sequence ?? 0;
      this.branchResolution = this.isHiddenChoice() ? resolveHiddenBranch(this.choices, this.storyState, this.storySource) : null;
      if (this.node) this.stage.restoreVisit(this.node, this.context(), this.visitId, this.runId);
      this.audioHistory = [...saved.audioHistory ?? []];
      this.emit({ type: 'checkpointRestored', history: Object.freeze(history), audioHistory: Object.freeze([...this.audioHistory]) });
      return true;
    });
  }

  start(): boolean {
    return this.command(() => {
      if (this.status !== 'ready' || !this.prepared) return false;
      this.begin();
      return true;
    });
  }

  advance(expected?: VisitToken): boolean {
    return this.command(() => {
      if (this.status === 'choices' && this.isHiddenChoice() && this.node) {
        this.branchResolution = resolveHiddenBranch(this.choices, this.storyState, this.storySource);
        if (this.branchResolution.optionIndex === null || !this.acceptInput(expected)) return false;
        this.commitOption(this.branchResolution.optionIndex, 'automatic');
        this.pump();
        return true;
      }
      if (this.status !== 'dialogue' || !this.node || !this.acceptInput(expected)) return false;
      this.requestNavigation(this.node.next, 'advance');
      this.pump();
      return true;
    });
  }

  /** Select by displayed option index; optionId is metadata, not a UI index. */
  choose(optionIndex: number, expected?: VisitToken): boolean {
    return this.selectOption(optionIndex, expected, false);
  }

  /** Explicit debug override; recorded independently of automatic eligibility. */
  overrideHiddenChoice(optionIndex: number, expected?: VisitToken): boolean {
    if (!this.isHiddenChoice()) return false;
    return this.selectOption(optionIndex, expected, true);
  }

  /** Developer traversal may cross an unmet prerequisite. Normal Reader
   * choices always use choose(), and every override is recorded explicitly. */
  overrideChoice(optionIndex: number, expected?: VisitToken): boolean {
    return this.selectOption(optionIndex, expected, true);
  }

  /** Exam answers use their stable source IDs, never dialogue option indexes. */
  answerQuiz(answerId: number, expected?: QuizToken): boolean {
    return this.command(() => {
      if (this.status !== 'quiz' || !this.quiz || !this.validInput(expected)) return false;
      const next = reduceQuiz(this.quiz, { type: 'answer', answerId, token: expected ?? this.quiz });
      if (next === this.quiz || !this.acceptInput(expected)) return false;
      this.quiz = next;
      this.emit({ type: 'quizAnswered', quiz: next });
      return true;
    });
  }

  /** Available only after selecting an answer with no explicit correctness. */
  overrideQuizResult(result: QuizResult, expected?: QuizToken): boolean {
    return this.command(() => {
      if (this.status !== 'quiz' || !this.quiz || !this.validInput(expected)) return false;
      const next = reduceQuiz(this.quiz, { type: 'overrideResult', result, token: expected ?? this.quiz });
      if (next === this.quiz || !this.acceptInput(expected)) return false;
      this.quiz = next;
      this.emit({ type: 'quizResultOverridden', quiz: next });
      return true;
    });
  }

  /** Resume the existing visit/departure, with no answer-specific jump guessed. */
  continueQuiz(expected?: QuizToken): boolean {
    return this.command(() => {
      if (this.status !== 'quiz' || !this.quiz || !this.validInput(expected)) return false;
      const next = reduceQuiz(this.quiz, { type: 'continue', token: expected ?? this.quiz });
      if (next === this.quiz || !this.acceptInput(expected)) return false;
      this.emit({ type: 'quizContinued', quiz: next });
      this.quiz = this.quizQueue.shift() ?? null;
      if (this.quiz) this.emit({ type: 'quizOpened', quiz: this.quiz });
      else {
        this.status = this.quizResumeStatus!;
        this.quizResumeStatus = null;
        this.resume();
      }
      return true;
    });
  }

  private isHiddenChoice(): boolean {
    return this.node?.raw?.OptionInteractionType === 'HideAndAutoSelect' && this.choices.length > 0;
  }

  private selectOption(optionIndex: number, expected: VisitToken | undefined, debugOverride: boolean): boolean {
    return this.command(() => {
      if (this.status !== 'choices' || !this.node || !this.validInput(expected)) return false;
      if (this.isHiddenChoice() && !debugOverride) return false;
      const option = this.choices[optionIndex];
      if (!Number.isSafeInteger(optionIndex) || !option) {
        this.report(new EngineError('INVALID_CHOICE', `option index ${optionIndex} is not available`, { ...this.context(), optionIndex, fatal: false }).info);
        return false;
      }
      if (!debugOverride && evaluateCondition(option.preCondition, this.storyState, this.storySource).value !== 'true') {
        this.debug('choice-unavailable', 'The authored choice prerequisite is unmet or unavailable.', { optionIndex, condition: evaluateCondition(option.preCondition, this.storyState, this.storySource) });
        return false;
      }
      this.acceptInput(expected);
      this.commitOption(optionIndex, debugOverride ? 'debug-override' : 'player');
      this.pump();
      return true;
    });
  }

  private commitOption(optionIndex: number, decision: 'player' | 'automatic' | 'debug-override'): void {
      const option = this.choices[optionIndex];
      const entry: ChoiceEntry = Object.freeze({
        ...this.context(), nid: this.node!.nid, optionIndex,
        optionId: option.optionId, textKey: option.textKey,
        next: option.next, actions: option.actions ?? Object.freeze([]),
        preCondition: option.preCondition, typeParams: option.typeParams,
        performances: option.performances, raw: option.raw, debugOverride: decision === 'debug-override', decision,
      });
      this.storyState = recordStoryChoice(this.storyState, this.scriptId!, option.optionId);
      this.selections.push(entry);
      this.emit({ type: 'choiceSelected', entry, visitId: this.visitId });
      this.debug('choice-metadata', 'Selected PlotOptionId recorded in read history; AVG assignments require their authored action.', entry);
      if (decision === 'debug-override') this.debug('choice-override', 'Explicit developer override; eligibility is not claimed.', entry);
      if (decision === 'automatic') this.debug('hidden-branch-automatic', 'First eligible candidate in authored order.', this.branchResolution);
      this.logActions(option.actions, 'option');
      this.requestNavigation(option.next, 'choice', optionIndex, option.performances);
  }

  restart(): boolean {
    return this.command(() => {
      if (!this.prepared) return false;
      this.reset();
      this.storyState = this.storyCheckpoint;
      this.scriptId = this.prepared.script.id;
      this.emitDiagnostics();
      this.begin();
      return true;
    });
  }

  /** Forget all observed story facts, establish a fresh checkpoint and replay. */
  resetStory(): boolean {
    return this.command(() => {
      this.reset();
      this.storyState = initialStoryState();
      this.storyCheckpoint = this.storyState;
      if (this.prepared) {
        this.scriptId = this.prepared.script.id;
        this.emitDiagnostics();
        this.begin();
      }
      return true;
    });
  }

  setInstantTransitions(instant: boolean): boolean {
    return this.command(() => {
      if (instant === this.instantTransitions) return false;
      this.instantTransitions = instant;
      if (instant) { this.transitions.settle(); this.effects.finishBursts(); }
      this.stage.setInstant(instant);
      this.debug('instant-transitions', instant ? 'Pending operations settled in timestamp/source order; visual tracks snapped to persistent state.' : 'Future operations use source timing; applied operations are not replayed.');
      this.resume();
      return true;
    });
  }

  dispose(): void {
    if (this.disposed) return;
    const accepted = this.command(() => {
      this.stage.reset(); this.cancelFrame(); this.transitions.settle();
      this.effects.reset();
      this.clearQuizzes();
      this.pendingNavigation = null; this.status = 'disposed'; this.disposed = true;
      return true;
    });
    if (accepted) { this.listeners.clear(); this.eventListeners.clear(); }
  }

  private validInput(expected?: VisitToken): boolean {
    return this.clock.now() >= this.inputReadyAtMs && (!expected || expected.runId === this.runId && expected.visitId === this.visitId);
  }

  private acceptInput(expected?: VisitToken): boolean {
    if (!this.validInput(expected)) return false;
    this.inputReadyAtMs = this.clock.now() + this.navigationDebounceMs;
    this.automaticSeen.clear(); this.automaticSteps = 0;
    return true;
  }

  private begin(): void {
    this.status = 'running';
    this.movieCues = new Set(this.prepared!.script.flowActions.flatMap(action => action.op === 'movie' ? movieAudioCues(action.raw) : []));
    this.dispatcher = this.createDispatcher();
    this.pump();
  }

  private createDispatcher(afterIndex = -1): FlowDispatcher {
    return new FlowDispatcher(this.prepared!, {
      action: (action, index) => {
        this.flowActionIndex = index;
        this.nid = null;
        this.node = null;
        this.emit({ type: 'flow', action });
      },
      configure: action => {
        this.config = action.config;
        this.emit({ type: 'configure', config: action.config });
        const id = action.config.initialBackground;
        if (id != null) this.emitStage(Object.freeze({ op: 'bg', id, mode: 'Load', t: 0 }), 'start', this.context(), 'configure', null);
        for (const cue of action.config.initialAudio ?? []) {
          if (cue) this.emitStage(Object.freeze({ op: 'audio', cue, t: 0 }), 'start', this.context(), 'configure', null);
        }
      },
      movie: action => {
        const suppressedAudio = movieAudioCues(action.raw);
        this.emit({ type: 'movieSkipped', videoName: action.videoName, suppressedAudio, raw: action.raw });
        this.debug('movie-skipped', `Skipped movie ${action.videoName ?? '(unnamed)'} and its associated audio.`, { videoName: action.videoName, suppressedAudio, raw: action.raw });
      },
      unsupported: action => {
        this.debug('unsupported-flow-action', `Unsupported flow action ${String(action.raw.Name ?? '(unnamed)')} skipped.`, action.raw);
      },
      completed: index => {
        const id = this.scriptId!;
        this.storyState = Object.freeze({ ...this.storyState, flowReads: Object.freeze({ ...this.storyState.flowReads, [id]: (this.storyState.flowReads[id] ?? 0) + 1 }) });
        this.flowActionIndex = index;
        this.nid = null;
        this.node = null;
        this.block = null;
        this.status = 'completed';
        this.emit({ type: 'completed' });
      },
    }, afterIndex);
  }

  /** Iterate silent nodes until input, completion, or a contextual loop error. */
  private pump(): void {
    while (this.status === 'running') {
      // A silent node can wait on its start queue across clock callbacks.
      if (this.node) {
        if (this.stage.pending.length) return;
        this.requestNavigation(this.node.next, 'advance');
        continue;
      }
      if (!this.block) {
        this.block = this.dispatcher!.nextBlock();
        if (!this.block) return;
        this.nid = this.block.firstNid;
        if (this.nid === null) {
          this.finishTalk('exhausted');
          continue;
        }
        this.recordNavigation(null, this.nid, 'start');
      }
      const key = `${this.flowActionIndex}:${this.nid}`;
      if (++this.automaticSteps > this.maxAutomaticSteps) throw new EngineError('AUTOMATIC_LOOP', `automatic execution exceeded ${this.maxAutomaticSteps} steps without user input`, this.context());
      if (this.automaticSeen.has(key)) throw new EngineError('AUTOMATIC_LOOP', 'automatic navigation revisited this node without user input', this.context());
      this.automaticSeen.add(key);
      this.node = this.block.nodes.get(this.nid!)!;
      this.storyState = recordPlotKey(this.storyState, this.scriptId!, this.node.raw?.PlotKeyId);
      ++this.visitId;
      if (['line', 'narration', 'centerText'].includes(this.node.kind)) this.transitions.beginVisit(this.stageState, this.node, this.visitId, this.clock.now(), this.instantTransitions);
      this.stage.enter(this.node, this.context(), this.visitId, this.runId);
      if (this.node.raw) this.debug('node-metadata', 'Original node metadata and PlotKeyId read record retained.', this.node.raw);
      this.logActions(this.node.actions, 'node');
      this.dialogue = this.node.kind !== 'silent' && this.node.textKey ? this.node : null;
      this.choices = this.node.options ?? Object.freeze([]);
      if (this.dialogue) {
        this.audioHistory.push(...(typeof this.dialogue.voice === 'string' ? [this.dialogue.voice] : this.dialogue.voice ?? []));
        this.emit({ type: 'dialogue', node: this.dialogue, visitId: this.visitId });
      }
      if (this.choices.length) {
        this.setReadingStatus('choices');
        this.emit({ type: 'choices', options: this.choices });
        if (this.isHiddenChoice()) {
          this.branchResolution = resolveHiddenBranch(this.choices, this.storyState, this.storySource);
          // Keep spoken text available until explicit Advance. Text completion
          // never commits a branch. Silent determined nodes can proceed now.
          if (this.branchResolution.optionIndex !== null && !this.dialogue && !this.quiz) {
            this.commitOption(this.branchResolution.optionIndex, 'automatic');
            continue;
          }
          if (this.branchResolution.optionIndex === null) this.debug('hidden-auto-selection-unresolved', 'Hidden branch is unresolved because an earlier prerequisite cannot be established.', this.branchResolution);
        }
        this.automaticSeen.clear(); this.automaticSteps = 0;
        return;
      }
      if (this.dialogue) {
        this.setReadingStatus('dialogue');
        this.automaticSeen.clear(); this.automaticSteps = 0;
        return;
      }
      if (this.quiz) { this.quizResumeStatus = 'running'; return; }
      if (this.stage.pending.length) return;
      this.requestNavigation(this.node.next, 'advance');
    }
  }

  private requestNavigation(next: Navigation, delivery: 'advance' | 'choice', optionIndex?: number, performances?: readonly StageOp[]): void {
    this.pendingNavigation = { next, optionIndex };
    this.status = 'ending';
    // Snap only visual tracks. Already-applied stage state is untouched.
    this.transitions.settle();
    // Silent authored cues traverse automatically. They must retain their
    // finite playback range into the next readable line (e.g. 1015/40 Black).
    // Explicit reading input still consumes the departing line's bursts.
    if (this.node?.kind !== 'silent') this.effects.finishBursts();
    const pending = this.stage.pending.length;
    if (delivery === 'choice' && performances?.length) this.stage.select(performances, optionIndex!);
    else this.stage.leave(delivery);
    if (pending) this.debug('start-operations-settled', `Settled ${pending} pending start operation(s) before scheduling the ${this.stage.phase ?? 'end'} phase.`, { delivery, visitId: this.visitId });
    this.completeNavigationIfReady();
  }

  private resume(): void {
    this.completeNavigationIfReady();
    if (this.status === 'choices' && this.isHiddenChoice()) this.branchResolution = resolveHiddenBranch(this.choices, this.storyState, this.storySource);
    this.pump();
  }

  private completeNavigationIfReady(): void {
    if (this.quiz || !this.pendingNavigation || this.stage.pending.length) return;
    if (this.stage.phase === 'option') {
      this.stage.leave('choice');
      if (this.quiz || this.stage.pending.length) return;
    }
    const { next, optionIndex } = this.pendingNavigation;
    this.pendingNavigation = null;
    this.stage.finishVisit();
    if (this.node?.kind !== 'silent') this.effects.finishVisit(this.visitId);
    const from = this.nid!;
    const block = this.block!;
    let to: number | null;
    let reason: NavigationEntry['reason'] = next.type;
    if (next.type === 'end') to = null;
    else if (next.type === 'seq') to = block.successors.get(from) ?? null;
    else if (block.nodes.has(next.to)) to = next.to;
    else {
      // Preflight already emitted the contextual error. SPEC 5.1 falls back
      // sequentially for absent targets, never to another ShowTalk block.
      to = block.successors.get(from) ?? null;
      reason = 'invalid-target';
      this.debug('invalid-target-fallback', `Missing target ${next.to}; continuing sequentially inside the current talk block.`, { requestedNext: next, to });
    }
    this.recordNavigation(from, to, reason, next, optionIndex);
    this.dialogue = null;
    this.choices = Object.freeze([]);
    this.branchResolution = null;
    this.node = null;
    this.status = 'running';
    if (to === null) this.finishTalk(next.type === 'end' ? 'end' : 'exhausted');
    else this.nid = to;
  }

  private finishTalk(reason: 'end' | 'exhausted'): void {
    this.emit({ type: 'talkComplete', reason });
    this.block = null;
    this.nid = null;
    this.node = null;
  }

  private recordNavigation(from: number | null, to: number | null, reason: NavigationEntry['reason'], requestedNext?: Navigation, optionIndex?: number): void {
    const entry: NavigationEntry = Object.freeze({ ...this.context(), from, to, reason, requestedNext, optionIndex });
    this.navigation.push(entry);
    this.emit({ type: 'navigation', entry });
  }

  private emitStage(operation: StageOp, phase: StagePhase, context: EventContext, source: 'configure' | 'node' | 'option', visitId: number | null, timing?: StageTiming, optionIndex?: number): void {
    if (operation.op === 'audio' && typeof operation.cue === 'string' && this.movieCues.has(operation.cue)) {
      this.debug('movie-audio-suppressed', `Suppressed movie audio ${operation.cue}.`, operation, context);
      return;
    }
    const disposition = operation.op === 'activityAction' ? 'metadata' : operation.op === 'audio' ? 'metadata' : staticOps.has(operation.op) ? 'state' : knownStageOps.has(operation.op) ? 'metadata' : 'unsupported';
    if (operation.op === 'audio' && typeof operation.cue === 'string' && !skipAudioDelivery(operation, timing)) this.audioHistory.push(operation.cue);
    const event = this.emit({ type: 'stage', source, visitId, phase, optionIndex, operation, disposition, timing }, context);
    if (operation.op === 'activityAction' && operation.kind === 'SolarSchool' && typeof operation.actionId === 'number') {
      const effect = applyActivityAction(this.storyState, operation.actionId, this.storySource, `stage:${this.runId}:${event.sequence}`);
      this.deliverStoryEffect(effect, operation.actionId, visitId, event.sequence, context);
    }
    if (operation.quiz && visitId !== null && this.node) {
      const quiz = initialQuizState(operation.quiz, { runId: this.runId, visitId, instanceId: event.sequence }, {
        phase, next: this.pendingNavigation?.next ?? this.node.next,
      });
      if (this.quiz) this.quizQueue.push(quiz);
      else {
        this.quizResumeStatus = this.status;
        this.quiz = quiz;
        this.status = 'quiz';
        this.emit({ type: 'quizOpened', quiz }, context);
      }
    }
    if (operation.op === 'move' && operation.ease) this.debug('unsupported-move-easing', 'Source EaseCurve is retained; the placeholder uses a linear preview between verified endpoints. Numeric presets are not interpreted.', operation.ease, context);
    if (operation.op === 'activityAction') this.debug('activity-action-metadata', operation.quiz ? 'Verified exam interaction opened; source score/result metadata retained.' : 'Verified inventory/AVG effects use story state; other effects remain metadata.', operation, context);
  }

  private deliverStoryEffect(effect: StoryEffect, actionId: number, visitId: number | null, stageSequence: number, context = this.context()): void {
    const previousLocation = this.storyState.locationId;
    this.storyState = effect.state;
    if (previousLocation !== this.storyState.locationId) {
      const location = this.storySource.locations?.[String(this.storyState.locationId)];
      const cue = typeof location?.Abient === 'string' && location.Abient ? location.Abient : '__ambience_silence__';
      this.emitStage(Object.freeze({ op: 'audio', cue, t: 0 }), 'start', context, 'configure', null);
    }
    if (effect.changes.length) this.emit({ type: 'storyMutation', actionId, changes: effect.changes, visitId, stageSequence }, context);
    for (const command of effect.commands ?? []) this.emit({ type: 'storyCommand', actionId, command }, context);
    if (effect.unresolved.length) this.debug('story-action-unresolved', 'Unverified effects or unavailable prerequisites.', { actionId, reasons: effect.unresolved }, context);
    if (effect.blocked?.length) this.debug('story-action-blocked', 'Authored reward preflight rejected this grant.', { actionId, reasons: effect.blocked }, context);
  }

  private setReadingStatus(status: 'dialogue' | 'choices'): void {
    if (this.quiz) this.quizResumeStatus = status;
    else this.status = status;
  }

  private clearQuizzes(): void {
    this.quiz = null; this.quizQueue = []; this.quizResumeStatus = null;
  }

  private logActions(actions: readonly Metadata[] | undefined, source: 'node' | 'option'): void {
    for (const action of actions ?? []) this.debug(`unsupported-${source}-action`, `Unsupported ${source} action ${String(action.Name ?? '(unnamed)')} preserved without execution.`, action);
  }

  private emitDiagnostics(): void {
    for (const diagnostic of this.prepared!.diagnostics) this.report(diagnostic);
  }

  private report(info: ErrorInfo): void {
    this.diagnostics.push(info);
    if (info.fatal) {
      this.status = 'error';
      this.error = info;
      this.stage.reset();
      this.cancelFrame(); this.transitions.settle(); this.pendingNavigation = null;
      this.effects.reset();
      this.clearQuizzes();
    }
    this.emit({ type: 'error', error: info }, {
      scriptId: info.scriptId ?? this.scriptId ?? '(unknown)',
      flowActionIndex: info.flowActionIndex ?? this.flowActionIndex,
      nid: info.nid ?? this.nid,
    });
  }

  private debug(code: string, message: string, data?: unknown, context = this.context()): void {
    this.emit({ type: 'debug', code, message, data }, context);
  }

  private context(): EventContext {
    return { scriptId: this.scriptId ?? '(unknown)', flowActionIndex: this.flowActionIndex, nid: this.nid };
  }

  private emit(payload: EventPayload, context = this.context()): RunnerEvent {
    const event = Object.freeze({ ...context, runId: this.runId, sequence: ++this.sequence, ...payload }) as RunnerEvent;
    this.events.push(event);
    if (event.type === 'stage') {
      this.stages.push(event);
      const issueCount = this.stageState.issues.length;
      const previous = this.stageState;
      this.stageState = reduceStageEvent(this.stageState, event);
      this.transitions.apply(previous, this.stageState, event, this.instantTransitions, this.clock.now());
      for (const issue of this.effects.apply(event, this.stageState, this.clock.now())) this.debug(issue.code, issue.message, issue.event.operation, context);
      for (const issue of this.stageState.issues.slice(issueCount)) this.debug(issue.code, issue.message, issue.event.operation, context);
    }
    return event;
  }

  private audioHistory: string[] = [];

  private reset(continuation = false): void {
    this.sceneId++;
    this.stage.reset();
    this.cancelFrame(); this.transitions.reset();
    this.effects.reset();
    this.pendingNavigation = null;
    this.clearQuizzes();
    this.automaticSeen.clear(); this.automaticSteps = 0;
    this.inputReadyAtMs = 0;
    this.dispatcher = null;
    this.block = null;
    this.status = 'idle';
    this.scriptId = null;
    this.flowActionIndex = -1;
    this.nid = null;
    this.node = null;
    this.dialogue = null;
    this.choices = Object.freeze([]);
    this.branchResolution = null;
    this.config = emptyConfig;
    if (!continuation) {
      this.runId++;
      this.audioHistory = [];
      this.stageState = initialStageState(this.runId);
      this.visitId = 0;
      this.sequence = 0;
      this.events = [];
      this.stages = [];
      this.navigation = [];
      this.selections = [];
      this.diagnostics = [];
    } else {
      this.audioHistory.push('__scene__');
      // A new scene preserves accumulated playthrough state and the event
      // timeline, but cannot inherit the previous scene's actor membership.
      this.stageState = Object.freeze({ ...this.stageState, characters: Object.freeze({}) });
    }
    this.error = null;
    this.movieCues = new Set();
  }

  private command(action: () => boolean): boolean {
    // Observers can subscribe repeatedly (including StrictMode) but cannot
    // recursively drive automatic execution from inside event delivery.
    if (this.busy || this.disposed) return false;
    this.busy = true;
    const previousEvents = this.events;
    const previousLength = this.events.length;
    let result = false;
    try {
      result = action();
    } catch (error) {
      this.report(errorInfo(error, this.context()));
    } finally {
      this.snapshot = this.makeSnapshot();
      this.scheduleFrame();
      const added = this.events.slice(previousEvents === this.events ? previousLength : 0);
      const restoredAt = added.findIndex(event => event.type === 'checkpointRestored');
      const fresh = restoredAt < 0 ? added : added.slice(restoredAt);
      try {
        for (const event of fresh) for (const listener of this.eventListeners) listener(event);
      } finally {
        this.busy = false;
        for (const listener of this.listeners) listener();
      }
    }
    return result;
  }

  private makeSnapshot(): RunnerSnapshot {
    const clockMs = this.clock.now();
    const effects = this.effects.snapshot(clockMs);
    return Object.freeze({
      status: this.status, runId: this.runId, sceneId: this.sceneId, scriptId: this.scriptId,
      visitId: this.visitId, clockMs, inputReady: clockMs >= this.inputReadyAtMs,
      instantTransitions: this.instantTransitions, stagePhase: this.stage.phase,
      hiddenChoice: this.isHiddenChoice(),
      branchResolution: this.isHiddenChoice() ? resolveHiddenBranch(this.choices, this.storyState, this.storySource) : this.branchResolution, storyState: this.storyState,
      pendingStage: this.stage.pending, presentation: presentStageEffects(this.transitions.project(this.stageState, clockMs), effects), effects,
      flowActionIndex: this.flowActionIndex, nid: this.nid,
      node: this.node, dialogue: this.dialogue, choices: this.choices, quiz: this.quiz,
      choiceConditions: Object.freeze(this.choices.map(option => evaluateCondition(option.preCondition, this.storyState, this.storySource))),
      config: this.config,
      navigationHistory: Object.freeze([...this.navigation]),
      choiceHistory: Object.freeze([...this.selections]),
      stageEvents: Object.freeze([...this.stages]),
      audioHistory: Object.freeze([...this.audioHistory]),
      stageState: this.stageState,
      events: Object.freeze([...this.events]),
      diagnostics: Object.freeze([...this.diagnostics]), error: this.error,
    });
  }

  private cancelFrame(): void {
    this.frameEpoch++;
    if (this.frameTimer !== null) this.clock.clearTimeout(this.frameTimer);
    this.frameTimer = null;
  }

  private scheduleFrame(): void {
    this.cancelFrame();
    if (this.disposed || this.status === 'error') return;
    // Schedule from the same sample as published readiness/presentation. A
    // second sample can cross the deadline and discard the only release wake.
    const now = this.snapshot.clockMs;
    const animating = this.transitions.project(this.stageState, now).transitions.length > 0 || this.effects.animating(now);
    const inputDelay = this.inputReadyAtMs - now;
    if (!animating && inputDelay <= 0) return;
    const epoch = this.frameEpoch;
    this.frameTimer = this.clock.setTimeout(() => {
      if (epoch !== this.frameEpoch || this.disposed) return;
      this.frameTimer = null;
      this.command(() => true); // Publish a clock sample; emit no stage events.
    }, animating ? Math.min(16, inputDelay > 0 ? inputDelay : 16) : inputDelay);
  }
}
