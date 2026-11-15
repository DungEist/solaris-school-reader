import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import type { EnglishCatalog } from '../src/data/EnglishScriptRepository.ts';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import type { ScriptOption } from '../src/engine/types.ts';
import { resolveCG } from '../src/assets/AssetResolver.ts';
import type { PlayerTextProfile } from '../src/text/EnglishText.ts';
import { fixture, manifest, node, option } from './fixtures.ts';
import { visualFixture } from './visual-fixtures.ts';
import { FakeClock, TimerPrecisionClock } from './FakeClock.ts';
import { ManualReader } from '../src/ui/ManualReader.ts';
import { DialogueBacklog } from '../src/ui/DialogueBacklog.ts';
import { emptyVisualAssets } from '../src/assets/VisualAssets.ts';
import { quizFixture, quizOperation } from './quiz-fixtures.ts';
import { changliAssets } from './changli-fixtures.ts';
import { applyRewardGroup, conditionResult, emptyStorySource, initialStoryState, storyEffect, validateStorySource } from '../src/engine/StoryState.ts';
import type { Script } from '../src/engine/types.ts';
import { emptyJourneySnapshot } from '../src/engine/Playthrough.ts';
import type { JourneyOption, JourneySnapshot, StoryPlaythrough } from '../src/engine/Playthrough.ts';
import { ReaderPresentations } from '../src/ui/ReaderPresentations.ts';
import { playthroughHarness, realCatalog } from './PlaythroughHarness.ts';

// Node can strip TS, but not JSX. Compile the actual React adapter for this
// render test, retaining React as an external dependency, without a DOM/server.
const built = await build({
  configFile: false, logLevel: 'silent',
  build: { ssr: fileURLToPath(new URL('./ui-entry.ts', import.meta.url)), write: false, minify: false },
});
const outputs = Array.isArray(built) ? built : [built];
const chunk = outputs.flatMap(output => 'output' in output ? output.output : []).find(output => output.type === 'chunk' && output.isEntry);
assert.ok(chunk && chunk.type === 'chunk', 'React adapter did not compile');
const cacheDir = new URL('../.cache/ui-tests/', import.meta.url);
await mkdir(cacheDir, { recursive: true });
const modulePath = new URL('ReaderSession.mjs', cacheDir);
await writeFile(modulePath, chunk.code);
const { ReaderSession, VisualStage, HistoryPanel, QuizView, ReaderConsequences, ReaderRelationship, ReaderJourney, ReaderJourneyChoices, ReaderJourneyInteraction } = await import(modulePath.href);

test('Reader renders concurrent stat and favor gains with actual item/request notices and a separate source tier confirmation', () => {
  const english = { feeling: 'Feeling', cartethyia: 'Cartethyia', item: 'A keepsake', request: 'A helping hand', acquainted: 'Acquainted', unlock: 'Unlocks Gifts and Outings with Cartethyia' };
  const notice = { id: 'grant', runId: 1, stageSequence: 123, changes: [
    { kind: 'attribute', attributeId: 4, value: 1, labelKey: 'feeling' },
    { kind: 'favor', roleId: 2, value: 10, labelKey: 'cartethyia' },
    { kind: 'item', itemId: 4, value: 1, labelKey: 'item' },
    { kind: 'requestUnlocked', requestId: 1105, labelKey: 'request' },
  ] };
  const before = JSON.stringify(notice);
  for (let i = 0; i < 3; i++) {
    const cards = renderToStaticMarkup(createElement(ReaderConsequences, { notices: [notice], english }));
    for (const value of ['Feeling', '+1', 'Cartethyia', '+10', 'Received', 'A keepsake', 'Request unlocked', 'A helping hand']) assert.ok(cards.includes(value), value);
    assert.ok(cards.includes('consequence-attribute') && cards.includes('consequence-favor'));
    assert.ok(!cards.includes('Condition') && !cards.includes('questId') && !cards.includes('itemId'));
    assert.ok(!cards.includes('relationship-confirm'), 'point gain never fabricates a level change');
    const confirmation = renderToStaticMarkup(createElement(ReaderRelationship, { id: 'relationship', notice: { id: 'tier', runId: 1, stageSequence: 124,
      change: { kind: 'favorLevel', roleId: 2, before: 0, after: 1, labelKey: 'cartethyia', tierLabelKey: 'acquainted', descriptionKey: 'unlock' } }, english, onClose: () => {} }));
    assert.ok(confirmation.includes('Intimacy Increased!'));
    assert.ok(confirmation.includes('Your Intimacy with Cartethyia has increased to'));
    assert.ok(confirmation.includes('<strong>Acquainted</strong>'));
    assert.ok(confirmation.includes(english.unlock));
    assert.ok(confirmation.includes('data-testid="relationship-confirm"'));
    assert.ok(!confirmation.includes('+10'));
  }
  assert.equal(JSON.stringify(notice), before, 'renders preserve the incoming mutation snapshot');
  const fallback = renderToStaticMarkup(createElement(ReaderConsequences, { notices: [{ ...notice, changes: [{ kind: 'item', itemId: 4, value: 1, labelKey: 'unavailable-internal-name' }] }], english }));
  assert.ok(fallback.includes('Item'));
  assert.ok(!fallback.includes('unavailable-internal-name'), 'missing localization keys stay out of Reader text');
});

test('Reader journey uses readable missing-label fallbacks and offers a new cycle only after the authored terminal', () => {
  let calls = 0;
  const journey = { startNextCycle: () => { calls++; } } as unknown as StoryPlaythrough;
  const source = { ...emptyStorySource, activity: { Id: 111700001 }, attrs: { '1': { Name: 'missing-attribute-key', InitValue: 20 } }, roles: {} };
  const catalog: EnglishCatalog = { manifest, index: [], speakers: {}, english: { coins: 'School Credits' }, report: {}, storySource: source };
  const state = initialStoryState(source), profile = { playerName: 'Sol', gender: 'male' };
  const options: JourneyOption[] = [{ id: 'location:1', kind: 'location', sourceId: 1, labelKey: 'missing-location-key', fallbackLabel: 'Return to the garden', condition: conditionResult('true'), price: 4, costKey: 'coins' }];
  const planning = renderToStaticMarkup(createElement(ReaderJourney, { journey, catalog, state, profile, snapshot: { ...emptyJourneySnapshot, active: true, phase: 'planning', options, canContinue: false } }));
  assert.ok(planning.includes('Return to the garden') && planning.includes('School Credits'));
  assert.ok(planning.includes('Attribute') && !planning.includes('missing-attribute-key') && !planning.includes('missing-location-key'));
  assert.ok(!planning.includes('data-testid="journey-next-cycle"'));
  const ordinaryComplete = renderToStaticMarkup(createElement(ReaderJourney, { journey, catalog, state, profile, snapshot: { ...emptyJourneySnapshot, active: true, phase: 'complete' } }));
  assert.ok(!ordinaryComplete.includes('data-testid="journey-next-cycle"'));
  const nextCycle = renderToStaticMarkup(createElement(ReaderJourney, { journey, catalog, state, profile, snapshot: { ...emptyJourneySnapshot, active: true, phase: 'complete', nextCycle: true } }));
  assert.ok(nextCycle.includes('data-testid="journey-next-cycle"') && nextCycle.includes('Continue to a new cycle'));
  assert.equal(calls, 0, 'rendering a terminal never starts another cycle');
});

test('normal Go out reaches stage Places after the street, shares the panel options, and returns with live availability without repeating the selected scene', async () => {
  const h = playthroughHarness(), profile = { playerName: 'Sol', gender: 'male' as const };
  const render = () => renderSession({ runner: h.runner, catalog: realCatalog, profile, busy: false, developer: false, journey: h.journey });
  const buttons = (markup: string) => [...markup.matchAll(/<button\b[^>]*data-journey-option="([^"]+)"[^>]*>/g)].filter(match => match[1].startsWith('location:')).map(match => ({ id: match[1], disabled: /\bdisabled=/.test(match[0]) }));
  try {
    await h.start();
    await h.until(() => h.journey.getSnapshot().phase === 'planning' && h.journey.getSnapshot().dayIndex === 2 && h.journey.getSnapshot().timeSlot === 1);
    assert.equal(h.journey.getSnapshot().selectingLocation, false);
    assert.ok(render().includes('data-testid="reader-actions"') && render().includes('data-journey-option="explore:2"'), 'Go out is itself an on-stage decision');
    assert.equal(await h.journey.select('explore:2'), true);
    assert.equal(h.runner.getSnapshot().scriptId, '1006');
    assert.equal(h.journey.getSnapshot().selectingLocation, false);
    assert.ok(!render().includes('data-testid="reader-actions"'), 'the street plays before any destination choices');
    await h.until(() => h.journey.getSnapshot().selectingLocation);
    assert.equal(h.runner.getSnapshot().scriptId, '1006');
    assert.equal(h.runner.getSnapshot().status, 'completed');
    const before = h.runner.getSnapshot(), progress = h.journey.getSnapshot();
    assert.deepEqual(progress.options.filter(o => o.kind === 'location').map(o => [o.id, o.progress, o.target]), [['location:1015', 0, 1], ['location:1016', 0, 1]]);
    const panel = renderToStaticMarkup(createElement(ReaderJourney, { journey: h.journey, snapshot: progress, state: before.storyState, catalog: realCatalog, profile }));
    assert.ok(panel.includes('Finish exploring') && panel.includes('data-testid="journey-continue"'));
    for (let i = 0; i < 3; i++) {
      const markup = render();
      assert.ok(markup.includes('class="choices reader-journey-choices"') && markup.includes('aria-label="Available actions"'));
      assert.ok(markup.includes('Central Square') && markup.includes('School Store'));
      assert.equal(markup.match(/data-testid="place-choice"/g)?.length, 2);
      assert.ok(!markup.includes('data-testid="journey-panel"'), 'the destination step keeps the stage instead of the long planning panel');
      assert.deepEqual(buttons(markup), buttons(panel));
      assert.equal(h.runner.getSnapshot(), before, 'rendering cannot select or revisit a location');
    }
    assert.equal(await h.journey.select('location:1015'), true);
    assert.equal(h.runner.getSnapshot().scriptId, '1008');
    assert.equal(h.journey.getSnapshot().sceneCount, progress.sceneCount + 1);
    assert.equal(await h.journey.select('location:1015'), false, 'a second activation during the scene cannot open it again');
    assert.equal(h.journey.getSnapshot().selectingLocation, false);
    assert.ok(!render().includes('data-testid="reader-actions"'));
    await h.until(() => h.journey.getSnapshot().selectingLocation);
    assert.equal(h.runner.getSnapshot().scriptId, '1008');
    assert.equal(h.runner.getSnapshot().storyState.flowReads['1008'], 1);
    assert.deepEqual(h.journey.getSnapshot().options.filter(o => o.kind === 'location').map(o => [o.id, o.progress, o.target]), [['location:1016', 0, 1]], 'Central Square now follows its authored completed-scene availability');
    assert.equal(h.journey.createCheckpoint()?.journey.locationProgress['1015'], 1);
    const returned = render();
    assert.ok(returned.includes('School Store') && returned.includes(' 0/1'));
    assert.ok(!returned.includes('Central Square') && !returned.includes('data-testid="journey-panel"'));
  } finally { h.dispose(); }
});

