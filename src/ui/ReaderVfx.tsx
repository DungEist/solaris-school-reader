import { useLayoutEffect, useRef } from 'react';
import type { VisualAssets } from '../assets/VisualAssets.ts';
import { readerVfxImage, readerVfxTexture } from '../assets/ReaderVfxAssets.ts';
import type { ReaderVfxImage } from '../assets/ReaderVfxAssets.ts';
import type { PresentedStageEffect, StageEffectsSnapshot } from '../engine/StageEffects.ts';
import type { StageEffectDefinition } from '../engine/StageEffects.ts';

const fraction = (value: number) => value - Math.floor(value);
const random = (seed: number, index: number) => fraction(Math.sin(seed * 13.17 + index * 73.43) * 43758.5453);

/** Native LGUI/material effects have no standalone sprite. These explicit
 * projections provide onset and motion without misusing noise/VAT bitmaps.
 * Native shader geometry and curves remain unverified in the catalog. */
function drawMaterial(ctx: CanvasRenderingContext2D, renderer: NonNullable<StageEffectDefinition['readerRenderer']>, effect: PresentedStageEffect, now: number, width: number, height: number) {
  const seconds = Math.max(0, now - effect.startedAtMs) / 1000;
  const progress = effect.durationMs ? Math.min(1, seconds * 1000 / effect.durationMs) : 0;
  if (effect.durationMs && progress >= 1) return;
  const envelope = effect.persistent ? 1 : Math.min(1, seconds * 18 + .15) * Math.min(1, (1 - progress) * 5);
  ctx.save();
  if (renderer === 'danger' || renderer === 'black') {
    const danger = renderer === 'danger';
    const pulse = danger ? .24 + .10 * Math.sin(seconds * 5) : .72 * (1 - progress);
    const color = danger ? '165,12,32' : '0,0,0';
    const edge = ctx.createRadialGradient(width / 2, height / 2, height * .12, width / 2, height / 2, Math.max(width, height) * .58);
    edge.addColorStop(0, `rgba(${color},0)`); edge.addColorStop(.55, `rgba(${color},${pulse * .2})`); edge.addColorStop(1, `rgba(${color},${pulse})`);
    ctx.globalAlpha = envelope; ctx.fillStyle = edge; ctx.fillRect(0, 0, width, height);
    // Moving edge bands keep persistent Danger visibly alive. Black's
    // contracting vignette is a finite burst, independent of screen fades.
    const inset = danger ? height * (.02 + .012 * Math.sin(seconds * 3)) : height * progress * .12;
    ctx.strokeStyle = `rgba(${color},${pulse * .55})`; ctx.lineWidth = height * .025;
    ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
  } else {
    const black = renderer === 'speed-line-black';
    ctx.strokeStyle = black ? '#101015' : '#fff';
    ctx.lineCap = 'round';
    for (let i = 0; i < 72; i++) {
      const angle = i / 72 * Math.PI * 2 + random(effect.event.sequence, i) * .045;
      const phase = fraction(seconds * (black ? 3 : 2) + random(effect.event.sequence + 7, i));
      const inner = .24 + phase * .38, outer = inner + .1 + random(effect.event.sequence, i) * .14;
      ctx.globalAlpha = envelope * (.2 + .55 * Math.sin(phase * Math.PI));
      ctx.lineWidth = Math.max(1, width * (.0008 + random(effect.event.sequence, i) * .002));
      ctx.beginPath();
      ctx.moveTo(width / 2 + Math.cos(angle) * width * inner, height / 2 + Math.sin(angle) * height * inner);
      ctx.lineTo(width / 2 + Math.cos(angle) * width * outer, height / 2 + Math.sin(angle) * height * outer);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function sprite(ctx: CanvasRenderingContext2D, image: HTMLImageElement, asset: ReaderVfxImage, elapsed: number, x: number, y: number, size: number, rotation: number, alpha: number, variant = 0) {
  const columns = asset.columns ?? 1, rows = asset.rows ?? 1;
  const cells = asset.cells;
  const index = asset.atlasMode === 'flipbook' ? Math.floor(elapsed / 70) : variant;
  const frame = cells?.length ? cells[index % cells.length] : index % (columns * rows);
  const width = image.naturalWidth / columns, height = image.naturalHeight / rows;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rotation); ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.drawImage(image, frame % columns * width, Math.floor(frame / columns) * height, width, height, -size / 2, -size * height / width / 2, size, size * height / width);
  ctx.restore();
}

function butterflySprite(ctx: CanvasRenderingContext2D, image: HTMLImageElement, elapsed: number, x: number, y: number, size: number, rotation: number, alpha: number, phase: number) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rotation);
  ctx.globalAlpha = alpha; ctx.scale(.25 + Math.abs(Math.sin(elapsed / 1000 * 16 + phase)) * .75, 1);
  // The source mesh albedo contains one wing, hinged at its right edge. The
  // bitmap preview mirrors that exact wing; it does not simulate the VAT mesh.
  ctx.drawImage(image, -size / 2, -size / 2, size / 2, size);
  ctx.scale(-1, 1); ctx.drawImage(image, -size / 2, -size / 2, size / 2, size);
  ctx.restore();
}

