/** Exercise the shared Reader voice resolver against the independent raw-source audit. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { voiceAssets } from '../src/audio/AudioManifest.ts';

const sourcePath = 'test-results/reader-voice/source-to-render.json';
const manifestPath = 'public/data/maps/audio-playback.json';
const sourceBytes = await readFile(sourcePath);
const manifestBytes = await readFile(manifestPath);
const source = JSON.parse(sourceBytes);
const manifest = JSON.parse(manifestBytes);
const cases = [], failures = [];
for (const route of source.authoredRoutes) {
  const script = JSON.parse(await readFile(`public/data/scripts/${route.scriptId}.json`, 'utf8'));
  const node = script.nodes.find(node => node.nid === route.nid);
  assert.ok(node, route.routeKey);
  assert.equal(node.textKey, route.sourceTidTalk, route.routeKey);
  assert.equal(manifest.lines[route.routeKey]?.textKey, route.sourceTidTalk, route.routeKey);
  const cues = typeof node.voice === 'string' ? [node.voice] : node.voice ?? [];
  for (const language of ['ja', 'en', 'zh', 'ko']) for (const gender of ['male', 'female']) {
    const variant = route.variants.find(variant => variant.language === language && (variant.gender === gender || variant.gender === 'any'));
    assert.ok(variant, `${route.routeKey} ${language}:${gender}`);
    const expected = variant.installedCandidate && !route.plotAudio.VarParams ? [variant.mediaId] : [];
    const actual = voiceAssets(manifest, route.scriptId, route.nid, language, gender, cues);
    const result = { routeKey: route.routeKey, textKey: route.sourceTidTalk, language, gender, expected, actual };
    cases.push(result);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(result);
  }
}
const result = {
  authority: 'actual-shared-voiceAssets-against-original-TidTalk-PlotAudio-media-audit',
  inputs: {
    source: { path: sourcePath, sha256: createHash('sha256').update(sourceBytes).digest('hex') },
    manifest: { path: manifestPath, sha256: createHash('sha256').update(manifestBytes).digest('hex') },
    resolver: { path: 'src/audio/AudioManifest.ts', sha256: createHash('sha256').update(await readFile('src/audio/AudioManifest.ts')).digest('hex') },
  },
  counts: { authoredVoicedNodes: source.authoredRoutes.length, languageGenderSelections: cases.length, discrepancies: failures.length,
    japaneseSelections: cases.filter(test => test.language === 'ja').length,
    unavailableLanguageSelections: cases.filter(test => test.language !== 'ja').length },
  targetCases: cases.filter(test => ['1001:1', '1002:1', '1002:2', '1004:3'].includes(test.routeKey)),
  failures,
};
await writeFile('test-results/reader-voice/shared-resolver.json', JSON.stringify(result, null, 2) + '\n');
assert.equal(failures.length, 0, JSON.stringify(failures));
console.log(JSON.stringify(result.counts));
