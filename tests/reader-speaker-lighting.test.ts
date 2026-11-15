import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import { StageTransitions } from '../src/engine/StageTransitions.ts';
import { initialStageState, reduceStageEvent } from '../src/engine/StageState.ts';
import { validateManifest } from '../src/engine/validation.ts';
import type { Script, Speaker, StageEvent, StageOp } from '../src/engine/types.ts';
import { FakeClock } from './FakeClock.ts';
import { fixture, manifest as fixtureManifest, node, option } from './fixtures.ts';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = validateManifest(read('../public/data/manifest.json'));
const speakers: Readonly<Record<string, Speaker>> = read('../public/data/speakers.json');
const brightness = (runner: ScriptRunner, who: string) => runner.getSnapshot().presentation.characters.find(view => view.character.who === who)!.brightness;

function realScene(id: string) {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock });
  assert.equal(runner.load(read(`../public/data/scripts/${id}.json`), manifest, { speakers }), true);
  assert.equal(runner.start(), true);
  function to(nid: number) {
    for (let i = 0; i < 300; i++) {
      if (runner.getSnapshot().nid === nid) { clock.advanceBy(3000); return; }
      clock.advanceBy(3000);
      const state = runner.getSnapshot();
      assert.notEqual(state.status, 'completed', `Scene ${id} ended before ${nid}`);
      assert.notEqual(state.status, 'error', state.error?.message ?? 'Unexpected scene error');
      if (state.status === 'choices') assert.equal(runner.overrideChoice(0), true);
      else if (state.status === 'dialogue') assert.equal(runner.advance(), true);
    }
    assert.fail(`Scene ${id} did not reach ${nid}`);
  }
  return { clock, runner, to };
}

test('1008 refreshes speaking color at 63 and 64, honors narration65 Highlight, and switches at66', () => {
  const { runner, to } = realScene('1008');
  try {
    const expected = [
      [61, .58, 1], [62, .58, .58], [63, 1, .58],
      [64, 1, .58], [65, 1, .58], [66, .58, 1],
    ];
    for (const [nid, left, right] of expected) {
      to(nid);
      assert.equal(brightness(runner, '50074'), left, `Cartethyia at ${nid}`);
      assert.equal(brightness(runner, '150036'), right, `Ciaccona at ${nid}`);
      for (const who of ['50074', '150036']) {
        const view = runner.getSnapshot().presentation.characters.find(v => v.character.who === who)!;
        assert.equal(view.portraitOpacity, 1, `Color leaves ${who}'s alpha opaque`);
      }
      assert.ok(runner.getSnapshot().stageEvents.every(e => e.operation.op !== 'speakerFocus'), 'Focus does not synthesize authored performances.');
    }
  } finally { runner.dispose(); }
});

test('1006 named Shorekeeper speaker uses the same resource talker as entered actor1398', () => {
  const { runner, to } = realScene('1006');
  try {
    assert.equal(speakers['701282'].talkerId, speakers['1398'].talkerId);
    to(8); assert.equal(brightness(runner, '1398'), 1, 'Narration honors its fresh explicit Highlight.');
    to(9); assert.equal(runner.getSnapshot().dialogue?.speakerId, '701282');
    assert.equal(brightness(runner, '1398'), 1, 'A distinct WhoId speaking through the same portrait receives focus.');
    assert.equal(brightness(runner, '750088'), .58);
    to(10); assert.equal(brightness(runner, '1398'), .58, 'The previous portrait dims on the next speaker.');
    to(11); assert.equal(brightness(runner, '1398'), 1);
  } finally { runner.dispose(); }
});

