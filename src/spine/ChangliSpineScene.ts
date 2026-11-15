import type { PresentedCharacter } from '../engine/StageTransitions.ts';
import { verifiedChangliBlinks } from './ChangliAssets.ts';
import type { ChangliExpression, ChangliResources } from './ChangliAssets.ts';
import { changliBlinkCadence } from './ChangliBlinkCadence.ts';
import type { ChangliBlinkOptions } from './ChangliBlinkCadence.ts';
import { changliCalibration, changliTransform } from './ChangliCalibration.ts';
import type { PortraitCalibration } from './PortraitCalibration.ts';
import type { StagePosition } from '../engine/StageState.ts';
import type { SpineAnimationState, SpineRuntime, SpineSceneRenderer, SpineSkeleton, SpineSkeletonData } from './SpineRuntime.ts';
import { validatePortraitAtlasPage } from './SpinePortraitValidation.ts';

export interface ChangliActor {
  setExpression(expression: ChangliExpression): void;
  setBlinkEnabled(enabled: boolean): void;
  render(view: PresentedCharacter, delta: number): void;
  dispose(): void;
}
export interface ChangliFrame { readonly actor: ChangliActor; readonly view: PresentedCharacter }
export interface ChangliScene {
  createActor(): ChangliActor;
  render(characters: readonly ChangliFrame[], delta: number): void;
  dispose(): void;
}

/** Resource-specific authored clips and placement share one actor lifecycle. */
export interface SpinePortraitProfile {
  readonly name: string;
  readonly calibration: PortraitCalibration;
  readonly transform: (position: StagePosition) => { readonly x: number; readonly y: number; readonly scale: number };
  readonly verifiedBlinks: ReadonlySet<string>;
  readonly poseDurations?: Readonly<Record<string, number>>;
  /** Verified authored cycles. Other nonzero poses play once and hold. */
  readonly loopAnimations?: ReadonlySet<string>;
  /** Resource-specific facing, independently verified for dialogue avatars.
   * A negative source X offset is still a translation. */
  readonly horizontalFacing?: 1 | -1;
  /** Reader dialogue canvases extend one scene-height upward. */
  readonly canvasTopOverscan?: boolean;
}
export const changliSpineProfile: SpinePortraitProfile = Object.freeze({ name: 'Changli', calibration: changliCalibration, transform: changliTransform, verifiedBlinks: verifiedChangliBlinks });

/** A skeleton/animation state belongs to one stage entry. Skeleton data and
 * GPU texture are shared by the scene. Presentation never starts animations. */
export class ChangliSpineActor implements ChangliActor {
  readonly skeleton: SpineSkeleton;
  readonly animationState: SpineAnimationState;
  private readonly renderer: Pick<SpineSceneRenderer, 'drawSkeleton'>;
  private readonly pauseRange: readonly [number, number];
  private readonly random: () => number;
  private readonly profile: SpinePortraitProfile;
  private expressionKey: string | null = null;
  private readonly poseNames: (string | null)[] = [null, null, null];
  private blink: { readonly name: string; readonly duration: number } | null = null;
  private blinkEnabled = true;
  private intervalRemaining: number | null = null;
  private blinkRemaining: number | null = null;
  private eyeTrackWasBlinking = false;
  private disposed = false;

