import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { initialStageState, reduceStageEvent } from '../src/engine/StageState.ts';
import { staticStagePresentation } from '../src/engine/StageTransitions.ts';
import { ChangliSpineActor } from '../src/spine/ChangliSpineScene.ts';
import type { SpinePortraitProfile } from '../src/spine/ChangliSpineScene.ts';
import { abbyPortrait, readSchoolExpressions, schoolPortraits } from '../src/spine/SchoolPortraitAssets.ts';
import { fullSpine } from './changli-fixtures.ts';

const verina = schoolPortraits.find(definition => definition.slug === 'verina')!;
const fixtures = [abbyPortrait, verina].map(definition => {
  const root = new URL(`../public/assets/solarschool/characters/${definition.slug}/`, import.meta.url);
  const atlas = new fullSpine.TextureAtlas(readFileSync(new URL(`${definition.stem}.atlas`, root), 'utf8'));
  for (const page of atlas.pages) page.texture = new fullSpine.Texture({ width: page.width, height: page.height });
  const data = new fullSpine.SkeletonBinary(new fullSpine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(readFileSync(new URL(`${definition.stem}.skel`, root))));
  const expressions = readSchoolExpressions(JSON.parse(readFileSync(new URL(definition.metadataFile ?? `${definition.name}.animation-metadata.json`, root), 'utf8')), definition);
  return { definition, data, expressions,
    iris: definition === abbyPortrait ? '01_A_眼珠' : 'A_03_眼珠',
    catchlight: definition === abbyPortrait ? '01_A_高光' : 'A_03_高亮' };
});

function viewFor(expression: number) {
  return staticStagePresentation(reduceStageEvent(initialStageState(1), {
    type: 'stage', scriptId: 'catchlight-source-comparison', flowActionIndex: 1, runId: 1, sequence: 1, visitId: 1,
    nid: 1, source: 'node', phase: 'start', disposition: 'state', operation: { op: 'enter', t: 0, who: 'source-eye', expr: expression },
  })).characters[0];
}

function mesh(skeleton: any, name: string): number[] {
  const slot = skeleton.findSlot(name), attachment = slot.attachment;
  assert.ok(attachment, `Source eye layer ${name} is attached.`);
  const result = new Float32Array(attachment.worldVerticesLength);
  attachment.computeWorldVertices(slot, 0, result.length, result, 0, 2);
  return [...result].map((value, index) => (value - (index % 2 ? skeleton.y : skeleton.x)) / (index % 2 ? skeleton.scaleY : skeleton.scaleX));
}

function maxDifference(left: number[], right: number[]): number {
  assert.equal(left.length, right.length);
  return Math.max(...left.map((value, index) => Math.abs(value - right[index])));
}

function sourceAt(fixture: typeof fixtures[number], expressionId: number, time: number) {
  const skeleton = new fullSpine.Skeleton(fixture.data), expression = fixture.expressions.get(expressionId)!;
  if (fixture.data.skins.length) skeleton.setSkinByName(fixture.data.skins[0].name);
  // Independent oracle: apply the original binary clips directly, bypassing
  // the Reader's actor, track scheduler, calibration and expression lifecycle.
  for (const [name, clock] of [[expression.body, 0], [expression.mouth, 0], [expression.eye, time]] as const) {
    fixture.data.findAnimation(name).apply(skeleton, 0, clock, true, [], 1, fullSpine.MixBlend.replace, fullSpine.MixDirection.mixIn);
  }
  skeleton.updateWorldTransform();
  return skeleton;
}

