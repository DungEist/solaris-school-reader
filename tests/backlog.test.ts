import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import type { RunnerEvent, Script, Speaker } from '../src/engine/types.ts';
import { DialogueBacklog } from '../src/ui/DialogueBacklog.ts';
import { ManualReader } from '../src/ui/ManualReader.ts';
import { FakeClock } from './FakeClock.ts';
import { fixture, manifest, node, option } from './fixtures.ts';

const profile = { playerName: 'Rover', gender: 'male' } as const;

test('checkpoint retains a voiced interaction in Story Review without playing it again', () => {
  const { runner, backlog, reading } = setup({ 'line-1': 'Story', greeting: 'Hello' });
  runner.load(fixture([node(1)]), manifest); runner.start();
  runner.presentRoleVoice('play_vo_avg_3_8_changli_01', 'greeting', '', 1001);
  const checkpoint = runner.createCheckpoint(); assert.ok(checkpoint);
  runner.presentRoleVoice(null, 'greeting', '', 1002);
  let interactions = 0;
  runner.onEvent(event => { if (event.type === 'interactionVoice') interactions++; });
  assert.equal(runner.restoreCheckpoint(checkpoint), true);
  assert.equal(interactions, 0);
  assert.equal(backlog.getSnapshot().length, 2);
  assert.deepEqual(backlog.getSnapshot()[1].voiceCues, ['play_vo_avg_3_8_changli_01']);
  assert.equal(backlog.getSnapshot()[1].nodeId, -1001);
  backlog.dispose(); reading.dispose(); runner.dispose();
});

function setup(english: Record<string, string>, speakers: Record<string, Speaker> = {}) {
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock });
  const reading = new ManualReader(runner, { clock, textSpeed: 5 });
  const backlog = new DialogueBacklog(runner);
  reading.setTextContext(english, profile);
  backlog.setTextContext(english, speakers, profile);
  return { clock, runner, reading, backlog };
}

test('backlog captures full dialogue at entry, never on text ticks, settings, or stage publications', () => {
  const { clock, runner, reading, backlog } = setup({ 'line-1': '<b>Hello {PlayerName}</b>, 👩🏽‍🚀 e\u0301!' });
  runner.load(fixture([node(1, { stage: [{ op: 'enter', who: '999', t: .5, fadeIn: .5 }] })]), manifest);
  runner.start();
  const entries = backlog.getSnapshot();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].document.text, 'Hello Rover, 👩🏽‍🚀 e\u0301!');
  assert.equal(reading.getSnapshot().visibleGraphemes, 0);
  let notifications = 0;
  const unsubscribe = backlog.subscribe(() => { notifications++; });
  clock.advanceBy(200);
  assert.equal(reading.getSnapshot().visibleGraphemes, 1);
  const beforeReveal = runner.getSnapshot();
  assert.equal(reading.advance(), 'revealed');
  assert.equal(runner.getSnapshot(), beforeReveal, 'Completing text sends no engine command');
  clock.advanceBy(1000);
  assert.equal(runner.getSnapshot().stageEvents.length, 1);
  reading.setTextOptions({ textSpeed: 100, instantText: true });
  runner.setInstantTransitions(true);
  for (let i = 0; i < 5; i++) {
    const off = backlog.subscribe(() => {});
    backlog.setTextContext({ 'line-1': `Changed ${i}` }, {}, { playerName: `Name ${i}`, gender: 'female' });
    off();
  }
  assert.equal(backlog.getSnapshot(), entries);
  assert.equal(notifications, 0);
  unsubscribe();
  runner.dispose();
});

test('revisiting a nid creates another entry with a distinct visit identity', () => {
  const { runner, backlog } = setup({ 'line-11': 'First', 'line-29': 'Second' });
  runner.load(fixture([node(11), node(29, { next: { type: 'jump', to: 11 } })]), manifest);
  runner.start();
  runner.advance();
  runner.advance();
  const entries = backlog.getSnapshot();
  assert.deepEqual(entries.map(entry => entry.nodeId), [11, 29, 11]);
  assert.deepEqual(entries.map(entry => entry.visitId), [1, 2, 3]);
  assert.equal(new Set(entries.map(entry => entry.id)).size, 3);
  assert.ok(entries.every(entry => entry.scriptId === 'fixture' && entry.runId === runner.getSnapshot().runId));
  runner.dispose();
});

