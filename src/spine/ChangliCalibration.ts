import { characterCoordinates, previewCoordinateFrame } from '../engine/StageCoordinates.ts';
import type { StagePosition } from '../engine/StageState.ts';

/** PROVISIONAL viewer placement, not a recovered game pivot/canvas.
 * One measurement of composed expression 700048 fixes all expressions to
 * the same bottom-center anchor and scale. No per-pose bounds/auto-fitting.
 * Raw source position/scale and the existing stage coordinate policy remain
 * unchanged. The manifest's portraitTransform is retained as source metadata. */
export const changliCalibration = Object.freeze({
  provisional: true,
  referenceExpression: 700048,
  anchorX: -77.10208894659445,
  anchorY: -2500.5410041809077,
  referenceHeight: 6220.4401741027805,
  heightFraction: .84,
  frame: previewCoordinateFrame,
});

export function changliTransform(position: StagePosition) {
  const calibration = changliCalibration;
  const coordinates = characterCoordinates(position, calibration.frame);
  const scale = calibration.frame.height * calibration.heightFraction / calibration.referenceHeight * coordinates.scale;
  return Object.freeze({
    x: coordinates.leftPercent / 100 * calibration.frame.width - calibration.anchorX * scale,
    y: coordinates.bottomPercent / 100 * calibration.frame.height - calibration.anchorY * scale,
    scale,
  });
}
