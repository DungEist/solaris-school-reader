import type { Metadata } from '../engine/types.ts';
import type { ReaderVfxManifest } from './ReaderVfxAssets.ts';

export interface BackgroundAsset {
  readonly label?: string | null;
  readonly day?: string | null;
  readonly night?: string | null;
}

export interface CGAsset {
  readonly label?: string | null;
  readonly path?: string | null;
  readonly pathMale?: string | null;
}

export interface QuizIllustrationAsset {
  readonly label?: string | null;
  readonly path?: string | null;
}

export interface ExpressionAsset extends Metadata {
  readonly talkerId: number | null;
  readonly label?: string | null;
  readonly body?: string | null;
  readonly mouth?: string | null;
  readonly eye?: string | null;
}

export interface TalkerAsset extends Metadata {
  readonly name?: string | null;
  readonly spineSource?: string | null;
  readonly spineAtlas?: string | null;
  readonly spineSkeleton?: string | null;
  readonly defaultExpressionId?: number | null;
  readonly portraitTexture?: string | null;
}

export interface VisualAssetManifest {
  readonly backgrounds: Readonly<Record<string, BackgroundAsset>>;
  readonly cgs: Readonly<Record<string, CGAsset>>;
  readonly expressions: Readonly<Record<string, ExpressionAsset>>;
  readonly talkers?: Readonly<Record<string, TalkerAsset>>;
  readonly quizzes?: Readonly<Record<string, QuizIllustrationAsset>>;
}

export interface CachedAsset {
  readonly sourceRef: string | null;
  readonly repositoryPath: string | null;
  readonly status: 'ready' | 'missing' | 'unverified';
  readonly localPath: string | null;
  readonly sha256?: string;
  readonly width?: number;
  readonly height?: number;
  readonly reason?: string;
  readonly validation?: string;
}

export interface VisualAssetMap {
  readonly schema: 1;
  readonly source: Metadata;
  readonly backgrounds: Readonly<Record<string, { readonly label?: string | null; readonly day: CachedAsset; readonly night: CachedAsset }>>;
  readonly cgs: Readonly<Record<string, { readonly label?: string | null; readonly female: CachedAsset; readonly male: CachedAsset; readonly maleUsesBase?: boolean }>>;
  readonly quizzes?: Readonly<Record<string, { readonly label?: string | null; readonly question: CachedAsset }>>;
  readonly report?: { readonly uniqueReferencedFiles: number; readonly readyFiles: number };
}

export interface VisualAssets {
  readonly manifest: VisualAssetManifest;
  readonly mapping: VisualAssetMap | null;
  readonly baseUrl: string;
  readonly issues: readonly string[];
  readonly vfx?: ReaderVfxManifest | null;
}

export interface RuntimeAssetIssue {
  readonly url: string;
  readonly label: string;
  readonly reason: string;
}

export const emptyVisualAssets: VisualAssets = Object.freeze({
  manifest: Object.freeze({ backgrounds: Object.freeze({}), cgs: Object.freeze({}), expressions: Object.freeze({}) }),
  mapping: null, baseUrl: '', issues: Object.freeze([]),
});
