import { greetingRows, priorityTalkBehavior } from './RoleGreetings.ts';
import type { EnglishCatalog } from '../data/EnglishScriptRepository.ts';
import { ScriptRunner } from './ScriptRunner.ts';
import type { RunnerCheckpoint } from './ScriptRunner.ts';
import type { ConditionResult, StoryCommand, StorySource, StoryState } from './StoryState.ts';
import { conditionResult, evaluateConditionGroup, evaluateLocationUnlock, inheritSpecialItems, sourceList, storyDate, storyEffect } from './StoryState.ts';
import { acceptSpecialRequest, availableEndings, claimJourneyReward, completeQuestNode, defaultScheduledBehavior, eligibleQuestNodes, freezeEndingState, nextEndingAction, refreshStoryProgress, requestAcceptance, selectCalendar, settleWeeklyRewards } from './StoryProgress.ts';
import { addExamScore, applyMechanicReward, behaviorFatigueAvailability, behaviorPreActions, behaviorSuccessRate, currentBehaviorRow, eventCheckSuccessRate, settleBehavior, settleEventCheck, settleExam, startExam } from './StoryMechanics.ts';
import { effectiveAttributes } from './StoryAttributes.ts';
import { buyStoryGoods, ensureShopStock, giftChoices, giveStoryGift, itemChoices, shopChoices, useStoryItem } from './StoryItems.ts';
import { beginScratchReveal, drawRaffle, ensureScratchBoard, raffleCostChoice, raffleEligibility, raffleProgress, scratchCellChoices, scratchCostChoice, settleScratchReveal } from './StoryGames.ts';
import type { Metadata, RunnerEvent } from './types.ts';

export interface JourneyOption { readonly id: string; readonly kind: 'behavior' | 'location' | 'explore' | 'locationOption' | 'request' | 'reward' | 'ending' | 'event' | 'affairs' | 'item' | 'gift' | 'shopItem' | 'scratchReveal' | 'scratchSettle' | 'raffle' | 'roleTalk'; readonly sourceId: number; readonly contextId?: number; readonly labelKey: string; readonly fallbackLabel?: string; readonly ownerLabelKey?: string; readonly descriptionKey?: string; readonly condition: ConditionResult; readonly progress?: number; readonly target?: number; readonly probability?: number | null; readonly price?: number | null; readonly costKey?: string; }
export interface JourneyDiagnostic { readonly code: string; readonly message: string; readonly dayIndex: number | null; readonly data?: unknown; }
/** Optional presentation barrier; it never changes the accumulated game state. */
export interface SceneContinuationGate {
  isBlocked(): boolean;
  subscribe(listener: () => void): () => void;
}
export type JourneyPhase = 'idle' | 'reading' | 'planning' | 'interaction' | 'complete' | 'blocked';
export interface JourneySnapshot {
  readonly active: boolean; readonly busy: boolean; readonly phase: JourneyPhase;
  readonly dayIndex: number | null; readonly timeSlot: number | null; readonly instanceId: number | null;
  readonly options: readonly JourneyOption[];
  readonly interaction: { readonly kind: 'ending' | 'event' | 'affairs' | 'scratch' | 'raffle' | 'request' | 'requestDone' | 'requestFailed' | 'gift' | 'shop' | 'roleTalk'; readonly sourceId: number; readonly labelKey?: string; readonly key?: string; readonly requiresChoice?: boolean } | null;
  readonly diagnostics: readonly JourneyDiagnostic[];
  readonly endingPath: readonly number[]; readonly nextCycle: boolean;
  readonly sceneCount: number; readonly canCheckpoint: boolean; readonly canContinue: boolean; readonly continueLabelKey?: string;
  readonly selectingLocation: boolean;
}
export const emptyJourneySnapshot: JourneySnapshot = Object.freeze({ active: false, busy: false, phase: 'idle', dayIndex: null, timeSlot: null, instanceId: null, options: Object.freeze([]), interaction: null, diagnostics: Object.freeze([]), endingPath: Object.freeze([]), nextCycle: false, sceneCount: 0, canCheckpoint: false, canContinue: false, selectingLocation: false });
export const noJourneySubscription = () => () => {};
export const getEmptyJourneySnapshot = () => emptyJourneySnapshot;
type Task = { readonly kind: 'command'; readonly command: StoryCommand } | { readonly kind: 'action'; readonly id: number; readonly key: string } | { readonly kind: 'flow'; readonly id: number } | { readonly kind: 'node'; readonly id: number; readonly timing: number; readonly param: number } | { readonly kind: 'quest'; readonly timing: number; readonly param: number } | { readonly kind: 'settle'; readonly id: number; readonly rowId: number; readonly key: string } | { readonly kind: 'reward'; readonly id: number; readonly key: string } | { readonly kind: 'requestDone' | 'requestFailed'; readonly id: number } | { readonly kind: 'advanceDay'; readonly dayIndex: number } | { readonly kind: 'skipDay'; readonly dayIndex: number; readonly target: number } | { readonly kind: 'slot' | 'finishSlot' | 'plan' | 'day' | 'instanceReady' | 'instanceProgress' | 'ending' } | { readonly kind: 'reachEnding'; readonly id: number };
interface SavedJourney { readonly phase: JourneyPhase; readonly queue: readonly Task[]; readonly calendarId: number | null; readonly slotIndex: number; readonly activeFlow: number | null; readonly sceneCount: number; readonly endingNode: number | null; readonly endingPath: readonly number[]; readonly nextCycle: boolean; readonly triggerKeys: readonly string[]; readonly actionCounter: number; readonly seed: number; readonly targetDay: number | null; readonly instanceExploration: boolean; readonly instanceMapStarted: boolean; readonly instanceEnding: boolean; readonly locationProgress: Readonly<Record<string, number>>; readonly skippingDays: boolean; readonly cycle: number; readonly gallery: Readonly<Record<string, boolean>>; readonly diagnostics: readonly JourneyDiagnostic[]; }
export interface PlaythroughCheckpoint { readonly runner: RunnerCheckpoint; readonly journey: SavedJourney; }
type ScriptLoader = (id: string) => Promise<unknown>;
const tableRows = (table?: Readonly<Record<string, Metadata>>): Metadata[] => Object.values(table ?? {});
const field = (row: Metadata, name: string): string => typeof row[name] === 'string' ? row[name] as string : '';

/** Owns authored activity transitions. Loading a scene is an awaited command,
 * never a React effect; source triggers are queued across script completion. */
