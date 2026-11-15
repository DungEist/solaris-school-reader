import { freezeJson } from '../engine/validation.ts';
import { emptyVisualAssets } from './VisualAssets.ts';
import type { VisualAssetManifest, VisualAssetMap, VisualAssets } from './VisualAssets.ts';

type Fetcher = (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: expected an object`);
  return value as Record<string, unknown>;
}

function nullableString(value: unknown, path: string): void {
  if (value != null && typeof value !== 'string') throw new Error(`${path}: expected a string or null`);
}

export function validateVisualManifest(raw: unknown): VisualAssetManifest {
  const manifest = object(raw, 'assets.manifest.json');
  for (const [kind, fields] of [['backgrounds', ['label', 'day', 'night']], ['cgs', ['label', 'path', 'pathMale']], ['quizzes', ['label', 'path']]] as const) {
    for (const [id, raw] of Object.entries(object(kind === 'quizzes' ? manifest[kind] ?? {} : manifest[kind], `assets.manifest.json.${kind}`))) {
      const asset = object(raw, `${kind}.${id}`);
      for (const field of fields) nullableString(asset[field], `${kind}.${id}.${field}`);
    }
  }
  for (const [id, raw] of Object.entries(object(manifest.expressions ?? {}, 'assets.manifest.json.expressions'))) {
    const expression = object(raw, `expressions.${id}`);
    if (expression.talkerId !== null && !Number.isSafeInteger(expression.talkerId)) throw new Error(`expressions.${id}.talkerId: expected an integer or null`);
  }
  for (const [id, raw] of Object.entries(object(manifest.talkers ?? {}, 'assets.manifest.json.talkers'))) {
    const talker = object(raw, `talkers.${id}`);
    for (const field of ['name', 'spineSource', 'spineAtlas', 'spineSkeleton']) nullableString(talker[field], `talkers.${id}.${field}`);
  }
  return freezeJson(structuredClone({ backgrounds: manifest.backgrounds, cgs: manifest.cgs, expressions: manifest.expressions ?? {}, talkers: manifest.talkers ?? {}, quizzes: manifest.quizzes ?? {} })) as VisualAssetManifest;
}

export function validateVisualMap(raw: unknown): VisualAssetMap {
  const map = object(raw, 'asset-map.json');
  if (map.schema !== 1) throw new Error('asset-map.json: asset map schema 1 is required');
  object(map.source, 'asset-map.json.source');
  for (const [kind, variants] of [['backgrounds', ['day', 'night']], ['cgs', ['female', 'male']], ['quizzes', ['question']]] as const) {
    for (const [id, raw] of Object.entries(object(kind === 'quizzes' ? map[kind] ?? {} : map[kind], `asset-map.json.${kind}`))) {
      const asset = object(raw, `${kind}.${id}`);
      for (const variant of variants) {
        const entry = object(asset[variant], `${kind}.${id}.${variant}`);
        if (!['ready', 'missing', 'unverified'].includes(String(entry.status))) throw new Error(`${kind}.${id}.${variant}: unknown cache status`);
        for (const field of ['sourceRef', 'repositoryPath', 'localPath', 'reason']) nullableString(entry[field], `${kind}.${id}.${variant}.${field}`);
        if (entry.status === 'ready') {
          if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`${kind}.${id}.${variant}: missing SHA-256 validation`);
          if (!Number.isSafeInteger(entry.width) || (entry.width as number) <= 0 || !Number.isSafeInteger(entry.height) || (entry.height as number) <= 0) throw new Error(`${kind}.${id}.${variant}: invalid image dimensions`);
        }
      }
    }
  }
  return freezeJson(structuredClone(map)) as unknown as VisualAssetMap;
}

/** Asset failures are isolated from script loading and never block playback. */
export class VisualAssetRepository {
  private readonly dataUrl: string;
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private promise: Promise<VisualAssets> | null = null;

  constructor(dataUrl: string, baseUrl: string, fetcher: Fetcher = url => globalThis.fetch(url)) {
    this.dataUrl = dataUrl.endsWith('/') ? dataUrl : `${dataUrl}/`;
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.fetcher = fetcher;
  }

  load(): Promise<VisualAssets> {
    return this.promise ??= this.readAssets();
  }

  private async json(url: string): Promise<unknown> {
    const response = await this.fetcher(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return await response.json();
  }

  private async readAssets(): Promise<VisualAssets> {
    const [source, cached] = await Promise.allSettled([
      this.json(`${this.dataUrl}assets.manifest.json`), this.json(`${this.baseUrl}asset-map.json`),
    ]);
    const issues: string[] = [];
    let manifest = emptyVisualAssets.manifest;
    let mapping: VisualAssetMap | null = null;
    try {
      if (source.status === 'rejected') throw source.reason;
      manifest = validateVisualManifest(source.value);
    } catch (error) { issues.push(`Asset manifest unavailable: ${String(error)}`); }
    try {
      if (cached.status === 'rejected') throw cached.reason;
      mapping = validateVisualMap(cached.value);
    } catch (error) { issues.push(`Asset cache map unavailable: ${String(error)}`); }
    return Object.freeze({ manifest, mapping, baseUrl: this.baseUrl, issues: Object.freeze(issues) });
  }
}
