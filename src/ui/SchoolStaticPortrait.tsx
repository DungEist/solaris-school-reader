import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { VisualAssets } from '../assets/VisualAssets.ts';
import type { EnglishCatalog } from '../data/EnglishScriptRepository.ts';
import { characterCoordinates } from '../engine/StageCoordinates.ts';
import type { PresentedCharacter } from '../engine/StageTransitions.ts';
import type { SchoolStaticPortraitDefinition } from '../spine/SchoolStaticPortraitAssets.ts';
import type { PlayerTextProfile } from '../text/EnglishText.ts';
import { CharacterPlaceholder } from './CharacterPlaceholder.tsx';

/** The source NPC image is already a portrait. Use it directly, sharing the
 * existing presentation offsets/scale/opacity and entry lifecycle. */
export function SchoolStaticPortrait({ view, definition, url, assets, catalog, profile, diagnostics = true, renderPlaceholders = true }: {
  view: PresentedCharacter; definition: SchoolStaticPortraitDefinition; url: string;
  assets: VisualAssets; catalog: EnglishCatalog | null; profile: PlayerTextProfile; diagnostics?: boolean; renderPlaceholders?: boolean;
}) {
  const [result, setResult] = useState<{ url: string; kind: 'ready' | 'failed' } | null>(null);
  const ready = result?.url === url && result.kind === 'ready';
  const failed = result?.url === url && result.kind === 'failed';
  const coordinates = characterCoordinates(view.position);
  const style: CSSProperties = {
    left: `${coordinates.leftPercent}%`, bottom: `${coordinates.bottomPercent}%`,
    height: `${definition.heightFraction * 100}%`,
    transform: `translateX(-50%) scale(${coordinates.scale})`,
    opacity: ready ? view.portraitOpacity : 0,
    filter: `brightness(${view.brightness ?? (view.character.effect === 'Darken' ? .58 : 1)})`,
  };
  return <>
    {!failed && <img key={url} className="school-static-portrait" src={url} alt={definition.name} draggable={false} style={style}
      data-testid="npc-portrait" data-who={view.character.who} data-talker={definition.talkerId}
      data-expression={view.character.expression ?? ''} data-renderer-state={ready ? 'ready' : 'loading'}
      data-visual-position={view.position.join(',')} data-opacity={view.portraitOpacity.toFixed(4)} data-calibration="provisional"
      onLoad={event => setResult({ url, kind: event.currentTarget.naturalWidth === definition.width && event.currentTarget.naturalHeight === definition.height ? 'ready' : 'failed' })}
      onError={() => setResult({ url, kind: 'failed' })} />}
    {!ready && renderPlaceholders && <CharacterPlaceholder view={view} assets={assets} catalog={catalog} profile={profile} diagnostics={diagnostics}
      portraitName={definition.name} talkerId={definition.talkerId} assetKind="image"
      reason={failed ? `${definition.name}: the source portrait image failed to load or has incompatible dimensions.` : `Loading local ${definition.name} portrait…`} />}
  </>;
}