test('all planning decisions share source labels, counts, costs and eligibility with School year while retaining the Reader stage', () => {
  let calls = 0;
  const journey = { select: () => { calls++; }, continue: () => { calls++; } } as unknown as StoryPlaythrough;
  const source = { ...emptyStorySource, activity: { Id: 111700001 }, attrs: {}, roles: {} };
  const catalog: EnglishCatalog = { manifest, index: [], speakers: {}, english: { action: 'Choose a source action', owner: 'Abby', description: 'Authored description', credits: 'School Credits', course: 'Attend Humanities' }, report: {}, storySource: source };
  const kinds = ['item', 'reward', 'request', 'behavior', 'locationOption', 'location', 'explore'] as const;
  const options: JourneyOption[] = kinds.map((kind, index) => ({ id: kind + ':' + index, kind, sourceId: index, labelKey: 'action', ownerLabelKey: 'owner', descriptionKey: 'description', progress: index, target: 8, price: 5, costKey: 'credits', condition: conditionResult(index === 1 ? 'false' : index === 2 ? 'unknown' : 'true') }));
  const snapshot: JourneySnapshot = { ...emptyJourneySnapshot, active: true, phase: 'planning', instanceId: 1, canContinue: true, continueLabelKey: 'course', options };
  const profile = { playerName: 'Sol', gender: 'male' }, state = initialStoryState(source);
  const buttons = (markup: string) => [...markup.matchAll(/<button\b[^>]*data-journey-option="([^"]+)"[^>]*>/g)].map(match => ({ id: match[1], disabled: /\bdisabled=/.test(match[0]) }));
  const panel = renderToStaticMarkup(createElement(ReaderJourney, { journey, snapshot, catalog, profile, state }));
  const before = JSON.stringify(snapshot);
  for (let i = 0; i < 3; i++) {
    const stage = renderToStaticMarkup(createElement(ReaderJourneyChoices, { journey, snapshot, catalog, profile }));
    assert.deepEqual(buttons(stage), buttons(panel), 'Stage actions reuse every panel decision and eligibility in the same order.');
    for (const text of ['Choose a source action', 'Abby', 'Authored description', '5 School Credits', 'Requirements unmet', 'Information unavailable', 'Attend Humanities']) assert.ok(stage.includes(text), text);
    assert.equal(stage.match(/class="choice-icon"/g)?.length, 8);
    assert.ok(!stage.includes('<dialog') && !stage.includes('source-label') && !stage.includes('Condition'));
    assert.equal(JSON.stringify(snapshot), before);
  }
  const busy = renderToStaticMarkup(createElement(ReaderJourneyChoices, { journey, snapshot: { ...snapshot, busy: true }, catalog, profile }));
  assert.ok(buttons(busy).every(button => button.disabled), 'Busy actions cannot be dispatched again.');
  const ineligible = renderToStaticMarkup(createElement(ReaderJourneyChoices, { journey, snapshot: { ...snapshot, canContinue: false }, catalog, profile }));
  assert.ok(!ineligible.includes('data-testid="journey-continue"'));
  assert.equal(calls, 0, 'Rerenders dispatch neither selections nor continuation.');
});

test('every interaction action and new-cycle continuation is on stage, with scratch cells kept in their existing stage board', () => {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock, instantTransitions: true });
  const catalog: EnglishCatalog = { manifest, index: [], speakers: {}, english: { action: 'An authored action' }, report: {}, storySource: { ...emptyStorySource, activity: { Id: 111700001 } } };
  runner.load(fixture([node(1)]), manifest); runner.start();
  let progress: JourneySnapshot = { ...emptyJourneySnapshot, active: true, phase: 'interaction' };
  const journey = { getSnapshot: () => progress, subscribe: () => () => {} } as unknown as StoryPlaythrough;
  const cases = [['ending', 'ending'], ['event', 'event'], ['affairs', 'affairs'], ['request', 'request'], ['gift', 'gift'], ['shop', 'shopItem'], ['raffle', 'raffle'], ['scratch', 'scratchSettle']] as const;
  const before = runner.getSnapshot();
  try {
    for (const [kind, action] of cases) {
      progress = { ...progress, interaction: { kind, sourceId: 1 }, options: [{ id: action + ':1', kind: action, sourceId: 1, labelKey: 'action', condition: conditionResult('true') }] };
      const markup = renderSession({ runner, catalog, profile: { playerName: 'Sol', gender: 'male' }, busy: false, developer: false, journey });
      assert.ok(markup.includes('data-testid="reader-actions"') && markup.includes('data-journey-kind="' + action + '"'), kind);
      assert.ok(markup.includes('data-testid="journey-context"') && !markup.includes('<dialog'), kind);
      assert.ok(!markup.includes('data-testid="journey-panel"'));
      if (kind === 'event' || kind === 'ending') assert.ok(!markup.includes('data-journey-control="dismiss"'), 'Required choices cannot be skipped.');
      assert.equal(runner.getSnapshot(), before);
    }
    progress = { ...progress, phase: 'complete', interaction: null, options: [], nextCycle: true };
    const next = renderSession({ runner, catalog, profile: { playerName: 'Sol', gender: 'male' }, busy: false, developer: false, journey });
    assert.ok(next.includes('data-testid="reader-actions"') && next.includes('data-testid="journey-next-cycle"'));
    assert.ok(!next.includes('data-testid="journey-panel"'));
    progress = { ...progress, nextCycle: false };
    assert.ok(!renderSession({ runner, catalog, profile: { playerName: 'Sol', gender: 'male' }, busy: false, developer: false, journey }).includes('data-testid="reader-actions"'), 'A terminal ending does not offer a new school year.');
  } finally { runner.dispose(); }
});

test('Reader scratch ticket reveals only scratched prizes and keeps settlement as a separate action', () => {
  let calls = 0;
  const journey = { select: () => { calls++; } } as unknown as StoryPlaythrough;
  const source = { ...emptyStorySource, scratchTickets: { '1': { Size: 7 } }, attrs: { '1': { Name: 'knowledge' } },
    items: { '10': { Name: 'concealed-prize' } }, rewards: { '1': { RewardType: 0, TargetId: 1, Value: 20 }, '2': { RewardType: 2, TargetId: 10, Value: 999 } } };
  const catalog: EnglishCatalog = { manifest, index: [], speakers: {}, english: { knowledge: 'Knowledge', 'concealed-prize': 'Secret keepsake' }, report: {}, storySource: source };
  const state = { ...initialStoryState(), scratchBoards: { '1': { roundId: 1, rewards: [1, ...Array(48).fill(2)], revealed: { '0': true }, counter: 1, revCounter: 1 } } };
  const options: JourneyOption[] = [...Array.from({ length: 48 }, (_, i) => ({ id: `scratchReveal:${i + 1}`, kind: 'scratchReveal' as const, sourceId: i + 1, labelKey: '', fallbackLabel: `Scratch row ${Math.floor((i + 1) / 7) + 1}, column ${(i + 1) % 7 + 1}`, condition: conditionResult('true') })),
    { id: 'scratchSettle', kind: 'scratchSettle', sourceId: 1, labelKey: '', fallbackLabel: 'Receive prizes', condition: conditionResult('false') }];
  const markup = renderToStaticMarkup(createElement(ReaderJourneyInteraction, { id: 'scratch', journey, state, catalog, profile: { playerName: 'Sol', gender: 'male' }, snapshot: { ...emptyJourneySnapshot, active: true, phase: 'interaction', options, interaction: { kind: 'scratch', sourceId: 1, requiresChoice: true } } }));
  assert.equal(markup.match(/data-testid="scratch-cell"/g)?.length, 49);
  assert.ok(markup.includes('Knowledge') && markup.includes('+20'));
  assert.ok(!markup.includes('Secret keepsake') && !markup.includes('999'), 'unrevealed source rewards cannot leak through the Reader');
  assert.ok(markup.includes('Receive prizes') && !markup.includes('data-testid="journey-confirm"'));
  const onStage = renderToStaticMarkup(createElement(ReaderJourneyInteraction, { id: 'scratch', journey, state, catalog, profile: { playerName: 'Sol', gender: 'male' }, snapshot: { ...emptyJourneySnapshot, active: true, phase: 'interaction', options, interaction: { kind: 'scratch', sourceId: 1, requiresChoice: true } }, onStage: true }));
  assert.equal(onStage.match(/data-testid="scratch-cell"/g)?.length, 49);
  assert.ok(!onStage.includes('Secret keepsake') && !onStage.includes('Receive prizes') && !onStage.includes('<dialog'), 'The stage board reveals no hidden prize and leaves settlement to the right-side list.');
  assert.equal(calls, 0, 'rendering a scratched board cannot receive prizes');
});

