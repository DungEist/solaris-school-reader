import type { VisualAssets } from '../assets/VisualAssets.ts';
import type { PlayerTextProfile } from '../text/EnglishText.ts';
import type { CharacterState } from '../engine/StageState.ts';
import type { ChangliExpression } from './ChangliAssets.ts';

/** Explicit avatar channel approximations verified against SolarSchool_Male.
 * Source rows name absent wunai/yansu/nanguo clips in both Rover skeletons.
 * These affect dialogue composition only; source stage resolution stays strict. */
export const roverMaleAvatarRepairs: ReadonlyMap<number, ChangliExpression> = new Map([
  [700128, 'dongzuo1_putongzhan', 'dongzuo1_zhoumei_zhengyan', 'dongzuo1_zhoumei_zui', 'dongzuo1_zhoumei_zhayan'],
  [700129, 'dongzuo1_putongzhan', 'dongzuo1_biyannanguo', 'dongzuo1_biyannanguo_zui', null],
  [700130, 'dongzuo1_putongzhan', 'dongzuo1_zhoumei_zhengyan', 'dongzuo1_zhoumei_zui', 'dongzuo1_zhoumei_zhayan'],
  [700133, 'dongzuo2_sikaozhan', 'dongzuo1_zhoumei_zhengyan', 'dongzuo1_zhoumei_zui', 'dongzuo1_zhoumei_zhayan'],
  [700134, 'dongzuo2_sikaozhan', 'dongzuo1_biyannanguo', 'dongzuo1_biyannanguo_zui', null],
  [700135, 'dongzuo2_sikaozhan', 'dongzuo1_zhoumei_zhengyan', 'dongzuo1_zhoumei_zui', 'dongzuo1_zhoumei_zhayan'],
].map(([id, body, eye, mouth, blink]) => [Number(id), Object.freeze({ id: Number(id), body: String(body), eye: String(eye), mouth: String(mouth), blink: blink === null ? null : String(blink) })]));

/** Aki.Game.dll (3.8.9), SolarSchoolVisualNovelConfigCenter.GetCharacterAnimation
 * 0x0603906A and PlotAvgUtils.GetAvgTalkerConfigByTalkerId 0x06029E98.
 * Both Rover row types select the player's resource; IDs and clips stay literal.
 * See docs/ALL_CHARACTERS_INTEGRATION.md for the source hash and limitations. */
export function schoolRoverCounterpart(talkerId: number): number | null {
  return talkerId === 850001 ? 850002 : talkerId === 850002 ? 850001 : null;
}

/** Presentation-only asset selection. Keep source state, names, visibility,
 * expression IDs and every animation channel unchanged. Other talkers retain
 * their registrations and running actors when the player changes gender. */
export function schoolAssetsForGender(assets: VisualAssets, gender: PlayerTextProfile['gender']): VisualAssets {
  const talkerId = gender === 'female' ? 850002 : 850001;
  let changed = false;
  const expressions = Object.fromEntries(Object.entries(assets.manifest.expressions).map(([id, expression]) => {
    if (expression.talkerId == null || schoolRoverCounterpart(expression.talkerId) == null || expression.talkerId === talkerId) return [id, expression];
    changed = true;
    return [id, Object.freeze({ ...expression, talkerId })];
  }));
  return changed ? Object.freeze({ ...assets, manifest: Object.freeze({ ...assets.manifest, expressions: Object.freeze(expressions) }) }) : assets;
}

/** Dialogue-only projection; the authored stage character remains untouched.
 * Original ShowCharacterSpineAsync calls SetSpeaking(true), which replaces
 * Darken with Highlight/white (0x06047D09, 0x06025277, 0x060252AB).
 * The managed gender path retains literal clips, so the female thinking pose
 * below is an explicit Reader fallback, not an asserted native ID mapping. */
export function roverDialogueAvatar(character: CharacterState, genderAssets: VisualAssets): {
  character: CharacterState;
  brightness?: number;
  fallback: { sourceExpressionId: number; expressionId: number; reason: string } | null;
} {
  const expression = character.expression === null ? undefined : genderAssets.manifest.expressions[String(character.expression)];
  if (character.who !== '750088' || expression?.talkerId == null || schoolRoverCounterpart(expression.talkerId) === null) return { character, fallback: null };
  // Gender selection changes the skeleton, but the native data keeps the
  // authored expression's literal clips. Project unavailable channels onto
  // explicit, validated poses for the dialogue avatar only. In particular,
  // 700129/134 need closed eyes, not the ordinary open-eye fallback.
  const counterparts: Readonly<Record<number, number>> = expression.talkerId === 850002
    ? { 700012: 700052, 700126: 700052, 700128: 700054, 700129: 700053, 700130: 700054, 700131: 700056, 700133: 700058, 700134: 700057, 700135: 700058 }
    : { 700052: 700126, 700053: 700129, 700054: 700128, 700056: 700131, 700057: 700134, 700058: 700133, 700128: 700128, 700129: 700129, 700130: 700130, 700133: 700133, 700134: 700134, 700135: 700135 };
  const fallbackId = character.expression === null ? undefined : counterparts[character.expression];
  const replacement = fallbackId === undefined ? undefined : genderAssets.manifest.expressions[String(fallbackId)];
  const fallback = replacement?.talkerId === expression.talkerId && character.expression !== null && fallbackId !== undefined
    ? { sourceExpressionId: character.expression, expressionId: fallbackId,
        reason: `Reader avatar fallback: source expression ${character.expression} → ${expression.talkerId === 850002 ? 'female' : 'male'} pose ${fallbackId} (${replacement.label}). The selected skeleton lacks the authored channels; this verified pose approximates the expression. Native missing-clip behavior is unverified.` }
    : null;
  return { character: Object.freeze({ ...character, expression: fallback?.expressionId ?? character.expression, effect: 'Highlight' }), brightness: 1, fallback };
}

/** Required playback channels absent after source gender substitution. These
 * are audited against the actual skeletons, never replacement expressions.
 * Existing female spelling repair remains scoped to its verified resource. */
export const roverGenderMissingClips: Readonly<Record<number, Readonly<Record<number, readonly string[]>>>> = {
  850001: {
    700052: ['dongzuo1_zhengchang_zui'],
    700053: ['dongzuo1_ zhoumei_zui'],
    700054: ['dongzuo1_ zhoumei_zui'],
    700056: ['dongzuo1_zhengchang_zui'],
    700057: ['dongzuo1_ zhoumei_zui'],
    700058: ['dongzuo1_ zhoumei_zui'],
  },
  850002: {
    700012: ['dongzuo1_zhengchang_bizui'],
    700126: ['dongzuo1_zhengchang_bizui'],
    700128: ['dongzuo1_yansu_zui'],
    700129: ['dongzuo1_wunai_biyan', 'dongzuo1_wunai_zui'],
    700130: ['dongzuo1_nanguo_zhayan', 'dongzuo1_nanguo_zhengyan', 'dongzuo1_nanguo_zui'],
    700131: ['dongzuo1_zhengchang_bizui'],
    700133: ['dongzuo1_yansu_zui'],
    700134: ['dongzuo1_wunai_biyan', 'dongzuo1_wunai_zui'],
    700135: ['dongzuo1_nanguo_zhayan', 'dongzuo1_nanguo_zhengyan', 'dongzuo1_nanguo_zui'],
  },
};
