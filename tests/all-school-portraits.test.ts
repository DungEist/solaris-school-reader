import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import type { EnglishCatalog } from '../src/data/EnglishScriptRepository.ts';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import { initialStageState, reduceStageEvent } from '../src/engine/StageState.ts';
import type { StageState } from '../src/engine/StageState.ts';
import { StageTransitions, staticStagePresentation } from '../src/engine/StageTransitions.ts';
import type { PresentedCharacter } from '../src/engine/StageTransitions.ts';
import type { Script, StageEvent, StageOp } from '../src/engine/types.ts';
import { validateManifest } from '../src/engine/validation.ts';
import type { ChangliExpression, ChangliResources } from '../src/spine/ChangliAssets.ts';
import { changliAssetUrls } from '../src/spine/ChangliAssets.ts';
import { changliSpineProfile, ChangliSpineActor } from '../src/spine/ChangliSpineScene.ts';
import type { ChangliActor, ChangliFrame, ChangliScene } from '../src/spine/ChangliSpineScene.ts';
import type { ChangliRendererStatuses } from '../src/spine/ChangliStageAdapter.ts';
import { schoolPortraits, composeSchoolExpression, readSchoolExpressions, resolveSchoolPortrait, schoolPortraitAssetUrls } from '../src/spine/SchoolPortraitAssets.ts';
import type { SchoolPortraitDefinition } from '../src/spine/SchoolPortraitAssets.ts';
import { SchoolPortraitStageAdapter } from '../src/spine/SchoolPortraitStageAdapter.ts';
import { resolveSchoolStaticPortrait, schoolStaticPortraits } from '../src/spine/SchoolStaticPortraitAssets.ts';
import { schoolAssetsForGender, schoolRoverCounterpart, roverGenderMissingClips } from '../src/spine/SchoolRover.ts';
import { validatePortraitAtlasPage, validateSpinePortraitResources } from '../src/spine/SpinePortraitValidation.ts';
import { FakeClock } from './FakeClock.ts';
import { changliAssets, deferred, finishLoads, fullSpine } from './changli-fixtures.ts';

const root = new URL('../', import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const sha256 = (path: string) => createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex');
const manifest = validateManifest(read('public/data/manifest.json'));
const sourceRows: readonly Record<string, any>[] = Object.values(read('public/data/maps/expressions.json'));
const sourceTalkers: Record<string, any> = read('public/data/maps/talkers.json');
const catalog: EnglishCatalog = { manifest, index: [], english: read('public/data/locales/en.json'), speakers: read('public/data/speakers.json'), report: {} };
const changliDefinition: SchoolPortraitDefinition = { slug: 'changli', name: 'Changli', talkerId: 850006, stem: 'SolarSchool_Changli', profile: changliSpineProfile, unsupportedExpressions: new Set() };
const definitions = [changliDefinition, ...schoolPortraits];
const sourceFields = ['BodyAnimation', 'MouthAnimation', 'MouthOpenSmallAnimation', 'MouthOpenLargeAnimation', 'EyeAnimation', 'BlinkAnimation'] as const;

/** Structural headers here; full Pillow decodes are a separate focused check. */
function imageDimensions(path: string): readonly [number, number] {
  const bytes = readFileSync(new URL(path, root));
  if (path.endsWith('.png')) {
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, 'The complete declared WebP container must load.');
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
  if (chunk === 'VP8L') { assert.equal(bytes[20], 0x2f); const bits = bytes.readUInt32LE(21); return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]; }
  assert.equal(chunk, 'VP8 '); assert.equal(bytes.subarray(23, 26).toString('hex'), '9d012a');
  return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
}

interface Fixture {
  readonly definition: SchoolPortraitDefinition;
  readonly resources: ChangliResources;
  readonly data: any;
  readonly metadata: { readonly dataset_animation_rows: readonly Record<string, any>[] };
  readonly directory: string;
}

const fixtures = new Map<number, Fixture>(definitions.map(definition => {
  const directory = `public/assets/solarschool/characters/${definition.slug}/`;
  const atlasText = readFileSync(new URL(`${directory}${definition.stem}.atlas`, root), 'utf8');
  const skeleton = new Uint8Array(readFileSync(new URL(`${directory}${definition.stem}.skel`, root)));
  const metadata = read(`${directory}${definition.metadataFile ?? `${definition.name}.animation-metadata.json`}`);
  const atlas = new fullSpine.TextureAtlas(atlasText);
  for (const page of atlas.pages) page.texture = new fullSpine.Texture({ width: page.width, height: page.height });
  const data = new fullSpine.SkeletonBinary(new fullSpine.AtlasAttachmentLoader(atlas)).readSkeletonData(skeleton);
  const resources: ChangliResources = { runtime: fullSpine, skeleton, atlas: atlasText,
    image: { naturalWidth: atlas.pages[0].width, naturalHeight: atlas.pages[0].height } as HTMLImageElement,
    expressions: readSchoolExpressions(metadata, definition) };
  return [definition.talkerId, { definition, directory, resources, data, metadata }];
}));

function event(operation: StageOp, runId = 1, sequence = 1): StageEvent {
  return { type: 'stage', scriptId: 'portrait-fixture', nid: 1, flowActionIndex: 1, runId, sequence, visitId: 1, phase: 'start', operation, source: 'node', disposition: 'state' };
}
function entered(expression: number, who = 'independent-stage-slot', runId = 1) {
  return reduceStageEvent(initialStageState(runId), event({ op: 'enter', who, expr: expression, t: 0 }, runId));
}
function viewFor(expression: number, who = 'independent-stage-slot'): PresentedCharacter { return staticStagePresentation(entered(expression, who)).characters[0]; }
function actorFor(fixture: Fixture, expression = fixture.definition.profile.calibration.referenceExpression, random = () => 0) {
  const actor = new ChangliSpineActor(fullSpine, fixture.data, { drawSkeleton() {} }, { random }, fixture.definition.profile);
  actor.setExpression(fixture.resources.expressions.get(expression)!);
  return actor;
}
function geometry(actor: ChangliSpineActor): string {
  const skeleton = actor.skeleton as any;
  return JSON.stringify({ bones: skeleton.bones.map((bone: any) => [bone.x, bone.y, bone.rotation, bone.scaleX, bone.scaleY, bone.shearX, bone.shearY]),
    slots: skeleton.slots.map((slot: any) => [slot.attachment?.name, slot.deform.some((value: number) => value !== 0) ? [...slot.deform] : []]),
    order: skeleton.drawOrder.map((slot: any) => slot.data.index) });
}