  constructor(runtime: SpineRuntime, data: SpineSkeletonData, renderer: Pick<SpineSceneRenderer, 'drawSkeleton'>, blinkOptions: ChangliBlinkOptions = {}, profile = changliSpineProfile) {
    this.profile = profile;
    const [min, max] = blinkOptions.intervalSeconds ?? changliBlinkCadence.intervalSeconds;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) throw new Error(`${profile.name} blink interval needs a finite positive minimum and maximum >= minimum.`);
    this.pauseRange = [min, max];
    this.random = blinkOptions.random ?? Math.random;
    this.skeleton = new runtime.Skeleton(data);
    if (data.skins.length) this.skeleton.setSkinByName(data.skins[0].name);
    const stateData = new runtime.AnimationStateData(data);
    stateData.defaultMix = 0; // Expression changes use the existing stage fades.
    this.animationState = new runtime.AnimationState(stateData);
    this.renderer = renderer;
  }

  setExpression(expression: ChangliExpression): void {
    if (this.disposed) return;
    const key = `${expression.id}:${expression.body}|${expression.mouth}|${expression.eye}|${expression.blink ?? ''}`;
    if (key === this.expressionKey) return;
    for (const name of [expression.body, expression.mouth, expression.eye]) {
      const clip = this.skeleton.data.findAnimation(name);
      if (!clip) throw new Error(`${this.profile.name} expression ${expression.id}: skeleton clip ${name} is missing.`);
      if (clip.duration !== (this.profile.poseDurations?.[name] ?? 0)) throw new Error(`${this.profile.name} expression ${expression.id}: unverified motion in pose clip ${name}.`);
    }
    const blink = expression.blink ? this.skeleton.data.findAnimation(expression.blink) : null;
    if (expression.blink && (!this.profile.verifiedBlinks.has(expression.blink) || !blink || !(blink.duration > 0))) throw new Error(`${this.profile.name} expression ${expression.id}: verified blink ${expression.blink} is unavailable.`);
    const eyeChanged = this.poseNames[2] !== expression.eye;
    const poseChanged = [expression.body, expression.mouth, expression.eye].some((name, track) => this.poseNames[track] !== name);
    // Native PlayTrackAnimation leaves an identical channel running, even
    // when another body/mouth expression uses it. Preserve catchlight phase.
    [expression.body, expression.mouth, expression.eye].forEach((name, track) => {
      if (this.poseNames[track] === name) return;
      this.poseNames[track] = name;
      this.replaceTrack(track, name, this.loops(name));
    });
    if (eyeChanged) {
      this.blinkRemaining = null;
    }
    if (poseChanged) this.resetPose();
    // Native SetBlinkAnimation reschedules only when the blink mapping changes.
    if ((this.blink?.name ?? null) !== (blink?.name ?? null)) {
      if (this.eyeTrackWasBlinking) this.restoreOpenEyes();
      this.eyeTrackWasBlinking = false;
      this.blink = blink ? { name: blink.name, duration: blink.duration } : null;
      this.blinkRemaining = null;
      this.intervalRemaining = this.blink && this.blinkEnabled ? this.nextInterval() : null;
    }
    this.animationState.apply(this.skeleton);
    this.skeleton.updateWorldTransform();
    this.expressionKey = key;
  }

  setBlinkEnabled(enabled: boolean): void {
    if (this.disposed || enabled === this.blinkEnabled) return;
    this.blinkEnabled = enabled;
    if (this.eyeTrackWasBlinking) this.restoreOpenEyes();
    this.eyeTrackWasBlinking = false;
    this.blinkRemaining = null;
    this.intervalRemaining = enabled && this.blink ? this.nextInterval() : null;
  }

  private loops(name: string): boolean {
    return this.profile.loopAnimations?.has(name) || this.skeleton.data.findAnimation(name)!.duration === 0;
  }

  private replaceTrack(track: number, name: string, loop: boolean): void {
    // Spine retains mixingFrom until a positive update, even with defaultMix=0.
    // Replacing a pose during/after a blink can otherwise paint old eye bones
    // in the immediate zero-delta render. Stage fades own expression blending;
    // clear only this replaced channel and keep every unchanged track clock.
    this.animationState.clearTrack(track);
    this.animationState.setAnimation(track, name, loop);
  }

  private nextInterval(): number {
    const fraction = this.random();
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new Error(`${this.profile.name} blink random sample must be between 0 and 1.`);
    return this.pauseRange[0] + (this.pauseRange[1] - this.pauseRange[0]) * fraction;
  }

  private resetPose(): void {
    this.skeleton.setToSetupPose();
    // Spine retains deformation on already detached slots. A finished blink
    // must restore the mapped eye pose without any of that residual data.
    for (const slot of this.skeleton.slots) slot.deform.length = 0;
  }

  private restoreOpenEyes(): void {
    const eye = this.poseNames[2];
    if (eye) this.replaceTrack(2, eye, this.loops(eye));
    this.resetPose();
    this.animationState.apply(this.skeleton); // Body/mouth keep their clocks; the queued eye starts at zero.
    this.skeleton.updateWorldTransform();
  }

  /** Use the existing frame clock, with no independent timeout callbacks.
   * Mirror native track 2: one-shot blink, then the original looping eye clip.
   * This keeps the authored mesh, curves and eyelid layering together. */
  private advanceBlink(delta: number): void {
    if (!this.blink || !this.blinkEnabled) { this.animationState.update(delta); return; }
    let remaining = delta;
    while (remaining > 0) {
      const until = Math.min(this.intervalRemaining!, this.blinkRemaining ?? Infinity);
      const step = Math.min(remaining, until);
      this.animationState.update(step);
      remaining -= step;
      this.intervalRemaining! -= step;
      if (this.blinkRemaining !== null) this.blinkRemaining -= step;
      if (this.blinkRemaining !== null && this.blinkRemaining <= 1e-9) {
        this.blinkRemaining = null;
        this.restoreOpenEyes();
      }
      if (this.intervalRemaining! <= 1e-9) {
        this.blinkRemaining = this.blink.duration;
        this.eyeTrackWasBlinking = true;
        this.replaceTrack(2, this.blink.name, false);
        this.resetPose();
        this.intervalRemaining = this.nextInterval();
      }
    }
  }

  render(view: PresentedCharacter, delta: number): void {
    if (this.disposed) return;
    const transform = this.profile.transform(view.position);
    const facing = this.profile.horizontalFacing ?? 1;
    // Reflect around the calibrated anchor, preserving the authored/head-icon
    // translation rather than reflecting the entire scene or its PosX.
    this.skeleton.x = transform.x + (1 - facing) * this.profile.calibration.anchorX * transform.scale;
    this.skeleton.y = transform.y;
    this.skeleton.scaleX = facing * transform.scale; this.skeleton.scaleY = transform.scale;
    // Keep painted regions opaque under Darken; only visibility fades change
    // alpha. Slot/attachment colors and authored animation fades stay intact.
    const brightness = Math.max(0, Math.min(1, view.brightness ?? (view.character.effect === 'Darken' ? .58 : 1)));
    this.skeleton.color.r = this.skeleton.color.g = this.skeleton.color.b = brightness;
    this.skeleton.color.a = Math.max(0, Math.min(1, view.portraitOpacity));
    this.advanceBlink(delta);
    this.animationState.apply(this.skeleton);
    this.skeleton.updateWorldTransform();
    this.renderer.drawSkeleton(this.skeleton, false); // Existing PNG has straight alpha.
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.blink = null; this.intervalRemaining = this.blinkRemaining = null;
    this.animationState.clearTracks();
  }
}

