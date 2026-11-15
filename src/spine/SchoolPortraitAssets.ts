import type { VisualAssets } from '../assets/VisualAssets.ts';
import type { CharacterState } from '../engine/StageState.ts';
import { changliAssetUrls } from './ChangliAssets.ts';
import type { ChangliExpression, ChangliResources } from './ChangliAssets.ts';
import { chisaCalibration, chisaTransform } from './ChisaCalibration.ts';
import { abbyCalibration, abbyTransform, abbyAvatarCalibration, abbyAvatarTransform } from './AbbyCalibration.ts';
import type { SpinePortraitProfile } from './ChangliSpineScene.ts';
import { loadLocalSpineRuntime } from './SpineRuntimeLoader.ts';
import { additionalSchoolPortraitData } from './SchoolPortraitCatalog.ts';
import { calibratedPortraitTransform } from './PortraitCalibration.ts';
import { previewCoordinateFrame } from '../engine/StageCoordinates.ts';
import { validateSpinePortraitResources } from './SpinePortraitValidation.ts';
import { roverGenderMissingClips, roverMaleAvatarRepairs, schoolRoverCounterpart } from './SchoolRover.ts';

export interface SchoolPortraitDefinition {
  readonly slug: string;
  readonly name: string;
  readonly talkerId: number;
  readonly stem: string;
  readonly profile: SpinePortraitProfile;
  readonly avatarProfile?: SpinePortraitProfile;
  /** Verified dialogue-facing override; stage rendering retains its profile. */
  readonly avatarFacing?: 1 | -1;
  readonly unsupportedExpressions: ReadonlySet<number>;
  readonly unsupportedExpressionReasons?: Readonly<Record<number, string>>;
  /** Only individually verified source spelling errors are aliased. */
  readonly animationAliases?: Readonly<Record<string, string>>;
  readonly metadataFile?: string;
  readonly textureFile?: string;
}

export const chisaPortrait: SchoolPortraitDefinition = Object.freeze({
  slug: 'chisa', name: 'Chisa', talkerId: 850014, stem: 'SolarSchool_Qianxiao',
  profile: Object.freeze({
    name: 'Chisa', calibration: chisaCalibration, transform: chisaTransform,
    verifiedBlinks: new Set(['dongzuo1_zhengchang_zhayan', 'dongzuo1_weixiao_zhayan', 'dongzuo1_nanguo_zhayan', 'dongzuo1_yansu_zhayan', 'dongzuo1_haixiu_zhayan']),
  }),
  // The source's unused test row names four clips absent from this skeleton.
  // Preserve it in metadata, but do not reject the 14 working expressions.
  unsupportedExpressions: new Set([700009]),
});
export const abbyPortrait: SchoolPortraitDefinition = Object.freeze({
  slug: 'abby', name: 'Abby', talkerId: 700005, stem: 'SolarSchool_Abu',
  profile: Object.freeze({
    name: 'Abby', calibration: abbyCalibration, transform: abbyTransform,
    verifiedBlinks: new Set(['dongzuo1_zhengchang_zhayan', 'dongzuo1_sikao_zhayan', 'dongzuo3_taitouzhan_zhayan', 'dongzuo6_ditouzhan_zhayan']),
    poseDurations: Object.freeze({ dongzuo1_zhengchang_zhengyan: .20000001788139343 }),
    // Six weighted catchlight bones have authored, phase-offset scale cycles.
    loopAnimations: new Set(['dongzuo1_zhengchang_zhengyan']),
  }),
  avatarProfile: Object.freeze({
    name: 'Abby', calibration: abbyAvatarCalibration, transform: abbyAvatarTransform,
    verifiedBlinks: new Set(['dongzuo1_zhengchang_zhayan', 'dongzuo1_sikao_zhayan', 'dongzuo3_taitouzhan_zhayan', 'dongzuo6_ditouzhan_zhayan']),
    poseDurations: Object.freeze({ dongzuo1_zhengchang_zhengyan: .20000001788139343 }),
    loopAnimations: new Set(['dongzuo1_zhengchang_zhengyan']),
  }),
  unsupportedExpressions: new Set<number>(),
});

/** Resource, channel/playback and fixed placement registration is data-driven.
 * The original three portraits retain their existing resources and profiles. */
