/** Per-eye source audit, including painted reflections, occlusion and blinks.
 * Run: node --experimental-strip-types tools/audit_reader_catchlight_eyes.mjs
 * Optional: --reader-compositions path.json --only slug,slug --no-snapshots
 * No serving assets or production code are changed by this audit.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fullSpine } from '../tests/changli-fixtures.ts';
import { schoolPortraits } from '../src/spine/SchoolPortraitAssets.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const directory = resolve(root, option('--output-directory') ?? 'test-results/reader-catchlights/coverage');
const only = option('--only')?.split(',');
const sourcePath = 'WutheringWaves_Data/BinData/AvgSolarSchoolRoleAnimation/avgsolarschoolroleanimation.json';
const read = path => readFileSync(resolve(root, path));
const json = path => JSON.parse(read(path).toString('utf8'));
const sha = path => createHash('sha256').update(read(path)).digest('hex');
const sourceRows = json(sourcePath);
const sourceById = new Map(sourceRows.map(row => [row.Id, row]));
const readerPath = option('--reader-compositions');
const readerDocument = readerPath ? (() => {
  // The route record also contains detailed path observations; consume its
  // compact composition table without retaining hundreds of MB of provenance.
  const result = spawnSync('python3', ['-c', 'import json,sys,hashlib; raw=open(sys.argv[1],"rb").read(); x=json.loads(raw); print(json.dumps({"sha256":hashlib.sha256(raw).hexdigest(),"tuples":x.get("tuples",x.get("compositions",x.get("readerCompositions",[])))}))', resolve(root, readerPath)], { maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return JSON.parse(result.stdout.toString('utf8'));
})() : null;
const readerCompositions = readerDocument?.tuples ?? [];
const definitions = [{ slug: 'changli', name: 'Changli', stem: 'SolarSchool_Changli', talkerId: 850006, animationAliases: {}, avatarFacing: 1 }, ...schoolPortraits]
  .filter(definition => !only || only.includes(definition.slug));
function annotateKnownEyeChannels(report) {
  let count = 0;
  for (const character of report.characters) for (const composition of character.compositions) {
    if (composition.available || composition.missingClips.some(missing => missing.field === 'eye')) continue;
    const representative = character.compositions.find(candidate => candidate.available && candidate.clips.eye === composition.clips.eye && candidate.clips.body === composition.clips.body)
      ?? character.compositions.find(candidate => candidate.available && candidate.clips.eye === composition.clips.eye);
    if (!representative) continue;
    composition.partialEyeChannelAssessment = { sourceEyeClipAvailable: true, eyeClip: composition.clips.eye,
      durationSeconds: representative.durationSeconds, referenceCompositionKey: representative.key,
      scope: 'Available native eye-channel data, cited through an independently verified complete composition of the same clip. The listed absent lower channels keep this full source composition unavailable.',
      knownEyes: representative.eyes.map(eye => ({ eye: eye.eye, statusInVerifiedComposition: eye.status,
        authoredCatchlightMotion: eye.periodSeconds !== null, authoredPeriodSeconds: eye.periodSeconds, reflectionTreatments: eye.reflectionTreatments })) };
    count++;
  }
  report.summary.unavailableCompositionsWithKnownEyeChannel = count;
}
if (args.includes('--refresh-reader-metadata')) {
  if (!readerDocument) throw new Error('--refresh-reader-metadata requires --reader-compositions.');
  const report = json(resolve(directory, 'source-eyes.json'));
  const currentById = new Map(readerCompositions.map(composition => [composition.tupleId, composition]));
  let refreshed = 0;
  for (const character of report.characters) {
    character.readerCompositions = character.readerCompositions.map(previous => {
      const current = currentById.get(previous.tupleId);
      if (!current || ['tupleKey', 'resourceSlug', 'resourceTalkerId', 'sourceTalkerId', 'assetKind', 'composition', 'gender', 'sourceExpressionId', 'renderedExpressionId', 'clips', 'availability']
        .some(field => JSON.stringify(previous[field]) !== JSON.stringify(current[field]))) throw new Error(`Reader composition changed; run the full source audit: ${previous.tupleId}`);
      refreshed++;
      return { ...current, sourceEyeCompositionKey: previous.sourceEyeCompositionKey, ...(previous.eyes ? { eyes: previous.eyes } : {}) };
    });
  }
  const inScope = readerCompositions.filter(composition => report.characters.some(character => character.slug === composition.resourceSlug));
  if (refreshed !== inScope.length) throw new Error('Reader tuple inventory changed; run the full source audit.');
  report.readerCompositionSource = { path: readerPath, sha256: readerDocument.sha256 };
  annotateKnownEyeChannels(report);
  writeFileSync(resolve(directory, 'source-eyes.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output: resolve(directory, 'source-eyes.json'), readerMetadataRefreshed: refreshed, geometryReusedAfterIdenticalCompositionCheck: true }));
  process.exit(0);
}
const snapshots = [];
const sampleHz = 120;
const labels = ['source-screen-left', 'source-screen-right'];
// Semantics reviewed in the actual UV-projected source artwork. These shapes
// contain white eye fills/eyelid strokes; their white texels are not reflections.
const paintedEyeInterpretations = {
  changli: { '001_闭眼叹气': { forms: ['closed-lash-stroke', 'closed-lash-stroke'], description: 'The replacement face paints two closed lash strokes and no iris reflections.' } },
  chisa: { 'B_叹气闭眼': { forms: ['closed-lash-stroke', 'closed-lash-stroke'], description: 'The combined sigh face paints two closed lash strokes and no iris reflections.' } },
  abby: {
    'face_恐惧': { forms: ['closed-angular-lids', 'closed-angular-lids'], description: 'Two closed angular eyelid strokes; the adjacent colored fur markings are outside the eyes.' },
    'face_生气': { forms: ['special-white-semicircle', 'special-white-semicircle'], description: 'Two empty white semicircular eye symbols; neither contains a colored iris or a catchlight.' },
    'face_震惊': { forms: ['special-white-polygon', 'special-white-polygon'], description: 'Two empty white polygonal eye symbols; neither contains a colored iris or a catchlight.' },
    'face_星星眼': { forms: ['colored-iris-with-star', 'colored-iris-with-star'], description: 'The original gold/blue iris reflections remain painted into the combined face beneath the large yellow star symbols.' },
  },
  ciaccona: {
    'CK_wink_001_': { forms: ['colored-iris', 'closed-wink-lid'], description: 'The smaller-X eye retains a colored iris and painted white reflections; the larger-X eye is a closed lash stroke.' },
  },
  cartethyia: {
    '动作1得意': { forms: ['closed-lash-stroke', 'closed-lash-stroke'], description: 'The composed special face paints two closed lash strokes and no iris reflections.' },
    '动作1迷糊': { forms: ['closed-lash-stroke', 'closed-lash-stroke'], description: 'The composed special face paints two closed lash strokes; the cheek tear mark is distinct from an eye reflection.' },
  },
  buling: {
    '大笑_面部附件': { forms: ['closed-smile-lids', 'closed-smile-lids'], description: 'The combined laugh face paints two closed smiling lash strokes; bright face/teeth texels are not eye reflections.' },
    '生气_大笑闭眼': { forms: ['closed-smile-lids', 'closed-smile-lids'], description: 'The combined laugh face paints two closed smiling lash strokes and no colored iris.' },
  },
  verina: {
    'B_闭眼笑': { forms: ['closed-smile-lids', 'closed-smile-lids'], description: 'Both smiling eyes are painted closed, with no colored iris or reflection.' },
    'B_无奈': { forms: ['closed-lash-stroke', 'closed-lash-stroke'], description: 'Both sad eyes are painted closed, with no colored iris or reflection.' },
  },
  'rover-female': {
    '闭眼叹气': { forms: ['closed-lash-stroke', 'closed-lash-stroke'], description: 'Both sighing eyes are painted closed, with no colored iris or reflection.' },
    '喜悦': { forms: ['closed-smile-lids', 'closed-smile-lids'], description: 'Both joyful eyes are painted closed, with no colored iris or reflection.' },
  },
  galbrena: { 'B_无奈闭眼': { forms: ['closed-lash-stroke', 'closed-lash-stroke'], description: 'Both eyes are painted as closed lash strokes, with no colored iris or reflection.' } },
};

function bounds(points) {
  if (!points.length) return null;
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const left = Math.min(...xs), right = Math.max(...xs), bottom = Math.min(...ys), top = Math.max(...ys);
  return { left, right, bottom, top, centerX: (left + right) / 2, centerY: (bottom + top) / 2,
    width: right - left, height: top - bottom };
}

function worldVertices(slot, attachment = slot.attachment) {
  if (!attachment?.computeWorldVertices) return [];
  const output = new Float32Array(attachment.worldVerticesLength ?? 8);
  const proxy = attachment === slot.attachment ? slot : { bone: slot.bone, deform: [] };
  if (attachment.worldVerticesLength) attachment.computeWorldVertices(proxy, 0, output.length, output, 0, 2);
  else attachment.computeWorldVertices(proxy, output, 0, 2);
  return Array.from({ length: output.length / 2 }, (_, index) => [output[index * 2], output[index * 2 + 1]]);
}

function partition(points) {
  const sorted = points.slice().sort((a, b) => a[0] - b[0]);
  let cut = -1, largest = 0;
  for (let index = 1; index < sorted.length; index++) {
    const gap = sorted[index][0] - sorted[index - 1][0];
    if (gap > largest) { cut = index; largest = gap; }
  }
  const all = bounds(points);
  if (!all || cut < 0) return [];
  const split = (sorted[cut - 1][0] + sorted[cut][0]) / 2;
  return [bounds(points.filter(point => point[0] < split)), bounds(points.filter(point => point[0] >= split))];
}

function barycentric(point, a, b, c) {
  const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(denominator) < 1e-12) return null;
  const wa = ((b[1] - c[1]) * (point[0] - c[0]) + (c[0] - b[0]) * (point[1] - c[1])) / denominator;
  const wb = ((c[1] - a[1]) * (point[0] - c[0]) + (a[0] - c[0]) * (point[1] - c[1])) / denominator;
  const wc = 1 - wa - wb;
  return wa >= -1e-7 && wb >= -1e-7 && wc >= -1e-7 ? [wa, wb, wc] : null;
}

function project(probe, points) {
  return [0, 1].map(axis => probe.indices.reduce((sum, index, offset) => sum + points[index][axis] * probe.weights[offset], 0));
}

function texelWorldArea(probe, points, attachment, texture) {
  const p = probe.indices.map(index => points[index]);
  const uv = probe.indices.map(index => [attachment.uvs[index * 2] * texture.width, attachment.uvs[index * 2 + 1] * texture.height]);
  const area = triangle => Math.abs((triangle[1][0] - triangle[0][0]) * (triangle[2][1] - triangle[0][1])
    - (triangle[1][1] - triangle[0][1]) * (triangle[2][0] - triangle[0][0]));
  return area(p) / Math.max(1e-10, area(uv));
}

function inPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index], b = polygon[previous];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function insideBounds(point, box, expand = 0) {
  return box && point[0] >= box.left - box.width * expand && point[0] <= box.right + box.width * expand
    && point[1] >= box.bottom - box.height * expand && point[1] <= box.top + box.height * expand;
}

function colorAt(texture, u, v) {
  const x = Math.max(0, Math.min(texture.width - 1.000001, u * texture.width - 0.5));
  const y = Math.max(0, Math.min(texture.height - 1.000001, v * texture.height - 0.5));
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sample = (px, py, channel) => texture.pixels[(py * texture.width + px) * 4 + channel];
  return [0, 1, 2, 3].map(channel =>
    sample(ix, iy, channel) * (1 - fx) * (1 - fy) + sample(ix + 1, iy, channel) * fx * (1 - fy)
    + sample(ix, iy + 1, channel) * (1 - fx) * fy + sample(ix + 1, iy + 1, channel) * fx * fy);
}

function textureFor(path, width, height) {
  // Pillow provides the decoded atlas bytes. Geometry and sampling stay in the
  // supplied Spine runtime, so image reconstruction cannot alter native curves.
  const result = spawnSync('python3', ['-c', 'from PIL import Image; import sys; sys.stdout.buffer.write(Image.open(sys.argv[1]).convert("RGBA").tobytes())', resolve(root, path)],
    { maxBuffer: width * height * 4 + 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  if (result.stdout.length !== width * height * 4) throw new Error(`Atlas dimension mismatch: ${path}`);
  return { width, height, pixels: result.stdout };
}

function sparse(values, count = 48) {
  if (values.length <= count) return values;
  return Array.from({ length: count }, (_, index) => values[Math.floor(index * (values.length - 1) / (count - 1))]);
}

function hueOf(rgba) {
  const [r, g, b] = rgba, minimum = Math.min(r, g, b), maximum = Math.max(r, g, b), difference = maximum - minimum;
  if (difference < 1) return 0;
  const hue = maximum === r ? (g - b) / difference : maximum === g ? 2 + (b - r) / difference : 4 + (r - g) / difference;
  return (hue * 60 + 360) % 360;
}

function componentRecords(mask, mapped, cropWidth, cropHeight, texture, origin, kind) {
  const visited = new Uint8Array(mask.length), components = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    const queue = [start], texels = [];
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor], x = index % cropWidth, y = Math.floor(index / cropWidth);
      texels.push(index);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cropWidth || ny >= cropHeight) continue;
        const next = ny * cropWidth + nx;
        if (mask[next] && !visited[next]) { visited[next] = 1; queue.push(next); }
      }
    }
    if (texels.length < 3) continue;
    const samples = sparse(texels, kind === 'white' ? 64 : 96).map(index => {
      const x = index % cropWidth + origin[0], y = Math.floor(index / cropWidth) + origin[1];
      const rgba = Array.from(texture.pixels.subarray((y * texture.width + x) * 4, (y * texture.width + x) * 4 + 4));
      return { ...mapped[index], atlasPixel: [x, y], rgba };
    });
    components.push({ kind, texelCount: texels.length, probes: samples,
      atlasBoundsPixels: bounds(texels.map(index => [index % cropWidth + origin[0], Math.floor(index / cropWidth) + origin[1]])) });
  }
  return components;
}

function texelsFor(attachment, texture, role) {
  if (!attachment.uvs?.length) return { white: [], color: [], alphaTexels: 0, uvBoundsPixels: null };
  const uvs = Array.from({ length: attachment.uvs.length / 2 }, (_, index) => [attachment.uvs[index * 2] * texture.width, attachment.uvs[index * 2 + 1] * texture.height]);
  const box = bounds(uvs), left = Math.max(0, Math.floor(box.left)), top = Math.max(0, Math.floor(box.bottom));
  const width = Math.max(1, Math.min(texture.width, Math.ceil(box.right)) - left);
  const height = Math.max(1, Math.min(texture.height, Math.ceil(box.top)) - top);
  const mapped = new Array(width * height), white = new Uint8Array(width * height), color = new Uint8Array(width * height);
  const triangles = Array.from(attachment.triangles ?? [0, 1, 2, 2, 3, 0]);
  let alphaTexels = 0;
  for (let offset = 0; offset < triangles.length; offset += 3) {
    const indices = triangles.slice(offset, offset + 3), points = indices.map(index => uvs[index]), tri = bounds(points);
    const x0 = Math.max(left, Math.floor(tri.left)), x1 = Math.min(left + width, Math.ceil(tri.right));
    const y0 = Math.max(top, Math.floor(tri.bottom)), y1 = Math.min(top + height, Math.ceil(tri.top));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const index = (y - top) * width + x - left;
      if (mapped[index]) continue;
      const weights = barycentric([x + 0.5, y + 0.5], ...points);
      if (!weights) continue;
      const pixel = (y * texture.width + x) * 4;
      const r = texture.pixels[pixel], g = texture.pixels[pixel + 1], b = texture.pixels[pixel + 2], a = texture.pixels[pixel + 3];
      if (a < 32) continue;
      mapped[index] = { indices, weights };
      alphaTexels++;
      const minimum = Math.min(r, g, b), maximum = Math.max(r, g, b);
      const painted = role === 'iris' || role === 'combined-eye-art';
      if (minimum >= (painted ? 200 : 180) && maximum - minimum <= (painted ? 45 : 80)) white[index] = 1;
      if (a >= 128 && maximum >= 55 && maximum - minimum >= 45) color[index] = 1;
    }
  }
  return { white: componentRecords(white, mapped, width, height, texture, [left, top], 'white'),
    color: componentRecords(color, mapped, width, height, texture, [left, top], 'color'), alphaTexels,
    uvBoundsPixels: [left, top, left + width, top + height] };
}

function roleFor(slug, slot, attachment) {
  if (/高亮|高光/.test(slot) && !/眼睑|眼皮/.test(slot)) return 'separate-catchlight';
  if (slug === 'cartethyia' && ['正常左眼_6', '正常右眼_8'].includes(slot)) return 'separate-catchlight';
  if (/眼珠/.test(slot) || slug === 'cartethyia' && ['正常左眼_10', '正常右眼_9'].includes(slot)) return 'iris';
  if (slug === 'cartethyia' && /动作2感动泪/.test(slot)) return 'tear-gleam';
  if (/face_|wink|闭眼|生气_眼$|感动眼|得意|迷糊|无奈|喜悦/.test(attachment) || slot === '表情' || slot === '参考') return 'combined-eye-art';
  return null;
}

function auditCharacter(definition) {
  console.log(`Eye/occlusion audit: ${definition.slug}`);
  const assetDirectory = `public/assets/solarschool/characters/${definition.slug}/`;
  const skeletonPath = `${assetDirectory}${definition.stem}.skel`, atlasPath = `${assetDirectory}${definition.stem}.atlas`;
  const texturePath = assetDirectory + (definition.textureFile ?? `${definition.stem}.png`);
  const metadataPath = assetDirectory + (definition.metadataFile ?? `${definition.name}.animation-metadata.json`);
  const metadata = json(metadataPath), rows = metadata.dataset_animation_rows;
  for (const row of rows) {
    const original = sourceById.get(row.Id);
    if (!original || ['Id', 'AvgTalkerId', 'AnimationName', 'BodyAnimation', 'MouthAnimation', 'EyeAnimation', 'BlinkAnimation', 'MouthOpenSmallAnimation', 'MouthOpenLargeAnimation']
      .some(field => row[field] !== original[field])) throw new Error(`Source metadata mismatch: ${definition.slug}/${row.Id}`);
  }
  const atlas = new fullSpine.TextureAtlas(read(atlasPath).toString('utf8'));
  for (const page of atlas.pages) page.texture = new fullSpine.Texture({ width: page.width, height: page.height });
  if (atlas.pages.length !== 1) throw new Error(`Multiple atlas pages require an explicit texture map: ${definition.slug}`);
  const texture = textureFor(texturePath, atlas.pages[0].width, atlas.pages[0].height);
  const data = new fullSpine.SkeletonBinary(new fullSpine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(read(skeletonPath)));
  const alias = clip => definition.animationAliases?.[clip] ?? clip;
  const descriptors = new Map();
  for (const skin of data.skins) for (const entry of skin.getAttachments()) {
    const slot = data.slots[entry.slotIndex].name, attachment = entry.attachment, role = roleFor(definition.slug, slot, attachment.name);
    if (!role || !attachment.uvs?.length) continue;
    const identity = `${entry.slotIndex}:${attachment.name}:${createHash('sha256').update(Buffer.from(attachment.uvs.buffer)).digest('hex').slice(0, 12)}`;
    if (descriptors.has(identity)) continue;
    const pixels = texelsFor(attachment, texture, role);
    descriptors.set(identity, { identity, slotIndex: entry.slotIndex, slot, attachment, role, pixels });
  }
  const descriptorFor = slot => [...descriptors.values()].find(descriptor => descriptor.slotIndex === slot.data.index && descriptor.attachment === slot.attachment);
  const irises = [...descriptors.values()].filter(descriptor => descriptor.role === 'iris');
  const irisHues = irises.flatMap(descriptor => descriptor.pixels.color.flatMap(component => component.probes))
    .filter(probe => Math.max(...probe.rgba.slice(0, 3)) - Math.min(...probe.rgba.slice(0, 3)) >= 90 && Math.max(...probe.rgba.slice(0, 3)) >= 140)
    .map(probe => hueOf(probe.rgba));
  const matchesIrisHue = rgba => {
    const hue = hueOf(rgba);
    return irisHues.some(reference => Math.min(Math.abs(hue - reference), 360 - Math.abs(hue - reference)) <= 20);
  };
  const defaultIrisPrefix = irises[0]?.slot.replace(/眼珠.*$/, '');
  const fallbackIrises = definition.slug === 'cartethyia' ? irises : irises.filter(descriptor => descriptor.slot.startsWith(defaultIrisPrefix));

  function skeletonAt(clips, time = 0, phase = 'open', channel = null) {
    const skeleton = new fullSpine.Skeleton(data);
    if (data.skins.length) skeleton.setSkinByName(data.skins[0].name);
    for (const field of ['body', 'mouth', 'eye']) {
      const clip = phase === 'blink' && field === 'eye' ? clips.blink : clips[field];
      const animation = clip ? data.findAnimation(alias(clip)) : null;
      if (!animation) continue;
      const at = field === 'eye' ? time : channel === field ? time : 0;
      animation.apply(skeleton, 0, at, false, [], 1, fullSpine.MixBlend.replace, fullSpine.MixDirection.mixIn);
    }
    skeleton.updateWorldTransform();
    return skeleton;
  }

  const irisByBody = new Map();
  for (const row of rows) {
    const clips = { body: alias(row.BodyAnimation), mouth: alias(row.MouthAnimation), eye: alias(row.EyeAnimation), blink: row.BlinkAnimation ? alias(row.BlinkAnimation) : null };
    if (irisByBody.has(clips.body) || !['body', 'mouth', 'eye'].every(field => data.findAnimation(clips[field]))) continue;
    const skeleton = skeletonAt(clips);
    const active = skeleton.slots.map(descriptorFor).filter(descriptor => descriptor?.role === 'iris');
    if (active.length) irisByBody.set(clips.body, active);
  }

  function layersAt(skeleton) {
    let clipping = null, clippingEnd = null;
    return skeleton.drawOrder.map((slot, drawOrderIndex) => {
      const attachment = slot.attachment;
      if (attachment?.constructor.name === 'ClippingAttachment' && !clipping) {
        clipping = { slot: slot.data.name, attachment: attachment.name, polygon: worldVertices(slot), endSlot: attachment.endSlot?.index ?? null };
        clippingEnd = attachment.endSlot?.index ?? null;
      }
      const points = worldVertices(slot), box = bounds(points);
      const layer = { slot, attachment, points, box, drawOrderIndex, clipping,
        alpha: (slot.color?.a ?? 1) * (attachment?.color?.a ?? 1) * skeleton.color.a,
        triangles: [], descriptor: descriptorFor(slot) };
      if (attachment?.uvs?.length) {
        const sourceTriangles = Array.from(attachment.triangles ?? [0, 1, 2, 2, 3, 0]);
        for (let offset = 0; offset < sourceTriangles.length; offset += 3) {
          const indices = sourceTriangles.slice(offset, offset + 3), trianglePoints = indices.map(index => points[index]);
          layer.triangles.push({ indices, points: trianglePoints, box: bounds(trianglePoints) });
        }
      }
      // Empty slots still end clipping in the native renderer.
      if (slot.data.index === clippingEnd) { clipping = null; clippingEnd = null; }
      return layer;
    });
  }

  function alphaAt(layer, point) {
    if (!layer.attachment?.uvs?.length || !layer.alpha || !insideBounds(point, layer.box)) return 0;
    if (layer.clipping && !inPolygon(point, layer.clipping.polygon)) return 0;
    for (const triangle of layer.triangles) {
      if (!insideBounds(point, triangle.box)) continue;
      const weights = barycentric(point, ...triangle.points);
      if (!weights) continue;
      const uv = [0, 1].map(axis => triangle.indices.reduce((sum, index, offset) => sum + layer.attachment.uvs[index * 2 + axis] * weights[offset], 0));
      const rgba = colorAt(texture, ...uv), alpha = rgba[3] / 255 * layer.alpha;
      const blend = layer.slot.data.blendMode;
      if (blend === 1) return 0; // Additive does not remove the lower layer.
      const rgb = rgba.slice(0, 3).map((value, index) => value / 255 * [layer.slot.color.r, layer.slot.color.g, layer.slot.color.b][index]
        * [layer.attachment.color.r, layer.attachment.color.g, layer.attachment.color.b][index]);
      // The Reader draws with straight alpha. These are the actual native GL
      // destination coefficients for multiply and screen, respectively.
      if (blend === 2) return 1 - Math.min(1, Math.min(...rgb) + 1 - alpha);
      if (blend === 3) return Math.max(...rgb);
      return alpha;
    }
    return 0;
  }

  function visibility(layer, point, layers) {
    if (!layer.alpha) return { amount: 0, blocker: `${layer.slot.data.name}:alpha-zero` };
    if (layer.clipping && !inPolygon(point, layer.clipping.polygon)) return { amount: 0, blocker: `clip:${layer.clipping.slot}` };
    let amount = layer.alpha, blocker = null, maximumCover = 0;
    for (let index = layer.drawOrderIndex + 1; index < layers.length; index++) {
      const cover = alphaAt(layers[index], point);
      if (cover > maximumCover) { maximumCover = cover; blocker = layers[index].slot.data.name; }
      amount *= 1 - cover;
      if (amount < 1e-6) break;
    }
    return { amount, blocker: amount < 0.5 ? blocker : null };
  }

  function frameAt(clips, time, phase = 'open', channel = null) {
    const skeleton = skeletonAt(clips, time, phase, channel), layers = layersAt(skeleton);
    const activeIrises = layers.filter(layer => layer.descriptor?.role === 'iris');
    const referenceDescriptors = activeIrises.length ? activeIrises.map(layer => layer.descriptor) : irisByBody.get(clips.body) ?? fallbackIrises;
    const referencePoints = referenceDescriptors.flatMap(descriptor => worldVertices(skeleton.slots[descriptor.slotIndex], descriptor.attachment));
    let eyeBounds = partition(referencePoints);
    if (eyeBounds.length !== 2 || eyeBounds.some(box => !box || box.width < 1)) {
      const fallbackPoints = fallbackIrises.flatMap(descriptor => worldVertices(skeleton.slots[descriptor.slotIndex], descriptor.attachment));
      eyeBounds = partition(fallbackPoints);
    }
    const division = eyeBounds.length === 2 ? (eyeBounds[0].right + eyeBounds[1].left) / 2 : 0;
    const eyes = labels.map((eye, index) => ({ eye, index, referenceIrisBounds: eyeBounds[index] ?? null,
      irisPoints: [], irisWeights: [], reflectionPoints: [], reflectionWeights: [], reflectionTypes: new Set(),
      irisTotalWeight: 0, reflectionTotalWeight: 0,
      reflectionLayers: new Map(), irisLayers: new Map(), reflectionComponents: new Map(), blockers: new Map(), otherMarks: [], paintedInterpretation: null }));
    for (const layer of layers) {
      const descriptor = layer.descriptor;
      if (!descriptor || !layer.points.length) continue;
      const pixelComponents = descriptor.pixels;
      const classifyEye = point => point[0] < division ? 0 : 1;
      const interpretation = paintedEyeInterpretations[definition.slug]?.[descriptor.attachment.name];
      if (interpretation) for (let index = 0; index < 2; index++) eyes[index].paintedInterpretation = {
        form: interpretation.forms[index], description: interpretation.description, slot: descriptor.slot,
        attachment: descriptor.attachment.name, uvBoundsPixels: descriptor.pixels.uvBoundsPixels };
      if (descriptor.role === 'iris' || descriptor.role === 'combined-eye-art') {
        for (const component of pixelComponents.color) {
          for (const probe of sparse(component.probes, 32)) {
            if (descriptor.role === 'combined-eye-art' && (Math.max(...probe.rgba.slice(0, 3)) < 110 || !matchesIrisHue(probe.rgba))) continue;
            const point = project(probe, layer.points), index = classifyEye(point), eye = eyes[index];
            if (!insideBounds(point, eye.referenceIrisBounds, descriptor.role === 'iris' ? 0.05 : 0)) continue;
            const visible = visibility(layer, point, layers);
            const worldArea = component.texelCount / Math.min(32, component.probes.length) * texelWorldArea(probe, layer.points, layer.attachment, texture);
            eye.irisPoints.push(point); eye.irisWeights.push(visible.amount * worldArea); eye.irisTotalWeight += worldArea;
            eye.irisLayers.set(descriptor.identity, descriptor);
          }
        }
      }
      if (descriptor.role === 'tear-gleam') {
        const points = pixelComponents.white.flatMap(component => component.probes.map(probe => project(probe, layer.points)));
        if (points.length) {
          const box = bounds(points), index = classifyEye([box.centerX, box.centerY]);
          eyes[index].otherMarks.push({ kind: 'authored-tear-gleam', slot: descriptor.slot, attachment: descriptor.attachment.name,
            whiteTexels: pixelComponents.white.reduce((sum, component) => sum + component.texelCount, 0), sourceBounds: box });
        }
      }
      if (!['separate-catchlight', 'iris', 'combined-eye-art'].includes(descriptor.role)) continue;
      for (const component of pixelComponents.white) {
        const projected = component.probes.map(probe => project(probe, layer.points));
        const componentBox = bounds(projected), center = [componentBox.centerX, componentBox.centerY], index = classifyEye(center), eye = eyes[index];
        let isReflection = descriptor.role === 'separate-catchlight';
        if (!isReflection && eye.referenceIrisBounds) {
          const reference = eye.referenceIrisBounds;
          isReflection = insideBounds(center, reference, 0.05) && componentBox.width < reference.width * 0.6
            && componentBox.height < reference.height * 0.55 && componentBox.centerY >= reference.bottom + reference.height * 0.2
            && component.probes.some(probe => Math.min(...probe.rgba.slice(0, 3)) >= 200 && Math.max(...probe.rgba.slice(0, 3)) - Math.min(...probe.rgba.slice(0, 3)) <= 45);
        }
        if (!isReflection) continue;
        const type = descriptor.role === 'separate-catchlight' ? 'separate' : 'baked';
        eye.reflectionTypes.add(type); eye.reflectionLayers.set(descriptor.identity, descriptor);
        eye.reflectionComponents.set(`${descriptor.identity}:${component.atlasBoundsPixels.left}:${component.atlasBoundsPixels.bottom}`, {
          slot: descriptor.slot, attachment: descriptor.attachment.name, treatment: type, texelCount: component.texelCount,
          atlasBoundsPixels: component.atlasBoundsPixels, sourceWorldBounds: componentBox,
          irisRelativeCenter: eye.referenceIrisBounds ? { x: (componentBox.centerX - eye.referenceIrisBounds.left) / eye.referenceIrisBounds.width,
            y: (componentBox.centerY - eye.referenceIrisBounds.bottom) / eye.referenceIrisBounds.height } : null });
        for (let offset = 0; offset < projected.length; offset++) {
          const point = projected[offset], side = classifyEye(point), owner = eyes[side];
          // Some single cutouts contain both eyes as disconnected white blobs.
          const visible = visibility(layer, point, layers);
          const worldArea = component.texelCount / projected.length * texelWorldArea(component.probes[offset], layer.points, layer.attachment, texture);
          owner.reflectionPoints.push({ identity: `${descriptor.identity}:${component.atlasBoundsPixels.left}:${component.atlasBoundsPixels.bottom}:${offset}`, point });
          owner.reflectionWeights.push(visible.amount * worldArea); owner.reflectionTotalWeight += worldArea;
          owner.reflectionTypes.add(type); owner.reflectionLayers.set(descriptor.identity, descriptor);
          if (visible.blocker) owner.blockers.set(visible.blocker, (owner.blockers.get(visible.blocker) ?? 0) + 1);
        }
      }
    }
    for (const eye of eyes) {
      const coloredTotal = eye.irisTotalWeight, reflectionTotal = eye.reflectionTotalWeight;
      eye.visibleIrisWeight = eye.irisWeights.reduce((sum, value) => sum + value, 0);
      eye.visibleReflectionWeight = eye.reflectionWeights.reduce((sum, value) => sum + value, 0);
      eye.visibleIrisFraction = coloredTotal ? Math.min(1, eye.visibleIrisWeight / coloredTotal) : 0;
      eye.visibleReflectionFraction = reflectionTotal ? Math.min(1, eye.visibleReflectionWeight / reflectionTotal) : 0;
      const visibleIris = eye.irisPoints.filter((_, index) => eye.irisWeights[index] > 1e-5);
      eye.currentIrisBounds = bounds(eye.irisPoints) ?? eye.referenceIrisBounds;
      eye.visibleIrisBounds = bounds(visibleIris);
      for (const component of eye.reflectionComponents.values()) {
        component.referenceIrisRelativeCenter = component.irisRelativeCenter;
        delete component.irisRelativeCenter;
        const box = eye.currentIrisBounds;
        component.currentIrisRelativeCenter = box ? { x: (component.sourceWorldBounds.centerX - box.left) / box.width,
          y: (component.sourceWorldBounds.centerY - box.bottom) / box.height } : null;
      }
      eye.open = eye.visibleIrisWeight > 2 && eye.visibleIrisFraction > 0.002;
      eye.reflectionVisible = eye.open && eye.visibleReflectionWeight > 0.5;
      const paintedForm = eye.paintedInterpretation?.form;
      if (paintedForm?.startsWith('closed') || paintedForm?.startsWith('special-white')) {
        eye.open = false; eye.reflectionVisible = false;
        eye.visibleIrisWeight = 0; eye.visibleIrisFraction = 0;
        eye.currentIrisBounds = eye.referenceIrisBounds;
      }
      if (!eye.open && eye.reflectionTypes.has('baked')) {
        eye.reflectionTypes.delete('baked');
        for (const [key, descriptor] of eye.reflectionLayers) if (descriptor.role !== 'separate-catchlight') eye.reflectionLayers.delete(key);
        for (const [key, component] of eye.reflectionComponents) if (component.treatment === 'baked') eye.reflectionComponents.delete(key);
        if (!eye.reflectionLayers.size) { eye.visibleReflectionFraction = 0; eye.visibleReflectionWeight = 0; }
      }
    }
    return { time, phase, channel, skeleton, layers, eyes };
  }

  function sampleTimes(animation, dense = true) {
    if (!animation) return [0];
    const times = new Set([0, animation.duration]);
    if (dense) for (let frame = 1; frame < Math.ceil(animation.duration * sampleHz); frame++) times.add(frame / sampleHz);
    for (const timeline of animation.timelines) for (let offset = 0; offset < timeline.frames.length; offset += timeline.getFrameEntries()) times.add(timeline.frames[offset]);
    return [...times].sort((a, b) => a - b);
  }

  function attachmentChanges(clips) {
    return ['body', 'mouth', 'eye', 'blink'].flatMap(channel => {
      const animation = clips[channel] ? data.findAnimation(alias(clips[channel])) : null;
      if (!animation) return [];
      return animation.timelines.flatMap(timeline => {
        if (timeline.constructor.name === 'AttachmentTimeline') return [{ channel, clip: animation.name, slot: data.slots[timeline.slotIndex].name,
          times: Array.from(timeline.frames), attachments: timeline.attachmentNames }];
        if (timeline.constructor.name === 'DrawOrderTimeline') return [{ channel, clip: animation.name, type: 'draw-order',
          times: Array.from(timeline.frames), orders: timeline.drawOrders }];
        return [];
      });
    });
  }

  const compositionMap = new Map(), sourceExpressions = [];
  function register(clips, provenance) {
    const effective = Object.fromEntries(['body', 'mouth', 'eye', 'blink'].map(field => [field, clips[field] ? alias(clips[field]) : null]));
    const key = `${definition.slug}|${['body', 'mouth', 'eye', 'blink'].map(field => effective[field] ?? '').join('|')}`;
    if (!compositionMap.has(key)) compositionMap.set(key, { key, clips: effective, provenance: [] });
    compositionMap.get(key).provenance.push(provenance);
    return key;
  }
  for (const row of rows) {
    const base = { body: row.BodyAnimation, mouth: row.MouthAnimation, eye: row.EyeAnimation, blink: row.BlinkAnimation || null };
    const key = register(base, { kind: 'native-row', expressionId: row.Id, mouthVariant: 'primary' });
    const variants = [];
    for (const [field, variant] of [['MouthOpenSmallAnimation', 'speaking-small'], ['MouthOpenLargeAnimation', 'speaking-large']]) {
      if (row[field]) variants.push({ variant, clip: alias(row[field]), key: register({ ...base, mouth: row[field] }, { kind: 'native-row', expressionId: row.Id, mouthVariant: variant }) });
    }
    sourceExpressions.push({ id: row.Id, sourceName: row.AnimationName, literalClips: base, primaryCompositionKey: key, mouthVariants: variants });
  }
  const routes = readerCompositions.filter(composition => composition.resourceSlug === definition.slug).map(composition => {
    const clips = composition.effectiveClips ?? composition.clips;
    return {
    ...composition, sourceEyeCompositionKey: clips && ['body', 'mouth', 'eye'].every(field => typeof clips[field] === 'string' && clips[field].length)
      ? register(clips, { kind: 'reader-composition', key: composition.tupleId ?? composition.key ?? composition.compositionKey,
        sourceExpressionId: composition.sourceExpressionId, renderedExpressionId: composition.renderedExpressionId,
        composition: composition.composition, gender: composition.gender }) : null,
  }; });
  // Include native open-eye clips that resource composition selects even when
  // they have no row of their own (the female Rover thinking channels).
  for (const animation of data.animations.filter(animation => /_zheng(?:t)?yan$/.test(animation.name))) {
    if ([...compositionMap.values()].some(composition => composition.clips.eye === animation.name)) continue;
    const row = rows.find(row => data.findAnimation(alias(row.BodyAnimation)));
    if (row) register({ body: row.BodyAnimation, mouth: row.MouthAnimation, eye: animation.name, blink: null }, { kind: 'extra-native-eye-clip' });
  }
  const compositions = [];
  const snapshotSignatures = new Set();
  for (const composition of compositionMap.values()) {
    const { clips } = composition;
    const missingClips = ['body', 'mouth', 'eye', 'blink'].filter(field => clips[field] && !data.findAnimation(clips[field])).map(field => ({ field, clip: clips[field] }));
    const primary = composition.provenance.find(record => record.expressionId !== undefined);
    if (missingClips.length) {
      compositions.push({ ...composition, available: false, missingClips, eyes: labels.map(eye => ({ eye, status: 'unavailable-composition' })) });
      continue;
    }
    const eyeAnimation = data.findAnimation(clips.eye), openTimes = sampleTimes(eyeAnimation), initial = frameAt(clips, 0);
    const frames = [initial, ...openTimes.filter(time => time !== 0).map(time => frameAt(clips, time))];
    const eyes = labels.map((label, index) => {
      const baseline = initial.eyes[index], samples = frames.map(frame => frame.eyes[index]);
      const initialBounds = baseline.currentIrisBounds;
      const baselinePoints = new Map(baseline.reflectionPoints.map(record => [record.identity,
        [(record.point[0] - initialBounds.centerX) / Math.max(1, initialBounds.width), (record.point[1] - initialBounds.centerY) / Math.max(1, initialBounds.height)]]));
      let maximumRelativeMotion = 0, maximumIrisMotion = 0, maximumIrisShapeChange = 0, maximumRelativeTime = 0;
      for (let sampleIndex = 0; sampleIndex < frames.length; sampleIndex++) {
        const sample = samples[sampleIndex], box = sample.currentIrisBounds;
        if (!box) continue;
        for (const record of sample.reflectionPoints) {
          const before = baselinePoints.get(record.identity);
          if (!before) continue;
          const after = [(record.point[0] - box.centerX) / Math.max(1, box.width), (record.point[1] - box.centerY) / Math.max(1, box.height)];
          const motion = Math.hypot(after[0] - before[0], after[1] - before[1]);
          if (motion > maximumRelativeMotion) { maximumRelativeMotion = motion; maximumRelativeTime = frames[sampleIndex].time; }
        }
        if (initialBounds) maximumIrisMotion = Math.max(maximumIrisMotion, Math.hypot(box.centerX - initialBounds.centerX, box.centerY - initialBounds.centerY));
        if (initialBounds) maximumIrisShapeChange = Math.max(maximumIrisShapeChange, Math.abs(box.width - initialBounds.width), Math.abs(box.height - initialBounds.height));
      }
      const visible = samples.some(sample => sample.reflectionVisible), open = samples.some(sample => sample.open);
      const treatments = [...new Set(samples.flatMap(sample => [...sample.reflectionTypes]))];
      const animated = maximumRelativeMotion > 1e-6 && eyeAnimation.duration > 0;
      const last = samples.at(-1), lastBounds = last.currentIrisBounds;
      const sourceEndpointDifference = lastBounds ? Math.max(0, ...last.reflectionPoints.map(record => {
        const before = baselinePoints.get(record.identity);
        if (!before) return 0;
        return Math.hypot((record.point[0] - lastBounds.centerX) / Math.max(1, lastBounds.width) - before[0],
          (record.point[1] - lastBounds.centerY) / Math.max(1, lastBounds.height) - before[1]);
      })) : null;
      const form = baseline.paintedInterpretation?.form;
      const status = form?.startsWith('special-white') ? 'special-eye-shape-without-catchlight' : !open ? 'hidden-closed-eye' : !visible ? 'open-without-identified-catchlight'
        : `${animated ? 'animated' : 'static'}-${treatments.includes('separate') ? 'separate' : 'baked'}-catchlight`;
      const reflectionLayers = [...new Map(samples.flatMap(sample => [...sample.reflectionLayers])).values()].map(descriptor => ({
        slot: descriptor.slot, slotIndex: descriptor.slotIndex, attachment: descriptor.attachment.name, role: descriptor.role,
        uvMaskedWhiteTexels: descriptor.pixels.white.reduce((sum, component) => sum + component.texelCount, 0),
        uvBoundsPixels: descriptor.pixels.uvBoundsPixels,
        atlasWhiteComponents: descriptor.pixels.white.map(component => ({ texelCount: component.texelCount, boundsPixels: component.atlasBoundsPixels })),
        drawOrderIndex: initial.layers.find(layer => layer.descriptor?.identity === descriptor.identity)?.drawOrderIndex ?? null,
        blendMode: data.slots[descriptor.slotIndex].blendMode,
      }));
      return { eye: label, status, reflectionTreatments: treatments, openEye: open,
        eyeForm: form ?? (open ? 'colored-iris' : 'closed-or-occluded-iris'),
        reviewedPaintedTextureInterpretation: baseline.paintedInterpretation,
        visibleReflection: visible, periodSeconds: animated ? eyeAnimation.duration : null,
        maximumNormalizedWhiteTexelMotion: maximumRelativeMotion, maximumMotionTime: maximumRelativeTime,
        sourcePeriodEndpointNormalizedDifference: sourceEndpointDifference,
        maximumIrisCenterMotionSourceUnits: maximumIrisMotion, maximumIrisBoundsSizeChangeSourceUnits: maximumIrisShapeChange,
        sourceIrisBounds: baseline.currentIrisBounds,
        selectedWhiteReflectionComponents: [...baseline.reflectionComponents.values()],
        visibleReflectionAreaSourceUnitsSquaredRange: { minimum: Math.min(...samples.map(sample => sample.visibleReflectionWeight)), maximum: Math.max(...samples.map(sample => sample.visibleReflectionWeight)) },
        reflectionVisibilityFractionRange: { minimum: Math.min(...samples.map(sample => sample.visibleReflectionFraction)), maximum: Math.max(...samples.map(sample => sample.visibleReflectionFraction)) },
        irisVisibilityFractionRange: { minimum: Math.min(...samples.map(sample => sample.visibleIrisFraction)), maximum: Math.max(...samples.map(sample => sample.visibleIrisFraction)) },
        reflectionLayers, blockers: [...new Set(samples.flatMap(sample => [...sample.blockers.keys()]))],
        otherEyeMarks: baseline.otherMarks.map(mark => {
          const matches = samples.flatMap(sample => sample.otherMarks.filter(candidate => candidate.slot === mark.slot && candidate.attachment === mark.attachment));
          const maximumMotion = Math.max(0, ...matches.map(candidate => Math.max(...['centerX', 'centerY', 'width', 'height'].map(field => Math.abs(candidate.sourceBounds[field] - mark.sourceBounds[field])))));
          return { ...mark, independentlyAnimated: maximumMotion > 1e-6, periodSeconds: maximumMotion > 1e-6 ? eyeAnimation.duration : null,
            maximumSourceBoundsChangeUnits: maximumMotion, scope: 'Painted watery-eye tear gleam, distinct from a compact reflection inside the colored iris.' };
        }),
      };
    });
    const blinkAnimation = clips.blink ? data.findAnimation(clips.blink) : null;
    const blinkFrames = blinkAnimation ? sampleTimes(blinkAnimation).map(time => frameAt(clips, time, 'blink')) : [];
    const blink = blinkAnimation ? { clip: blinkAnimation.name, durationSeconds: blinkAnimation.duration, sampleCount: blinkFrames.length,
      eyes: labels.map((eye, index) => {
        const samples = blinkFrames.map(frame => frame.eyes[index]);
        const closed = blinkFrames.filter(frame => !frame.eyes[index].open);
        return { eye, fullyClosedObserved: closed.length > 0, sampledClosedInterval: closed.length ? { start: closed[0].time, end: closed.at(-1).time } : null,
          reflectionHiddenObserved: samples.some(sample => !sample.reflectionVisible),
          minimumReflectionVisibilityFraction: Math.min(...samples.map(sample => sample.visibleReflectionFraction)),
          maximumReflectionVisibilityFraction: Math.max(...samples.map(sample => sample.visibleReflectionFraction)),
          blockers: [...new Set(samples.flatMap(sample => [...sample.blockers.keys()]))] };
      }) } : null;
    const eyeSlotIndices = new Set([...descriptors.values()].map(descriptor => descriptor.slotIndex));
    const eyeBoneIndices = new Set();
    for (const descriptor of descriptors.values()) {
      const slotBone = data.slots[descriptor.slotIndex].boneData;
      if (slotBone) eyeBoneIndices.add(slotBone.index);
      const bones = descriptor.attachment.bones ?? [];
      for (let cursor = 0; cursor < bones.length;) {
        const count = bones[cursor++];
        for (let offset = 0; offset < count; offset++) eyeBoneIndices.add(bones[cursor++]);
      }
    }
    const lowerTrackChecks = ['body', 'mouth'].flatMap(channel => {
      const animation = data.findAnimation(clips[channel]);
      const relevant = animation.timelines.filter(timeline => eyeSlotIndices.has(timeline.slotIndex) || eyeBoneIndices.has(timeline.boneIndex));
      if (!relevant.some(timeline => timeline.getFrameCount() > 1)) return [];
      const lowerFrames = sampleTimes(animation, false).map(time => frameAt(clips, time, 'open', channel));
      return [{ channel, clip: animation.name, durationSeconds: animation.duration, sampleCount: lowerFrames.length,
        relevantTimelines: relevant.map(timeline => ({ type: timeline.constructor.name, slot: timeline.slotIndex === undefined ? null : data.slots[timeline.slotIndex].name,
          bone: timeline.boneIndex === undefined ? null : data.bones[timeline.boneIndex].name, times: Array.from(timeline.frames).filter((_, offset) => offset % timeline.getFrameEntries() === 0) })),
        eyes: labels.map((eye, index) => ({ eye, openAtAllSampledKeys: lowerFrames.every(frame => frame.eyes[index].open),
          catchlightVisibleAtAllSampledKeys: lowerFrames.every(frame => frame.eyes[index].reflectionVisible),
          minimumReflectionVisibilityFraction: Math.min(...lowerFrames.map(frame => frame.eyes[index].visibleReflectionFraction)),
          maximumReflectionVisibilityFraction: Math.max(...lowerFrames.map(frame => frame.eyes[index].visibleReflectionFraction)) })) }];
    });
    const activeClipping = initial.layers.filter(layer => layer.attachment?.constructor.name === 'ClippingAttachment').map(layer => ({ slot: layer.slot.data.name,
      attachment: layer.attachment.name, endSlot: layer.attachment.endSlot?.name ?? null, sourcePolygon: layer.points, drawOrderIndex: layer.drawOrderIndex }));
    const detachedReflectionLayers = [...descriptors.values()].filter(descriptor => descriptor.role === 'separate-catchlight'
      && !initial.layers.some(layer => layer.descriptor?.identity === descriptor.identity)).map(descriptor => ({ slot: descriptor.slot, attachment: descriptor.attachment.name,
        reason: 'detached-in-composed-source-pose' }));
    const result = { ...composition, available: true, missingClips: [], sampleCount: frames.length, durationSeconds: eyeAnimation.duration,
      eyes, blink, lowerTrackChecks, activeClipping, detachedReflectionLayers, attachmentAndOrderChanges: attachmentChanges(clips) };
    compositions.push(result);
    const signature = `${clips.body}|${clips.eye}`;
    if (!args.includes('--no-snapshots') && primary && !snapshotSignatures.has(signature)) {
      snapshotSignatures.add(signature);
      const chosen = [initial];
      if (eyes.some(eye => eye.periodSeconds)) {
        const time = eyes.reduce((best, eye) => eye.maximumNormalizedWhiteTexelMotion > best.maximumNormalizedWhiteTexelMotion ? eye : best, eyes[0]).maximumMotionTime;
        if (time > 0) chosen.push(frames.reduce((best, frame) => Math.abs(frame.time - time) < Math.abs(best.time - time) ? frame : best, frames[0]));
      }
      if (blinkFrames.length) chosen.push(blinkFrames.reduce((best, frame) => frame.eyes.reduce((sum, eye) => sum + eye.visibleIrisWeight, 0)
        < best.eyes.reduce((sum, eye) => sum + eye.visibleIrisWeight, 0) ? frame : best, blinkFrames[0]));
      const sourceBox = bounds(initial.eyes.flatMap(eye => {
        const box = eye.sourceIrisBounds ?? eye.referenceIrisBounds;
        return box ? [[box.left, box.bottom], [box.right, box.top]] : [];
      }));
      for (const frame of chosen) snapshots.push({ slug: definition.slug, id: primary.expressionId, compositionKey: composition.key,
        time: frame.time, phase: frame.phase, texture: texturePath,
        cropBounds: sourceBox ? [sourceBox.left - sourceBox.width * 0.18, sourceBox.bottom - sourceBox.width * 0.18,
          sourceBox.right + sourceBox.width * 0.18, sourceBox.top + sourceBox.width * 0.18] : null,
        layers: frame.layers.map(layer => {
          const slot = layer.slot, attachment = layer.attachment;
          return { slot: slot.data.name, slotIndex: slot.data.index, attachment: attachment?.name ?? '(none)', type: attachment?.constructor.name ?? 'EmptyAttachment',
            drawOrderIndex: layer.drawOrderIndex, vertices: layer.points.flat(), uvs: Array.from(attachment?.uvs ?? []),
            triangles: Array.from(attachment?.triangles ?? (attachment?.uvs?.length ? [0, 1, 2, 2, 3, 0] : [])),
            color: [slot.color.r * (attachment?.color?.r ?? 1), slot.color.g * (attachment?.color?.g ?? 1), slot.color.b * (attachment?.color?.b ?? 1), layer.alpha],
            blendMode: slot.data.blendMode,
            endSlot: attachment?.endSlot?.index ?? null, eyeRole: layer.descriptor?.role ?? null };
        }) });
    }
  }
  const pixels = [...descriptors.values()].map(descriptor => ({ identity: descriptor.identity, slot: descriptor.slot, slotIndex: descriptor.slotIndex,
    attachment: descriptor.attachment.name, role: descriptor.role, uvBoundsPixels: descriptor.pixels.uvBoundsPixels,
    uvMaskedAlphaTexels: descriptor.pixels.alphaTexels, whiteTexels: descriptor.pixels.white.reduce((sum, component) => sum + component.texelCount, 0),
    coloredTexels: descriptor.pixels.color.reduce((sum, component) => sum + component.texelCount, 0),
    whiteComponents: descriptor.pixels.white.map(component => ({ texelCount: component.texelCount, boundsPixels: component.atlasBoundsPixels })) }));
  for (const route of routes) {
    if (route.availability !== 'ready-spine') continue;
    const composed = compositions.find(composition => composition.key === route.sourceEyeCompositionKey);
    if (!composed?.available) throw new Error(`Ready Reader tuple has no complete source eye composition: ${route.tupleId}`);
    route.eyes = composed.eyes.map(eye => ({ eye: eye.eye, status: eye.status, eyeForm: eye.eyeForm,
      periodSeconds: eye.periodSeconds, reflectionTreatments: eye.reflectionTreatments }));
  }
  return { slug: definition.slug, name: definition.name, talkerId: definition.talkerId, avatarFacing: definition.avatarFacing ?? 1,
    spineVersion: data.version, assets: { skeleton: { path: skeletonPath, sha256: sha(skeletonPath) }, atlas: { path: atlasPath, sha256: sha(atlasPath) },
      texture: { path: texturePath, sha256: sha(texturePath), dimensions: [texture.width, texture.height] }, metadata: { path: metadataPath, sha256: sha(metadataPath) } },
    sourceExpressions, compositions, readerCompositions: routes, eyeTextureEvidence: pixels,
    sourceSlotBlendModes: data.slots.map(slot => ({ slot: slot.name, slotIndex: slot.index, blendMode: slot.blendMode })) };
}

const report = { schemaVersion: 1, authority: 'shipped-Spine-assets-and-native-expression-table', sourceExpressionTable: { path: sourcePath, sha256: sha(sourcePath) },
  runtime: { path: 'public/assets/solarschool/characters/changli/spine-player.js', sha256: sha('public/assets/solarschool/characters/changli/spine-player.js') },
  readerCompositionSource: readerPath ? { path: readerPath, sha256: readerDocument.sha256 } : null,
  method: { eyeIdentity: 'Positive native skeleton X. source-screen-left is smaller X; avatarFacing=-1 swaps rendered screen sides.',
    whiteTexels: 'Actual atlas pixels inside native UV triangles, alpha >=32; verified separate reflection/tear cutouts use RGB minimum >=180, spread <=80. Painted iris/face dots use minimum >=200, spread <=45 to separate golden iris gradients from white dots. Compact 8-connected regions are checked against the iris footprint; reviewed white eye fills/lid strokes and stars remain distinct from reflections.',
    coloredIris: 'Opaque saturated atlas texels inside the native iris footprint, tested through actual mesh triangles, slot alpha, later-layer alpha and Spine clipping.',
    occlusion: 'Forward-project alpha-selected atlas pixel probes with native barycentric UV weights, then sample later atlas layers at their authored world triangles and blend modes. Straight-alpha normal/additive/multiply/screen destination coefficients match the supplied runtime. Native triangle/UV area ratios account for a flattened closed-eye mesh having zero visible area. Empty draw-order slots correctly end clipping.',
    interpolation: 'Original Spine 4.1.56 runtime decodes supplied 4.1.23 skeletons; no hand-written interpolation or deformation.',
    openEyeSampling: `${sampleHz} Hz plus all exact authored eye key times over one period, body and mouth fixed at their authored initial pose.`,
    blinkSampling: `${sampleHz} Hz plus all authored keys over the original one-shot blink, no camera or stage movement.`,
    lowerTracks: 'Native mouth-open variants are separate compositions; eye-overlapping body/mouth timelines are checked at their exact authored keys.',
    visibilityLimit: 'Visibility fractions use up to 64 stratified probes per white component and 32 per colored component; texture component counts are exhaustive. Source raster snapshots corroborate visible appearance.' },
  characters: definitions.map(auditCharacter) };
report.summary = { characters: report.characters.length, nativeSourceExpressions: report.characters.reduce((sum, character) => sum + character.sourceExpressions.length, 0),
  uniqueNativeAndReaderCompositions: report.characters.reduce((sum, character) => sum + character.compositions.length, 0),
  availableCompositions: report.characters.reduce((sum, character) => sum + character.compositions.filter(composition => composition.available).length, 0),
  perEyeStatuses: Object.fromEntries([...new Set(report.characters.flatMap(character => character.compositions.flatMap(composition => composition.eyes.map(eye => eye.status))))]
    .map(status => [status, report.characters.reduce((sum, character) => sum + character.compositions.reduce((subtotal, composition) => subtotal + composition.eyes.filter(eye => eye.status === status).length, 0), 0)])),
  sourceSnapshots: snapshots.length, readerCompositions: report.characters.reduce((sum, character) => sum + character.readerCompositions.length, 0) };
const nativePrimary = report.characters.flatMap(character => character.sourceExpressions.map(expression => character.compositions.find(composition => composition.key === expression.primaryCompositionKey)));
const readyReader = report.characters.flatMap(character => character.readerCompositions).filter(composition => composition.availability === 'ready-spine');
report.summary.availableNativePrimaryExpressions = nativePrimary.filter(composition => composition.available).length;
report.summary.nativePrimaryEyeStatuses = Object.fromEntries([...new Set(nativePrimary.flatMap(composition => composition.eyes.map(eye => eye.status)))]
  .map(status => [status, nativePrimary.reduce((sum, composition) => sum + composition.eyes.filter(eye => eye.status === status).length, 0)]));
report.summary.readySpineReaderTuples = readyReader.length;
report.summary.visibleSpineReaderTuples = readyReader.filter(composition => composition.hasSettledVisibleOccurrence || composition.hasTimedVisibleOccurrence).length;
report.summary.readerEyeStatuses = Object.fromEntries([...new Set(readyReader.flatMap(composition => composition.eyes.map(eye => eye.status)))]
  .map(status => [status, readyReader.reduce((sum, composition) => sum + composition.eyes.filter(eye => eye.status === status).length, 0)]));
annotateKnownEyeChannels(report);
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, 'source-eyes.json'), JSON.stringify(report, null, 2) + '\n');
if (!args.includes('--no-snapshots')) writeFileSync(resolve(directory, 'source-eye-snapshots.json'), JSON.stringify({ authority: report.authority, frames: snapshots }) + '\n');
console.log(JSON.stringify({ output: resolve(directory, 'source-eyes.json'), summary: report.summary }, null, 2));
