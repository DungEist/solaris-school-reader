import { systemClock } from '../engine/Clock.ts';
import type { Clock } from '../engine/Clock.ts';
import type { ScriptRunner } from '../engine/ScriptRunner.ts';
import type { VisitToken } from '../engine/types.ts';
import type { PlayerTextProfile } from '../text/EnglishText.ts';
import { emptyFormattedText, formattedEnglishText } from '../text/FormattedEnglishText.ts';
import type { FormattedEnglishText } from '../text/FormattedEnglishText.ts';

export interface ReadingSnapshot extends VisitToken {
  readonly document: FormattedEnglishText;
  readonly visibleGraphemes: number;
  readonly complete: boolean;
  readonly inputReady: boolean;
  readonly textSpeed: number;
  readonly instantText: boolean;
}

export type ReadingInputResult = 'revealed' | 'advanced' | 'ignored';

/** Presentation and manual input only. Text callbacks never send runner commands. */
export class ManualReader {
  private readonly runner: ScriptRunner;
  private readonly clock: Clock;
  private readonly debounceMs: number;
  private textSpeed: number;
  private instantText: boolean;
  private english: Readonly<Record<string, string>> = {};
  private profile: PlayerTextProfile = { playerName: 'Rover', gender: 'male' };
  private document = emptyFormattedText;
  private runId = -1;
  private visitId = -1;
  private textKey: string | null = null;
  private visible = 0;
  private anchorVisible = 0;
  private anchorMs = 0;
  private readyAtMs = 0;
  private textTimer: unknown = null;
  private inputTimer: unknown = null;
  private textEpoch = 0;
  private inputEpoch = 0;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private snapshot!: ReadingSnapshot;

  constructor(runner: ScriptRunner, options: { clock?: Clock; textSpeed?: number; instantText?: boolean; inputDebounceMs?: number } = {}) {
    this.runner = runner;
    this.clock = options.clock ?? systemClock;
    this.textSpeed = options.textSpeed ?? 25;
    this.instantText = options.instantText ?? false;
    this.debounceMs = options.inputDebounceMs ?? 200;
    this.validateSpeed(this.textSpeed);
    if (!Number.isFinite(this.debounceMs) || this.debounceMs < 0) throw new Error('inputDebounceMs must be nonnegative');
    this.unsubscribe = runner.subscribe(() => this.sync());
    this.sync();
  }

  getSnapshot = (): ReadingSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  setTextContext(english: Readonly<Record<string, string>>, profile: PlayerTextProfile): void {
    if (this.disposed || this.english === english && this.profile.playerName === profile.playerName && this.profile.gender === profile.gender) return;
    this.english = english;
    this.profile = { ...profile };
    this.sync(true);
  }

  setTextOptions(options: { textSpeed?: number; instantText?: boolean }): void {
    if (this.disposed) return;
    const speed = options.textSpeed ?? this.textSpeed;
    this.validateSpeed(speed);
    const instant = options.instantText ?? this.instantText;
    if (speed === this.textSpeed && instant === this.instantText) return;
    this.sample();
    this.cancelText();
    this.textSpeed = speed;
    this.instantText = instant;
    if (instant) this.visible = this.document.graphemeEnds.length;
    this.anchor();
    this.scheduleText();
    this.publish();
  }

  advance(expected?: VisitToken): ReadingInputResult {
    const state = this.runner.getSnapshot();
    if (!this.validInput(expected) || !['dialogue', 'choices'].includes(state.status)) return 'ignored';
    if (this.visible < this.document.graphemeEnds.length) {
      this.holdInput();
      this.finishText();
      this.publish();
      return 'revealed';
    }
    if (state.status !== 'dialogue' && !(state.hiddenChoice && state.branchResolution?.optionIndex !== null && state.branchResolution?.optionIndex !== undefined)) return 'ignored';
    return this.request(() => this.runner.advance(expected ?? state)) ? 'advanced' : 'ignored';
  }

  choose(index: number, expected?: VisitToken): boolean {
    const state = this.runner.getSnapshot();
    if (!this.validInput(expected) || !this.snapshot.complete || state.status !== 'choices' || state.hiddenChoice) return false;
    return this.request(() => this.runner.choose(index, expected ?? state));
  }

  overrideHiddenChoice(index: number, expected?: VisitToken): boolean {
    const state = this.runner.getSnapshot();
    if (!this.validInput(expected) || state.status !== 'choices' || !state.hiddenChoice) return false;
    return this.request(() => this.runner.overrideHiddenChoice(index, expected ?? state));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelText();
    this.cancelInput();
    this.unsubscribe();
    this.publish();
    this.listeners.clear();
  }