/** A bitmap projection of resolved native sprites. Native Niagara, VAT mesh
 * animation and material curves remain explicitly unverified in the manifest.
 * Each preview's elapsed time comes from the engine-owned cue, including after
 * asset loading, resize and checkpoint restore; mounting never starts a cue. */
function drawEffect(ctx: CanvasRenderingContext2D, effect: PresentedStageEffect, image: HTMLImageElement, asset: ReaderVfxImage, now: number, width: number, height: number) {
  const elapsed = Math.max(0, now - effect.startedAtMs), seconds = elapsed / 1000;
  const progress = effect.durationMs ? Math.min(1, elapsed / effect.durationMs) : 0;
  if (effect.durationMs && progress >= 1) return;
  const seed = effect.event.sequence;
  const name = effect.name;
  if (name === 'UiItem_FxLoop_Fog') {
    // The exact noise dependency drives this explicit material projection;
    // it is not treated as an alpha sprite. Native fog shading is unverified.
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (let layer = 0; layer < 2; layer++) {
      const size = Math.max(width, height) * (.8 + layer * .35);
      const x = fraction(seconds * (.018 + layer * .007)) * size;
      const y = fraction(seconds * (.012 + layer * .005)) * size;
      ctx.globalAlpha = layer ? .07 : .14;
      for (let row = -1; row < 2; row++) for (let col = -1; col < 2; col++) ctx.drawImage(image, col * size + x, row * size + y, size, size);
    }
    ctx.restore(); return;
  }
  if (name === 'UiItem_FxLoop_BUG') {
    const tick = Math.floor(seconds * 12);
    sprite(ctx, image, asset, elapsed, width * (.5 + (random(seed, tick) - .5) * .02), height * (.5 + (random(seed + 1, tick) - .5) * .012), width * 1.05, 0, .22 + Math.sin(seconds * 7) * .06, tick);
    return;
  }
  if (name === 'UiItem_FxStart_Sound') {
    for (let i = 0; i < 12; i++) {
      const r = random(seed, i), r2 = random(seed + 3, i);
      const alpha = Math.min(1, seconds * 8) * Math.min(1, (1 - progress) * 5) * (.45 + r * .35);
      sprite(ctx, image, asset, elapsed, width * (.3 + r * .4 + Math.sin(seconds * 2 + i) * .02), height * (.5 + r2 * .25 - seconds * .18), width * (.026 + r2 * .014), Math.sin(seconds + i) * .18, alpha, i);
    }
    return;
  }
  if (/SunGlow|Bright|Light|Dark/i.test(name)) {
    ctx.save();
    ctx.globalCompositeOperation = /Dark/i.test(name) ? 'source-over' : 'screen';
    ctx.globalAlpha = .13 + Math.sin(seconds * 1.1) * .025;
    const span = Math.max(width, height) * 1.5;
    ctx.filter = `blur(${Math.max(2, width / 85)}px)`;
    for (let i = 0; i < 3; i++) sprite(ctx, image, asset, elapsed, width * (.24 + i * .35), height * (.06 + i * .1), span, -.25 + i * .2, .14 + Math.sin(seconds + i) * .025, i);
    ctx.restore();
    return;
  }
  const butterfly = /Butterfly/i.test(name), firework = /Fire|YanHua|Spark/i.test(name);
  const snow = /Snow|Xue/i.test(name), rain = /Rain|Yu/i.test(name) && !/Huaban/i.test(name);
  const count = butterfly ? 12 : firework ? 28 : 24;
  const life = effect.durationMs ? Math.min(effect.durationMs / 1000, 2.2) : snow || rain ? 4 : 6;
  for (let i = 0; i < count; i++) {
    const r = random(seed, i), r2 = random(seed + 9, i), phase = effect.persistent ? fraction(seconds / life + r) : Math.max(0, seconds / life - r * .14);
    if (!effect.persistent && phase > 1) continue;
    const alpha = effect.persistent ? .35 + r * .4 : Math.min(1, seconds * 8) * Math.min(1, (1 - progress) * 5) * (.45 + r * .5);
    let x = width * (r + Math.sin(seconds * 1.4 + i) * .055), y = height * (phase * 1.2 - .1);
    let size = width * (butterfly ? .027 + r2 * .016 : firework ? .012 + r2 * .017 : .012 + r2 * .013);
    if (butterfly) { x = width * (phase * 1.1 + r * .22 - .15); y = height * (.15 + r2 * .5 + Math.sin(seconds * 2 + i) * .085); }
    if (firework) { const angle = r * Math.PI * 2, radius = Math.min(.45, phase) * width; x = width * .5 + Math.cos(angle) * radius; y = height * .35 + Math.sin(angle) * radius * .5 + phase * height * .4; }
    if (rain) size *= .65;
    if (butterfly) butterflySprite(ctx, image, elapsed, x, y, size, Math.sin(seconds * 2 + i) * .3, alpha, i);
    else sprite(ctx, image, asset, elapsed, x, y, size, seconds * (.4 + r) + i, alpha, i);
  }
}

