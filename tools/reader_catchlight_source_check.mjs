/** Compare the shared Reader actor with direct application of original clips.
 * This module does not alter source assets, clocks, routes or recordings.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { ChangliSpineActor, changliSpineProfile } from '../src/spine/ChangliSpineScene.ts';
import { readChangliExpressions } from '../src/spine/ChangliAssets.ts';
import { schoolPortraits, readSchoolExpressions } from '../src/spine/SchoolPortraitAssets.ts';
import { roverMaleAvatarRepairs, schoolRoverCounterpart } from '../src/spine/SchoolRover.ts';
import { sourcePortraitProfile } from '../src/spine/SourcePortraitPlacement.ts';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const readJSON = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
export const fileIdentity = path => ({ path, sha256: createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex') });
export const spine = runInNewContext(readFileSync(resolve(root, 'public/assets/solarschool/characters/changli/spine-player.js'), 'utf8') + '\nspine;', { performance, console, setTimeout, clearTimeout });
export const sourceRows = new Map(readJSON('WutheringWaves_Data/BinData/AvgSolarSchoolRoleAnimation/avgsolarschoolroleanimation.json').map(row => [row.Id, row]));
const manifest = readJSON('public/data/assets.manifest.json');
const definitions = [{ slug: 'changli', name: 'Changli', talkerId: 850006, stem: 'SolarSchool_Changli', profile: changliSpineProfile }, ...schoolPortraits];
const metadata = new Map(definitions.map(definition => [definition.talkerId, readJSON(`public/assets/solarschool/characters/${definition.slug}/${definition.metadataFile ?? definition.name + '.animation-metadata.json'}`)]));

export const models = definitions.map(definition => {
  const base = `public/assets/solarschool/characters/${definition.slug}/`;
  const atlas = new spine.TextureAtlas(readFileSync(resolve(root, base + definition.stem + '.atlas'), 'utf8'));
  for (const page of atlas.pages) page.texture = new spine.Texture({ width: page.width, height: page.height });
  const data = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(readFileSync(resolve(root, base + definition.stem + '.skel'))));
  const raw = metadata.get(definition.talkerId);
  const counterpart = schoolRoverCounterpart(definition.talkerId);
  const expressions = definition.slug === 'changli' ? readChangliExpressions(raw) : readSchoolExpressions(raw, definition, counterpart ? metadata.get(counterpart) : undefined);
  return { definition, data, expressions,
    assets: { skeleton: fileIdentity(base + definition.stem + '.skel'), atlas: fileIdentity(base + definition.stem + '.atlas'),
      texture: fileIdentity(base + (definition.textureFile ?? definition.stem + '.png')),
      metadata: fileIdentity(base + (definition.metadataFile ?? definition.name + '.animation-metadata.json')) } };
});
export const modelBySlug = new Map(models.map(model => [model.definition.slug, model]));

export function profileFor(model, composition) {
  const definition = model.definition;
  if (composition !== 'avatar') return sourcePortraitProfile(definition.profile, manifest.talkers?.[String(definition.talkerId)]?.portraitTransform);
  if (definition.slug === 'changli') return { ...definition.profile, canvasTopOverscan: true };
  return { ...(definition.avatarProfile ?? definition.profile), horizontalFacing: definition.avatarFacing ?? 1, canvasTopOverscan: true,
    verifiedBlinks: new Set([...definition.profile.verifiedBlinks, ...(definition.talkerId === 850001 ? ['dongzuo1_zhoumei_zhayan'] : [])]) };
}

export function expressionFor(model, id, composition) {
  return composition === 'avatar' && model.definition.talkerId === 850001 && roverMaleAvatarRepairs.has(id)
    ? roverMaleAvatarRepairs.get(id) : model.expressions.get(id);
}

export function viewFor(model, composition, expression) {
  const head = manifest.talkers?.[String(model.definition.talkerId)]?.headIconTransform ?? {};
  const position = composition === 'avatar' ? [head.PosX ?? 0, head.PosY ?? 0, head.Scale ?? 1] : [0, 0, 1];
  return { character: { who: 'source-check', expression: expression.id, present: true, portraitVisible: true, avatarVisible: false, position, effect: 'Highlight' },
    position, portraitOpacity: 1, avatarOpacity: 0, brightness: 1 };
}

function attachmentVertices(slot) {
  const attachment = slot.attachment;
  if (!attachment) return [];
  const result = new Float32Array(attachment.worldVerticesLength ?? 8);
  if (attachment.worldVerticesLength) attachment.computeWorldVertices(slot, 0, result.length, result, 0, 2);
  else if (attachment.computeWorldVertices) attachment.computeWorldVertices(slot, result, 0, 2);
  return Array.from(result);
}

export function skeletonSnapshot(skeleton) {
  return { drawOrder: skeleton.drawOrder.map(slot => slot.data.name), slots: skeleton.slots.map(slot => {
    const attachment = slot.attachment;
    return { slot: slot.data.name, attachment: attachment?.name ?? null,
      attachmentType: attachment?.constructor.name ?? null, active: slot.bone.active,
      color: [slot.color.r, slot.color.g, slot.color.b, slot.color.a], blendMode: slot.data.blendMode,
      vertices: attachmentVertices(slot), uvs: Array.from(attachment?.uvs ?? []), triangles: Array.from(attachment?.triangles ?? []),
      clipEndSlot: attachment?.endSlot?.name ?? null };
  }) };
}

/** Fresh source pose, without AnimationState or the Reader's lifecycle. */
export function sourceAt(model, tracks, transform) {
  const skeleton = new spine.Skeleton(model.data);
  if (model.data.skins.length) skeleton.setSkinByName(model.data.skins[0].name);
  for (const track of tracks) {
    const animation = model.data.findAnimation(track.name);
    if (!animation) throw new Error(`Missing source clip ${track.name}.`);
    animation.apply(skeleton, 0, track.time, track.loop, [], 1, spine.MixBlend.replace, spine.MixDirection.mixIn);
  }
  [skeleton.x, skeleton.y, skeleton.scaleX, skeleton.scaleY] = transform;
  skeleton.updateWorldTransform();
  return skeleton;
}

