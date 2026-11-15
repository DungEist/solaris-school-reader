import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { initialStageState, reduceStageEvent } from '../src/engine/StageState.ts';
import { StageTransitions, staticStagePresentation } from '../src/engine/StageTransitions.ts';
import type { StageEvent, StageOp } from '../src/engine/types.ts';
import { ChangliSpineActor, changliSpineProfile } from '../src/spine/ChangliSpineScene.ts';
import type { SpinePortraitProfile } from '../src/spine/ChangliSpineScene.ts';
import { readSchoolExpressions, schoolPortraits } from '../src/spine/SchoolPortraitAssets.ts';
import type { SchoolPortraitDefinition } from '../src/spine/SchoolPortraitAssets.ts';
import { readSourcePortraitPlacement, sourcePortraitProfile } from '../src/spine/SourcePortraitPlacement.ts';
import { changliAssets, changliResources, changliSkeletonData, fullSpine } from './changli-fixtures.ts';

const read = (path: string) => JSON.parse(readFileSync(new URL(`../public/data/${path}`, import.meta.url), 'utf8'));
const sourceOperation = (script: string, nid: number, op: string, who: string): StageOp =>
  read(`scripts/${script}.json`).nodes.find((node: any) => node.nid === nid).stage.find((value: StageOp) => value.op === op && value.who === who);
const placement = (talkerId: number) => changliAssets.manifest.talkers![String(talkerId)].portraitTransform;
const definition = (slug: string) => schoolPortraits.find(value => value.slug === slug)!;

function resource(value: SchoolPortraitDefinition) {
  const root = new URL(`../public/assets/solarschool/characters/${value.slug}/`, import.meta.url);
  const atlas = new fullSpine.TextureAtlas(readFileSync(new URL(`${value.stem}.atlas`, root), 'utf8'));
  for (const page of atlas.pages) page.texture = new fullSpine.Texture({ width: page.width, height: page.height });
  const data = new fullSpine.SkeletonBinary(new fullSpine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(readFileSync(new URL(`${value.stem}.skel`, root))));
  const metadata = JSON.parse(readFileSync(new URL(value.metadataFile ?? `${value.name}.animation-metadata.json`, root), 'utf8'));
  return { data, expressions: readSchoolExpressions(metadata, value) };
}

function presentation(operation: StageOp) {
  const event: StageEvent = { type: 'stage', scriptId: 'source-placement', nid: 1, flowActionIndex: 1, runId: 1, sequence: 1, visitId: 1, phase: 'start', source: 'node', disposition: 'state', operation };
  return staticStagePresentation(reduceStageEvent(initialStageState(1), event)).characters[0];
}

function bounds(actor: ChangliSpineActor) {
  const offset = new fullSpine.Vector2(), size = new fullSpine.Vector2();
  (actor.skeleton as any).getBounds(offset, size);
  return { x: offset.x, y: offset.y, width: size.x, height: size.y };
}

test('matching 1007/6 Shorekeeper keeps source skeleton units and torso framing across viewport fitting', () => {
  const shorekeeper = definition('shorekeeper'), loaded = resource(shorekeeper);
  const profile = sourcePortraitProfile(shorekeeper.profile, placement(shorekeeper.talkerId));
  const actor = new ChangliSpineActor(fullSpine, loaded.data, { drawSkeleton() {} }, {}, profile);
  const entry = sourceOperation('1007', 6, 'enter', '1398');
  try {
    assert.ok(typeof entry.expr === 'number');
    actor.setExpression(loaded.expressions.get(entry.expr!)!);
    actor.setBlinkEnabled(false);
    actor.render(presentation(entry), 1.6);
    assert.equal(loaded.data.version, '4.1.23');
    assert.deepEqual([actor.skeleton.x, actor.skeleton.y], [1270, -30]);
    assert.equal(actor.skeleton.scaleX, .45);
    assert.equal(actor.skeleton.scaleY, .45);
    const geometry = bounds(actor), frame = profile.calibration.frame;
    assert.ok(geometry.height / .45 > 5200, 'The binary retains authored skeleton units rather than a normalized body height.');
    for (const [width, height] of [[1659, 933], [1920, 1080]]) {
      const zoom = Math.max(frame.width / width, frame.height / height);
      const top = (height / 2 - (geometry.y + geometry.height - frame.height / 2) / zoom) / height;
      const paintedWidth = geometry.width / zoom / width;
      assert.ok(top > .13 && top < .16, `Matching reference head/torso framing at ${width}×${height}`);
      assert.ok(paintedWidth > .28 && paintedWidth < .32, 'Shorekeeper must not return to the previous 15% stage-width full-body fit.');
      assert.ok(geometry.height / zoom / height > 1.6, 'The authored body extends beneath the stage while the torso remains in frame.');
    }
    const root = [actor.skeleton.x, actor.skeleton.y, actor.skeleton.scaleX];
    actor.setExpression(loaded.expressions.get(700091)!);
    actor.render(presentation(entry), .2);
    assert.deepEqual([actor.skeleton.x, actor.skeleton.y, actor.skeleton.scaleX], root, 'A different expression never refits the skeleton or changes its origin.');
  } finally { actor.dispose(); }
});

