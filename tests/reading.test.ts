import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import type { Script } from '../src/engine/types.ts';
import { ManualReader } from '../src/ui/ManualReader.ts';
import { isReadingKey, shouldHandleReadingShortcut } from '../src/ui/ReadingInput.ts';
import { FakeClock, TimerPrecisionClock } from './FakeClock.ts';
import { DialogueBacklog } from '../src/ui/DialogueBacklog.ts';
import { fixture, manifest, node, option } from './fixtures.ts';

const profile = { playerName: 'Sol', gender: 'male' } as const;
function setup(script = fixture([node(1), node(2), node(3)]), english: Readonly<Record<string, string>> = { 'line-1': 'First line.', 'line-2': 'Second line.', 'line-3': 'Third line.' }, options: { textSpeed?: number; instantText?: boolean } = {}) {
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock });
  const reading = new ManualReader(runner, { clock, textSpeed: 10, ...options });
  reading.setTextContext(english, profile);
  assert.equal(runner.load(script, manifest), true);
  runner.start();
  return { clock, runner, reading };
}
const visibleText = (reading: ManualReader) => {
  const state = reading.getSnapshot();
  return state.document.text.slice(0, state.document.graphemeEnds[state.visibleGraphemes - 1] ?? 0);
};

function precisionReading(script = fixture([node(1), node(2), node(3)])) {
  const clock = new TimerPrecisionClock();
  const runner = new ScriptRunner({ clock, navigationDebounceMs: 200 });
  const reading = new ManualReader(runner, { clock, textSpeed: 10 });
  const backlog = new DialogueBacklog(runner);
  const english = { 'line-1': 'First line.', 'line-2': 'Second line.', 'line-3': 'Third line.' };
  reading.setTextContext(english, profile);
  backlog.setTextContext(english, {}, profile);
  runner.load(script, manifest);
  runner.start();
  return { clock, runner, reading, backlog };
}

test('an early text-guard wake still publishes recovery after partial reveal completion, without navigating', () => {
  const { clock, runner, reading, backlog } = precisionReading();
  clock.advanceBy(100);
  assert.equal(visibleText(reading), 'F');
  const initial = runner.getSnapshot();
  const entries = backlog.getSnapshot();
  assert.equal(reading.advance(initial), 'revealed');
  assert.equal(reading.getSnapshot().complete, true);
  assert.equal(runner.getSnapshot(), initial);
  clock.advanceBy(199);
  assert.equal(reading.getSnapshot().inputReady, false, 'The full guard remains in effect at the early callback');
  assert.equal(reading.advance(initial), 'ignored');
  clock.advanceBy(2);
  assert.equal(reading.getSnapshot().inputReady, true, 'The UI must receive an unlocked snapshot without another input');
  assert.equal(runner.getSnapshot(), initial);
  assert.equal(backlog.getSnapshot(), entries);
  assert.equal(reading.advance(initial), 'advanced');
  assert.equal(runner.getSnapshot().nid, 2);
  assert.equal(backlog.getSnapshot().length, 2);
  runner.dispose();
});

test('rapid reveal/advance attempts and canceled old guard callbacks recover without duplicate visits', () => {
  const { clock, runner, reading, backlog } = precisionReading();
  const source = runner.getSnapshot();
  assert.equal(reading.advance(source), 'revealed');
  const oldCallbacks = [...clock.callbacks];
  for (let i = 0; i < 20; i++) assert.equal(reading.advance(source), 'ignored');
  clock.advanceBy(201);
  assert.equal(reading.getSnapshot().inputReady, true);
  assert.equal(reading.advance(source), 'advanced');
  const destination = runner.getSnapshot();
  for (let i = 0; i < 20; i++) assert.equal(reading.advance(destination), 'ignored');
  oldCallbacks.forEach(callback => callback());
  assert.equal(reading.getSnapshot().inputReady, false, 'Superseded callbacks cannot unlock the new guard');
  clock.advanceBy(201);
  assert.equal(reading.getSnapshot().inputReady, true);
  assert.equal(runner.getSnapshot().nid, 2);
  assert.equal(reading.advance(destination), 'revealed');
  for (let i = 0; i < 20; i++) assert.equal(reading.advance(destination), 'ignored');
  clock.advanceBy(201);
  assert.equal(reading.getSnapshot().inputReady, true);
  assert.equal(reading.advance(destination), 'advanced');
  assert.equal(runner.getSnapshot().nid, 3);
  assert.deepEqual(backlog.getSnapshot().map(entry => entry.nodeId), [1, 2, 3]);
  assert.deepEqual(runner.getSnapshot().navigationHistory.filter(entry => entry.from !== null).map(entry => entry.to), [2, 3]);
  assert.equal(runner.getSnapshot().stageEvents.length, 0);
  runner.dispose();
});

