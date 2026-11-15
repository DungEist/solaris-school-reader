import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import { validateManifest } from '../src/engine/validation.ts';
import type { Script } from '../src/engine/types.ts';
import { FakeClock } from './FakeClock.ts';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8'));
const manifest = validateManifest(read('manifest.json'));
const scripts = new Map<string, Script>(['1001', '1002'].map(id => [id, read(`scripts/${id}.json`)]));

function playback(id: string, instantTransitions: boolean) {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock, instantTransitions });
  assert.equal(runner.load(scripts.get(id), manifest), true);
  assert.equal(runner.start(), true);
  const reach = (nid: number) => {
    for (let step = 0; step < 100; step++) {
      const snapshot = runner.getSnapshot();
      if (snapshot.nid === nid && ['dialogue', 'choices'].includes(snapshot.status)) return snapshot;
      assert.notEqual(snapshot.status, 'completed', `Completed before ${id}/${nid}`);
      assert.notEqual(snapshot.status, 'error', snapshot.error?.message ?? 'Unexpected runner error');
      clock.advanceBy(1500);
      if (snapshot.status === 'running' || snapshot.status === 'ending') continue;
      assert.equal(snapshot.status === 'choices' ? runner.choose(0) : runner.advance(), true);
    }
    assert.fail(`Did not reach ${id}/${nid}`);
  };
  return { runner, clock, reach, dispose() { runner.dispose(); assert.equal(clock.pendingTimers, 0); } };
}

test('1002/23 explicitly shows Abby avatar and /24 clears it while preserving the same entered character', () => {
  for (const instant of [false, true]) {
    const current = playback('1002', instant);
    try {
      const first = current.reach(23), abby = first.stageState.characters['1316'];
      assert.equal(first.dialogue?.textKey, 'EVENT_AVGmain_5_23');
      assert.equal(abby.expression, 700226);
      assert.equal(abby.hidePortrait, true); assert.equal(abby.hideAvatar, false);
      assert.equal(abby.portraitVisible, false); assert.equal(abby.avatarVisible, true);
      assert.equal(first.presentation.characters.find(view => view.character.who === '1316')!.avatarOpacity, 1);
      assert.equal(first.stageEvents.filter(event => event.operation.op === 'enter' && event.operation.who === '1316').length, 1);

      assert.equal(current.runner.advance(), true);
      const next = current.runner.getSnapshot(), changed = next.stageState.characters['1316'];
      assert.equal(next.nid, 24); assert.equal(next.dialogue?.speakerId, '1316');
      assert.equal(changed.entrySequence, abby.entrySequence, 'Visibility changes retain the original entry.');
      assert.equal(changed.expression, 700212);
      assert.equal(changed.hidePortrait, false); assert.equal(changed.hideAvatar, true);
      assert.equal(changed.portraitVisible, true); assert.equal(changed.avatarVisible, false);
      const view = next.presentation.characters.find(view => view.character.who === '1316')!;
      assert.equal(view.avatarOpacity, 0); assert.equal(view.portraitOpacity, 1);
      assert.equal(next.presentation.characters.filter(view => view.character.who === '1316').length, 1);
      current.clock.advanceBy(6000);
      assert.equal(current.runner.getSnapshot().presentation.characters.find(view => view.character.who === '1316')!.avatarOpacity, 0);
      assert.equal(current.runner.getSnapshot().stageEvents.filter(event => event.operation.op === 'enter' && event.operation.who === '1316').length, 1);
    } finally { current.dispose(); }
  }
});

test('the equivalent Abby dialogue in 1001 retains its distinct authored portrait and hidden avatar', () => {
  const current = playback('1001', false);
  try {
    current.reach(8); current.clock.advanceBy(2100);
    const entry = current.runner.getSnapshot().stageState.characters['1316'].entrySequence;
    for (const [nid, expression, y] of [[9, 700226, -400], [10, 700212, 0]] as const) {
      const snapshot = current.reach(nid), abby = snapshot.stageState.characters['1316'];
      assert.equal(abby.entrySequence, entry);
      assert.equal(abby.expression, expression);
      assert.equal(abby.portraitVisible, true); assert.equal(abby.avatarVisible, false);
      assert.equal(snapshot.presentation.characters.find(view => view.character.who === '1316')!.avatarOpacity, 0);
      current.clock.advanceBy(350);
      assert.deepEqual(current.runner.getSnapshot().stageState.characters['1316'].position, [0, y, 1], 'The authored move reaches its destination independently of VFX.');
      if (nid === 10) {
        const during = current.runner.getSnapshot();
        assert.equal(during.effects.active.find(effect => effect.name === 'Shake')?.who, '1316');
        assert.notDeepEqual(during.presentation.characters.find(view => view.character.who === '1316')!.position, [0, y, 1]);
        current.clock.advanceBy(500);
      }
      assert.deepEqual(current.runner.getSnapshot().presentation.characters.find(view => view.character.who === '1316')!.position, [0, y, 1]);
    }
  } finally { current.dispose(); }
});

test('restart and script switching at 1002/23 and /24 do not restore the previous Abby avatar or entry', () => {
  for (const nid of [23, 24]) for (const action of ['restart', 'switch']) {
    const current = playback('1002', false);
    try {
      const old = current.reach(nid);
      if (action === 'restart') assert.equal(current.runner.restart(), true);
      else { assert.equal(current.runner.load(scripts.get('1001'), manifest), true); assert.equal(current.runner.start(), true); }
      current.clock.advanceBy(6000);
      const next = current.runner.getSnapshot();
      assert.ok(next.runId > old.runId);
      assert.equal(next.stageState.characters['1316'], undefined);
      assert.ok(!next.presentation.characters.some(view => view.character.who === '1316'));
      assert.ok(next.stageEvents.every(event => event.runId === next.runId));
    } finally { current.dispose(); }
  }
});

test('both real consecutive Rover pairs retain authored avatar identity while Abby dims, moves and exits independently', () => {
  for (const [id, firstNid] of [['1001', 21], ['1002', 35]] as const) {
    const current = playback(id, false);
    try {
      current.reach(firstNid); current.clock.advanceBy(500);
      const first = current.runner.getSnapshot(), rover = first.stageState.characters['750088'];
      assert.equal(rover.expression, 700129); assert.equal(rover.hidePortrait, true); assert.equal(rover.hideAvatar, false);
      assert.equal(first.presentation.characters.find(v => v.character.who === '1316')!.brightness, .58);
      current.runner.advance(); current.clock.advanceBy(325);
      const next = current.runner.getSnapshot(), inherited = next.stageState.characters['750088'];
      assert.equal(next.nid, firstNid + 1); assert.equal(inherited.entrySequence, rover.entrySequence);
      assert.equal(inherited.expression, 700129); assert.equal(inherited.avatarVisible, true); assert.equal(inherited.portraitVisible, false);
      assert.equal(next.presentation.characters.find(v => v.character.who === '750088')!.avatarOpacity, 1);
      assert.equal(next.presentation.characters.find(v => v.character.who === '1316')!.brightness, .58);
      current.clock.advanceBy(350);
      assert.deepEqual(current.runner.getSnapshot().presentation.characters.find(v => v.character.who === '1316')!.position, [0, 0, 1]);
      if (id === '1001') { current.runner.advance(); current.clock.advanceBy(250); assert.equal(current.runner.getSnapshot().stageState.characters['1316'].present, false); }
    } finally { current.dispose(); }
  }
});
