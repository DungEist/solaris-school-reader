import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyJourneySnapshot } from '../src/engine/Playthrough.ts';
import type { JourneyOption, JourneySnapshot, StoryPlaythrough } from '../src/engine/Playthrough.ts';
import { conditionResult } from '../src/engine/StoryState.ts';
import { currentJourneyDecision, dispatchJourneyControl } from '../src/ui/JourneyDecision.ts';

const snapshot = (fields: Partial<JourneySnapshot>): JourneySnapshot => ({ ...emptyJourneySnapshot, active: true, ...fields });
const option = (kind: JourneyOption['kind'], id: number): JourneyOption => ({ id: kind + ':' + id, kind, sourceId: id, labelKey: 'source-label-' + id, condition: conditionResult('true') });

test('the stage decision retains every live planning action and its eligibility in School year order across instances', () => {
  const options = [option('item', 1), option('reward', 2), option('request', 3), option('behavior', 4), option('locationOption', 5), option('location', 6), option('explore', 7)];
  options[3] = { ...options[3], condition: conditionResult('unknown', 'Unresolved source prerequisite') };
  options[5] = { ...options[5], progress: 1, target: 3, condition: conditionResult('false') };
  for (const instanceId of [1, 2, 6, 14, 23]) {
    const state = snapshot({ phase: 'planning', instanceId, options });
    const before = JSON.stringify(state), decision = currentJourneyDecision(state)!;
    assert.equal(decision.kind, 'planning');
    assert.deepEqual(decision.options, [...options].reverse());
    assert.ok(decision.options.every(o => options.includes(o)), 'The UI preserves the engine options rather than reconstructing their rules.');
    assert.equal(decision.options.find(o => o.kind === 'location')!.progress, 1);
    assert.equal(decision.options.find(o => o.kind === 'behavior')!.condition.value, 'unknown');
    assert.equal(decision.control!.available, false, 'Finish cannot be offered before the engine says it is eligible.');
    assert.equal(JSON.stringify(state), before);
  }
});

test('scene reading, idle, blocked routes and native completion confirmations supply no ordinary stage decision', () => {
  const options = [option('location', 1)];
  for (const state of [
    emptyJourneySnapshot, snapshot({ phase: 'idle', options }), snapshot({ phase: 'reading', options }),
    snapshot({ phase: 'blocked', options }), snapshot({ phase: 'complete', options }),
    snapshot({ phase: 'interaction', interaction: { kind: 'requestDone', sourceId: 1 }, options }),
    snapshot({ phase: 'interaction', interaction: { kind: 'requestFailed', sourceId: 1 }, options }),
  ]) assert.equal(currentJourneyDecision(state), null);
});

test('interaction choices retain authored order and required choice boundaries, including scratch settlement', () => {
  const cases = [
    ['ending', 'ending', true], ['event', 'event', true], ['affairs', 'affairs', false],
    ['request', 'request', false], ['gift', 'gift', false], ['shop', 'shopItem', false],
    ['raffle', 'raffle', false], ['scratch', 'scratchReveal', false],
  ] as const;
  for (const [kind, action, required] of cases) {
    const options = [option(action, 2), option(action, 1)];
    const decision = currentJourneyDecision(snapshot({ phase: 'interaction', interaction: { kind, sourceId: 1 }, options }))!;
    assert.equal(decision.kind, 'interaction');
    assert.equal(decision.options, options, 'Interactions keep source precedence.');
    assert.equal(decision.control?.kind ?? null, required ? null : 'dismiss');
  }
  const pending = snapshot({ phase: 'interaction', interaction: { kind: 'scratch', sourceId: 1, requiresChoice: true }, options: [option('scratchSettle', 1)] });
  assert.equal(currentJourneyDecision(pending)!.control, null, 'A pending scratch reward must be received before returning.');
  assert.equal(currentJourneyDecision({ ...pending, interaction: { ...pending.interaction!, requiresChoice: false } })!.control!.kind, 'dismiss');
});

test('continuation preserves scheduled labels, eligible exploration finish and authored new-cycle availability', () => {
  const calls: string[] = [];
  const journey = { continue: () => calls.push('continue'), dismissInteraction: () => calls.push('dismiss'), startNextCycle: () => calls.push('nextCycle') } as unknown as StoryPlaythrough;
  const scheduled = currentJourneyDecision(snapshot({ phase: 'planning', instanceId: 1, canContinue: true, continueLabelKey: 'source-course-name' }))!.control!;
  assert.equal(scheduled.labelKey, 'source-course-name');
  dispatchJourneyControl(journey, scheduled);
  const finish = currentJourneyDecision(snapshot({ phase: 'planning', instanceId: 6, canContinue: true }))!.control!;
  assert.equal(finish.fallbackLabel, 'Finish exploring');
  dispatchJourneyControl(journey, { ...finish, available: false });
  assert.deepEqual(calls, ['continue'], 'An ineligible continuation cannot dispatch.');
  dispatchJourneyControl(journey, finish);
  dispatchJourneyControl(journey, currentJourneyDecision(snapshot({ phase: 'interaction', interaction: { kind: 'shop', sourceId: 1 } }))!.control!);
  const newCycle = currentJourneyDecision(snapshot({ phase: 'complete', nextCycle: true }))!;
  assert.equal(newCycle.kind, 'nextCycle');
  dispatchJourneyControl(journey, newCycle.control!);
  assert.deepEqual(calls, ['continue', 'continue', 'dismiss', 'nextCycle']);
});
