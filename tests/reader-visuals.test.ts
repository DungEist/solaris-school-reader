import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveCG } from '../src/assets/AssetResolver.ts';
import { readerCGFraming } from '../src/ui/StageImageFraming.ts';
import { changliAssets } from './changli-fixtures.ts';
import { StageTransitions } from '../src/engine/StageTransitions.ts';
import { initialStageState, reduceStageEvent } from '../src/engine/StageState.ts';
import type { StageEvent, StageOp } from '../src/engine/types.ts';

test('Reader CG framing follows the measured SolarSchool format while retaining contain for other dimensions or sources', () => {
  const mapping = JSON.parse(readFileSync(new URL('../public/assets/solarschool/asset-map.json', import.meta.url), 'utf8'));
  const assets = { ...changliAssets, mapping };
  for (const id of [700006, 700012]) for (const gender of ['male', 'female'] as const) {
    const cg = resolveCG(assets, id, gender);
    assert.equal(readerCGFraming(cg), 'height-fit');
    assert.equal(readerCGFraming({ ...cg, width: 1500, height: 900 }), 'contain');
    assert.equal(readerCGFraming({ ...cg, repositoryPath: 'unrelated/illustration.webp' }), 'contain');
    assert.equal(readerCGFraming({ ...cg, kind: 'background' }), 'contain');
  }
});

test('dimming uses the native 200ms color duration while portrait and avatar visibility fade independently', () => {
  const model = new StageTransitions(); let state = initialStageState(1), sequence = 0;
  function apply(operation: StageOp, now: number) {
    const event: StageEvent = { type: 'stage', scriptId: 'fixture', flowActionIndex: 1, nid: 1, runId: 1, sequence: ++sequence, source: 'node', visitId: 1, phase: 'start', operation, disposition: 'state' };
    const next = reduceStageEvent(state, event); model.apply(state, next, event, false, now); state = next;
  }
  const view = (now: number) => model.project(state, now).characters[0];
  apply({ op: 'enter', who: '750088', hidePortrait: true, hideAvatar: false, effect: 'Darken', fadeIn: 1, t: 0 }, 0);
  assert.equal(view(500).portraitOpacity, 0); assert.equal(view(500).avatarOpacity, .5); assert.equal(view(500).brightness, .58);
  assert.equal(view(1000).avatarOpacity, 1);
  apply({ op: 'modify', who: '750088', effect: 'Highlight', fadeIn: 1, t: 0 }, 1000);
  assert.equal(view(1100).brightness, .79); assert.equal(view(1100).avatarOpacity, 1);
  apply({ op: 'modify', who: '750088', effect: 'Darken', fadeOut: .5, t: 0 }, 1100);
  assert.ok(Math.abs(view(1200).brightness! - .685) < 1e-9, 'Color retargets from the currently sampled value.');
  assert.equal(view(1200).avatarOpacity, 1);
  assert.equal(view(1300).brightness, .58, 'The .5s fade field does not extend the 200ms color track.');
  apply({ op: 'modify', who: '750088', hideAvatar: true, hidePortrait: false, fadeIn: 1, fadeOut: .5, t: 0 }, 2000);
  assert.equal(view(2250).portraitOpacity, .25); assert.equal(view(2250).avatarOpacity, .5); assert.equal(view(2250).brightness, .58);
  assert.equal(view(3000).portraitOpacity, 1); assert.equal(view(3000).avatarOpacity, 0);
});