test('real 1001 movement and 1009 zoom retain source durations, proportional scales and animation clocks', () => {
  const abby = definition('abby'), abbyResources = resource(abby);
  const cases: { profile: SpinePortraitProfile; data: any; expression: any; entry: StageOp; preparation?: StageOp; move: StageOp; duration: number; baseScale: number; positions: readonly (readonly [number, number, number])[] }[] = [
    { profile: sourcePortraitProfile(abby.profile, placement(abby.talkerId)), data: abbyResources.data, expression: abbyResources.expressions.get(700226),
      entry: sourceOperation('1001', 8, 'enter', '1316'), preparation: sourceOperation('1001', 8, 'move', '1316'), move: sourceOperation('1001', 9, 'move', '1316'), duration: .2, baseScale: .25,
      positions: [[0, -500, 1], [0, -450, 1], [0, -400, 1]] },
    { profile: sourcePortraitProfile(changliSpineProfile, placement(850006)), data: changliSkeletonData, expression: changliResources.expressions.get(700048),
      entry: sourceOperation('1009', 5, 'enter', '999'), move: sourceOperation('1009', 20, 'move', '999'), duration: .7, baseScale: .34,
      positions: [[0, 0, 1.02], [0, 0, 1.06], [0, 0, 1.1]] },
  ];
  for (const value of cases) {
    let state = initialStageState(1), sequence = 0;
    const transitions = new StageTransitions();
    const apply = (operation: StageOp, instant: boolean) => {
      const event: StageEvent = { type: 'stage', scriptId: 'source-placement', nid: 1, flowActionIndex: 1, runId: 1, sequence: ++sequence, visitId: 1, phase: 'start', source: 'node', disposition: 'state', operation };
      const next = reduceStageEvent(state, event);
      transitions.apply(state, next, event, instant, 0); state = next;
    };
    const actor = new ChangliSpineActor(fullSpine, value.data, { drawSkeleton() {} }, {}, value.profile);
    try {
      apply(value.entry, true);
      if (value.preparation) apply(value.preparation, true);
      actor.setExpression(value.expression); actor.setBlinkEnabled(false);
      const track = actor.animationState.getCurrent(0);
      apply(value.move, false);
      assert.equal(value.move.dur, value.duration);
      const y: number[] = [];
      for (let index = 0; index < 3; index++) {
        const now = index * value.duration * 500;
        const view = transitions.project(state, now).characters[0];
        assert.deepEqual(view.position, value.positions[index]);
        actor.render(view, index ? value.duration / 2 : 0);
        assert.equal(actor.skeleton.scaleX, actor.skeleton.scaleY);
        assert.ok(Math.abs(actor.skeleton.scaleX - value.baseScale * view.position[2]) < 1e-12);
        assert.equal(actor.animationState.getCurrent(0), track, 'Movement and zoom do not restart expression tracks.');
        y.push(actor.skeleton.y);
      }
      assert.ok(Math.abs(track!.trackTime - value.duration) < 1e-9);
      assert.equal(transitions.project(state, value.duration * 1000).transitions.length, 0);
      if (value.preparation) for (const [index, expected] of [220, 270, 320].entries()) {
        assert.ok(Math.abs(y[index] - expected) < 1e-9, 'Increasing source Y still moves Abby upward.');
      }
      else for (const [index, expected] of [6, -22, -50].entries()) {
        assert.ok(Math.abs(y[index] - expected) < 1e-9, 'Original parent zoom scales the resource offset about the authored root.');
      }
    } finally { actor.dispose(); }
  }
});

test('resource stage calibration leaves avatar profiles unchanged and invalid resource data retains the fallback', () => {
  for (const portrait of schoolPortraits) {
    const avatar = portrait.avatarProfile ?? portrait.profile;
    const before = avatar.transform([20, 100, 1]);
    const resource = placement(portrait.talkerId);
    assert.ok(readSourcePortraitPlacement(resource), portrait.name);
    const stage = sourcePortraitProfile(portrait.profile, resource);
    assert.notEqual(stage, avatar);
    assert.deepEqual(avatar.transform([20, 100, 1]), before, `${portrait.name}: stage changes preserve the dialogue crop`);
    assert.equal(stage.verifiedBlinks, portrait.profile.verifiedBlinks);
    assert.equal(stage.loopAnimations, portrait.profile.loopAnimations);
    for (const invalid of [undefined, {}, { PosX: 0, PosY: 0, Scale: 0 }, { PosX: 0, PosY: Infinity, Scale: .45 }, { PosX: 0, PosY: 0, Scale: '.45' }]) {
      assert.equal(sourcePortraitProfile(portrait.profile, invalid), portrait.profile);
    }
  }
});