function assertSameSourcePose(actual: ChangliSpineActor, expected: ChangliSpineActor, label: string): void {
  const left = actual.skeleton as any, right = expected.skeleton as any;
  // Spine can represent an unweighted setup mesh with either an empty deform
  // array or the original vertices. Compare the resulting geometry directly.
  for (let index = 0; index < left.slots.length; index++) {
    const slot = left.slots[index], control = right.slots[index];
    assert.equal(slot.attachment?.name, control.attachment?.name, label);
    if (!slot.attachment) continue;
    const points = (skeleton: any, item: any): number[] => {
      const attachment = item.attachment, result = new Float32Array(attachment.worldVerticesLength ?? 8);
      if (attachment.worldVerticesLength) attachment.computeWorldVertices(item, 0, result.length, result, 0, 2);
      else attachment.computeWorldVertices(item, result, 0, 2);
      return [...result].map((value, coordinate) => (value - (coordinate % 2 ? skeleton.y : skeleton.x)) / (coordinate % 2 ? skeleton.scaleY : skeleton.scaleX));
    };
    const a = points(left, slot), b = points(right, control);
    assert.equal(a.length, b.length, label);
    for (let coordinate = 0; coordinate < a.length; coordinate++) assert.ok(Math.abs(a[coordinate] - b[coordinate]) < .001, `${label}: ${slot.data.name} vertex ${coordinate}`);
  }
  assert.deepEqual(left.drawOrder.map((slot: any) => slot.data.index), right.drawOrder.map((slot: any) => slot.data.index), label);
}

class ObservedActor extends ChangliSpineActor {
  readonly expressions: number[] = [];
  disposalCount = 0;
  override setExpression(expression: ChangliExpression): void { super.setExpression(expression); this.expressions.push(expression.id); }
  override dispose(): void { if (!this.disposalCount) { this.disposalCount++; super.dispose(); } }
}
class ObservedScene implements ChangliScene {
  readonly actors: ObservedActor[] = [];
  visible: readonly ChangliFrame[] = [];
  renderCount = 0;
  disposalCount = 0;
  readonly fixture: Fixture;
  constructor(fixture: Fixture) { this.fixture = fixture; }
  createActor(): ChangliActor {
    const actor = new ObservedActor(fullSpine, this.fixture.data, { drawSkeleton() {} }, { random: () => 0 }, this.fixture.definition.profile);
    this.actors.push(actor); return actor;
  }
  render(entries: readonly ChangliFrame[], delta: number): void { this.renderCount++; this.visible = entries; for (const entry of entries) entry.actor.render(entry.view, delta); }
  dispose(): void { this.disposalCount++; }
}
function adapterRig(fixture: Fixture, load = () => Promise.resolve(fixture.resources)) {
  const scenes: ObservedScene[] = [], pending = new Map<number, (time: number) => void>(), history: ((time: number) => void)[] = [];
  let nextFrame = 0, statuses: ChangliRendererStatuses = {};
  const adapter = new SchoolPortraitStageAdapter({} as HTMLCanvasElement, fixture.definition, {
    load, createScene: () => { const scene = new ObservedScene(fixture); scenes.push(scene); return scene; },
    requestFrame: callback => { pending.set(++nextFrame, callback); history.push(callback); return nextFrame; },
    cancelFrame: handle => { pending.delete(handle); }, onStatus: value => { statuses = value; },
  });
  const sync = (state: StageState, views = staticStagePresentation(state).characters, assets = changliAssets) => adapter.sync(state, views, assets);
  const frame = (time: number) => { const item = [...pending][0]; assert.ok(item, 'Expected an active portrait frame'); pending.delete(item[0]); item[1](time); };
  return { adapter, scenes, pending, history, sync, frame, get statuses() { return statuses; }, dispose() { adapter.dispose(); assert.equal(pending.size, 0); } };
}

function roverFixture(talkerId: number): Fixture {
  const fixture = fixtures.get(talkerId)!;
  const counterpart = fixtures.get(schoolRoverCounterpart(talkerId)!)!;
  return { ...fixture, resources: { ...fixture.resources, expressions: readSchoolExpressions(fixture.metadata, fixture.definition, counterpart.metadata) } };
}

test('source Rover gender selection preserves every expression ID/channel and unrelated asset registration', () => {
  for (const gender of ['male', 'female'] as const) {
    const assets = schoolAssetsForGender(changliAssets, gender);
    assert.equal(assets.baseUrl, changliAssets.baseUrl);
    assert.equal(assets.mapping, changliAssets.mapping);
    assert.equal(assets.manifest.talkers, changliAssets.manifest.talkers);
    for (const [id, expression] of Object.entries(changliAssets.manifest.expressions)) {
      const selected = assets.manifest.expressions[id];
      if (expression.talkerId != null && schoolRoverCounterpart(expression.talkerId) != null) {
        assert.equal(selected.talkerId, gender === 'female' ? 850002 : 850001);
        assert.deepEqual({ ...selected, talkerId: expression.talkerId }, expression, id);
      } else assert.equal(selected, expression, id);
    }
    assert.equal(schoolAssetsForGender(assets, gender), assets);
  }
  assert.equal(changliAssets.manifest.expressions['700131'].talkerId, 850001);
  assert.equal(changliAssets.manifest.expressions['700056'].talkerId, 850002);
});

test('both Rover resources validate literal source compositions and exact missing channels after gender selection', () => {
  for (const [gender, talkerId] of [['male', 850001], ['female', 850002]] as const) {
    const fixture = roverFixture(talkerId), assets = schoolAssetsForGender(changliAssets, gender);
    assert.doesNotThrow(() => validateSpinePortraitResources(fixture.resources, fixture.definition.profile, `${fixture.definition.stem}.png`));
    for (const row of sourceRows.filter(row => row.AvgTalkerId === 850001 || row.AvgTalkerId === 850002)) {
      const alias = (name: string) => fixture.definition.animationAliases?.[name] ?? name;
      const missing = ['BodyAnimation', 'MouthAnimation', 'EyeAnimation', 'BlinkAnimation'].filter(field => row[field] && !fixture.data.findAnimation(alias(row[field]))).map(field => row[field]).sort();
      const result = resolveSchoolPortrait(viewFor(row.Id, 'a-stage-slot-unrelated-to-player-id').character, assets, fixture.definition);
      assert.equal(result.kind, assets.manifest.expressions[String(row.Id)] ? missing.length ? 'fallback' : 'spine' : 'other', `${gender}/${row.Id}`);
      if (missing.length) {
        assert.equal(fixture.resources.expressions.has(row.Id), false);
        if (result.kind === 'fallback') for (const clip of missing) assert.ok(result.reason.includes(clip));
        if (roverGenderMissingClips[talkerId]?.[row.Id]) assert.deepEqual([...roverGenderMissingClips[talkerId][row.Id]].sort(), missing);
      } else {
        const expression = composeSchoolExpression({ id: row.Id, body: row.BodyAnimation, mouth: row.MouthAnimation, eye: row.EyeAnimation }, fixture.resources.expressions, fixture.definition);
        assert.equal(expression.id, row.Id);
        assert.equal(expression.blink, row.BlinkAnimation || null);
        const actor = actorFor(fixture, row.Id);
        try { actor.render(viewFor(row.Id), .17); } finally { actor.dispose(); }
      }
    }
    // The reader uses the closed-mouth track; missing optional source mouth
    // shapes remain metadata and are explicitly recorded in the report.
    if (gender === 'female') for (const id of [700127, 700132]) {
      const row = sourceRows.find(row => row.Id === id)!;
      assert.equal(fixture.data.findAnimation(row.MouthOpenSmallAnimation), null);
      assert.equal(fixture.data.findAnimation(row.MouthOpenLargeAnimation), null);
      assert.ok(fixture.resources.expressions.has(id));
    }
  }
  assert.throws(() => readSchoolExpressions(fixtures.get(700006)!.metadata, fixtures.get(700006)!.definition, fixtures.get(850001)!.metadata), /Only source Rover/);
  assert.throws(() => readSchoolExpressions(fixtures.get(850001)!.metadata, fixtures.get(850001)!.definition, fixtures.get(850001)!.metadata), /identify talker 850002/);
});

