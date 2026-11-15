/** Original VisualNovelSpineCharacter.ScheduleBlink: 3 + NextSingle() * 3.
 * The timer restarts when a blink starts; its duration is part of the interval.
 * See test-results/reader-catchlights/source-controller/controller-summary.json. */
export const changliBlinkCadence = Object.freeze({
  provisional: false,
  intervalSeconds: Object.freeze([3, 6] as const),
});

export interface ChangliBlinkOptions {
  readonly intervalSeconds?: readonly [number, number];
  readonly random?: () => number;
}