export function ReaderVfx({ effects, assets }: { effects: StageEffectsSnapshot; assets: VisualAssets }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef({ effects, assets });
  current.current = { effects, assets };
  const screens = effects.active.filter(effect => effect.target === 'screen');
  useLayoutEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const ctx = node.getContext('2d');
    if (!ctx) { node.dataset.rendererState = 'unavailable'; return; }
    const images = new Map<string, { image: HTMLImageElement; asset: ReaderVfxImage }>();
    const failed = new Set<string>();
    let frame = 0, disposed = false;
    const resize = () => {
      const rect = node.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      node.width = Math.max(1, Math.round(rect.width * dpr)); node.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(node);
    const draw = () => {
      if (disposed) return;
      const { effects, assets } = current.current;
      ctx.clearRect(0, 0, node.width, node.height);
      const now = performance.now();
      let drawn = 0;
      for (const effect of effects.active) {
        if (effect.target !== 'screen') continue;
        if (effect.type === 'Custom' && effect.customType === 'BurstEye') {
          const p = effect.durationMs ? Math.min(1, (now - effect.startedAtMs) / effect.durationMs) : 1;
          // Original BurstEye dispatches EyeOpen. Its aperture curve is a
          // documented preview until the native sequence is decoded.
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, node.width, node.height * Math.max(0, .5 - p / 2));
          ctx.fillRect(0, node.height * (.5 + p / 2), node.width, node.height * Math.max(0, .5 - p / 2));
          drawn++; continue;
        }
        const definition = effect.path ? assets.vfx?.effects[effect.path] : null;
        if (definition?.readerRenderer && definition.readerRenderer !== 'fog') {
          drawMaterial(ctx, definition.readerRenderer, effect, now, node.width, node.height); drawn++; continue;
        }
        const asset = definition ? readerVfxImage(definition) : null;
        if (!asset || failed.has(asset.url)) continue;
        let cached = images.get(asset.url);
        if (!cached) {
          const prefix = assets.baseUrl.replace(/assets\/solarschool\/?$/, '');
          const texture = readerVfxTexture(prefix, asset);
          if (texture.error) { failed.add(asset.url); continue; }
          cached = { image: texture.image, asset }; images.set(asset.url, cached);
        }
        if (cached.image.complete && cached.image.naturalWidth === asset.width && cached.image.naturalHeight === asset.height) {
          drawEffect(ctx, effect, cached.image, asset, now, node.width, node.height); drawn++;
        }
      }
      node.dataset.rendererState = drawn ? 'ready' : 'waiting';
      node.dataset.drawnEffects = String(drawn);
      node.dataset.loadedImages = [...images.values()].filter(entry => entry.image.complete && entry.image.naturalWidth > 0).map(entry => entry.asset.sourceRef).join('|');
      node.dataset.imageErrors = [...failed].join('|');
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      images.clear(); ctx.clearRect(0, 0, node.width, node.height);
    };
  }, []);
  return <div className="reader-vfx-layer" aria-hidden="true" data-testid="reader-vfx" data-active-effects={screens.length}>
    <canvas ref={canvas} className="reader-vfx-canvas" data-testid="reader-vfx-canvas" />
    {screens.map(effect => <span hidden key={effect.id} data-testid="reader-vfx-cue" data-effect-id={effect.id} data-effect-name={effect.name} data-effect-type={effect.type} data-effect-path={effect.path ?? ''} data-custom-type={effect.customType ?? ''} data-persistent={effect.persistent} data-start-time={effect.event.operation.t} data-started-at={effect.startedAtMs} data-source-order={effect.event.timing?.sourceOrder ?? ''} data-elapsed-ms={effect.elapsedMs} data-asset-verified={effect.path ? assets.vfx?.effects[effect.path]?.sourceVerified ?? false : ''} data-behavior-verified={effect.path ? assets.vfx?.effects[effect.path]?.behaviorVerified ?? false : false} />)}
  </div>;
}
