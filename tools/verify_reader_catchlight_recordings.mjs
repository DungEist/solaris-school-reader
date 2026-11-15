/** Independent source replay against captured Reader geometry.
 * Run: node --experimental-strip-types tools/verify_reader_catchlight_recordings.mjs [case-directory...]
 * --skip-missing permits an explicitly incomplete interim report.
 * Uses raw source clips and the supplied native runtime, never the Reader actor.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { ChangliSpineActor } from '../src/spine/ChangliSpineScene.ts';
import { modelBySlug, profileFor, expressionFor, viewFor, spine as readerSpine } from './reader_catchlight_source_check.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const playback = join(root, 'test-results/reader-catchlights/playback');
const output = join(playback, 'source-replay-verification.json');
const captureVerificationPath = join(playback, 'capture-source-replay-verification.json');
const args = process.argv.slice(2);
const skipMissing = args.includes('--skip-missing');
const paths = args.filter(value => value !== '--skip-missing');
const casePaths = paths.length ? paths.map(path => resolve(path)) : ['abby-stage', 'verina-stage', 'abby-avatar'].map(name => join(playback, name));
const runtimePath = join(root, 'public/assets/solarschool/characters/changli/spine-player.js');
const runtimeBytes = readFileSync(runtimePath);
const spine = runInNewContext(runtimeBytes.toString('utf8') + '\nspine;', { performance, console, setTimeout, clearTimeout });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = path => ({ path: relative(root, path), sha256: hash(readFileSync(path)) });
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
const originalExpressionPath = join(root, 'WutheringWaves_Data/BinData/AvgSolarSchoolRoleAnimation/avgsolarschoolroleanimation.json');
const originalExpressions = new Map(readJSON(originalExpressionPath).map(row => [row.Id, row]));
const resourceNames = {
  Abby: { slug: 'abby', stem: 'SolarSchool_Abu', metadataFile: 'Abby.animation-metadata.json', textureFile: 'SolarSchool_Abu.png' },
  Verina: { slug: 'verina', stem: 'SolarSchool_Weilinai', metadataFile: 'verina.animation-metadata.json', textureFile: 'SolarSchool_Weilinai.webp' },
};
const coordinateTolerancePixels = .02;
// Eye time comes from the RAF update; wall time is sampled near renderer finish.
// Preserve the measured latency variation rather than forcing equality.
const clockPairToleranceSeconds = .06;

function worldVertices(skeleton, name) {
  const slot = skeleton.findSlot(name);
  const attachment = slot?.attachment;
  if (!attachment?.worldVerticesLength) throw new Error(`Source mesh ${name} is absent.`);
  const result = new Float32Array(attachment.worldVerticesLength);
  attachment.computeWorldVertices(slot, 0, result.length, result, 0, 2);
  return Array.from({ length: result.length / 2 }, (_, index) => [result[index * 2], result[index * 2 + 1]]);
}

function range(values) {
  const minimum = Math.min(...values), maximum = Math.max(...values);
  return { minimum, maximum, range: maximum - minimum };
}

function gaps(values) {
  return values.slice(1).map((value, index) => value - values[index]);
}

function gapSummary(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  return { minimum: sorted[0], median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor((sorted.length - 1) * .95)], maximum: sorted.at(-1) };
}

/** Replay today's actor without changing the historical recording or its clocks.
 * The recorded transform/camera/crop is an offline comparison coordinate frame.
 * A native six-second first delay leaves the recorded open-eye interval intact.
 */
