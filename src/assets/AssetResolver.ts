import type { CachedAsset, VisualAssets } from './VisualAssets.ts';

export const solarImageRoot = 'UIResources/Common/Image/BgCgBig/Activity/Activity38/SolarSchool/';
export const solarQuizImageRoot = 'UIResources/UiActivity/Image/Activity38/SolarSchool/IconExam/';

/** Convert a UE package reference to a candidate path, never a presumed URL. */
export function ueReferenceWebpPath(reference: string): string | null {
  return imagePathWithin(reference, solarImageRoot);
}

export function ueQuizIllustrationWebpPath(reference: string): string | null {
  return imagePathWithin(reference, solarQuizImageRoot);
}

function imagePathWithin(reference: string, root: string): string | null {
  const prefix = '/Game/Aki/UI/';
  if (!reference.startsWith(prefix)) return null;
  const path = reference.slice(prefix.length);
  const slash = path.lastIndexOf('/');
  if (slash < 0) return null;
  const file = path.slice(slash + 1).split('.')[0];
  const result = `${path.slice(0, slash + 1)}${file}.webp`;
  return file && result.startsWith(root) && /^[A-Za-z0-9_/-]+\.webp$/.test(result) && !result.includes('//') ? result : null;
}

export interface ResolvedVisualAsset {
  readonly kind: 'background' | 'cg' | 'quiz';
  readonly id: number;
  readonly variant: 'day' | 'night' | 'male' | 'female' | 'question';
  readonly label: string;
  readonly sourceLabel: string | null;
  readonly url: string | null;
  readonly repositoryPath: string | null;
  readonly reason: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

function resolve(assets: VisualAssets, kind: ResolvedVisualAsset['kind'], id: number, variant: ResolvedVisualAsset['variant'], reference: string | null | undefined, entry: CachedAsset | undefined, sourceLabel: string | null | undefined): ResolvedVisualAsset {
  const repositoryPath = reference ? (kind === 'quiz' ? ueQuizIllustrationWebpPath(reference) : ueReferenceWebpPath(reference)) : null;
  const label = kind === 'cg' ? 'CG' : kind === 'quiz' ? 'Quiz illustration' : 'Background';
  let reason: string | null = null;
  let url: string | null = null;
  if (!reference) reason = `No ${variant} asset reference for ${kind} ${id}.`;
  else if (!repositoryPath) reason = `The ${kind} reference is not a supported SolarSchool image path.`;
  else if (!entry || entry.status !== 'ready') reason = entry?.reason ?? `${label} ${id} (${variant}) has not been validated and cached.`;
  else if (entry.repositoryPath !== repositoryPath || entry.sourceRef !== reference || entry.localPath !== `media/${repositoryPath}`) reason = `The cached mapping does not match the ${variant} source reference.`;
  else if (!entry.sha256 || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.width) || (entry.width ?? 0) <= 0 || !Number.isSafeInteger(entry.height) || (entry.height ?? 0) <= 0) reason = 'The cached mapping is missing image validation metadata.';
  else url = `${assets.baseUrl}${entry.localPath}`;
  return Object.freeze({
    kind, id, variant, label: `${label} ${id} (${variant})`,
    sourceLabel: sourceLabel ?? null, url, repositoryPath, reason,
    width: entry?.width ?? null, height: entry?.height ?? null,
  });
}

export function resolveBackground(assets: VisualAssets, id: number, variant: 'day' | 'night' = 'day'): ResolvedVisualAsset {
  const source = assets.manifest.backgrounds[String(id)];
  return resolve(assets, 'background', id, variant, source?.[variant], assets.mapping?.backgrounds[String(id)]?.[variant], source?.label);
}

export function resolveCG(assets: VisualAssets, id: number, gender: 'male' | 'female'): ResolvedVisualAsset {
  const source = assets.manifest.cgs[String(id)];
  const reference = gender === 'male' ? source?.pathMale || source?.path : source?.path;
  return resolve(assets, 'cg', id, gender, reference, assets.mapping?.cgs[String(id)]?.[gender], source?.label);
}

export function resolveQuizIllustration(assets: VisualAssets, id: number, reference: string | null): ResolvedVisualAsset {
  const source = assets.manifest.quizzes?.[String(id)];
  return resolve(assets, 'quiz', id, 'question', reference, assets.mapping?.quizzes?.[String(id)]?.question, source?.label);
}

/** Expressions identify talkers. Stage who and dialogue speaker IDs never do. */
export function expressionTalker(assets: VisualAssets, expression: number | null): number | null {
  return expression === null ? null : assets.manifest.expressions[String(expression)]?.talkerId ?? null;
}
