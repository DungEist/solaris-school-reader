import type { Clock } from '../engine/Clock.ts';
import { systemClock } from '../engine/Clock.ts';
import type { ScriptRunner } from '../engine/ScriptRunner.ts';
import type { Metadata, RunnerEvent, StageEvent } from '../engine/types.ts';

export interface IntroductionDefinition {
  readonly id: number;
  readonly nameKey: string;
  readonly influenceKey: string;
  readonly textKey: string;
  readonly color: string;
}
export interface LetterDefinition {
  readonly id: number;
  readonly pages: readonly { readonly id: number; readonly paragraphKeys: readonly string[] }[];
}
export interface ReaderPresentationSource {
  readonly schema: 1;
  readonly introductions: Readonly<Record<string, IntroductionDefinition>>;
  readonly lettersByAction: Readonly<Record<string, LetterDefinition>>;
  readonly english: Readonly<Record<string, string>>;
}
export interface PresentationNotice<T> {
  readonly id: string;
  readonly runId: number;
  readonly stageSequence: number;
  readonly definition: T;
}
export interface ReaderPresentationSnapshot {
  readonly introduction: PresentationNotice<IntroductionDefinition> | null;
  readonly letters: readonly PresentationNotice<LetterDefinition>[];
  readonly consequences: readonly ConsequenceNotice[];
  readonly relationships: readonly RelationshipNotice[];
}
export interface ConsequenceNotice {
  readonly id: string;
  readonly runId: number;
  readonly stageSequence: number;
  readonly changes: readonly Metadata[];
}
export interface RelationshipNotice {
  readonly id: string;
  readonly runId: number;
  readonly stageSequence: number;
  readonly change: Metadata;
  readonly scriptId?: string;
  readonly earnedNode?: number | null;
  readonly completionSequence?: number;
}
export const emptyReaderPresentations: ReaderPresentationSnapshot = Object.freeze({ introduction: null, letters: Object.freeze([]), consequences: Object.freeze([]), relationships: Object.freeze([]) });
export const noPresentationSubscription = () => () => {};
export const emptyPresentationSnapshot = () => emptyReaderPresentations;

type Source = Pick<ScriptRunner, 'getSnapshot' | 'subscribe' | 'onEvent'>;

/** Read-only event projection owned by the page, alongside History. UI mounts,
 * interface switches and confirmation cannot deliver or apply a stage event.
 * The only timer expires an introduction's explicit source display duration;
 * it does not suspend or schedule the engine, dialogue or quiz clocks. */
export class ReaderPresentations {
  private source: ReaderPresentationSource | null = null;
  private runId: number;
  private sceneId: number;
  private state = emptyReaderPresentations;
  private seen = new Set<string>();
  private waiting: { event: StageEvent; deliveredAt: number }[] = [];
  private pendingRelationships: { sceneId: number; notice: RelationshipNotice }[] = [];
  private listeners = new Set<() => void>();
  private introductionTimer: unknown = null;
  private consequenceTimers = new Map<string, unknown>();
  private unsubscribeEvents: () => void;
  private unsubscribeState: () => void;
  private disposed = false;
  private readonly runner: Source;
  private readonly clock: Clock;