test('real source-hidden Rover stays hidden for both genders through expressions, restart and script switching', async () => {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock, instantTransitions: true });
  const rigs = [adapterRig(roverFixture(850001)), adapterRig(roverFixture(850002))];
  try {
    for (const id of ['1001', '1007'] as const) {
      assert.equal(runner.load(read(`public/data/scripts/${id}.json`), manifest), true); runner.start();
      for (let step = 0; step < 6; step++) {
        const snapshot = runner.getSnapshot(), original = JSON.stringify(snapshot.stageState);
        for (const gender of ['male', 'female'] as const) for (const rig of rigs) rig.sync(snapshot.stageState, snapshot.presentation.characters, schoolAssetsForGender(changliAssets, gender));
        assert.equal(JSON.stringify(snapshot.stageState), original);
        const player = snapshot.stageState.characters['750088'];
        assert.equal(player.hidePortrait, true); assert.equal(player.portraitVisible, false);
        assert.equal(player.avatarVisible, !player.hideAvatar && player.present);
        if (snapshot.status === 'choices') runner.choose(0); else runner.advance();
        clock.advanceBy(1000);
      }
      runner.restart();
      for (const rig of rigs) rig.sync(runner.getSnapshot().stageState);
    }
    await finishLoads();
    for (const rig of rigs) { assert.equal(rig.scenes.length, 0); assert.equal(rig.pending.size, 0); }
  } finally { rigs.forEach(rig => rig.dispose()); runner.dispose(); }
});

test('gender changes cancel the previous Rover load and retain entry identity, movement and exit fades', async () => {
  const malePending = deferred<ChangliResources>(), male = adapterRig(roverFixture(850001), () => malePending.promise), female = adapterRig(roverFixture(850002));
  const clock = new FakeClock(), transitions = new StageTransitions();
  let state = entered(700127, 'source-player-slot');
  const sync = (gender: 'male' | 'female') => { const assets = schoolAssetsForGender(changliAssets, gender); for (const rig of [male, female]) rig.sync(state, transitions.project(state, clock.now()).characters, assets); };
  try {
    const entry = state.characters['source-player-slot'].entrySequence;
    sync('male'); sync('female'); await finishLoads(); female.frame(0);
    malePending.resolve(roverFixture(850001).resources); await finishLoads();
    assert.equal(male.scenes.length, 0, 'A stale load must not resurrect the previous gender.');
    const actor = female.scenes[0].actors[0];
    assert.equal(actor.expressions[0], 700127, 'Resource substitution keeps the literal source ID.');
    const move = event({ op: 'move', who: 'source-player-slot', pos: [120, -80, 1.2], dur: 1, t: 0 }, 1, 2);
    const previous = state; state = reduceStageEvent(state, move); transitions.apply(previous, state, move, false, clock.now()); clock.advanceBy(500); sync('female');
    assert.deepEqual(transitions.project(state, clock.now()).characters[0].position, [60, -40, 1.1]);
    assert.equal(state.characters['source-player-slot'].entrySequence, entry);
    const change = event({ op: 'modify', who: 'source-player-slot', expr: 700132, effect: 'Darken', t: 0 }, 1, 3);
    state = reduceStageEvent(state, change); sync('female');
    assert.equal(female.scenes[0].actors.length, 1); assert.equal(actor.expressions.at(-1), 700132);
    const exit = event({ op: 'exit', who: 'source-player-slot', fadeOut: 1, t: 0 }, 1, 4);
    const beforeExit = state; state = reduceStageEvent(state, exit); transitions.apply(beforeExit, state, exit, false, clock.now()); sync('female');
    assert.equal(actor.disposalCount, 0); clock.advanceBy(1000); sync('female'); assert.equal(actor.disposalCount, 1);
    for (const rig of [male, female]) rig.sync(initialStageState(2));
    assert.equal(female.pending.size, 0); assert.equal(male.pending.size, 0);
  } finally { male.dispose(); female.dispose(); }
});

test('unnamed Shorekeeper has no entry or usable generic source default, and unknown voices remain source text only', () => {
  const orphanRoutes: string[] = [];
  for (const entry of read('public/data/scripts.index.json') as { id: string }[]) for (const node of (read(`public/data/scripts/${entry.id}.json`) as Script).nodes) {
    for (const operation of [...node.stage, ...(node.options ?? []).flatMap(option => option.performances ?? [])]) {
      if (operation.who === '1759') { orphanRoutes.push(`${entry.id}/${node.nid}/${operation.op}`); assert.notEqual(operation.op, 'enter'); assert.equal(operation.expr, undefined); }
      assert.notEqual(operation.who, '178');
    }
  }
  assert.deepEqual(orphanRoutes.sort(), ['1007/13/modify', '1007/19/move']);
  assert.equal(sourceTalkers['700013'].SolarSchoolDefaultExpressionId, 0);
  assert.equal(catalog.speakers['1759'].talkerId, 700013);
  assert.equal(catalog.speakers['178'].talkerId, 850013);
  for (const talkerId of [850001, 850002, 700003]) assert.equal(fixtures.get(talkerId)!.data.findAnimation('1_1'), null);
  for (const [id, nid] of [['9004', 29], ['9014', 15]] as const) {
    const node = (read(`public/data/scripts/${id}.json`) as Script).nodes.find(node => node.nid === nid)!;
    assert.equal(node.speakerId, '178'); assert.ok(node.stage.every(operation => operation.who !== '178'));
  }
  const unknown = sourceTalkers['850013'];
  for (const field of ['SpineAtlas', 'SpineSkeletonData', 'SolarSchoolSpineAtlas', 'SolarSchoolSpineSkeletonData', 'SolarSchoolPortraitTexture']) assert.equal(unknown[field], '');
  assert.equal(unknown.SolarSchoolDefaultExpressionId, 0);
  assert.ok(sourceRows.every(row => row.AvgTalkerId !== 850013 && row.AvgTalkerId !== 700013));
});

test('the full source inventory registers every supported asset type without using stage IDs as talker IDs', () => {
  assert.equal(definitions.length, 14);
  assert.equal(new Set(definitions.map(definition => definition.stem)).size, 14);
  assert.equal(schoolStaticPortraits.length, 21);
  const supported = [...definitions.map(definition => definition.talkerId), ...schoolStaticPortraits.map(definition => definition.talkerId), 700013, 850013].sort((a, b) => a - b);
  assert.deepEqual(Object.keys(changliAssets.manifest.talkers!).map(Number).sort((a, b) => a - b), supported);
  for (const fixture of fixtures.values()) {
    const expression = fixture.definition.profile.calibration.referenceExpression;
    const resolution = resolveSchoolPortrait(viewFor(expression, 'different-from-speaker-and-talker').character, changliAssets, fixture.definition);
    assert.equal(resolution.kind, 'spine', fixture.definition.name);
    assert.equal(resolveSchoolPortrait({ ...viewFor(expression).character, expression: null, who: String(fixture.definition.talkerId) }, changliAssets, fixture.definition).kind, 'other');
    const urls = schoolPortraitAssetUrls('/assets/solarschool', fixture.definition);
    assert.equal(urls.runtime, changliAssetUrls('/assets/solarschool/').runtime);
    const source = sourceTalkers[String(fixture.definition.talkerId)];
    assert.equal(changliAssets.manifest.talkers![String(fixture.definition.talkerId)].spineAtlas, source.SolarSchoolSpineAtlas);
    assert.equal(changliAssets.manifest.talkers![String(fixture.definition.talkerId)].spineSkeleton, source.SolarSchoolSpineSkeletonData);
  }
});

