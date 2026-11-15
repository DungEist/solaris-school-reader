import type { VisualAssets } from '../assets/VisualAssets.ts';
import type { StageState } from '../engine/StageState.ts';
import type { PresentedCharacter } from '../engine/StageTransitions.ts';
import { changliAssetCache, composeChangliExpression, resolveChangli } from './ChangliAssets.ts';
import type { ChangliResolution, ChangliResources } from './ChangliAssets.ts';
import type { SchoolPortraitResolution } from './SchoolPortraitAssets.ts';
import type { CharacterState } from '../engine/StageState.ts';
import type { ChangliExpression } from './ChangliAssets.ts';
import { createChangliScene } from './ChangliSpineScene.ts';
import type { ChangliActor, ChangliFrame, ChangliScene } from './ChangliSpineScene.ts';

export interface ChangliRendererStatus { readonly kind: 'loading' | 'hidden' | 'ready' | 'fallback'; readonly reason?: string }
export type ChangliRendererStatuses = Readonly<Record<string, ChangliRendererStatus>>;
interface Entry {
  readonly key: string;
  view: PresentedCharacter;
  resolution: Exclude<ChangliResolution | SchoolPortraitResolution, { kind: 'other' }>;
  actor: ChangliActor | null;
  expressionKey: string | null;
  failedKey: string | null;
  status: ChangliRendererStatus;
}
export interface PortraitAdapterProfile {
  readonly name: string;
  resolve(character: CharacterState, assets: VisualAssets): ChangliResolution | SchoolPortraitResolution;
  compose(expression: Omit<ChangliExpression, 'blink'>, mapping: ReadonlyMap<number, ChangliExpression>): ChangliExpression;
  load(baseUrl: string): Promise<ChangliResources>;
  createScene(canvas: HTMLCanvasElement, resources: ChangliResources): ChangliScene;
}
const changliAdapterProfile: PortraitAdapterProfile = {
  name: 'Changli', resolve: resolveChangli, compose: composeChangliExpression,
  load: base => changliAssetCache.load(base), createScene: createChangliScene,
};
export interface ChangliAdapterOptions {
  profile?: PortraitAdapterProfile;
  load?(baseUrl: string): Promise<ChangliResources>;
  createScene?(canvas: HTMLCanvasElement, resources: ChangliResources): ChangliScene;
  requestFrame?(callback: (time: number) => void): number;
  cancelFrame?(id: number): void;
  onStatus?(statuses: ChangliRendererStatuses): void;
}

/** Observe persistent targets and the existing sampled presentation. No stage
 * operations/tweens are consumed or replayed here. Only blink time uses RAF. */
export class ChangliStageAdapter {
  private readonly canvas: HTMLCanvasElement;
  private readonly options: Required<Omit<ChangliAdapterOptions, 'profile'>>;
  private readonly profile: PortraitAdapterProfile;
  private readonly entries = new Map<string, Entry>();
  private runId = -1;
  private baseUrl = '';
  private scene: ChangliScene | null = null;
  private resources: ChangliResources | null = null;
  private loading = false;
  private loadTicket = 0;
  private loadError: string | null = null;
  private frameId: number | null = null;
  private frameEpoch = 0;
  private lastFrame: number | null = null;
  private statusKey = '';
  private disposed = false;
  private readonly frameDocument: Document | null;
  private readonly resetFrameTime = () => { this.lastFrame = null; };

  constructor(canvas: HTMLCanvasElement, options: ChangliAdapterOptions = {}) {
    this.canvas = canvas;
    this.frameDocument = typeof document !== 'undefined' && typeof document.addEventListener === 'function' ? document : null;
    this.frameDocument?.addEventListener('visibilitychange', this.resetFrameTime);
    this.profile = options.profile ?? changliAdapterProfile;
    this.options = {
      load: options.load ?? this.profile.load, createScene: options.createScene ?? this.profile.createScene,
      requestFrame: options.requestFrame ?? (callback => requestAnimationFrame(callback)), cancelFrame: options.cancelFrame ?? (id => cancelAnimationFrame(id)),
      onStatus: options.onStatus ?? (() => {}),
    };
  }

  sync(state: StageState, views: readonly PresentedCharacter[], assets: VisualAssets): void {
    if (this.disposed || state.runId < this.runId) return;
    if (state.runId !== this.runId || assets.baseUrl !== this.baseUrl) {
      this.cancelLoading(); this.stopFrame(); this.clearEntries();
      if (assets.baseUrl !== this.baseUrl) { this.scene?.dispose(); this.scene = null; this.resources = null; }
      this.runId = state.runId; this.baseUrl = assets.baseUrl; this.loadError = null;
    }
    const retained = new Set<string>();
    for (const view of views) {
      const character = view.character;
      const key = `${state.runId}:${character.who}:${character.entrySequence}`;
      let resolution = this.profile.resolve(character, assets);
      const previous = this.entries.get(character.who);
      if (resolution.kind === 'other' && resolution.talkerId === null && previous?.key === key) resolution = { kind: 'fallback', reason: resolution.reason ?? `${this.profile.name} expression is unavailable.` };
      if (resolution.kind === 'other' || (!character.present && view.portraitOpacity <= 0)) { this.remove(character.who); continue; }
      retained.add(character.who);
      if (previous && previous.key !== key) this.remove(character.who);
      const entry = this.entries.get(character.who) ?? { key, view, resolution, actor: null, expressionKey: null, failedKey: null, status: { kind: 'loading' as const } };
      entry.view = view; entry.resolution = resolution;
      this.entries.set(character.who, entry);
    }
    for (const who of this.entries.keys()) if (!retained.has(who)) this.remove(who);
    this.refreshActors();
    if (!this.scene && !this.loadError && this.hasPresentPortrait()) this.beginLoading();
    else if (!this.hasPresentPortrait()) this.cancelLoading();
    this.publish(); this.paint();
  }

