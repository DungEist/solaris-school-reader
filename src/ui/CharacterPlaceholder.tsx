import type { CSSProperties } from 'react';
import { expressionTalker } from '../assets/AssetResolver.ts';
import type { VisualAssets } from '../assets/VisualAssets.ts';
import type { EnglishCatalog } from '../data/EnglishScriptRepository.ts';
import { characterCoordinates } from '../engine/StageCoordinates.ts';
import type { PresentedCharacter } from '../engine/StageTransitions.ts';
import { englishText } from '../text/EnglishText.ts';
import type { PlayerTextProfile } from '../text/EnglishText.ts';

export function characterName(who: string, catalog: EnglishCatalog | null, profile: PlayerTextProfile, diagnostics = true): string {
  const key = catalog?.speakers[who]?.nameKey;
  return key && catalog?.english[key] ? englishText(key, catalog.english, profile) : diagnostics ? `Character ${who}` : 'Character';
}

export function CharacterPlaceholder({ view, assets, catalog, profile, reason, changli = false, portraitName, talkerId, assetKind, diagnostics = true }: {
  view: PresentedCharacter; assets: VisualAssets; catalog: EnglishCatalog | null; profile: PlayerTextProfile; reason?: string; changli?: boolean; portraitName?: string; talkerId?: number; assetKind?: 'image' | 'spine'; diagnostics?: boolean;
}) {
  const character = view.character;
  const sourceTalker = talkerId ?? expressionTalker(assets, character.expression);
  const coordinates = characterCoordinates(view.position);
  const style: CSSProperties = {
    left: `${coordinates.leftPercent}%`, bottom: `${coordinates.bottomPercent}%`,
    transform: `translateX(-50%) scale(${coordinates.scale})`, opacity: view.portraitOpacity,
    filter: `brightness(${view.brightness ?? (view.character.effect === 'Darken' ? .58 : 1)})`,
  };
  return (
    <div className={`character-placeholder effect-${character.effect ?? 'none'}`} style={style} data-testid="character-placeholder" data-who={character.who} data-expression={character.expression ?? ''} data-talker={sourceTalker ?? ''} data-present={character.present} data-opacity={view.portraitOpacity.toFixed(4)} data-visual-position={view.position.join(',')}>
      <span className="character-silhouette" aria-hidden="true">◯</span>
      <strong>{portraitName ?? (changli ? 'Changli' : characterName(character.who, catalog, profile, diagnostics))}</strong>
      {diagnostics && <><span>Stage who {character.who}</span>
      <span>Expression {character.expression ?? 'unspecified'}</span>
      <span>Talker {sourceTalker ?? 'unresolved'}</span></>}
      {reason && <span role="status" data-testid={assetKind === 'image' ? 'portrait-image-fallback' : portraitName && !changli ? 'spine-fallback' : 'changli-fallback'}>{diagnostics ? reason : 'Portrait unavailable'}</span>}
      {diagnostics && character.effect && <span className="character-effect">{character.effect}</span>}
      {diagnostics && character.portraitEffect && <span className="character-effect">Last {String(character.portraitEffect.fx ?? 'portrait effect')} (deferred)</span>}
    </div>
  );
}
