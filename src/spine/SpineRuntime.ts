/** Narrow types for the supplied local 4.1 IIFE bundle; no npm/CDN imports. */
export interface SpineAnimation { readonly name: string; readonly duration: number }
export interface SpineSkeletonData {
  readonly version: string;
  readonly skins: readonly { readonly name: string }[];
  findAnimation(name: string): SpineAnimation | null;
}
export interface SpineSkeleton {
  readonly data: SpineSkeletonData;
  readonly slots: readonly { readonly deform: number[] }[];
  x: number; y: number; scaleX: number; scaleY: number;
  readonly color: { r: number; g: number; b: number; a: number };
  setSkinByName(name: string): void;
  setToSetupPose(): void;
  updateWorldTransform(): void;
}
export interface SpineAnimationState {
  clearTracks(): void;
  clearTrack(track: number): void;
  setAnimation(track: number, name: string, loop: boolean): SpineTrackEntry;
  getCurrent(track: number): SpineTrackEntry | null;
  update(delta: number): void;
  apply(skeleton: SpineSkeleton): void;
}
export interface SpineTrackEntry {
  readonly animation: SpineAnimation;
  readonly loop: boolean;
  readonly timeScale: number;
  readonly trackTime: number;
}
interface SpineTexture { dispose(): void }
export interface SpineAtlas {
  readonly pages: readonly { readonly name: string; readonly width: number; readonly height: number; setTexture(texture: SpineTexture): void }[];
  dispose(): void;
}
interface SpineContext { readonly gl: WebGLRenderingContext | WebGL2RenderingContext }
export interface SpineSceneRenderer {
  readonly camera: { zoom: number; readonly position: { x: number; y: number } };
  resize(mode: number): void;
  begin(): void;
  end(): void;
  drawSkeleton(skeleton: SpineSkeleton, premultipliedAlpha: boolean): void;
  dispose(): void;
}
export interface SpineRuntime {
  TextureAtlas: new (text: string) => SpineAtlas;
  AtlasAttachmentLoader: new (atlas: SpineAtlas) => unknown;
  SkeletonBinary: new (loader: unknown) => { readSkeletonData(bytes: Uint8Array): SpineSkeletonData };
  Skeleton: new (data: SpineSkeletonData) => SpineSkeleton;
  AnimationStateData: new (data: SpineSkeletonData) => { defaultMix: number };
  AnimationState: new (data: { defaultMix: number }) => SpineAnimationState;
  ManagedWebGLRenderingContext: new (canvas: HTMLCanvasElement, options: { alpha: boolean }) => SpineContext;
  GLTexture: new (context: SpineContext, image: HTMLImageElement) => SpineTexture;
  SceneRenderer: new (canvas: HTMLCanvasElement, context: SpineContext) => SpineSceneRenderer;
  readonly ResizeMode: { readonly Expand: number };
}