  private hasPresentPortrait(): boolean {
    return [...this.entries.values()].some(entry => entry.resolution.kind !== 'fallback' && entry.view.character.portraitVisible);
  }

  private refreshActors(): void {
    for (const entry of this.entries.values()) {
      if (entry.resolution.kind === 'fallback') { entry.actor?.dispose(); entry.actor = null; entry.expressionKey = null; entry.status = { kind: 'fallback', reason: entry.resolution.reason }; continue; }
      if (this.loadError) { entry.actor?.dispose(); entry.actor = null; entry.status = { kind: 'fallback', reason: this.loadError }; continue; }
      // An already loaded actor may finish its source exit fade. A late load
      // cannot create one after Exit, even if a fading placeholder is visible.
      if (!entry.actor && !entry.view.character.portraitVisible) {
        entry.status = entry.view.character.present ? { kind: 'hidden', reason: `${this.profile.name} portrait is hidden.` } : { kind: 'fallback', reason: `${this.profile.name} exited before the portrait finished loading.` };
        continue;
      }
      if (!this.scene || !this.resources) { entry.status = { kind: 'loading', reason: `Loading local ${this.profile.name} portrait…` }; continue; }
      const key = JSON.stringify(entry.resolution.expression);
      if (entry.failedKey === key) continue;
      try {
        const expression = this.profile.compose(entry.resolution.expression, this.resources.expressions);
        entry.actor ??= this.scene.createActor();
        if (entry.expressionKey !== key) entry.actor.setExpression(expression);
        entry.actor.setBlinkEnabled(entry.view.character.portraitVisible);
        entry.expressionKey = key; entry.failedKey = null;
        entry.status = { kind: 'ready' };
      } catch (error) {
        entry.actor?.dispose(); entry.actor = null;
        entry.expressionKey = null; entry.failedKey = key;
        entry.status = { kind: 'fallback', reason: `${this.profile.name} unavailable: ${String(error)}` };
      }
    }
  }

  private beginLoading(): void {
    if (this.loading) return;
    this.loading = true;
    const ticket = ++this.loadTicket, runId = this.runId;
    const failed = (error: unknown) => {
      if (this.disposed || ticket !== this.loadTicket || runId !== this.runId) return;
      this.loading = false; this.loadError = `${this.profile.name} assets unavailable: ${String(error)}`;
      this.refreshActors(); this.publish(); this.paint();
    };
    let pending: Promise<ChangliResources>;
    try { pending = this.options.load(this.baseUrl); } catch (error) { failed(error); return; }
    pending.then(resources => {
      if (this.disposed || ticket !== this.loadTicket || runId !== this.runId) return;
      this.loading = false;
      if (!this.hasPresentPortrait()) return;
      try { this.scene = this.options.createScene(this.canvas, resources); this.resources = resources; }
      catch (error) { this.loadError = `${this.profile.name} renderer unavailable: ${String(error)}`; }
      this.refreshActors(); this.publish(); this.paint();
    }, failed);
  }

  private cancelLoading(): void { if (this.loading) { this.loading = false; ++this.loadTicket; } }
  private remove(who: string): void { this.entries.get(who)?.actor?.dispose(); this.entries.delete(who); }
  private clearEntries(): void { for (const who of this.entries.keys()) this.remove(who); }
  private visible(): readonly ChangliFrame[] {
    return [...this.entries.values()].filter(entry => entry.actor && entry.view.portraitOpacity > 0).map(entry => ({ actor: entry.actor!, view: entry.view }));
  }
  private publish(): void {
    const statuses = Object.fromEntries([...this.entries].map(([who, entry]) => [who, entry.status]));
    const key = JSON.stringify(statuses);
    if (key === this.statusKey || this.disposed) return;
    this.statusKey = key; this.options.onStatus(Object.freeze(statuses));
  }
  private render(delta: number): void {
    try { this.scene?.render(this.visible(), delta); }
    catch (error) {
      this.stopFrame(); this.scene?.dispose(); this.scene = null;
      this.loadError = `${this.profile.name} rendering failed: ${String(error)}`;
      this.refreshActors(); this.publish();
    }
  }
  private paint(): void {
    this.render(0);
    if (this.visible().length) this.startFrame(); else this.stopFrame();
  }
  private startFrame(): void {
    if (this.frameId !== null || this.disposed) return;
    const epoch = this.frameEpoch;
    this.frameId = this.options.requestFrame(time => {
      if (this.disposed || epoch !== this.frameEpoch) return;
      this.frameId = null;
      // Use actual visible playback time: a low frame rate must not slow an
      // authored clip. Visibility changes pause the clock without resetting
      // any actor, expression, or pending blink pause.
      const delta = this.lastFrame === null || this.frameDocument?.hidden ? 0 : Math.max(0, (time - this.lastFrame) / 1000);
      this.lastFrame = time;
      this.render(delta);
      if (this.visible().length) this.startFrame(); else this.stopFrame();
    });
  }
  private stopFrame(): void {
    if (this.frameId !== null) this.options.cancelFrame(this.frameId);
    this.frameId = null; this.lastFrame = null; ++this.frameEpoch;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.frameDocument?.removeEventListener('visibilitychange', this.resetFrameTime);
    this.cancelLoading(); this.stopFrame(); this.clearEntries(); this.scene?.dispose(); this.scene = null; this.resources = null;
  }
}