export const schoolPortraits: readonly SchoolPortraitDefinition[] = Object.freeze([
  chisaPortrait, abbyPortrait,
  ...additionalSchoolPortraitData.map(data => {
    const calibration = Object.freeze({ ...data.calibration, frame: previewCoordinateFrame });
    const unsupportedExpressionReasons = Object.freeze({ ...data.unsupportedExpressionReasons,
      ...Object.fromEntries(Object.entries(roverGenderMissingClips[data.talkerId] ?? {}).map(([id, clips]) =>
        [id, `${data.name}: source expression ${id} references absent skeleton clips after gender resource selection: ${clips.join(', ')}.`])),
    });
    return Object.freeze({
      slug: data.slug, name: data.name, talkerId: data.talkerId, stem: data.stem,
      metadataFile: data.metadataFile, textureFile: data.textureFile,
      // Female Rover's original front-facing school crest is screen-left.
      // Its supplied skeleton places it screen-right at positive X scale.
      // Male Rover and Abby retain their independently verified source facing.
      avatarFacing: data.talkerId === 850002 ? -1 : 1,
      unsupportedExpressions: new Set(Object.keys(unsupportedExpressionReasons).map(Number)),
      unsupportedExpressionReasons,
      animationAliases: data.animationAliases,
      profile: Object.freeze({
        name: data.name, calibration,
        transform: (position: Parameters<typeof calibratedPortraitTransform>[0]) => calibratedPortraitTransform(position, calibration),
        verifiedBlinks: new Set<string>([...data.verifiedBlinks, ...(data.talkerId === 850002 ? ['dongzuo1_sikao_zhayan'] : [])]),
        poseDurations: { ...data.poseDurations, ...(data.talkerId === 850002 ? { dongzuo1_sikao_zhengyan: 0.6666666865348816 } : {}) },
        loopAnimations: new Set<string>([...data.loopAnimations, ...(data.talkerId === 850002 ? ['dongzuo1_sikao_zhengyan'] : [])]),
      }),
    });
  }),
]);

export const schoolPortraitByTalker: ReadonlyMap<number, SchoolPortraitDefinition> = new Map(schoolPortraits.map(definition => [definition.talkerId, definition]));

export type SchoolPortraitResolution =
  | { readonly kind: 'other'; readonly talkerId: number | null; readonly reason?: string }
  | { readonly kind: 'fallback'; readonly reason: string }
  | { readonly kind: 'spine'; readonly expression: Omit<ChangliExpression, 'blink'> };

/** The expression's talker selects assets; stage who and dialogue speaker IDs
 * remain independent. Never guess a talker from who or substitute a default. */
export function resolveSchoolPortrait(character: CharacterState, assets: VisualAssets, definition: SchoolPortraitDefinition, composition: 'stage' | 'avatar' = 'stage'): SchoolPortraitResolution {
  const expression = character.expression === null ? undefined : assets.manifest.expressions[String(character.expression)];
  if (!expression) return { kind: 'other', talkerId: null, reason: `Expression ${character.expression ?? '(unspecified)'} is missing from the asset manifest.` };
  if (expression.talkerId !== definition.talkerId) return { kind: 'other', talkerId: expression.talkerId };
  const talker = assets.manifest.talkers?.[String(definition.talkerId)];
  const source = `/Game/Aki/UI/UIResources/UiActivity/Spine/Activity38/SolarSchool/${definition.stem}/${definition.stem}.`;
  if (talker?.spineSource !== 'SolarSchool' || talker.spineAtlas !== `${source}${definition.stem}-atlas` || talker.spineSkeleton !== `${source}${definition.stem}-data`) {
    return { kind: 'fallback', reason: `${definition.name} source assets are missing or do not match the local SolarSchool skeleton.` };
  }
  const repaired = composition === 'avatar' && character.who === '750088' && definition.talkerId === 850001 ? roverMaleAvatarRepairs.get(character.expression!) : undefined;
  if (repaired) return { kind: 'spine', expression: repaired };
  if (definition.unsupportedExpressions.has(character.expression!)) return { kind: 'fallback', reason: definition.unsupportedExpressionReasons?.[character.expression!] ?? `${definition.name} expression ${character.expression} references clips absent from this skeleton.` };
  if (![expression.body, expression.mouth, expression.eye].every(name => typeof name === 'string' && name.length > 0)) return { kind: 'fallback', reason: `${definition.name} expression ${character.expression} is missing body, mouth, or eye tracks.` };
  return { kind: 'spine', expression: { id: character.expression!, body: expression.body!, mouth: expression.mouth!, eye: expression.eye! } };
}

const clipName = (name: string, definition: SchoolPortraitDefinition) => definition.animationAliases?.[name] ?? name;

export function readSchoolExpressions(raw: unknown, definition: SchoolPortraitDefinition, counterpartRaw?: unknown): ReadonlyMap<number, ChangliExpression> {
  const result = readExpressionRows(raw, definition, definition.talkerId);
  if (counterpartRaw !== undefined) {
    const counterpart = schoolRoverCounterpart(definition.talkerId);
    if (counterpart == null) throw new Error('Only source Rover expressions support gender resource selection.');
    for (const [id, expression] of readExpressionRows(counterpartRaw, definition, counterpart)) {
      if (result.has(id)) throw new Error(`Duplicate ${definition.name} expression ${id}.`);
      result.set(id, expression);
    }
  }
  return result;
}

