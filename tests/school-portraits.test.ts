import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import { characterCoordinates } from '../src/engine/StageCoordinates.ts';
import { initialStageState, reduceStageEvent } from '../src/engine/StageState.ts';
import { staticStagePresentation } from '../src/engine/StageTransitions.ts';
import { validateManifest } from '../src/engine/validation.ts';
import type { ChangliResources } from '../src/spine/ChangliAssets.ts';
import { ChangliSpineActor } from '../src/spine/ChangliSpineScene.ts';
import type { ChangliActor, ChangliFrame, ChangliScene } from '../src/spine/ChangliSpineScene.ts';
import { changliCalibration } from '../src/spine/ChangliCalibration.ts';
import { abbyAvatarCalibration, abbyAvatarTransform, abbySourcePortraitTransform, abbyTransform } from '../src/spine/AbbyCalibration.ts';
import { abbyPortrait, chisaPortrait, composeSchoolExpression, readSchoolExpressions, resolveSchoolPortrait, SchoolPortraitAssetCache, schoolPortraitAssetUrls } from '../src/spine/SchoolPortraitAssets.ts';
import type { SchoolPortraitDefinition } from '../src/spine/SchoolPortraitAssets.ts';
import { SchoolPortraitStageAdapter } from '../src/spine/SchoolPortraitStageAdapter.ts';
import { loadLocalSpineRuntime } from '../src/spine/SpineRuntimeLoader.ts';
import { FakeClock } from './FakeClock.ts';
import { changliAssets, deferred, finishLoads, fullSpine } from './changli-fixtures.ts';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const resources = new Map([chisaPortrait, abbyPortrait].map(definition => {
  const root = new URL(`../public/assets/solarschool/characters/${definition.slug}/`, import.meta.url);
  const atlasText = readFileSync(new URL(`${definition.stem}.atlas`, root), 'utf8');
  const skeleton = new Uint8Array(readFileSync(new URL(`${definition.stem}.skel`, root)));
  const metadata = JSON.parse(readFileSync(new URL(`${definition.name}.animation-metadata.json`, root), 'utf8'));
  const atlas = new fullSpine.TextureAtlas(atlasText);
  for (const page of atlas.pages) page.texture = new fullSpine.Texture({ width: page.width, height: page.height });
  const data = new fullSpine.SkeletonBinary(new fullSpine.AtlasAttachmentLoader(atlas)).readSkeletonData(skeleton);
  const value: ChangliResources = { runtime: fullSpine, skeleton, atlas: atlasText, image: {} as HTMLImageElement, expressions: readSchoolExpressions(metadata, definition) };
  return [definition, { value, data, metadata }] as const;
}));

function viewFor(expression: number) {
  const state = reduceStageEvent(initialStageState(1), { type: 'stage', scriptId: 'fixture', flowActionIndex: 1, runId: 1, sequence: 1, visitId: 1, nid: 1, source: 'node', phase: 'start', disposition: 'state', operation: { op: 'enter', t: 0, who: 'arbitrary-slot', expr: expression } });
  return staticStagePresentation(state).characters[0];
}
function actorFor(definition: SchoolPortraitDefinition, expression = definition.profile.calibration.referenceExpression) {
  const resource = resources.get(definition)!;
  const actor = new ChangliSpineActor(resource.value.runtime, resource.data, { drawSkeleton() {} }, { intervalSeconds: [3, 3] }, definition.profile);
  actor.setExpression(resource.value.expressions.get(expression)!);
  return actor;
}