export function compareSnapshots(actual, expected, tolerance = .005) {
  const issues = [], maxima = { vertices: 0, colors: 0, uvs: 0 };
  if (JSON.stringify(actual.drawOrder) !== JSON.stringify(expected.drawOrder)) issues.push({ kind: 'draw-order' });
  if (actual.slots.length !== expected.slots.length) issues.push({ kind: 'slot-count' });
  for (let index = 0; index < expected.slots.length; index++) {
    const observed = actual.slots[index], source = expected.slots[index];
    if (!observed) continue;
    for (const key of ['slot', 'attachment', 'attachmentType', 'active', 'blendMode', 'clipEndSlot']) {
      if (observed[key] !== source[key]) issues.push({ slot: source.slot, kind: key, actual: observed[key], expected: source[key] });
    }
    for (const [key, field, limit] of [['vertices', 'vertices', tolerance], ['color', 'colors', 1e-6], ['uvs', 'uvs', 1e-7]]) {
      if (observed[key].length !== source[key].length) { issues.push({ slot: source.slot, kind: key + '-length' }); continue; }
      const difference = Math.max(0, ...observed[key].map((value, coordinate) => Math.abs(value - source[key][coordinate])));
      maxima[field] = Math.max(maxima[field], difference);
      if (!Number.isFinite(difference) || difference > limit) issues.push({ slot: source.slot, kind: key, difference });
    }
    if (JSON.stringify(observed.triangles) !== JSON.stringify(source.triangles)) issues.push({ slot: source.slot, kind: 'triangles' });
  }
  return { passed: issues.length === 0, maxima, issues };
}

function actorTransform(actor) { return [actor.skeleton.x, actor.skeleton.y, actor.skeleton.scaleX, actor.skeleton.scaleY]; }
function nativePoseTracks(expression, eyeName, eyeTime, eyeLoop = true) {
  return [{ name: expression.body, time: 0, loop: true }, { name: expression.mouth, time: 0, loop: true }, { name: eyeName, time: eyeTime, loop: eyeLoop }];
}
function checkActor(model, actor, expression, eyeName, eyeTime, eyeLoop) {
  const current = actor.animationState.getCurrent(2), trackIssues = [];
  for (const [index, name] of [expression.body, expression.mouth].entries()) {
    const track = actor.animationState.getCurrent(index);
    if (track?.animation.name !== name || track.loop !== true || track.timeScale !== 1) {
      trackIssues.push({ kind: index === 0 ? 'body-track' : 'mouth-track', expected: name,
        actual: track?.animation.name, loop: track?.loop, timeScale: track?.timeScale });
    }
  }
  if (current?.animation.name !== eyeName) trackIssues.push({ kind: 'eye-track', expected: eyeName, actual: current?.animation.name });
  if (current?.loop !== eyeLoop) trackIssues.push({ kind: 'eye-loop', expected: eyeLoop, actual: current?.loop });
  if (current?.timeScale !== 1) trackIssues.push({ kind: 'eye-speed', actual: current?.timeScale });
  if (Math.abs((current?.trackTime ?? NaN) - eyeTime) > 1e-7) trackIssues.push({ kind: 'eye-clock', expected: eyeTime, actual: current?.trackTime });
  const expected = sourceAt(model, nativePoseTracks(expression, eyeName, eyeTime, eyeLoop), actorTransform(actor));
  const comparison = compareSnapshots(skeletonSnapshot(actor.skeleton), skeletonSnapshot(expected));
  return { ...comparison, passed: comparison.passed && !trackIssues.length, issues: [...trackIssues, ...comparison.issues] };
}

