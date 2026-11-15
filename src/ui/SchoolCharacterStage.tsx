import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { VisualAssets } from '../assets/VisualAssets.ts';
import type { EnglishCatalog } from '../data/EnglishScriptRepository.ts';
import type { StageState } from '../engine/StageState.ts';
import type { PresentedCharacter } from '../engine/StageTransitions.ts';
import { resolveChangli } from '../spine/ChangliAssets.ts';
import type { ChangliRendererStatuses } from '../spine/ChangliStageAdapter.ts';
import { schoolPortraits, resolveSchoolPortrait } from '../spine/SchoolPortraitAssets.ts';
import type { SchoolPortraitDefinition } from '../spine/SchoolPortraitAssets.ts';
import { SchoolPortraitStageAdapter } from '../spine/SchoolPortraitStageAdapter.ts';
import type { PlayerTextProfile } from '../text/EnglishText.ts';
import { ChangliStage } from './ChangliStage.tsx';
import { CharacterPlaceholder } from './CharacterPlaceholder.tsx';
import { resolveSchoolStaticPortrait } from '../spine/SchoolStaticPortraitAssets.ts';
import { SchoolStaticPortrait } from './SchoolStaticPortrait.tsx';
import { sourcePortraitProfile } from '../spine/SourcePortraitPlacement.ts';

interface Props {
  state: StageState;
  views: readonly PresentedCharacter[];
  assets: VisualAssets;
  catalog: EnglishCatalog | null;
  profile: PlayerTextProfile;
  diagnostics?: boolean;
  composition?: 'stage' | 'avatar';
  renderPlaceholders?: boolean;
}

function SchoolPortraitCanvas({ state, views, assets, definition, onStatuses, diagnostics = true, composition = 'stage' }: Pick<Props, 'state' | 'views' | 'assets' | 'diagnostics' | 'composition'> & { definition: SchoolPortraitDefinition; onStatuses(statuses: ChangliRendererStatuses): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const adapter = useRef<SchoolPortraitStageAdapter | null>(null);
  const [statuses, setStatuses] = useState<ChangliRendererStatuses>({});
  const sourcePlacement = assets.manifest.talkers?.[String(definition.talkerId)]?.portraitTransform;
  const stageProfile = useMemo(() => sourcePortraitProfile(definition.profile, sourcePlacement), [definition, sourcePlacement]);
  useLayoutEffect(() => {
    const instance = new SchoolPortraitStageAdapter(canvas.current!, definition, { composition, stageProfile, onStatus: value => { setStatuses(value); onStatuses(value); } });
    adapter.current = instance;
    instance.sync(state, views, assets);
    return () => { instance.dispose(); adapter.current = null; onStatuses({}); };
  }, [definition, composition, stageProfile]);
  useLayoutEffect(() => { adapter.current?.sync(state, views, assets); }, [state, views, assets]);
  const ready = views.filter(view => statuses[view.character.who]?.kind === 'ready' && resolveSchoolPortrait(view.character, assets, definition, composition).kind === 'spine');
  const visible = ready.filter(view => view.portraitOpacity > 0);
  const calibration = composition === 'avatar' ? definition.avatarProfile?.calibration ?? definition.profile.calibration : stageProfile.calibration;
  return <canvas ref={canvas} className="school-spine-canvas" aria-hidden="true" title={diagnostics ? `${definition.name} · ${calibration.provisional ? 'provisional' : 'reference-calibrated'} placement` : undefined} data-testid={`${definition.slug}-canvas`} data-renderer-state={visible.length ? 'ready' : 'empty'} data-renderer-issues={Object.values(statuses).flatMap(status => status.reason ? [status.reason] : []).join('|')} data-instance-whos={ready.map(view => view.character.who).join(',')} data-rendered-whos={visible.map(view => view.character.who).join(',')} data-expressions={visible.map(view => view.character.expression).join(',')} data-composition={composition} data-horizontal-facing={composition === 'avatar' ? definition.avatarFacing ?? 1 : 1} data-calibration={calibration.provisional ? 'provisional' : 'source-reference'} data-texture-origin={definition.textureFile?.endsWith('.webp') ? 'Existing WebP; not a game texture export' : 'WebP-derived PNG; not a game export'} />;
}

/** Independent character resources/calibrations share the existing stage
 * presentation. One fallback list preserves unsupported characters/avatars. */
export function SchoolCharacterStage(props: Props) {
  const { state, views, assets, catalog, profile, diagnostics = true, composition = 'stage', renderPlaceholders = true } = props;
  const [changli, setChangli] = useState<ChangliRendererStatuses>({});
  const [portraits, setPortraits] = useState<Readonly<Record<string, ChangliRendererStatuses>>>({});
  const candidates = (view: PresentedCharacter) => [
    { name: 'Changli', resolution: resolveChangli(view.character, assets), status: changli[view.character.who] },
    ...schoolPortraits.map(definition => ({ name: definition.name, resolution: resolveSchoolPortrait(view.character, assets, definition, composition), status: portraits[definition.slug]?.[view.character.who] })),
  ];
  const visibleNames = new Set(views.filter(view => view.portraitOpacity > 0).flatMap(view => {
    const texture = resolveSchoolStaticPortrait(view.character, assets, catalog);
    return [...candidates(view).filter(item => item.resolution.kind !== 'other' && item.status?.kind === 'ready').map(item => item.name), ...(texture.kind === 'texture' ? [texture.definition.name] : [])];
  }));
  return <>
    <ChangliStage {...props} renderPlaceholders={false} showPlacementNote={false} onStatuses={setChangli} />
    {schoolPortraits.filter(definition => views.some(view => (view.character.present || view.portraitOpacity > 0) && resolveSchoolPortrait(view.character, assets, definition, composition).kind !== 'other')).map(definition =>
      <SchoolPortraitCanvas key={definition.slug} state={state} views={views} assets={assets} definition={definition} diagnostics={diagnostics} composition={composition}
        onStatuses={value => setPortraits(previous => ({ ...previous, [definition.slug]: value }))} />)}
    {views.filter(view => view.character.portraitVisible || view.portraitOpacity > 0).map(view => {
      const texture = resolveSchoolStaticPortrait(view.character, assets, catalog);
      if (texture.kind === 'texture') return <SchoolStaticPortrait key={`${state.runId}:${view.character.who}:${view.character.entrySequence}`} view={view} definition={texture.definition} url={texture.url} assets={assets} catalog={catalog} profile={profile} diagnostics={diagnostics} renderPlaceholders={renderPlaceholders} />;
      const possible = candidates(view);
      const item = possible.find(candidate => candidate.resolution.kind !== 'other') ?? possible.find(candidate => candidate.status?.kind === 'fallback');
      if (item && item.resolution.kind !== 'other' && item.resolution.kind !== 'fallback' && item.status?.kind === 'ready') return null;
      if (!renderPlaceholders) return null;
      const reason = item?.resolution.kind === 'fallback' ? item.resolution.reason : item?.status?.reason ?? (item ? `Loading local ${item.name} portrait…` : texture.kind === 'fallback' ? texture.reason : undefined);
      return <CharacterPlaceholder key={view.character.who} view={view} assets={assets} catalog={catalog} profile={profile} changli={item?.name === 'Changli'} portraitName={item?.name ?? (texture.kind === 'fallback' ? texture.name : undefined)} talkerId={texture.kind === 'fallback' ? texture.talkerId : undefined} reason={reason} diagnostics={diagnostics} />;
    })}
    {diagnostics && visibleNames.size > 0 && <span className="changli-placement-note">{[...visibleNames].join(', ')} · provisional placement</span>}
  </>;
}