test('Reader receipts stay with stage interactions and native reward confirmations exactly once without applying another grant', () => {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock, instantTransitions: true });
  const source = { ...emptyStorySource, activity: { Id: 111700001 }, attrs: { '1': { Name: 'earlier', InitValue: 0, MinValue: 0, MaxValue: 99 } }, roles: {}, items: { '10': { Name: 'keepsake', StackLimit: 99 } },
    rewards: { '1': { Id: 1, RewardType: 2, TargetId: 10, Value: 1 }, '2': { Id: 2, RewardType: 0, TargetId: 1, Value: 1 } }, rewardGroups: { '1': { Id: 1, RewardIds: [1] }, '2': { Id: 2, RewardIds: [2] } } };
  const catalog: EnglishCatalog = { manifest, index: [], speakers: {}, english: { keepsake: 'A keepsake', earlier: 'Earlier gain' }, report: {}, storySource: source };
  runner.load(fixture([node(1)]), manifest, { storySource: source, initializeStory: true }); runner.start();
  const presentations = new ReaderPresentations(runner, clock);
  runner.applyStoryEffect(applyRewardGroup(runner.getSnapshot().storyState, 2, source));
  runner.applyStoryEffect(applyRewardGroup(runner.getSnapshot().storyState, 1, source));
  const before = runner.getSnapshot();
  let progress: JourneySnapshot = { ...emptyJourneySnapshot, active: true, phase: 'interaction', interaction: { kind: 'shop', sourceId: 1 } };
  const journey = { getSnapshot: () => progress, subscribe: () => () => {} } as unknown as StoryPlaythrough;
  try {
    for (const kind of ['shop', 'gift', 'raffle', 'event'] as const) {
      progress = { ...progress, interaction: { kind, sourceId: 1 } };
      const markup = renderSession({ runner, catalog, profile: { playerName: 'Sol', gender: 'male' }, busy: false, developer: false, journey, presentations });
      assert.equal(markup.match(/data-testid="reader-consequences"/g)?.length, 1, `${kind}: one live receipt region`);
      const start = markup.indexOf('data-testid="journey-context"'), end = markup.indexOf('class="reader-toolbar"', start), receipt = markup.indexOf('data-testid="consequence-item"');
      assert.ok(start >= 0 && receipt > start && receipt < end, `${kind}: receipt is in the on-stage context`);
      assert.ok(!markup.includes('<dialog'), `${kind}: choosing does not open a separate panel`);
      assert.ok(markup.includes('Received') && markup.includes('A keepsake') && markup.includes('+1'));
      assert.ok(markup.indexOf('A keepsake') < markup.indexOf('Earlier gain'), 'A new stage receipt stays ahead of older gains in the compact region.');
      assert.equal(runner.getSnapshot(), before);
      assert.equal(runner.getSnapshot().storyState.items['10'].min, 1);
    }
    for (const kind of ['requestDone', 'requestFailed'] as const) {
      progress = { ...progress, interaction: { kind, sourceId: 1 } };
      const markup = renderSession({ runner, catalog, profile: { playerName: 'Sol', gender: 'male' }, busy: false, developer: false, journey, presentations });
      const start = markup.indexOf('<dialog'), end = markup.indexOf('</dialog>', start), receipt = markup.indexOf('data-testid="consequence-item"');
      assert.ok(start >= 0 && receipt > start && receipt < end, `${kind}: confirmation keeps its original native boundary`);
      assert.ok(!markup.includes('data-testid="reader-actions"'));
      assert.equal(runner.getSnapshot(), before);
    }
    progress = { ...progress, phase: 'planning', interaction: null };
    const planning = renderSession({ runner, catalog, profile: { playerName: 'Sol', gender: 'male' }, busy: false, developer: false, journey, presentations });
    assert.ok(planning.includes('reader-planning-consequences'), 'planning receipts attach to the viewport alongside stage actions');
    assert.equal(planning.match(/data-testid="reader-consequences"/g)?.length, 1);
    assert.equal(runner.getSnapshot(), before);
  } finally { presentations.dispose(); runner.dispose(); }
});

// Earlier presentation checks use instant text; their engine/stage assertions
// stay independent of the new text clock. Dedicated checks below retain it.
function renderSession(props: { runner: ScriptRunner; catalog: EnglishCatalog | null; profile: PlayerTextProfile; busy: boolean; [key: string]: unknown }): string {
  const reading = new ManualReader(props.runner, { instantText: true, inputDebounceMs: 0 });
  const backlog = new DialogueBacklog(props.runner);
  reading.setTextContext(props.catalog?.english ?? {}, props.profile);
  backlog.setTextContext(props.catalog?.english ?? {}, props.catalog?.speakers ?? {}, props.profile);
  try { return renderToStaticMarkup(createElement(ReaderSession, { developer: true, ...props, reading, backlog })); }
  finally { backlog.dispose(); reading.dispose(); }
}

test('reader/debug projection shares the engine and keeps technical labels and hidden controls out of the reader', () => {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock });
  const catalog: EnglishCatalog = { manifest, index: [], speakers: {}, english: { 'line-1': 'A long line. '.repeat(120) }, report: {} };
  // Keep the intended unresolved import fixture under first-eligible authored
  // precedence: an earlier unknown blocks its unconditional fallback.
  runner.load(fixture([node(1, { stage: [{ op: 'enter', who: '999', expr: 99999, t: .1 }], options: [option({ textKey: 'empty-hidden-key', preCondition: { Type: 'Unknown' } }), option()], raw: { OptionInteractionType: 'HideAndAutoSelect' } })]), manifest); runner.start();
  clock.advanceBy(200);
  const before = runner.getSnapshot();
  for (const developer of [false, true, false, true, false]) {
    const markup = renderSession({ runner, catalog, profile: { playerName: 'Sol', gender: 'male' }, busy: false, developer, developerHref: '/debug?script=fixture' });
    assert.equal(runner.getSnapshot(), before, 'view rendering cannot start another visit or engine');
    assert.equal(markup.includes('class="debug-panel"'), developer);
    assert.equal(markup.includes('data-testid="hidden-choice-override"'), developer);
    assert.equal(markup.includes('Stage who 999'), developer);
    assert.equal(markup.includes('Expression 99999'), developer);
    assert.equal(markup.includes('data-testid="settings"'), !developer);
    if (!developer) {
      assert.ok(markup.includes('href="/debug?script=fixture"'));
      assert.ok(!markup.includes('empty-hidden-key'));
      assert.ok(!markup.includes('Script fixture'));
      assert.ok(!markup.includes('provisional placement'));
    }
    assert.ok(!markup.includes('data-testid="choice"'), 'hidden options are never ordinary responses');
  }
  runner.dispose();
});

test('reader masks unavailable English and asset metadata while preserving readable ordinary choice labels', () => {
  const runner = new ScriptRunner({ instantTransitions: true });
  const catalog: EnglishCatalog = { manifest, index: [], speakers: {}, english: { response: 'Keep going.' }, report: {} };
  runner.load(fixture([node(1, { stage: [{ op: 'bg', id: 800001, mode: 'Load', t: 0 }], options: [option({ textKey: 'internal-key' }), option({ textKey: 'response' })] })]), manifest); runner.start();
  const markup = renderSession({ runner, catalog, profile: { playerName: 'Sol', gender: 'male' }, busy: false, developer: false });
  assert.ok(markup.includes('Text unavailable.'));
  assert.ok(markup.includes('Response unavailable.'));
  assert.ok(markup.includes('Keep going.'));
  assert.ok(!markup.includes('internal-key'));
  assert.ok(!markup.includes('[Missing English'));
  assert.ok(!markup.includes('class="stage-caption"'));
  runner.dispose();
});

