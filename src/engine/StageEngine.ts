import { EngineError } from './EngineError.ts';
import { systemClock } from './Clock.ts';
import type { Clock } from './Clock.ts';
import { StageScheduler } from './StageScheduler.ts';
import type { StageTiming } from './StageScheduler.ts';
import type { EventContext, ScriptNode, StageOp, StagePhase } from './types.ts';

export type StageSink = (operation: StageOp, phase: StagePhase, context: EventContext, visitId: number, timing: StageTiming, optionIndex?: number) => void;

/** Lifecycle origins belong to a visit, not a React render. */
export class StageEngine {
  private active: { node: ScriptNode; context: EventContext; visitId: number; runId: number; phase: StagePhase; optionOperations?: readonly StageOp[]; optionIndex?: number } | null = null;
  private readonly scheduler: StageScheduler;
  private instant: boolean;

  constructor(sink: StageSink, options: { clock?: Clock; wake?: () => void; instant?: boolean } = {}) {
    this.instant = options.instant ?? false;
    this.scheduler = new StageScheduler(options.clock ?? systemClock, options.wake ?? (() => this.runDue()), (task, timing) => {
      sink(task.operation, task.phase, { scriptId: task.scriptId, flowActionIndex: task.flowActionIndex, nid: task.nid }, task.visitId, timing, task.optionIndex);
    });
  }

  get pending() { return this.scheduler.pending; }
  get phase() { return this.active?.phase ?? null; }

  enter(node: ScriptNode, context: EventContext, visitId: number, runId: number): void {
    if (this.active) throw new EngineError('LIFECYCLE_ERROR', 'a node was entered before leaving the previous node', context);
    this.active = { node, context, visitId, runId, phase: 'start' };
    this.beginPhase();
  }

  /** A stable checkpoint already delivered every start operation. Restore the
   * active visit without replaying its grants or scheduling those starts. */
  restoreVisit(node: ScriptNode, context: EventContext, visitId: number, runId: number): void {
    this.reset();
    this.active = { node, context, visitId, runId, phase: 'start' };
  }

  /** Reader policy: settle the current phase, then time end operations from
   * this boundary. Selected option performances finish before this call.
   * Persistent state is never cleared here. */
  leave(delivery: 'advance' | 'choice'): void {
    if (!this.active || this.active.phase === 'end') return;
    this.scheduler.settle(delivery);
    this.active.phase = 'end';
    this.active.optionIndex = undefined;
    this.beginPhase();
  }

  select(operations: readonly StageOp[], optionIndex: number): void {
    if (!this.active || this.active.phase !== 'start') throw new EngineError('LIFECYCLE_ERROR', 'option performances require an active start-phase visit', this.active?.context);
    this.scheduler.settle('choice');
    this.active.phase = 'option';
    this.active.optionOperations = operations;
    this.active.optionIndex = optionIndex;
    this.beginPhase();
  }

  finishVisit(): void {
    if (this.active?.phase !== 'end' || this.pending.length) throw new EngineError('LIFECYCLE_ERROR', 'end operations must complete before leaving a visit', this.active?.context);
    this.active = null;
  }

  runDue(): void { this.scheduler.runDue(); }

  setInstant(instant: boolean): void {
    this.instant = instant;
    if (instant) this.scheduler.settle('instant');
  }

  /** Loading/restarting/disposal abandon pending operations and old endings. */
  reset(): void { this.scheduler.cancel(); this.active = null; }

  private beginPhase(): void {
    const active = this.active!;
    this.scheduler.begin(active.phase === 'option' ? active.optionOperations! : active.node.stage, active.phase, active.context, active.runId, active.visitId, active.optionIndex);
    if (this.instant) this.scheduler.settle('instant');
    else this.scheduler.runDue();
  }
}