test('speaker, player, gender, Unicode, and formatting are immutable snapshots; choices use their selection context', () => {
  const english = {
    'line-1': '<b>{PlayerName}</b>, {Male=he;Female=she}, <i>👩🏽‍🚀e\u0301</i>.',
    'line-2': 'Hello {PlayerName}.', name: '<u>{PlayerName}</u>',
    choice: '<color=#aabbcc>{Male=Sir;Female=Madam}</color> {PlayerName}',
  };
  const speakers = { '999': { nameKey: 'name', talkerId: null } };
  const { runner, backlog } = setup(english, speakers);
  const initialProfile = { playerName: '<Sol> & {PlayerName}', gender: 'male' as const };
  backlog.setTextContext(english, speakers, initialProfile);
  initialProfile.playerName = 'Changed after configuration';
  runner.load(fixture([node(1), node(2, { options: [option({ next: { type: 'end' } })] })]), manifest);
  runner.start();
  const first = backlog.getSnapshot()[0];
  assert.equal(first.speakerName, '<Sol> & {PlayerName}');
  assert.equal(first.document.text, '<Sol> & {PlayerName}, he, 👩🏽‍🚀e\u0301.');
  assert.equal(first.document.runs[0].formats[0].tag, 'strong');
  const captured = backlog.getSnapshot();
  backlog.setTextContext(english, speakers, { playerName: 'Luna', gender: 'female' });
  english['line-1'] = 'Replaced source text';
  assert.equal(backlog.getSnapshot(), captured);
  runner.advance();
  const second = backlog.getSnapshot()[1];
  assert.equal(second.speakerName, 'Luna');
  assert.equal(second.document.text, 'Hello Luna.');
  backlog.setTextContext(english, speakers, { playerName: 'Mira', gender: 'female' });
  runner.choose(0);
  const selected = backlog.getSnapshot()[2];
  assert.equal(selected.kind, 'choice');
  assert.equal(selected.speakerName, 'Mira');
  assert.equal(selected.document.text, 'Madam Mira');
  assert.equal(selected.document.runs[0].formats[0].color, '#aabbcc');
  backlog.setTextContext({}, {}, profile);
  assert.equal(first.document.text, '<Sol> & {PlayerName}, he, 👩🏽‍🚀e\u0301.');
  assert.equal(selected.document.text, 'Madam Mira');
  assert.ok(Object.isFrozen(backlog.getSnapshot()));
  for (const entry of backlog.getSnapshot()) {
    assert.ok(Object.isFrozen(entry) && Object.isFrozen(entry.document));
    assert.ok(Object.isFrozen(entry.document.runs) && Object.isFrozen(entry.document.graphemeEnds));
    assert.ok(entry.document.runs.every(run => Object.isFrozen(run) && Object.isFrozen(run.formats) && run.formats.every(Object.isFrozen)));
  }
  runner.dispose();
});

test('silent, null, empty, and formatting-only dialogue is excluded; visible empty choices match their fallback', () => {
  const { runner, backlog } = setup({
    'line-1': 'Silent text must be excluded', 'line-3': '', 'line-4': '<b> \n</b><br>',
    'line-5': '<i>A thought.</i>', choice: '',
  });
  assert.equal(runner.load(fixture([
    node(1, { kind: 'silent' }), node(2, { kind: 'silent', textKey: null }), node(3), node(4),
    node(5, { kind: 'centerText', speakerId: null, options: [option({ next: { type: 'end' } })] }),
  ]), manifest), true);
  runner.start();
  assert.equal(runner.getSnapshot().nid, 3);
  assert.equal(backlog.getSnapshot().length, 0);
  runner.advance();
  assert.equal(backlog.getSnapshot().length, 0);
  runner.advance();
  assert.equal(backlog.getSnapshot()[0].speakerName, 'Center text');
  runner.choose(0);
  assert.deepEqual(backlog.getSnapshot().map(entry => entry.document.text), ['A thought.', 'Choice 1']);
  assert.equal(runner.getSnapshot().status, 'completed');
  runner.dispose();
});