test('Reader honors authored choice hiding and replacement text without exposing condition traces; rerendering cannot change eligibility', async () => {
  const readData = async (path: string) => JSON.parse(await readFile(new URL(`../public/data/${path}`, import.meta.url), 'utf8'));
  const source = validateStorySource(await readData('maps/story-source.json'));
  const endingScript = await readData('scripts/3011.json') as Script;
  const gated = endingScript.nodes.find(n => n.nid === 20)!.options!.find(o => o.optionId === 3)!;
  const outingScript = await readData('scripts/16001.json') as Script;
  const concealed = outingScript.nodes.find(n => n.nid === 4)!.options!.find(o => o.optionId === 5)!;
  const english = { response: 'The original response.', concealed: 'An unlocked outing.', quiet: 'A quiet response.', ordinary: 'Continue.', ...await readData('locales/en.json') };
  assert.equal(english.TalkOptionUnmetReplaceText_1, 'You #? going back $&?');
  const catalog: EnglishCatalog = { manifest, index: [], speakers: {}, english, report: {}, storySource: source };
  const runner = new ScriptRunner({ instantTransitions: true });
  runner.load(fixture([node(1, { options: [
    option({ optionId: 3, textKey: 'response', preCondition: gated.preCondition }),
    option({ optionId: 5, textKey: 'concealed', preCondition: concealed.preCondition }),
    option({ optionId: 6, textKey: 'quiet', preCondition: { ...(gated.preCondition as Record<string, unknown>), TidReplaceTextWhenUnmet: null, HideConditionTextWhenUnmet: true } }),
    option({ optionId: 8, textKey: 'ordinary' }),
  ] })]), manifest, { storySource: source, initializeStory: true }); runner.start();
  try {
    const render = (developer = false) => renderSession({ runner, catalog, profile: { playerName: 'Sol', gender: 'male' }, busy: false, developer });
    const before = runner.getSnapshot();
    for (let i = 0; i < 3; i++) {
      const markup = render();
      assert.equal(markup.match(/data-testid="choice"/g)?.length, 3);
      assert.ok(markup.includes('You #? going back $&amp;?'));
      assert.ok(!markup.includes('The original response.') && !markup.includes('An unlocked outing.'));
      assert.equal(markup.match(/Requirements unmet/g)?.length, 1, 'HideConditionTextWhenUnmet suppresses its own requirement label');
      assert.ok(markup.includes('A quiet response.') && markup.includes('Continue.'));
      assert.ok(!markup.includes('ConditionGroupId') && !markup.includes('29000036'));
      assert.equal(runner.getSnapshot(), before);
    }
    const debug = render(true);
    assert.equal(debug.match(/data-testid="choice"/g)?.length, 4);
    assert.ok(debug.includes('The original response.') && debug.includes('An unlocked outing.') && debug.includes('ConditionGroupId'));
    assert.equal(runner.getSnapshot(), before);
    runner.applyStoryEffect(storyEffect({ ...before.storyState, playthroughCount: 2, favor: { ...before.storyState.favor, '10': { unlocked: true, level: 1, points: 0 } } }));
    const available = render();
    assert.equal(available.match(/data-testid="choice"/g)?.length, 4);
    assert.ok(available.includes('The original response.') && available.includes('An unlocked outing.'));
    assert.ok(!available.includes('You #? going back') && !available.includes('Requirements unmet'));
    assert.equal(runner.getSnapshot().choiceHistory.length, 0);
  } finally { runner.dispose(); }
});

test('React selects source Rover gender resources without changing literal expressions, visibility or text substitution', () => {
  const runner = new ScriptRunner({ instantTransitions: true });
  const catalog: EnglishCatalog = { manifest, index: [], english: { 'line-1': 'Hello {PlayerName}, {Male=he;Female=she}.' }, speakers: {}, report: {} };
  runner.load(fixture([
    node(1, { stage: [{ op: 'enter', who: '750088', expr: 700131, hidePortrait: true, hideAvatar: false, t: 0 }] }),
    node(2, { stage: [{ op: 'modify', who: '750088', expr: 700127, hidePortrait: false, t: 0 }] }),
    node(3, { stage: [{ op: 'modify', who: '750088', expr: 700128, t: 0 }] }),
  ]), manifest); runner.start();
  try {
    const render = (gender: 'male' | 'female') => renderSession({ runner, catalog, assets: changliAssets, profile: { playerName: 'Sol', gender }, busy: false });
    const snapshot = runner.getSnapshot();
    for (const gender of ['male', 'female'] as const) {
      const markup = render(gender);
      assert.ok(markup.includes(`Hello Sol, ${gender === 'male' ? 'he' : 'she'}.`));
      assert.ok(markup.includes(`data-testid="rover-${gender}-canvas"`));
      assert.ok(!markup.includes(`data-testid="rover-${gender === 'male' ? 'female' : 'male'}-canvas"`));
      assert.ok(markup.includes('data-testid="avatar-placeholder"'));
      assert.ok(!markup.includes('data-testid="character-placeholder"'));
      assert.ok(markup.includes('expr 700131'));
      assert.equal(runner.getSnapshot(), snapshot);
    }
    runner.advance();
    for (const [gender, talkerId] of [['male', 850001], ['female', 850002]] as const) {
      const markup = render(gender);
      assert.ok(markup.includes(`data-who="750088" data-expression="700127" data-talker="${talkerId}"`));
      assert.equal((markup.match(/data-testid="character-placeholder"/g) ?? []).length, 1);
    }
    runner.advance();
    assert.ok(render('female').includes('source expression 700128 references absent skeleton clips after gender resource selection: dongzuo1_yansu_zui'));
    assert.ok(render('male').includes('Source expression 700128 references absent skeleton clips: dongzuo1_yansu_zui'));
    assert.equal(runner.getSnapshot().stageState.characters['750088'].expression, 700128);
  } finally { runner.dispose(); }
});

test('unresolved Rover avatars keep their exact missing-channel diagnosis in Debug without a Reader placeholder card', () => {
  const runner = new ScriptRunner({ instantTransitions: true });
  const catalog: EnglishCatalog = { manifest, index: [], english: { 'line-1': 'You can talk?' }, speakers: {}, report: {} };
  runner.load(fixture([node(1, { speakerId: '750088', stage: [{ op: 'enter', who: '750088', expr: 700133, hidePortrait: true, hideAvatar: false, effect: 'Darken', t: 0 }] })]), manifest); runner.start();
  try {
    const snapshot = runner.getSnapshot();
    for (const gender of ['male', 'female'] as const) {
      const props = { runner, catalog, assets: changliAssets, profile: { playerName: 'Sol', gender }, busy: false };
      const reader = renderSession({ ...props, developer: false });
      assert.ok(reader.includes('data-testid="speaker-avatar"'));
      assert.ok(reader.includes('data-expression="700133"'));
      assert.ok(!reader.includes('Portrait unavailable')); assert.ok(!reader.includes('data-testid="character-placeholder"'));
      const debug = renderSession({ ...props, developer: true });
      assert.ok(debug.includes('data-testid="avatar-asset-resolution"'));
      assert.ok(debug.includes(`data-resource="rover-${gender}"`));
      assert.ok(debug.includes('dongzuo1_yansu_zui'));
      assert.equal(runner.getSnapshot(), snapshot, 'Fallback presentation does not drive the engine.');
    }
  } finally { runner.dispose(); }
});

test('normal Reader 1001/1→7 projects bright Rover avatars with a documented female fallback and clears them at /9', async () => {
  const read = async (path: string) => JSON.parse(await readFile(new URL(`../public/data/${path}`, import.meta.url), 'utf8'));
  const [realManifest, speakers, english, script] = await Promise.all([
    read('manifest.json'), read('speakers.json'), read('locales/en.json'), read('scripts/1001.json'),
  ]);
  const catalog: EnglishCatalog = { manifest: realManifest, index: [], speakers, english, report: {} };
  const clock = new FakeClock(), runner = new ScriptRunner({ clock, instantTransitions: false });
  assert.equal(runner.load(script, realManifest), true); assert.equal(runner.start(), true);
  try {
    assert.equal(runner.getSnapshot().nid, 1);
    while (runner.getSnapshot().nid !== 7) { clock.advanceBy(2000); assert.equal(runner.advance(), true); }
    clock.advanceBy(1000);
    const snapshot = runner.getSnapshot();
    for (const gender of ['male', 'female'] as const) {
      const props = { runner, catalog, assets: changliAssets, profile: { playerName: 'Sol', gender }, busy: false };
      const reader = renderSession({ ...props, developer: false });
      assert.ok(reader.includes('data-expression="700131"'));
      assert.ok(reader.includes(`data-render-expression="${gender === 'female' ? '700056' : '700131'}"`));
      assert.ok(reader.includes('data-avatar-brightness="1"'));
      assert.equal((reader.match(/data-testid="speaker-avatar"/g) ?? []).length, 1);
      assert.ok(reader.includes(`data-testid="rover-${gender}-canvas"`));
      assert.ok(!reader.includes(`data-testid="rover-${gender === 'female' ? 'male' : 'female'}-canvas"`));
      assert.ok(!reader.includes('Reader avatar fallback'), 'Fallback explanation belongs in Debug.');
      const debug = renderSession({ ...props, developer: true });
      assert.equal(debug.includes('Reader avatar fallback'), gender === 'female');
      if (gender === 'female') assert.ok(debug.toLowerCase().includes('native missing-clip behavior is unverified'));
      assert.equal(runner.getSnapshot(), snapshot, 'Avatar projection cannot mutate playback or authored Darken.');
    }
    assert.equal(snapshot.stageState.characters['750088'].effect, 'Darken');
    assert.equal(snapshot.stageState.characters['750088'].expression, 700131);
    while (runner.getSnapshot().nid !== 9) { clock.advanceBy(6000); assert.equal(runner.advance(), true); }
    clock.advanceBy(2000);
    for (const gender of ['male', 'female'] as const) {
      const markup = renderSession({ runner, catalog, assets: changliAssets, profile: { playerName: 'Sol', gender }, busy: false, developer: false });
      assert.ok(!markup.includes('data-testid="speaker-avatar"'));
    }
  } finally { runner.dispose(); }
});