test('restart and script switch during a guard cancel old wakes and allow each new guard to release', () => {
  const { clock, runner, reading, backlog } = precisionReading();
  assert.equal(reading.advance(), 'revealed');
  const beforeRestart = [...clock.callbacks];
  runner.restart();
  const restarted = runner.getSnapshot();
  assert.equal(reading.getSnapshot().inputReady, true);
  assert.equal(reading.advance(restarted), 'revealed');
  beforeRestart.forEach(callback => callback());
  assert.equal(reading.getSnapshot().inputReady, false);
  clock.advanceBy(201);
  assert.equal(reading.getSnapshot().inputReady, true);
  assert.equal(reading.advance(restarted), 'advanced');
  const beforeSwitch = [...clock.callbacks];
  runner.load({ ...fixture([node(3)]), id: 'switched' }, manifest);
  runner.start();
  const switched = runner.getSnapshot();
  assert.equal(reading.getSnapshot().inputReady, true);
  assert.equal(reading.advance(switched), 'revealed');
  beforeSwitch.forEach(callback => callback());
  assert.equal(reading.getSnapshot().inputReady, false);
  clock.advanceBy(201);
  assert.equal(reading.getSnapshot().inputReady, true);
  assert.equal(reading.advance(switched), 'advanced');
  assert.equal(runner.getSnapshot().status, 'completed');
  assert.deepEqual(backlog.getSnapshot().map(entry => [entry.scriptId, entry.nodeId]), [['switched', 3]]);
  runner.dispose();
});

test('a runner deadline crossed between snapshot and timer scheduling still publishes the guard release', () => {
  const clock = new TimerPrecisionClock();
  const runner = new ScriptRunner({ clock, navigationDebounceMs: 200 });
  runner.load(fixture([node(1), node(2)]), manifest);
  runner.start();
  runner.advance();
  const events = runner.getSnapshot().events;
  assert.equal(runner.getSnapshot().inputReady, false);
  clock.crossDeadlineOnNextWake = true;
  clock.advanceBy(199);
  assert.ok(clock.now() >= 200);
  assert.equal(runner.getSnapshot().inputReady, false, 'The last published sample preceded the deadline');
  clock.advanceBy(2);
  assert.equal(runner.getSnapshot().inputReady, true, 'A post-deadline sample must reach observers');
  assert.deepEqual(runner.getSnapshot().events, events);
  assert.equal(runner.getSnapshot().nid, 2);
  assert.equal(runner.advance(), true);
  assert.equal(runner.getSnapshot().status, 'completed');
  runner.dispose();
});

test('releasing an early guard preserves visible choices and a genuinely pending end phase', () => {
  const { clock, runner, reading, backlog } = precisionReading(fixture([node(1, {
    options: [option({ textKey: 'line-2', optionId: 5, next: { type: 'end' } })],
    stage: [{ op: 'enter', who: '500', t: 0 }, { op: 'exit', who: '500', t: .5, phase: 'end', fadeOut: .5 }],
  }), node(2)]));
  assert.equal(reading.advance(), 'revealed');
  clock.advanceBy(201);
  assert.equal(reading.getSnapshot().inputReady, true);
  assert.equal(reading.advance(), 'ignored', 'A completed choice node still waits for selection');
  assert.equal(runner.getSnapshot().choiceHistory.length, 0);
  assert.equal(reading.choose(0), true);
  assert.equal(runner.getSnapshot().status, 'ending');
  clock.advanceBy(201);
  assert.equal(reading.getSnapshot().inputReady, true);
  assert.equal(runner.getSnapshot().pendingStage.length, 1);
  assert.equal(reading.advance(), 'ignored', 'The end phase is still blocking after the input guard ends');
  assert.equal(reading.choose(0), false);
  assert.equal(runner.getSnapshot().choiceHistory.length, 1);
  clock.advanceBy(300);
  assert.equal(runner.getSnapshot().status, 'completed');
  assert.deepEqual(backlog.getSnapshot().map(entry => entry.kind), ['dialogue', 'choice']);
  assert.equal(runner.getSnapshot().stageEvents.filter(event => event.phase === 'end').length, 1);
  runner.dispose();
});

