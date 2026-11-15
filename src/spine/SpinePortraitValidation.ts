import type { ChangliResources } from './ChangliAssets.ts';
import type { SpinePortraitProfile } from './ChangliSpineScene.ts';
import type { SpineAtlas } from './SpineRuntime.ts';

/** All required source atlases are single-page. Never bind one texture to
 * unrelated/missing pages, or stretch an incompatible texture sheet. */
export function validatePortraitAtlasPage(atlas: SpineAtlas, image: HTMLImageElement, label: string, expectedPage?: string): void {
  if (atlas.pages.length !== 1) throw new Error(`${label}: expected one verified atlas page, found ${atlas.pages.length}.`);
  const page = atlas.pages[0];
  if (expectedPage && page.name !== expectedPage) throw new Error(`${label}: expected atlas page ${expectedPage}, found ${page.name}.`);
  if (!(page.width > 0 && page.height > 0) || image.naturalWidth !== page.width || image.naturalHeight !== page.height) {
    throw new Error(`${label}: atlas page ${page.name} (${page.width}×${page.height}) does not match the decoded texture (${image.naturalWidth}×${image.naturalHeight}).`);
  }
}

/** Validate composition before GPU allocation; each required skeleton is parsed
 * by the supplied real runtime, not an animation-name substring scan. */
export function validateSpinePortraitResources(resources: ChangliResources, profile: SpinePortraitProfile, expectedPage: string): void {
  const atlas = new resources.runtime.TextureAtlas(resources.atlas);
  validatePortraitAtlasPage(atlas, resources.image, `${profile.name} atlas`, expectedPage);
  // The attachment loader reads texture dimensions even without drawing.
  // Bind a CPU-only descriptor of the already decoded/validated image; no
  // WebGL resource is allocated during asset validation.
  const dimensions = { width: resources.image.naturalWidth, height: resources.image.naturalHeight };
  const texture = { getImage: () => dimensions, setFilters() {}, setWraps() {}, dispose() {} };
  for (const page of atlas.pages) page.setTexture(texture);
  const data = new resources.runtime.SkeletonBinary(new resources.runtime.AtlasAttachmentLoader(atlas)).readSkeletonData(resources.skeleton);
  if (!data.version.startsWith('4.1.')) throw new Error(`${profile.name}: unsupported skeleton version ${data.version}.`);
  for (const expression of resources.expressions.values()) {
    for (const name of [expression.body, expression.mouth, expression.eye]) {
      const clip = data.findAnimation(name);
      if (!clip) throw new Error(`${profile.name} expression ${expression.id}: skeleton clip ${name} is missing.`);
      if (clip.duration !== (profile.poseDurations?.[name] ?? 0)) throw new Error(`${profile.name} expression ${expression.id}: unverified motion in pose clip ${name}.`);
    }
    if (expression.blink) {
      const clip = data.findAnimation(expression.blink);
      if (!clip || !(clip.duration > 0) || !profile.verifiedBlinks.has(clip.name)) throw new Error(`${profile.name} expression ${expression.id}: verified blink ${expression.blink} is unavailable.`);
    }
  }
}