test('Reader projects Abby avatar from 1002/23 authored flags and removes it at /24; 1001 keeps its separate hidden-avatar sequence', async () => {
  const read = async (path: string) => JSON.parse(await readFile(new URL(`../public/data/${path}`, import.meta.url), 'utf8'));
  const [realManifest, speakers, english, script1001, script1002] = await Promise.all([
    read('manifest.json'), read('speakers.json'), read('locales/en.json'), read('scripts/1001.json'), read('scripts/1002.json'),
  ]);
  const catalog: EnglishCatalog = { manifest: realManifest, index: [], speakers, english, report: {} };
  for (const script of [script1002, script1001]) {
    const clock = new FakeClock(), runner = new ScriptRunner({ clock, instantTransitions: true });
    assert.equal(runner.load(script, realManifest), true); assert.equal(runner.start(), true);
    const reach = (nid: number) => {
      for (let step = 0; step < 100; step++) {
        const snapshot = runner.getSnapshot();
        if (snapshot.nid === nid && ['dialogue', 'choices'].includes(snapshot.status)) return;
        clock.advanceBy(1500);
        assert.notEqual(snapshot.status, 'error', snapshot.error?.message ?? 'Unexpected runner error');
        assert.notEqual(snapshot.status, 'completed', `Completed before ${script.id}/${nid}`);
        if (snapshot.status === 'running' || snapshot.status === 'ending') continue;
        assert.equal(snapshot.status === 'choices' ? runner.choose(0) : runner.advance(), true);
      }
      assert.fail(`Did not reach ${script.id}/${nid}`);
    };
    try {
      for (const nid of script.id === '1002' ? [23, 24] : [9, 10]) {
        reach(nid);
        const before = runner.getSnapshot();
        const markup = renderSession({ runner, catalog, assets: changliAssets, profile: { playerName: 'Rover', gender: 'male' }, busy: false, developer: false });
        const avatar = markup.match(/<div class="speaker-avatar"[^>]*>/g) ?? [];
        if (script.id === '1002' && nid === 23) {
          assert.equal(avatar.length, 1);
          assert.ok(avatar[0].includes('data-who="1316"'));
          assert.ok(avatar[0].includes('data-expression="700226"'));
        } else assert.equal(avatar.length, 0, `No avatar at ${script.id}/${nid}, despite Abby being the speaker.`);
        assert.ok(markup.includes('data-testid="abby-canvas"'));
        assert.equal(runner.getSnapshot(), before, 'Rendering Reader cannot replay Enter or change authored visibility.');
      }
    } finally { runner.dispose(); assert.equal(clock.pendingTimers, 0); }
  }
});

test('actual React stage labels local Changli loading/provenance and missing mappings without blocking dialogue or other placeholders', () => {
  const runner = new ScriptRunner({ instantTransitions: true });
  const catalog: EnglishCatalog = { manifest, index: [], english: { 'line-1': 'Hello {PlayerName}.', choice: 'Continue' }, speakers: {}, report: {} };
  runner.load(fixture([node(1, { stage: [
    { op: 'enter', who: '999', expr: 700048, t: 0 },
    { op: 'enter', who: '1475', expr: 700113, t: 0 },
  ], options: [option({ next: { type: 'end' } })] })]), manifest);
  runner.start();
  try {
    const snapshot = runner.getSnapshot();
    const render = (assets = changliAssets) => renderSession({ runner, catalog, assets, profile: { playerName: 'Sol', gender: 'female' }, busy: false });
    const loading = render();
    assert.ok(loading.includes('Hello Sol.'));
    assert.ok(loading.includes('data-testid="choice"'));
    assert.ok(loading.includes('data-testid="changli-canvas"'));
    assert.ok(loading.includes('data-texture-origin="WebP-derived PNG; not a game export"'));
    assert.ok(loading.includes('data-calibration="provisional"'));
    assert.ok(loading.includes('Loading local Changli portrait…'));
    assert.equal((loading.match(/data-testid="character-placeholder"/g) ?? []).length, 2);
    assert.ok(loading.includes('data-who="1475" data-expression="700113"'));
    const incomplete = render({ ...changliAssets, manifest: { ...changliAssets.manifest, talkers: {} } });
    assert.ok(incomplete.includes('Changli source assets are missing'));
    assert.ok(incomplete.includes('Hello Sol.')); assert.ok(incomplete.includes('data-testid="choice"'));
    assert.equal(runner.getSnapshot(), snapshot, 'Rendering loading/fallback states cannot drive the runner.');
    assert.equal(runner.choose(0), true); assert.equal(runner.getSnapshot().status, 'completed');
  } finally { runner.dispose(); }
});

test('actual React stage gives Chisa and Abby separate canvases and one named loading/fallback per portrait', () => {
  const runner = new ScriptRunner({ instantTransitions: true });
  const catalog: EnglishCatalog = { manifest, index: [], english: { 'line-1': 'The school day continues.' }, speakers: {}, report: {} };
  runner.load(fixture([node(1, { stage: [
    { op: 'enter', who: '50179', expr: 700152, t: 0 },
    { op: 'enter', who: '1316', expr: 700212, t: 0 },
    { op: 'enter', who: '1475', expr: 700113, t: 0 },
  ] })]), manifest); runner.start();
  try {
    const render = (assets = changliAssets) => renderSession({ runner, catalog, assets, profile: { playerName: 'Sol', gender: 'female' }, busy: false });
    const snapshot = runner.getSnapshot(), markup = render();
    assert.equal((markup.match(/data-testid="chisa-canvas"/g) ?? []).length, 1);
    assert.equal((markup.match(/data-testid="abby-canvas"/g) ?? []).length, 1);
    assert.equal((markup.match(/data-testid="character-placeholder"/g) ?? []).length, 3);
    assert.ok(markup.includes('Loading local Chisa portrait…')); assert.ok(markup.includes('Loading local Abby portrait…'));
    const missing = render({ ...changliAssets, manifest: { ...changliAssets.manifest, talkers: {} } });
    assert.ok(missing.includes('Chisa source assets are missing')); assert.ok(missing.includes('Abby source assets are missing'));
    assert.ok(missing.includes('The school day continues.')); assert.equal(runner.getSnapshot(), snapshot);
  } finally { runner.dispose(); }
});

test('actual quiz view renders full formatted text, stable answer order, result and Continue without replaying dialogue/stage/history', () => {
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock });
  const reading = new ManualReader(runner, { clock, textSpeed: 5, inputDebounceMs: 0 });
  const backlog = new DialogueBacklog(runner);
  const profile = { playerName: 'Sol é 👩🏽‍🚀', gender: 'female' } as const;
  const catalog: EnglishCatalog = { manifest, index: [], speakers: {}, report: {}, english: {
    'line-1': 'Previous dialogue stays in history.', 'line-2': 'Next dialogue.',
    'quiz-title': '<i>Quiz</i>', 'quiz-question': '<b>Question</b> for {PlayerName}: {Male=he;Female=she}.',
    'answer-yes': '<u>Yes</u>', 'answer-no': 'No', 'answer-other': 'Other',
  } };
  reading.setTextContext(catalog.english, profile); backlog.setTextContext(catalog.english, {}, profile);
  runner.load(fixture([node(1, { stage: [quizOperation(), { op: 'bg', mode: 'Load', id: 10, t: .5 }] }), node(2)]), manifest);
  runner.start();
  const opened = runner.getSnapshot();
  const entries = backlog.getSnapshot();
  const render = () => renderToStaticMarkup(createElement(ReaderSession, { runner, reading, backlog, catalog, profile, busy: false }));
  for (let i = 0; i < 5; i++) {
    const markup = render();
    assert.ok(markup.includes('<em>Quiz</em>'));
    assert.ok(markup.includes('<strong>Question</strong>'));
    assert.ok(markup.includes('Sol é 👩🏽‍🚀: she.'));
    assert.deepEqual([...markup.matchAll(/data-testid="quiz-answer" data-answer-id="(\d+)"/g)].map(match => Number(match[1])), [21, 8, 45]);
    assert.ok(markup.includes('data-testid="quiz-illustration-fallback"'));
    assert.ok(!markup.includes('data-testid="dialogue-text-area"'));
    assert.ok(!markup.includes('data-testid="quiz-continue"'));
    assert.match(markup, /disabled="" data-testid="advance"/);
    assert.equal(runner.getSnapshot(), opened);
    assert.equal(backlog.getSnapshot(), entries);
  }
  runner.answerQuiz(8, opened.quiz!);
  const selected = runner.getSnapshot();
  const result = render();
  assert.match(result, /data-testid="quiz-result" data-result="correct">Correct\./);
  assert.ok(result.includes('data-testid="quiz-continue"'));
  assert.equal((result.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.equal((result.match(/disabled="" data-testid="quiz-answer"/g) ?? []).length, 3);
  assert.equal(runner.getSnapshot(), selected);
  assert.equal(backlog.getSnapshot(), entries);
  runner.continueQuiz(selected.quiz!);
  assert.equal(runner.getSnapshot().nid, 1, 'start quiz returns to its existing line');
  assert.equal(reading.getSnapshot().complete, false);
  assert.equal(reading.advance(), 'revealed');
  assert.equal(runner.getSnapshot().pendingStage.length, 1, 'revealing text does not settle stage');
  assert.equal(reading.advance(), 'advanced');
  assert.equal(runner.getSnapshot().nid, 2);
  assert.equal(backlog.getSnapshot().length, 2);
  assert.equal(runner.getSnapshot().stageEvents.length, 2);
  backlog.dispose(); reading.dispose(); runner.dispose();
});

