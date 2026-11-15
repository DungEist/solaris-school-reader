import { ueReferenceWebpPath } from '../src/assets/AssetResolver.ts';
import type { CachedAsset, VisualAssets } from '../src/assets/VisualAssets.ts';

export function sourceRef(folder: string, name: string): string {
  return `/Game/Aki/UI/UIResources/Common/Image/BgCgBig/Activity/Activity38/SolarSchool/${folder}/${name}.${name}`;
}

export function cached(reference: string): CachedAsset {
  const repositoryPath = ueReferenceWebpPath(reference)!;
  return { sourceRef: reference, repositoryPath, status: 'ready', localPath: `media/${repositoryPath}`, sha256: 'a'.repeat(64), width: 1280, height: 720, validation: 'fixture' };
}

/** Image metadata fixtures are for unit renders, never substituted for real assets. */
export function visualFixture(): VisualAssets {
  const day = sourceRef('Bg', 'Day'); const night = sourceRef('Bg', 'Night');
  const female = sourceRef('CG', 'Female'); const male = sourceRef('CG', 'Male');
  return {
    manifest: {
      backgrounds: { '10': { day, night } }, cgs: { '20': { path: female, pathMale: male }, '21': { path: female, pathMale: null } },
      expressions: { '701': { talkerId: 800, label: 'Normal' }, '702': { talkerId: 801, label: 'Happy' } },
    },
    mapping: { schema: 1, source: { repository: 'fixture' }, backgrounds: { '10': { day: cached(day), night: cached(night) } }, cgs: {
      '20': { female: cached(female), male: cached(male) }, '21': { female: cached(female), male: cached(female), maleUsesBase: true },
    } },
    baseUrl: '/assets/solarschool/', issues: [],
  };
}
