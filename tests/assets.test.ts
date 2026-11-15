import assert from 'node:assert/strict';
import test from 'node:test';
import { expressionTalker, resolveBackground, resolveCG, ueReferenceWebpPath } from '../src/assets/AssetResolver.ts';
import { VisualAssetRepository, validateVisualManifest, validateVisualMap } from '../src/assets/VisualAssetRepository.ts';
import { sourceRef, visualFixture } from './visual-fixtures.ts';

test('UE references remove the UI prefix and object suffix while preserving exact case/path', () => {
  assert.equal(ueReferenceWebpPath(sourceRef('HighCG', 'T_Image_Male')), 'UIResources/Common/Image/BgCgBig/Activity/Activity38/SolarSchool/HighCG/T_Image_Male.webp');
  for (const reference of ['/Game/Other/Texture.Texture', sourceRef('Bg', '../Outside'), sourceRef('Bg', 'Bad?name'), sourceRef('Bg', '%2Fother'), '/Game/Aki/UI/UIResources/Common/Image/BgCgBig/Activity/Activity38/SolarSchool/Bg/.Object']) assert.equal(ueReferenceWebpPath(reference), null);
});

test('day backgrounds default correctly; night and CG gender variants use explicit source references', () => {
  const assets = visualFixture();
  assert.ok(resolveBackground(assets, 10).url?.endsWith('/Bg/Day.webp'));
  assert.ok(resolveBackground(assets, 10, 'night').url?.endsWith('/Bg/Night.webp'));
  assert.ok(resolveCG(assets, 20, 'female').url?.endsWith('/CG/Female.webp'));
  assert.ok(resolveCG(assets, 20, 'male').url?.endsWith('/CG/Male.webp'));
  assert.equal(resolveCG(assets, 21, 'male').url, resolveCG(assets, 21, 'female').url, 'Only absent alternate source references may use the base image');
  assert.equal(expressionTalker(assets, 701), 800);
  assert.equal(expressionTalker(assets, 500), null, 'A stage who/speaker ID is not a talker ID');
});

test('missing/unverified assets and mismatched variants never yield presumed image URLs', () => {
  const assets = visualFixture();
  const missing = resolveBackground(assets, 800001);
  assert.equal(missing.url, null); assert.ok(missing.label.includes('800001')); assert.ok(missing.reason);
  const unverified = { ...assets, mapping: { ...assets.mapping!, cgs: { ...assets.mapping!.cgs, '20': { ...assets.mapping!.cgs['20'], male: { ...assets.mapping!.cgs['20'].male, status: 'unverified' as const } } } } };
  assert.equal(resolveCG(unverified, 20, 'male').url, null);
  assert.ok(resolveCG(unverified, 20, 'female').url, 'A missing male image must not hide the female mapping');
  const mismatched = { ...assets, mapping: { ...assets.mapping!, backgrounds: { ...assets.mapping!.backgrounds, '10': { ...assets.mapping!.backgrounds['10'], night: assets.mapping!.backgrounds['10'].day } } } };
  assert.match(resolveBackground(mismatched, 10, 'night').reason!, /does not match/);
  assert.equal(resolveBackground(mismatched, 10, 'night').url, null);
});

test('asset repository isolates errors from English playback and reuses requests during rerenders', async () => {
  const assets = visualFixture(); const calls: string[] = [];
  const repository = new VisualAssetRepository('/data', '/assets/solarschool', async url => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => url.endsWith('assets.manifest.json') ? assets.manifest : assets.mapping };
  });
  const first = repository.load(); assert.equal(first, repository.load());
  const loaded = await first;
  assert.deepEqual(calls, ['/data/assets.manifest.json', '/assets/solarschool/asset-map.json']);
  assert.equal(loaded.issues.length, 0); assert.ok(Object.isFrozen(loaded.manifest));
  const unavailable = await new VisualAssetRepository('/data', '/assets', async url => {
    if (url.includes('assets.manifest.json')) return { ok: true, status: 200, json: async () => assets.manifest };
    throw new Error('HTTP asset cache unavailable');
  }).load();
  assert.equal(unavailable.mapping, null);
  assert.equal(expressionTalker(unavailable, 701), 800);
  assert.ok(unavailable.issues[0].includes('asset cache unavailable'));
  assert.equal(resolveBackground(unavailable, 10).url, null);
});

test('asset repository wraps global fetch so browser requests retain the Window receiver', async () => {
  const original = globalThis.fetch;
  const assets = visualFixture();
  globalThis.fetch = async function(url) {
    assert.equal(this, globalThis);
    return new Response(JSON.stringify(String(url).endsWith('assets.manifest.json') ? assets.manifest : assets.mapping));
  };
  try { assert.equal((await new VisualAssetRepository('/data', '/assets').load()).issues.length, 0); }
  finally { globalThis.fetch = original; }
});

test('malformed asset maps give field context and stay nonblocking', async () => {
  assert.throws(() => validateVisualManifest({ backgrounds: { '10': { day: 3 } }, cgs: {}, expressions: {} }), /backgrounds.10.day/);
  assert.throws(() => validateVisualMap({ ...visualFixture().mapping, schema: 2 }), /asset map schema 1/);
  const map: any = structuredClone(visualFixture().mapping);
  map.cgs['20'].male.sha256 = 'not-a-hash';
  assert.throws(() => validateVisualMap(map), /cgs.20.male.*SHA-256/);
  const repository = new VisualAssetRepository('/data', '/assets', async url => ({ ok: true, status: 200, json: async () => url.endsWith('assets.manifest.json') ? visualFixture().manifest : map }));
  const loaded = await repository.load();
  assert.equal(loaded.mapping, null); assert.match(loaded.issues[0], /cgs.20.male/);
});

