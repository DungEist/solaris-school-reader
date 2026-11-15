import type { StageOp } from './types.ts';
import type { StageTiming } from './StageScheduler.ts';

/** Fast-forward consumes flagged play events, while stop/silence still settle. */
export function skipAudioDelivery(operation: StageOp, timing?: StageTiming): boolean {
  const cue = typeof operation.cue === 'string' ? operation.cue : '';
  const control = cue.startsWith('stop_') || cue.includes('silence') || cue.includes('slience');
  return !!operation.skipOnUltraFastForward && timing?.delivery === 'instant' && !control;
}