test('first advance reveals only text; a separate input navigates and uses unchanged start/end scheduling', () => {
  const { clock, runner, reading } = setup(fixture([node(1, { raw: { DialogDelay: 2.55, ClickShowFull: false, WaitTime: 3 }, stage: [
    { op: 'enter', who: '500', t: 2, fadeIn: .5 },
    { op: 'exit', who: '500', t: .5, phase: 'end', fadeOut: .5 },
  ] }), node(2)]));
  const before = runner.getSnapshot();
  clock.advanceBy(100);
  assert.equal(visibleText(reading), 'F');
  assert.equal(reading.advance(before), 'revealed');
  assert.equal(runner.getSnapshot(), before, 'Text completion must send no runner command or settle pending operations');
  assert.equal(runner.getSnapshot().pendingStage.length, 1);
  assert.equal(reading.advance(before), 'ignored');
  clock.advanceBy(200);
  assert.equal(reading.advance(before), 'advanced');
  assert.equal(runner.getSnapshot().status, 'ending');
  assert.equal(runner.getSnapshot().stageEvents[0].timing?.delivery, 'advance');
  assert.equal(reading.getSnapshot().complete, true);
  clock.advanceBy(500);
  assert.equal(runner.getSnapshot().nid, 2);
  assert.equal(reading.getSnapshot().visibleGraphemes, 0);
  assert.deepEqual(runner.getSnapshot().stageEvents.map(event => event.phase), ['start', 'end']);
  assert.equal(reading.advance(before), 'ignored', 'Stale callbacks cannot complete the new visit');
  runner.dispose();
});

test('revisiting the same nid starts a fresh reveal and rejects callbacks from the previous visit', () => {
  const { clock, runner, reading } = setup(fixture([node(1, { next: { type: 'jump', to: 1 } })]));
  const oldToken = runner.getSnapshot();
  const stale = [...clock.callbacks];
  assert.equal(reading.advance(), 'revealed');
  clock.advanceBy(200);
  assert.equal(reading.advance(), 'advanced');
  assert.equal(runner.getSnapshot().nid, 1);
  assert.notEqual(runner.getSnapshot().visitId, oldToken.visitId);
  assert.equal(reading.getSnapshot().visibleGraphemes, 0);
  const revisited = reading.getSnapshot();
  stale.forEach(callback => callback());
  assert.equal(reading.getSnapshot(), revisited);
  clock.advanceBy(200);
  assert.equal(reading.advance(oldToken), 'ignored');
  runner.dispose();
});

test('text clocks reveal whole graphemes including emoji, combining marks, punctuation and resolved player tokens', () => {
  const { clock, runner, reading } = setup(undefined, { 'line-1': '<b>e</b>\u0301👩🏽‍🚀🇻🇳! {PlayerName} {Male=he;Female=she}' });
  for (const prefix of ['e\u0301', 'e\u0301👩🏽‍🚀', 'e\u0301👩🏽‍🚀🇻🇳', 'e\u0301👩🏽‍🚀🇻🇳!']) {
    clock.advanceBy(100);
    assert.equal(visibleText(reading), prefix);
  }
  const logical = runner.getSnapshot();
  clock.advanceBy(10_000);
  assert.equal(visibleText(reading), 'e\u0301👩🏽‍🚀🇻🇳! Sol he');
  assert.equal(runner.getSnapshot(), logical, 'Natural text completion must never advance');
  runner.dispose();
});

test('speed changes keep revealed progress, late callbacks catch up, and instant text never changes stage timing', () => {
  const { clock, runner, reading } = setup();
  clock.advanceBy(250);
  assert.equal(reading.getSnapshot().visibleGraphemes, 2);
  const oldCallbacks = [...clock.callbacks];
  reading.setTextOptions({ textSpeed: 20 });
  clock.advanceBy(50);
  assert.equal(reading.getSnapshot().visibleGraphemes, 3);
  const updated = reading.getSnapshot();
  oldCallbacks.forEach(callback => callback());
  assert.equal(reading.getSnapshot(), updated);
  clock.elapseWithoutCallbacks(250);
  clock.advanceBy(0);
  assert.equal(reading.getSnapshot().visibleGraphemes, 8);
  const logical = runner.getSnapshot();
  reading.setTextOptions({ instantText: true });
  assert.equal(reading.getSnapshot().complete, true);
  assert.equal(runner.getSnapshot(), logical);
  reading.setTextOptions({ instantText: false });
  assert.equal(reading.getSnapshot().complete, true, 'Turning instant text off never hides the current line');
  assert.equal(reading.advance(), 'advanced');
  assert.equal(reading.getSnapshot().visibleGraphemes, 0);
  runner.dispose();
});