test('a selected choice retains its source visit when the same command immediately enters the next dialogue', () => {
  const { runner, backlog } = setup({ 'line-11': 'Question', 'line-29': 'Answer', choice: '<u>Continue</u>' });
  runner.load(fixture([node(11, { options: [option({ optionId: 3 })] }), node(29)]), manifest);
  runner.start();
  const source = runner.getSnapshot();
  assert.equal(runner.choose(0, source), true);
  assert.equal(runner.choose(0, source), false);
  assert.equal(runner.getSnapshot().visitId, source.visitId + 1);
  const entries = backlog.getSnapshot();
  assert.deepEqual(entries.map(entry => [entry.kind, entry.nodeId, entry.visitId]), [
    ['dialogue', 11, 1], ['choice', 11, 1], ['dialogue', 29, 2],
  ]);
  assert.equal(entries[1].document.runs[0].formats[0].tag, 'u');
  assert.equal(runner.getSnapshot().choiceHistory.length, 1);
  const event = runner.getSnapshot().events.find(event => event.type === 'choiceSelected');
  assert.ok(event?.type === 'choiceSelected');
  assert.equal(event.visitId, source.visitId);
  runner.dispose();
});

test('explicit clear, Restart, and new Start reset history; completion keeps it available', () => {
  const { runner, backlog } = setup({ 'line-1': 'First', 'line-2': 'Second' });
  const script = fixture([node(1), node(2)]);
  runner.load(script, manifest);
  runner.start();
  runner.advance();
  runner.advance();
  const complete = backlog.getSnapshot();
  assert.equal(complete.length, 2);
  assert.equal(runner.getSnapshot().status, 'completed');
  runner.advance();
  assert.equal(backlog.getSnapshot(), complete);
  backlog.clear();
  assert.equal(backlog.getSnapshot().length, 0, 'Start clears before asynchronous loading');
  runner.restart();
  assert.equal(backlog.getSnapshot().length, 1);
  assert.notEqual(backlog.getSnapshot()[0].runId, complete[0].runId);
  assert.equal(backlog.getSnapshot()[0].visitId, 1);
  runner.advance();
  runner.restart();
  assert.deepEqual(backlog.getSnapshot().map(entry => entry.nodeId), [1]);
  runner.load({ ...script, id: 'another' }, manifest);
  assert.equal(backlog.getSnapshot().length, 0);
  runner.start();
  assert.equal(backlog.getSnapshot()[0].scriptId, 'another');
  runner.dispose();
});

test('duplicate deliveries, subscription cycles, and old-run events cannot duplicate or repopulate cleared history', () => {
  const runner = new ScriptRunner({ instantTransitions: true });
  const eventListeners = new Set<(event: RunnerEvent) => void>();
  const deliver = (event: RunnerEvent) => { for (const listener of eventListeners) listener(event); };
  runner.onEvent(deliver);
  const backlog = new DialogueBacklog({
    getSnapshot: runner.getSnapshot, subscribe: runner.subscribe,
    onEvent: listener => { eventListeners.add(listener); return () => { eventListeners.delete(listener); }; },
  });
  backlog.setTextContext({ 'line-1': 'First' }, {}, profile);
  runner.load(fixture([node(1)]), manifest);
  runner.start();
  const original = runner.getSnapshot().events.find(event => event.type === 'dialogue')!;
  const entries = backlog.getSnapshot();
  for (let i = 0; i < 4; i++) {
    const off = backlog.subscribe(() => {});
    deliver({ ...original, sequence: original.sequence + i + 1 });
    off();
  }
  assert.equal(backlog.getSnapshot(), entries);
  backlog.clear();
  deliver(original);
  assert.equal(backlog.getSnapshot().length, 0, 'Clear cannot re-resolve the current visit');
  runner.restart();
  const restarted = backlog.getSnapshot();
  deliver(original);
  assert.equal(backlog.getSnapshot(), restarted, 'Late old events must neither append nor reset a new run');
  backlog.dispose();
  assert.equal(eventListeners.size, 0);
  deliver(runner.getSnapshot().events.find(event => event.type === 'dialogue')!);
  runner.restart();
  assert.equal(backlog.getSnapshot(), restarted);
  runner.dispose();
});