test('all atlas pages and image headers match their skeletons; new WebP and static texture provenance stays exact', () => {
  const imageFiles = definitions.map(definition => `public/assets/solarschool/characters/${definition.slug}/${definition.textureFile ?? `${definition.stem}.png`}`);
  const npcFiles = [...new Set(schoolStaticPortraits.map(definition => `public/assets/solarschool/characters/npc/${definition.textureFile}`))];
  assert.equal(npcFiles.length, 10, 'Shared NPC textures should be installed once per exact source path.');
  const decoded = Object.fromEntries([...imageFiles, ...npcFiles].map(path => [path, imageDimensions(path)]));
  for (const fixture of fixtures.values()) {
    const atlas = new fullSpine.TextureAtlas(fixture.resources.atlas);
    for (const page of atlas.pages) page.setTexture({ getImage: () => ({ width: fixture.resources.image.naturalWidth, height: fixture.resources.image.naturalHeight }), setFilters() {}, setWraps() {}, dispose() {} });
    const file = `${fixture.directory}${fixture.definition.textureFile ?? `${fixture.definition.stem}.png`}`;
    assert.deepEqual(decoded[file], [atlas.pages[0].width, atlas.pages[0].height], fixture.definition.name);
    validatePortraitAtlasPage(atlas, fixture.resources.image, fixture.definition.name, `${fixture.definition.stem}.png`);
    assert.equal(fixture.data.version, '4.1.23');
    assert.ok(atlas.regions.every((region: any) => {
      const quarterTurn = region.degrees === 90 || region.degrees === 270;
      return region.x >= 0 && region.y >= 0 && region.x + (quarterTurn ? region.height : region.width) <= region.page.width && region.y + (quarterTurn ? region.width : region.height) <= region.page.height;
    }), `${fixture.definition.name} packed atlas bounds, respecting authored rotations`);
    for (const skin of fixture.data.skins) for (const slotAttachments of skin.attachments) for (const attachment of Object.values(slotAttachments ?? {}) as any[]) {
      if (!attachment.uvs) continue;
      // Mesh UVs explicitly handle 180/270-degree atlas regions; their sampled
      // coordinates are authoritative rather than the unused region u2/v2.
      assert.ok([...attachment.uvs].every((uv: number) => Number.isFinite(uv) && uv >= 0 && uv <= 1), `${fixture.definition.name}/${attachment.name} sampled attachment UVs`);
    }
    assert.doesNotThrow(() => validateSpinePortraitResources(fixture.resources, fixture.definition.profile, `${fixture.definition.stem}.png`));
    if (fixture.definition.textureFile?.endsWith('.webp')) {
      const provenance = read(`${fixture.directory}provenance.json`);
      assert.equal(sha256(file), provenance.texture.sourceSha256);
      assert.equal(sha256(file), sha256(provenance.texture.sourceWebp));
      assert.equal(provenance.texture.atlasPage, atlas.pages[0].name);
      assert.equal(provenance.runtime.file, '../changli/spine-player.js');
      for (const [filename, hash] of Object.entries(provenance.sha256)) assert.equal(sha256(`${fixture.directory}${filename}`), hash, filename);
      assert.equal(readdirSync(new URL(fixture.directory, root)).filter(name => /\.(webp|png)$/.test(name)).length, 1);
    }
  }
  for (const definition of schoolStaticPortraits) {
    const local = `public/assets/solarschool/characters/npc/${definition.textureFile}`;
    const source = `WW_Asset_Webp/${definition.sourceTexture.split('.')[0].replace('/Game/Aki/UI/', '')}.webp`;
    assert.equal(sha256(local), sha256(source), definition.name);
    assert.deepEqual(decoded[local], [definition.width, definition.height]);
  }
});

test('required atlas corruption, page substitution, missing composition clips and unexpected motion fail before rendering', () => {
  const fixture = fixtures.get(700006)!;
  const atlas = new fullSpine.TextureAtlas(fixture.resources.atlas);
  assert.throws(() => validatePortraitAtlasPage(atlas, { naturalWidth: 1, naturalHeight: 1 } as HTMLImageElement, 'Buling'), /does not match/);
  assert.throws(() => validatePortraitAtlasPage(atlas, fixture.resources.image, 'Buling', 'another-page.png'), /expected atlas page/);
  assert.throws(() => validatePortraitAtlasPage({ ...atlas, pages: [...atlas.pages, ...atlas.pages] }, fixture.resources.image, 'Buling'), /expected one verified atlas page/);
  const wrongExpressions = new Map([[1, { id: 1, body: 'absent-source-clip', mouth: 'absent-source-clip', eye: 'absent-source-clip', blink: null }]]);
  assert.throws(() => validateSpinePortraitResources({ ...fixture.resources, expressions: wrongExpressions }, fixture.definition.profile, `${fixture.definition.stem}.png`), /skeleton clip.*missing/);
  assert.throws(() => validateSpinePortraitResources(fixture.resources, { ...fixture.definition.profile, poseDurations: {} }, `${fixture.definition.stem}.png`), /unverified motion/);
});