function verifyCurrentReader(recording, resource) {
  const model = modelBySlug.get(resource.slug), target = recording.target;
  const expression = expressionFor(model, target.expression, target.composition);
  const baseProfile = profileFor(model, target.composition), first = recording.frames[0];
  const facing = first.scale[0] / first.scale[1];
  const actor = new ChangliSpineActor(readerSpine, model.data, { drawSkeleton() {} }, { random: () => 1 }, {
    ...baseProfile, horizontalFacing: facing,
    transform: () => ({ x: first.root[0] - (1 - facing) * baseProfile.calibration.anchorX * first.scale[1], y: first.root[1], scale: first.scale[1] }),
  });
  const maximumCoordinateDifferencePixels = { irisVertices: 0, catchlightVertices: 0 };
  let previousTime = 0, tracksMatch = true, recordedTransformMatches = true;
  try {
    actor.setExpression(expression);
    for (const frame of recording.frames) {
      actor.render(viewFor(model, target.composition, expression), frame.eyeTrackTime - previousTime);
      previousTime = frame.eyeTrackTime;
      tracksMatch &&= [expression.body, expression.mouth, expression.eye].every((name, trackIndex) => {
        const track = actor.animationState.getCurrent(trackIndex);
        return track?.animation.name === name && track.loop === true && track.timeScale === 1;
      }) && Math.abs(actor.animationState.getCurrent(2).trackTime - frame.eyeTrackTime) < 1e-7;
      recordedTransformMatches &&= [actor.skeleton.x, actor.skeleton.y, actor.skeleton.scaleX, actor.skeleton.scaleY]
        .every((value, index) => value === [...frame.root, ...frame.scale][index]);
      const camera = new readerSpine.OrthoCamera(...frame.canvasSize);
      camera.zoom = frame.camera.zoom; camera.position.x = frame.camera.x; camera.position.y = frame.camera.y; camera.update();
      for (const [field, slotName] of [['irisVertices', target.iris], ['catchlightVertices', target.catchlight]]) {
        const vertices = worldVertices(actor.skeleton, slotName);
        if (vertices.length !== frame[field].length) throw new Error(`Current Reader vertex count differs for ${field}.`);
        for (const [index, vertex] of vertices.entries()) {
          const point = camera.worldToScreen(new readerSpine.Vector3(...vertex, 0), ...frame.canvasSize);
          const projected = [recording.mapping.destination.x + (point.x - recording.mapping.crop.x) * recording.mapping.zoom,
            recording.mapping.destination.y + (frame.canvasSize[1] - point.y - recording.mapping.crop.y) * recording.mapping.zoom];
          for (let axis = 0; axis < 2; axis++) {
            const difference = Math.abs(projected[axis] - frame[field][index][axis]);
            if (!Number.isFinite(difference)) throw new Error('Non-finite current Reader comparison.');
            maximumCoordinateDifferencePixels[field] = Math.max(maximumCoordinateDifferencePixels[field], difference);
          }
        }
      }
    }
  } finally { actor.dispose(); }
  return { result: tracksMatch && recordedTransformMatches && Object.values(maximumCoordinateDifferencePixels).every(value => value <= coordinateTolerancePixels) ? 'PASS' : 'FAIL',
    authority: 'current-shared-Reader-actor-replayed-at-historical-capture-eye-times',
    method: 'Current production expression/profile and actor, native six-second initial blink delay, recorded fixed root/scale/camera/crop, no video changes or synthesized frames.',
    comparisonSampleCount: recording.frames.length, tracksMatch, recordedTransformMatches, maximumCoordinateDifferencePixels };
}