test('Reader stage and avatar catchlight geometry matches the authored curves across repeated open-eye cycles', () => {
  for (const fixture of fixtures) {
    const expressionId = fixture.definition === abbyPortrait ? 700212 : 700136;
    const profiles: SpinePortraitProfile[] = [fixture.definition.profile, fixture.definition.avatarProfile ?? fixture.definition.profile];
    for (const profile of profiles) {
      const actor = new ChangliSpineActor(fullSpine, fixture.data, { drawSkeleton() {} }, { random: () => 0 }, profile);
      actor.setExpression(fixture.expressions.get(expressionId)!);
      const original = sourceAt(fixture, expressionId, 0), iris = mesh(original, fixture.iris), initialCatchlight = mesh(original, fixture.catchlight);
      let elapsed = 0, motion = 0;
      try {
        for (const time of [.013, .041, .077, .131, .231, .519, .811, 1.201, 1.719, 2.531]) {
          actor.render(viewFor(expressionId), time - elapsed); elapsed = time;
          const expected = sourceAt(fixture, expressionId, time);
          const actualReflection = mesh(actor.skeleton, fixture.catchlight);
          assert.ok(maxDifference(mesh(actor.skeleton, fixture.iris), iris) < .001, 'Iris stays fixed without blinking or stage movement.');
          assert.ok(maxDifference(actualReflection, mesh(expected, fixture.catchlight)) < .001, `${fixture.definition.name}: retain native phase-offset interpolation.`);
          motion = Math.max(motion, maxDifference(actualReflection, initialCatchlight));
          assert.equal(actor.animationState.getCurrent(2)!.animation.name, fixture.expressions.get(expressionId)!.eye);
        }
        assert.ok(motion > .5, `${fixture.definition.name}: reflection moves independently of the iris across multiple cycles.`);
      } finally { actor.dispose(); }
    }
  }
});

test('Abby body-only expression changes preserve catchlight phase and its pending blink start', () => {
  const fixture = fixtures[0], actor = new ChangliSpineActor(fullSpine, fixture.data, { drawSkeleton() {} }, { random: () => 0 }, abbyPortrait.profile);
  actor.setExpression(fixture.expressions.get(700212)!);
  try {
    actor.render(viewFor(700212), 1.11);
    const eye = actor.animationState.getCurrent(2)!;
    actor.setExpression(fixture.expressions.get(700228)!);
    assert.equal(actor.animationState.getCurrent(2), eye);
    assert.ok(Math.abs(eye.trackTime - 1.11) < 1e-9);
    actor.render(viewFor(700228), 1.88); assert.equal(actor.animationState.getCurrent(2), eye);
    actor.render(viewFor(700228), .02);
    const blink = actor.animationState.getCurrent(2)!, duration = blink.animation.duration;
    assert.equal(blink.animation.name, 'dongzuo1_zhengchang_zhayan'); assert.equal(blink.loop, false);
    actor.render(viewFor(700228), duration - .01 + .037);
    const resumed = actor.animationState.getCurrent(2)!;
    assert.equal(resumed.animation.name, 'dongzuo1_zhengchang_zhengyan'); assert.equal(resumed.loop, true);
    assert.ok(Math.abs(resumed.trackTime - .037) < 1e-7);
    const source = sourceAt(fixture, 700228, .037);
    assert.ok(maxDifference(mesh(actor.skeleton, fixture.catchlight), mesh(source, fixture.catchlight)) < .001);
  } finally { actor.dispose(); }
});

test('Abby thinking expressions retain their static reflection instead of inheriting the normal-eye cycle', () => {
  const fixture = fixtures[0], actor = new ChangliSpineActor(fullSpine, fixture.data, { drawSkeleton() {} }, { random: () => 0 }, abbyPortrait.profile);
  try {
    actor.setExpression(fixture.expressions.get(700212)!); actor.render(viewFor(700212), .117);
    actor.setExpression(fixture.expressions.get(700215)!); actor.setBlinkEnabled(false);
    actor.render(viewFor(700215), 0);
    const before = mesh(actor.skeleton, fixture.catchlight);
    actor.render(viewFor(700215), 20);
    assert.ok(maxDifference(before, mesh(actor.skeleton, fixture.catchlight)) < .001);
    assert.ok(maxDifference(before, mesh(sourceAt(fixture, 700215, 0), fixture.catchlight)) < .001);
  } finally { actor.dispose(); }
});
