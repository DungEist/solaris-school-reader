import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { VisualAssets } from '../assets/VisualAssets.ts';
import type { EnglishCatalog } from '../data/EnglishScriptRepository.ts';
import type { StageState } from '../engine/StageState.ts';
import type { PresentedCharacter } from '../engine/StageTransitions.ts';
import { resolveChangli } from '../spine/ChangliAssets.ts';
import { ChangliStageAdapter } from '../spine/ChangliStageAdapter.ts';
import type { ChangliRendererStatuses } from '../spine/ChangliStageAdapter.ts';
import type { PlayerTextProfile } from '../text/EnglishText.ts';
import { CharacterPlaceholder } from './CharacterPlaceholder.tsx';
import { changliSpineProfile, createChangliScene } from '../spine/ChangliSpineScene.ts';
import { sourcePortraitProfile } from '../spine/SourcePortraitPlacement.ts';

interface Props {
  state: StageState;
  views: readonly PresentedCharacter[];
  assets: VisualAssets;
  catalog: EnglishCatalog | null;
  profile: PlayerTextProfile;
  renderPlaceholders?: boolean;
  showPlacementNote?: boolean;
  onStatuses?(statuses: ChangliRendererStatuses): void;
  diagnostics?: boolean;
  composition?: 'stage' | 'avatar';
}

/** One stage canvas/context; each persistent entry has its own stable skeleton.
 * React snapshots update presentation, not animation construction or clocks. */
export function ChangliStage({ state, views, assets, catalog, profile, renderPlaceholders = true, showPlacementNote = true, onStatuses, diagnostics = true, composition = 'stage' }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const adapter = useRef<ChangliStageAdapter | null>(null);
  const [statuses, setStatuses] = useState<ChangliRendererStatuses>({});
  const sourcePlacement = assets.manifest.talkers?.['850006']?.portraitTransform;
  const portraitProfile = useMemo(() => composition === 'avatar' ? { ...changliSpineProfile, canvasTopOverscan: true } : sourcePortraitProfile(changliSpineProfile, sourcePlacement), [composition, sourcePlacement]);
  useLayoutEffect(() => {
    const instance = new ChangliStageAdapter(canvas.current!, { createScene: (target, resources) => createChangliScene(target, resources, {}, portraitProfile), onStatus: value => { setStatuses(value); onStatuses?.(value); } });
    adapter.current = instance;
    instance.sync(state, views, assets);
    return () => { instance.dispose(); adapter.current = null; };
  }, [portraitProfile]);
  useLayoutEffect(() => { adapter.current?.sync(state, views, assets); }, [state, views, assets]);
  const ready = views.filter(view => statuses[view.character.who]?.kind === 'ready' && resolveChangli(view.character, assets).kind === 'changli');
  const visible = ready.filter(view => view.portraitOpacity > 0);
  return <>
    <canvas ref={canvas} className="changli-spine-canvas" aria-hidden="true" title={diagnostics ? 'Changli · WebP-derived PNG · provisional placement' : undefined} data-testid="changli-canvas" data-renderer-state={visible.length ? 'ready' : 'empty'} data-instance-whos={ready.map(view => view.character.who).join(',')} data-rendered-whos={visible.map(view => view.character.who).join(',')} data-expressions={visible.map(view => view.character.expression).join(',')} data-calibration="provisional" data-texture-origin="WebP-derived PNG; not a game export" />
    {renderPlaceholders && views.filter(view => view.character.portraitVisible || view.portraitOpacity > 0).map(view => {
      const resolution = resolveChangli(view.character, assets);
      const status = statuses[view.character.who];
      if (resolution.kind === 'changli' && status?.kind === 'ready') return null;
      const changli = resolution.kind !== 'other' || status?.kind === 'fallback';
      const reason = resolution.kind === 'fallback' ? resolution.reason : status?.reason ?? (resolution.kind === 'changli' ? 'Loading local Changli portrait…' : undefined);
      return <CharacterPlaceholder key={view.character.who} view={view} assets={assets} catalog={catalog} profile={profile} changli={changli} reason={reason} />;
    })}
    {showPlacementNote && visible.length > 0 && <span className="changli-placement-note">Changli · provisional placement</span>}
  </>;
}