function readExpressionRows(raw: unknown, definition: SchoolPortraitDefinition, sourceTalkerId: number): Map<number, ChangliExpression> {
  const metadata = raw as { talker_id?: unknown; spine_version?: unknown; dataset_animation_rows?: unknown } | null;
  if (metadata?.talker_id !== sourceTalkerId || typeof metadata.spine_version !== 'string' || !metadata.spine_version.startsWith('4.1.') || !Array.isArray(metadata.dataset_animation_rows)) throw new Error(`Local ${definition.name} expression metadata must identify talker ${sourceTalkerId} and Spine 4.1.`);
  const result = new Map<number, ChangliExpression>();
  for (const row of metadata.dataset_animation_rows as Record<string, unknown>[]) {
    if (!row || row.AvgTalkerId !== sourceTalkerId || !Number.isSafeInteger(row.Id) || !['BodyAnimation', 'MouthAnimation', 'EyeAnimation'].every(key => typeof row[key] === 'string' && (row[key] as string).length)) throw new Error(`Malformed local ${definition.name} expression row.`);
    if (definition.unsupportedExpressions.has(row.Id as number)) continue;
    if (result.has(row.Id as number)) throw new Error(`Duplicate ${definition.name} expression ${row.Id}.`);
    if (row.BlinkAnimation != null && typeof row.BlinkAnimation !== 'string') throw new Error(`Malformed local ${definition.name} blink mapping.`);
    const blink = typeof row.BlinkAnimation === 'string' && row.BlinkAnimation ? clipName(row.BlinkAnimation, definition) : null;
    if (blink && !definition.profile.verifiedBlinks.has(blink)) throw new Error(`Unverified ${definition.name} blink: ${blink}.`);
    result.set(row.Id as number, Object.freeze({ id: row.Id as number, body: clipName(row.BodyAnimation as string, definition), mouth: clipName(row.MouthAnimation as string, definition), eye: clipName(row.EyeAnimation as string, definition), blink }));
  }
  return result;
}

export function composeSchoolExpression(expression: Omit<ChangliExpression, 'blink'>, mapping: ReadonlyMap<number, ChangliExpression>, definition: SchoolPortraitDefinition): ChangliExpression {
  const mapped = mapping.get(expression.id);
  if (!mapped) throw new Error(`${definition.name} expression ${expression.id} has no verified local composition mapping.`);
  if ((['body', 'mouth', 'eye'] as const).some(key => clipName(expression[key], definition) !== mapped[key])) throw new Error(`${definition.name} expression ${expression.id} conflicts with the source expression mapping.`);
  return mapped;
}

export function schoolPortraitAssetUrls(baseUrl: string, definition: SchoolPortraitDefinition) {
  const root = `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}characters/${definition.slug}/`;
  return Object.freeze({ runtime: changliAssetUrls(baseUrl).runtime, skeleton: `${root}${definition.stem}.skel`, atlas: `${root}${definition.stem}.atlas`, image: `${root}${definition.textureFile ?? `${definition.stem}.png`}`, expressions: `${root}${definition.metadataFile ?? `${definition.name}.animation-metadata.json`}` });
}

async function readLocalSchoolPortrait(baseUrl: string, definition: SchoolPortraitDefinition): Promise<ChangliResources> {
  const urls = schoolPortraitAssetUrls(baseUrl, definition);
  const response = async (url: string) => {
    const result = await globalThis.fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!result.ok) throw new Error(`Local ${definition.name} asset failed: HTTP ${result.status} ${url}`);
    return result;
  };
  const imagePromise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => { image.onload = image.onerror = null; reject(new Error(`Local ${definition.name} texture timed out: ${urls.image}`)); }, 10000);
    image.onload = () => { clearTimeout(timer); image.onload = image.onerror = null; resolve(image); };
    image.onerror = () => { clearTimeout(timer); image.onload = image.onerror = null; reject(new Error(`Local ${definition.name} texture could not load: ${urls.image}`)); };
    image.src = urls.image;
  });
  const counterpart = schoolPortraitByTalker.get(schoolRoverCounterpart(definition.talkerId) ?? -1);
  const [runtime, skeleton, atlas, image, metadata, counterpartMetadata] = await Promise.all([
    loadLocalSpineRuntime(urls.runtime), response(urls.skeleton).then(value => value.arrayBuffer()),
    response(urls.atlas).then(value => value.text()), imagePromise, response(urls.expressions).then(value => value.json()),
    counterpart ? response(schoolPortraitAssetUrls(baseUrl, counterpart).expressions).then(value => value.json()) : undefined,
  ]);
  const resources = Object.freeze({ runtime, skeleton: new Uint8Array(skeleton), atlas, image, expressions: readSchoolExpressions(metadata, definition, counterpartMetadata) });
  validateSpinePortraitResources(resources, definition.profile, `${definition.stem}.png`);
  return resources;
}

/** Each character/base has its own pending/completed resources. Assets survive
 * restart and script switch; actor and GPU ownership stay in the adapter. */
export class SchoolPortraitAssetCache {
  private readonly pending = new Map<string, Promise<ChangliResources>>();
  private readonly read: typeof readLocalSchoolPortrait;
  constructor(read = readLocalSchoolPortrait) { this.read = read; }
  load(baseUrl: string, definition: SchoolPortraitDefinition): Promise<ChangliResources> {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const key = `${base}:${definition.slug}`;
    let result = this.pending.get(key);
    if (!result) { result = this.read(base, definition); this.pending.set(key, result); }
    return result;
  }
}
export const schoolPortraitAssetCache = new SchoolPortraitAssetCache();