test('every expression and optional mouth channel resolves against actual animations, with only explicit source spelling recovery and labeled blockers', () => {
  const blocked = definitions.flatMap(definition => [...definition.unsupportedExpressions].filter(id => sourceRows.some(row => row.Id === id && row.AvgTalkerId === definition.talkerId))).sort((a, b) => a - b);
  assert.deepEqual(blocked, [700008, 700009, 700010, 700128, 700129, 700130, 700133, 700134, 700135]);
  let rows = 0, compositions = 0;
  for (const fixture of fixtures.values()) {
    const expected = sourceRows.filter(row => row.AvgTalkerId === fixture.definition.talkerId);
    assert.deepEqual([...fixture.metadata.dataset_animation_rows].sort((a, b) => a.Id - b.Id), [...expected].sort((a, b) => a.Id - b.Id), `${fixture.definition.name} source rows stay intact`);
    for (const row of expected) {
      rows++;
      const alias = (name: string) => fixture.definition.animationAliases?.[name] ?? name;
      const missing = sourceFields.filter(field => row[field] && !fixture.data.findAnimation(alias(row[field])));
      if (fixture.definition.unsupportedExpressions.has(row.Id)) {
        assert.ok(missing.length > 0, `A blocker must have a specific absent channel: ${row.Id}`);
        assert.equal(fixture.resources.expressions.has(row.Id), false);
        assert.throws(() => composeSchoolExpression({ id: row.Id, body: row.BodyAnimation, mouth: row.MouthAnimation, eye: row.EyeAnimation }, fixture.resources.expressions, fixture.definition), /no verified local composition/);
        if (changliAssets.manifest.expressions[String(row.Id)]) {
          const result = resolveSchoolPortrait(viewFor(row.Id).character, changliAssets, fixture.definition);
          assert.equal(result.kind, 'fallback'); if (result.kind === 'fallback') assert.match(result.reason, /absent|missing/i);
        }
        continue;
      }
      assert.deepEqual(missing, [], `${fixture.definition.name} expression ${row.Id}, including optional mouth clips`);
      const expression = composeSchoolExpression({ id: row.Id, body: row.BodyAnimation, mouth: row.MouthAnimation, eye: row.EyeAnimation }, fixture.resources.expressions, fixture.definition);
      const actor = actorFor(fixture, expression.id);
      try { actor.render(viewFor(expression.id), .17); } finally { actor.dispose(); }
      compositions++;
      if (fixture.definition.talkerId === 850002 && [700053, 700054, 700057, 700058].includes(row.Id)) {
        assert.equal(row.MouthAnimation, 'dongzuo1_ zhoumei_zui');
        assert.equal(expression.mouth, 'dongzuo1_zhoumei_zui');
        assert.equal(fixture.data.findAnimation(row.MouthAnimation), null);
      }
    }
    for (const [id, source] of Object.entries(changliAssets.manifest.expressions)) {
      if (source.talkerId !== fixture.definition.talkerId) continue;
      assert.ok(expected.some(row => row.Id === Number(id)), `Referenced expression ${id} must have a source row.`);
      const result = resolveSchoolPortrait(viewFor(Number(id)).character, changliAssets, fixture.definition);
      assert.equal(result.kind, fixture.definition.unsupportedExpressions.has(Number(id)) ? 'fallback' : 'spine');
    }
  }
  assert.equal(rows, 233); assert.equal(compositions, 224);
  assert.equal(fixtures.get(850012)!.resources.expressions.get(700061)!.eye, 'dongzuo1_zhengchang_zhengtyan', 'Keep the actual source/skeleton spelling.');
});

test('authored eye cycles keep original speed and resume at phase zero after source eye-track blinks', () => {
  let cycles = 0;
  for (const fixture of [...fixtures.values()].map(fixture => schoolRoverCounterpart(fixture.definition.talkerId) ? roverFixture(fixture.definition.talkerId) : fixture)) for (const name of fixture.definition.profile.loopAnimations ?? []) {
    const expression = [...fixture.resources.expressions.values()].find(expression => expression.eye === name && expression.blink);
    assert.ok(expression, `${fixture.definition.name} ${name}`);
    const actor = actorFor(fixture, expression.id), control = actorFor(fixture, expression.id), view = viewFor(expression.id);
    control.setBlinkEnabled(false);
    const eye = actor.animationState.getCurrent(2)!;
    try {
      assert.equal(eye.loop, true); assert.equal(eye.timeScale, 1); assert.ok(eye.animation.duration > 0);
      actor.render(view, 2.99); control.render(view, 2.99);
      assert.equal(actor.animationState.getCurrent(2), eye); assert.deepEqual(geometry(actor), geometry(control));
      actor.setExpression({ ...expression }); actor.render(view, .02); control.render(view, .02);
      const blink = actor.animationState.getCurrent(2)!;
      const duration = blink.animation.duration;
      assert.ok(blink); assert.equal(blink.loop, false); assert.equal(blink.timeScale, 1);
      assert.ok(Math.abs(blink.trackTime - .01) < 1e-7);
      actor.render(view, duration - .01); control.render(view, duration - .01);
      const resumed = actor.animationState.getCurrent(2)!;
      assert.equal(resumed.animation.name, eye.animation.name); assert.equal(resumed.loop, true);
      assert.ok(Math.abs(resumed.trackTime) < 1e-7, 'The queued eye restarts its phase; Spine may recycle track entries.');
      const fresh = actorFor(fixture, expression.id);
      try { assertSameSourcePose(actor, fresh, `${fixture.definition.name}: restore the source eye at phase zero`); } finally { fresh.dispose(); }
      actor.render(view, 3 - duration - .01); assert.equal(actor.animationState.getCurrent(2), resumed);
      actor.render(view, .02); assert.equal(actor.animationState.getCurrent(2)!.loop, false);
      cycles++;
    } finally { actor.dispose(); control.dispose(); }
  }
  assert.ok(cycles >= 30, 'Exercise every authored cycle across the new structurally different portraits.');
  const abby = actorFor(fixtures.get(700005)!);
  try { assert.equal(abby.animationState.getCurrent(2)!.loop, true); assert.equal(abby.animationState.getCurrent(2)!.animation.duration, .20000001788139343); } finally { abby.dispose(); }
});

test('all static and closed-eye source expressions without blink mappings hold their authored pose', () => {
  let checked = 0;
  for (const fixture of fixtures.values()) for (const expression of fixture.resources.expressions.values()) {
    if (expression.blink || fixture.data.findAnimation(expression.eye)!.duration > 0) continue;
    const actor = actorFor(fixture, expression.id), before = geometry(actor);
    try { actor.render(viewFor(expression.id), 30); assert.equal(actor.animationState.getCurrent(3), null); assert.equal(geometry(actor), before, `${fixture.definition.name}/${expression.id}`); checked++; }
    finally { actor.dispose(); }
  }
  assert.equal(checked, 44);
});

test('an authored animated eye expression without a blink mapping receives no provisional blink', () => {
  let checked = 0;
  for (const fixture of fixtures.values()) for (const expression of fixture.resources.expressions.values()) {
    if (expression.blink || fixture.data.findAnimation(expression.eye)!.duration === 0) continue;
    const actor = actorFor(fixture, expression.id), eye = actor.animationState.getCurrent(2)!;
    try {
      assert.equal(eye.loop, true); assert.equal(eye.timeScale, 1);
      actor.render(viewFor(expression.id), 20);
      assert.equal(actor.animationState.getCurrent(3), null); assert.equal(actor.animationState.getCurrent(2), eye); assert.equal(eye.trackTime, 20); checked++;
    } finally { actor.dispose(); }
  }
  assert.equal(checked, 1);
});

