import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { VisualAssets } from '../assets/VisualAssets.ts';
import type { EnglishCatalog } from '../data/EnglishScriptRepository.ts';
import type { RunnerSnapshot } from '../engine/types.ts';
import type { PresentedCharacter } from '../engine/StageTransitions.ts';
import type { StagePosition } from '../engine/StageState.ts';
import type { PlayerTextProfile } from '../text/EnglishText.ts';
import { roverDialogueAvatar, schoolAssetsForGender } from '../spine/SchoolRover.ts';
import { SchoolCharacterStage } from './SchoolCharacterStage.tsx';
import { schoolPortraits } from '../spine/SchoolPortraitAssets.ts';
import { changliCalibration } from '../spine/ChangliCalibration.ts';

export function speakerAvatarView(snapshot: RunnerSnapshot): PresentedCharacter | null {
  const speaker = snapshot.dialogue?.speakerId;
  if (!speaker || snapshot.dialogue?.kind === 'narration' || snapshot.dialogue?.kind === 'centerText') return null;
  // Stage who and talker are distinct. Another avatar is never substituted.
  return snapshot.presentation.characters.find(view => view.character.who === String(speaker) && (view.character.avatarVisible || view.avatarOpacity > 0)) ?? null;
}

/** Independent cropped composition. Authored stage views are never changed. */
export function SpeakerAvatar({ snapshot, view, assets, catalog, profile }: { snapshot: RunnerSnapshot; view: PresentedCharacter; assets: VisualAssets; catalog: EnglishCatalog | null; profile: PlayerTextProfile }) {
  const genderAssets = useMemo(() => schoolAssetsForGender(assets, profile.gender), [assets, profile.gender]);
  const rover = useMemo(() => roverDialogueAvatar(view.character, genderAssets), [view.character, genderAssets]);
  const expression = rover.character.expression === null ? null : genderAssets.manifest.expressions[String(rover.character.expression)];
  const talkerId = expression?.talkerId ?? catalog?.speakers[view.character.who]?.talkerId;
  const talker = talkerId ? genderAssets.manifest.talkers?.[String(talkerId)] : null;
  const raw = talker?.headIconTransform;
  const transform = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const number = (key: string, fallback: number) => typeof transform[key] === 'number' && Number.isFinite(transform[key]) ? transform[key] as number : fallback;
  const head = [number('PosX', 0), number('PosY', 0), number('Scale', 1)] as const;
  const definition = schoolPortraits.find(item => item.talkerId === talkerId);
  const calibration = talkerId === 850006 ? changliCalibration : definition?.avatarProfile?.calibration ?? definition?.profile.calibration;
  const topFraction = (calibration?.frame.floorPercent ?? 5) / 100 + head[1] / (calibration?.frame.height ?? 1440) + (calibration?.heightFraction ?? .84) * head[2];
  const avatarCharacter = useMemo(() => ({ ...rover.character, present: true, portraitVisible: true, avatarVisible: false }), [rover.character]);
  const avatarView = useMemo(() => ({ ...view, character: avatarCharacter, brightness: rover.brightness ?? view.brightness, position: head as StagePosition, portraitOpacity: view.avatarOpacity, avatarOpacity: 0 }), [view, avatarCharacter, rover.brightness, ...head]);
  const state = useMemo(() => ({ ...snapshot.stageState, characters: { [avatarCharacter.who]: avatarCharacter } }), [snapshot.stageState, avatarCharacter]);
  return <div className="speaker-avatar" aria-hidden="true" data-testid="speaker-avatar" data-who={view.character.who} data-expression={view.character.expression ?? ''} data-render-expression={rover.character.expression ?? ''} data-avatar-fallback={rover.fallback?.expressionId ?? ''} data-avatar-brightness={avatarView.brightness} data-gender={profile.gender} data-avatar-opacity={view.avatarOpacity.toFixed(4)} data-head-transform={head.join(',')} style={{ '--avatar-top-fraction': topFraction } as CSSProperties}>
    <div className="speaker-avatar-scene"><SchoolCharacterStage state={state} views={[avatarView]} assets={genderAssets} catalog={catalog} profile={profile} diagnostics={false} composition="avatar" renderPlaceholders={false} /></div>
  </div>;
}