export class StoryPlaythrough {
  private readonly runner: ScriptRunner;
  private readonly loadScript: ScriptLoader;
  private catalog: EnglishCatalog | null = null;
  private source: StorySource | null = null;
  private active = false;
  private busy = false;
  private phase: JourneyPhase = 'idle';
  private queue: Task[] = [];
  private commands: StoryCommand[] = [];
  private calendarId: number | null = null;
  private slotIndex = 0;
  private activeFlow: number | null = null;
  private sceneCount = 0;
  private endingNode: number | null = null;
  private endingPath: number[] = [];
  private nextCycle = false;
  private interaction: JourneySnapshot['interaction'] = null;
  private diagnostics: JourneyDiagnostic[] = [];
  private triggerKeys = new Set<string>();
  private actionCounter = 0;
  private seed = 1;
  private epoch = 0;
  private pending: Promise<void> | null = null;
  private scheduled = false;
  private disposed = false;
  private cycle = 0;
  private gallery: Record<string, boolean> = {};
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeEvents: () => void;
  private readonly unsubscribeRunner: () => void;
  private snapshot: JourneySnapshot;
  private refreshedState: StoryState | null = null;
  private optionsCache: { state: StoryState; source: StorySource; phase: JourneyPhase; interaction: JourneySnapshot['interaction']; exploring: boolean; mapStarted: boolean; locations: Record<string, number>; options: readonly JourneyOption[] } | null = null;
  private continuationGate: SceneContinuationGate | null = null;
  private unsubscribeContinuation: (() => void) | null = null;

