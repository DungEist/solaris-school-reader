/** Enumerate correlated Reader compositions over every structural script route.
 * Run: node --experimental-strip-types tools/enumerate_reader_catchlight_routes.mjs
 * Choices are structural candidates; their story predicates remain explicit.
 * The finite closure uses the actual stage reducer and composition resolvers.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareScript } from '../src/engine/validation.ts';
import { initialStageState, reduceStageEvent } from '../src/engine/StageState.ts';
import { StageTransitions } from '../src/engine/StageTransitions.ts';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import { applyActivityAction, evaluateCondition, initialStoryState, recordPlotKey, recordStoryChoice, resolveHiddenBranch } from '../src/engine/StoryState.ts';
import { schoolPortraits, schoolPortraitByTalker, resolveSchoolPortrait, readSchoolExpressions, composeSchoolExpression } from '../src/spine/SchoolPortraitAssets.ts';
import { changliTalkerId, resolveChangli, readChangliExpressions, composeChangliExpression } from '../src/spine/ChangliAssets.ts';
import { schoolAssetsForGender, schoolRoverCounterpart, roverDialogueAvatar, roverMaleAvatarRepairs } from '../src/spine/SchoolRover.ts';
import { schoolStaticPortraits, schoolPortraitAliases, resolveSchoolStaticPortrait } from '../src/spine/SchoolStaticPortraitAssets.ts';
import { schoolMissingPortraitData } from '../src/spine/SchoolPortraitCatalog.ts';
import { fullSpine } from '../tests/changli-fixtures.ts';
import { FakeClock } from '../tests/FakeClock.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, process.argv[2] ?? 'test-results/reader-catchlights/coverage/routes.json');
const read = path => readFileSync(resolve(root, path));
const json = path => JSON.parse(read(path).toString('utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');
const identity = path => ({ path, sha256: digest(read(path)) });
const manifest = json('public/data/manifest.json');
const scriptsIndex = json('public/data/scripts.index.json');
const visualManifest = json('public/data/assets.manifest.json');
const speakers = json('public/data/speakers.json');
const english = json('public/data/locales/en.json');
const storySource = json('public/data/maps/story-source.json');
const originalRows = new Map(json('WutheringWaves_Data/BinData/AvgSolarSchoolRoleAnimation/avgsolarschoolroleanimation.json').map(row => [row.Id, row]));
const catalog = { manifest, index: scriptsIndex, english, speakers, report: {} };
const assets = { manifest: visualManifest, mapping: null, baseUrl: '/assets/solarschool/', issues: [] };
const genderAssets = { female: schoolAssetsForGender(assets, 'female'), male: schoolAssetsForGender(assets, 'male'), any: assets };
const definitions = [{ slug: 'changli', name: 'Changli', talkerId: changliTalkerId, stem: 'SolarSchool_Changli', animationAliases: {} }, ...schoolPortraits];
const definitionsByTalker = new Map(definitions.map(definition => [definition.talkerId, definition]));
const staticByTalker = new Map(schoolStaticPortraits.map(definition => [definition.talkerId, definition]));
const missingByTalker = new Map(schoolMissingPortraitData.map(definition => [definition.talkerId, definition]));
const metadata = new Map();
const native = new Map();
const mappings = new Map();
const resourceRecords = [];

for (const definition of definitions) {
  const directory = `public/assets/solarschool/characters/${definition.slug}/`;
  const metadataPath = directory + (definition.metadataFile ?? `${definition.name}.animation-metadata.json`);
  const atlasPath = directory + definition.stem + '.atlas';
  const skeletonPath = directory + definition.stem + '.skel';
  const texturePath = directory + (definition.textureFile ?? definition.stem + '.png');
  metadata.set(definition.talkerId, json(metadataPath));
  const atlas = new fullSpine.TextureAtlas(read(atlasPath).toString('utf8'));
  for (const page of atlas.pages) page.texture = new fullSpine.Texture({ width: page.width, height: page.height });
  const data = new fullSpine.SkeletonBinary(new fullSpine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(read(skeletonPath)));
  native.set(definition.talkerId, data);
  resourceRecords.push({ resourceSlug: definition.slug, resourceTalkerId: definition.talkerId, name: definition.name, kind: 'spine',
    skeleton: identity(skeletonPath), atlas: identity(atlasPath), texture: identity(texturePath), metadata: identity(metadataPath),
    sourceExpressionIds: metadata.get(definition.talkerId).dataset_animation_rows.map(row => row.Id),
    nativeClips: data.animations.map(animation => ({ name: animation.name, durationSeconds: animation.duration })) });
}
for (const definition of definitions) {
  const counterpart = schoolRoverCounterpart(definition.talkerId);
  mappings.set(definition.talkerId, definition.talkerId === changliTalkerId
    ? readChangliExpressions(metadata.get(definition.talkerId))
    : readSchoolExpressions(metadata.get(definition.talkerId), definition, counterpart == null ? undefined : metadata.get(counterpart)));
}
for (const definition of schoolStaticPortraits) {
  const path = `public/assets/solarschool/characters/npc/${definition.textureFile}`;
  resourceRecords.push({ resourceSlug: `npc-${definition.talkerId}`, resourceTalkerId: definition.talkerId, name: definition.name,
    kind: 'static-image', image: existsSync(resolve(root, path)) ? identity(path) : { path, status: 'missing-local-file' },
    authoredSpineCatchlightTimelines: false });
}

const tuples = new Map();
const observations = [];
const sourceTransitions = [];
const states = [];
const graphTransitions = [];
const scripts = [];
const witnesses = [];
const identityRecords = new Map();
const sourceExpressionIds = new Set();
const resolutionCache = new Map();
const stateDimension = character => ({ who: character.who, expression: character.expression, present: character.present,
  hasEntered: character.entrySequence !== null, hidePortrait: character.hidePortrait, hideAvatar: character.hideAvatar, effect: character.effect });
const stateValue = stage => Object.values(stage.characters).sort((left, right) => left.who.localeCompare(right.who)).map(stateDimension);
const stageKey = stage => JSON.stringify(stateValue(stage));
const aliasClip = (name, definition) => name == null ? null : definition?.animationAliases?.[name] ?? name;
const sourceClips = (expressionId, definition) => {
  const row = originalRows.get(expressionId);
  const expression = visualManifest.expressions[String(expressionId)];
  return { body: aliasClip(expression?.body ?? row?.BodyAnimation, definition),
    mouth: aliasClip(expression?.mouth ?? row?.MouthAnimation, definition),
    eye: aliasClip(expression?.eye ?? row?.EyeAnimation, definition),
    blink: aliasClip(row?.BlinkAnimation || null, definition) };
};
const missingClips = (clips, data) => Object.entries(clips).flatMap(([channel, clip]) => clip && !data?.findAnimation(clip) ? [{ channel, clip }] : []);

function compositionFor(character, composition, gender) {
  const cacheKey = [character.who, character.expression, composition, gender].join('|');
  if (resolutionCache.has(cacheKey)) return resolutionCache.get(cacheKey);
  const selectedAssets = genderAssets[gender];
  const sourceExpression = visualManifest.expressions[String(character.expression)];
  const projected = composition === 'avatar' ? roverDialogueAvatar(character, selectedAssets) : { character, fallback: null };
  const selectedExpression = selectedAssets.manifest.expressions[String(projected.character.expression)];
  const talkerId = selectedExpression?.talkerId ?? speakers[character.who]?.talkerId ?? null;
  const definition = definitionsByTalker.get(talkerId);
  const data = native.get(talkerId);
  const literal = sourceClips(character.expression, definition);
  let clips = sourceClips(projected.character.expression, definition);
  let availability = 'unbound-identity';
  let reason = null;
  let resourceSlug = definition?.slug ?? (staticByTalker.has(talkerId) ? `npc-${talkerId}` : null);
  let assetKind = definition ? 'spine' : staticByTalker.has(talkerId) ? 'static-image' : 'unbound';
  let repair = null;
  if (definition) {
    const resolved = talkerId === changliTalkerId ? resolveChangli(projected.character, selectedAssets)
      : resolveSchoolPortrait(projected.character, selectedAssets, definition, composition);
    if (resolved.kind === 'changli' || resolved.kind === 'spine') {
      try {
        let mapping = mappings.get(talkerId);
        if (composition === 'avatar' && talkerId === 850001) mapping = new Map([...mapping, ...roverMaleAvatarRepairs]);
        const composed = talkerId === changliTalkerId ? composeChangliExpression(resolved.expression, mapping)
          : composeSchoolExpression(resolved.expression, mapping, definition);
        clips = { body: composed.body, mouth: composed.mouth, eye: composed.eye, blink: composed.blink };
        if (composition === 'avatar' && character.who === '750088' && talkerId === 850001 && roverMaleAvatarRepairs.has(projected.character.expression)) {
          repair = { expressionId: projected.character.expression, reason: 'Explicit Reader male avatar channel approximation for absent literal source clips.' };
        }
        const missing = missingClips(clips, data);
        availability = missing.length ? 'unavailable-clips' : 'ready-spine';
        if (missing.length) reason = `Effective composition references absent clips: ${missing.map(item => item.clip).join(', ')}.`;
      } catch (error) { availability = 'unavailable-composition'; reason = error.message; }
    } else {
      availability = character.expression == null ? 'unavailable-expression' : resolved.kind === 'fallback' ? 'unavailable-clips-or-registration' : 'unavailable-expression';
      reason = resolved.reason ?? 'The actual Reader resolver does not bind this expression to a registered skeleton.';
    }
  } else {
    const resolved = resolveSchoolStaticPortrait(projected.character, selectedAssets, catalog);
    if (resolved.kind === 'texture') {
      const path = `public/assets/solarschool/characters/npc/${resolved.definition.textureFile}`;
      availability = existsSync(resolve(root, path)) ? 'ready-static-image' : 'missing-local-image';
      resourceSlug = `npc-${resolved.definition.talkerId}`;
      assetKind = 'static-image';
      clips = { body: null, mouth: null, eye: null, blink: null };
      if (availability !== 'ready-static-image') reason = `Local source portrait image ${path} is missing.`;
    } else if (resolved.kind === 'fallback') {
      availability = missingByTalker.has(talkerId) ? 'missing-source-resource' : 'unavailable-expression';
      reason = resolved.reason;
    } else if (schoolPortraitAliases.has(talkerId)) {
      availability = 'source-alias-without-usable-expression';
      reason = 'The source speaker links a shared resource, but the Reader does not invent an expression or portrait.';
    } else {
      availability = talkerId == null ? 'text-only-or-unbound' : 'unregistered-source-resource';
      reason = talkerId == null ? 'No explicit source talker resource is linked to this identity.' : 'No registered source portrait resource can render this identity.';
    }
  }
  const record = { resourceSlug, resourceTalkerId: talkerId, sourceTalkerId: sourceExpression?.talkerId ?? speakers[character.who]?.talkerId ?? null,
    resourceName: definition?.name ?? staticByTalker.get(talkerId)?.name ?? missingByTalker.get(talkerId)?.name ?? schoolPortraitAliases.get(talkerId)?.name ?? null,
    assetKind, composition, gender, sourceExpressionId: character.expression, renderedExpressionId: projected.character.expression,
    sourceExpressionKind: character.expression == null ? 'unspecified' : originalRows.has(character.expression) ? 'declared-source-expression' : 'literal-value-without-source-expression-row',
    renderedExpressionKind: projected.character.expression == null ? 'unspecified' : originalRows.has(projected.character.expression) ? 'declared-source-expression' : 'literal-value-without-source-expression-row',
    sourceExpressionName: originalRows.get(character.expression)?.AnimationName ?? null,
    renderedExpressionName: originalRows.get(projected.character.expression)?.AnimationName ?? null,
    clips, literalSourceClips: literal, literalMissingClips: definition ? missingClips(literal, data) : [],
    effectiveMissingClips: definition ? missingClips(clips, data) : [], avatarFallback: projected.fallback, avatarChannelRepair: repair,
    availability, reason };
  record.tupleKey = [resourceSlug ?? `unbound-${talkerId ?? character.who}`, composition, gender, character.expression ?? 'none', projected.character.expression ?? 'none',
    clips.body ?? '-', clips.mouth ?? '-', clips.eye ?? '-', clips.blink ?? '-', availability].join('|');
  record.tupleId = 'tuple-' + digest(record.tupleKey).slice(0, 16);
  resolutionCache.set(cacheKey, record);
  return record;
}

function witnessOf(entry, context, selectedEdge) {
  const path = entry.choicePath.concat(selectedEdge?.optionIndex === undefined ? [] : [{ edgeId: selectedEdge.id,
    flowActionIndex: selectedEdge.flowActionIndex, nid: selectedEdge.nid, optionIndex: selectedEdge.optionIndex, optionId: selectedEdge.optionId }]);
  return { witnessId: selectedEdge ? `${entry.id}/${selectedEdge.id}` : entry.id, scriptId: entry.scriptId,
    target: { flowActionIndex: context.flowActionIndex, nid: context.nid, phase: context.phase, sourceOrder: context.sourceOrder ?? null },
    choiceRoute: path.map(choice => choice.optionIndex), choices: path, conditionalFeasibility: 'structural-candidate; conditions and hidden-choice precedence must be satisfied for normal playback' };
}

function noteIdentity(who, context, character, spoken) {
  if (!who) return;
  let record = identityRecords.get(who);
  if (!record) {
    const speaker = speakers[who];
    const talkerId = speaker?.talkerId ?? null;
    record = { who, speakerTalkerId: talkerId, name: english[speaker?.nameKey] ?? speaker?.nameZh ?? null,
      linkedResourceName: definitionsByTalker.get(talkerId)?.name ?? staticByTalker.get(talkerId)?.name ?? missingByTalker.get(talkerId)?.name ?? schoolPortraitAliases.get(talkerId)?.name ?? null,
      sourceIdentityKind: definitionsByTalker.has(talkerId) ? 'spine-resource' : staticByTalker.has(talkerId) ? 'static-image' : missingByTalker.has(talkerId) ? 'missing-source-resource' : schoolPortraitAliases.has(talkerId) ? 'shared-resource-alias' : 'text-only-or-unbound',
      sourceExpressionIds: new Set(), scripts: new Set(), spokenOccurrences: 0, stageOccurrences: 0, unboundSpeakerOccurrences: 0, firstOccurrence: context };
    identityRecords.set(who, record);
  }
  record.scripts.add(context.scriptId);
  if (character?.expression != null) record.sourceExpressionIds.add(character.expression);
  if (spoken) record.spokenOccurrences++;
  if (character) record.stageOccurrences++;
  if (spoken && !character) record.unboundSpeakerOccurrences++;
}

function observe(stage, node, entry, context, options = {}) {
  const dialogue = node.kind !== 'silent' && node.textKey ? node : null;
  const speaker = dialogue?.speakerId ?? null;
  if (options.allCharacters !== false) noteIdentity(speaker, { scriptId: entry.scriptId, ...context }, stage.characters[speaker], true);
  const projected = options.presentation ? new Map(options.presentation.characters.map(view => [view.character.who, view])) : null;
  const characters = options.who ? [stage.characters[options.who]].filter(Boolean) : Object.values(stage.characters);
  for (const character of characters) {
    noteIdentity(character.who, { scriptId: entry.scriptId, ...context }, character, false);
    if (character.expression != null) sourceExpressionIds.add(character.expression);
    const source = visualManifest.expressions[String(character.expression)];
    const genders = schoolRoverCounterpart(source?.talkerId ?? -1) == null ? ['any'] : ['female', 'male'];
    for (const composition of ['stage', 'avatar']) for (const gender of genders) {
      const resolution = compositionFor(character, composition, gender);
      let tuple = tuples.get(resolution.tupleKey);
      if (!tuple) {
        tuple = { ...resolution, observationCounts: {}, hasRenderableOccurrence: false, hasSettledVisibleOccurrence: false,
          hasTimedVisibleOccurrence: false, firstOccurrenceWitness: null, firstRenderableWitness: null, firstSettledVisibleWitness: null,
          sourceHiddenObservationCount: 0, nonPresentObservationCount: 0, nonSpeakerObservationCount: 0,
          publishedObservationCount: 0, publishedSourceHiddenObservationCount: 0,
          sourceWhos: new Set(), scriptIds: new Set() };
        tuples.set(resolution.tupleKey, tuple);
      }
      const view = projected?.get(character.who);
      const targetVisible = composition === 'stage' ? character.portraitVisible : character.avatarVisible;
      const opacity = composition === 'stage' ? view?.portraitOpacity : view?.avatarOpacity;
      const sourceHidden = composition === 'stage' ? character.hidePortrait : character.hideAvatar;
      const speakerEligible = composition === 'stage' || speaker === character.who && dialogue?.kind !== 'narration' && dialogue?.kind !== 'centerText';
      const residual = typeof opacity === 'number' && opacity > 0 && !targetVisible;
      const visibility = !speakerEligible ? 'not-current-dialogue-avatar' : residual ? 'timed-fade-out'
        : !character.present ? 'not-present' : sourceHidden ? 'source-hidden' : typeof opacity === 'number' && opacity <= 0 ? 'fade-in-start' : 'source-visible';
      const published = options.published === true;
      const visuallyEligible = speakerEligible && (targetVisible || residual) && (opacity === undefined || opacity > 0);
      const available = resolution.availability === 'ready-spine' || resolution.availability === 'ready-static-image';
      const renderable = published && visuallyEligible && available;
      const witness = witnessOf(entry, context, options.edge);
      const observation = { id: `observation-${observations.length}`, tupleId: resolution.tupleId, stateId: entry.id,
        scriptId: entry.scriptId, flowActionIndex: context.flowActionIndex, nid: context.nid, phase: context.phase,
        sourceOrder: context.sourceOrder ?? null, sourceArray: context.sourceArray ?? null, sourceTimeSeconds: context.sourceTimeSeconds ?? null,
        sample: options.sample ?? 'settled-node', publishedReaderInterval: published, renderable,
        visibility, speakerEligible, speakerId: speaker, nodeKind: node.kind, who: character.who,
        present: character.present, hidePortrait: character.hidePortrait, hideAvatar: character.hideAvatar,
        portraitVisible: character.portraitVisible, avatarVisible: character.avatarVisible,
        opacity: opacity ?? (targetVisible ? 1 : 0), sourcePosition: [...character.position], sourceEffect: character.effect,
        sourceEntry: entry.origins[character.who] ?? null,
        lastSourceOperation: { ...character.lastEvent.operation, raw: undefined },
        lastOperationContext: { scriptId: character.lastEvent.scriptId, flowActionIndex: character.lastEvent.flowActionIndex, nid: character.lastEvent.nid, phase: character.lastEvent.phase,
          sourceOrder: character.lastEvent.timing?.sourceOrder ?? null, source: character.lastEvent.source,
          optionIndex: character.lastEvent.optionIndex ?? null },
        witnessId: witness.witnessId };
      observations.push(observation);
      tuple.sourceWhos.add(character.who); tuple.scriptIds.add(entry.scriptId);
      tuple.observationCounts[visibility] = (tuple.observationCounts[visibility] ?? 0) + 1;
      if (sourceHidden) tuple.sourceHiddenObservationCount++;
      if (!character.present) tuple.nonPresentObservationCount++;
      if (!speakerEligible) tuple.nonSpeakerObservationCount++;
      if (published) tuple.publishedObservationCount++;
      if (published && sourceHidden) tuple.publishedSourceHiddenObservationCount++;
      tuple.firstOccurrenceWitness ??= witness;
      if (renderable) {
        tuple.hasRenderableOccurrence = true;
        tuple.firstRenderableWitness ??= witness;
        if (options.sample === 'settled-node') { tuple.hasSettledVisibleOccurrence = true; tuple.firstSettledVisibleWitness ??= witness; }
        else tuple.hasTimedVisibleOccurrence = true;
      }
    }
  }
}

function applyOperation(stage, operation, context, entry, sourceOrder, story, origins, transitions, dueSeconds) {
  const event = { type: 'stage', runId: stage.runId, sequence: stage.lastSequence + 1, scriptId: entry.scriptId,
    flowActionIndex: context.flowActionIndex, nid: context.nid, phase: context.phase, source: context.phase === 'option' ? 'option' : 'node',
    visitId: entry.depth + 1, optionIndex: context.optionIndex, operation, disposition: 'state',
    timing: { sourceOrder, phaseStartedAtMs: 0, dueAtMs: dueSeconds * 1000, appliedAtMs: dueSeconds * 1000, delivery: 'scheduled' } };
  const previous = stage;
  // Diagnostic history and serials are not graph dimensions. The reducer still
  // receives a strictly fresh, ordered event and keeps actual presence/flags.
  stage = reduceStageEvent({ ...stage, issues: [] }, event);
  if (transitions) transitions.apply(previous, stage, event, false, dueSeconds * 1000);
  if (operation.op === 'enter' && typeof operation.who === 'string') origins[operation.who] = {
    scriptId: entry.scriptId, flowActionIndex: context.flowActionIndex, nid: context.nid, phase: context.phase,
    sourceOrder, sourceArray: context.sourceArray, optionIndex: context.optionIndex ?? null, operation: { ...operation, raw: undefined } };
  if (operation.op === 'activityAction' && operation.kind === 'SolarSchool' && typeof operation.actionId === 'number') {
    story = applyActivityAction(story, operation.actionId, storySource, `route:${entry.id}:${context.phase}:${context.optionIndex ?? '-'}:${sourceOrder}`).state;
  }
  return { previous, stage, story };
}

function phaseOperations(operations, phase) {
  return operations.map((operation, sourceOrder) => ({ operation, sourceOrder })).filter(({ operation }) =>
    (operation.phase ?? (phase === 'option' ? 'option' : 'start')) === phase)
    .sort((left, right) => Math.max(0, left.operation.t) - Math.max(0, right.operation.t) || left.sourceOrder - right.sourceOrder);
}

function runPhase(stage, story, node, entry, phase, operations, origins, edge) {
  const ordered = phaseOperations(operations, phase);
  const transitions = new StageTransitions();
  const context = { flowActionIndex: entry.flowActionIndex, nid: node.nid, phase, sourceArray: phase === 'option' ? 'option.performances' : 'node.stage', optionIndex: edge?.optionIndex };
  const readable = !!(node.kind !== 'silent' && node.textKey || node.options?.length);
  const groups = new Map([[0, []]]);
  for (const record of ordered) {
    const time = Math.max(0, record.operation.t);
    if (!groups.has(time)) groups.set(time, []);
    groups.get(time).push(record);
  }
  const times = [...groups.keys()].sort((left, right) => left - right);
  for (let groupIndex = 0; groupIndex < times.length; groupIndex++) {
    const time = times[groupIndex];
    for (const { operation, sourceOrder } of groups.get(time)) {
      const applied = applyOperation(stage, operation, context, entry, sourceOrder, story, origins, transitions, time);
      const previous = applied.previous;
      stage = applied.stage; story = applied.story;
      if (typeof operation.who === 'string' && stage.characters[operation.who]) {
        const before = previous.characters[operation.who], after = stage.characters[operation.who];
        const sourceTransition = { id: `source-transition-${sourceTransitions.length}`, stateId: entry.id,
          scriptId: entry.scriptId, flowActionIndex: entry.flowActionIndex, nid: node.nid, phase,
          optionIndex: edge?.optionIndex ?? null, optionId: edge?.optionId ?? null,
          sourceOrder, sourceArray: context.sourceArray, sourceTimeSeconds: time,
          operation: { ...operation, raw: undefined }, before: before ? stateDimension(before) : null, after: stateDimension(after),
          expressionChanged: before?.expression !== after.expression,
          sourcePositionBefore: before?.position ?? null, sourcePositionAfter: after.position,
          fadeInSeconds: operation.fadeIn ?? null, fadeOutSeconds: operation.fadeOut ?? null,
          sourceEntry: origins[operation.who] ?? null, witness: witnessOf(entry, { ...context, sourceOrder }, edge),
          issues: stage.issues.map(issue => ({ code: issue.code, message: issue.message })) };
        sourceTransitions.push(sourceTransition);
        observe(stage, node, { ...entry, origins }, { ...context, sourceOrder, sourceTimeSeconds: time },
          { who: operation.who, edge, allCharacters: false, sample: 'after-source-operation; same-time batches may not publish this state', published: false });
      }
    }
    const nextTime = times[groupIndex + 1];
    const pending = nextTime !== undefined;
    // Start batches publish with their current dialogue. Departure batches
    // publish only while a later authored operation keeps navigation pending.
    const published = phase === 'start' ? readable || pending : pending;
    // The settled-node record covers the final start batch. Keep scheduled
    // records for genuinely intermediate intervals and departures only.
    if (published && (phase !== 'start' || pending)) observe(stage, node, { ...entry, origins }, { ...context, sourceTimeSeconds: time },
      { edge, presentation: transitions.project(stage, time * 1000), sample: `scheduled-${phase}-batch`, published: true });
    const presentation = transitions.project(stage, time * 1000);
    const opacityTracks = presentation.transitions.filter(track => track.property === 'portrait' || track.property === 'avatar');
    for (const track of opacityTracks) {
      const limit = nextTime === undefined ? phase === 'start' && readable ? Infinity : 0 : (nextTime - time) * 1000;
      const remainder = track.durationMs * (1 - track.progress);
      const offset = Math.min(remainder / 2, limit / 2);
      if (!(offset > 0)) continue;
      observe(stage, node, { ...entry, origins }, { ...context, sourceTimeSeconds: time + offset / 1000 },
        { who: track.target, edge, allCharacters: false, presentation: transitions.project(stage, time * 1000 + offset), sample: `timed-${phase}-opacity-interval`, published: true });
    }
  }
  return { stage, story, origins };
}

function graphOf(prepared) {
  const graph = new Map();
  const key = (flow, nid) => `${flow}:${nid}`;
  const after = flow => {
    for (let index = flow + 1; index < prepared.script.flowActions.length; index++) {
      const block = prepared.blocks.get(index);
      if (block?.firstNid != null) return key(index, block.firstNid);
    }
    return 'completed';
  };
  for (const block of prepared.blocks.values()) for (const node of block.nodes.values()) {
    const source = key(block.flowActionIndex, node.nid);
    const destination = next => {
      if (next.type === 'end') return after(block.flowActionIndex);
      const nid = next.type === 'jump' && block.nodes.has(next.to) ? next.to : block.successors.get(node.nid);
      return nid == null ? after(block.flowActionIndex) : key(block.flowActionIndex, nid);
    };
    const hidden = node.raw?.OptionInteractionType === 'HideAndAutoSelect' && !!node.options?.length;
    const edges = (node.options?.length ? node.options : [null]).map((option, optionIndex) => ({
      id: `${prepared.script.id}:${source}:${option ? optionIndex : 'next'}`, from: source,
      to: destination(option?.next ?? node.next), flowActionIndex: block.flowActionIndex, nid: node.nid,
      navigation: option?.next ?? node.next,
      ...(option ? { optionIndex, optionId: option.optionId, preCondition: option.preCondition ?? null,
        conditionProvided: option.preCondition !== undefined,
        conditionOnUnknownStandaloneBaseline: evaluateCondition(option.preCondition, initialStoryState(), storySource),
        hiddenChoice: hidden, earlierCandidatesMustBeFalse: hidden ? Array.from({ length: optionIndex }, (_, index) => index) : [],
        performances: option.performances ?? [], metadataActions: option.actions ?? [] } : {}),
    }));
    graph.set(source, { node, flowActionIndex: block.flowActionIndex, edges, hidden });
  }
  const head = after(-1), reachable = new Set([head]), queue = [head];
  for (let cursor = 0; cursor < queue.length; cursor++) for (const edge of graph.get(queue[cursor])?.edges ?? []) {
    if (!reachable.has(edge.to)) { reachable.add(edge.to); queue.push(edge.to); }
  }
  return { graph, head, reachable };
}

function configureBetween(stage, prepared, fromFlow, toFlow) {
  for (let index = fromFlow + 1; index < toFlow; index++) {
    const action = prepared.script.flowActions[index];
    if (action.op !== 'configure' || action.config.initialBackground == null) continue;
    stage = reduceStageEvent({ ...stage, issues: [] }, { type: 'stage', runId: stage.runId, sequence: stage.lastSequence + 1,
      scriptId: prepared.script.id, flowActionIndex: index, nid: null, source: 'configure', phase: 'start', visitId: null,
      operation: { op: 'bg', id: action.config.initialBackground, mode: 'Load', t: 0 }, disposition: 'state' });
  }
  return stage;
}

for (const indexed of scriptsIndex) {
  const path = `public/data/scripts/${indexed.id}.json`;
  const prepared = prepareScript(json(path), manifest);
  assert.equal(prepared.diagnostics.length, 0, `Invalid source graph ${indexed.id}`);
  const { graph, head, reachable } = graphOf(prepared);
  const scriptRecord = { scriptId: indexed.id, stateKey: indexed.stateKey, group: indexed.group, source: identity(path), head,
    graphNodes: [...graph].map(([key, value]) => ({ key, flowActionIndex: value.flowActionIndex, nid: value.node.nid, kind: value.node.kind,
      speakerId: value.node.speakerId, textKey: value.node.textKey, reachable: reachable.has(key), hiddenChoice: value.hidden, edges: value.edges })),
    configurations: prepared.script.flowActions.flatMap((action, flowActionIndex) => action.op === 'configure' ? [{ flowActionIndex, config: action.config }] : []),
    stateIds: [], structuralNodeCount: [...reachable].filter(key => key !== 'completed').length,
    structuralChoiceEdgeCount: [...graph].filter(([key]) => reachable.has(key)).reduce((count, [, value]) => count + value.edges.filter(edge => edge.optionIndex !== undefined).length, 0) };
  scripts.push(scriptRecord);
  if (head === 'completed') continue;
  const pending = [], seen = new Map(), seenNodes = new Set(), seenChoiceEdges = new Set();
  function enqueue(nodeKey, stage, story, origins, previousEntry, viaEdge) {
    const compound = `${nodeKey}/${stageKey(stage)}`;
    let entry = seen.get(compound);
    if (!entry) {
      const { flowActionIndex } = graph.get(nodeKey);
      const choicePath = (previousEntry?.choicePath ?? []).concat(viaEdge?.optionIndex === undefined ? [] : [{ edgeId: viaEdge.id,
        flowActionIndex: viaEdge.flowActionIndex, nid: viaEdge.nid, optionIndex: viaEdge.optionIndex, optionId: viaEdge.optionId }]);
      entry = { id: `${indexed.id}.state-${seen.size}`, scriptId: indexed.id, nodeKey, flowActionIndex, stage, story, origins: { ...origins },
        depth: (previousEntry?.depth ?? -1) + 1, choicePath, parentStateId: previousEntry?.id ?? null, viaEdgeId: viaEdge?.id ?? null };
      seen.set(compound, entry); pending.push(entry);
      scriptRecord.stateIds.push(entry.id);
      witnesses.push({ witnessId: entry.id, scriptId: indexed.id, nodeKey, parentStateId: entry.parentStateId, viaEdgeId: entry.viaEdgeId,
        nodeCountBeforeTarget: entry.depth, choiceRoute: choicePath.map(choice => choice.optionIndex), choices: choicePath });
    }
    return entry;
  }
  const headFlow = graph.get(head).flowActionIndex;
  enqueue(head, configureBetween(initialStageState(), prepared, -1, headFlow), initialStoryState(), {}, null, null);
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const entry = pending[cursor], value = graph.get(entry.nodeKey), node = value.node;
    seenNodes.add(entry.nodeKey);
    const storyAtNode = recordPlotKey(entry.story, indexed.id, node.raw?.PlotKeyId);
    const started = runPhase(entry.stage, storyAtNode, node, entry, 'start', node.stage, { ...entry.origins });
    const startContext = { flowActionIndex: entry.flowActionIndex, nid: node.nid, phase: 'start', sourceArray: 'node.stage' };
    observe(started.stage, node, { ...entry, origins: started.origins }, startContext,
      { sample: 'settled-node', published: !!(node.kind !== 'silent' && node.textKey || node.options?.length) });
    const stateRecord = { stateId: entry.id, scriptId: indexed.id, nodeKey: entry.nodeKey, witnessId: entry.id,
      beforeStart: stateValue(entry.stage), afterStart: stateValue(started.stage), outgoingTransitions: [] };
    states.push(stateRecord);
    for (const edge of value.edges) {
      if (edge.optionIndex !== undefined) seenChoiceEdges.add(edge.id);
      let branch = { stage: started.stage, story: started.story, origins: { ...started.origins } };
      let condition = null, hiddenResolution = null;
      if (edge.optionIndex !== undefined) {
        const option = node.options[edge.optionIndex];
        condition = evaluateCondition(option.preCondition, branch.story, storySource);
        if (value.hidden) hiddenResolution = resolveHiddenBranch(node.options, branch.story, storySource);
        branch.story = recordStoryChoice(branch.story, indexed.id, option.optionId);
        if (option.performances?.length) branch = runPhase(branch.stage, branch.story, node, entry, 'option', option.performances, branch.origins, edge);
      }
      branch = runPhase(branch.stage, branch.story, node, entry, 'end', node.stage, branch.origins, edge);
      let target = null;
      if (edge.to !== 'completed') {
        const targetFlow = graph.get(edge.to).flowActionIndex;
        if (targetFlow !== entry.flowActionIndex) branch.stage = configureBetween(branch.stage, prepared, entry.flowActionIndex, targetFlow);
        target = enqueue(edge.to, branch.stage, branch.story, branch.origins, entry, edge);
      }
      const transition = { id: `${entry.id}/${edge.id}`, fromStateId: entry.id, toStateId: target?.id ?? null, edgeId: edge.id,
        sourceNodeKey: entry.nodeKey, targetNodeKey: edge.to, scriptId: indexed.id, optionIndex: edge.optionIndex ?? null,
        optionId: edge.optionId ?? null, selectedConditionOnRepresentativeWitness: condition,
        hiddenResolutionOnRepresentativeWitness: hiddenResolution,
        standaloneNormalSelectionEligible: edge.optionIndex === undefined ? true : value.hidden ? hiddenResolution.optionIndex === edge.optionIndex : condition.value === 'true',
        conditionalFeasibilityScope: 'Only this representative witness from an unknown standalone story baseline; all structural candidates remain in the graph.',
        witness: witnessOf(entry, startContext, edge) };
      graphTransitions.push(transition); stateRecord.outgoingTransitions.push(transition.id);
    }
  }
  const expectedNodes = new Set([...reachable].filter(key => key !== 'completed'));
  const expectedChoices = new Set([...graph].filter(([key]) => reachable.has(key)).flatMap(([, value]) => value.edges.filter(edge => edge.optionIndex !== undefined).map(edge => edge.id)));
  assert.deepEqual(seenNodes, expectedNodes, `Semantic closure lost structural nodes in script ${indexed.id}`);
  assert.deepEqual(seenChoiceEdges, expectedChoices, `Semantic closure lost choice edges in script ${indexed.id}`);
  scriptRecord.semanticStateCount = seen.size;
  scriptRecord.coverageValidated = true;
}

const tupleList = [...tuples.values()].map(tuple => ({ ...tuple, sourceWhos: [...tuple.sourceWhos].sort(), scriptIds: [...tuple.scriptIds].sort() }));
const identityList = [...identityRecords.values()].map(record => ({ ...record, sourceExpressionIds: [...record.sourceExpressionIds].sort((left, right) => left - right), scripts: [...record.scripts].sort() }));
const eligibleTuples = tupleList.filter(tuple => tuple.hasRenderableOccurrence);

// Independent execution corroborates the representative settled witnesses.
// This uses the real runner lifecycle, not the enumerator's graph dispatch.
const stateById = new Map(states.map(state => [state.stateId, state]));
const verificationGroups = new Map();
for (const tuple of tupleList.filter(tuple => tuple.hasSettledVisibleOccurrence)) {
  const witness = tuple.firstSettledVisibleWitness;
  if (!verificationGroups.has(witness.witnessId)) verificationGroups.set(witness.witnessId, { witness, tuples: [] });
  verificationGroups.get(witness.witnessId).tuples.push(tuple);
}
const runnerVerification = { authority: 'independent-actual-ScriptRunner-replay',
  scope: 'Representative settled visible tuples, with full correlated stage-state comparison. Unknown standalone story baseline and explicit developer choice overrides; instant transitions only affect presentation timing.',
  verifiedWitnesses: 0, verifiedCompositionTuples: 0, results: [] };
const roverStageExceptions = [];
for (const { witness, tuples: group } of verificationGroups.values()) {
  const runner = new ScriptRunner({ instantTransitions: true });
  assert.equal(runner.load(json(`public/data/scripts/${witness.scriptId}.json`), manifest), true);
  runner.start();
  let reached = null;
  for (let step = 0; step < 10_000; step++) {
    const snapshot = runner.getSnapshot();
    const history = snapshot.choiceHistory;
    assert.ok(history.length <= witness.choices.length, `Unexpected extra choice on witness ${witness.witnessId}`);
    for (let index = 0; index < history.length; index++) {
      const expected = witness.choices[index], actual = history[index];
      assert.equal(`${actual.flowActionIndex}:${actual.nid}:${actual.optionIndex}`, `${expected.flowActionIndex}:${expected.nid}:${expected.optionIndex}`, `Choice witness mismatch ${witness.witnessId}`);
    }
    if (snapshot.flowActionIndex === witness.target.flowActionIndex && snapshot.nid === witness.target.nid && history.length === witness.choices.length
      && ['dialogue', 'choices', 'quiz'].includes(snapshot.status)) { reached = snapshot; break; }
    if (snapshot.status === 'choices') {
      const choice = witness.choices[history.length];
      assert.ok(choice, `Missing choice on witness ${witness.witnessId}`);
      assert.equal(`${snapshot.flowActionIndex}:${snapshot.nid}`, `${choice.flowActionIndex}:${choice.nid}`, `Choice node mismatch ${witness.witnessId}`);
      assert.equal(runner.overrideChoice(choice.optionIndex), true);
    } else if (snapshot.status === 'quiz') {
      assert.equal(runner.answerQuiz(snapshot.quiz.definition.answers[0].id, snapshot.quiz), true);
      assert.equal(runner.continueQuiz(runner.getSnapshot().quiz), true);
    } else if (snapshot.status === 'dialogue') assert.equal(runner.advance(), true);
    else assert.fail(`Witness ${witness.witnessId} stopped at ${snapshot.status}/${snapshot.nid}`);
  }
  assert.ok(reached, `Witness ${witness.witnessId} did not reach its target`);
  const expectedState = stateById.get(witness.witnessId);
  assert.deepEqual(stateValue(reached.stageState), expectedState.afterStart, `Correlated stage state differs on ${witness.witnessId}`);
  for (const tuple of group) {
    const matches = Object.values(reached.stageState.characters).filter(character => compositionFor(character, tuple.composition, tuple.gender).tupleId === tuple.tupleId);
    assert.ok(matches.length, `Tuple ${tuple.tupleId} is not on its actual runner witness`);
    if (tuple.composition === 'stage' && schoolRoverCounterpart(tuple.resourceTalkerId) != null) {
      const character = matches.find(character => character.portraitVisible);
      assert.ok(character, `Rover stage exception ${tuple.tupleId} was not source-visible`);
      const sourceScript = json(`public/data/scripts/${witness.scriptId}.json`);
      const sourceNode = sourceScript.nodes.find(node => node.nid === witness.target.nid);
      roverStageExceptions.push({ tupleId: tuple.tupleId, resourceSlug: tuple.resourceSlug, gender: tuple.gender,
        sourceExpressionId: tuple.sourceExpressionId, renderedExpressionId: tuple.renderedExpressionId, clips: tuple.clips,
        sourceScript: identity(`public/data/scripts/${witness.scriptId}.json`), witness,
        sourceNode: { nid: sourceNode.nid, kind: sourceNode.kind, speakerId: sourceNode.speakerId,
          rawRoleConfig: sourceNode.raw?.RoleConfig ?? null, operations: sourceNode.stage.filter(operation => operation.who === character.who) },
        runnerState: { who: character.who, expression: character.expression, present: character.present,
          hidePortrait: character.hidePortrait, hideAvatar: character.hideAvatar, portraitVisible: character.portraitVisible,
          avatarVisible: character.avatarVisible, position: character.position },
        sourceEntry: observations.find(observation => observation.tupleId === tuple.tupleId && observation.stateId === witness.witnessId
          && observation.sample === 'settled-node' && observation.who === character.who)?.sourceEntry ?? null,
        ordinaryChoiceAvailability: witness.choices.map(choice => {
          const choiceNode = sourceScript.nodes.find(node => node.nid === choice.nid);
          const sourceOption = choiceNode.options[choice.optionIndex];
          return { nid: choice.nid, optionIndex: choice.optionIndex, optionId: sourceOption.optionId,
            preCondition: sourceOption.preCondition ?? null, conditionProvided: sourceOption.preCondition !== undefined,
            hiddenChoice: choiceNode.raw?.OptionInteractionType === 'HideAndAutoSelect', next: sourceOption.next,
            eligibilityForUnconditionalChoice: sourceOption.preCondition === undefined ? evaluateCondition(undefined, initialStoryState(), storySource) : null };
        }),
        classification: 'Explicit source RoleConfig stage-portrait exception, corroborated by the actual ScriptRunner; no invented Enter or visibility.' });
    }
    runnerVerification.verifiedCompositionTuples++;
  }
  runnerVerification.verifiedWitnesses++;
  runnerVerification.results.push({ witnessId: witness.witnessId, tupleIds: group.map(tuple => tuple.tupleId), correlatedStageStateMatched: true });
  runner.dispose();
}

const timedRunnerVerification = { authority: 'independent-actual-ScriptRunner-with-controlled-source-clock',
  scope: 'Published start-phase compositions which are visible before a later source cue but absent from the settled expression inventory. Structural choices remain explicit developer overrides.',
  verifiedCompositionTuples: 0, results: [] };
const witnessById = new Map(witnesses.map(witness => [witness.witnessId, witness]));
for (const tuple of tupleList.filter(tuple => tuple.hasRenderableOccurrence && !tuple.hasSettledVisibleOccurrence)) {
  const observation = observations.find(observation => observation.tupleId === tuple.tupleId && observation.renderable);
  assert.equal(observation.phase, 'start', 'A newly discovered departure-only composition needs its own timed lifecycle witness.');
  const witness = witnessById.get(observation.stateId);
  const parentWitness = witnessById.get(witness.parentStateId);
  const sourceScript = json(`public/data/scripts/${witness.scriptId}.json`);
  const sourceNode = sourceScript.nodes.find(node => node.nid === observation.nid);
  const parentState = stateById.get(parentWitness.witnessId);
  const [parentFlow, parentNid] = parentState.nodeKey.split(':').map(Number);
  const clock = new FakeClock(), runner = new ScriptRunner({ clock, instantTransitions: true });
  assert.equal(runner.load(sourceScript, manifest), true); runner.start();
  let parentReached = false;
  for (let step = 0; step < 10_000; step++) {
    const snapshot = runner.getSnapshot(), history = snapshot.choiceHistory;
    if (snapshot.flowActionIndex === parentFlow && snapshot.nid === parentNid && history.length === parentWitness.choices.length) { parentReached = true; break; }
    if (snapshot.status === 'choices') {
      const choice = parentWitness.choices[history.length];
      assert.ok(choice, `Missing timed-witness choice for ${tuple.tupleId}`);
      assert.equal(`${snapshot.flowActionIndex}:${snapshot.nid}`, `${choice.flowActionIndex}:${choice.nid}`);
      assert.equal(runner.overrideChoice(choice.optionIndex), true);
    } else if (snapshot.status === 'quiz') {
      assert.equal(runner.answerQuiz(snapshot.quiz.definition.answers[0].id, snapshot.quiz), true);
      assert.equal(runner.continueQuiz(runner.getSnapshot().quiz), true);
    } else if (snapshot.status === 'dialogue') assert.equal(runner.advance(), true);
    else assert.fail(`Timed witness stopped at ${snapshot.status}/${snapshot.nid}`);
  }
  assert.ok(parentReached, `Timed witness ${tuple.tupleId} did not reach its departure`);
  assert.deepEqual(stateValue(runner.getSnapshot().stageState), parentState.afterStart);
  assert.equal(runner.setInstantTransitions(false), true);
  assert.equal(runner.advance(), true);
  assert.equal(runner.getSnapshot().nid, sourceNode.nid, 'This timed witness must enter directly from its readable predecessor.');
  const sourceTime = observation.sourceTimeSeconds;
  const laterTimes = phaseOperations(sourceNode.stage, 'start').map(record => record.operation.t).filter(time => time > sourceTime);
  assert.ok(laterTimes.length, `Timed-only tuple ${tuple.tupleId} has no later source cue`);
  const deadline = Math.min(...laterTimes);
  assert.equal(deadline, Math.max(...laterTimes), 'A multi-cue timed-only expression needs additional authored interval samples.');
  const expectedSample = new Map();
  for (const candidate of observations) {
    if (candidate.stateId !== observation.stateId || candidate.phase !== observation.phase || candidate.sample !== observation.sample
      || candidate.sourceTimeSeconds !== sourceTime) continue;
    const candidateTuple = tupleList.find(tuple => tuple.tupleId === candidate.tupleId);
    expectedSample.set(candidate.who, { who: candidate.who, expression: candidateTuple.sourceExpressionId, present: candidate.present,
      hasEntered: candidate.sourceEntry !== null, hidePortrait: candidate.hidePortrait, hideAvatar: candidate.hideAvatar, effect: candidate.sourceEffect });
  }
  const expectedCharacters = [...expectedSample.values()].sort((left, right) => left.who.localeCompare(right.who));
  const sampleTimes = [sourceTime, (sourceTime + deadline) / 2];
  const samples = [];
  let previousTime = 0;
  for (const time of sampleTimes) {
    clock.advanceBy((time - previousTime) * 1000); previousTime = time;
    const snapshot = runner.getSnapshot();
    assert.deepEqual(stateValue(snapshot.stageState), expectedCharacters, `Timed correlated state differs for ${tuple.tupleId} at ${time}`);
    const view = snapshot.presentation.characters.find(view => view.character.who === observation.who);
    assert.equal(compositionFor(view.character, tuple.composition, tuple.gender).tupleId, tuple.tupleId);
    const opacity = tuple.composition === 'stage' ? view.portraitOpacity : view.avatarOpacity;
    assert.ok(opacity > 0, `Timed tuple ${tuple.tupleId} has no Reader opacity at ${time}`);
    samples.push({ sourceTimeSeconds: time, sourceExpressionId: view.character.expression, opacity, correlatedStageStateMatched: true });
  }
  clock.advanceBy((deadline - previousTime) * 1000);
  assert.deepEqual(stateValue(runner.getSnapshot().stageState), stateById.get(observation.stateId).afterStart, `Settled state differs after timed source cue for ${tuple.tupleId}`);
  timedRunnerVerification.verifiedCompositionTuples++;
  timedRunnerVerification.results.push({ tupleId: tuple.tupleId, scriptId: witness.scriptId, flowActionIndex: observation.flowActionIndex,
    nid: observation.nid, witness: tuple.firstRenderableWitness, samples, nextSourceCueSeconds: deadline,
    sourceExpressionAfterCue: runner.getSnapshot().stageState.characters[observation.who].expression, settledStageStateMatched: true });
  runner.dispose();
}

// Repeated route context, character flags and raw operations are interned.
// Each observation joins one tuple, one character frame and its route context.
const occurrenceContexts = [], characterFrames = [], sourceOperations = [], compactObservations = [];
const contextIntern = new Map(), frameIntern = new Map(), operationIntern = new Map();
const intern = (array, map, value) => {
  const key = JSON.stringify(value);
  if (!map.has(key)) { const id = array.length; map.set(key, id); array.push({ id, ...value }); }
  return map.get(key);
};
for (const observation of observations) {
  const contextId = intern(occurrenceContexts, contextIntern, {
    stateId: observation.stateId, scriptId: observation.scriptId, flowActionIndex: observation.flowActionIndex, nid: observation.nid,
    phase: observation.phase, sourceOrder: observation.sourceOrder, sourceArray: observation.sourceArray,
    sourceTimeSeconds: observation.sourceTimeSeconds, sample: observation.sample,
    publishedReaderInterval: observation.publishedReaderInterval, speakerId: observation.speakerId, nodeKind: observation.nodeKind, witnessId: observation.witnessId });
  const operationRecord = (context, operation) => ({ scriptId: context.scriptId, flowActionIndex: context.flowActionIndex,
    nid: context.nid, phase: context.phase, sourceOrder: context.sourceOrder ?? null,
    sourceArray: context.sourceArray ?? (context.phase === 'option' ? 'option.performances' : 'node.stage'),
    optionIndex: context.optionIndex ?? null, operation });
  const lastSourceOperationId = intern(sourceOperations, operationIntern, operationRecord(observation.lastOperationContext, observation.lastSourceOperation));
  const sourceEntryOperationId = observation.sourceEntry ? intern(sourceOperations, operationIntern,
    operationRecord(observation.sourceEntry, observation.sourceEntry.operation)) : null;
  const frameId = intern(characterFrames, frameIntern, { contextId, who: observation.who, present: observation.present,
    hidePortrait: observation.hidePortrait, hideAvatar: observation.hideAvatar, portraitVisible: observation.portraitVisible,
    avatarVisible: observation.avatarVisible, sourcePosition: observation.sourcePosition, sourceEffect: observation.sourceEffect,
    sourceEntryOperationId, lastSourceOperationId });
  compactObservations.push({ id: compactObservations.length, tupleId: observation.tupleId, characterFrameId: frameId,
    visibility: observation.visibility, speakerEligible: observation.speakerEligible, opacity: observation.opacity, renderable: observation.renderable });
}

// Dense row tables remove repeated field names while keeping joins explicit.
// Source operations and expression tuples remain ordinary readable records.
const tupleIndex = new Map(tupleList.map((tuple, index) => [tuple.tupleId, index]));
const stateIndex = new Map(states.map((state, index) => [state.stateId, index]));
const phaseNames = ['start', 'option', 'end'];
const sampleNames = [...new Set(occurrenceContexts.map(context => context.sample))];
const arrayNames = [null, 'node.stage', 'option.performances'];
const nodeKinds = ['line', 'narration', 'centerText', 'silent', 'option'];
const visibilityNames = [...new Set(compactObservations.map(observation => observation.visibility))];
const positionValues = [], positionIntern = new Map(), effectValues = [], effectIntern = new Map();
const valueIndex = (array, map, value) => {
  const key = JSON.stringify(value);
  if (!map.has(key)) { map.set(key, array.length); array.push(value); }
  return map.get(key);
};
const contextRows = occurrenceContexts.map(context => [stateIndex.get(context.stateId), phaseNames.indexOf(context.phase), context.sourceOrder,
  arrayNames.indexOf(context.sourceArray), context.sourceTimeSeconds, sampleNames.indexOf(context.sample), context.publishedReaderInterval,
  context.speakerId, nodeKinds.indexOf(context.nodeKind), context.witnessId]);
const frameRows = characterFrames.map(frame => [frame.contextId, frame.who,
  (frame.present ? 1 : 0) | (frame.hidePortrait ? 2 : 0) | (frame.hideAvatar ? 4 : 0) | (frame.portraitVisible ? 8 : 0) | (frame.avatarVisible ? 16 : 0),
  valueIndex(positionValues, positionIntern, frame.sourcePosition), valueIndex(effectValues, effectIntern, frame.sourceEffect),
  frame.sourceEntryOperationId, frame.lastSourceOperationId]);
const observationRows = compactObservations.map(observation => [tupleIndex.get(observation.tupleId), observation.characterFrameId,
  visibilityNames.indexOf(observation.visibility), observation.speakerEligible, observation.opacity, observation.renderable]);
const semanticCharacters = [], semanticIntern = new Map();
const conditionEvaluations = [], conditionIntern = new Map(), hiddenBranchEvaluations = [], hiddenIntern = new Map(), issueLists = [], issueIntern = new Map();
const semanticIndex = character => character == null ? null : intern(semanticCharacters, semanticIntern, character);
const transitionIndex = new Map(graphTransitions.map((transition, index) => [transition.id, index]));
const stateRows = states.map(state => ({ stateId: state.stateId, scriptId: state.scriptId, nodeKey: state.nodeKey,
  beforeStart: state.beforeStart.map(semanticIndex), afterStart: state.afterStart.map(semanticIndex), outgoingTransitions: state.outgoingTransitions.map(id => transitionIndex.get(id)) }));
const graphTransitionRows = graphTransitions.map(transition => [transition.id, stateIndex.get(transition.fromStateId),
  transition.toStateId == null ? null : stateIndex.get(transition.toStateId), transition.edgeId,
  transition.selectedConditionOnRepresentativeWitness == null ? null : intern(conditionEvaluations, conditionIntern, transition.selectedConditionOnRepresentativeWitness),
  transition.hiddenResolutionOnRepresentativeWitness == null ? null : intern(hiddenBranchEvaluations, hiddenIntern, transition.hiddenResolutionOnRepresentativeWitness),
  transition.standaloneNormalSelectionEligible]);
const sourceTransitionRows = sourceTransitions.map(transition => {
  const operationId = intern(sourceOperations, operationIntern, { scriptId: transition.scriptId, flowActionIndex: transition.flowActionIndex,
    nid: transition.nid, phase: transition.phase, sourceOrder: transition.sourceOrder, sourceArray: transition.sourceArray,
    optionIndex: transition.optionIndex, operation: transition.operation });
  return [stateIndex.get(transition.stateId), operationId, semanticIndex(transition.before), semanticIndex(transition.after), transition.expressionChanged,
    transition.sourcePositionBefore == null ? null : valueIndex(positionValues, positionIntern, transition.sourcePositionBefore),
    valueIndex(positionValues, positionIntern, transition.sourcePositionAfter), transition.witness.witnessId,
    transition.issues.length ? valueIndex(issueLists, issueIntern, transition.issues) : null];
});
const parentWitnesses = witnesses.map(witness => ({ witnessId: witness.witnessId, parentStateId: witness.parentStateId,
  viaEdgeId: witness.viaEdgeId, nodeCountBeforeTarget: witness.nodeCountBeforeTarget }));
const uniqueValues = list => [...new Set(list.map(tuple => tuple.sourceExpressionId).filter(id => id != null))].sort((left, right) => left - right);
const uniqueIds = list => uniqueValues(list).filter(id => originalRows.has(id));
const tally = (list, getKey) => {
  const out = {};
  for (const item of list) { const key = getKey(item); out[key] = (out[key] ?? 0) + 1; }
  return out;
};
const counts = {
  scripts: scripts.length, structurallyReachableNodes: scripts.reduce((sum, script) => sum + script.structuralNodeCount, 0),
  structurallyReachableChoiceEdges: scripts.reduce((sum, script) => sum + script.structuralChoiceEdgeCount, 0),
  correlatedSemanticStates: states.length, correlatedGraphTransitions: graphTransitions.length,
  sourceCharacterOperations: sourceTransitions.length, observations: observations.length,
  sourceIdentities: identityList.length, sourceIdentitiesByKind: tally(identityList, item => item.sourceIdentityKind),
  spineResources: definitions.length, staticSourcePortraitResources: schoolStaticPortraits.length,
  sourceMetadataExpressionCount: new Set(resourceRecords.flatMap(resource => resource.sourceExpressionIds ?? [])).size,
  notEncounteredAsAuthoredSourceExpressionIds: [...new Set(resourceRecords.flatMap(resource => resource.sourceExpressionIds ?? []))].filter(id => !sourceExpressionIds.has(id)).sort((left, right) => left - right),
  reachableSourceExpressionValueCount: sourceExpressionIds.size,
  sourceExpressionValuesWithoutMetadataRows: [...sourceExpressionIds].filter(id => !originalRows.has(id)).sort((left, right) => left - right),
  reachableSourceExpressionCount: [...sourceExpressionIds].filter(id => originalRows.has(id)).length,
  reachableSourceExpressionIds: [...sourceExpressionIds].filter(id => originalRows.has(id)).sort((left, right) => left - right),
  playableSourceExpressionCount: uniqueIds(eligibleTuples).length, playableSourceExpressionIds: uniqueIds(eligibleTuples),
  playableSourceExpressionValueCount: uniqueValues(eligibleTuples).length,
  playableRenderedExpressionCount: new Set(eligibleTuples.map(tuple => tuple.renderedExpressionId).filter(id => originalRows.has(id))).size,
  sourceExpressionsUsedOnlyByReaderProjection: [...new Set(eligibleTuples.map(tuple => tuple.renderedExpressionId).filter(id => originalRows.has(id) && !sourceExpressionIds.has(id)))].sort((left, right) => left - right),
  settledVisibleSourceExpressionCount: uniqueIds(tupleList.filter(tuple => tuple.hasSettledVisibleOccurrence)).length,
  sourceHiddenExpressionIds: uniqueIds(tupleList.filter(tuple => tuple.sourceHiddenObservationCount)),
  sourceHiddenCompositionTupleCount: tupleList.filter(tuple => tuple.sourceHiddenObservationCount).length,
  sourceHiddenOnlyCompositionTupleCount: tupleList.filter(tuple => tuple.sourceHiddenObservationCount && !tuple.hasRenderableOccurrence).length,
  sourceNotPresentCompositionTupleCount: tupleList.filter(tuple => tuple.nonPresentObservationCount).length,
  nonSpeakerAvatarCompositionTupleCount: tupleList.filter(tuple => tuple.composition === 'avatar' && tuple.nonSpeakerObservationCount).length,
  compositionTuples: tupleList.length, renderableCompositionTuples: eligibleTuples.length,
  settledVisibleCompositionTuples: tupleList.filter(tuple => tuple.hasSettledVisibleOccurrence).length,
  timedVisibleCompositionTuples: tupleList.filter(tuple => tuple.hasTimedVisibleOccurrence).length,
  tuplesByAvailability: tally(tupleList, tuple => tuple.availability), renderableTuplesByComposition: tally(eligibleTuples, tuple => tuple.composition),
  renderableTuplesByResource: tally(eligibleTuples, tuple => tuple.resourceSlug ?? 'unbound'),
  observationsByVisibility: tally(observations, observation => observation.visibility),
  rover: Object.fromEntries(['female', 'male'].map(gender => [gender, {
    compositionTuples: tupleList.filter(tuple => tuple.gender === gender).length,
    renderableStageTuples: eligibleTuples.filter(tuple => tuple.gender === gender && tuple.composition === 'stage').length,
    renderableAvatarTuples: eligibleTuples.filter(tuple => tuple.gender === gender && tuple.composition === 'avatar').length,
    avatarFallbacks: tupleList.filter(tuple => tuple.gender === gender && tuple.composition === 'avatar' && (tuple.avatarFallback || tuple.avatarChannelRepair)).map(tuple => ({ tupleId: tuple.tupleId,
      sourceExpressionId: tuple.sourceExpressionId, renderedExpressionId: tuple.renderedExpressionId, availability: tuple.availability, renderable: tuple.hasRenderableOccurrence,
      clips: tuple.clips, literalMissingClips: tuple.literalMissingClips, fallback: tuple.avatarFallback, channelRepair: tuple.avatarChannelRepair })),
  }])) };
const perResourceCoverage = resourceRecords.map(resource => {
  const matching = tupleList.filter(tuple => tuple.resourceSlug === resource.resourceSlug);
  const visible = matching.filter(tuple => tuple.hasRenderableOccurrence);
  return { resourceSlug: resource.resourceSlug, resourceTalkerId: resource.resourceTalkerId, name: resource.name, assetKind: resource.kind,
    sourceMetadataExpressionCount: resource.sourceExpressionIds?.length ?? 0,
    reachableSourceExpressionIds: uniqueIds(matching), playableSourceExpressionIds: uniqueIds(visible),
    sourceExpressionLiteralValuesWithoutRows: uniqueValues(matching).filter(id => !originalRows.has(id)),
    renderedExpressionIds: [...new Set(visible.map(tuple => tuple.renderedExpressionId).filter(id => id != null))].sort((left, right) => left - right),
    compositionTupleCount: matching.length, renderableStageTupleCount: visible.filter(tuple => tuple.composition === 'stage').length,
    renderableAvatarTupleCount: visible.filter(tuple => tuple.composition === 'avatar').length,
    sourceHiddenStageTupleIds: matching.filter(tuple => tuple.composition === 'stage' && tuple.sourceHiddenObservationCount).map(tuple => tuple.tupleId),
    sourceHiddenAvatarTupleIds: matching.filter(tuple => tuple.composition === 'avatar' && tuple.sourceHiddenObservationCount).map(tuple => tuple.tupleId),
    unavailableTupleIds: matching.filter(tuple => !['ready-spine', 'ready-static-image'].includes(tuple.availability)).map(tuple => tuple.tupleId),
    sourceNotPresentTupleIds: matching.filter(tuple => tuple.nonPresentObservationCount).map(tuple => tuple.tupleId) };
});

for (const [tupleId, frameId, visibilityId] of observationRows) {
  assert.ok(tupleId >= 0 && tupleId < tupleList.length);
  assert.ok(frameId >= 0 && frameId < frameRows.length);
  assert.ok(visibilityId >= 0 && visibilityId < visibilityNames.length);
}
for (const [contextId, , , positionId, effectId, sourceEntryId, sourceOperationId] of frameRows) {
  assert.ok(contextId >= 0 && contextId < contextRows.length);
  assert.ok(positionId >= 0 && positionId < positionValues.length);
  assert.ok(effectId >= 0 && effectId < effectValues.length);
  assert.ok(sourceEntryId == null || sourceEntryId >= 0 && sourceEntryId < sourceOperations.length);
  assert.ok(sourceOperationId >= 0 && sourceOperationId < sourceOperations.length);
}
for (const [stateId, phaseId, , sourceArrayId, , sampleId, , , kindId] of contextRows) {
  assert.ok(stateId >= 0 && stateId < stateRows.length);
  assert.ok(phaseId >= 0 && phaseId < phaseNames.length);
  assert.ok(sourceArrayId >= 0 && sourceArrayId < arrayNames.length);
  assert.ok(sampleId >= 0 && sampleId < sampleNames.length);
  assert.ok(kindId >= 0 && kindId < nodeKinds.length);
}
const sourceFiles = ['public/data/manifest.json', 'public/data/scripts.index.json', 'public/data/assets.manifest.json', 'public/data/speakers.json', 'public/data/locales/en.json', 'public/data/maps/story-source.json',
  'WutheringWaves_Data/BinData/AvgSolarSchoolRoleAnimation/avgsolarschoolroleanimation.json',
  'src/engine/validation.ts', 'src/engine/FlowDispatcher.ts', 'src/engine/StageEngine.ts', 'src/engine/StoryState.ts', 'src/engine/Clock.ts',
  'src/engine/StageState.ts', 'src/engine/StageScheduler.ts', 'src/engine/StageTransitions.ts', 'src/engine/ScriptRunner.ts',
  'src/spine/SchoolPortraitAssets.ts', 'src/spine/SchoolRover.ts', 'src/spine/SchoolStaticPortraitAssets.ts', 'src/spine/SchoolPortraitCatalog.ts',
  'src/spine/ChangliAssets.ts', 'src/spine/ChangliSpineScene.ts', 'src/spine/ChangliStageAdapter.ts', 'src/spine/SchoolPortraitStageAdapter.ts',
  'src/ui/SchoolCharacterStage.tsx', 'src/ui/SpeakerAvatar.tsx', 'public/assets/solarschool/characters/changli/spine-player.js',
  'tools/enumerate_reader_catchlight_routes.mjs', 'tests/FakeClock.ts'];
const report = { schema: 1, authority: 'prepared-script-graph-and-actual-reader-composition-resolvers',
  reachability: { model: 'Finite least fixed point of script graph node plus correlated stage semantic state; every source choice is a structural candidate.',
    stateDimensions: ['who', 'source expression', 'present', 'has entered', 'hidePortrait', 'hideAvatar', 'source effect'],
    normalizedDimensions: ['entry serials', 'event serials', 'diagnostic history', 'position geometry', 'portrait effects', 'background/CG/screen geometry', 'wall-clock timing'],
    conditionalFeasibility: 'Story predicates, first-eligible hidden-choice precedence, and representative-witness evaluations are retained separately. Structural coverage does not assert that every branch is attainable in one story state.',
    routeWitnesses: 'Each semantic state has a deterministic breadth-first predecessor witness. Every tuple has a concrete first occurrence witness; visible tuples also have a first renderable witness.',
    timing: 'Operations apply in native timestamp/source order. Same-time operation intermediates are recorded as unpublished source states. Start/departure batches and local opacity intervals publish only where dialogue or a pending source cue leaves an observable interval.',
    counting: 'Playable source expressions are unique declared source-row IDs with a ready composition in a published visible interval. Literal NPC Expression 0 has no source animation row and remains explicit without counting as an authored expression. Source IDs, composition tuples, static portraits, hidden tuples and projected Rover expression IDs are counted separately.',
    coverageValidation: 'For every script, the correlated-state closure must cover exactly the independently traversed structural reachable nodes and choice edges.' },
  limitations: ['Route enumeration abstracts external playthrough state and crosses conditional branches as explicit structural candidates; no global condition satisfiability claim is made.',
    'Equivalent character membership/expression/visibility states share one representative source-position and source-entry witness. Their infinitely many loop histories are not duplicated.',
    'Timed samples use locally settled phase-entry opacity. Cross-visit fade continuation, arbitrary player interruption times, CG occlusion and viewport cropping are retained as source metadata rather than certified framebuffer visibility.',
    'Asset readiness here verifies registered resources and native clip existence. It does not itself observe browser rendering or native game playback.',
    'Static source images have no authored Spine catchlight timeline. Text-only, missing-resource and unbound identities remain explicit inventory records.'],
  sourceFiles: sourceFiles.map(identity), scriptsDigest: digest(scripts.map(script => `${script.source.path}:${script.source.sha256}`).join('\n')),
  occurrenceSchema: { format: 'Dense rows use zero-based array indexes; row index is the row identity. Tuples and source operations are readable records.',
    observations: ['tupleIndex', 'characterFrameId', 'visibilityId', 'speakerEligible', 'opacity', 'renderable'],
    characterFrames: ['contextId', 'who', 'visibilityBits', 'positionId', 'effectId', 'sourceEntryOperationId', 'lastSourceOperationId'],
    occurrenceContexts: ['stateIndex', 'phaseId', 'sourceOrder', 'sourceArrayId', 'sourceTimeSeconds', 'sampleId', 'publishedReaderInterval', 'speakerId', 'nodeKindId', 'witnessId'],
    graphTransitions: ['transitionId', 'fromStateIndex', 'toStateIndex', 'sourceEdgeId', 'conditionEvaluationId', 'hiddenBranchEvaluationId', 'standaloneNormalSelectionEligible'],
    sourceTransitions: ['stateIndex', 'sourceOperationId', 'beforeSemanticCharacterId', 'afterSemanticCharacterId', 'expressionChanged', 'beforePositionId', 'afterPositionId', 'witnessId', 'issuesId'],
    visibilityBits: { present: 1, hidePortrait: 2, hideAvatar: 4, portraitVisible: 8, avatarVisible: 16 },
    phaseNames, sampleNames, sourceArrayNames: arrayNames, nodeKinds, visibilityNames,
    join: 'observations[tupleIndex] → tuples[index]; observations[characterFrameId] → characterFrames[index]; characterFrames[contextId] → occurrenceContexts[index]; occurrenceContexts[stateIndex] → states[index]',
    sourceOperationJoin: 'characterFrames sourceEntryOperationId and lastSourceOperationId → sourceOperations[index]',
    stateJoin: 'states.beforeStart and afterStart reference semanticCharacters[index]; states.outgoingTransitions reference graphTransitions[index]',
    semanticCharacters: 'Readable records {id, who, expression, present, hasEntered, hidePortrait, hideAvatar, effect}. Expression is the literal source ID. portraitVisible = present && !hidePortrait; avatarVisible = present && !hideAvatar.',
    pathJoin: 'Follow witnesses.parentStateId and viaEdgeId through source graph edges. A departure witnessId matches graphTransitions transitionId; its source state witness plus selected edge preserves the actual correlated path.',
    visibility: 'Presence/hide flags are frame bits. Current speaker, node kind, source phase/time and publication interval are on the occurrence context. Per-composition eligibility/opacity are on the observation. Visibility labels choose a primary reason; tuple sourceHidden/nonPresent/nonSpeaker counters preserve each independent condition even when several apply.' },
  counts, resources: resourceRecords, perResourceCoverage, identities: identityList, scripts, tuples: tupleList,
  observations: observationRows, characterFrames: frameRows, occurrenceContexts: contextRows, sourceOperations,
  sourceTransitions: sourceTransitionRows, states: stateRows, semanticCharacters, graphTransitions: graphTransitionRows,
  witnesses: parentWitnesses, conditionEvaluations, hiddenBranchEvaluations, positionValues, effectValues, issueLists,
  runnerVerification, timedRunnerVerification, roverStageExceptions };
mkdirSync(dirname(output), { recursive: true });
const denseArrays = new Set(['scripts', 'observations', 'characterFrames', 'occurrenceContexts', 'sourceOperations', 'sourceTransitions', 'states', 'graphTransitions', 'witnesses']);
const fields = Object.entries(report).map(([key, value]) => `  ${JSON.stringify(key)}: ` + (denseArrays.has(key)
  ? '[\n' + value.map(row => '    ' + JSON.stringify(row)).join(',\n') + '\n  ]'
  : JSON.stringify(value, null, 2).replaceAll('\n', '\n  ')));
writeFileSync(output, '{\n' + fields.join(',\n') + '\n}\n');
const exceptionOutput = resolve(dirname(output), 'rover-stage-exception.json');
writeFileSync(exceptionOutput, JSON.stringify({ authority: 'literal-source-RoleConfig-and-independent-ScriptRunner-replay',
  runner: identity('src/engine/ScriptRunner.ts'), exceptions: roverStageExceptions }, null, 2) + '\n');
console.log(JSON.stringify({ output, counts: { ...counts, reachableSourceExpressionIds: undefined, playableSourceExpressionIds: undefined, sourceHiddenExpressionIds: undefined,
  rover: Object.fromEntries(Object.entries(counts.rover).map(([gender, item]) => [gender, { ...item, avatarFallbacks: item.avatarFallbacks.length }])) } }, null, 2));