export function authoredTimes(animation, rate = 120) {
  const times = new Set([0, animation.duration]);
  for (let frame = 1; frame < Math.ceil(animation.duration * rate); frame++) times.add(frame / rate);
  for (const timeline of animation.timelines) {
    for (let index = 0; index < timeline.frames.length; index += timeline.getFrameEntries()) times.add(timeline.frames[index]);
  }
  return [...times].filter(time => time >= 0 && time <= animation.duration).sort((a, b) => a - b);
}

export function verifyComposition(model, expression, composition) {
  const eye = model.data.findAnimation(expression.eye);
  const result = { passed: true, openSamples: 0, blinkSamples: 0, maximumVertexDifference: 0, issues: [], attachmentSignature: null };
  const update = (comparison, phase, time) => {
    result.passed &&= comparison.passed;
    result.maximumVertexDifference = Math.max(result.maximumVertexDifference, comparison.maxima.vertices);
    if (!comparison.passed) result.issues.push({ phase, time, differences: comparison.issues });
  };
  const actor = new ChangliSpineActor(spine, model.data, { drawSkeleton() {} }, { random: () => 1 }, profileFor(model, composition));
  try {
    actor.setExpression(expression);
    const times = [...new Set([...authoredTimes(eye), eye.duration + .071, eye.duration * 2 + .113])].sort((a, b) => a - b);
    let last = 0;
    for (const time of times) {
      actor.render(viewFor(model, composition, expression), time - last); last = time;
      update(checkActor(model, actor, expression, expression.eye, time, true), 'open-eye', time);
      result.openSamples++;
      if (time === 0) result.attachmentSignature = skeletonSnapshot(actor.skeleton).slots.filter(slot => slot.attachment !== null).map(slot => ({ slot: slot.slot, attachment: slot.attachment }));
    }
  } finally { actor.dispose(); }
  if (expression.blink) {
    const blink = model.data.findAnimation(expression.blink);
    const blinking = new ChangliSpineActor(spine, model.data, { drawSkeleton() {} }, { random: () => 0 }, profileFor(model, composition));
    try {
      blinking.setExpression(expression); blinking.render(viewFor(model, composition, expression), 3);
      let previous = 0;
      for (const time of [...new Set([...authoredTimes(blink), blink.duration + .019, blink.duration + .073])].sort((a, b) => a - b)) {
        blinking.render(viewFor(model, composition, expression), time - previous); previous = time;
        const active = time < blink.duration - 1e-9;
        update(checkActor(model, blinking, expression, active ? expression.blink : expression.eye, active ? time : time - blink.duration, !active), active ? 'blink' : 'blink-reopen', time);
        result.blinkSamples++;
      }
    } finally { blinking.dispose(); }
  }
  return result;
}

export function verifyTransition(model, from, to, composition) {
  const phases = ['before-blink', ...(from.blink ? ['during-blink', 'after-blink'] : [])], results = [];
  for (const phase of phases) {
    const actor = new ChangliSpineActor(spine, model.data, { drawSkeleton() {} }, { random: () => 0 }, profileFor(model, composition));
    try {
      actor.setExpression(from);
      const duration = from.blink ? model.data.findAnimation(from.blink).duration : 0;
      const elapsed = phase === 'before-blink' ? .137 : phase === 'during-blink' ? 3 + duration * .37 : 3 + duration + .081;
      actor.render(viewFor(model, composition, from), elapsed);
      const oldEyeTime = phase === 'before-blink' ? elapsed : phase === 'during-blink' ? duration * .37 : .081;
      // Native source: identical channel names keep running; a changed blink
      // mapping calls StopBlinking after any blink has begun, even if reopened.
      const reset = from.eye !== to.eye || (phase !== 'before-blink' && from.blink !== to.blink);
      const keepBlink = phase === 'during-blink' && !reset;
      const eyeName = keepBlink ? from.blink : to.eye, eyeTime = reset ? 0 : oldEyeTime;
      actor.setExpression(to); actor.render(viewFor(model, composition, to), 0);
      const comparison = checkActor(model, actor, to, eyeName, eyeTime, !keepBlink);
      results.push({ phase, ...comparison });
      actor.render(viewFor(model, composition, to), .011);
      results.push({ phase: phase + '-advance', ...checkActor(model, actor, to, eyeName, eyeTime + .011, !keepBlink) });
    } finally { actor.dispose(); }
  }
  return { passed: results.every(result => result.passed), samples: results.length,
    maximumVertexDifference: Math.max(...results.map(result => result.maxima.vertices)),
    issues: results.filter(result => !result.passed) };
}