export function createChangliScene(canvas: HTMLCanvasElement, resources: ChangliResources, blinkOptions: ChangliBlinkOptions = {}, profile = changliSpineProfile): ChangliScene {
  const runtime = resources.runtime;
  const context = new runtime.ManagedWebGLRenderingContext(canvas, { alpha: true });
  if (!context.gl) throw new Error(`WebGL is unavailable for the ${profile.name} renderer.`);
  const texture = new runtime.GLTexture(context, resources.image);
  let renderer: SpineSceneRenderer;
  let atlas: InstanceType<SpineRuntime['TextureAtlas']>;
  let data: SpineSkeletonData;
  try {
    atlas = new runtime.TextureAtlas(resources.atlas);
    validatePortraitAtlasPage(atlas, resources.image, `${profile.name} atlas`);
    for (const page of atlas.pages) page.setTexture(texture);
    data = new runtime.SkeletonBinary(new runtime.AtlasAttachmentLoader(atlas)).readSkeletonData(resources.skeleton);
    if (!data.version.startsWith('4.1.')) throw new Error(`${profile.name} requires Spine 4.1; loaded ${data.version}.`);
    renderer = new runtime.SceneRenderer(canvas, context);
  } catch (error) { texture.dispose(); throw error; }
  let disposed = false;
  return {
    createActor: () => new ChangliSpineActor(runtime, data, renderer, blinkOptions, profile),
    render(characters, delta) {
      if (disposed || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return;
      renderer.resize(runtime.ResizeMode.Expand);
      const frame = profile.calibration.frame;
      const viewportHeight = profile.canvasTopOverscan ? canvas.height / 2 : canvas.height;
      renderer.camera.zoom = Math.max(frame.width / canvas.width, frame.height / viewportHeight);
      renderer.camera.position.x = frame.width / 2;
      renderer.camera.position.y = frame.height / 2 + (profile.canvasTopOverscan ? viewportHeight * renderer.camera.zoom / 2 : 0);
      context.gl.clearColor(0, 0, 0, 0);
      context.gl.clear(context.gl.COLOR_BUFFER_BIT);
      renderer.begin();
      for (const entry of characters) entry.actor.render(entry.view, delta);
      renderer.end();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      renderer.dispose();
      atlas.dispose();
      context.gl.clearColor(0, 0, 0, 0);
      context.gl.clear(context.gl.COLOR_BUFFER_BIT);
    },
  };
}
