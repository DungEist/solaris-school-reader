import { secondsToMs } from './Clock.ts';
import type { Clock } from './Clock.ts';
import type { EventContext, StageOp, StagePhase } from './types.ts';

export type StageDelivery = 'scheduled' | 'advance' | 'choice' | 'instant';

export interface StageTiming {
  readonly sourceOrder: number;
  readonly phaseStartedAtMs: number;
  readonly dueAtMs: number;
  readonly appliedAtMs: number;
  readonly delivery: StageDelivery;
}

export interface PendingStageOperation extends EventContext {
  readonly runId: number;
  readonly visitId: number;
  readonly phase: StagePhase;
  readonly optionIndex?: number;
  readonly sourceOrder: number;
  readonly phaseStartedAtMs: number;
  readonly dueAtMs: number;
  readonly operation: StageOp;
}

/** One ordered phase queue. A callback only wakes the owning runner; the
 * runner drains it inside a command before publishing a new snapshot. */
export class StageScheduler {
  private queue: PendingStageOperation[] = [];
  private timer: unknown = null;
  private epoch = 0;
  private readonly clock: Clock;
  private readonly wake: () => void;
  private readonly deliver: (task: PendingStageOperation, timing: StageTiming) => void;

  constructor(clock: Clock, wake: () => void, deliver: (task: PendingStageOperation, timing: StageTiming) => void) {
    this.clock = clock; this.wake = wake; this.deliver = deliver;
  }

  get pending(): readonly PendingStageOperation[] { return Object.freeze([...this.queue]); }

  begin(operations: readonly StageOp[], phase: StagePhase, context: EventContext, runId: number, visitId: number, optionIndex?: number): void {
    this.cancel();
    const phaseStartedAtMs = this.clock.now();
    this.queue = operations.flatMap((operation, sourceOrder) => (operation.phase ?? (phase === 'option' ? 'option' : 'start')) === phase ? [Object.freeze({
      ...context, runId, visitId, phase, optionIndex, sourceOrder, phaseStartedAtMs,
      dueAtMs: phaseStartedAtMs + secondsToMs(operation.t), operation,
    })] : []).sort((a, b) => a.dueAtMs - b.dueAtMs || a.sourceOrder - b.sourceOrder);
  }

  runDue(): void { this.drain('scheduled', false); }

  settle(delivery: Exclude<StageDelivery, 'scheduled'>): void { this.drain(delivery, true); }

  cancel(): void { this.disarm(); this.queue = []; }

  private drain(delivery: StageDelivery, all: boolean): void {
    this.disarm();
    const epoch = this.epoch;
    while (this.queue.length && (all || this.queue[0].dueAtMs <= this.clock.now())) {
      const task = this.queue.shift()!; // Remove before delivery: never replay.
      this.deliver(task, Object.freeze({
        sourceOrder: task.sourceOrder, phaseStartedAtMs: task.phaseStartedAtMs,
        dueAtMs: task.dueAtMs, appliedAtMs: this.clock.now(), delivery,
      }));
      if (this.epoch !== epoch) return;
    }
    this.arm();
  }

  private disarm(): void {
    this.epoch++;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private arm(): void {
    if (!this.queue.length) return;
    const epoch = this.epoch;
    const delay = Math.min(2_147_483_647, Math.max(0, this.queue[0].dueAtMs - this.clock.now()));
    this.timer = this.clock.setTimeout(() => {
      if (epoch !== this.epoch) return;
      this.timer = null;
      this.wake();
    }, delay);
  }
}