test('Chisa and Abby join through source expression talkers and every used composition loads against its own skeleton', () => {
  for (const definition of [chisaPortrait, abbyPortrait]) {
    const resource = resources.get(definition)!;
    const actor = actorFor(definition);
    try {
      for (const [id, expression] of Object.entries(changliAssets.manifest.expressions)) {
        if (expression.talkerId !== definition.talkerId) continue;
        const view = viewFor(Number(id));
        const resolved = resolveSchoolPortrait(view.character, changliAssets, definition);
        assert.equal(resolved.kind, 'spine');
        assert.equal(resolveSchoolPortrait(view.character, changliAssets, definition === chisaPortrait ? abbyPortrait : chisaPortrait).kind, 'other');
        assert.equal(resolveSchoolPortrait({ ...view.character, who: String(definition.talkerId + 1) }, changliAssets, definition).kind, 'spine');
        if (resolved.kind !== 'spine') throw new Error('Portrait did not resolve');
        actor.setExpression(composeSchoolExpression(resolved.expression, resource.value.expressions, definition));
      }
      const wrong = { ...changliAssets, manifest: { ...changliAssets.manifest, talkers: { [definition.talkerId]: changliAssets.manifest.talkers!['850006'] } } };
      assert.equal(resolveSchoolPortrait(viewFor(definition.profile.calibration.referenceExpression).character, wrong, definition).kind, 'fallback');
      assert.throws(() => readSchoolExpressions(resource.metadata, definition === chisaPortrait ? abbyPortrait : chisaPortrait), /must identify/);
      assert.equal(resource.data.version, '4.1.23');
    } finally { actor.dispose(); }
  }
  assert.equal(resources.get(chisaPortrait)!.value.expressions.size, 14);
  assert.equal(resources.get(chisaPortrait)!.value.expressions.has(700009), false, 'Unused legacy test row must not reject the working mappings.');
  assert.equal(resources.get(abbyPortrait)!.value.expressions.size, 23);
});

test('each portrait keeps its calibrated root across expressions, with Abby using its own source scale and stage-center root', () => {
  for (const definition of [chisaPortrait, abbyPortrait]) {
    const actor = actorFor(definition), view = { ...viewFor(definition.profile.calibration.referenceExpression), position: [400, -60, 1.1] as const };
    actor.render(view, 0);
    const fixed = [actor.skeleton.x, actor.skeleton.y, actor.skeleton.scaleX];
    for (const expression of resources.get(definition)!.value.expressions.values()) {
      actor.setExpression(expression); actor.render(view, 0);
      assert.deepEqual([actor.skeleton.x, actor.skeleton.y, actor.skeleton.scaleX], fixed);
    }
    actor.render({ ...view, position: [500, -85, 1.1] }, 0);
    assert.equal(actor.skeleton.x - fixed[0], 100);
    assert.equal(actor.skeleton.y - fixed[1], -25);
    actor.dispose();
  }
  assert.notEqual(chisaPortrait.profile.calibration.anchorY, changliCalibration.anchorY);
  assert.ok(abbyPortrait.profile.calibration.heightFraction < chisaPortrait.profile.calibration.heightFraction);
  assert.ok(abbyPortrait.profile.calibration.frame.floorPercent > chisaPortrait.profile.calibration.frame.floorPercent);
  assert.deepEqual(abbySourcePortraitTransform, changliAssets.manifest.talkers!['700005'].portraitTransform);
  assert.deepEqual(abbyTransform([100, 0, 1]), { x: 1440, y: 720, scale: .25 });
  assert.equal(abbyTransform([100, 0, 1.2]).scale, .3, 'Authored scale is applied once to the source skeleton scale.');
  assert.equal(abbyPortrait.avatarProfile!.calibration, abbyAvatarCalibration);
  assert.deepEqual(abbyPortrait.avatarProfile!.transform([-100, 550, .75]), abbyAvatarTransform([-100, 550, .75]));
  assert.equal(abbyAvatarCalibration.heightFraction, .34, 'The independent speaker crop keeps its existing calibration.');
});

