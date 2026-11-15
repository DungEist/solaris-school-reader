import { previewCoordinateFrame } from '../engine/StageCoordinates.ts';
import type { StagePosition } from '../engine/StageState.ts';
import { calibratedPortraitTransform } from './PortraitCalibration.ts';
import { sourcePortraitTransform } from './SourcePortraitPlacement.ts';

/** Keep the speaker crop's original calibration independent of stage size. */
export const abbyAvatarCalibration = Object.freeze({
  provisional: true,
  referenceExpression: 700212,
  anchorX: -9.346443601606552,
  anchorY: -1690.0095214843745,
  referenceHeight: 3302.838623046874,
  heightFraction: .34,
  frame: Object.freeze({ ...previewCoordinateFrame, floorPercent: 31 }),
});

export const abbyAvatarTransform = (position: StagePosition) => calibratedPortraitTransform(position, abbyAvatarCalibration);

/** Talker 700005's portraitTransform, corroborated at 1001/21 (700230).
 * The reference uses the stage-center skeleton root and source .25 scale;
 * normalizing the mascot to 34% stage height discarded that calibration.
 * Authored root scale multiplies the resource's child offset and skeleton
 * units once. Neither expression bounds nor viewport size refit the portrait. */
export const abbySourcePortraitTransform = Object.freeze({ PosX: 60, PosY: 0, Scale: .25 });
export const abbyCalibration = Object.freeze({
  ...abbyAvatarCalibration,
  provisional: false,
  anchorX: 0,
  anchorY: 0,
  heightFraction: abbyAvatarCalibration.referenceHeight * abbySourcePortraitTransform.Scale / previewCoordinateFrame.height,
  frame: Object.freeze({ ...previewCoordinateFrame, floorPercent: 50 }),
});

export function abbyTransform(position: StagePosition) {
  return sourcePortraitTransform(position, abbySourcePortraitTransform, abbyCalibration.frame);
}