  private sync(contextChanged = false): void {
    if (this.disposed) return;
    const state = this.runner.getSnapshot();
    if (state.status === 'disposed') { this.dispose(); return; }
    const textKey = state.dialogue?.textKey ?? null;
    const newVisit = state.runId !== this.runId || state.visitId !== this.visitId || textKey !== this.textKey;
    if (newVisit || contextChanged) {
      this.sample();
      const wasComplete = this.visible === this.document.graphemeEnds.length;
      this.cancelText();
      if (state.runId !== this.runId) { this.cancelInput(); this.readyAtMs = 0; }
      this.runId = state.runId;
      this.visitId = state.visitId;
      this.textKey = textKey;
      this.document = formattedEnglishText(textKey, this.english, this.profile);
      this.visible = this.instantText || !newVisit && wasComplete ? this.document.graphemeEnds.length : newVisit ? 0 : Math.min(this.visible, this.document.graphemeEnds.length);
      this.anchor();
      this.scheduleText();
    }
    if (!['dialogue', 'choices', 'quiz'].includes(state.status)) this.finishText();
    this.publish();
  }

  private validateSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed < 1 || speed > 200) throw new Error('textSpeed must be between 1 and 200 graphemes per second');
  }

  private validInput(expected?: VisitToken): boolean {
    const state = this.runner.getSnapshot();
    return !this.disposed && this.clock.now() >= this.readyAtMs && state.inputReady && (!expected || state.runId === expected.runId && state.visitId === expected.visitId);
  }

  private request(action: () => boolean): boolean {
    const previous = this.readyAtMs;
    this.holdInput();
    const accepted = action();
    if (!accepted) { this.cancelInput(); this.readyAtMs = previous; }
    this.publish();
    return accepted;
  }

  private holdInput(): void {
    this.cancelInput();
    this.readyAtMs = this.clock.now() + this.debounceMs;
    this.scheduleInput();
  }

  private scheduleInput(): void {
    if (this.disposed || this.inputTimer !== null) return;
    const remainingMs = this.readyAtMs - this.clock.now();
    if (remainingMs <= 0) return;
    const epoch = this.inputEpoch;
    this.inputTimer = this.clock.setTimeout(() => {
      if (this.disposed || epoch !== this.inputEpoch) return;
      this.inputTimer = null;
      // Publishing re-arms the remaining deadline if this wake arrived early.
      this.publish();
    }, remainingMs);
  }

  private anchor(): void { this.anchorMs = this.clock.now(); this.anchorVisible = this.visible; }
  private sample(): void {
    if (this.visible >= this.document.graphemeEnds.length) return;
    this.visible = Math.min(this.document.graphemeEnds.length, this.anchorVisible + Math.floor((this.clock.now() - this.anchorMs) * this.textSpeed / 1000 + 1e-8));
  }
  private finishText(): void { this.cancelText(); this.visible = this.document.graphemeEnds.length; }
  private cancelText(): void {
    this.textEpoch++;
    if (this.textTimer !== null) this.clock.clearTimeout(this.textTimer);
    this.textTimer = null;
  }
  private cancelInput(): void {
    this.inputEpoch++;
    if (this.inputTimer !== null) this.clock.clearTimeout(this.inputTimer);
    this.inputTimer = null;
  }
  private scheduleText(): void {
    if (this.disposed || this.visible >= this.document.graphemeEnds.length) return;
    const epoch = this.textEpoch;
    const nextMs = this.anchorMs + (this.visible - this.anchorVisible + 1) * 1000 / this.textSpeed;
    this.textTimer = this.clock.setTimeout(() => {
      if (this.disposed || epoch !== this.textEpoch) return;
      this.textTimer = null;
      this.sample();
      this.scheduleText();
      this.publish();
    }, Math.max(0, nextMs - this.clock.now()));
  }
  private publish(): void {
    // A published temporary lock must retain a wake, including after canceled
    // or superseded callbacks. Readiness still uses the original deadline.
    this.scheduleInput();
    const next: ReadingSnapshot = Object.freeze({
      runId: this.runId, visitId: this.visitId, document: this.document,
      visibleGraphemes: this.visible, complete: this.visible === this.document.graphemeEnds.length,
      inputReady: !this.disposed && this.clock.now() >= this.readyAtMs && this.runner.getSnapshot().inputReady,
      textSpeed: this.textSpeed, instantText: this.instantText,
    });
    if (this.snapshot && (Object.keys(next) as (keyof ReadingSnapshot)[]).every(key => next[key] === this.snapshot[key])) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