  constructor(runner: ScriptRunner, loadScript: ScriptLoader) {
    this.runner = runner; this.loadScript = loadScript;
    this.snapshot = this.makeSnapshot();
    this.unsubscribeEvents = runner.onEvent(event => this.observe(event));
    this.unsubscribeRunner = runner.subscribe(() => { if (!this.active) return; this.publish(); this.schedule(); });
  }
  getSnapshot = (): JourneySnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  setContinuationGate(gate: SceneContinuationGate | null): void {
    if (this.disposed || this.continuationGate === gate) return;
    this.unsubscribeContinuation?.();
    this.continuationGate = gate;
    this.unsubscribeContinuation = gate?.subscribe(() => this.schedule()) ?? null;
    this.schedule();
  }
  async start(catalog: EnglishCatalog, seed = 1): Promise<boolean> {
    return this.startCycle(catalog, seed, 1);
  }
  async startNextCycle(): Promise<boolean> {
    if (!this.catalog || !this.active || this.busy || this.phase !== 'complete' || !this.nextCycle) return false;
    return this.startCycle(this.catalog, this.seed, Math.min(2147483647, this.cycle + 1), this.state);
  }
  private async startCycle(catalog: EnglishCatalog, seed: number, cycle: number, inherited?: StoryState): Promise<boolean> {
    if (this.disposed || !catalog.storySource || !catalog.storySource.activity) return false;
    this.stop(); this.catalog = catalog; this.source = catalog.storySource;
    this.runner.setStageSpeakers(catalog.speakers);
    this.seed = seed >>> 0; this.cycle = cycle;
    if (!this.runner.beginPlaythrough(this.source)) return false;
    if (inherited) {
      const effect = inheritSpecialItems(this.state, inherited, this.source);
      if (effect.unresolved.length) { this.unresolved(effect.unresolved, 'Cycle inheritance'); return false; }
      this.runner.applyStoryEffect(effect);
    }
    this.runner.applyStoryEffect(storyEffect(Object.freeze({ ...this.state, endings: Object.freeze({ ...this.state.endings, ...this.gallery }), playthroughCount: this.cycle })));
    this.active = true; this.phase = 'reading'; this.queue = [{ kind: 'day' }];
    this.publish(); await this.flush(); return this.getSnapshot().phase !== 'blocked';
  }
  stop(): void {
    this.epoch++; this.active = false; this.busy = false; this.phase = 'idle'; this.queue = []; this.commands = [];
    this.calendarId = null; this.slotIndex = 0; this.activeFlow = null; this.sceneCount = 0; this.endingNode = null;
    this.endingPath = []; this.nextCycle = false; this.interaction = null; this.diagnostics = []; this.triggerKeys.clear(); this.actionCounter = 0;
    this.targetDay = null; this.instanceExploration = false; this.deferredScores = []; this.pending = null;
    this.instanceMapStarted = false; this.instanceEnding = false; this.locationProgress = {}; this.skippingDays = false;
    this.refreshedState = null; this.optionsCache = null;
    this.publish();
  }
  dispose(): void { if (this.disposed) return; this.stop(); this.disposed = true; this.unsubscribeContinuation?.(); this.unsubscribeEvents(); this.unsubscribeRunner(); this.listeners.clear(); }
  /** Deterministic draws are a Reader policy, keyed by the saved source trigger.
   * Replaying the same checkpoint therefore reproduces the same random roll. */
  private draw(key: string): number {
    let hash = this.seed ^ 2166136261;
    for (const c of key) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
    hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d); hash ^= hash >>> 15;
    return (hash >>> 0) / 4294967296;
  }
  private get state(): StoryState { return this.runner.getSnapshot().storyState; }
  private key(label: string): string { return `journey:${this.state.playthroughCount}:${++this.actionCounter}:${label}`; }
  private action(id: number, label: string): Task { return { kind: 'action', id, key: this.key(label) }; }
  private observe(event: RunnerEvent): void {
    if (!this.active || this.disposed) return;
    if (event.type === 'storyCommand') this.commands.push(event.command);
    if (event.type === 'completed' && this.activeFlow !== null && event.scriptId === String(this.activeFlow)) this.activeFlow = null;
    if (event.type === 'quizContinued' && event.quiz.result === 'correct') {
      const exam = tableRows(this.source?.exams).find(r => r.InstanceId === this.state.instanceId);
      const score = Number(event.quiz.definition.addScore);
      if (exam && Number.isSafeInteger(score)) {
        // The runner is still delivering this command. Apply its score at the
        // next command boundary, preserving the question's original identity.
        this.deferredScores.push({ examId: Number(exam.Id), score, key: `quiz:${event.runId}:${event.quiz.instanceId}` });
      }
    }
    this.schedule();
  }
  private deferredScores: { examId: number; score: number; key: string }[] = [];
  private schedule(): void {
    if (this.scheduled || this.disposed || !this.active) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; void this.flush(); });
  }
  async flush(): Promise<void> {
    if (this.disposed || !this.active) return;
    if (this.pending) { await this.pending; return; }
    const promise = this.pump(); this.pending = promise;
    try { await promise; } finally { if (this.pending === promise) this.pending = null; }
  }
  private publish(): void { this.snapshot = this.makeSnapshot(); for (const listener of this.listeners) listener(); }
  private diagnose(code: string, message: string, data?: unknown): void {
    const identity = JSON.stringify([code, message, this.state.dayIndex, data]);
    if (this.diagnostics.some(d => JSON.stringify([d.code, d.message, d.dayIndex, d.data]) === identity)) return;
    this.diagnostics.push(Object.freeze({ code, message, dayIndex: this.state.dayIndex, data }));
  }
  private unresolved(reasons: readonly string[], label: string): void { for (const reason of reasons) this.diagnose('unavailable-state', `${label}: ${reason}`); }
  private refresh(): void {
    if (this.state === this.refreshedState) return;
    const effect = refreshStoryProgress(this.state, this.source!);
    if (effect.state !== this.state) this.runner.applyStoryEffect(effect);
    this.refreshedState = this.state;
    this.unresolved(effect.unresolved, 'Journey');
  }
  private takeQuest(timing = 0, param = 0): Task[] {
    const key = `location-affinity:${this.state.dayIndex}:${param}`;
    if (timing === 1 && this.triggerKeys.has(key)) return [];
    const eligible = eligibleQuestNodes(this.state, this.source!, timing, param);
    this.unresolved(eligible.unresolved, 'Quest trigger');
    const node = eligible.nodes.find(n => !this.queue.some(t => t.kind === 'node' && t.id === Number(n.Id)));
    if (!node) return [];
    const ties = eligible.nodes.filter(n => n.Priority === node.Priority);
    if (ties.length > 1) this.diagnose('quest-priority-tie', 'Equal source priorities retain table enumeration; the original comparator defines no further priority.', ties.map(n => n.Id));
    return [this.action(Number(node.ActionId), `quest:${node.Id}`), { kind: 'node', id: Number(node.Id), timing, param }];
  }
  private async pump(): Promise<void> {
    const epoch = this.epoch;
    this.busy = true; this.publish();
    try {
      for (let steps = 0; steps < 5000 && this.active && epoch === this.epoch; steps++) {
        // Earned tier confirmations become ready only after the runner's
        // completed event. Keep the next authored task queued until Confirm.
        if (this.continuationGate?.isBlocked()) { this.phase = 'reading'; break; }
        for (const bonus of this.deferredScores.splice(0)) this.runner.applyStoryEffect(addExamScore(this.state, bonus.examId, bonus.score, this.source!, bonus.key));
        if (this.commands.length) {
          this.queue.unshift(...this.commands.splice(0).map(command => ({ kind: 'command' as const, command })));
        }
        if (this.interaction || this.phase === 'complete' || this.phase === 'blocked') break;
        if (this.activeFlow !== null && this.runner.getSnapshot().status !== 'completed') { this.phase = 'reading'; break; }
        if (this.runner.getSnapshot().status === 'error') { this.phase = 'blocked'; break; }
        if (!this.skippingDays) this.refresh();
        const immediate = this.skippingDays || this.queue.some(t => t.kind === 'node') ? [] : this.takeQuest();
        if (immediate.length) this.queue.unshift(...immediate);
        const task = this.queue.shift();
        if (!task) { if (this.phase !== 'planning') this.phase = 'complete'; break; }
        if (task.kind === 'command') { this.handleCommand(task.command); continue; }
        if (task.kind === 'action') {
          this.runner.dispatchActivityAction(task.id, task.key);
          continue;
        }
        if (task.kind === 'flow') {
          if (!this.source?.flows?.[String(task.id)] || !this.catalog) { this.diagnose('missing-flow', `Flow ${task.id} has no authored registry entry.`); this.phase = 'blocked'; break; }
          this.activeFlow = task.id; this.phase = 'reading'; this.sceneCount++; this.publish();
          const script = await this.loadScript(String(task.id));
          if (epoch !== this.epoch || !this.active) break;
          if (!this.runner.load(script, this.catalog.manifest, { preserveStoryState: true, continuation: true, storySource: this.source }) || !this.runner.start()) { this.phase = 'blocked'; break; }
          if (this.runner.getSnapshot().status !== 'completed') break;
          this.activeFlow = null; continue;
        }
        if (task.kind === 'node') {
          this.runner.applyStoryEffect(completeQuestNode(this.state, task.id));
          if (task.timing === 1) this.triggerKeys.add(`location-affinity:${this.state.dayIndex}:${task.param}`);
          continue;
        }
        if (task.kind === 'quest') { const actions = this.takeQuest(task.timing, task.param); if (actions.length) this.queue.unshift(...actions, task); continue; }
        if (task.kind === 'settle') {
          const row = this.source!.behaviors![String(task.rowId)];
          const rate = behaviorSuccessRate(this.state, row, this.source!);
          if (rate.value === null) { this.unresolved(rate.unresolved, 'Behavior'); this.phase = 'blocked'; break; }
          const success = this.draw(task.key) < rate.value;
          const effect = settleBehavior(this.state, row, success, this.source!, task.key);
          this.unresolved(effect.unresolved, 'Behavior settlement');
          this.runner.applyStoryEffect({ ...effect, commands: [] });
          this.queue.unshift(...effect.completionSteps.map((step): Task => step.kind === 'activityAction' ? this.action(step.actionId, `request-finish:${task.id}`) : step.kind === 'requestDone' ? { kind: 'requestDone', id: step.behaviorId } : { kind: 'reward', id: step.rewardGroupId, key: this.key(`request-reward:${task.id}`) }));
          continue;
        }
        if (task.kind === 'reward') {
          const effect = applyMechanicReward(this.state, task.id, this.source!, 0, task.key);
          this.unresolved(effect.unresolved, 'Completion reward'); this.runner.applyStoryEffect(effect); continue;
        }
        if (task.kind === 'requestDone' || task.kind === 'requestFailed') {
          const row = tableRows(this.source!.behaviors).find(r => r.BehaviorId === task.id);
          this.interaction = { kind: task.kind, sourceId: task.id, labelKey: field(row ?? {}, 'Name') }; this.phase = 'interaction'; break;
        }
        if (task.kind === 'advanceDay') { this.skippingDays = false; this.runner.applyStoryEffect(storyEffect(Object.freeze({ ...this.state, dayIndex: task.dayIndex, timeSlot: 1, locationId: 0 }))); this.queue.unshift({ kind: 'day' }); continue; }
        if (task.kind === 'skipDay') { this.settleSkippedDay(task.dayIndex, task.target); continue; }
        if (task.kind === 'day') { this.beginDay(); continue; }
        if (task.kind === 'instanceReady') { if (!tableRows(this.source!.locations).some(r => r.InstanceId === this.state.instanceId)) { this.beginInstanceEnd(); continue; } this.phase = 'planning'; break; }
        if (task.kind === 'instanceProgress') { if (this.allRequiredLocationsComplete() && !this.endLocation()) this.beginInstanceEnd(); else { this.phase = 'planning'; break; } continue; }
        if (task.kind === 'slot') { this.beginSlot(); continue; }
        if (task.kind === 'finishSlot') { this.finishSlot(); continue; }
        if (task.kind === 'plan') { this.phase = 'planning'; break; }
        if (task.kind === 'ending') { this.advanceEnding(); continue; }
        if (task.kind === 'reachEnding') {
          this.gallery[String(task.id)] = true;
          this.runner.applyStoryEffect(storyEffect(Object.freeze({ ...this.state, endings: Object.freeze({ ...this.state.endings, [String(task.id)]: true }) }), [Object.freeze({ kind: 'endingReached', endingId: task.id })]));
          continue;
        }
      }
      if (this.active && !this.activeFlow && !this.interaction && !this.continuationGate?.isBlocked() && this.phase === 'reading' && this.queue.length > 0) {
        this.diagnose('task-limit', 'The authored transition limit was reached before an input boundary.'); this.phase = 'blocked';
      }
    } catch (error) { this.diagnose('journey-error', error instanceof Error ? error.message : String(error)); this.phase = 'blocked'; }
    finally { if (epoch === this.epoch) this.busy = false; this.publish(); }
  }
  private handleCommand(command: StoryCommand): void {
    if (command.kind === 'flow') this.queue.unshift({ kind: 'flow', id: command.flowId });
    else if (command.kind === 'activityAction') this.queue.unshift(this.action(command.actionId, `injected:${command.actionId}`));
    else if (command.kind === 'jumpDay') {
      // Native date jumps are consumed by day-end; they do not skip the rest
      // of the current source task or replay a colliding numeric script ID.
      this.targetDay = command.dayIndex;
    } else if (command.kind === 'selectEnding') {
      const choices = availableEndings(this.state, this.source!, command.endingType);
      this.unresolved(choices.unresolved, 'Ending selection');
      if (command.endingType === 1 && choices.endings.length) this.enqueueEnding(choices.endings[0]);
      else if (choices.endings.length) { this.interaction = { kind: 'ending', sourceId: command.endingType }; this.phase = 'interaction'; }
    } else if (command.kind === 'eventCheck') { this.interaction = { kind: 'event', sourceId: command.id, labelKey: field(this.source!.eventChecks?.[String(command.id)] ?? {}, 'DescKey'), requiresChoice: true }; this.phase = 'interaction'; }
    else if (command.kind === 'affairs') { this.interaction = { kind: 'affairs', sourceId: command.id, labelKey: field(this.source!.affairs?.[String(command.id)] ?? {}, 'Content'), key: this.key(`affairs:${command.id}`), requiresChoice: true }; this.phase = 'interaction'; }
    else if (command.kind === 'scratch') {
      const key = this.key(`scratch-board:${command.id}`), effect = ensureScratchBoard(this.state, command.id, this.source!, cell => this.draw(`${key}:${cell}`), key);
      this.unresolved(effect.unresolved, 'Scratch board'); this.runner.applyStoryEffect(effect);
      this.interaction = { kind: 'scratch', sourceId: command.id, key }; this.phase = 'interaction';
    } else if (command.kind === 'raffle') { this.interaction = { kind: 'raffle', sourceId: command.id, key: this.key(`raffle:${command.id}`) }; this.phase = 'interaction'; }
    else if (command.kind === 'requestAccept') { this.interaction = { kind: 'request', sourceId: command.behaviorId }; this.phase = 'interaction'; }
    else if (command.kind === 'behavior') { const row = this.currentBehavior(command.behaviorId); if (row) this.queue.unshift({ kind: 'settle', id: command.behaviorId, rowId: Number(row.Id), key: this.key(`behavior:${command.behaviorId}`) }); }
    else if (command.kind === 'gift') { this.interaction = { kind: 'gift', sourceId: command.roleId }; this.phase = 'interaction'; }
    else if (command.kind === 'shop') {
      for (const shop of tableRows(this.source!.shops).filter(r => r.LocationId === command.locationId)) {
        const key = this.key(`shop:${shop.Id}`), effect = ensureShopStock(this.state, Number(shop.Id), this.source!, this.draw(`${key}:stock`), key);
        this.unresolved(effect.unresolved, 'Shop stock'); this.runner.applyStoryEffect(effect);
      }
      this.interaction = { kind: 'shop', sourceId: command.locationId }; this.phase = 'interaction';
    }
  }
  private targetDay: number | null = null;
  private beginDay(): void {
    const monday = this.state.dayIndex! - storyDate(this.state.dayIndex!).weekday + 1;
    if (storyDate(this.state.dayIndex!).weekday === 1) {
      const weekly = settleWeeklyRewards(this.state, this.source!, monday);
      this.unresolved(weekly.unresolved, 'Weekly rewards'); this.runner.applyStoryEffect(weekly);
    }
    const selected = selectCalendar(this.state, this.source!);
    if (!selected.row) { this.unresolved(selected.unresolved, 'Calendar'); this.diagnose('missing-calendar', 'No determined authored calendar row for this day.'); this.phase = 'blocked'; return; }
    this.calendarId = Number(selected.row.Id); this.slotIndex = 0;
    this.locationProgress = {}; this.instanceMapStarted = false; this.instanceEnding = false;
    const instanceId = Number(selected.row.InstanceId) || 1;
    const home = tableRows(this.source!.locations).find(r => r.InstanceId === instanceId && r.IsHome === true);
    this.runner.applyStoryEffect(storyEffect(Object.freeze({ ...this.state, instanceId, timeSlot: 1, locationId: home ? Number(home.Id) : 0 })));
    const exam = tableRows(this.source!.exams).find(r => r.InstanceId === instanceId);
    if (exam) this.runner.applyStoryEffect(startExam(this.state, Number(exam.Id), this.source!, this.key(`exam:${exam.Id}`)));
    const instance = this.source!.instances?.[String(instanceId)];
    // Instances use their own enter/map/end action lists; normal days use the
    // five calendar slots. Their source flows block subsequent actions.
    if (instance && Number(instance.InstanceType) !== 0) {
      const enter = (sourceList(instance.EnterActionIdList) ?? []).map(id => this.action(id, `instance-enter:${instanceId}`));
      this.queue.unshift(...enter, { kind: 'instanceReady' });
      this.instanceExploration = true;
    } else { this.instanceExploration = false; this.queue.unshift({ kind: 'slot' }); }
  }
  private instanceExploration = false;
  private instanceMapStarted = false;
  private instanceEnding = false;
  private locationProgress: Record<string, number> = {};
  private skippingDays = false;
  private endLocation(): Metadata | undefined { return tableRows(this.source!.locations).find(row => row.InstanceId === this.state.instanceId && row.IsEndLocation); }
  private openLocations(): Metadata[] {
    return tableRows(this.source!.locations).filter(row => row.InstanceId === this.state.instanceId && evaluateLocationUnlock(Number(row.Id), this.state, this.source!).value === 'true' && evaluateConditionGroup(Number(row.ShowConditionGroupId ?? 0), this.state, this.source!).value === 'true');
  }
  private allRequiredLocationsComplete(): boolean {
    return this.openLocations().filter(row => !row.IsEndLocation).every(row => {
      const total = (sourceList(row.ActionIdList) ?? []).length, required = row.IsSeparate && total > 0 ? 1 : total;
      return (this.locationProgress[String(row.Id)] ?? 0) >= required;
    });
  }
  private beginInstanceEnd(): void {
    if (this.instanceEnding) return;
    this.instanceEnding = true;
    const id = this.state.instanceId!, instance = this.source!.instances?.[String(id)];
    this.queue.unshift(...(sourceList(instance?.EndActionIdList) ?? []).map(actionId => this.action(actionId, `instance-end:${id}`)), { kind: 'quest', timing: 3, param: id }, { kind: 'finishSlot' });
  }
  private beginSlot(): void {
    const slot = this.slotIndex + 1, row = this.source!.calendar![String(this.calendarId)], key = ['DawnActions', 'DayActions', 'NoonActions', 'DuskActions', 'NightActions'][this.slotIndex];
    this.runner.applyStoryEffect(storyEffect(Object.freeze({ ...this.state, timeSlot: slot })));
    const actions = (sourceList(row[key]) ?? []).map(id => this.action(id, `calendar:${this.calendarId}:${key}`));
    const free = slot === 2 ? row.HasDayAction === true : slot === 4 ? row.HasDuskAction === true : false;
    this.queue.unshift(...actions, free ? { kind: 'plan' } : { kind: 'finishSlot' });
  }
  private finishSlot(): void {
    if (this.instanceExploration) {
      const exam = tableRows(this.source!.exams).find(r => r.InstanceId === this.state.instanceId);
      if (exam) { const key = this.key(`exam-result:${exam.Id}`), effect = settleExam(this.state, Number(exam.Id), this.source!, key, this.draw(key)); this.unresolved(effect.unresolved, 'Exam result'); this.runner.applyStoryEffect(effect); }
      this.endDay(); return;
    }
    if (++this.slotIndex < 5) this.queue.unshift({ kind: 'slot' });
    else this.endDay();
  }
  private endDay(): void {
    const state = this.state;
    const actions = this.settleDay(state.dayIndex!);
    const totalDays = Number(tableRows(this.source!.params).find(r => r.Key === 'TotalDays')?.IntValue);
    if (state.dayIndex! >= totalDays) {
      this.endingNode = null; this.queue.unshift(...actions, { kind: 'ending' }); return;
    }
    const nextDay = Math.min(totalDays, this.targetDay !== null && this.targetDay > state.dayIndex! ? this.targetDay : state.dayIndex! + 1);
    this.targetDay = null;
    this.queue.unshift(...actions, nextDay > state.dayIndex! + 1 ? { kind: 'skipDay', dayIndex: state.dayIndex! + 1, target: nextDay } : { kind: 'advanceDay', dayIndex: nextDay });
  }
  private settleDay(dayIndex: number): Task[] {
    const state = this.state, behaviors = { ...state.behaviors }, buffs = { ...state.buffs };
    const actions: Task[] = [];
    const changes: Metadata[] = [];
    for (const [id, b] of Object.entries(behaviors)) if (b.state === 'Accepted' && b.finishDeadline !== undefined && dayIndex >= b.finishDeadline) {
      behaviors[id] = Object.freeze({ ...b, state: 'Failed' });
      const row = tableRows(this.source!.behaviors).find(r => String(r.BehaviorId) === id);
      actions.push({ kind: 'requestFailed', id: Number(id) });
      changes.push(Object.freeze({ kind: 'requestExpired', requestId: Number(id), labelKey: row?.Name }));
      if (Number(row?.FailAction)) actions.push(this.action(Number(row!.FailAction), `request-expiry:${id}`));
    }
    for (const [id, buff] of Object.entries(buffs)) {
      const duration = Number(this.source!.buffs?.[id]?.DurationDays);
      if (duration > 0 && buff.acquiredDay !== null && dayIndex - buff.acquiredDay + 1 >= duration) delete buffs[id];
    }
    this.runner.applyStoryEffect(storyEffect(Object.freeze({ ...state, behaviors: Object.freeze(behaviors), buffs: Object.freeze(buffs) }), changes));
    return actions;
  }
  private settleSkippedDay(dayIndex: number, target: number): void {
    // Native skips settle failures/buff expiry without activating daily quests
    // or replaying calendar scenes. Only the destination week emits rewards.
    this.skippingDays = true;
    this.runner.applyStoryEffect(storyEffect(Object.freeze({ ...this.state, dayIndex, timeSlot: 5 })));
    const actions = this.settleDay(dayIndex);
    const targetMonday = target - storyDate(target).weekday + 1;
    if (dayIndex === targetMonday) {
      const weekly = settleWeeklyRewards(this.state, this.source!, targetMonday);
      this.unresolved(weekly.unresolved, 'Weekly rewards'); this.runner.applyStoryEffect(weekly);
    }
    this.queue.unshift(...actions, dayIndex + 1 < target ? { kind: 'skipDay', dayIndex: dayIndex + 1, target } : { kind: 'advanceDay', dayIndex: target });
  }
  private advanceEnding(): void {
    if (!this.state.endingSnapshot) {
      const derived = effectiveAttributes(this.state, this.source!);
      if (!derived.value) { this.unresolved(derived.unresolved, 'Ending snapshot'); this.phase = 'blocked'; return; }
      this.runner.applyStoryEffect(storyEffect(freezeEndingState(this.state, this.source!)));
    }
    const traversal = nextEndingAction(this.state, this.source!, this.endingNode);
    this.endingPath.push(...traversal.path); this.endingNode = traversal.nextNode;
    if (traversal.unresolved.length) { this.unresolved(traversal.unresolved, 'Ending graph'); this.phase = 'blocked'; return; }
    if (traversal.terminal || !traversal.actions.length) { this.phase = 'complete'; this.nextCycle = traversal.terminal === 4; return; }
    this.queue.unshift(...traversal.actions.map(id => this.action(id, `ending-node:${traversal.path.at(-1)}`)), { kind: 'ending' });
  }
  private enqueueEnding(row: Metadata): void {
    this.runner.applyStoryEffect(storyEffect(Object.freeze({ ...this.state, selectedEndings: Object.freeze({ ...this.state.selectedEndings, [String(row.Id)]: true }) })));
    this.queue.unshift({ kind: 'flow', id: Number(row.FlowId) }, { kind: 'reachEnding', id: Number(row.Id) });
    this.interaction = null; this.phase = 'reading';
  }
  private currentBehavior(id: number): Metadata | undefined {
    return currentBehaviorRow(this.state, id, this.source!);
  }
  private behaviorAvailability(row: Metadata): ConditionResult {
    const prerequisite = evaluateConditionGroup(Number(row.ExecuteConditionGroupId ?? 0), this.state, this.source!), fatigue = behaviorFatigueAvailability(this.state, row, this.source!);
    return prerequisite.value === 'false' ? prerequisite : fatigue.value === 'false' ? fatigue : prerequisite.value === 'unknown' ? prerequisite : fatigue;
  }
  private enqueueBehavior(id: number): boolean {
    const row = this.currentBehavior(id); if (!row || this.behaviorAvailability(row).value !== 'true') return false;
    this.runner.applyStoryEffect(storyEffect(Object.freeze({ ...this.state, locationId: Number(row.Location) || this.state.locationId })));
    const key = this.key(`behavior:${id}`), pre = behaviorPreActions(this.state, row, this.draw(`${key}:pre`));
    if (!pre.value) { this.unresolved(pre.unresolved, 'Behavior pre-actions'); this.phase = 'blocked'; return false; }
    this.queue.unshift({ kind: 'quest', timing: 2, param: id }, ...pre.value.map(actionId => this.action(actionId, `behavior-pre:${id}`)), { kind: 'settle', id, rowId: Number(row.Id), key }, { kind: 'finishSlot' }); this.phase = 'reading';
    return true;
  }
  async select(optionId: string): Promise<boolean> {
    if (!this.active || this.busy || this.disposed) return false;
    const option = this.snapshot.options.find(o => o.id === optionId);
    if (!option || option.condition.value !== 'true') return false;
    if (option.kind === 'roleTalk') {
      const requested = this.source!.roleTalks?.[String(option.sourceId)];
      const rows = greetingRows(this.state, this.source!).filter(row => row.RoleId === requested?.RoleId);
      const talk = rows[Math.floor(this.draw(this.key('role-talk')) * rows.length)];
      const spine = this.source!.roleSpines?.[String(talk?.RoleSpineId)];
      if (!talk || !spine || !greetingRows(this.state, this.source!).includes(talk)) return false;
      const behavior = priorityTalkBehavior(this.state, this.source!, Number(talk.RoleId));
      if (behavior) this.runner.applyStoryEffect(storyEffect(Object.freeze({ ...this.state, specialTalkViewed: Object.freeze({ ...this.state.specialTalkViewed, [String(behavior)]: true }) })));
      this.interaction = { kind: 'roleTalk', sourceId: Number(spine.Id), labelKey: field(spine, 'TextKey') };
      this.phase = 'interaction';
      this.runner.presentRoleVoice(field(spine, 'AudioId') || null, field(spine, 'TextKey'), String(this.source!.roles?.[String(spine.RoleId)]?.SpeakerId ?? ''), Number(spine.Id));
      this.publish(); return true;
    } else if (option.kind === 'ending') {
      const available = availableEndings(this.state, this.source!, this.interaction!.sourceId).endings.find(r => r.Id === option.sourceId);
      if (!available) return false; this.enqueueEnding(available);
    } else if (option.kind === 'event') {
      const row = this.source!.eventCheckOptions![String(option.sourceId)], rate = eventCheckSuccessRate(this.state, row, this.source!);
      if (rate.value === null) { this.unresolved(rate.unresolved, 'Event check'); this.phase = 'blocked'; this.publish(); return false; }
      const key = this.key(`event:${option.sourceId}`), effect = settleEventCheck(this.state, row, this.draw(key) < rate.value, this.source!, key);
      this.runner.applyStoryEffect(effect); this.interaction = null; this.phase = 'reading';
    } else if (option.kind === 'affairs') {
      const row = this.source!.affairsOptions![String(option.sourceId)], effect = applyMechanicReward(this.state, Number(row.Reward), this.source!, 0, `${this.interaction!.key}:${option.sourceId}`);
      this.unresolved(effect.unresolved, 'Affairs reward'); this.runner.applyStoryEffect(effect); this.interaction = null; this.phase = 'reading';
    } else if (option.kind === 'scratchReveal') {
      const key = this.key(`scratch-reveal:${option.contextId}:${option.sourceId}`), effect = beginScratchReveal(this.state, option.contextId!, option.sourceId, this.source!, this.draw(key), key);
      this.unresolved(effect.unresolved, 'Scratch reveal'); this.runner.applyStoryEffect(effect);
      this.interaction = { ...this.interaction!, requiresChoice: !!this.state.scratchBoards[String(option.contextId)]?.pending };
    } else if (option.kind === 'scratchSettle') {
      const effect = settleScratchReveal(this.state, option.sourceId, this.source!);
      this.unresolved(effect.unresolved, 'Scratch prizes'); this.runner.applyStoryEffect(effect); this.interaction = { ...this.interaction!, requiresChoice: false };
    } else if (option.kind === 'raffle') {
      const key = this.key(`raffle-draw:${option.sourceId}`), effect = drawRaffle(this.state, option.sourceId, this.source!, this.draw(key), key);
      this.unresolved(effect.unresolved, 'Raffle prize'); this.runner.applyStoryEffect(effect);
    } else if (option.kind === 'request') {
      const effect = acceptSpecialRequest(this.state, option.sourceId, this.source!);
      if (effect.unresolved.length || effect.blocked?.length) return false;
      this.runner.applyStoryEffect(effect); this.interaction = null; this.phase = this.activeFlow === null ? 'planning' : 'reading';
    } else if (option.kind === 'reward') this.runner.applyStoryEffect(claimJourneyReward(this.state, option.sourceId, this.source!));
    else if (option.kind === 'item') this.runner.applyStoryEffect(useStoryItem(this.state, option.sourceId, this.source!, this.key(`item:${option.sourceId}`)));
    else if (option.kind === 'gift') {
      this.runner.applyStoryEffect(giveStoryGift(this.state, option.sourceId, this.interaction!.sourceId, this.source!, this.key(`gift:${option.sourceId}`)));
      this.interaction = null; this.phase = this.activeFlow === null ? 'planning' : 'reading';
    } else if (option.kind === 'shopItem') this.runner.applyStoryEffect(buyStoryGoods(this.state, option.contextId!, option.sourceId, 1, this.source!, this.key(`purchase:${option.contextId}:${option.sourceId}`)));
    else if (option.kind === 'explore') {
      const id = this.state.instanceId!, instance = this.source!.instances?.[String(id)];
      this.runner.endStagePlayback();
      this.instanceMapStarted = true;
      this.queue.unshift(...(sourceList(instance?.MapActionIdList) ?? []).map(actionId => this.action(actionId, `instance-map:${id}`)), { kind: 'quest', timing: 4, param: id }, { kind: 'instanceProgress' }); this.phase = 'reading';
    } else if (option.kind === 'locationOption') {
      const row = this.source!.options![String(option.sourceId)];
      this.queue.unshift(this.action(Number(row.ActionId), `location-option:${row.Id}`), { kind: this.instanceExploration ? 'instanceProgress' : 'plan' }); this.phase = 'reading';
    } else if (option.kind === 'location') {
      const id = option.sourceId;
      this.runner.applyStoryEffect(storyEffect(Object.freeze({ ...this.state, locationId: id })));
      this.refresh();
      if (this.instanceExploration && this.endLocation()?.Id === id) this.beginInstanceEnd();
      else if (this.instanceExploration) {
        const row = this.source!.locations![String(id)], ids = sourceList(row.ActionIdList) ?? [], start = this.locationProgress[String(id)] ?? 0, count = row.IsSeparate ? Math.min(1, ids.length - start) : ids.length - start;
        const actions = ids.slice(start, start + count).map(actionId => this.action(actionId, `location:${id}:${start}`));
        this.locationProgress = { ...this.locationProgress, [String(id)]: start + count };
        this.queue.unshift(...actions, { kind: 'instanceProgress' });
      } else {
        const affinity = this.takeQuest(1, id);
        if (affinity.length) this.queue.unshift(...affinity, { kind: 'plan' });
        else {
          const first = this.takeQuest(5, id);
          this.queue.unshift(...first, { kind: 'plan' });
        }
      }
      this.phase = 'reading';
    } else if (option.kind === 'behavior') {
      if (!this.enqueueBehavior(option.sourceId)) { this.publish(); return false; }
    }
    this.publish(); await this.flush(); return true;
  }
  async continue(): Promise<boolean> {
    if (!this.active || this.busy || this.phase !== 'planning') return false;
    if (this.instanceExploration) {
      if (!this.instanceMapStarted || !this.allRequiredLocationsComplete()) return false;
      const end = this.endLocation();
      if (end) return this.select(`location:${end.Id}`);
      this.beginInstanceEnd();
    } else {
      const scheduled = defaultScheduledBehavior(this.state, this.source!);
      if (scheduled !== null) { if (!this.enqueueBehavior(scheduled)) return false; }
      else this.queue.unshift({ kind: 'finishSlot' });
    }
    this.phase = 'reading'; this.publish(); await this.flush(); return true;
  }
  async dismissInteraction(): Promise<void> { if (!this.interaction || this.interaction.kind === 'ending' || this.interaction.kind === 'event' || this.interaction.requiresChoice) return; if (this.interaction.kind === 'roleTalk') this.runner.presentRoleVoice(null); this.interaction = null; this.phase = this.activeFlow === null ? 'planning' : 'reading'; this.publish(); await this.flush(); }
  createCheckpoint(): PlaythroughCheckpoint | null {
    const runner = this.runner.createCheckpoint();
    if (!runner || !this.active || this.busy || this.interaction) return null;
    return Object.freeze({ runner, journey: Object.freeze({ phase: this.phase, queue: Object.freeze([...this.queue]), calendarId: this.calendarId, slotIndex: this.slotIndex, activeFlow: this.activeFlow, sceneCount: this.sceneCount, endingNode: this.endingNode, endingPath: Object.freeze([...this.endingPath]), nextCycle: this.nextCycle, triggerKeys: Object.freeze([...this.triggerKeys]), actionCounter: this.actionCounter, seed: this.seed, targetDay: this.targetDay, instanceExploration: this.instanceExploration, instanceMapStarted: this.instanceMapStarted, instanceEnding: this.instanceEnding, locationProgress: Object.freeze({ ...this.locationProgress }), skippingDays: this.skippingDays, cycle: this.cycle, gallery: Object.freeze({ ...this.gallery }), diagnostics: Object.freeze([...this.diagnostics]) }) });
  }
  async restoreCheckpoint(checkpoint: PlaythroughCheckpoint): Promise<boolean> {
    if (!this.catalog || this.disposed) return false;
    this.epoch++; this.pending = null; this.queue = []; this.commands = []; this.deferredScores = [];
    this.refreshedState = null; this.optionsCache = null;
    if (!this.runner.restoreCheckpoint(checkpoint.runner)) return false;
    const c = checkpoint.journey;
    this.source = checkpoint.runner.source;
    this.active = true; this.busy = false; this.phase = c.phase; this.queue = [...c.queue]; this.calendarId = c.calendarId; this.slotIndex = c.slotIndex; this.activeFlow = c.activeFlow; this.sceneCount = c.sceneCount; this.endingNode = c.endingNode; this.endingPath = [...c.endingPath]; this.nextCycle = c.nextCycle; this.triggerKeys = new Set(c.triggerKeys); this.actionCounter = c.actionCounter; this.seed = c.seed; this.targetDay = c.targetDay; this.instanceExploration = c.instanceExploration; this.cycle = c.cycle; this.gallery = { ...c.gallery }; this.diagnostics = [...c.diagnostics]; this.interaction = null;
    this.instanceMapStarted = c.instanceMapStarted; this.instanceEnding = c.instanceEnding; this.locationProgress = { ...c.locationProgress }; this.skippingDays = c.skippingDays;
    this.publish(); await this.flush(); return true;
  }
  private makeSnapshot(): JourneySnapshot {
    const state = this.runner.getSnapshot().storyState;
    const scheduled = this.source && !this.instanceExploration ? defaultScheduledBehavior(state, this.source) : null, scheduledRow = scheduled === null ? undefined : this.currentBehavior(scheduled);
    const canContinue = this.active && !this.busy && this.phase === 'planning' && (!this.instanceExploration ? !scheduledRow || this.behaviorAvailability(scheduledRow).value === 'true' : this.instanceMapStarted && this.allRequiredLocationsComplete() && (!this.endLocation() || this.openLocations().includes(this.endLocation()!)));
    const selectingLocation = this.active && this.phase === 'planning' && this.instanceExploration && this.instanceMapStarted && !this.instanceEnding;
    return Object.freeze({ active: this.active, busy: this.busy, phase: this.phase, dayIndex: state.dayIndex, timeSlot: state.timeSlot, instanceId: state.instanceId, options: Object.freeze(this.options()), interaction: this.interaction, diagnostics: Object.freeze([...this.diagnostics]), endingPath: Object.freeze([...this.endingPath]), nextCycle: this.nextCycle, sceneCount: this.sceneCount, canCheckpoint: this.active && !this.busy && !this.interaction && this.runner.canCheckpoint, canContinue, continueLabelKey: scheduledRow ? field(scheduledRow, 'Name') : undefined, selectingLocation });
  }
  private options(): readonly JourneyOption[] {
    if (!this.source || !this.active) return [];
    const cached = this.optionsCache, state = this.state;
    // State is immutable. Stage/reveal updates can reuse eligibility until a
    // story mutation or a journey input changes its actual prerequisites.
    if (cached && cached.state === state && cached.source === this.source && cached.phase === this.phase && cached.interaction === this.interaction
      && cached.exploring === this.instanceExploration && cached.mapStarted === this.instanceMapStarted && cached.locations === this.locationProgress) return cached.options;
    const options = this.buildOptions();
    this.optionsCache = { state, source: this.source, phase: this.phase, interaction: this.interaction, exploring: this.instanceExploration, mapStarted: this.instanceMapStarted, locations: this.locationProgress, options };
    return options;
  }
  private buildOptions(): JourneyOption[] {
    if (!this.source || !this.active) return [];
    const state = this.state, source = this.source;
    if (this.interaction?.kind === 'ending') return availableEndings(state, source, this.interaction.sourceId).endings.map(row => ({ id: `ending:${row.Id}`, kind: 'ending', sourceId: Number(row.Id), labelKey: field(row, 'Desc'), condition: conditionResult('true') }));
    if (this.interaction?.kind === 'event') {
      const check = source.eventChecks?.[String(this.interaction.sourceId)];
      return tableRows(source.eventCheckOptions).filter(row => row.GroupId === check?.OptionGroupId).map(row => ({ id: `event:${row.Id}`, kind: 'event', sourceId: Number(row.Id), labelKey: field(row, 'DescKey'), condition: conditionResult('true'), probability: eventCheckSuccessRate(state, row, source).value }));
    }
    if (this.interaction?.kind === 'affairs') {
      const affair = source.affairs?.[String(this.interaction.sourceId)];
      return tableRows(source.affairsOptions).filter(row => row.GroupId === affair?.OptionGroupId).map(row => ({ id: `affairs:${row.Id}`, kind: 'affairs', sourceId: Number(row.Id), labelKey: field(row, 'DescKey'), condition: conditionResult('true') }));
    }
    if (this.interaction?.kind === 'scratch') {
      const id = this.interaction.sourceId;
      if (state.scratchBoards[String(id)]?.pending) return [{ id: 'scratchSettle', kind: 'scratchSettle', sourceId: id, labelKey: '', fallbackLabel: 'Receive prizes', condition: conditionResult('true') }];
      const cost = scratchCostChoice(state, id, source), cells = scratchCellChoices(state, id, source);
      return (cells.value ?? []).map(cell => ({ id: `scratchReveal:${cell.index}`, kind: 'scratchReveal', sourceId: cell.index, contextId: id, labelKey: '', fallbackLabel: cell.revealed ? 'Revealed' : `Scratch row ${cell.row + 1}, column ${cell.column + 1}`, condition: cell.condition, price: cost.cost?.amount, costKey: cost.cost?.labelKey }));
    }
    if (this.interaction?.kind === 'raffle') {
      const id = this.interaction.sourceId, cost = raffleCostChoice(state, id, source), progress = raffleProgress(state, id, source);
      return [{ id: `raffle:${id}`, kind: 'raffle', sourceId: id, labelKey: '', fallbackLabel: 'Draw a prize', condition: raffleEligibility(state, id, source), price: cost.cost?.amount, costKey: cost.cost?.labelKey, progress: progress.value?.drawn, target: progress.value?.total }];
    }
    if (this.interaction?.kind === 'gift') return giftChoices(state, this.interaction.sourceId, source).map(item => ({ id: `gift:${item.itemId}`, kind: 'gift', sourceId: item.itemId, labelKey: item.labelKey, descriptionKey: item.descriptionKey, condition: item.condition, progress: item.quantity.min }));
    if (this.interaction?.kind === 'shop') return tableRows(source.shops).filter(shop => shop.LocationId === this.interaction!.sourceId).flatMap(shop => {
      const stock = shopChoices(state, Number(shop.Id), source);
      return (stock.value ?? []).map(item => ({ id: `shop:${item.shopId}:${item.goodsId}`, kind: 'shopItem' as const, contextId: item.shopId, sourceId: item.goodsId, labelKey: item.labelKey, descriptionKey: item.descriptionKey, condition: item.condition, price: item.price }));
    });
    if (this.phase !== 'planning' && this.interaction?.kind !== 'request') return [];
    const options: JourneyOption[] = [];
    for (const row of tableRows(source.behaviors).filter(r => r.BehaviorType === 4)) {
      const id = Number(row.BehaviorId), b = state.behaviors[String(id)];
      if (b?.state === 'Appeared' && (!this.interaction || this.interaction.kind === 'request' && this.interaction.sourceId === id)) options.push({ id: `request:${id}`, kind: 'request', sourceId: id, labelKey: field(row, 'Name'), descriptionKey: field(row, 'DescText'), condition: requestAcceptance(row, state, source) });
    }
    if (this.interaction || this.phase !== 'planning') return options;
    if (this.instanceExploration && !this.instanceMapStarted) return [{ id: `explore:${state.instanceId}`, kind: 'explore', sourceId: state.instanceId!, labelKey: field(source.instances?.[String(state.instanceId)] ?? {}, 'OutBtnText'), fallbackLabel: 'Go out', condition: conditionResult('true') }];
    options.push(...itemChoices(state, source).map(item => ({ id: `item:${item.itemId}`, kind: 'item' as const, sourceId: item.itemId, labelKey: item.labelKey, descriptionKey: item.descriptionKey, condition: item.condition, progress: item.quantity.min })));
    for (const [id, progress] of Object.entries(state.requests)) {
      const row = source.requests?.[id];
      if (row && !progress.rewardClaimed && progress.status === 'completed' && Number(row.RewardItem) && (!Number(row.EndDayIndex) || state.dayIndex! <= Number(row.EndDayIndex))) options.push({ id: `reward:${id}`, kind: 'reward', sourceId: Number(id), labelKey: field(row, 'Name'), condition: conditionResult('true'), progress: progress.progress, target: Number(row.TargetProgress) });
    }
    const greetingRoles = new Set<number>();
    for (const row of greetingRows(state, source)) {
      const roleId = Number(row.RoleId); if (greetingRoles.has(roleId)) continue; greetingRoles.add(roleId);
      options.push({ id: `roleTalk:${row.Id}`, kind: 'roleTalk', sourceId: Number(row.Id), labelKey: '', fallbackLabel: 'Say hello', ownerLabelKey: field(source.roles?.[String(roleId)] ?? {}, 'Name'), condition: conditionResult('true') });
    }
    const seen = new Set<number>();
    for (const raw of tableRows(source.behaviors)) {
      const id = Number(raw.BehaviorId); if (seen.has(id)) continue; seen.add(id);
      const row = this.currentBehavior(id); if (!row) continue;
      if (Number(row.BehaviorType) === 2) continue;
      if (evaluateConditionGroup(Number(row.ShowConditionGroupId ?? 0), state, source).value !== 'true') continue;
      if (Number(row.RoleId) && !state.favor[String(row.RoleId)]?.unlocked) continue;
      if (!(sourceList(row.AvailableTimeSlot) ?? []).includes(state.timeSlot!)) continue;
      const b = state.behaviors[String(id)];
      if (row.BehaviorType === 4 && (b?.state !== 'Accepted' || !b.workDays?.includes(state.dayIndex!))) continue;
      if (this.instanceExploration) continue;
      const condition = this.behaviorAvailability(row);
      options.push({ id: `behavior:${id}`, kind: 'behavior', sourceId: id, labelKey: field(row, 'Name'), ownerLabelKey: Number(row.RoleId) ? field(source.roles?.[String(row.RoleId)] ?? {}, 'Name') : undefined, descriptionKey: field(row, 'DescText'), condition, probability: behaviorSuccessRate(state, row, source).value, progress: row.BehaviorType === 4 ? b?.count : undefined, target: row.BehaviorType === 4 ? Number(row.FinishCount) : undefined });
    }
    for (const row of this.openLocations()) {
      const total = (sourceList(row.ActionIdList) ?? []).length, progress = this.locationProgress[String(row.Id)] ?? 0;
      options.push({ id: `location:${row.Id}`, kind: 'location', sourceId: Number(row.Id), labelKey: field(row, 'Name'), condition: conditionResult(this.instanceExploration && row.IsEndLocation && !this.allRequiredLocationsComplete() ? 'false' : 'true'), progress: this.instanceExploration && total ? progress : undefined, target: this.instanceExploration && total ? total : undefined });
    }
    for (const row of tableRows(source.options).filter(row => row.InstanceId === state.instanceId).sort((a, b) => Number(a.Sort) - Number(b.Sort))) {
      if (row.OwnerType === 1 && state.locationId !== row.OwnerId || row.OwnerType === 2 && !state.favor[String(row.OwnerId)]?.unlocked) continue;
      const condition = evaluateConditionGroup(Number(row.ConditionId ?? 0), state, source);
      if (condition.value === 'false' && row.LockMode === 1) continue;
      options.push({ id: `locationOption:${row.Id}`, kind: 'locationOption', sourceId: Number(row.Id), contextId: Number(row.OwnerId), labelKey: field(row, 'TextKey'), ownerLabelKey: row.OwnerType === 2 ? field(source.roles?.[String(row.OwnerId)] ?? {}, 'Name') : undefined, condition });
    }
    return options;
  }
}
