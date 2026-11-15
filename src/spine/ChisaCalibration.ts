import { previewCoordinateFrame } from '../engine/StageCoordinates.ts';
import type { StagePosition } from '../engine/StageState.ts';
import { calibratedPortraitTransform } from './PortraitCalibration.ts';

/** PROVISIONAL viewer placement measured once from Chisa expression 700152.
 * Source portraitTransform stays metadata; the game canvas/pivot is unresolved. */
export const chisaCalibration = Object.freeze({
  provisional: true,
  referenceExpression: 700152,
  anchorX: -46.987298520672994,
  anchorY: -3288.523681640624,
  referenceHeight: 5727.023925781248,
  heightFraction: .84,
  frame: previewCoordinateFrame,
});

export const chisaTransform = (position: StagePosition) => calibratedPortraitTransform(position, chisaCalibration);