test('portrait calibration keeps stage translation outside Spine-local scale and projects increasing Y upward', () => {
  for (const definition of [chisaPortrait, abbyPortrait]) {
    const actor = actorFor(definition), calibration = definition.profile.calibration;
    const camera = new fullSpine.OrthoCamera(calibration.frame.width, calibration.frame.height);
    camera.position.set(calibration.frame.width / 2, calibration.frame.height / 2, 0); camera.update();
    try {
      for (const sourceScale of [.8, 1, 1.2]) {
        let previousScreenY = Infinity;
        for (const y of [-1200, -500, -400, 0, 110]) {
          const position = [400, y, sourceScale] as const;
          actor.render({ ...viewFor(calibration.referenceExpression), position }, 0);
          // The fixed local reference anchor, after scaling and translation,
          // must land at the authored stage point, independent of pose/size.
          const anchorX = actor.skeleton.x + calibration.anchorX * actor.skeleton.scaleX;
          const anchorY = actor.skeleton.y + calibration.anchorY * actor.skeleton.scaleY;
          const sourceOffsetX = definition === abbyPortrait ? abbySourcePortraitTransform.PosX * position[2] : 0;
          assert.ok(Math.abs(anchorX - (calibration.frame.width / 2 + sourceOffsetX + 400)) < 1e-9);
          assert.ok(Math.abs(anchorY - (calibration.frame.height * calibration.frame.floorPercent / 100 + y)) < 1e-9);
          const screen = camera.worldToScreen(new fullSpine.Vector3(anchorX, anchorY, 0), calibration.frame.width, calibration.frame.height);
          const screenY = calibration.frame.height - screen.y; // CSS top origin.
          assert.ok(screenY < previousScreenY, `${definition.name}: increasing source Y must rise on screen`);
          const cssY = calibration.frame.height * (1 - characterCoordinates(position, calibration.frame).bottomPercent / 100);
          assert.ok(Math.abs(screenY - cssY) < .001, 'CSS and canvas must agree, including offstage positions');
          previousScreenY = screenY;
        }
      }
    } finally { actor.dispose(); }
  }
});

test('Abby loops the authored .2s catchlights and resumes their eye clip after a one-shot blink', () => {
  const actor = actorFor(abbyPortrait), view = viewFor(700212);
  try {
    const eyes = actor.animationState.getCurrent(2)!;
    assert.equal(eyes.loop, true); assert.equal(eyes.animation.duration, .20000001788139343);
    actor.render(view, 2.9); assert.equal(actor.animationState.getCurrent(2), eyes);
    actor.render(view, .11);
    const blink = actor.animationState.getCurrent(2)!;
    assert.equal(blink.loop, false); assert.equal(blink.timeScale, 1);
    assert.equal(blink.animation.name, 'dongzuo1_zhengchang_zhayan');
    actor.render(view, .61);
    const resumed = actor.animationState.getCurrent(2)!;
    assert.equal(resumed.animation.name, eyes.animation.name); assert.equal(resumed.loop, true);
    assert.ok(Math.abs(resumed.trackTime - .02) < 1e-7, 'The queued eye restarts its phase; Spine may recycle track entries.');
    assert.equal(actor.animationState.getCurrent(3), null, 'Source eye and blink share track 2.');
    actor.render(view, 2.37); assert.equal(actor.animationState.getCurrent(2), resumed);
    actor.render(view, .02); assert.equal(actor.animationState.getCurrent(2)!.loop, false);
  } finally { actor.dispose(); }
});

test('Chisa closed eyes and Abby closed/star eyes keep their source poses without adding a blink', () => {
  for (const [definition, expression] of [[chisaPortrait, 700158], [abbyPortrait, 700214], [abbyPortrait, 700213]] as const) {
    const actor = actorFor(definition, expression);
    try {
      actor.render(viewFor(expression), 20);
      assert.equal(actor.animationState.getCurrent(3), null);
      assert.equal(actor.animationState.getCurrent(2)!.animation.name, resources.get(definition)!.value.expressions.get(expression)!.eye);
    } finally { actor.dispose(); }
  }
});

test('character asset caches stay separate while concurrent runtime loads insert one local script', async () => {
  const calls: string[] = [];
  const cache = new SchoolPortraitAssetCache(async (base, definition) => { calls.push(`${base}:${definition.slug}`); return resources.get(definition)!.value; });
  const chisa = cache.load('/assets/solarschool', chisaPortrait), abby = cache.load('/assets/solarschool/', abbyPortrait);
  assert.notEqual(chisa, abby); assert.equal(cache.load('/assets/solarschool/', chisaPortrait), chisa);
  assert.equal(await chisa, resources.get(chisaPortrait)!.value); assert.equal(await abby, resources.get(abbyPortrait)!.value);
  assert.equal(calls.length, 2);
  assert.equal(schoolPortraitAssetUrls('/assets/solarschool', chisaPortrait).runtime, schoolPortraitAssetUrls('/assets/solarschool/', abbyPortrait).runtime);
  const previousDocument = globalThis.document, previousSpine = (globalThis as any).spine;
  const scripts: any[] = [];
  try {
    globalThis.document = { createElement: () => ({}), head: { append: (script: any) => scripts.push(script) } } as unknown as Document;
    (globalThis as any).spine = fullSpine;
    const first = loadLocalSpineRuntime('/test/school-shared-runtime.js');
    assert.equal(loadLocalSpineRuntime('/test/school-shared-runtime.js'), first); assert.equal(scripts.length, 1);
    scripts[0].onload(); assert.equal(await first, fullSpine);
  } finally { globalThis.document = previousDocument; (globalThis as any).spine = previousSpine; }
});

