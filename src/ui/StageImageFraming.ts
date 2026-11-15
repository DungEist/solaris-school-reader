import type { ResolvedVisualAsset } from '../assets/AssetResolver.ts';

/** The original game's 700006 capture matches centered height fitting of the
 * 3200x1440 SolarSchool CG family. Keep other formats proportionate with
 * contain; a wide illustration's side overscan is never a stretch. */
export function readerCGFraming(asset: Pick<ResolvedVisualAsset, 'kind' | 'repositoryPath' | 'width' | 'height'>): 'height-fit' | 'contain' {
  return asset.kind === 'cg' && asset.width === 3200 && asset.height === 1440 &&
    asset.repositoryPath?.includes('/Activity38/SolarSchool/CG/') ? 'height-fit' : 'contain';
}