function verifyCase(measurementsPath) {
  const recording = readJSON(measurementsPath), target = recording.target;
  const resource = resourceNames[target.character];
  if (!resource) throw new Error(`No source resource registered for ${target.character}.`);
  if (recording.frames.length < 2) throw new Error('At least two recorded geometry samples are required.');
  const directory = join(root, 'public/assets/solarschool/characters', resource.slug);
  const skeletonPath = join(directory, resource.stem + '.skel');
  const atlasPath = join(directory, resource.stem + '.atlas');
  const metadataPath = join(directory, resource.metadataFile);
  const sourceRow = originalExpressions.get(target.expression);
  const metadataRow = readJSON(metadataPath).dataset_animation_rows.find(row => row.Id === target.expression);
  if (!sourceRow || !metadataRow) throw new Error(`Expression ${target.expression} is absent from source metadata.`);
  for (const field of ['AvgTalkerId', 'BodyAnimation', 'MouthAnimation', 'EyeAnimation', 'BlinkAnimation']) {
    if (sourceRow[field] !== metadataRow[field]) throw new Error(`Source metadata differs at ${field}.`);
  }
  const atlas = new spine.TextureAtlas(readFileSync(atlasPath, 'utf8'));
  for (const page of atlas.pages) page.texture = new spine.Texture({ width: page.width, height: page.height });
  const data = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(readFileSync(skeletonPath)));
  const clips = Object.fromEntries(['BodyAnimation', 'MouthAnimation', 'EyeAnimation'].map(field => {
    const animation = data.findAnimation(sourceRow[field]);
    if (!animation) throw new Error(`Source clip ${sourceRow[field]} is absent.`);
    return [field, animation];
  }));
  if (clips.BodyAnimation.duration !== 0 || clips.MouthAnimation.duration !== 0) throw new Error('These close-ups require a steady source body and mouth pose.');
  if (target.eye !== clips.EyeAnimation.name || target.cycle !== clips.EyeAnimation.duration) throw new Error('Recorded eye clip or period differs from its source.');

  const maximumDifference = { irisVertices: 0, catchlightVertices: 0 };
  const worstSample = { irisVertices: null, catchlightVertices: null };
  let openEyeOnly = true, timeScaleOne = true, looped = true;
  const first = recording.frames[0], last = recording.frames.at(-1);
  for (let frameIndex = 0; frameIndex < recording.frames.length; frameIndex++) {
    const frame = recording.frames[frameIndex];
    openEyeOnly &&= frame.animation === clips.EyeAnimation.name;
    timeScaleOne &&= frame.timeScale === 1;
    looped &&= frame.loop === true;
    // A fresh source skeleton for each sample eliminates Reader track state,
    // expression caches, blink scheduling and residual-deformation effects.
    const skeleton = new spine.Skeleton(data);
    if (data.skins.length) skeleton.setSkinByName(data.skins[0].name);
    for (const [field, animation] of Object.entries(clips)) {
      animation.apply(skeleton, 0, field === 'EyeAnimation' ? frame.eyeTrackTime : 0, true, [], 1, spine.MixBlend.replace, spine.MixDirection.mixIn);
    }
    [skeleton.x, skeleton.y] = frame.root;
    [skeleton.scaleX, skeleton.scaleY] = frame.scale;
    skeleton.updateWorldTransform();
    const camera = new spine.OrthoCamera(...frame.canvasSize);
    camera.zoom = frame.camera.zoom;
    camera.position.x = frame.camera.x;
    camera.position.y = frame.camera.y;
    camera.update();
    for (const [field, slotName] of [['irisVertices', target.iris], ['catchlightVertices', target.catchlight]]) {
      const sourcePoints = worldVertices(skeleton, slotName);
      if (sourcePoints.length !== frame[field].length) throw new Error(`Vertex count differs for ${field} at frame ${frameIndex}.`);
      for (let vertexIndex = 0; vertexIndex < sourcePoints.length; vertexIndex++) {
        const world = sourcePoints[vertexIndex];
        const projected = camera.worldToScreen(new spine.Vector3(world[0], world[1], 0), ...frame.canvasSize);
        const expected = [recording.mapping.destination.x + (projected.x - recording.mapping.crop.x) * recording.mapping.zoom,
          recording.mapping.destination.y + (frame.canvasSize[1] - projected.y - recording.mapping.crop.y) * recording.mapping.zoom];
        for (let axis = 0; axis < 2; axis++) {
          const difference = Math.abs(expected[axis] - frame[field][vertexIndex][axis]);
          if (!Number.isFinite(difference)) throw new Error('Non-finite projected comparison.');
          if (difference > maximumDifference[field]) {
            maximumDifference[field] = difference;
            worstSample[field] = { frameIndex, vertexIndex, axis: ['x', 'y'][axis], source: expected[axis], recording: frame[field][vertexIndex][axis] };
          }
        }
      }
    }
  }

  const wallTimes = recording.frames.map(frame => frame.timeSeconds);
  const eyeTimes = recording.frames.map(frame => frame.eyeTrackTime);
  const wallGaps = gaps(wallTimes), eyeGaps = gaps(eyeTimes);
  const wallSpan = last.timeSeconds - first.timeSeconds, eyeSpan = last.eyeTrackTime - first.eyeTrackTime;
  const offsets = recording.frames.map(frame => (frame.eyeTrackTime - first.eyeTrackTime) - (frame.timeSeconds - first.timeSeconds));
  const maximumClockPairDifference = Math.max(...offsets.map(value => Math.abs(value)));
  const monotonic = wallGaps.every(value => value > 0) && eyeGaps.every(value => value > 0);
  const geometryMatches = Object.values(maximumDifference).every(value => value <= coordinateTolerancePixels);
  const clockPairWithinTolerance = maximumClockPairDifference <= clockPairToleranceSeconds;
  const timingMatches = openEyeOnly && timeScaleOne && looped && monotonic && clockPairWithinTolerance;
  const framesHash = createHash('sha256');
  for (const frame of recording.frames) {
    if (!/^frame-\d{4}\.png$/.test(frame.file)) throw new Error('Unexpected frame filename.');
    framesHash.update(frame.file + '\0');
    framesHash.update(readFileSync(join(dirname(measurementsPath), frame.file)));
  }
  const videoPath = join(dirname(measurementsPath), 'close-up.webm');
  const currentReaderCompatibility = verifyCurrentReader(recording, resource);
  return {
    case: target.name, result: geometryMatches && timingMatches && currentReaderCompatibility.result === 'PASS' ? 'PASS' : 'FAIL', script: target.script, node: target.nid, expression: target.expression, composition: target.composition,
    source: { skeleton: identity(skeletonPath), atlas: identity(atlasPath), metadata: identity(metadataPath), texture: identity(join(directory, resource.textureFile)), spineVersion: data.version,
      clips: Object.fromEntries(Object.entries(clips).map(([field, animation]) => [field, { name: animation.name, durationSeconds: animation.duration }])) },
    recording: { measurements: identity(measurementsPath), video: identity(videoPath), frameSetSha256: framesHash.digest('hex'), frameSetHashMethod: 'SHA-256 of each filename plus NUL then PNG bytes, in measurement order', canvas: recording.recordingCanvas },
    geometry: { matchesSourceReplay: geometryMatches, maximumCoordinateDifferencePixels: maximumDifference, worstSample, comparisonSampleCount: recording.frames.length },
    currentReaderCompatibility,
    timing: { openEyeOnly, allEyeTracksLooped: looped, allEyeTrackTimeScalesOne: timeScaleOne, monotonicEyeAndWallClocks: monotonic, withinClockPairTolerance: clockPairWithinTolerance,
      wallClockRangeSeconds: [first.timeSeconds, last.timeSeconds], eyeClockRangeSeconds: [first.eyeTrackTime, last.eyeTrackTime], wallClockSpanSeconds: wallSpan, eyeClockSpanSeconds: eyeSpan,
      measuredEyeClockSecondsPerWallSecond: eyeSpan / wallSpan, relativeEyeClockMinusWallClockSeconds: range(offsets), endpointClockDifferenceSeconds: eyeSpan - wallSpan,
      nativePeriodsSpannedByEyeClock: eyeSpan / clips.EyeAnimation.duration },
    sampling: { recordedFrames: recording.frames.length, wallFrameGapsSeconds: gapSummary(wallGaps), eyeClockFrameGapsSeconds: gapSummary(eyeGaps),
      wallGapsLongerThanHalfNativePeriod: wallGaps.filter(value => value > clips.EyeAnimation.duration / 2).length,
      nativeCycleIndicesWithRecordedSamples: [...new Set(eyeTimes.map(value => Math.floor(value / clips.EyeAnimation.duration)))],
      scope: 'Every retained frame is compared at its recorded source eye time. Nonuniform frame gaps are retained; frame count alone does not establish motion or complete temporal coverage.' },
  };
}

