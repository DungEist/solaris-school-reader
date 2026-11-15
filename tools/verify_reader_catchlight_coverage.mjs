/** Exhaustive source-to-render check of the actual script/Spine inventory.
 * Run: node --experimental-strip-types tools/verify_reader_catchlight_coverage.mjs
 * Generate routes.json and source-eyes.json first; no routes or assets are changed.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, readJSON, fileIdentity, models, modelBySlug, expressionFor, verifyComposition, verifyTransition } from './reader_catchlight_source_check.mjs';

const coverage = 'test-results/reader-catchlights/coverage';
const routesPath = coverage + '/routes.json', eyesPath = coverage + '/source-eyes.json';
const routes = readJSON(routesPath), eyeAudit = readJSON(eyesPath);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const countBy = (values, key) => values.reduce((counts, value) => { const name = key(value); counts[name] = (counts[name] ?? 0) + 1; return counts; }, {});
const unique = values => [...new Set(values)].sort((a, b) => typeof a === 'number' ? a - b : String(a).localeCompare(String(b)));
const clipNames = expression => ({ body: expression.body, mouth: expression.mouth, eye: expression.eye, blink: expression.blink ?? null });
const eyeCharacterBySlug = new Map(eyeAudit.characters.map(character => [character.slug, character]));
const eyeTupleById = new Map(eyeAudit.characters.flatMap(character => character.readerCompositions).map(tuple => [tuple.tupleId, tuple]));
const compositionByKey = new Map(eyeAudit.characters.flatMap(character => character.compositions).map(composition => [composition.key, composition]));
const rgbConfirmationPath = coverage + '/source-blink-occlusion-confirmation.json';
const rgbConfirmation = readJSON(rgbConfirmationPath);
for (const observation of rgbConfirmation.observations) {
  for (const field of ['sourceImage', 'without_reflectionImage', 'without_irisImage']) {
    assert.equal(fileIdentity(observation[field].path).sha256, observation[field].sha256, `RGB evidence changed: ${observation[field].path}`);
  }
}
function confirmedHiddenCatchlights(composition) {
  const proof = composition.blink?.finalRgbConfirmation;
  if (!proof) return false;
  assert.equal(proof.path, rgbConfirmationPath);
  const observed = rgbConfirmation.observations.find(row => row.compositionKey === composition.key && row.phase === 'blink' && row.time === proof.time);
  const control = rgbConfirmation.observations.find(row => row.compositionKey === composition.key && row.phase === 'open' && row.time === 0);
  assert.ok(observed && control, 'RGB closure has source blink and open positive controls.');
  assert.deepEqual(proof.eyes, observed.eyes);
  assert.deepEqual(proof.sourceImage, observed.sourceImage);
  assert.equal(observed.eyes.length, 2);
  assert.ok(control.eyes.every(eye => eye.whiteReflectionPixelsWithAtLeastOneByteContribution > 0 && eye.coloredIrisPixelsWithAtLeastOneByteContribution > 0));
  return observed.eyes.every(eye => eye.reflectionPixelVerdict === 'hidden-white-catchlight' && eye.whiteReflectionPixelsWithAtLeastOneByteContribution === 0);
}
const tuplesByWhoAndExpression = new Map();
for (const tuple of routes.tuples) {
  for (const who of tuple.sourceWhos) {
    const key = JSON.stringify([who, tuple.sourceExpressionId]);
    if (!tuplesByWhoAndExpression.has(key)) tuplesByWhoAndExpression.set(key, []);
    tuplesByWhoAndExpression.get(key).push(tuple);
  }
}

assert.equal(eyeAudit.readerCompositionSource.sha256, fileIdentity(routesPath).sha256, 'Eye audit uses this exact frozen route inventory.');
for (const identity of routes.sourceFiles) assert.equal(fileIdentity(identity.path).sha256, identity.sha256, `Route input changed: ${identity.path}`);
for (const script of routes.scripts) assert.equal(fileIdentity(script.source.path).sha256, script.source.sha256, `Script changed: ${script.scriptId}`);
for (const character of eyeAudit.characters) {
  for (const identity of Object.values(character.assets)) assert.equal(fileIdentity(identity.path).sha256, identity.sha256, `Eye audit input changed: ${identity.path}`);
}
for (const resource of routes.resources) {
  for (const field of ['skeleton', 'atlas', 'texture', 'metadata']) {
    if (resource[field]) assert.equal(fileIdentity(resource[field].path).sha256, resource[field].sha256, `Route resource changed: ${resource[field].path}`);
  }
}
const runnerVerified = new Set([
  ...routes.runnerVerification.results.flatMap(result => result.verifiedTupleIds ?? result.tupleIds ?? []),
  ...routes.timedRunnerVerification.results.map(result => result.tupleId),
]);
// The settled verifier's dense per-witness result schema retains its tuple IDs.
if (runnerVerified.size !== routes.counts.renderableCompositionTuples) {
  for (const result of routes.runnerVerification.results) {
    for (const value of result.compositions ?? result.tuples ?? []) runnerVerified.add(typeof value === 'string' ? value : value.tupleId);
  }
}
assert.equal(runnerVerified.size, routes.counts.renderableCompositionTuples, 'ScriptRunner corroborates every visible composition.');
for (const tuple of routes.tuples.filter(tuple => tuple.hasRenderableOccurrence)) assert.ok(runnerVerified.has(tuple.tupleId), `Missing visible ScriptRunner witness: ${tuple.tupleId}`);

const report = {
  schemaVersion: 1, result: 'PASS', authority: 'actual-shared-Reader-actor-versus-direct-native-source-composition',
  inputs: { routes: fileIdentity(routesPath), eyes: fileIdentity(eyesPath),
    sourceRgbConfirmation: fileIdentity(rgbConfirmationPath),
    renderer: fileIdentity('src/spine/ChangliSpineScene.ts'), utility: fileIdentity('tools/reader_catchlight_source_check.mjs'),
    checker: fileIdentity('tools/verify_reader_catchlight_coverage.mjs'),
    profiles: fileIdentity('src/spine/SchoolPortraitAssets.ts'), rover: fileIdentity('src/spine/SchoolRover.ts'),
    runtime: eyeAudit.runtime, expressionTable: eyeAudit.sourceExpressionTable },
  method: {
    inventory: 'All correlated actual-script composition tuples, in both genders and both stage/avatar profiles; visible tuples are separately corroborated by ScriptRunner.',
    geometry: 'Fresh native skeleton at each authored key time and 120 Hz sample, direct source body/mouth/eye application, actual Reader actor render with native looping and blink scheduling.',
    fields: ['every slot attachment', 'world vertices and deformations', 'UVs', 'triangles', 'slot colors', 'active bones', 'blend modes', 'clipping end slots', 'draw order'],
    repetition: 'First frame, complete eye cycle, two repeat-cycle phases, complete one-shot blink and reopen.',
    transitions: 'Unique existing-actor expression pairs from sourceTransitions, with exact source-operation/witness joins. Each pair is tested before, during and after a native blink, at zero delta and after a positive delta.',
    occlusion: 'Source UV-masked white texels, iris-relative projection, clipping and blend-aware layered opacity audit joined per eye; matching Reader geometry preserves source occlusion and attachment detachment.',
    numericTolerance: { sourceWorldVertices: .005, colors: 1e-6, uvs: 1e-7 },
  },
  counts: {}, characters: [], compositions: [], transitions: [], transitionExclusions: [],
  sourceOcclusion: { confirmedRasterCompositions: [], authoredIrisResiduals: [] },
  unresolved: { missingLiteralClips: [], missingExpressionStates: [], nativeUnavailableExpressions: [], projectedAvatarApproximations: [], occlusionReview: [] },
  staticImages: [], nonSpineIdentities: [], failures: [],
  limitations: [
    ...routes.limitations,
    'Exhaustive native composition/lifecycle replay is distinct from representative production-browser recordings.',
    'External story predicates are abstracted into structural branch candidates, with explicit developer overrides; no single-playthrough or global branch-satisfiability claim is made.',
    'Existing Rover avatar approximations are verified against their selected effective source clips; they do not establish the appearance of absent literal channels.',
    'Layered source samples and Reader recordings do not establish equivalence to a running original-game Unreal/LGUI framebuffer.',
  ],
};

for (const tuple of routes.tuples) {
  const reference = { tupleId: tuple.tupleId, resourceSlug: tuple.resourceSlug, sourceExpressionId: tuple.sourceExpressionId,
    renderedExpressionId: tuple.renderedExpressionId, composition: tuple.composition, gender: tuple.gender,
    visible: tuple.hasRenderableOccurrence, settledVisible: tuple.hasSettledVisibleOccurrence, timedVisible: tuple.hasTimedVisibleOccurrence,
    sourceWhos: tuple.sourceWhos, clips: tuple.clips };
  if (tuple.availability === 'ready-static-image') {
    report.staticImages.push({ ...reference, result: 'STATIC-SOURCE-IMAGE', sourceCatchlightTimeline: 'none', witness: tuple.firstRenderableWitness });
    continue;
  }
  if (tuple.availability !== 'ready-spine') {
    const partialEye = compositionByKey.get(eyeTupleById.get(tuple.tupleId)?.sourceEyeCompositionKey)?.partialEyeChannelAssessment;
    const entry = { ...reference, availability: tuple.availability, reason: tuple.reason, missingClips: tuple.effectiveMissingClips,
      ...(partialEye ? { partialEyeChannelAssessment: partialEye } : {}),
      sourceHiddenObservations: tuple.sourceHiddenObservationCount, nonPresentObservations: tuple.nonPresentObservationCount,
      witness: tuple.firstOccurrenceWitness };
    report.unresolved[tuple.availability === 'unavailable-clips-or-registration' ? 'missingLiteralClips' : 'missingExpressionStates'].push(entry);
    continue;
  }
  const model = modelBySlug.get(tuple.resourceSlug), eyeTuple = eyeTupleById.get(tuple.tupleId);
  try {
    assert.ok(model, 'Reader source model exists.');
    const expression = expressionFor(model, tuple.renderedExpressionId, tuple.composition);
    assert.ok(expression, 'Effective production expression exists.');
    assert.deepEqual(clipNames(expression), tuple.clips, 'Production channels match the actual route tuple.');
    assert.ok(eyeTuple, 'Both source eyes were audited.');
    assert.deepEqual(eyeTuple.clips, tuple.clips, 'Source-eye composition has the same clips.');
    assert.equal(eyeTuple.eyes.length, 2, 'Both eyes are classified.');
    const sourceEye = compositionByKey.get(eyeTuple.sourceEyeCompositionKey);
    assert.ok(sourceEye?.available, 'The complete audited source composition exists.');
    const verified = verifyComposition(model, expression, tuple.composition);
    const { attachmentSignature, ...result } = verified;
    report.compositions.push({ ...reference, ...result, attachmentSignatureSha256: digest(attachmentSignature),
      sourceEyeCompositionKey: eyeTuple.sourceEyeCompositionKey, eyes: eyeTuple.eyes,
      blink: sourceEye.blink, nativeLayeringMatched: result.passed,
      witness: tuple.firstRenderableWitness ?? tuple.firstOccurrenceWitness });
    if (!result.passed) report.failures.push({ tupleId: tuple.tupleId, issues: result.issues });
    if (tuple.avatarFallback || tuple.avatarChannelRepair) report.unresolved.projectedAvatarApproximations.push({ ...reference,
      fallback: tuple.avatarFallback, channelRepair: tuple.avatarChannelRepair, literalMissingClips: tuple.literalMissingClips });
    const rgbHidden = confirmedHiddenCatchlights(sourceEye);
    if (rgbHidden) {
      const proof = sourceEye.blink.finalRgbConfirmation;
      if (!report.sourceOcclusion.confirmedRasterCompositions.some(entry => entry.sourceEyeCompositionKey === sourceEye.key)) {
        report.sourceOcclusion.confirmedRasterCompositions.push({ sourceEyeCompositionKey: sourceEye.key, ...proof });
        for (const eye of proof.eyes.filter(eye => eye.coloredIrisPixelsWithAtLeastOneByteContribution > 0)) {
          report.sourceOcclusion.authoredIrisResiduals.push({ sourceEyeCompositionKey: sourceEye.key, time: proof.time, eye: eye.eye,
            coloredIrisPixels: eye.coloredIrisPixelsWithAtLeastOneByteContribution, whiteCatchlightPixels: eye.whiteReflectionPixelsWithAtLeastOneByteContribution,
            sourceRasterSize: proof.rasterSize, sourceImage: proof.sourceImage, rendererMatchesSource: verified.passed });
        }
      }
    }
    if (sourceEye.blink?.eyes.some(eye => !eye.fullyClosedObserved || !eye.reflectionHiddenObserved) && !rgbHidden) {
      report.unresolved.occlusionReview.push({ tupleId: tuple.tupleId, sourceEyeCompositionKey: sourceEye.key, blink: sourceEye.blink });
    }
  } catch (error) { report.failures.push({ tupleId: tuple.tupleId, message: error.stack ?? String(error) }); }
}
console.log(`Checked ${report.compositions.length} ready Spine tuples (${report.compositions.filter(tuple => tuple.visible).length} visible).`);

const pairs = new Map(), exclusions = new Map();
function exclude(reason, index, detail = {}) {
  if (!exclusions.has(reason)) exclusions.set(reason, { reason, count: 0, sourceTransitionIndexes: [], firstDetail: detail });
  const entry = exclusions.get(reason); entry.count++; entry.sourceTransitionIndexes.push(index);
}
for (const [index, transition] of routes.sourceTransitions.entries()) {
  const [, operationId, beforeId, afterId] = transition;
  const source = routes.sourceOperations[operationId], before = routes.semanticCharacters[beforeId], after = routes.semanticCharacters[afterId];
  if (source.operation.op === 'enter') { exclude('new-entry-starts-a-new-actor', index); continue; }
  if (beforeId === null || afterId === null || !before?.present || !after?.present) { exclude('no-existing-present-actor-on-both-sides', index); continue; }
  const first = tuplesByWhoAndExpression.get(JSON.stringify([before.who, before.expression ?? null])) ?? [];
  const second = tuplesByWhoAndExpression.get(JSON.stringify([after.who, after.expression ?? null])) ?? [];
  if (!first.length || !second.length) { exclude('no-registered-composition-for-semantic-state', index, { before, after, source }); continue; }
  let matched = false;
  for (const from of first) {
    for (const to of second.filter(tuple => tuple.composition === from.composition && tuple.gender === from.gender)) {
      matched = true;
      if (from.availability !== 'ready-spine' || to.availability !== 'ready-spine') {
        exclude(from.assetKind === 'static-image' && to.assetKind === 'static-image' ? 'static-source-image-has-no-Spine-track' : 'unavailable-source-composition', index,
          { fromTupleId: from.tupleId, toTupleId: to.tupleId });
        continue;
      }
      if (from.resourceSlug !== to.resourceSlug) { exclude('resource-change-replaces-the-actor', index, { from: from.tupleId, to: to.tupleId }); continue; }
      const key = JSON.stringify([from.tupleId, to.tupleId]);
      if (!pairs.has(key)) pairs.set(key, { from, to, sourceTransitionIndexes: [], firstSourceOperation: source, firstWitnessId: transition[7] });
      pairs.get(key).sourceTransitionIndexes.push(index);
    }
  }
  if (!matched) exclude('resource-or-gender-change-replaces-the-actor', index, { before, after, source });
}
for (const { from, to, ...provenance } of pairs.values()) {
  const model = modelBySlug.get(from.resourceSlug);
  try {
    const result = verifyTransition(model, expressionFor(model, from.renderedExpressionId, from.composition), expressionFor(model, to.renderedExpressionId, to.composition), from.composition);
    const entry = { resourceSlug: from.resourceSlug, composition: from.composition, gender: from.gender,
      fromTupleId: from.tupleId, toTupleId: to.tupleId, fromExpression: from.sourceExpressionId, toExpression: to.sourceExpressionId,
      bodyChanged: from.clips.body !== to.clips.body, eyeChanged: from.clips.eye !== to.clips.eye,
      blinkChanged: from.clips.blink !== to.clips.blink, visibleDestination: to.hasRenderableOccurrence, ...provenance, ...result };
    report.transitions.push(entry);
    if (!result.passed) report.failures.push({ transition: [from.tupleId, to.tupleId], issues: result.issues });
  } catch (error) { report.failures.push({ transition: [from.tupleId, to.tupleId], message: error.stack ?? String(error) }); }
}
report.transitionExclusions = [...exclusions.values()];

for (const model of models) {
  const slug = model.definition.slug, eyes = eyeCharacterBySlug.get(slug), routeResource = routes.perResourceCoverage.find(resource => resource.resourceSlug === slug);
  const allTuples = routes.tuples.filter(tuple => tuple.resourceSlug === slug), ready = report.compositions.filter(tuple => tuple.resourceSlug === slug);
  const visible = ready.filter(tuple => tuple.visible), transitions = report.transitions.filter(transition => transition.resourceSlug === slug);
  const nativePrimary = eyes.sourceExpressions.map(expression => compositionByKey.get(expression.primaryCompositionKey));
  for (const expression of eyes.sourceExpressions) {
    const primary = compositionByKey.get(expression.primaryCompositionKey);
    if (!primary.available) report.unresolved.nativeUnavailableExpressions.push({ resourceSlug: slug, expressionId: expression.id, sourceName: expression.sourceName,
      missingClips: primary.missingClips, ...(primary.partialEyeChannelAssessment ? { partialEyeChannelAssessment: primary.partialEyeChannelAssessment } : {}),
      reachedAsSourceExpression: allTuples.some(tuple => tuple.sourceExpressionId === expression.id) });
  }
  report.characters.push({ slug, name: model.definition.name, sourceRows: eyes.sourceExpressions.length,
    availableNativePrimaryRows: nativePrimary.filter(composition => composition.available).length,
    reachedSourceExpressionIds: unique(allTuples.map(tuple => tuple.sourceExpressionId).filter(id => id !== null)),
    visibleSourceExpressionIds: unique(visible.map(tuple => tuple.sourceExpressionId)),
    visibleRenderedExpressionIds: unique(visible.map(tuple => tuple.renderedExpressionId)),
    readyTuples: ready.length, readyStageTuples: ready.filter(tuple => tuple.composition === 'stage').length,
    readyAvatarTuples: ready.filter(tuple => tuple.composition === 'avatar').length,
    visibleStageTuples: routeResource.renderableStageTupleCount, visibleAvatarTuples: routeResource.renderableAvatarTupleCount,
    perEyeStatuses: countBy(ready.flatMap(tuple => tuple.eyes), eye => eye.status),
    visiblePerEyeStatuses: countBy(visible.flatMap(tuple => tuple.eyes), eye => eye.status),
    nativePrimaryEyeStatuses: countBy(nativePrimary.flatMap(composition => composition.eyes), eye => eye.status),
    transitionPairs: transitions.length, transitionSamples: transitions.reduce((total, transition) => total + transition.samples, 0),
    openSamples: ready.reduce((total, tuple) => total + tuple.openSamples, 0), blinkSamples: ready.reduce((total, tuple) => total + tuple.blinkSamples, 0),
    missingLiteralTupleCount: allTuples.filter(tuple => tuple.availability === 'unavailable-clips-or-registration').length,
    failures: ready.filter(tuple => !tuple.passed).length + transitions.filter(transition => !transition.passed).length });
}
report.nonSpineIdentities = routes.identities.filter(identity => !['spine-resource', 'shared-resource-alias'].includes(identity.sourceIdentityKind));
report.counts = { scripts: routes.counts.scripts, reachableNodes: routes.counts.structurallyReachableNodes, choiceEdges: routes.counts.structurallyReachableChoiceEdges,
  correlatedStates: routes.counts.correlatedSemanticStates, sourceRows: eyeAudit.summary.nativeSourceExpressions,
  nativeCompletePrimaryRows: eyeAudit.summary.availableNativePrimaryExpressions,
  reachedDeclaredSourceIds: routes.counts.reachableSourceExpressionCount, visibleDeclaredSourceIds: routes.counts.playableSourceExpressionCount,
  steadyVisibleDeclaredSourceIds: routes.counts.settledVisibleSourceExpressionCount,
  allCompositionTuples: routes.tuples.length, readySpineTuples: report.compositions.length, visibleSpineTuples: report.compositions.filter(tuple => tuple.visible).length,
  visibleStaticImageTuples: report.staticImages.filter(tuple => tuple.visible).length,
  visibleTuplesByComposition: routes.counts.renderableTuplesByComposition,
  runnerVerifiedSettledTuples: routes.runnerVerification.verifiedCompositionTuples, runnerVerifiedTimedOnlyTuples: routes.timedRunnerVerification.verifiedCompositionTuples,
  perEyeStatuses: countBy(report.compositions.flatMap(tuple => tuple.eyes), eye => eye.status),
  visiblePerEyeStatuses: countBy(report.compositions.filter(tuple => tuple.visible).flatMap(tuple => tuple.eyes), eye => eye.status),
  openSamples: report.compositions.reduce((total, tuple) => total + tuple.openSamples, 0),
  blinkSamples: report.compositions.reduce((total, tuple) => total + tuple.blinkSamples, 0),
  existingActorTransitionPairs: report.transitions.length,
  expressionChangingTransitionPairs: report.transitions.filter(transition => transition.fromExpression !== transition.toExpression).length,
  bodyChangingTransitionPairs: report.transitions.filter(transition => transition.bodyChanged).length,
  transitionSamples: report.transitions.reduce((total, transition) => total + transition.samples, 0),
  maximumVertexDifference: Math.max(0, ...report.compositions.map(tuple => tuple.maximumVertexDifference), ...report.transitions.map(transition => transition.maximumVertexDifference)),
  finalRgbOcclusionConfirmations: report.sourceOcclusion.confirmedRasterCompositions.length,
  authoredIrisResidualCompositions: report.sourceOcclusion.authoredIrisResiduals.length,
  unresolvedOcclusionTuples: report.unresolved.occlusionReview.length,
  failures: report.failures.length,
};
if (report.compositions.length !== eyeAudit.summary.readySpineReaderTuples) report.failures.push('Not every ready tuple was verified.');
if (report.compositions.filter(tuple => tuple.visible).length !== eyeAudit.summary.visibleSpineReaderTuples) report.failures.push('Not every visible Spine tuple was verified.');
if (report.unresolved.occlusionReview.length) report.failures.push('A source blink requires final pixel occlusion review.');
if (report.failures.length) report.result = 'FAIL';
report.counts.failures = report.failures.length;
mkdirSync(join(root, coverage), { recursive: true });
const outputPath = coverage + '/source-to-render.json';
writeFileSync(join(root, outputPath), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ result: report.result, output: outputPath, counts: report.counts,
  characters: report.characters.map(({ slug, sourceRows, readyTuples, visibleStageTuples, visibleAvatarTuples, transitionPairs, failures }) => ({ slug, sourceRows, readyTuples, visibleStageTuples, visibleAvatarTuples, transitionPairs, failures })),
  unresolved: Object.fromEntries(Object.entries(report.unresolved).map(([key, values]) => [key, values.length])),
  failures: report.failures.slice(0, 5) }, null, 2));
if (report.result !== 'PASS') process.exitCode = 1;