test('the original Changli, Chisa and Abby resources and shared runtime retain their pre-integration bytes', () => {
  const hashes = {
    'changli/spine-player.js': '28d83fdbae0af5965d568d9607e9e20710dcce8b984c0a24e9d2a1d0915938bc',
    'changli/SPINE-LICENSE.txt': '6142ee6cc2c03d3a918793e4750ae772bd3755c534d4a35e559e301acf51ec39',
    'changli/SolarSchool_Changli.skel': 'c8306e14926734034ae8f653a35260ba2ed0f99697b785c6eebdd7f0657dbee9',
    'changli/SolarSchool_Changli.atlas': '75bac2abd5871aba824abf100f4b94e93c402d75df289d310d10a637143bb5d5',
    'changli/SolarSchool_Changli.png': 'e853c72eb609288d29dedf72a600ea93346d009fff7f4c9cd6ee397a4cfde0d2',
    'changli/Changli.animation-metadata.json': '226d9df2ef759376375b8999cb46e57ad49cf3e24c26a4ba81f3ebf5893d869c',
    'chisa/SolarSchool_Qianxiao.skel': 'e47f7db5245110a4def799edafb9821090d8e1708e522b645a50d3356cd5fd89',
    'chisa/SolarSchool_Qianxiao.atlas': '63c2af0cc87c66eead22f9bc0a247ffe01ae2c4066abd26cd561f659c7970fb1',
    'chisa/SolarSchool_Qianxiao.png': '9fee7e122bd87faa44fe4442a9cc1c72cb98c60de536c888337668822cb821a9',
    'chisa/Chisa.animation-metadata.json': 'c062e42c27d20079545efe3c3e3712a334b5c52e14f0c195001a47cc32043bca',
    'abby/SolarSchool_Abu.skel': '44d625e88a23edad6ce69e6760d7c784ecd46326e4572afc139c38bf08aa8a97',
    'abby/SolarSchool_Abu.atlas': 'ed4be804c36969d54e49207040f83bce132d595b1db97b7c1e380639cd5aa562',
    'abby/SolarSchool_Abu.png': 'd4f2ce52f56ffba7f4188e564dac13393abe88f4864425fc411f1b6aa4a83c08',
    'abby/Abby.animation-metadata.json': 'aaf41aa534ed71acaa3ea38762d21b5df3c73e7173f499a350e5ab84e7da0e6f',
  };
  for (const [file, hash] of Object.entries(hashes)) assert.equal(sha256(`public/assets/solarschool/characters/${file}`), hash, file);
});

test('simultaneous instances share skeleton data while retaining independent expressions, animation state and blink pauses', async () => {
  for (const fixture of fixtures.values()) {
    const rig = adapterRig(fixture);
    let state = entered(fixture.definition.profile.calibration.referenceExpression, 'left');
    state = reduceStageEvent(state, event({ op: 'enter', who: 'right', expr: fixture.definition.profile.calibration.referenceExpression, t: 0 }, 1, 2));
    try {
      rig.sync(state); await finishLoads();
      const scene = rig.scenes[0], [left, right] = scene.actors;
      assert.equal(scene.actors.length, 2); assert.notEqual(left.skeleton, right.skeleton); assert.notEqual(left.animationState, right.animationState);
      assert.equal(left.skeleton.data, right.skeleton.data);
      rig.frame(0); rig.frame(2900);
      const rightEye = right.animationState.getCurrent(2), rightTime = rightEye!.trackTime;
      const replacement = [...fixture.resources.expressions.values()].find(expression => expression.id !== fixture.definition.profile.calibration.referenceExpression && changliAssets.manifest.expressions[String(expression.id)])!;
      state = reduceStageEvent(state, event({ op: 'modify', who: 'left', expr: replacement.id, t: 0 }, 1, 3));
      rig.sync(state);
      assert.equal(scene.actors.length, 2); assert.equal(left.expressions.at(-1), replacement.id);
      assert.equal(right.animationState.getCurrent(2), rightEye); assert.equal(rightEye!.trackTime, rightTime);
      assert.equal(right.expressions.length, 1, 'Updating the other stage slot must not restart this expression.');
      assert.notEqual(left.animationState.getCurrent(2), rightEye);
      rig.frame(3100);
      const mapped = fixture.resources.expressions.get(fixture.definition.profile.calibration.referenceExpression)!;
      if (mapped.blink) assert.equal(right.animationState.getCurrent(2)!.animation.name, mapped.blink, 'The original slot keeps its already pending blink timer.');
    } finally { rig.dispose(); }
  }
});

test('the shared adapter preserves presentation fades, movement, scaling, dimming, visibility and entry replacement for every portrait', async () => {
  for (const fixture of fixtures.values()) {
    const rig = adapterRig(fixture), transitions = new StageTransitions();
    let state = initialStageState(1), sequence = 0, now = 0;
    const apply = (operation: StageOp) => {
      const action = event(operation, 1, ++sequence), next = reduceStageEvent(state, action);
      transitions.apply(state, next, action, false, now); state = next; rig.sync(state, transitions.project(state, now).characters);
    };
    const tick = (ms: number) => { now += ms; rig.sync(state, transitions.project(state, now).characters); };
    try {
      apply({ op: 'enter', who: 'visible', expr: fixture.definition.profile.calibration.referenceExpression, hideAvatar: true, fadeIn: .4, pos: [0, 0, 1], t: 0 });
      await finishLoads(); const actor = rig.scenes[0].actors[0];
      tick(200); assert.ok(Math.abs(actor.skeleton.color.a - .5) < 1e-7);
      tick(200); assert.equal(actor.skeleton.color.a, 1);
      const entrySequence = state.characters.visible.entrySequence;
      apply({ op: 'move', who: 'visible', pos: [400, -100, 1.25], dur: .8, t: 0 });
      tick(400);
      const moving = transitions.project(state, now).characters[0];
      assert.deepEqual(moving.position, [200, -50, 1.125]);
      const target = fixture.definition.profile.transform(moving.position);
      assert.equal(actor.skeleton.x, target.x); assert.equal(actor.skeleton.y, target.y); assert.equal(actor.skeleton.scaleX, target.scale);
      assert.equal(state.characters.visible.entrySequence, entrySequence);
      apply({ op: 'modify', who: 'visible', effect: 'Darken', t: 0 });
      assert.equal(actor.skeleton.color.a, 1); assert.equal(actor.skeleton.color.r, 1);
      tick(100); assert.equal(actor.skeleton.color.r, .79); assert.equal(actor.skeleton.color.a, 1);
      tick(100); assert.equal(actor.skeleton.color.r, .58);
      assert.deepEqual(transitions.project(state, now).characters[0].position, [300, -75, 1.1875], 'Color fades leave the active move running.');
      apply({ op: 'modify', who: 'visible', hidePortrait: true, hideAvatar: false, t: 0 });
      assert.equal(actor.skeleton.color.a, 1, 'An invisible actor stops drawing; it remains owned for a later source show.');
      assert.equal(state.characters.visible.avatarVisible, true); assert.equal(rig.scenes[0].visible.length, 0);
      assert.equal(actor.animationState.getCurrent(3), null);
      apply({ op: 'modify', who: 'visible', hidePortrait: false, effect: 'Highlight', t: 0 });
      assert.equal(rig.scenes[0].actors.length, 1); assert.equal(actor.skeleton.color.a, 1);
      apply({ op: 'exit', who: 'visible', fadeOut: .4, t: 0 });
      tick(200); assert.ok(Math.abs(actor.skeleton.color.a - .5) < 1e-7); assert.equal(actor.disposalCount, 0);
      tick(200); assert.equal(actor.disposalCount, 1); assert.equal(rig.scenes[0].visible.length, 0);
      apply({ op: 'enter', who: 'visible', expr: fixture.definition.profile.calibration.referenceExpression, t: 0 });
      assert.equal(rig.scenes[0].actors.length, 2); assert.notEqual(state.characters.visible.entrySequence, entrySequence);
    } finally { rig.dispose(); }
  }
});