test('disposing the backlog leaves reading and stage timers running; runner disposal unsubscribes it', () => {
  const { clock, runner, reading, backlog } = setup({ 'line-1': 'A long line of dialogue', 'line-2': 'Next' });
  runner.load(fixture([node(1, { stage: [{ op: 'bg', id: 700016, t: .5 }] }), node(2)]), manifest);
  runner.start();
  const entries = backlog.getSnapshot();
  const timerCount = clock.pendingTimers;
  let notifications = 0;
  backlog.subscribe(() => { notifications++; });
  backlog.dispose();
  assert.equal(clock.pendingTimers, timerCount);
  clock.advanceBy(500);
  assert.equal(runner.getSnapshot().stageEvents.length, 1);
  assert.ok(reading.getSnapshot().visibleGraphemes > 0);
  runner.advance();
  assert.equal(backlog.getSnapshot(), entries);
  assert.equal(notifications, 0);
  const observing = new DialogueBacklog(runner);
  runner.dispose();
  observing.setTextContext({}, {}, profile);
  observing.clear();
  assert.equal(clock.pendingTimers, 0);
});

function real(id: string) {
  const script = JSON.parse(readFileSync(new URL(`../public/data/scripts/${id}.json`, import.meta.url), 'utf8')) as Script;
  const english = JSON.parse(readFileSync(new URL('../public/data/locales/en.json', import.meta.url), 'utf8')) as Record<string, string>;
  const speakers = JSON.parse(readFileSync(new URL('../public/data/speakers.json', import.meta.url), 'utf8')) as Record<string, Speaker>;
  const dataManifest = JSON.parse(readFileSync(new URL('../public/data/manifest.json', import.meta.url), 'utf8'));
  const result = setup(english, speakers);
  result.runner.load(script, dataManifest);
  result.runner.start();
  return result;
}

test('real 1004/1 records dialogue but excludes the hidden override while Debug retains its five performances', () => {
  const { clock, runner, reading, backlog } = real('1004');
  const initial = backlog.getSnapshot();
  assert.equal(initial.length, 1);
  assert.equal(initial[0].nodeId, 1);
  assert.equal(reading.advance(), 'revealed');
  clock.advanceBy(10_000);
  assert.equal(backlog.getSnapshot(), initial);
  assert.equal(runner.getSnapshot().choiceHistory.length, 0);
  assert.equal(reading.overrideHiddenChoice(0), true);
  assert.equal(reading.overrideHiddenChoice(0), false);
  clock.advanceBy(200);
  assert.deepEqual(backlog.getSnapshot().map(entry => [entry.kind, entry.nodeId]), [['dialogue', 1], ['dialogue', 2]]);
  assert.equal(runner.getSnapshot().choiceHistory[0].debugOverride, true);
  assert.equal(runner.getSnapshot().choiceHistory[0].optionId, 11);
  assert.equal(runner.getSnapshot().stageEvents.filter(event => event.phase === 'option').length, 5);
  runner.dispose();
});

test('real 17048/2 optionId 5 records the selected response once and retains history after FinishTalk', () => {
  const { clock, runner, reading, backlog } = real('17048');
  assert.equal(reading.advance(), 'revealed');
  clock.advanceBy(200);
  assert.equal(reading.advance(), 'advanced');
  clock.advanceBy(200);
  const source = runner.getSnapshot();
  assert.equal(source.nid, 2);
  assert.equal(reading.advance(source), 'revealed');
  clock.advanceBy(200);
  const index = source.choices.findIndex(choice => choice.optionId === 5);
  assert.equal(reading.choose(index, source), true);
  assert.equal(reading.choose(index, source), false);
  assert.equal(runner.getSnapshot().status, 'completed');
  const entries = backlog.getSnapshot();
  assert.deepEqual(entries.map(entry => [entry.kind, entry.nodeId]), [['dialogue', 1], ['dialogue', 2], ['choice', 2]]);
  assert.equal(entries[2].document.text, 'Maybe another time.');
  assert.equal(entries[2].visitId, source.visitId);
  assert.equal(runner.getSnapshot().choiceHistory.length, 1);
  clock.advanceBy(10_000);
  assert.equal(backlog.getSnapshot(), entries);
  runner.restart();
  assert.deepEqual(backlog.getSnapshot().map(entry => entry.nodeId), [1]);
  runner.dispose();
});