const captureResultPath = join(playback, 'production-browser-result.json');
const captureResult = existsSync(captureResultPath) ? readJSON(captureResultPath) : null;
const readerFiles = Object.fromEntries([['renderer', 'src/spine/ChangliSpineScene.ts'], ['profiles', 'src/spine/SchoolPortraitAssets.ts'], ['html', 'dist/index.html']].map(([key, path]) => {
  const current = identity(join(root, path));
  return [key, { ...current, capturedSha256: captureResult?.hashes?.[key] ?? null, captureHashMatchesCurrentFile: captureResult?.hashes?.[key] === current.sha256 }];
}));
const productionHTML = readFileSync(join(root, 'dist/index.html'), 'utf8');
const bundles = [...productionHTML.matchAll(/<script[^>]*src="([^"]+\.js)"/g)].map(match => identity(join(root, 'dist', match[1].replace(/^\//, ''))));
const report = {
  result: 'PASS', authority: 'independent-source-replay-against-controlled-reader-recording',
  method: 'Fresh native Skeleton per recorded frame; original source body/mouth/eye clips applied directly at eyeTrackTime with loop=true; recorded root/scale and a fresh recorded OrthoCamera; source-canvas crop mapped into recording coordinates.',
  coordinateTolerancePixels, clockPairToleranceSeconds,
  runtime: { path: relative(root, runtimePath), sha256: hash(runtimeBytes) }, originalExpressionTable: identity(originalExpressionPath),
  readerFiles, productionBundles: bundles, captureReport: existsSync(captureResultPath) ? identity(captureResultPath) : null,
  historicalCaptureVerification: existsSync(captureVerificationPath) ? identity(captureVerificationPath) : null,
  limitations: ['Geometry replay checks the authored curves at the captured times; white-pixel tracking is a separate verification.',
    'Recorded eye time belongs to the RAF update; wall time is sampled near renderer finish. Measured offset variation is retained with a 60ms comparison bound.',
    'Nonuniform frame gaps limit temporal coverage, including any gaps longer than half a native period. No interpolation or extra frames are synthesized.',
    'This verifies the recorded Reader open-eye intervals, not native Unreal/LGUI framebuffer output or the original game runtime.',
    'Historical capture hashes remain separate from current file hashes. Compatibility is established by replaying the current actor, not by asserting identical builds.',
    'This replay does not independently record HTTP response bytes.'],
  cases: [], missing: [], errors: [],
};
for (const path of casePaths) {
  const measurementsPath = path.endsWith('.json') ? path : join(path, 'measurements.json');
  if (!existsSync(measurementsPath)) {
    report.missing.push(relative(root, measurementsPath));
    if (!skipMissing) report.errors.push(`Missing recording: ${relative(root, measurementsPath)}`);
    continue;
  }
  try { report.cases.push(verifyCase(measurementsPath)); }
  catch (error) { report.errors.push({ case: relative(root, measurementsPath), message: error.stack ?? String(error) }); }
}
if (report.errors.length || report.cases.some(value => value.result !== 'PASS')) report.result = 'FAIL';
else if (report.missing.length) report.result = 'PARTIAL';
if (captureResult && captureResult.passed !== true) {
  report.result = 'FAIL'; report.errors.push('The historical capture did not pass.');
}
if (existsSync(captureVerificationPath)) {
  const historical = readJSON(captureVerificationPath);
  for (const current of report.cases) {
    const captured = historical.cases.find(value => value.case === current.case);
    if (!captured) continue;
    for (const field of ['skeleton', 'atlas', 'metadata', 'texture']) {
      if (captured.source[field].sha256 !== current.source[field].sha256) report.errors.push(`${current.case}: historical ${field} changed.`);
    }
    if (JSON.stringify(captured.recording) !== JSON.stringify(current.recording)) report.errors.push(`${current.case}: historical recording identity changed.`);
  }
  if (report.errors.length) report.result = 'FAIL';
}
mkdirSync(playback, { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ result: report.result, output: relative(root, output), cases: report.cases.map(value => ({ case: value.case, result: value.result,
  frames: value.sampling.recordedFrames, maximumCoordinateDifferencePixels: value.geometry.maximumCoordinateDifferencePixels,
  currentReaderCompatibility: value.currentReaderCompatibility,
  eyeClockSecondsPerWallSecond: value.timing.measuredEyeClockSecondsPerWallSecond, clockPairOffsetSeconds: value.timing.relativeEyeClockMinusWallClockSeconds,
  maximumFrameGapSeconds: value.sampling.wallFrameGapsSeconds.maximum })), errors: report.errors, missing: report.missing }, null, 2));
if (report.result === 'FAIL') process.exitCode = 1;
