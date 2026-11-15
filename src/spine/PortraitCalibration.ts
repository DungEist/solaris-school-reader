import { characterCoordinates } from '../engine/StageCoordinates.ts';
import type { StageCoordinateFrame } from '../engine/StageCoordinates.ts';
import type { StagePosition } from '../engine/StageState.ts';

export interface PortraitCalibration {
  readonly provisional: boolean;
  readonly referenceExpression: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly referenceHeight: number;
  readonly heightFraction: number;
  readonly frame: StageCoordinateFrame;
}

/** Use one measured reference per character, retaining raw stage offsets/scales.
 * Expressions never trigger bounds fitting or move the portrait's anchor.
 * Subtract the scaled Spine-local anchor from the stage point: translation
 * stays in stage units, independent of portrait size and authored scale. */
export function calibratedPortraitTransform(position: StagePosition, calibration: PortraitCalibration) {
  const coordinates = characterCoordinates(position, calibration.frame);
  const scale = calibration.frame.height * calibration.heightFraction / calibration.referenceHeight * coordinates.scale;
  return Object.freeze({
    x: coordinates.leftPercent / 100 * calibration.frame.width - calibration.anchorX * scale,
    y: coordinates.bottomPercent / 100 * calibration.frame.height - calibration.anchorY * scale,
    scale,
  });
}