class ObservedScene implements ChangliScene {
  readonly actors: ChangliSpineActor[] = [];
  visible: readonly ChangliFrame[] = [];
  readonly definition: SchoolPortraitDefinition;
  constructor(definition: SchoolPortraitDefinition) { this.definition = definition; }
  createActor(): ChangliActor {
    const resource = resources.get(this.definition)!;
    const actor = new ChangliSpineActor(resource.value.runtime, resource.data, { drawSkeleton() {} }, { intervalSeconds: [3, 3] }, this.definition.profile);
    this.actors.push(actor); return actor;
  }
  render(entries: readonly ChangliFrame[], delta: number): void { this.visible = entries; for (const entry of entries) entry.actor.render(entry.view, delta); }
  dispose(): void {}
}

function realRig(id: string, definition: SchoolPortraitDefinition, load = () => Promise.resolve(resources.get(definition)!.value)) {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock }), scenes: ObservedScene[] = [];
  const adapter = new SchoolPortraitStageAdapter({} as HTMLCanvasElement, definition, {
    load, createScene: () => { const scene = new ObservedScene(definition); scenes.push(scene); return scene; },
    requestFrame: callback => clock.setTimeout(() => callback(clock.now()), 16), cancelFrame: timer => clock.clearTimeout(timer),
  });
  const sync = () => { const snapshot = runner.getSnapshot(); adapter.sync(snapshot.stageState, snapshot.presentation.characters, changliAssets); };
  const unsubscribe = runner.subscribe(sync);
  const manifest = validateManifest(read('../public/data/manifest.json'));
  const script = (scriptId: string) => read(`../public/data/scripts/${scriptId}.json`);
  assert.equal(runner.load(script(id), manifest), true); assert.equal(runner.start(), true);
  const tick = (ms: number) => { clock.advanceBy(ms); sync(); };
  const walkTo = (nid: number) => {
    for (let step = 0; step < 150; step++) {
      const snapshot = runner.getSnapshot();
      if (snapshot.nid === nid && ['dialogue', 'choices'].includes(snapshot.status)) return;
      assert.notEqual(snapshot.status, 'error', snapshot.error?.message ?? `Failed before ${id}/${nid}`); assert.notEqual(snapshot.status, 'completed', `Completed before ${id}/${nid}`);
      if (snapshot.status === 'running' || snapshot.status === 'ending') { tick(50); continue; }
      tick(1100);
      // Isolate source portrait operations via an explicit Developer traversal.
      if (snapshot.status === 'choices') assert.equal(runner.overrideChoice(0), true);
      else assert.equal(runner.advance(), true);
    }
    assert.fail(`Could not reach ${id}/${nid}`);
  };
  return { runner, adapter, scenes, clock, tick, walkTo, manifest, script,
    // Publish at the exact requested time by delivering a due frame late.
    sample(ms: number) { clock.elapseWithoutCallbacks(ms); tick(0); },
    get view() { return runner.getSnapshot().presentation.characters.find(view => resolveSchoolPortrait(view.character, changliAssets, definition).kind === 'spine')!; },
    dispose() { unsubscribe(); adapter.dispose(); runner.dispose(); assert.equal(clock.pendingTimers, 0); },
  };
}

test('real Chisa 1011 preserves fade, closed eyes, source zoom and movement on stable actors', async () => {
  const current = realRig('1011', chisaPortrait);
  try {
    current.walkTo(2); await finishLoads(); current.tick(150);
    const scene = current.scenes[0], actor = scene.actors[0];
    assert.ok(actor.skeleton.color.a > 0 && actor.skeleton.color.a < 1); current.tick(160); assert.equal(actor.skeleton.color.a, 1);
    current.walkTo(20); assert.equal(actor.animationState.getCurrent(2)!.animation.name, 'dongzuo1_tanqi_biyan'); assert.equal(actor.animationState.getCurrent(3), null);
    current.walkTo(24); current.tick(350); assert.ok(current.view.position[2] > 1 && current.view.position[2] < 1.15);
    assert.equal(actor.skeleton.scaleX, chisaPortrait.profile.transform(current.view.position).scale);
    current.tick(360); assert.equal(current.view.position[2], 1.15); assert.equal(scene.actors.length, 1);
    current.walkTo(27); current.tick(350); assert.ok(current.view.position[0] < 0 && current.view.position[0] > -560);
    assert.equal(scene.actors.length, 2, 'Source nid 26 Enter creates its own entry.');
  } finally { current.dispose(); }
});

