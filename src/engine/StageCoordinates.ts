import type { StagePosition } from './StageState.ts';

export interface StageCoordinateFrame {
  readonly width: number;
  readonly height: number;
  readonly floorPercent: number;
}

/** Source positions are offsets, not percentages: common x values are 0,
 * ±400, ±560 and ±800. The source tables do not export a canvas size/pivot.
 * This explicit viewer plane is a documented convention, not a claimed game
 * canvas measurement. Stage X increases rightward and stage Y increases
 * upward (1001, Abby nodes 8–10). CSS bottom and Spine world Y both increase
 * upward, so neither needs a sign inversion. Raw engine positions, portrait
 * calibration anchors and Spine-local coordinates remain separate. */
export const previewCoordinateFrame: StageCoordinateFrame = Object.freeze({ width: 2560, height: 1440, floorPercent: 5 });

export interface CharacterCoordinates {
  readonly leftPercent: number;
  readonly bottomPercent: number;
  readonly scale: number;
}

export function characterCoordinates(position: StagePosition, frame = previewCoordinateFrame): CharacterCoordinates {
  if (!(frame.width > 0 && frame.height > 0) || !Number.isFinite(frame.width) || !Number.isFinite(frame.height) || !Number.isFinite(frame.floorPercent)) throw new Error('A finite positive stage coordinate frame is required');
  return Object.freeze({
    leftPercent: 50 + position[0] / frame.width * 100,
    bottomPercent: frame.floorPercent + position[1] / frame.height * 100,
    scale: position[2],
  });
}
