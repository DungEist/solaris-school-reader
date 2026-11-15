import { characterCoordinates, previewCoordinateFrame } from '../engine/StageCoordinates.ts';
import type { StageCoordinateFrame } from '../engine/StageCoordinates.ts';
import type { StagePosition } from '../engine/StageState.ts';
import type { SpinePortraitProfile } from './ChangliSpineScene.ts';

export interface SourcePortraitPlacement {
  readonly PosX: number;
  readonly PosY: number;
  readonly Scale: number;
}

export function readSourcePortraitPlacement(raw: unknown): SourcePortraitPlacement | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (![value.PosX, value.PosY, value.Scale].every(number => typeof number === 'number' && Number.isFinite(number)) || (value.Scale as number) <= 0) return null;
  return Object.freeze({ PosX: value.PosX as number, PosY: value.PosY as number, Scale: value.Scale as number });
}

const portraitFrame = Object.freeze({ ...previewCoordinateFrame, floorPercent: 50 });

/** The original CharacterRootItem owns the authored transform. Its child
 * SpineParentItem owns the resource offset and scale (controller methods
 * 0x06025291, 0x06025297 and 0x06025298). Root zoom therefore scales the
 * resource translation as well as the skeleton, about the root origin. */
export function sourcePortraitTransform(position: StagePosition, source: SourcePortraitPlacement, frame: StageCoordinateFrame = portraitFrame) {
  const authored = characterCoordinates(position, frame);
  return Object.freeze({
    x: authored.leftPercent / 100 * frame.width + source.PosX * authored.scale,
    y: authored.bottomPercent / 100 * frame.height + source.PosY * authored.scale,
    scale: source.Scale * authored.scale,
  });
}

/** Keep the resource's skeleton units and origin. A full-body bounds fit
 * discards both the source scale and its independently authored placement.
 * Viewport fitting happens once, in the scene camera; expression bounds never
 * participate in placement. Dialogue avatars retain their own crop profile. */
export function sourcePortraitProfile(profile: SpinePortraitProfile, raw: unknown): SpinePortraitProfile {
  const source = readSourcePortraitPlacement(raw);
  if (!source) return profile;
  const frame = portraitFrame;
  return Object.freeze({
    ...profile,
    calibration: Object.freeze({
      ...profile.calibration,
      anchorX: 0,
      anchorY: 0,
      heightFraction: profile.calibration.referenceHeight * source.Scale / frame.height,
      frame,
    }),
    transform: (position: StagePosition) => sourcePortraitTransform(position, source, frame),
  });
}