test('real Abby 1001 rises through authored nodes 8–10, preserving delay, duration, expressions, exit and re-entry', async () => {
  const current = realRig('1001', abbyPortrait);
  try {
    current.walkTo(8); await finishLoads();
    const scene = current.scenes[0], actor = scene.actors[0];
    const entryY = actor.skeleton.y, entryX = actor.skeleton.x, entryScale = actor.skeleton.scaleX;
    const checkPosition = (y: number) => {
      assert.deepEqual(current.view.position, [0, y, 1]);
      assert.ok(Math.abs(actor.skeleton.y - entryY - (y + 1200)) < 1e-9, 'Authored Y displacement must increase Spine world Y');
      assert.equal(actor.skeleton.x, entryX); assert.equal(actor.skeleton.scaleX, entryScale);
    };
    checkPosition(-1200); current.sample(99); checkPosition(-1200);
    current.sample(1); checkPosition(-1200);
    const move8 = current.runner.getSnapshot().presentation.transitions.find(track => track.property === 'position')!;
    assert.equal(move8.durationMs, 2000); current.sample(1000); checkPosition(-850);
    assert.equal(actor.animationState.getCurrent(2)!.animation.name, 'dongzuo1_shengqi_zhengyan');
    current.sample(1000); checkPosition(-500);
    assert.equal(current.runner.advance(), true); assert.equal(current.runner.getSnapshot().nid, 9); checkPosition(-500);
    assert.equal(current.runner.getSnapshot().presentation.transitions.find(track => track.property === 'position')!.durationMs, 200);
    current.sample(100); checkPosition(-450); current.sample(100); checkPosition(-400);
    assert.equal(current.runner.advance(), true); assert.equal(current.runner.getSnapshot().nid, 10); checkPosition(-400);
    assert.equal(current.runner.getSnapshot().presentation.transitions.find(track => track.property === 'position')!.durationMs, 300);
    current.sample(150); checkPosition(-200); current.sample(150); checkPosition(0);
    assert.equal(actor.animationState.getCurrent(2)!.loop, true);
    current.walkTo(15); assert.equal(actor.animationState.getCurrent(2)!.animation.name, 'dongzuo3_taitouzhan_zhengyan');
    assert.equal(current.runner.advance(), true); current.tick(130); assert.ok(actor.skeleton.color.a > 0 && actor.skeleton.color.a < 1);
    current.tick(130); assert.equal(scene.visible.length, 0); current.walkTo(20); assert.equal(scene.actors.length, 2);
    const reentry = scene.actors[1];
    current.tick(250); // Finish the authored fade so the actor is drawn.
    assert.deepEqual(current.view.position, [0, 0, 1]);
    assert.ok(Math.abs(reentry.skeleton.y - entryY - 1200) < 1e-9);
    current.sample(1750); assert.deepEqual(current.view.position, [50, 0, 1]);
    assert.ok(Math.abs(reentry.skeleton.x - entryX - 50) < 1e-9);
    assert.equal(reentry.skeleton.scaleX, entryScale);
  } finally { current.dispose(); }
});

test('Abby immediate transitions and animated arrival share the authored destinations', async () => {
  const current = realRig('1001', abbyPortrait);
  try {
    current.runner.setInstantTransitions(true);
    for (const [nid, y] of [[8, -500], [9, -400], [10, 0]]) {
      current.walkTo(nid); await finishLoads(); current.tick(0);
      const actor = current.scenes[0].actors[0], calibration = abbyPortrait.profile.calibration;
      assert.deepEqual(current.view.position, [0, y, 1]);
      assert.ok(Math.abs(actor.skeleton.y + calibration.anchorY * actor.skeleton.scaleY - (calibration.frame.height / 2 + y)) < 1e-9);
      assert.equal(current.runner.getSnapshot().presentation.transitions.length, 0);
    }
  } finally { current.dispose(); }
});

