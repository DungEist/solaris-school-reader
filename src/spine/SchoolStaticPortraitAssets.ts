import type { VisualAssets } from '../assets/VisualAssets.ts';
import type { EnglishCatalog } from '../data/EnglishScriptRepository.ts';
import type { CharacterState } from '../engine/StageState.ts';
import { schoolMissingPortraitData, schoolStaticPortraitData, schoolPortraitAliasData } from './SchoolPortraitCatalog.ts';
import { schoolPortraitByTalker } from './SchoolPortraitAssets.ts';

export interface SchoolStaticPortraitDefinition {
  readonly talkerId: number;
  readonly name: string;
  readonly sourceTexture: string;
  readonly textureFile: string;
  readonly width: number;
  readonly height: number;
  readonly heightFraction: number;
}

export const schoolStaticPortraits: readonly SchoolStaticPortraitDefinition[] = schoolStaticPortraitData;
const textures = new Map<number, SchoolStaticPortraitDefinition>(schoolStaticPortraits.map(definition => [definition.talkerId, definition]));
const missing = new Map<number, (typeof schoolMissingPortraitData)[number]>(schoolMissingPortraitData.map(definition => [definition.talkerId, definition]));
export const schoolPortraitAliases = new Map<number, (typeof schoolPortraitAliasData)[number]>(schoolPortraitAliasData.map(definition => [definition.talkerId, definition]));

export type SchoolStaticPortraitResolution =
  | { readonly kind: 'other' }
  | { readonly kind: 'texture'; readonly definition: SchoolStaticPortraitDefinition; readonly url: string }
  | { readonly kind: 'fallback'; readonly name: string; readonly talkerId: number; readonly reason: string };

/** An expression identifies a Spine talker. Expression-less NPCs use the
 * source speaker's explicit AvgTalkerConfig link, never a numeric who guess. */
export function resolveSchoolStaticPortrait(character: CharacterState, assets: VisualAssets, catalog: EnglishCatalog | null): SchoolStaticPortraitResolution {
  const expression = character.expression == null ? undefined : assets.manifest.expressions[String(character.expression)];
  const talkerId = expression?.talkerId ?? catalog?.speakers[character.who]?.talkerId;
  if (talkerId == null) return { kind: 'other' };
  const unavailable = missing.get(talkerId);
  if (unavailable) return { kind: 'fallback', ...unavailable };
  const definition = textures.get(talkerId);
  if (definition) {
    if (assets.manifest.talkers?.[String(talkerId)]?.portraitTexture !== definition.sourceTexture) {
      return { kind: 'fallback', name: definition.name, talkerId, reason: `${definition.name}: source portrait texture is missing or differs from the registered image.` };
    }
    if (character.expression && !expression) return { kind: 'fallback', name: definition.name, talkerId, reason: `Source expression ${character.expression} is unavailable.` };
    const base = assets.baseUrl.endsWith('/') ? assets.baseUrl : `${assets.baseUrl}/`;
    return { kind: 'texture', definition, url: `${base}characters/npc/${definition.textureFile}` };
  }
  if (!expression) {
    const name = schoolPortraitByTalker.get(talkerId)?.name ?? schoolPortraitAliases.get(talkerId)?.name ?? (talkerId === 850006 ? 'Changli' : undefined);
    if (name) return { kind: 'fallback', name, talkerId, reason: `${name}: no usable source expression is configured.` };
  }
  return { kind: 'other' };
}