test('voice metadata does not determine focus and explicit delayed colors retain their source deadline', () => {
  const story = fixture([
    node(1, { speakerId: 'left', stage: [
      { op: 'enter', t: 0, who: 'left', hideAvatar: true },
      { op: 'enter', t: 0, who: 'right', hideAvatar: true },
    ] }),
    node(2, { speakerId: 'right', voice: ['voice-one'], stage: [
      { op: 'modify', t: .3, who: 'right', effect: 'Darken' },
      { op: 'move', t: .5, who: 'left', effect: 'Highlight', pos: [200, 0, 1], dur: 1 },
    ] }),
    node(3, { speakerId: 'right', voice: [], stage: [] }),
  ]);
  const outcomes: unknown[] = [];
  for (const voiced of [true, false]) {
    const clock = new FakeClock(), runner = new ScriptRunner({ clock });
    const input: Script = voiced ? story : { ...story, nodes: story.nodes.map(n => ({ ...n, voice: [] })) };
    assert.equal(runner.load(input, fixtureManifest), true); runner.start(); runner.advance();
    clock.advanceBy(208); // Include the shared renderer's next 16ms publication.
    assert.equal(brightness(runner, 'right'), 1); assert.equal(brightness(runner, 'left'), .58);
    clock.advanceBy(91); assert.equal(brightness(runner, 'right'), 1);
    clock.advanceBy(1); assert.equal(brightness(runner, 'right'), 1, 'The delayed color starts at .3s and runs its independent 200ms track.');
    assert.equal(runner.getSnapshot().presentation.transitions.find(t => t.target === 'right' && t.property === 'brightness')?.startedAtMs, 300);
    clock.advanceBy(200); assert.equal(brightness(runner, 'right'), .58);
    assert.equal(brightness(runner, 'left'), .58, 'A Move Highlight starts its color track at the authored .5s deadline.');
    const move = runner.getSnapshot().presentation.characters.find(v => v.character.who === 'left')!;
    assert.equal(move.position[0], 0, 'Color does not consume the authored movement timeline.');
    clock.advanceBy(208); assert.equal(brightness(runner, 'left'), 1, 'The Move RoleConfig Highlight overrides the current nonspeaker.');
    runner.advance(); clock.advanceBy(208);
    assert.equal(brightness(runner, 'left'), .58); assert.equal(brightness(runner, 'right'), 1, 'A line without stage actions refreshes focus.');
    outcomes.push(runner.getSnapshot().presentation.characters.map(v => ({ who: v.character.who, brightness: v.brightness, opacity: v.portraitOpacity, position: v.position })));
    runner.dispose(); assert.equal(clock.pendingTimers, 0);
  }
  assert.deepEqual(outcomes[0], outcomes[1]);
});

test('NoText preserves prior speaker focus while applying its own explicit color cue', () => {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock });
  const story = fixture([
    node(1, { speakerId: 'left', stage: [
      { op: 'enter', t: 0, who: 'left' }, { op: 'enter', t: 0, who: 'right' },
    ] }),
    node(0, { kind: 'silent', style: 'VisualNovelNoTextItem', speakerId: null, textKey: null, stage: [
      { op: 'modify', who: 'right', effect: 'Highlight', t: .1 },
      { op: 'modify', who: 'right', expr: 1, t: .5 },
    ] }),
    node(2, { speakerId: 'right', stage: [] }),
  ]);
  assert.equal(runner.load(story, fixtureManifest), true); runner.start(); runner.advance();
  assert.equal(runner.getSnapshot().nid, 0);
  assert.equal(brightness(runner, 'left'), 1); assert.equal(brightness(runner, 'right'), .58);
  clock.advanceBy(100);
  assert.equal(brightness(runner, 'left'), 1); assert.equal(brightness(runner, 'right'), .58, 'A NoText explicit cue starts at its authored deadline.');
  assert.equal(runner.getSnapshot().presentation.transitions.find(t => t.target === 'right' && t.property === 'brightness')?.durationMs, 200);
  clock.advanceBy(608);
  assert.equal(runner.getSnapshot().nid, 2);
  assert.equal(brightness(runner, 'left'), .58); assert.equal(brightness(runner, 'right'), 1);
  runner.dispose(); assert.equal(clock.pendingTimers, 0);
});