test('late asset promises cannot resurrect any portrait after exit, restart, script switch or disposal', async () => {
  for (const fixture of fixtures.values()) for (const action of ['exit', 'restart', 'switch', 'dispose'] as const) {
    const pending = deferred<ChangliResources>(), rig = adapterRig(fixture, () => pending.promise);
    const initial = entered(fixture.definition.profile.calibration.referenceExpression);
    try {
      rig.sync(initial);
      if (action === 'exit') rig.sync(reduceStageEvent(initial, event({ op: 'exit', who: 'independent-stage-slot', t: 0 }, 1, 2)));
      if (action === 'restart') rig.sync(initialStageState(2));
      if (action === 'switch') {
        const other = definitions.find(definition => definition.talkerId !== fixture.definition.talkerId)!;
        rig.sync(entered(other.profile.calibration.referenceExpression, 'new-script-slot', 2));
      }
      if (action === 'dispose') rig.adapter.dispose();
      pending.resolve(fixture.resources); await finishLoads();
      assert.equal(rig.scenes.length, 0, `${fixture.definition.name}: stale ${action} load`);
      assert.equal(Object.values(rig.statuses).some(status => status.kind === 'ready'), false);
      assert.equal(rig.pending.size, 0);
    } finally { rig.dispose(); }
  }
});

test('canceled frame callbacks cannot draw or schedule new frames after exit, restart, script switch or disposal', async () => {
  for (const fixture of fixtures.values()) for (const action of ['exit', 'restart', 'switch', 'dispose'] as const) {
    const rig = adapterRig(fixture), initial = entered(fixture.definition.profile.calibration.referenceExpression);
    try {
      rig.sync(initial); await finishLoads(); rig.frame(0); rig.frame(2700);
      const scene = rig.scenes[0], actor = scene.actors[0], callback = rig.history.at(-1)!;
      if (action === 'exit') rig.sync(reduceStageEvent(initial, event({ op: 'exit', who: 'independent-stage-slot', t: 0 }, 1, 2)));
      if (action === 'restart' || action === 'switch') rig.sync(initialStageState(2));
      if (action === 'dispose') rig.adapter.dispose();
      const renders = scene.renderCount;
      callback(20_000); callback(21_000);
      assert.equal(actor.disposalCount, 1); assert.equal(scene.renderCount, renders, `${fixture.definition.name}: ${action}`);
      assert.equal(rig.pending.size, 0);
      if (action === 'restart' || action === 'switch') { rig.sync(initial); assert.equal(scene.renderCount, renders, 'An earlier run cannot replace the current scene.'); }
    } finally { rig.dispose(); }
  }
});

test('a blocked male Rover expression becomes a labeled fallback and can recover to another verified expression on the same source entry', async () => {
  const fixture = fixtures.get(850001)!, rig = adapterRig(fixture);
  let state = entered(700126, 'source-player-slot');
  try {
    rig.sync(state); await finishLoads(); rig.frame(0); rig.frame(2900);
    const first = rig.scenes[0].actors[0], entry = state.characters['source-player-slot'].entrySequence;
    state = reduceStageEvent(state, event({ op: 'modify', who: 'source-player-slot', expr: 700128, t: 0 }, 1, 2)); rig.sync(state);
    assert.equal(first.disposalCount, 1); assert.equal(first.animationState.getCurrent(3), null);
    assert.equal(rig.statuses['source-player-slot'].kind, 'fallback'); assert.match(rig.statuses['source-player-slot'].reason!, /dongzuo1_yansu_zui/);
    rig.sync(state); assert.equal(rig.scenes[0].actors.length, 1, 'An invalid expression must not repeatedly create actors.');
    state = reduceStageEvent(state, event({ op: 'modify', who: 'source-player-slot', expr: 700127, t: 0 }, 1, 3)); rig.sync(state);
    assert.equal(state.characters['source-player-slot'].entrySequence, entry);
    assert.equal(rig.statuses['source-player-slot'].kind, 'ready'); assert.equal(rig.scenes[0].actors.length, 2);
    assert.equal(rig.scenes[0].actors[1].expressions[0], 700127);
  } finally { rig.dispose(); }
});

test('irregular visible frames keep original animation speed while hidden-tab time pauses the same actor and pending blink', async () => {
  const previousDocument = globalThis.document, listeners = new Set<() => void>();
  const documentStub = { hidden: false, addEventListener: (name: string, listener: () => void) => { assert.equal(name, 'visibilitychange'); listeners.add(listener); },
    removeEventListener: (name: string, listener: () => void) => { assert.equal(name, 'visibilitychange'); listeners.delete(listener); } };
  globalThis.document = documentStub as unknown as Document;
  const fixture = fixtures.get(700006)!, rig = adapterRig(fixture);
  try {
    rig.sync(entered(fixture.definition.profile.calibration.referenceExpression)); await finishLoads();
    const actor = rig.scenes[0].actors[0], eye = actor.animationState.getCurrent(2)!;
    rig.frame(0); rig.frame(1400);
    assert.ok(Math.abs(eye.trackTime - 1.4) < 1e-7, 'A slow frame must advance the full original-speed elapsed time.');
    documentStub.hidden = true; for (const listener of listeners) listener();
    rig.frame(700_000); rig.frame(800_000); assert.ok(Math.abs(eye.trackTime - 1.4) < 1e-7); assert.equal(actor.animationState.getCurrent(3), null);
    documentStub.hidden = false; for (const listener of listeners) listener();
    rig.frame(900_000); rig.frame(901_500);
    assert.equal(actor.animationState.getCurrent(2), eye); assert.equal(rig.scenes[0].actors.length, 1);
    assert.ok(Math.abs(eye.trackTime - 2.9) < 1e-7); assert.equal(actor.animationState.getCurrent(3), null);
    rig.frame(901_700);
    assert.ok(Math.abs(actor.animationState.getCurrent(2)!.trackTime - .1) < 1e-7, 'The preserved blink interval counts only visible time.');
    assert.equal(actor.expressions.length, 1);
  } finally { rig.dispose(); globalThis.document = previousDocument; assert.equal(listeners.size, 0, 'Disposal removes the document listener.'); }
});