test('quiz controls disable behind History and missing/broken illustrations retain labeled fallback', () => {
  const runner = new ScriptRunner({ instantTransitions: true });
  runner.load(fixture([node(1, { kind: 'silent', textKey: null, stage: [quizOperation()] })]), manifest); runner.start();
  const opened = runner.getSnapshot();
  let commands = 0;
  const props = {
    quiz: opened.quiz!, english: { 'quiz-question': 'Question?', 'answer-yes': 'Yes' },
    profile: { playerName: 'Rover', gender: 'male' }, assets: emptyVisualAssets,
    failedUrls: new Set<string>(), inputReady: true, historyOpen: true,
    answer: () => commands++, continueQuiz: () => commands++, onImageError: () => commands++,
  };
  const history = renderToStaticMarkup(createElement(QuizView, props));
  assert.equal((history.match(/disabled="" data-testid="quiz-answer"/g) ?? []).length, 3);
  assert.ok(history.includes('aria-label="Question illustration unavailable"'));
  runner.answerQuiz(8, opened.quiz!);
  const result = renderToStaticMarkup(createElement(QuizView, { ...props, quiz: runner.getSnapshot().quiz! }));
  assert.match(result, /disabled="" data-testid="quiz-continue"/);
  assert.equal(commands, 0);
  runner.restart();
  assert.equal(runner.getSnapshot().quiz?.selectedAnswerId, null);
  runner.dispose();
});

test('unresolved quiz view exposes only the explicit debug test override and no premature Continue', () => {
  const runner = new ScriptRunner({ instantTransitions: true });
  const definition = quizFixture({ illustration: null, answers: [{ id: 21, textKey: 'answer-yes', correct: null }] });
  runner.load(fixture([node(1, { kind: 'silent', textKey: null, stage: [quizOperation(definition)] })]), manifest); runner.start();
  runner.answerQuiz(21, runner.getSnapshot().quiz!);
  const markup = renderSession({ runner, catalog: null, profile: { playerName: 'Rover', gender: 'male' }, busy: false });
  assert.ok(markup.includes('data-testid="quiz-unresolved"'));
  assert.equal((markup.match(/data-testid="quiz-result-override"/g) ?? []).length, 2);
  assert.ok(!markup.includes('data-testid="quiz-continue"'));
  assert.ok(!markup.includes('data-testid="quiz-illustration-fallback"'), 'no illustration reference needs no fallback');
  assert.equal(runner.getSnapshot().quiz?.result, null);
  runner.dispose();
});

test('actual React player renders preserve start/end lifecycle through profile changes and completion', () => {
  const runner = new ScriptRunner({ instantTransitions: true });
  const catalog: EnglishCatalog = {
    manifest, index: [], english: { 'line-9': 'Hello {PlayerName}, {Male=he;Female=she}.', choice: 'Finish' },
    speakers: { '999': { nameKey: null, talkerId: null } }, report: {},
  };
  runner.load(fixture([node(9, {
    stage: [{ op: 'enter', who: '999', t: 0.5, fadeIn: 0.2 }, { op: 'exit', who: '999', t: 1.25, phase: 'end', fadeOut: 0.3 }],
    options: [option({ next: { type: 'end' } })],
  })]), manifest);
  runner.start();
  const initial = runner.getSnapshot();
  const render = (profile: PlayerTextProfile) => renderSession({ runner, catalog, profile, busy: false });
  for (const profile of [{ playerName: 'Sol', gender: 'male' }, { playerName: 'Luna', gender: 'female' }, { playerName: 'Rover', gender: 'male' }] as const) {
    const markup = render(profile);
    assert.ok(markup.includes(`Hello ${profile.playerName}, ${profile.gender === 'male' ? 'he' : 'she'}.`));
    assert.equal((markup.match(/data-testid="stage-event"/g) ?? []).length, 1);
    assert.equal(markup.includes('data-phase="end"'), false);
    assert.equal(runner.getSnapshot(), initial, 'Rendering mutated the engine snapshot');
    assert.equal(initial.stageState.appliedEvents, 1);
  }
  assert.equal(runner.getSnapshot().choiceHistory.length, 0);
  runner.choose(0);
  const completed = runner.getSnapshot();
  for (let i = 0; i < 5; i++) {
    const markup = render({ playerName: `Rover ${i}`, gender: 'female' });
    assert.ok(markup.includes('Script fixture completed.'));
    assert.equal((markup.match(/data-testid="stage-event"/g) ?? []).length, 2);
    assert.equal((markup.match(/data-phase="end"/g) ?? []).length, 1);
    assert.equal(runner.getSnapshot(), completed);
    assert.equal(completed.stageState.appliedEvents, 2);
  }
  assert.equal(completed.stageEvents[1].operation.t, 1.25);
  assert.equal(completed.choiceHistory.length, 1);
});

test('timed React renders read pending/applied state and fading ghosts without scheduling or replaying operations', () => {
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock });
  const catalog: EnglishCatalog = { manifest, index: [], english: { 'line-1': 'Hello {PlayerName}.', choice: 'Finish' }, speakers: {}, report: {} };
  runner.load(fixture([node(1, { stage: [
    { op: 'enter', who: '500', fadeIn: .5, t: .25 },
    { op: 'exit', who: '500', fadeOut: .5, t: .25, phase: 'end' },
  ], options: [option({ next: { type: 'end' } })] })]), manifest);
  runner.start();
  const render = (name: string) => renderSession({ runner, catalog, profile: { playerName: name, gender: 'male' }, busy: false });
  let snapshot = runner.getSnapshot();
  for (const name of ['Rover', 'Sol', 'Luna']) {
    const markup = render(name);
    assert.ok(markup.includes(`Hello ${name}.`));
    assert.ok(!markup.includes('data-testid="stage-event"'));
    assert.equal(runner.getSnapshot(), snapshot);
  }
  clock.advanceBy(250);
  snapshot = runner.getSnapshot();
  assert.equal(snapshot.stageState.characters['500'].present, true);
  for (let i = 0; i < 3; i++) {
    const markup = render(`Rover ${i}`);
    assert.ok(markup.includes('data-opacity="0.0000"'));
    assert.equal((markup.match(/data-testid="stage-event"/g) ?? []).length, 1);
    assert.equal(runner.getSnapshot(), snapshot);
  }
  clock.advanceBy(500);
  runner.choose(0);
  assert.ok(render('Sol').includes('data-testid="ending-notice"'));
  clock.advanceBy(250);
  snapshot = runner.getSnapshot();
  assert.equal(snapshot.status, 'completed');
  assert.equal(snapshot.stageState.characters['500'].present, false);
  for (let i = 0; i < 3; i++) {
    const markup = render('Luna');
    assert.ok(markup.includes('data-testid="character-placeholder"'), 'Applied exits retain a temporary visual ghost');
    assert.equal((markup.match(/data-phase="end"/g) ?? []).length, 1);
    assert.equal(runner.getSnapshot(), snapshot);
  }
  clock.advanceBy(1000);
  assert.ok(!render('Sol').includes('data-testid="character-placeholder"'));
  assert.equal(runner.getSnapshot().stageEvents.length, 2);
  runner.dispose();
});