test('restart and script switching cancel Abby movement during the delay and both introductory tweens', async () => {
  for (const action of ['restart', 'switch']) for (const [nid, elapsed] of [[8, 50], [8, 1100], [10, 150]]) {
    const current = realRig('1001', abbyPortrait);
    try {
      current.walkTo(nid); await finishLoads(); current.tick(elapsed);
      const oldCallbacks = [...current.clock.callbacks], oldRun = current.runner.getSnapshot().runId;
      if (action === 'restart') assert.equal(current.runner.restart(), true);
      else { assert.equal(current.runner.load(current.script('1009'), current.manifest), true); assert.equal(current.runner.start(), true); }
      for (const callback of oldCallbacks) callback();
      current.tick(3000);
      const snapshot = current.runner.getSnapshot();
      assert.ok(snapshot.runId > oldRun); assert.equal(snapshot.stageState.characters['1316'], undefined);
      assert.equal(snapshot.presentation.transitions.length, 0); assert.equal(current.scenes[0].visible.length, 0);
    } finally { current.dispose(); }
  }
});

test('rapid advance settles Abby destinations and stale callbacks cannot resume an earlier movement', async () => {
  const current = realRig('1001', abbyPortrait);
  try {
    current.walkTo(8);
    // Capture the scheduled stage callbacks before a loaded actor starts RAF.
    const oldCallbacks = [...current.clock.callbacks];
    await finishLoads(); current.tick(50);
    assert.equal(current.runner.advance(), true); assert.deepEqual(current.view.position, [0, -500, 1]);
    current.sample(100); assert.deepEqual(current.view.position, [0, -450, 1]);
    assert.equal(current.runner.advance(), true); assert.deepEqual(current.view.position, [0, -400, 1]);
    current.sample(150); assert.deepEqual(current.view.position, [0, -200, 1]);
    assert.equal(current.runner.advance(), true); assert.deepEqual(current.view.position, [0, 0, 1]);
    for (const callback of oldCallbacks) callback();
    current.tick(3000); assert.deepEqual(current.view.position, [0, 0, 1]);
    assert.equal(current.runner.getSnapshot().presentation.transitions.length, 0);
    assert.equal(current.scenes[0].actors.length, 1);
  } finally { current.dispose(); }
});

test('late Chisa/Abby loads cannot resurrect portraits after exit, restart, script switch, same-run scene handoff or disposal', async () => {
  for (const definition of [chisaPortrait, abbyPortrait]) for (const action of ['exit', 'restart', 'switch', 'continuation', 'dispose']) {
    const chisaExit = definition === chisaPortrait && action === 'exit';
    const pending = deferred<ChangliResources>(), current = realRig(chisaExit ? '14225' : definition === chisaPortrait ? '1011' : '1001', definition, () => pending.promise);
    try {
      current.walkTo(chisaExit ? 1 : definition === chisaPortrait ? 2 : 8);
      if (action === 'exit') { if (!chisaExit) current.walkTo(15); current.runner.advance(); current.tick(1200); }
      if (action === 'restart') current.runner.restart();
      if (action === 'switch') current.runner.load(current.script('1009'), current.manifest);
      if (action === 'continuation') {
        const outgoing = current.runner.getSnapshot();
        current.runner.load(current.script('1006'), current.manifest, { continuation: true, preserveStoryState: true });
        assert.deepEqual(current.runner.getSnapshot().stageState.characters, {});
        current.runner.start();
        assert.equal(current.runner.getSnapshot().runId, outgoing.runId);
        assert.notEqual(current.runner.getSnapshot().sceneId, outgoing.sceneId);
        const incoming = Object.values(current.runner.getSnapshot().stageState.characters);
        assert.equal(incoming.some(c => c.portraitVisible), false, 'Street entry permits its authored Rover avatar, but no portrait');
        assert.ok(incoming.every(c => c.lastEvent.scriptId === '1006'));
      }
      if (action === 'dispose') current.adapter.dispose();
      pending.resolve(resources.get(definition)!.value); await finishLoads(); assert.equal(current.scenes.length, 0, `${definition.name}: ${action}`);
    } finally { current.dispose(); }
  }
});
