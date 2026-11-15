/** Source audit: actual Spine 4.1 meshes, timelines and expression compositions.
 * Run: node --experimental-strip-types tools/audit_reader_catchlights.mjs
 * This samples source geometry with no blink, stage, head or camera animation.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fullSpine } from '../tests/changli-fixtures.ts';
import { schoolPortraits } from '../src/spine/SchoolPortraitAssets.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, process.argv[2] ?? 'test-results/reader-catchlights/source-assets.json');
const read = path => readFileSync(resolve(root, path));
const json = path => JSON.parse(read(path).toString('utf8'));
const hash = path => createHash('sha256').update(read(path)).digest('hex');
const sourcePath = 'WutheringWaves_Data/BinData/AvgSolarSchoolRoleAnimation/avgsolarschoolroleanimation.json';
const sourceRows = new Map(json(sourcePath).map(row => [row.Id, row]));
const manifest = json('public/data/assets.manifest.json');
const clipFields = ['BodyAnimation', 'MouthAnimation', 'EyeAnimation', 'BlinkAnimation'];
const metadataFields = ['Id', 'AvgTalkerId', 'AnimationName', ...clipFields, 'MouthOpenSmallAnimation', 'MouthOpenLargeAnimation'];
const characters = [{ slug: 'changli', name: 'Changli', talkerId: 850006, stem: 'SolarSchool_Changli', animationAliases: {} }, ...schoolPortraits];

function weightedBones(attachment) {
  const result = new Set();
  for (let index = 0; index < (attachment.bones?.length ?? 0);) {
    const count = attachment.bones[index++];
    for (let offset = 0; offset < count; offset++) result.add(attachment.bones[index++]);
  }
  return result;
}

function vertices(slot) {
  const attachment = slot.attachment;
  if (!attachment) return [];
  const result = new Float32Array(attachment.worldVerticesLength ?? 8);
  if (attachment.worldVerticesLength) attachment.computeWorldVertices(slot, 0, result.length, result, 0, 2);
  else if (attachment.computeWorldVertices) attachment.computeWorldVertices(slot, result, 0, 2);
  else return [];
  return Array.from({ length: result.length / 2 }, (_, index) => [result[index * 2], result[index * 2 + 1]]);
}

function bounds(points) {
  if (!points.length) return null;
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const left = Math.min(...xs), right = Math.max(...xs), bottom = Math.min(...ys), top = Math.max(...ys);
  return { left, right, bottom, top, centerX: (left + right) / 2, centerY: (bottom + top) / 2, width: right - left, height: top - bottom };
}

function eyePartitions(points) {
  const sorted = points.slice().sort((left, right) => left[0] - right[0]);
  let cut = 0, gap = 0;
  for (let index = 2; index < sorted.length - 2; index++) {
    const current = sorted[index][0] - sorted[index - 1][0];
    if (current > gap) { cut = index; gap = current; }
  }
  const all = bounds(points);
  if (!cut || gap < all.width / 5) return [{ name: 'combined-iris', indices: points.map((_, index) => index), bounds: all }];
  const division = (sorted[cut - 1][0] + sorted[cut][0]) / 2;
  return ['source-screen-left', 'source-screen-right'].map((name, index) => {
    const indices = points.flatMap((point, offset) => (point[0] < division) === (index === 0) ? [offset] : []);
    return { name, indices, bounds: bounds(indices.map(offset => points[offset])) };
  });
}

function timelineRecord(timeline, data) {
  return {
    type: timeline.constructor.name,
    propertyIds: timeline.propertyIds,
    ...(timeline.boneIndex === undefined ? {} : { boneIndex: timeline.boneIndex, bone: data.bones[timeline.boneIndex].name }),
    ...(timeline.slotIndex === undefined ? {} : { slotIndex: timeline.slotIndex, slot: data.slots[timeline.slotIndex].name }),
    frameEntries: timeline.getFrameEntries(),
    frames: Array.from(timeline.frames),
    ...(timeline.curves ? { decodedRuntimeCurves: Array.from(timeline.curves) } : {}),
    ...(timeline.frameVertices ? { frameVertices: timeline.frameVertices.map(value => Array.from(value)) } : {}),
  };
}

function auditCharacter(definition) {
  const directory = `public/assets/solarschool/characters/${definition.slug}/`;
  const skeletonPath = `${directory}${definition.stem}.skel`;
  const atlasPath = `${directory}${definition.stem}.atlas`;
  const metadataPath = directory + (definition.metadataFile ?? `${definition.name}.animation-metadata.json`);
  const texturePath = directory + (definition.textureFile ?? `${definition.stem}.png`);
  const metadata = json(metadataPath);
  const atlas = new fullSpine.TextureAtlas(read(atlasPath).toString('utf8'));
  for (const page of atlas.pages) page.texture = new fullSpine.Texture({ width: page.width, height: page.height });
  const data = new fullSpine.SkeletonBinary(new fullSpine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(read(skeletonPath)));
  const name = sourceName => definition.animationAliases?.[sourceName] ?? sourceName;
  const rows = metadata.dataset_animation_rows;
  const eyeNames = [...new Set([...rows.map(row => name(row.EyeAnimation)), ...data.animations.filter(animation => /_zheng(?:t)?yan$/.test(animation.name)).map(animation => animation.name)])];

  function at(row, time) {
    const skeleton = new fullSpine.Skeleton(data);
    if (data.skins.length) skeleton.setSkinByName(data.skins[0].name);
    for (const field of ['BodyAnimation', 'MouthAnimation', 'EyeAnimation']) {
      const animation = data.findAnimation(name(row[field]));
      if (animation) animation.apply(skeleton, 0, field === 'EyeAnimation' ? time : 0, false, [], 1, fullSpine.MixBlend.replace, fullSpine.MixDirection.mixIn);
    }
    skeleton.updateWorldTransform();
    return skeleton;
  }

  const eyeClips = eyeNames.map(eyeName => {
    const animation = data.findAnimation(eyeName);
    const row = rows.find(candidate => name(candidate.EyeAnimation) === eyeName)
      ?? { ...rows.find(candidate => data.findAnimation(name(candidate.BodyAnimation))), EyeAnimation: eyeName };
    if (!animation) return { name: eyeName, status: 'absent-from-skeleton', expressions: rows.filter(candidate => name(candidate.EyeAnimation) === eyeName).map(candidate => candidate.Id) };
    const initial = at(row, 0);
    // Cartethyia uses numbered source cutouts. Inspecting their atlas pixels
    // identifies _6/_8 as white reflections and _10/_9 as irises.
    const catches = initial.slots.filter(slot => slot.attachment && ((/高亮|高光/.test(slot.data.name) && !/眼睑|眼皮/.test(slot.data.name))
      || (definition.slug === 'cartethyia' && ['正常左眼_6', '正常右眼_8'].includes(slot.data.name))));
    const irises = initial.slots.filter(slot => slot.attachment && (/眼珠/.test(slot.data.name)
      || (definition.slug === 'cartethyia' && ['正常左眼_10', '正常右眼_9'].includes(slot.data.name))));
    const eyeTears = initial.slots.filter(slot => slot.attachment && definition.slug === 'cartethyia' && /动作2感动泪/.test(slot.data.name));
    const catchPoints = catches.flatMap(vertices), irisPoints = irises.flatMap(vertices);
    const partitions = irisPoints.length ? eyePartitions(irisPoints) : [];
    const catchIndices = partitions.map(part => {
      const centers = partitions.map(value => value.bounds.centerX);
      return catchPoints.flatMap((point, offset) => {
        const nearest = centers.reduce((best, center, index) => Math.abs(center - point[0]) < Math.abs(centers[best] - point[0]) ? index : best, 0);
        return nearest === partitions.indexOf(part) ? [offset] : [];
      });
    });
    const catchBoneIndices = new Set(catches.flatMap(slot => [...weightedBones(slot.attachment), slot.bone.data.index]));
    for (const index of [...catchBoneIndices]) {
      let bone = data.bones[index];
      while (bone.parent) { bone = bone.parent; catchBoneIndices.add(bone.index); }
    }
    const catchSlotIndices = new Set(catches.map(slot => slot.data.index));
    const dynamic = animation.timelines.filter(timeline => timeline.getFrameCount() > 1);
    const relevant = dynamic.filter(timeline => catchBoneIndices.has(timeline.boneIndex) || catchSlotIndices.has(timeline.slotIndex));
    const times = new Set([0, animation.duration]);
    for (let frame = 1; frame < Math.ceil(animation.duration * 120); frame++) times.add(frame / 120);
    for (const timeline of relevant) for (let offset = 0; offset < timeline.frames.length; offset += timeline.getFrameEntries()) times.add(timeline.frames[offset]);
    const orderedTimes = [...times].sort((left, right) => left - right);
    const frames = orderedTimes.map(time => {
      const skeleton = at(row, time);
      return { time, catchPoints: catches.flatMap(slot => vertices(skeleton.slots[slot.data.index])), irisPoints: irises.flatMap(slot => vertices(skeleton.slots[slot.data.index])),
        eyeTearPoints: eyeTears.flatMap(slot => vertices(skeleton.slots[slot.data.index])) };
    });
    const relative = partitions.map((part, index) => {
      const indices = catchIndices[index];
      const samples = frames.map(frame => {
        const iris = bounds(part.indices.map(offset => frame.irisPoints[offset]));
        const points = indices.map(offset => [(frame.catchPoints[offset][0] - iris.centerX) / iris.width, (frame.catchPoints[offset][1] - iris.centerY) / iris.height]);
        return { time: frame.time, bounds: bounds(points), points };
      });
      if (!indices.length) return { eye: part.name, hasSeparateCatchlight: false };
      const ranges = Object.fromEntries(['centerX', 'centerY', 'width', 'height'].map(property => {
        const values = samples.map(sample => sample.bounds[property]);
        return [property, { minimum: Math.min(...values), maximum: Math.max(...values), range: Math.max(...values) - Math.min(...values) }];
      }));
      let maximumVertexMotion = 0, maximumIrisVertexMotion = 0;
      for (const sample of samples) for (let offset = 0; offset < indices.length; offset++) maximumVertexMotion = Math.max(maximumVertexMotion, Math.hypot(sample.points[offset][0] - samples[0].points[offset][0], sample.points[offset][1] - samples[0].points[offset][1]));
      for (const frame of frames) for (const offset of part.indices) maximumIrisVertexMotion = Math.max(maximumIrisVertexMotion, Math.hypot(frame.irisPoints[offset][0] - irisPoints[offset][0], frame.irisPoints[offset][1] - irisPoints[offset][1]));
      return { eye: part.name, hasSeparateCatchlight: true, animatedRelativeToIris: maximumVertexMotion > 1e-6, referenceIrisBounds: part.bounds,
        maximumIrisVertexMotionSourceUnits: maximumIrisVertexMotion, maximumNormalizedCatchlightVertexMotion: maximumVertexMotion, normalizedCatchlightBounds: ranges,
        sourceEndpointDifference: Math.max(...samples.at(-1).points.map((point, offset) => Math.hypot(point[0] - samples[0].points[offset][0], point[1] - samples[0].points[offset][1]))) };
    });
    const animatedCatchlight = relative.some(part => part.animatedRelativeToIris);
    let tearMotion = 0;
    for (const frame of frames) for (let offset = 0; offset < frame.eyeTearPoints.length; offset++) tearMotion = Math.max(tearMotion, Math.hypot(frame.eyeTearPoints[offset][0] - frames[0].eyeTearPoints[offset][0], frame.eyeTearPoints[offset][1] - frames[0].eyeTearPoints[offset][1]));
    const status = animatedCatchlight ? 'animated-independent-catchlight' : catches.length ? 'static-separate-catchlight'
      : eyeTears.length ? 'animated-eye-tear-gleams' : irises.length ? 'combined-iris-and-reflection-texture' : 'closed-or-special-eye-cutout';
    return {
      name: eyeName, status, durationSeconds: animation.duration,
      expressions: rows.filter(candidate => name(candidate.EyeAnimation) === eyeName).map(candidate => candidate.Id),
      authoredDynamicTimelineCount: dynamic.length, independentCatchlightTimelineCount: relevant.length,
      sampleCount: frames.length, sampling: '120 Hz plus exact authored key times, one native period, no blink, fixed lower-track pose',
      catches: catches.map(slot => ({ slot: slot.data.name, slotIndex: slot.data.index, attachment: slot.attachment.name, weightedBones: [...weightedBones(slot.attachment)].map(index => data.bones[index].name), atlasRegion: slot.attachment.region?.name,
        sourceUVs: Array.from(slot.attachment.uvs ?? []), sourceTriangles: Array.from(slot.attachment.triangles ?? [0, 1, 2, 2, 3, 0]),
        referenceSourceBounds: bounds(vertices(slot)), drawOrderIndex: initial.drawOrder.indexOf(slot) })),
      irises: irises.map(slot => ({ slot: slot.data.name, slotIndex: slot.data.index, attachment: slot.attachment.name, drawOrderIndex: initial.drawOrder.indexOf(slot) })),
      overlayOrder: initial.drawOrder.filter(slot => slot.attachment && /眼皮|眼睑|眼线|睫毛/.test(slot.data.name)).map(slot => ({ slot: slot.data.name, drawOrderIndex: initial.drawOrder.indexOf(slot) })),
      irisRelativeGeometry: relative,
      ...(eyeTears.length ? { eyeTearLayers: eyeTears.map(slot => ({ slot: slot.data.name, attachment: slot.attachment.name, weightedBones: [...weightedBones(slot.attachment)].map(index => data.bones[index].name) })), maximumEyeTearVertexMotionSourceUnits: tearMotion,
        eyeTearScope: 'Authored watery-eye gleams; no separate iris cutout exists for this expression, so these are kept distinct from an independently sampled catchlight.' } : {}),
      sourceCatchlightTimelines: relevant.map(timeline => timelineRecord(timeline, data)),
      sourceOtherDynamicTimelines: dynamic.filter(timeline => !relevant.includes(timeline)).map(timeline => timelineRecord(timeline, data)),
    };
  });

  const expressions = rows.map(row => {
    const eye = eyeClips.find(clip => clip.name === name(row.EyeAnimation));
    const missing = clipFields.flatMap(field => row[field] && !data.findAnimation(name(row[field])) ? [{ field, sourceClip: row[field], effectiveClip: name(row[field]) }] : []);
    const original = sourceRows.get(row.Id);
    const sourceMatches = metadataFields.every(field => original?.[field] === row[field]);
    return { id: row.Id, sourceExpressionName: row.AnimationName, sourceMetadataMatches: sourceMatches, manifestReferenced: !!manifest.expressions?.[String(row.Id)],
      body: name(row.BodyAnimation), mouth: name(row.MouthAnimation), eye: name(row.EyeAnimation), blink: row.BlinkAnimation ? name(row.BlinkAnimation) : null,
      sourceCompositionAvailable: !missing.length, missingSourceClips: missing, catchlightStatus: eye.status,
      animatedEyes: eye.irisRelativeGeometry?.filter(part => part.animatedRelativeToIris).map(part => part.eye) ?? [] };
  });
  return { slug: definition.slug, name: definition.name, talkerId: definition.talkerId, stem: definition.stem, spineVersion: data.version,
    assets: { skeleton: { path: skeletonPath, sha256: hash(skeletonPath) }, atlas: { path: atlasPath, sha256: hash(atlasPath) }, metadata: { path: metadataPath, sha256: hash(metadataPath) },
      texture: { path: texturePath, sha256: hash(texturePath), atlasDimensions: [atlas.pages[0].width, atlas.pages[0].height] } },
    expressionCount: expressions.length, animatedCatchlightExpressions: expressions.filter(expression => expression.catchlightStatus === 'animated-independent-catchlight').map(expression => expression.id),
    staticSeparateCatchlightExpressions: expressions.filter(expression => expression.catchlightStatus === 'static-separate-catchlight').map(expression => expression.id),
    eyeClips, expressions };
}

const report = {
  authority: 'shipped-skeleton-and-source-expression-data', confidence: 'derived-from-decoded-runtime-geometry',
  runtimePath: 'public/assets/solarschool/characters/changli/spine-player.js', runtimeSha256: hash('public/assets/solarschool/characters/changli/spine-player.js'),
  originalExpressionSource: { path: sourcePath, sha256: hash(sourcePath) },
  geometryScope: 'Actual source mesh vertices, including weighted bones, sampled with fixed body/mouth, no blink or stage transforms; catchlight coordinates are normalized to their current iris bounds.',
  limitations: ['This is source geometry, not a native game framebuffer recording.',
    'Vertex bounds describe the authored mesh; they are not white-pixel centroids. Reader recordings provide the visible-pixel corroboration.',
    'Combined iris/reflection textures cannot yield independent catchlight geometry; their zero-duration eye clips retain their painted reflection.',
    'Cartethyia watery-eye tear gleams are recorded separately because that expression has no independent iris cutout.',
    'Source-side eye labels use positive skeleton X; a Reader avatar facing transform may swap screen sides.',
    'Gender-selected Rover expressions are catalogued here by each resource\'s own source metadata; cross-resource missing-name behavior remains the existing Reader policy.'],
  characters: characters.map(auditCharacter),
};
report.summary = { characters: report.characters.length, sourceExpressions: report.characters.reduce((sum, character) => sum + character.expressionCount, 0),
  independentlyAnimatedCatchlightCharacters: report.characters.filter(character => character.animatedCatchlightExpressions.length).map(character => character.slug),
  independentlyAnimatedCatchlightExpressions: report.characters.reduce((sum, character) => sum + character.animatedCatchlightExpressions.length, 0) };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, summary: report.summary,
  characters: report.characters.map(character => ({ name: character.name, animatedExpressions: character.animatedCatchlightExpressions, staticSeparateExpressions: character.staticSeparateCatchlightExpressions })) }, null, 2));