test('a speaker color transition leaves in-flight portrait opacity and movement tracks independent', () => {
  const transitions = new StageTransitions(); let state = initialStageState(1), sequence = 0;
  function apply(operation: StageOp) {
    const event: StageEvent = { type: 'stage', runId: 1, sequence: ++sequence, scriptId: 'fixture', flowActionIndex: 1, nid: 1, visitId: 1, phase: 'start', source: 'node', disposition: 'state', operation };
    const next = reduceStageEvent(state, event);
    transitions.apply(state, next, event, false, 0); state = next;
  }
  transitions.beginVisit(state, node(1, { speakerId: 'left' }), 1, 0);
  apply({ op: 'enter', who: 'left', t: 0, fadeIn: 1, hideAvatar: true });
  apply({ op: 'enter', who: 'right', t: 0, fadeIn: 1, hideAvatar: true });
  transitions.beginVisit(state, node(2, { speakerId: 'right', stage: [] }), 2, 500);
  const middle = transitions.project(state, 600).characters;
  assert.equal(middle[0].portraitOpacity, .6); assert.equal(middle[1].portraitOpacity, .6);
  assert.equal(middle[0].brightness, .79); assert.equal(middle[1].brightness, .79);
  const settled = transitions.project(state, 700).characters;
  assert.equal(settled[0].brightness, .58); assert.equal(settled[1].brightness, 1);
  assert.equal(settled[0].portraitOpacity, .7); assert.equal(settled[1].portraitOpacity, .7);
});

test('1008 checkpoint restores an explicit narration Highlight without reapplying starts or a color burst', () => {
  const { runner, to } = realScene('1008');
  try {
    to(65); const saved = runner.createCheckpoint(); assert.ok(saved);
    to(66); assert.equal(brightness(runner, '50074'), .58);
    assert.equal(runner.restoreCheckpoint(saved), true);
    assert.equal(runner.getSnapshot().nid, 65);
    assert.equal(brightness(runner, '50074'), 1); assert.equal(brightness(runner, '150036'), .58);
    assert.equal(runner.getSnapshot().stageEvents.length, 0);
    assert.equal(runner.getSnapshot().presentation.transitions.length, 0);
  } finally { runner.dispose(); }
});

test('rapid text visits preserve the native color target, then reverse from the rendered brightness', () => {
  const transitions = new StageTransitions(); let state = initialStageState(1), sequence = 0;
  function apply(operation: StageOp, now: number) {
    const event: StageEvent = { type: 'stage', runId: 1, sequence: ++sequence, scriptId: 'fixture', flowActionIndex: 1, nid: 1, visitId: 1, phase: 'start', source: 'node', disposition: 'state', operation };
    const next = reduceStageEvent(state, event);
    transitions.apply(state, next, event, false, now); state = next;
  }
  const colors = (now: number) => transitions.project(state, now).characters.map(v => v.brightness);
  transitions.beginVisit(state, node(1, { speakerId: 'left' }), 1, 0);
  apply({ op: 'enter', who: 'left', t: 0 }, 0); apply({ op: 'enter', who: 'right', t: 0 }, 0);
  transitions.beginVisit(state, node(2, { speakerId: 'right' }), 2, 0);
  transitions.beginVisit(state, node(3, { speakerId: 'right', stage: [] }), 3, 50);
  assert.deepEqual(colors(100), [.79, .79]);
  assert.ok(transitions.project(state, 100).transitions.every(t => t.startedAtMs === 0), 'Repeating the same target keeps the ongoing native color track.');
  transitions.beginVisit(state, node(4, { speakerId: 'left', stage: [] }), 4, 100);
  assert.deepEqual(colors(100), [.79, .79], 'A reversal starts from current rendered brightness, without a jump.');
  const halfway = colors(200);
  assert.ok(Math.abs(halfway[0]! - .895) < 1e-9);
  assert.ok(Math.abs(halfway[1]! - .685) < 1e-9);
  apply({ op: 'modify', who: 'right', t: 0, effect: 'Darken' }, 200);
  assert.ok(transitions.project(state, 200).transitions.every(t => t.startedAtMs === 100), 'An explicit matching target also preserves the track.');
  assert.deepEqual(colors(300), [1, .58]);
  assert.ok(transitions.project(state, 300).characters.every(v => v.portraitOpacity === 1));
});

