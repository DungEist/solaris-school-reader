import type { JourneyOption, JourneySnapshot, StoryPlaythrough } from '../engine/Playthrough.ts';

export const journeyActionGroups: readonly { readonly name: string; readonly kind: JourneyOption['kind'] }[] = [
  { name: 'Explore', kind: 'explore' }, { name: 'Places', kind: 'location' },
  { name: 'At this place', kind: 'locationOption' }, { name: 'Friends here', kind: 'roleTalk' }, { name: 'Activities', kind: 'behavior' },
  { name: 'Requests to accept', kind: 'request' }, { name: 'Journey rewards', kind: 'reward' },
  { name: 'Use an item', kind: 'item' },
];

export interface JourneyDecisionControl {
  readonly kind: 'continue' | 'dismiss' | 'nextCycle';
  readonly available: boolean;
  readonly labelKey?: string;
  readonly fallbackLabel: string;
}
export interface JourneyDecision {
  readonly kind: 'planning' | 'interaction' | 'nextCycle';
  readonly options: readonly JourneyOption[];
  readonly control: JourneyDecisionControl | null;
}

/** Projects an input boundary; no dates, scripts, eligibility or gameplay
 * effects are inferred by the Reader. Confirmations remain separate. */
export function currentJourneyDecision(snapshot: JourneySnapshot): JourneyDecision | null {
  if (!snapshot.active || snapshot.phase === 'blocked') return null;
  const interaction = snapshot.interaction;
  if (interaction) {
    if (interaction.kind === 'requestDone' || interaction.kind === 'requestFailed') return null;
    const required = interaction.kind === 'ending' || interaction.kind === 'event' || interaction.requiresChoice;
    return { kind: 'interaction', options: snapshot.options, control: required ? null : { kind: 'dismiss', available: true, fallbackLabel: 'Continue' } };
  }
  if (snapshot.phase === 'planning') {
    const known = new Set(journeyActionGroups.map(group => group.kind));
    const options = [...journeyActionGroups.flatMap(group => snapshot.options.filter(option => option.kind === group.kind)), ...snapshot.options.filter(option => !known.has(option.kind))];
    return { kind: 'planning', options, control: { kind: 'continue', available: snapshot.canContinue, labelKey: snapshot.continueLabelKey, fallbackLabel: snapshot.instanceId !== 1 ? 'Finish exploring' : 'Continue to the next part of the day' } };
  }
  if (snapshot.phase === 'complete' && snapshot.nextCycle) return { kind: 'nextCycle', options: [], control: { kind: 'nextCycle', available: true, fallbackLabel: 'Continue to a new cycle' } };
  return null;
}

export function dispatchJourneyControl(journey: StoryPlaythrough, control: JourneyDecisionControl): void {
  if (!control.available) return;
  if (control.kind === 'continue') void journey.continue();
  else if (control.kind === 'nextCycle') void journey.startNextCycle();
  else void journey.dismissInteraction();
}
