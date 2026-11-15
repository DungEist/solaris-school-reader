import { useMemo, useState } from 'react';
import { resolveBackground, resolveCG } from '../assets/AssetResolver.ts';
import type { ResolvedVisualAsset } from '../assets/AssetResolver.ts';
import type { VisualAssets } from '../assets/VisualAssets.ts';
import type { EnglishCatalog } from '../data/EnglishScriptRepository.ts';
import type { StageState } from '../engine/StageState.ts';
import { staticStagePresentation } from '../engine/StageTransitions.ts';
import type { StagePresentation } from '../engine/StageTransitions.ts';
import type { PlayerTextProfile } from '../text/EnglishText.ts';
import { characterName } from './CharacterPlaceholder.tsx';
import { SchoolCharacterStage } from './SchoolCharacterStage.tsx';
import { schoolAssetsForGender } from '../spine/SchoolRover.ts';
import { readerCGFraming } from './StageImageFraming.ts';
import { ReaderVfx } from './ReaderVfx.tsx';
import { emptyStageEffects } from '../engine/StageEffects.ts';
import type { StageEffectsSnapshot } from '../engine/StageEffects.ts';

interface Props {
  state: StageState;
  presentation?: StagePresentation;
  effects?: StageEffectsSnapshot;
  assets: VisualAssets;
  catalog: EnglishCatalog | null;
  profile: PlayerTextProfile;
  backgroundVariant: 'day' | 'night';
  failedUrls: ReadonlySet<string>;
  onImageError(asset: ResolvedVisualAsset): void;
  diagnostics?: boolean;
}

/** A URL is rendered only after exact-reference cache validation. onError
 * replaces broken files with the same non-blocking, labeled fallback. */
function AssetImage({ asset, className, failedUrls, onImageError, diagnostics = true }: { asset: ResolvedVisualAsset; className: string; failedUrls: ReadonlySet<string>; onImageError(asset: ResolvedVisualAsset): void; diagnostics?: boolean }) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const reason = asset.url && failedUrls.has(asset.url) ? 'Cached image failed to load or decode.' : asset.reason;
  return (
    <div className={`stage-image-layer ${className}`} data-testid={`${asset.kind}-layer`} data-asset-id={asset.id} data-variant={asset.variant} data-asset-path={asset.repositoryPath ?? ''} data-reader-framing={readerCGFraming(asset)}>
      {asset.url && !reason ? (
        <img key={asset.url} src={asset.url} alt={diagnostics ? asset.label : asset.kind === 'background' ? 'Scene background' : 'Scene illustration'} draggable={false} onLoad={event => { if (event.currentTarget.naturalWidth > 0) setLoadedUrl(asset.url); }} onError={() => onImageError(asset)} data-testid={`${asset.kind}-image`} data-loaded={loadedUrl === asset.url} />
      ) : (
        <div className="asset-fallback" role="img" aria-label={diagnostics ? `${asset.label} unavailable` : 'Scene image unavailable'} data-testid="asset-fallback" data-kind={asset.kind}>
          <strong>{diagnostics ? `${asset.label} unavailable` : 'Scene image unavailable'}</strong>
          {diagnostics && <span>{reason ?? 'No validated image is available.'}</span>}
        </div>
      )}
    </div>
  );
}

/** This component only projects persistent engine state. It never consumes
 * stage events or executes lifecycle operations, even during React rerenders. */
export function VisualStage({ state, presentation = staticStagePresentation(state), effects = emptyStageEffects(), assets, catalog, profile, backgroundVariant, failedUrls, onImageError, diagnostics = true }: Props) {
  const characterAssets = useMemo(() => schoolAssetsForGender(assets, profile.gender), [assets, profile.gender]);
  const background = state.background ? resolveBackground(assets, state.background.id, backgroundVariant) : null;
  const cg = state.cg?.kind === 'image' ? resolveCG(assets, state.cg.id, profile.gender) : null;
  const avatars = presentation.characters.filter(view => (view.character.avatarVisible || view.avatarOpacity > 0) && !view.character.portraitVisible && view.portraitOpacity <= 0);
  return (
    <div className="visual-stage" aria-label="Visual stage" data-testid="visual-stage" data-background-id={state.background?.id ?? ''} data-cg-id={state.cg?.id ?? ''} data-cg-kind={state.cg?.kind ?? ''} data-applied-events={state.appliedEvents} data-active-transitions={presentation.transitions.length}>
      {background ? <AssetImage asset={background} className="background-layer" failedUrls={failedUrls} onImageError={onImageError} diagnostics={diagnostics} /> : <div className="stage-empty">{diagnostics ? 'No background set' : ''}</div>}
      <div className="character-layer" aria-hidden={!!state.cg}>
        <SchoolCharacterStage state={state} views={presentation.characters} assets={characterAssets} catalog={catalog} profile={profile} diagnostics={diagnostics} />
        {diagnostics && avatars.length > 0 && <div className="avatar-placeholders">
          {avatars.map(view => <span key={view.character.who} style={{ opacity: view.avatarOpacity }} data-testid="avatar-placeholder" data-who={view.character.who} data-opacity={view.avatarOpacity.toFixed(4)} title={diagnostics ? `Expression ${view.character.expression ?? 'unspecified'} · portrait hidden` : undefined}>
            {diagnostics ? `${characterName(view.character.who, catalog, profile)} · ${view.character.who} · expr ${view.character.expression ?? '—'}` : characterName(view.character.who, catalog, profile, false)}
          </span>)}
        </div>}
      </div>
      {cg && <AssetImage asset={cg} className="cg-layer" failedUrls={failedUrls} onImageError={onImageError} diagnostics={diagnostics} />}
      {state.cg?.kind === 'prefab' && <div className="stage-image-layer cg-layer"><div className="asset-fallback" role="img" aria-label={diagnostics ? 'Unsupported CG prefab' : 'Scene illustration unavailable'} data-testid="cg-prefab-fallback">
        <strong>{diagnostics ? 'Unsupported CG prefab' : 'Scene illustration unavailable'}</strong>{diagnostics && <span>LoadPrefab is unsupported. Its source configuration is retained in debug.</span>}
      </div></div>}
      {effects.active.some(effect => effect.target === 'screen') && <ReaderVfx effects={effects} assets={assets} />}
      <div className="stage-blackout" aria-hidden="true" data-testid="black-screen" data-opacity={presentation.blackOpacity.toFixed(4)} style={{ opacity: presentation.blackOpacity }} />
      {diagnostics && <div className="stage-caption">
        <span>{background ? `${background.label}${background.reason || (background.url && failedUrls.has(background.url)) ? ' unavailable' : ''}` : 'Background —'}</span>
        {cg && <span>{cg.label}{cg.reason || (cg.url && failedUrls.has(cg.url)) ? ' unavailable' : ''}</span>}
        {state.cg?.kind === 'prefab' && <span>CG prefab (deferred)</span>}
      </div>}
    </div>
  );
}
