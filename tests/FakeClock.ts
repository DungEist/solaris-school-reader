import type { Clock } from '../src/engine/Clock.ts';

/** Runs timers in deadline/insertion order. History also permits deliberately
 * firing a cleared callback to test cancellation races. */
export class FakeClock implements Clock {
  private time = 0;
  private nextId = 0;
  private timers = new Map<number, { at: number; callback: () => void }>();
  readonly callbacks: (() => void)[] = [];
  now(): number { return this.time; }
  get pendingTimers(): number { return this.timers.size; }
  setTimeout(callback: () => void, delayMs: number): number {
    const id = ++this.nextId;
    this.timers.set(id, { at: this.time + Math.max(0, delayMs), callback });
    this.callbacks.push(callback);
    return id;
  }
  clearTimeout(handle: unknown): void { this.timers.delete(handle as number); }
  elapseWithoutCallbacks(ms: number): void { this.time += ms; }
  advanceBy(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new Error('Fake-clock advances must be finite and nonnegative');
    const target = this.time + ms;
    let count = 0;
    while (true) {
      const item = [...this.timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!item || item[1].at > target) break;
      if (++count > 100_000) throw new Error('Fake clock exceeded its callback budget');
      this.time = Math.max(this.time, item[1].at);
      this.timers.delete(item[0]);
      item[1].callback();
    }
    this.time = target;
  }
}

/** Deliberately early timer delivery, with a one-ms floor so time progresses.
 * The optional jump models crossing a deadline between two clock samples. */
export class TimerPrecisionClock extends FakeClock {
  crossDeadlineOnNextWake = false;
  private jumpAfterSample = false;
  private offsetMs = 0;

  override now(): number {
    const sample = super.now() + this.offsetMs;
    if (this.jumpAfterSample) { this.jumpAfterSample = false; this.offsetMs += 2; }
    return sample;
  }

  override setTimeout(callback: () => void, delayMs: number): number {
    return super.setTimeout(() => {
      if (this.crossDeadlineOnNextWake) {
        this.crossDeadlineOnNextWake = false;
        this.jumpAfterSample = true;
      }
      callback();
    }, Math.max(1, Math.floor(delayMs) - 1));
  }
}
