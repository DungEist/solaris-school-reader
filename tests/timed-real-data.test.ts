import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import type { StageState } from '../src/engine/StageState.ts';
import type { Script } from '../src/engine/types.ts';
import { validateManifest } from '../src/engine/validation.ts';
import { FakeClock } from './FakeClock.ts';

const root = new URL('../public/data/', import.meta.url);
const read = async (path: string) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const manifest = validateManifest(await read('manifest.json'));
const scripts = new Map<string, Script>(await Promise.all(['1001', '1004', '1015', '9015', '6012', '17048', '3018', '1053'].map(async id => [id, await read(`scripts/${id}.json`)] as const)));

function logicalState(state: StageState) {
  return {
    background: state.background?.id ?? null,
    cg: state.cg ? { kind: state.cg.kind, id: state.cg.id } : null,
    blackScreen: state.blackScreen?.visible ?? false,
    characters: Object.fromEntries(Object.values(state.characters).map(character => {
      const { lastEvent: _lastEvent, ...record } = character;
      return [record.who, { ...record, portraitEffect: record.portraitEffect }];
    })),
    issues: state.issues.map(issue => issue.code),
  };
}

function play(id: string, instantTransitions: boolean, dwell = 10_000, finishOption = false) {
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock, instantTransitions });
  assert.equal(runner.load(scripts.get(id), manifest), true, runner.getSnapshot().error?.message ?? `Timed script ${id} failed to load`);
  runner.start();
  let steps = 0;
  while (runner.getSnapshot().status !== 'completed') {
    assert.ok(++steps < 500, `Timed script ${id} did not complete`);
    const status = runner.getSnapshot().status;
    assert.notEqual(status, 'error', runner.getSnapshot().error?.message ?? `Timed script ${id} failed`);
    clock.advanceBy(dwell);
    const snapshot = runner.getSnapshot();
    if (snapshot.status === 'completed') break;
    if (snapshot.status === 'running' || snapshot.status === 'ending') {
      clock.advanceBy(5000);
      continue;
    }
    if (snapshot.status === 'choices') {
      const index = id === '17048' ? snapshot.choices.findIndex(option => option.optionId === (finishOption ? 5 : 3)) : 0;
      assert.ok(index >= 0);
      // Compare stage timing on authored edges, independently of unknown
      // management prerequisites after this direct Developer scene load.
      assert.equal(runner.overrideChoice(index), true);
    } else { assert.equal(snapshot.status, 'dialogue'); runner.advance(); }
  }
  clock.advanceBy(25_000); // End-phase visual tracks may outlive logical completion.
  const snapshot = runner.getSnapshot();
  assert.equal(snapshot.pendingStage.length, 0);
  assert.equal(snapshot.presentation.transitions.length, 0);
  assert.equal(snapshot.stageState.appliedEvents, snapshot.stageEvents.length);
  assert.equal(snapshot.events.filter(event => event.type === 'completed').length, 1);
  runner.dispose();
  assert.equal(clock.pendingTimers, 0);
  return snapshot;
}

test('timed, interrupted and instant playback have identical final stage state and operation order for representative real scripts', t => {
  for (const id of scripts.keys()) {
    const instant = play(id, true);
    for (const dwell of [10_000, 0]) {
      const timed = play(id, false, dwell);
      assert.deepEqual(logicalState(timed.stageState), logicalState(instant.stageState), `Script ${id}, dwell ${dwell} final logical state`);
      const operations = (snapshot: typeof timed) => snapshot.stageEvents.map(event => ({ phase: event.phase, nid: event.nid, flow: event.flowActionIndex, visit: event.visitId, operation: event.operation }));
      assert.deepEqual(operations(timed), operations(instant), `Script ${id}, dwell ${dwell} operation order`);
      assert.deepEqual(timed.navigationHistory, instant.navigationHistory, `Script ${id} navigation`);
    }
  }
  t.diagnostic('8 real scripts; 24 timed/instant/rapid completed routes, with identical stage state and operation order.');
});

test('real 17048 nid 2 optionId 5 FinishTalk remains correct in timed and instant modes', () => {
  for (const instant of [false, true]) {
    const result = play('17048', instant, 0, true);
    assert.equal(result.choiceHistory[0].optionId, 5);
    assert.deepEqual(result.events.filter(event => event.type === 'dialogue').map(event => event.node.nid), [1, 2]);
    assert.ok(!result.navigationHistory.some(entry => entry.to === 3));
  }
});

test('real source metadata exposes delays, fade fields, and raw easing without inventing image fade durations', () => {
  const nodeOf = (id: string, nid: number) => scripts.get(id)!.nodes.find(node => node.nid === nid)!;
  assert.ok(nodeOf('1001', 8).stage.some(op => op.op === 'move' && op.t === .1 && op.dur === 2));
  assert.ok(nodeOf('1004', 4).stage.some(op => op.op === 'modify' && op.t === 2));
  assert.ok(nodeOf('1004', 7).stage.some(op => op.op === 'move' && op.phase === 'end' && op.t === .5 && op.dur === .5));
  assert.ok(nodeOf('1015', 0).stage.some(op => op.op === 'blackIn' && op.screen === 'Black' && op.fade === .5));
  assert.ok(nodeOf('1015', 0).stage.some(op => op.op === 'blackOut' && op.phase === 'end' && op.t === .5 && op.fade === .5));
  const closingTalk = scripts.get('1015')!.flowActions.find(action => action.op === 'talk')!;
  assert.ok(closingTalk.op === 'talk');
  assert.equal(closingTalk.nids[0], 1);
  assert.equal(closingTalk.nids.at(-1), 0, 'The silent fade node follows source ShowTalk order, not numeric nid order');
  assert.ok(nodeOf('9015', 5).stage.some(op => op.op === 'blackIn' && op.phase === 'end' && op.t === .01 && op.fade === .5));
  assert.ok(nodeOf('9015', 6).stage.some(op => op.op === 'blackOut' && op.phase !== 'end' && op.t === .51 && op.fade === .5));
  const moves = [...scripts.values()].flatMap(script => script.nodes.flatMap(node => node.stage.filter(op => op.op === 'move')));
  assert.ok(moves.some(op => op.ease && (op.ease as { Type: string }).Type === 'Preset'), 'Builder must preserve actual source easing metadata');
  const images = [...scripts.values()].flatMap(script => script.nodes.flatMap(node => node.stage.filter(op => ['bg', 'cg'].includes(op.op))));
  assert.ok(images.length > 0);
  assert.ok(images.every(op => op.fade === undefined && op.fadeIn === undefined && op.fadeOut === undefined));
  assert.ok(images.every(op => op.raw), 'Original image config remains available for inspection');
});