test('a nontext choice preserves focus, honors option color timing, then refreshes on the next speaker visit', () => {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock });
  const story = fixture([
    node(1, { speakerId: 'left', stage: [
      { op: 'enter', t: 0, who: 'left' }, { op: 'enter', t: 0, who: 'right' },
    ] }),
    node(2, { kind: 'option', speakerId: null, textKey: null, options: [option({ performances: [
      { op: 'modify', t: .1, phase: 'option', who: 'left', effect: 'Darken', fadeOut: 1 },
      { op: 'modify', t: .1, phase: 'option', who: 'right', effect: 'Highlight', fadeIn: 1 },
      { op: 'modify', t: .5, phase: 'option', who: 'right', expr: 1 },
    ] })] }),
    node(3, { speakerId: 'left', stage: [] }),
  ]);
  try {
    assert.equal(runner.load(story, fixtureManifest), true); runner.start(); runner.advance();
    assert.equal(runner.getSnapshot().status, 'choices');
    assert.equal(brightness(runner, 'left'), 1); assert.equal(brightness(runner, 'right'), .58);
    const saved = runner.createCheckpoint(); assert.ok(saved);
    assert.equal(runner.choose(0), true); clock.advanceBy(400);
    assert.equal(runner.getSnapshot().nid, 2, 'Authored option performances retain the choice boundary.');
    assert.equal(brightness(runner, 'left'), .58); assert.equal(brightness(runner, 'right'), 1);
    clock.advanceBy(308);
    assert.equal(runner.getSnapshot().nid, 3);
    assert.equal(brightness(runner, 'left'), 1); assert.equal(brightness(runner, 'right'), .58);
    assert.equal(runner.restoreCheckpoint(saved), true);
    assert.equal(runner.getSnapshot().status, 'choices');
    assert.equal(brightness(runner, 'left'), 1); assert.equal(brightness(runner, 'right'), .58);
    assert.equal(runner.getSnapshot().stageEvents.length, 0, 'Restoring a choice does not execute source cues.');
  } finally { runner.dispose(); assert.equal(clock.pendingTimers, 0); }
});

test('leaving playback cancels pending cues and a new stage cannot inherit a prior override for the same actor', () => {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock });
  const old = fixture([node(1, { speakerId: 'left', stage: [
    { op: 'enter', t: 0, who: 'left', effect: 'Darken' },
    { op: 'enter', t: 0, who: 'right', effect: 'Highlight' },
    { op: 'modify', t: .5, who: 'left', effect: 'Darken' },
  ] })]);
  const fresh = fixture([node(9, { speakerId: 'left', stage: [
    { op: 'enter', t: 0, who: 'left' }, { op: 'enter', t: 0, who: 'right' },
  ] })]);
  try {
    assert.equal(runner.load(old, fixtureManifest), true); runner.start();
    assert.equal(brightness(runner, 'left'), .58); assert.equal(brightness(runner, 'right'), 1);
    assert.ok(clock.pendingTimers > 0);
    assert.equal(runner.endStagePlayback(), true);
    assert.equal(runner.getSnapshot().presentation.characters.length, 0);
    assert.equal(runner.getSnapshot().pendingStage.length, 0); assert.equal(clock.pendingTimers, 0);
    assert.equal(runner.load(fresh, fixtureManifest, { continuation: true, preserveStoryState: true }), true); runner.start();
    clock.advanceBy(1000);
    assert.equal(runner.getSnapshot().nid, 9);
    assert.equal(brightness(runner, 'left'), 1); assert.equal(brightness(runner, 'right'), .58);
    assert.ok(runner.getSnapshot().presentation.characters.every(v => v.portraitOpacity === 1));
    assert.equal(runner.getSnapshot().stageEvents.some(e => e.nid === 1 && e.operation.t === .5), false, 'An abandoned old color callback never reaches the new stage.');
  } finally { runner.dispose(); assert.equal(clock.pendingTimers, 0); }
});