test('React keeps 1004/1 hidden option keys out of dialogue controls and schedules an explicit override once', () => {
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock });
  const times = [0, .05, .1, .15, .2];
  const activities = [5911, 5913, 5911, 5914, 5911];
  // Source option IDs, conditions and timings from real 1004/1, with small
  // synthetic dialogue text. Real-data tests also compare the full raw export.
  const hiddenOptions = [11, 12].map((optionId, index): ScriptOption => {
    const rawPerformances = (index === 0 ? activities : [5911]).map((actionId, order) => ({
      Type: 'ActivityAction', StartTime: times[order],
      ActivityActionConfig: { Type: 'SolarSchool', SolarSchoolActionId: actionId },
    }));
    const preCondition = index === 0 ? { Type: 'SystemCondition', System: { Type: 'SolarSchool', ConditionGroupId: 26100048 } } : undefined;
    const typeParams = { Type: 'VisualNovel', PlotOptionId: optionId, OptionPerformances: rawPerformances };
    const textKey = `Flow_318000000_${3450 + index}`;
    return option({ textKey, optionId, typeParams,
      ...(preCondition ? { preCondition } : {}),
      raw: { TidTalkOption: textKey, TypeParams: typeParams, ...(preCondition ? { PreCondition: preCondition } : {}) },
      performances: rawPerformances.map(source => ({
        op: 'activityAction', phase: 'option', t: source.StartTime,
        kind: 'SolarSchool', actionId: source.ActivityActionConfig.SolarSchoolActionId, raw: source,
      })),
    });
  });
  const catalog: EnglishCatalog = {
    manifest, index: [], speakers: {}, report: {}, english: {
      'line-1': 'Hello {PlayerName}.', 'line-2': 'Choose an ordinary response.', 'line-90': 'The next talk.',
      Flow_318000000_3450: '', Flow_318000000_3451: '', finish: 'Finish this talk.',
    },
  };
  assert.equal(runner.load({ ...fixture([
    node(1, { raw: { OptionInteractionType: 'HideAndAutoSelect' }, options: hiddenOptions }),
    node(2, { options: [option({ textKey: 'finish', optionId: 5, next: { type: 'end' } })] }), node(3), node(90),
  ], [{ op: 'talk', nids: [1, 2, 3] }, { op: 'talk', nids: [90] }]), id: '1004' }, manifest), true);
  runner.start();
  const render = (playerName = 'Rover') => renderSession({
    runner, catalog, profile: { playerName, gender: 'male' }, busy: false,
  });
  clock.advanceBy(10_000);
  const waiting = runner.getSnapshot();
  for (const name of ['Rover', 'Sol', 'Luna']) {
    const markup = render(name);
    assert.ok(markup.includes(`Hello ${name}.`));
    assert.equal((markup.match(/data-testid="choice"/g) ?? []).length, 0);
    assert.equal((markup.match(/data-testid="hidden-choice-override"/g) ?? []).length, 2);
    assert.ok(markup.includes('data-testid="hidden-choice-notice"'));
    assert.ok(!markup.includes('[Missing English:'), 'Intentionally hidden empty keys must not become missing-text buttons');
    assert.equal(runner.getSnapshot(), waiting, 'Rendering must not evaluate conditions or choose a branch');
  }
  assert.equal(waiting.choiceHistory.length, 0);
  assert.equal(runner.choose(0), false);
  assert.equal(runner.overrideHiddenChoice(0), true);
  assert.equal(runner.overrideHiddenChoice(0), false);
  const selecting = runner.getSnapshot();
  assert.equal(selecting.stagePhase, 'option');
  assert.equal(selecting.pendingStage.length, 4);
  assert.equal(selecting.stageEvents.length, 1);
  for (let i = 0; i < 3; i++) {
    assert.ok(render().includes('Hello Rover.'));
    assert.ok(render().includes('data-testid="ending-notice"'));
    assert.equal(runner.getSnapshot(), selecting);
  }
  clock.advanceBy(200);
  const selected = runner.getSnapshot();
  assert.equal(selected.nid, 2);
  assert.deepEqual(selected.stageEvents.map(event => [event.operation.actionId, event.timing?.sourceOrder]), activities.map((actionId, index) => [actionId, index]));
  assert.equal(selected.choiceHistory.length, 1);
  const ordinary = render();
  assert.ok(ordinary.includes('Choose an ordinary response.'));
  assert.ok(ordinary.includes('Finish this talk.'));
  assert.equal((ordinary.match(/data-testid="choice"/g) ?? []).length, 1);
  assert.equal((ordinary.match(/data-testid="hidden-choice-override"/g) ?? []).length, 0);
  assert.equal(runner.choose(0), true);
  assert.equal(runner.getSnapshot().nid, 90);
  assert.ok(!runner.getSnapshot().events.some(event => event.type === 'dialogue' && event.node.nid === 3));
  assert.ok(render().includes('The next talk.'));
  runner.dispose();
});

test('React CSS placement shares the upward-positive convention for static targets and animated samples', () => {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock });
  runner.load(fixture([node(1, { speakerId: '500', stage: [
    { op: 'enter', who: '500', pos: [-640, -720, .8], t: 0 },
    { op: 'move', who: '500', pos: [640, 720, 1.2], t: 1, dur: 2 },
  ] })]), manifest); runner.start();
  const render = (animated: boolean) => {
    const snapshot = runner.getSnapshot();
    return renderToStaticMarkup(createElement(VisualStage, {
      state: snapshot.stageState, ...(animated ? { presentation: snapshot.presentation } : {}),
      assets: emptyVisualAssets, catalog: null, profile: { playerName: 'Rover', gender: 'male' },
      backgroundVariant: 'day', failedUrls: new Set(), onImageError() {},
    }));
  };
  try {
    for (const animated of [false, true]) assert.ok(render(animated).includes('left:25%;bottom:-45%;transform:translateX(-50%) scale(0.8)'));
    clock.advanceBy(1000); // Logical destination arrives before the tween.
    assert.ok(render(false).includes('left:75%;bottom:55%;transform:translateX(-50%) scale(1.2)'));
    assert.ok(render(true).includes('left:25%;bottom:-45%;transform:translateX(-50%) scale(0.8)'));
    clock.elapseWithoutCallbacks(1000); clock.advanceBy(0);
    assert.ok(render(true).includes('left:50%;bottom:5%;transform:translateX(-50%) scale(1)'));
    clock.elapseWithoutCallbacks(1000); clock.advanceBy(0);
    assert.equal(render(true), render(false), 'Animated arrival must match immediate placement');
  } finally { runner.dispose(); assert.equal(clock.pendingTimers, 0); }
});

test('React visual player keeps stage state while profile/night changes resolve new image variants', () => {
  const runner = new ScriptRunner({ instantTransitions: true });
  const assets = visualFixture();
  const catalog: EnglishCatalog = {
    manifest, index: [], english: { 'line-1': 'Hello.', 'line-2': 'A picture.', 'actor-name': 'Mira' },
    speakers: { '500': { nameKey: 'actor-name', talkerId: 9999 } }, report: {},
  };
  runner.load(fixture([
    node(1, { stage: [{ op: 'enter', who: '500', expr: 701, pos: [-640, 0, 1], effect: 'Highlight', t: .2 }] }),
    node(2, { stage: [{ op: 'cg', mode: 'LoadImage', id: 20, t: 0 }, { op: 'cg', mode: 'Clean', t: 1, phase: 'end' }] }), node(3),
  ], [{ op: 'configure', config: { initialBackground: 10 } }, { op: 'talk', nids: [1, 2, 3] }]), manifest);
  runner.start();
  const render = (gender: 'male' | 'female', backgroundVariant: 'day' | 'night' = 'day') => renderSession({
    runner, catalog, assets, profile: { playerName: 'Rover', gender }, backgroundVariant, busy: false, onBackgroundVariantChange: () => {},
  });
  const original = runner.getSnapshot();
  const day = render('male');
  assert.ok(day.includes('/Bg/Day.webp')); assert.ok(day.includes('Mira'));
  assert.match(day, /data-who="500" data-expression="701" data-talker="800"/);
  assert.ok(day.includes('left:25%'), 'Character should use the central coordinate conversion');
  assert.ok(!/<img[^>]+(?:Spine|portraitTexture)/.test(day), 'Portrait texture sheets must never be used as characters');
  assert.ok(render('female', 'night').includes('/Bg/Night.webp'));
  assert.equal(runner.getSnapshot(), original);
  runner.advance();
  const withCG = runner.getSnapshot();
  for (let i = 0; i < 3; i++) {
    assert.ok(render('male').includes('/CG/Male.webp'));
    assert.ok(render('female').includes('/CG/Female.webp'));
    assert.equal(runner.getSnapshot(), withCG);
    assert.equal(withCG.stageState.appliedEvents, 3);
  }
  runner.advance();
  assert.equal(runner.getSnapshot().stageState.cg, null);
  assert.ok(!render('female').includes('data-testid="cg-layer"'));
  assert.ok(render('male').includes('data-testid="character-placeholder"'), 'CG clear must reveal the retained characters');
  runner.restart();
  assert.ok(!render('male').includes('data-testid="cg-layer"'));
  assert.equal(runner.getSnapshot().stageState.appliedEvents, 2);
});

test('missing assets and browser decode errors render labeled fallbacks without altering playback', () => {
  const runner = new ScriptRunner({ instantTransitions: true }); const assets = visualFixture();
  runner.load(fixture([node(1, { stage: [
    { op: 'bg', mode: 'Load', id: 800001, t: 0 }, { op: 'cg', mode: 'LoadImage', id: 20, t: 0 },
  ] }), node(2)]), manifest);
  runner.start();
  const snapshot = runner.getSnapshot();
  const render = () => renderToStaticMarkup(createElement(VisualStage, {
    state: snapshot.stageState, assets, catalog: null, profile: { playerName: 'Rover', gender: 'male' }, backgroundVariant: 'day',
    failedUrls: new Set([resolveCG(assets, 20, 'male').url]), onImageError: () => {},
  }));
  const markup = render();
  assert.ok(markup.includes('Background 800001 (day) unavailable'));
  assert.ok(markup.includes('CG 20 (male) unavailable'));
  assert.ok(markup.includes('Cached image failed to load or decode.'));
  assert.ok(!markup.includes('data-testid="cg-image"'));
  assert.equal(runner.getSnapshot(), snapshot);
  assert.equal(runner.advance(), true);
  assert.equal(runner.getSnapshot().nid, 2);
  runner.advance();
  assert.equal(runner.getSnapshot().status, 'completed');
});