test('instant text starts each new node fully revealed and supports a single normal advance', () => {
  const { runner, reading } = setup(undefined, undefined, { instantText: true });
  assert.equal(visibleText(reading), 'First line.');
  assert.equal(reading.advance(), 'advanced');
  assert.equal(runner.getSnapshot().nid, 2);
  assert.equal(visibleText(reading), 'Second line.');
  assert.equal(reading.advance(), 'ignored');
  runner.dispose();
});

test('profile edits retain progress and completed text; repeated subscriptions/context updates never restart reveal or replay stage events', () => {
  const english = { 'line-1': 'Hello {PlayerName}, {Male=he;Female=she}.' };
  const { clock, runner, reading } = setup(fixture([node(1, { stage: [{ op: 'enter', who: '500', t: 0, fadeIn: 1 }] })]), english);
  clock.advanceBy(200);
  const before = reading.getSnapshot();
  const timers = clock.pendingTimers;
  for (let i = 0; i < 5; i++) {
    const unsubscribe = reading.subscribe(() => {});
    reading.setTextContext(english, { ...profile });
    reading.setTextOptions({ textSpeed: 10, instantText: false });
    unsubscribe();
  }
  assert.equal(reading.getSnapshot(), before);
  assert.equal(clock.pendingTimers, timers);
  const logical = runner.getSnapshot();
  reading.setTextContext(english, { playerName: 'Luna', gender: 'female' });
  assert.equal(reading.getSnapshot().visibleGraphemes, 2);
  assert.equal(reading.getSnapshot().document.text, 'Hello Luna, she.');
  assert.equal(runner.getSnapshot(), logical);
  reading.advance();
  reading.setTextContext(english, profile);
  assert.equal(visibleText(reading), 'Hello Sol, he.');
  clock.advanceBy(1000);
  assert.equal(runner.getSnapshot().stageEvents.length, 1);
  runner.dispose();
});

test('ordinary choices wait for reveal, then select through the existing path once despite rapid/stale input', () => {
  const { clock, runner, reading } = setup(fixture([node(1, { options: [option({ optionId: 5, next: { type: 'end' } })] }), node(2)]));
  const token = runner.getSnapshot();
  assert.equal(reading.choose(0, token), false);
  assert.equal(reading.advance(token), 'revealed');
  assert.equal(runner.getSnapshot().status, 'choices');
  assert.equal(runner.getSnapshot().choiceHistory.length, 0);
  assert.equal(reading.choose(0, token), false);
  clock.advanceBy(200);
  assert.equal(reading.choose(0, token), true);
  assert.equal(reading.choose(0, token), false);
  assert.equal(reading.advance(token), 'ignored');
  assert.equal(runner.getSnapshot().status, 'completed');
  assert.equal(runner.getSnapshot().choiceHistory.length, 1);
  assert.ok(!runner.getSnapshot().navigationHistory.some(entry => entry.to === 2));
  runner.dispose();
});

test('restart, script switch, node departure and disposal reject cleared text callbacks and stale visit input', () => {
  const { clock, runner, reading } = setup();
  const originalToken = runner.getSnapshot();
  const originalCallbacks = [...clock.callbacks];
  runner.restart();
  const restarted = reading.getSnapshot();
  originalCallbacks.forEach(callback => callback());
  assert.equal(reading.getSnapshot(), restarted);
  assert.equal(reading.advance(originalToken), 'ignored');
  const restartCallbacks = [...clock.callbacks];
  runner.load({ ...fixture([node(9)]), id: 'x1' }, manifest);
  runner.start();
  const switched = reading.getSnapshot();
  restartCallbacks.forEach(callback => callback());
  assert.equal(reading.getSnapshot(), switched);
  const switchedCallbacks = [...clock.callbacks];
  runner.advance();
  const completed = reading.getSnapshot();
  switchedCallbacks.forEach(callback => callback());
  assert.equal(reading.getSnapshot(), completed);
  runner.restart();
  reading.advance();
  const disposeCallbacks = [...clock.callbacks];
  runner.dispose();
  assert.equal(clock.pendingTimers, 0);
  const disposed = reading.getSnapshot();
  disposeCallbacks.forEach(callback => callback());
  assert.equal(reading.getSnapshot(), disposed);
  assert.equal(reading.advance(), 'ignored');
  assert.equal(reading.choose(0), false);
});

