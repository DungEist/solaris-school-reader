import type { ChangliExpression } from '../src/spine/ChangliAssets.ts';

export interface SourceModel {
  definition: { slug: string; name: string; talkerId: number };
  data: { findAnimation(name: string): { name: string; duration: number } | null };
  expressions: ReadonlyMap<number, ChangliExpression>;
}
export interface SourceVerification {
  passed: boolean;
  maximumVertexDifference: number;
  issues: readonly unknown[];
  openSamples: number;
  blinkSamples: number;
  attachmentSignature: readonly { slot: string; attachment: string }[] | null;
}
export const models: readonly SourceModel[];
export function expressionFor(model: SourceModel, id: number, composition: string): ChangliExpression | undefined;
export function verifyComposition(model: SourceModel, expression: ChangliExpression, composition: string): SourceVerification;
export function verifyTransition(model: SourceModel, from: ChangliExpression, to: ChangliExpression, composition: string): {
  passed: boolean;
  samples: number;
  maximumVertexDifference: number;
  issues: readonly unknown[];
};