test('visual placeholders reflect avatar/portrait visibility and exits; CG prefabs are labeled unsupported', () => {
  const runner = new ScriptRunner({ instantTransitions: true }); const assets = visualFixture();
  runner.load(fixture([
    node(1, { stage: [{ op: 'enter', who: '500', expr: 701, hidePortrait: true, hideAvatar: false, t: 0 }] }),
    node(2, { stage: [
      { op: 'modify', who: '500', expr: 702, hidePortrait: false, hideAvatar: true, effect: 'Highlight', pos: [400, 0, 1], t: .3 },
      { op: 'cg', mode: 'LoadPrefab', id: null, t: 0 },
    ] }),
    node(3, { stage: [{ op: 'cg', mode: 'Clean', t: 0 }, { op: 'exit', who: '500', t: 0 }] }),
  ]), manifest);
  runner.start();
  const render = () => renderSession({ runner, catalog: null, assets, profile: { playerName: 'Rover', gender: 'male' }, busy: false });
  const hidden = render();
  assert.ok(hidden.includes('data-testid="avatar-placeholder"'));
  assert.ok(!hidden.includes('data-testid="character-placeholder"'));
  runner.advance();
  const prefab = render();
  assert.ok(prefab.includes('data-testid="cg-prefab-fallback"'));
  assert.ok(prefab.includes('LoadPrefab is unsupported'));
  assert.match(prefab, /data-who="500" data-expression="702" data-talker="801"/);
  assert.ok(!prefab.includes('data-testid="avatar-placeholder"'));
  assert.ok(!prefab.includes('data-testid="cg-image"'));
  runner.advance();
  const exited = render();
  assert.ok(!exited.includes('data-testid="character-placeholder"'));
  assert.ok(!exited.includes('data-testid="avatar-placeholder"'));
  assert.ok(!exited.includes('data-testid="cg-prefab-fallback"'));
  assert.ok(exited.includes('data-who="500" data-present="false"'), 'Exited characters should remain inspectable in debug');
});

test('React renders complete graphemes with parsed formatting, gates choices until reveal, and never schedules text on rerenders', () => {
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock });
  const reading = new ManualReader(runner, { clock, textSpeed: 10 });
  const backlog = new DialogueBacklog(runner);
  const profile = { playerName: '<img src=x> & literal', gender: 'male' } as const;
  const catalog: EnglishCatalog = { manifest, index: [], speakers: {}, report: {}, english: { 'line-1': '<b>e</b>\u0301 <u>👩🏽‍🚀</u> {PlayerName}', choice: '<color=#d19f27>Finish</color>' } };
  reading.setTextContext(catalog.english, profile);
  backlog.setTextContext(catalog.english, catalog.speakers, profile);
  runner.load(fixture([node(1, { options: [option({ next: { type: 'end' } })] })]), manifest);
  runner.start();
  const render = () => renderToStaticMarkup(createElement(ReaderSession, { runner, reading, backlog, catalog, profile, busy: false }));
  assert.match(render(), /disabled=""[^>]*data-testid="choice"/);
  clock.advanceBy(100);
  const logical = runner.getSnapshot();
  const text = reading.getSnapshot();
  const timers = clock.pendingTimers;
  for (let i = 0; i < 5; i++) {
    const markup = render();
    assert.ok(markup.includes('<strong>e</strong>\u0301'), 'A combining grapheme split by formatting must appear in one frame');
    assert.ok(!markup.includes('&lt;b&gt;'), 'Source tags must never be incrementally rendered');
    assert.equal(runner.getSnapshot(), logical);
    assert.equal(reading.getSnapshot(), text);
    assert.equal(clock.pendingTimers, timers);
  }
  assert.equal(reading.advance(), 'revealed');
  clock.advanceBy(200);
  const full = render();
  assert.ok(full.includes('<u>👩🏽‍🚀</u>'));
  assert.ok(full.includes('&lt;img src=x&gt; &amp; literal'));
  assert.ok(!full.includes('<img src=x>'));
  assert.match(full, /style="color:#d19f27"/);
  assert.doesNotMatch(full, /disabled=""[^>]*data-testid="choice"/);
  assert.equal(runner.getSnapshot(), logical);
  assert.equal(reading.choose(0, logical), true);
  assert.equal(runner.getSnapshot().choiceHistory.length, 1);
  runner.dispose();
});

test('actual History panel renders full captured formatting, static choices, and accessible controls without replaying timers or events', () => {
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock });
  const reading = new ManualReader(runner, { clock, textSpeed: 5 });
  const backlog = new DialogueBacklog(runner);
  const profile = { playerName: '<Sol> 👩🏽‍🚀', gender: 'male' } as const;
  const catalog: EnglishCatalog = { manifest, index: [], speakers: {}, report: {}, english: {
    'line-1': '<b>Hello {PlayerName}</b>, {Male=he;Female=she}.<br><i>e\u0301!</i>', choice: '<u>Finish</u>',
  } };
  reading.setTextContext(catalog.english, profile);
  backlog.setTextContext(catalog.english, catalog.speakers, profile);
  runner.load(fixture([node(1, { options: [option({ next: { type: 'end' } })], stage: [{ op: 'bg', id: 700016, t: .5 }] })]), manifest);
  runner.start();
  const entries = backlog.getSnapshot();
  const state = runner.getSnapshot();
  const text = reading.getSnapshot();
  const timers = clock.pendingTimers;
  const renderHistory = () => renderToStaticMarkup(createElement(HistoryPanel, { id: 'test-history', entries: backlog.getSnapshot(), restoreFocusTo: null, onClose: () => {} }));
  for (let i = 0; i < 5; i++) {
    const markup = renderHistory();
    assert.match(markup, /<dialog[^>]*aria-modal="true"[^>]*aria-labelledby="test-history-title"[^>]*aria-describedby="test-history-note"/);
    assert.match(markup, /role="region"[^>]*aria-label="Visited dialogue and selected responses"[^>]*tabindex="0"/);
    assert.ok(markup.includes('<strong>Hello &lt;Sol&gt; 👩🏽‍🚀</strong>, he.\n<em>e\u0301!</em>'));
    assert.ok(!markup.includes('<Sol>') && !markup.includes('{PlayerName}'));
    assert.equal((markup.match(/data-testid="history-entry"/g) ?? []).length, 1);
    assert.equal((markup.match(/<button/g) ?? []).length, 1, 'Only Close is interactive; entries cannot navigate');
    assert.equal(runner.getSnapshot(), state);
    assert.equal(reading.getSnapshot(), text);
    assert.equal(backlog.getSnapshot(), entries);
    assert.equal(clock.pendingTimers, timers);
  }
  clock.advanceBy(500);
  assert.equal(runner.getSnapshot().stageEvents.length, 1, 'History rendering does not pause stage timing');
  assert.ok(reading.getSnapshot().visibleGraphemes > 0);
  reading.setTextOptions({ instantText: true });
  reading.choose(0);
  assert.equal(runner.getSnapshot().status, 'completed');
  backlog.setTextContext(catalog.english, {}, { playerName: 'Later', gender: 'female' });
  const complete = renderHistory();
  assert.match(complete, /data-entry-kind="choice"/);
  assert.ok(complete.includes('<u>Finish</u>'));
  assert.ok(complete.includes('&lt;Sol&gt; 👩🏽‍🚀 chose'));
  assert.ok(!complete.includes('Later'));
  const player = renderToStaticMarkup(createElement(ReaderSession, { runner, reading, backlog, catalog, profile, busy: false }));
  assert.match(player, /aria-haspopup="dialog"[^>]*aria-expanded="false"/);
  assert.ok(player.includes('History (2)'));
  assert.ok(player.includes('You’ve reached the end of this scene.'));
  runner.dispose();
});

test('empty History panel offers an accessible close control and no dialogue navigation', () => {
  const markup = renderToStaticMarkup(createElement(HistoryPanel, { id: 'empty-history', entries: [], restoreFocusTo: null, onClose: () => {} }));
  assert.ok(markup.includes('No dialogue yet.'));
  assert.ok(markup.includes('data-testid="history-close"'));
  assert.ok(markup.includes('Text and scene effects continue while history is open.'));
  assert.ok(!markup.includes('data-testid="history-entry"'));
  assert.ok(!markup.includes('data-testid="advance"'));
});

test('actual React Advance recovers after reveal despite an early timer, with History closed and no stage work', () => {
  const clock = new TimerPrecisionClock();
  const runner = new ScriptRunner({ clock, navigationDebounceMs: 200 });
  const reading = new ManualReader(runner, { clock, textSpeed: 10 });
  const backlog = new DialogueBacklog(runner);
  const profile = { playerName: 'Sol', gender: 'male' } as const;
  const catalog: EnglishCatalog = { manifest, index: [], speakers: {}, report: {}, english: { 'line-1': 'First line.', 'line-2': 'Next line.' } };
  reading.setTextContext(catalog.english, profile);
  backlog.setTextContext(catalog.english, catalog.speakers, profile);
  runner.load(fixture([node(1), node(2)]), manifest);
  runner.start();
  const render = () => renderToStaticMarkup(createElement(ReaderSession, { runner, reading, backlog, catalog, profile, busy: false }));
  clock.advanceBy(100);
  reading.advance();
  assert.match(render(), /disabled=""[^>]*data-testid="advance"/);
  clock.advanceBy(201);
  const recovered = render();
  assert.ok(recovered.includes('data-history-open="false"'));
  assert.ok(recovered.includes('data-text-complete="true"'));
  assert.ok(recovered.includes('data-input-ready="true"'));
  assert.doesNotMatch(recovered, /disabled=""[^>]*data-testid="advance"/);
  assert.equal(runner.getSnapshot().nid, 1);
  assert.equal(backlog.getSnapshot().length, 1);
  assert.equal(reading.advance(), 'advanced');
  assert.equal(runner.getSnapshot().nid, 2);
  assert.equal(backlog.getSnapshot().length, 2);
  runner.dispose();
});