test('disposing only the reading presentation leaves the stage scheduler active', () => {
  const { clock, runner, reading } = setup(fixture([node(1, { stage: [{ op: 'enter', who: '500', t: 1 }] })]));
  const stale = [...clock.callbacks];
  reading.dispose();
  const disposed = reading.getSnapshot();
  // Fire only the last (text) callback: the independent stage queue is valid.
  stale.at(-1)!();
  assert.equal(reading.getSnapshot(), disposed);
  clock.advanceBy(1000);
  assert.equal(runner.getSnapshot().status, 'dialogue');
  assert.equal(runner.getSnapshot().stageEvents.length, 1);
  runner.dispose();
});

test('shortcuts reject held keys, composition, modifiers, editable content and interactive controls', () => {
  const base = { key: 'Enter', repeat: false, isComposing: false, defaultPrevented: false, altKey: false, ctrlKey: false, metaKey: false, target: null };
  assert.equal(shouldHandleReadingShortcut(base), true);
  assert.equal(shouldHandleReadingShortcut({ ...base, key: ' ' }), true);
  for (const patch of [{ repeat: true }, { isComposing: true }, { defaultPrevented: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { key: 'a' }]) assert.equal(isReadingKey({ ...base, ...patch }), false);
  const interactive = { closest: () => ({}) } as unknown as EventTarget;
  assert.equal(shouldHandleReadingShortcut({ ...base, target: interactive }), false);
  const ordinary = { closest: () => null } as unknown as EventTarget;
  assert.equal(shouldHandleReadingShortcut({ ...base, target: ordinary }), true);
});

function real(id: string) {
  const script = JSON.parse(readFileSync(new URL(`../public/data/scripts/${id}.json`, import.meta.url), 'utf8')) as Script;
  const english = JSON.parse(readFileSync(new URL('../public/data/locales/en.json', import.meta.url), 'utf8')) as Record<string, string>;
  const dataManifest = JSON.parse(readFileSync(new URL('../public/data/manifest.json', import.meta.url), 'utf8'));
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock });
  const reading = new ManualReader(runner, { clock, textSpeed: 10 });
  reading.setTextContext(english, profile);
  assert.equal(runner.load(script, dataManifest), true);
  runner.start();
  return { clock, runner, reading };
}

test('real 1004/1 text completion never resolves a hidden branch; explicit optionId 11 runs its five performances once', () => {
  const { clock, runner, reading } = real('1004');
  const before = runner.getSnapshot();
  assert.equal(reading.advance(before), 'revealed');
  assert.equal(runner.getSnapshot(), before);
  clock.advanceBy(10_000);
  assert.equal(runner.getSnapshot().nid, 1);
  assert.equal(runner.getSnapshot().choiceHistory.length, 0);
  assert.equal(reading.advance(), 'ignored');
  assert.equal(reading.choose(0), false);
  assert.equal(reading.overrideHiddenChoice(0, before), true);
  assert.equal(reading.overrideHiddenChoice(0, before), false);
  clock.advanceBy(200);
  assert.equal(runner.getSnapshot().nid, 2);
  assert.equal(runner.getSnapshot().choiceHistory[0].optionId, 11);
  assert.equal(runner.getSnapshot().stageEvents.filter(event => event.phase === 'option').length, 5);
  runner.dispose();
});

test('real 17048/2 reveals text first, then optionId 5 FinishTalk completes without displaying node 3', () => {
  const { clock, runner, reading } = real('17048');
  assert.equal(reading.advance(), 'revealed');
  clock.advanceBy(200);
  assert.equal(reading.advance(), 'advanced');
  clock.advanceBy(200);
  assert.equal(runner.getSnapshot().nid, 2);
  const choices = runner.getSnapshot();
  assert.equal(reading.advance(choices), 'revealed');
  assert.equal(runner.getSnapshot(), choices);
  clock.advanceBy(200);
  const index = choices.choices.findIndex(choice => choice.optionId === 5);
  assert.equal(reading.choose(index, choices), true);
  assert.equal(reading.choose(index, choices), false);
  assert.equal(runner.getSnapshot().status, 'completed');
  assert.equal(runner.getSnapshot().choiceHistory.length, 1);
  assert.ok(!runner.getSnapshot().events.some(event => event.type === 'dialogue' && event.node.nid === 3));
  runner.dispose();
});
