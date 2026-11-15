import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { validateVisualManifest } from '../src/assets/VisualAssetRepository.ts';
import type { VisualAssets } from '../src/assets/VisualAssets.ts';
import { readChangliExpressions } from '../src/spine/ChangliAssets.ts';
import type { ChangliExpression, ChangliResources } from '../src/spine/ChangliAssets.ts';
import type { ChangliActor, ChangliFrame, ChangliScene } from '../src/spine/ChangliSpineScene.ts';
import type { SpineRuntime, SpineSkeletonData } from '../src/spine/SpineRuntime.ts';
import type { PresentedCharacter } from '../src/engine/StageTransitions.ts';

const root = new URL('../public/assets/solarschool/characters/changli/', import.meta.url);
export const changliMetadata = JSON.parse(readFileSync(new URL('Changli.animation-metadata.json', root), 'utf8'));
export const changliAssets: VisualAssets = {
  manifest: validateVisualManifest(JSON.parse(readFileSync(new URL('../public/data/assets.manifest.json', import.meta.url), 'utf8'))),
  mapping: null, baseUrl: '/assets/solarschool/', issues: [],
};

// Official runtime math, no browser, GPU, PNG conversion or atlas validation.
export const fullSpine: any = runInNewContext(readFileSync(new URL('spine-player.js', root), 'utf8') + '\nspine;', { performance, console, setTimeout, clearTimeout });
const atlas = new fullSpine.TextureAtlas(readFileSync(new URL('SolarSchool_Changli.atlas', root), 'utf8'));
for (const page of atlas.pages) page.texture = new fullSpine.Texture({ width: page.width, height: page.height });
export const changliSkeletonData: SpineSkeletonData = new fullSpine.SkeletonBinary(new fullSpine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(readFileSync(new URL('SolarSchool_Changli.skel', root))));
export const changliResources: ChangliResources = {
  runtime: fullSpine as SpineRuntime, skeleton: new Uint8Array(readFileSync(new URL('SolarSchool_Changli.skel', root))),
  atlas: readFileSync(new URL('SolarSchool_Changli.atlas', root), 'utf8'), image: {} as HTMLImageElement,
  expressions: readChangliExpressions(changliMetadata),
};

export class TestChangliActor implements ChangliActor {
  readonly expressions: ChangliExpression[] = [];
  readonly frames: { view: PresentedCharacter; delta: number }[] = [];
  disposed = 0;
  setExpression(expression: ChangliExpression): void { this.expressions.push(expression); }
  setBlinkEnabled(_enabled: boolean): void {}
  render(view: PresentedCharacter, delta: number): void { this.frames.push({ view, delta }); }
  dispose(): void { this.disposed++; }
}
export class TestChangliScene implements ChangliScene {
  readonly actors: TestChangliActor[] = [];
  readonly frames: (readonly ChangliFrame[])[] = [];
  disposed = 0;
  failRender = false;
  createActor(): TestChangliActor { const actor = new TestChangliActor(); this.actors.push(actor); return actor; }
  render(characters: readonly ChangliFrame[], delta: number): void {
    if (this.failRender) throw new Error('WebGL render failed');
    this.frames.push(characters);
    for (const entry of characters) entry.actor.render(entry.view, delta);
  }
  dispose(): void { this.disposed++; }
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function finishLoads(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }
