import { freezeJson } from '../engine/validation.ts';
import type { StageEffectDefinition } from '../engine/StageEffects.ts';

export interface ReaderVfxImage {
  readonly url: string;
  readonly sourceRef: string;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly role?: 'sprite' | 'mask' | 'noise' | 'vat' | 'lookup';
  readonly columns?: number;
  readonly rows?: number;
  readonly atlasMode?: 'variants' | 'flipbook';
  readonly cells?: readonly number[];
  readonly alpha?: boolean;
}

export interface ReaderVfxAsset extends StageEffectDefinition {
  readonly name: string;
  readonly status: string;
  readonly primaryImage?: string | null;
  readonly images: readonly ReaderVfxImage[];
}

export interface ReaderVfxManifest {
  readonly schema: 1;
  readonly effects: Readonly<Record<string, ReaderVfxAsset>>;
}

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a VFX asset object');
  return value as Record<string, unknown>;
};
const imagePath = (value: unknown): value is string => typeof value === 'string' && /^(?:\/?assets\/reader-vfx\/|[\w-]+\/)?[\w./-]+\.(?:png|webp)$/.test(value) && !value.includes('..');

/** Exact source references and validated local textures are required. A VAT,
 * noise or lookup image is never silently used as a screen sprite. */
export function validateReaderVfxManifest(raw: unknown): ReaderVfxManifest {
  const manifest = object(raw);
  if (manifest.schema !== 1) throw new Error('Reader VFX manifest schema 1 is required');
  for (const [sourceRef, value] of Object.entries(object(manifest.effects))) {
    const effect = object(value);
    if (!sourceRef.startsWith('/Game/') || effect.sourceRef !== sourceRef) throw new Error(`VFX source reference mismatch: ${sourceRef}`);
    if (!['OneShot', 'Persistent'].includes(String(effect.fxType))) throw new Error(`Invalid VFX type: ${sourceRef}`);
    if (typeof effect.sourceVerified !== 'boolean' || typeof effect.behaviorVerified !== 'boolean') throw new Error(`Missing VFX verification status: ${sourceRef}`);
    if (effect.readerRenderer !== undefined && !['danger', 'black', 'speed-line', 'speed-line-black', 'fog'].includes(String(effect.readerRenderer))) throw new Error(`Unknown Reader material projection: ${sourceRef}`);
    if (effect.durationMs !== null && (typeof effect.durationMs !== 'number' || !Number.isFinite(effect.durationMs) || effect.durationMs <= 0)) throw new Error(`Invalid VFX playback range: ${sourceRef}`);
    if (!Array.isArray(effect.images)) throw new Error(`Missing VFX texture list: ${sourceRef}`);
    for (const rawImage of effect.images) {
      const image = object(rawImage);
      if (!imagePath(image.url) || typeof image.sourceRef !== 'string' || !image.sourceRef.startsWith('/Game/')) throw new Error(`Invalid local VFX texture: ${sourceRef}`);
      if (!Number.isSafeInteger(image.width) || (image.width as number) <= 0 || !Number.isSafeInteger(image.height) || (image.height as number) <= 0 || !/^[a-f0-9]{64}$/.test(String(image.sha256))) throw new Error(`Unvalidated VFX texture: ${sourceRef}`);
      if (image.role !== undefined && !['sprite', 'mask', 'noise', 'vat', 'lookup'].includes(String(image.role))) throw new Error(`Unknown VFX texture role: ${sourceRef}`);
      for (const field of ['rows', 'columns']) if (image[field] !== undefined && (!Number.isSafeInteger(image[field]) || (image[field] as number) <= 0)) throw new Error(`Invalid VFX flipbook: ${sourceRef}`);
      if (image.atlasMode !== undefined && !['variants', 'flipbook'].includes(String(image.atlasMode))) throw new Error(`Invalid VFX atlas mode: ${sourceRef}`);
      if (image.cells !== undefined && (!Array.isArray(image.cells) || !image.cells.length || image.cells.some(cell => !Number.isSafeInteger(cell) || cell < 0 || cell >= Number(image.columns ?? 1) * Number(image.rows ?? 1)))) throw new Error(`Invalid VFX atlas cells: ${sourceRef}`);
    }
    if (effect.primaryImage != null && !effect.images.some(image => object(image).url === effect.primaryImage)) throw new Error(`VFX primary texture is not an exact dependency: ${sourceRef}`);
  }
  return freezeJson(structuredClone(manifest)) as unknown as ReaderVfxManifest;
}

export function readerVfxImage(effect: ReaderVfxAsset): ReaderVfxImage | null {
  const allowed = (image: ReaderVfxImage) => image.role === 'sprite' || image.role === 'mask' || effect.readerRenderer === 'fog' && image.role === 'noise';
  // Dependency masks/noise do not establish the prefab's visible sprite.
  // A procedural material needs its own renderer, not an arbitrary bitmap.
  return effect.images.find(image => image.url === effect.primaryImage && allowed(image)) ?? null;
}

export function readerVfxImageUrl(baseUrl: string, path: string): string {
  const local = path.replace(/^\//, '');
  return `${baseUrl}${local.startsWith('assets/reader-vfx/') ? local : `assets/reader-vfx/${local}`}`;
}

const textures = new Map<string, { image: HTMLImageElement; ready: Promise<void>; error: string | null }>();

export function readerVfxTexture(baseUrl: string, asset: ReaderVfxImage) {
  const url = readerVfxImageUrl(baseUrl, asset.url);
  let entry = textures.get(url);
  if (!entry) {
    const image = new Image();
    const next = { image, ready: Promise.resolve(), error: null as string | null };
    next.ready = new Promise<void>(resolve => {
      image.onload = () => {
        if (image.naturalWidth !== asset.width || image.naturalHeight !== asset.height) next.error = `Texture dimensions do not match source evidence: ${asset.sourceRef}`;
        image.onload = null; image.onerror = null; resolve();
      };
      image.onerror = () => { next.error = `Texture failed to load: ${asset.sourceRef}`; image.onload = null; image.onerror = null; resolve(); };
    });
    textures.set(url, next); image.src = url; entry = next;
  }
  return entry;
}

async function preload(manifest: ReaderVfxManifest, baseUrl: string): Promise<readonly string[]> {
  if (typeof Image === 'undefined') return [];
  const entries = Object.values(manifest.effects).flatMap(effect => {
    const asset = readerVfxImage(effect); return asset ? [readerVfxTexture(baseUrl, asset)] : [];
  });
  await Promise.all(entries.map(entry => entry.ready));
  return [...new Set(entries.flatMap(entry => entry.error ? [entry.error] : []))];
}

/** Asset evidence is optional for the engine; a failed asset catalog remains
 * an explicit diagnostic and never blocks dialogue, audio or Spine clocks. */
export async function loadReaderVfxAssets(baseUrl: string, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<{ manifest: ReaderVfxManifest | null; issues: readonly string[] }> {
  try {
    const response = await fetcher(`${baseUrl}assets/reader-vfx/manifest.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = validateReaderVfxManifest(await response.json());
    // Preload before stage entry: slow image decoding must not reverse the
    // visible order of two closely spaced authored cues.
    return { manifest, issues: await preload(manifest, baseUrl) };
  } catch (error) {
    return { manifest: null, issues: [`Reader VFX assets unavailable: ${String(error)}`] };
  }
}
