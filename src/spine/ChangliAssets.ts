import type { VisualAssets } from '../assets/VisualAssets.ts';
import type { CharacterState } from '../engine/StageState.ts';
import type { SpineRuntime } from './SpineRuntime.ts';
import { loadLocalSpineRuntime } from './SpineRuntimeLoader.ts';

export const changliTalkerId = 850006;
export const verifiedChangliBlinks = new Set([
  'dongzuo1_jingya_zhayan', 'dongzuo1_kunao_zhayan', 'dongzuo1_morensikao_zhayan',
  'dongzuo1_shengqi_zhayan', 'dongzuo4_kaixin_zhayan', 'dongzuo4_pingjing_zhayan', 'dongzuo4_yansu_zhayan',
]);

export interface ChangliExpression {
  readonly id: number;
  readonly body: string;
  readonly mouth: string;
  readonly eye: string;
  readonly blink: string | null;
}
export type ChangliResolution =
  | { readonly kind: 'other'; readonly talkerId: number | null; readonly reason?: string }
  | { readonly kind: 'fallback'; readonly reason: string }
  | { readonly kind: 'changli'; readonly expression: Omit<ChangliExpression, 'blink'> };

/** who selects persistent character state, whose expression identifies the
 * talker in the manifest independently of the explicit speaker config.
 * Numeric who and dialogue speaker IDs are never treated as talker IDs. */
export function resolveChangli(character: CharacterState, assets: VisualAssets): ChangliResolution {
  const expression = character.expression === null ? undefined : assets.manifest.expressions[String(character.expression)];
  if (!expression) return { kind: 'other', talkerId: null, reason: `Expression ${character.expression ?? '(unspecified)'} is missing from the asset manifest.` };
  if (expression.talkerId !== changliTalkerId) return { kind: 'other', talkerId: expression.talkerId };
  const talker = assets.manifest.talkers?.[String(changliTalkerId)];
  if (talker?.spineSource !== 'SolarSchool' || !talker.spineAtlas?.includes('/SolarSchool_Changli/') || !talker.spineSkeleton?.includes('/SolarSchool_Changli/')) {
    return { kind: 'fallback', reason: 'Changli source assets are missing or do not match the local SolarSchool skeleton.' };
  }
  if (![expression.body, expression.mouth, expression.eye].every(name => typeof name === 'string' && name.length > 0)) {
    return { kind: 'fallback', reason: `Changli expression ${character.expression} is missing body, mouth, or eye tracks.` };
  }
  return { kind: 'changli', expression: { id: character.expression!, body: expression.body!, mouth: expression.mouth!, eye: expression.eye! } };
}

export function readChangliExpressions(raw: unknown): ReadonlyMap<number, ChangliExpression> {
  const metadata = raw as { talker_id?: unknown; spine_version?: unknown; dataset_animation_rows?: unknown } | null;
  if (metadata?.talker_id !== changliTalkerId || typeof metadata.spine_version !== 'string' || !metadata.spine_version.startsWith('4.1.') || !Array.isArray(metadata.dataset_animation_rows)) throw new Error('Local Changli expression metadata must identify talker 850006 and Spine 4.1.');
  const result = new Map<number, ChangliExpression>();
  for (const row of metadata.dataset_animation_rows as Record<string, unknown>[]) {
    if (!row || row.AvgTalkerId !== changliTalkerId || !Number.isSafeInteger(row.Id) || !['BodyAnimation', 'MouthAnimation', 'EyeAnimation'].every(key => typeof row[key] === 'string' && (row[key] as string).length)) throw new Error('Malformed local Changli expression row.');
    if (row.BlinkAnimation != null && typeof row.BlinkAnimation !== 'string') throw new Error('Malformed local Changli blink mapping.');
    const blink = typeof row.BlinkAnimation === 'string' && row.BlinkAnimation ? row.BlinkAnimation : null;
    if (blink && !verifiedChangliBlinks.has(blink)) throw new Error(`Unverified Changli blink: ${blink}.`);
    result.set(row.Id as number, Object.freeze({ id: row.Id as number, body: row.BodyAnimation as string, mouth: row.MouthAnimation as string, eye: row.EyeAnimation as string, blink }));
  }
  return result;
}

export function composeChangliExpression(expression: Omit<ChangliExpression, 'blink'>, mapping: ReadonlyMap<number, ChangliExpression>): ChangliExpression {
  const mapped = mapping.get(expression.id);
  if (!mapped) throw new Error(`Changli expression ${expression.id} has no local composition mapping.`);
  if ((['body', 'mouth', 'eye'] as const).some(key => expression[key] !== mapped[key])) throw new Error(`Changli expression ${expression.id} conflicts with the source expression mapping.`);
  return mapped;
}

export interface ChangliResources {
  readonly runtime: SpineRuntime;
  readonly skeleton: Uint8Array;
  readonly atlas: string;
  readonly image: HTMLImageElement;
  readonly expressions: ReadonlyMap<number, ChangliExpression>;
}

export function changliAssetUrls(baseUrl: string) {
  const root = `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}characters/changli/`;
  return Object.freeze({ runtime: `${root}spine-player.js`, skeleton: `${root}SolarSchool_Changli.skel`, atlas: `${root}SolarSchool_Changli.atlas`, image: `${root}SolarSchool_Changli.png`, expressions: `${root}Changli.animation-metadata.json` });
}

async function readLocalChangli(baseUrl: string): Promise<ChangliResources> {
  const urls = changliAssetUrls(baseUrl);
  const response = async (url: string) => {
    const result = await globalThis.fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!result.ok) throw new Error(`Local Changli asset failed: HTTP ${result.status} ${url}`);
    return result;
  };
  const imagePromise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => { image.onload = image.onerror = null; reject(new Error(`Local Changli PNG timed out: ${urls.image}`)); }, 10000);
    image.onload = () => { clearTimeout(timer); image.onload = image.onerror = null; resolve(image); };
    image.onerror = () => { clearTimeout(timer); image.onload = image.onerror = null; reject(new Error(`Local Changli PNG could not load: ${urls.image}`)); };
    image.src = urls.image;
  });
  const [runtime, skeleton, atlas, image, metadata] = await Promise.all([
    loadLocalSpineRuntime(urls.runtime), response(urls.skeleton).then(value => value.arrayBuffer()),
    response(urls.atlas).then(value => value.text()), imagePromise, response(urls.expressions).then(value => value.json()),
  ]);
  return Object.freeze({ runtime, skeleton: new Uint8Array(skeleton), atlas, image, expressions: readChangliExpressions(metadata) });
}

/** Shared pending/completed assets survive React rerenders, restart and script
 * switch. Each stage owns its GPU resources; shared loads have no actor callbacks. */
export class ChangliAssetCache {
  private readonly pending = new Map<string, Promise<ChangliResources>>();
  private readonly read: (baseUrl: string) => Promise<ChangliResources>;
  constructor(read = readLocalChangli) { this.read = read; }
  load(baseUrl: string): Promise<ChangliResources> {
    const key = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    let result = this.pending.get(key);
    if (!result) { result = this.read(key); this.pending.set(key, result); }
    return result;
  }
}
export const changliAssetCache = new ChangliAssetCache();