function realRunner(id: string, included: readonly number[], loads?: ReadonlyMap<number, Promise<ChangliResources>>) {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock });
  const rigs = new Map(included.map(talkerId => { const fixture = fixtures.get(talkerId)!; return [talkerId, adapterRig(fixture, () => loads?.get(talkerId) ?? Promise.resolve(fixture.resources))] as const; }));
  const sync = () => { const snapshot = runner.getSnapshot(); for (const rig of rigs.values()) rig.sync(snapshot.stageState, snapshot.presentation.characters); };
  const unsubscribe = runner.subscribe(sync);
  const script = (scriptId: string): Script => read(`public/data/scripts/${scriptId}.json`);
  assert.equal(runner.load(script(id), manifest), true); assert.equal(runner.start(), true); sync();
  const tick = (ms: number) => { clock.advanceBy(ms); sync(); };
  const walkTo = (nid: number) => {
    for (let step = 0; step < 400; step++) {
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
  return { runner, clock, rigs, tick, sync, walkTo, script,
    dispose() { unsubscribe(); for (const rig of rigs.values()) rig.dispose(); runner.dispose(); assert.equal(clock.pendingTimers, 0); } };
}

test('real three-character 1034 scene keeps distinct talkers, source entries and placement while expressions change independently', async () => {
  const current = realRunner('1034', [700001, 850003, 850006]);
  try {
    await finishLoads(); current.tick(350);
    const snapshot = current.runner.getSnapshot(), stages = [['50074', 700001], ['1346', 850003], ['999', 850006]] as const;
    const actors = stages.map(([who, talker]) => {
      const rig = current.rigs.get(talker)!, actor = rig.scenes[0].actors[0];
      assert.equal(rig.statuses[who].kind, 'ready'); assert.equal(rig.scenes[0].actors.length, 1);
      const view = snapshot.presentation.characters.find(view => view.character.who === who)!;
      const expected = fixtures.get(talker)!.definition.profile.transform(view.position);
      assert.equal(actor.skeleton.x, expected.x); assert.equal(actor.skeleton.y, expected.y); assert.equal(actor.skeleton.scaleX, expected.scale);
      return actor;
    });
    assert.equal(new Set(actors.map(actor => actor.skeleton)).size, 3);
    assert.equal(new Set(actors.map(actor => actor.animationState)).size, 3);
    assert.equal(snapshot.stageState.characters['750088'].portraitVisible, false);
    const before = actors.map(actor => actor.expressions.length);
    current.walkTo(2);
    assert.ok(actors.some((actor, index) => actor.expressions.length > before[index]), 'At least one authored expression changes without replacing the cast.');
    for (const rig of current.rigs.values()) assert.equal(rig.scenes[0].actors.length, 1);
  } finally { current.dispose(); }
});

test('real source-hidden Rover and unnamed Shorekeeper never acquire an invented visible portrait or entry', async () => {
  const current = realRunner('1007', [850001, 700003]);
  try {
    current.walkTo(13); await finishLoads();
    const state = current.runner.getSnapshot().stageState;
    assert.equal(state.characters['750088'].present, true); assert.equal(state.characters['750088'].portraitVisible, false); assert.equal(state.characters['750088'].avatarVisible, true);
    assert.equal(current.rigs.get(850001)!.scenes.length, 0);
    assert.equal(state.characters['1759'].present, false); assert.equal(state.characters['1759'].entrySequence, null); assert.equal(state.characters['1759'].expression, null);
    const unnamed = resolveSchoolStaticPortrait(state.characters['1759'], changliAssets, catalog);
    assert.equal(unnamed.kind, 'fallback'); if (unnamed.kind === 'fallback') assert.match(unnamed.reason, /no usable source expression/);
    assert.equal(catalog.speakers['1759'].talkerId, 700013);
    const named = current.rigs.get(700003)!;
    assert.equal(named.scenes[0].actors.length, 1, 'Only the explicitly entered named Shorekeeper has an actor.');
    assert.equal(named.statuses['1759'], undefined);
    assert.ok(named.scenes[0].visible.every(entry => entry.view.character.who === '1398'));
  } finally { current.dispose(); }
});

test('restored TalkItem RoleConfig expression and visibility patches update existing actors without entering or replaying dialogue', async () => {
  const current = realRunner('1001', [700005, 850001]);
  try {
    current.walkTo(8); await finishLoads(); current.tick(2200);
    const actor = current.rigs.get(700005)!.scenes[0].actors[0], entry = current.runner.getSnapshot().stageState.characters['1316'].entrySequence;
    current.walkTo(13);
    const snapshot = current.runner.getSnapshot(), abby = snapshot.stageState.characters['1316'];
    assert.equal(abby.entrySequence, entry); assert.equal(abby.expression, 700222); assert.equal(actor.expressions.at(-1), 700222);
    assert.equal(abby.hidePortrait, false); assert.equal(abby.hideAvatar, true);
    assert.equal(abby.lastEvent.operation.origin, 'talk-item-role-config');
    assert.equal(current.rigs.get(700005)!.scenes[0].actors.length, 1);
    assert.equal(snapshot.nid, 13); assert.equal(snapshot.status, 'dialogue');
    assert.equal(current.rigs.get(850001)!.scenes.length, 0, 'Hidden player stage state remains hidden.');
  } finally { current.dispose(); }
});

test('actual runner restart and script switching cancel pending character loads while a new script can load its own actor', async () => {
  for (const action of ['restart', 'switch'] as const) {
    const pending = deferred<ChangliResources>(), current = realRunner('1024', [700001, 850009], new Map([[700001, pending.promise]]));
    try {
      assert.equal(current.runner.getSnapshot().nid, 1);
      if (action === 'restart') { assert.equal(current.runner.restart(), true); current.runner.load(current.script('1038'), manifest); }
      else assert.equal(current.runner.load(current.script('1038'), manifest), true);
      assert.equal(current.runner.start(), true); current.sync();
      pending.resolve(fixtures.get(700001)!.resources); await finishLoads(); current.tick(350);
      assert.equal(current.rigs.get(700001)!.scenes.length, 0);
      assert.equal(current.rigs.get(850009)!.scenes[0].actors.length, 1);
      assert.equal(current.runner.getSnapshot().scriptId, '1038');
    } finally { current.dispose(); }
  }
});

test('static NPCs resolve exact shared images from explicit speaker links and missing assets keep labeled fallbacks', () => {
  for (const definition of schoolStaticPortraits) {
    const speaker = Object.entries(catalog.speakers).find(([, speaker]) => speaker.talkerId === definition.talkerId);
    assert.ok(speaker, definition.name);
    const state = reduceStageEvent(initialStageState(1), event({ op: 'enter', who: speaker[0], t: 0 }));
    const character = state.characters[speaker[0]], resolved = resolveSchoolStaticPortrait(character, changliAssets, catalog);
    assert.equal(resolved.kind, 'texture');
    if (resolved.kind === 'texture') {
      assert.equal(resolved.url, `/assets/solarschool/characters/npc/${definition.textureFile}`);
      assert.equal(resolved.definition.sourceTexture, sourceTalkers[String(definition.talkerId)].SolarSchoolPortraitTexture);
    }
    for (const spine of definitions) assert.equal(resolveSchoolPortrait(character, changliAssets, spine).kind, 'other');
    assert.equal(resolveSchoolStaticPortrait({ ...character, who: String(definition.talkerId) }, changliAssets, { ...catalog, speakers: {} }).kind, 'other', 'Numeric equality is not a speaker link.');
    const wrong = { ...changliAssets, manifest: { ...changliAssets.manifest, talkers: { ...changliAssets.manifest.talkers, [definition.talkerId]: { portraitTexture: '/wrong/source.texture' } } } };
    const fallback = resolveSchoolStaticPortrait(character, wrong, catalog);
    assert.equal(fallback.kind, 'fallback'); if (fallback.kind === 'fallback') assert.match(fallback.reason, /source portrait texture/);
  }
  const unknown = resolveSchoolStaticPortrait(viewFor(700126, '178').character, changliAssets, catalog);
  assert.equal(unknown.kind, 'other', 'A valid expression keeps its own talker even when the stage slot has a different speaker configuration.');
  const missing = resolveSchoolStaticPortrait({ ...viewFor(700126, '178').character, expression: null }, changliAssets, catalog);
  assert.equal(missing.kind, 'fallback'); if (missing.kind === 'fallback') { assert.equal(missing.talkerId, 850013); assert.match(missing.reason, /no SolarSchool Spine or portrait texture/); }
  const shared = schoolStaticPortraits.filter(definition => definition.textureFile === 'T_IconSolarSchoolNPC006.webp');
  assert.ok(shared.length >= 2);
});