  constructor(runner: Source, clock: Clock = systemClock) {
    this.runner = runner;
    this.clock = clock;
    this.runId = runner.getSnapshot().runId;
    this.sceneId = runner.getSnapshot().sceneId;
    this.unsubscribeEvents = runner.onEvent(event => this.record(event));
    this.unsubscribeState = runner.subscribe(() => this.syncRun());
    // Existing state/history is not evidence of a newly earned relationship.
    // Other live notices retain their existing event projection and deduping.
    for (const event of runner.getSnapshot().events) this.record(event, true);
  }
  getSnapshot = (): ReaderPresentationSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  isBlocked = (): boolean => this.state.relationships.length > 0;
  setSource(source: ReaderPresentationSource): void {
    if (this.disposed || this.source === source) return;
    this.source = source;
    const waiting = this.waiting;
    this.waiting = [];
    for (const item of waiting) this.project(item.event, item.deliveredAt);
  }
  dismissLetter(id: string): void {
    if (this.disposed || this.state.letters[0]?.id !== id) return;
    this.publish({ ...this.state, letters: Object.freeze(this.state.letters.slice(1)) });
  }
  dismissRelationship(id: string): void {
    if (this.disposed || this.state.relationships[0]?.id !== id) return;
    this.publish({ ...this.state, relationships: Object.freeze(this.state.relationships.slice(1)) });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelIntroduction();
    this.cancelConsequences();
    this.unsubscribeEvents(); this.unsubscribeState(); this.listeners.clear();
    this.waiting = [];
  }
  private syncRun(): void {
    if (this.disposed) return;
    const current = this.runner.getSnapshot();
    if (current.status === 'disposed') { this.dispose(); return; }
    if (current.runId === this.runId) {
      if (current.sceneId !== this.sceneId) {
        this.sceneId = current.sceneId;
        this.pendingRelationships = [];
        if (this.state.relationships.length) this.publish({ ...this.state, relationships: Object.freeze([]) });
      }
      return;
    }
    this.runId = current.runId;
    this.sceneId = current.sceneId;
    this.cancelIntroduction(); this.cancelConsequences(); this.seen.clear(); this.waiting = [];
    this.pendingRelationships = [];
    this.publish(emptyReaderPresentations);
  }
  private record(event: RunnerEvent, historical = false): void {
    if (this.disposed || event.runId !== this.runner.getSnapshot().runId) return;
    this.syncRun();
    if (event.type === 'storyMutation') {
      this.projectConsequences(event, historical);
      return;
    }
    if (event.type === 'completed') {
      const ready = this.pendingRelationships.filter(item => item.sceneId === this.sceneId && item.notice.scriptId === event.scriptId);
      this.pendingRelationships = this.pendingRelationships.filter(item => !ready.includes(item));
      if (ready.length) this.publish({ ...this.state, relationships: Object.freeze([...this.state.relationships, ...ready.map(item => Object.freeze({ ...item.notice, completionSequence: event.sequence }))]) });
      return;
    }
    if (event.type !== 'stage') return;
    if (event.operation.op !== 'roleIntro' && event.operation.op !== 'activityAction') return;
    const id = `${event.runId}:${event.sequence}`;
    if (this.seen.has(id)) return;
    this.seen.add(id);
    const deliveredAt = this.clock.now();
    if (!this.source) this.waiting.push({ event, deliveredAt });
    else this.project(event, deliveredAt);
  }
  private projectConsequences(event: Extract<RunnerEvent, { type: 'storyMutation' }>, historical: boolean): void {
    const eventId = `${event.runId}:${event.sequence}`;
    if (this.seen.has(eventId)) return;
    this.seen.add(eventId);
    const identity = { id: eventId, runId: event.runId, stageSequence: event.stageSequence };
    const changes = event.changes.filter(change => {
      if (change.kind === 'requestUnlocked') return true;
      return ['attribute', 'favor', 'item'].includes(String(change.kind)) && typeof change.value === 'number' && change.value !== 0;
    });
    const earned = historical ? [] : event.changes.flatMap((change, i) => change.kind === 'favorLevel' && typeof change.before === 'number' && typeof change.after === 'number' && change.before !== change.after
      ? [Object.freeze({ ...identity, id: `${eventId}:relationship:${i}`, scriptId: event.scriptId, earnedNode: event.nid, change })] : []);
    const relationships = event.visitId === null ? earned : [];
    if (event.visitId !== null) this.pendingRelationships.push(...earned.map(notice => ({ sceneId: this.sceneId, notice })));
    if (!changes.length && !relationships.length) return;
    const notice = changes.length ? Object.freeze({ ...identity, changes: Object.freeze(changes) }) : null;
    this.publish({
      ...this.state,
      consequences: notice ? Object.freeze([...this.state.consequences, notice]) : this.state.consequences,
      relationships: Object.freeze([...this.state.relationships, ...relationships]),
    });
    // This is only the lifetime of the on-screen gain card. Confirming a tier
    // and expiring a card never send commands or change accumulated story state.
    if (notice) this.consequenceTimers.set(notice.id, this.clock.setTimeout(() => {
      this.consequenceTimers.delete(notice.id);
      if (!this.disposed && this.state.consequences.some(item => item.id === notice.id)) this.publish({ ...this.state, consequences: Object.freeze(this.state.consequences.filter(item => item.id !== notice.id)) });
    }, 6000));
  }
  private project(event: StageEvent, deliveredAt: number): void {
    if (event.runId !== this.runId || !this.source) return;
    const operation = event.operation;
    const identity = { id: `${event.runId}:${event.sequence}`, runId: event.runId, stageSequence: event.sequence };
    if (operation.op === 'roleIntro' && typeof operation.introId === 'number' && typeof operation.dur === 'number' && Number.isFinite(operation.dur) && operation.dur > 0) {
      const definition = this.source.introductions[String(operation.introId)];
      const remaining = deliveredAt + operation.dur * 1000 - this.clock.now();
      if (!definition || remaining <= 0) return;
      this.cancelIntroduction();
      const notice = Object.freeze({ ...identity, definition });
      this.publish({ ...this.state, introduction: notice });
      this.introductionTimer = this.clock.setTimeout(() => {
        this.introductionTimer = null;
        if (!this.disposed && this.state.introduction?.id === notice.id) this.publish({ ...this.state, introduction: null });
      }, remaining);
    } else if (operation.op === 'activityAction' && operation.kind === 'SolarSchool' && typeof operation.actionId === 'number') {
      const definition = this.source.lettersByAction[String(operation.actionId)];
      if (definition) this.publish({ ...this.state, letters: Object.freeze([...this.state.letters, Object.freeze({ ...identity, definition })]) });
    }
  }
  private cancelIntroduction(): void {
    if (this.introductionTimer !== null) this.clock.clearTimeout(this.introductionTimer);
    this.introductionTimer = null;
  }
  private cancelConsequences(): void {
    for (const timer of this.consequenceTimers.values()) this.clock.clearTimeout(timer);
    this.consequenceTimers.clear();
  }
  private publish(state: ReaderPresentationSnapshot): void {
    this.state = Object.freeze(state);
    for (const listener of this.listeners) listener();
  }
}
