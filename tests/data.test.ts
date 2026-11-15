import assert from 'node:assert/strict';
import test from 'node:test';
import { EnglishScriptRepository } from '../src/data/EnglishScriptRepository.ts';
import { validateIndex, validateManifest } from '../src/engine/validation.ts';
import { fixture, manifest, node } from './fixtures.ts';
import { emptyStorySource } from '../src/engine/StoryState.ts';

function repository(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const files: Record<string, unknown> = {
    'manifest.json': { ...manifest, locales: ['en', 'ja'] },
    'scripts.index.json': [{ id: 'x1', stateKey: 'state', group: 'group', nodes: 1, registered: false }],
    'locales/en.json': { 'line-1': 'Hello {PlayerName}' },
    'speakers.json': { '999': { nameKey: 'name', talkerId: null } },
    'build-report.json': { optionControlConflicts: [] },
    'scripts/x1.json': { ...fixture([node(1)]), id: 'x1' },
    'maps/story-source.json': emptyStorySource,
    ...overrides,
  };
  const reader = new EnglishScriptRepository('/data/', async url => {
    calls.push(url);
    const path = url.replace('/data/', '');
    return { ok: path in files, status: path in files ? 200 : 404, json: async () => {
      if (files[path] instanceof Error) throw files[path];
      return files[path];
    } };
  });
  return { reader, calls, files };
}

test('default browser fetch retains its global Window receiver for catalog and script requests', async t => {
  const { files } = repository();
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async function (this: unknown, input: RequestInfo | URL) {
    assert.ok(this === globalThis, 'browser fetch must be called with its global receiver');
    const url = String(input);
    calls.push(url);
    const path = url.replace('/data/', '');
    return new Response(JSON.stringify(files[path] ?? {}), {
      status: path in files ? 200 : 404,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const reader = new EnglishScriptRepository('/data/');
  assert.equal((await reader.catalog()).index[0].id, 'x1');
  assert.equal((await reader.script('x1') as { id: string }).id, 'x1');
  assert.equal(calls.length, 7);
});

test('missing or malformed story definitions leave readable scripts available and expose an explicit diagnostic', async () => {
  for (const broken of [{}, new Error('story source unavailable')]) {
    const { reader } = repository({ 'maps/story-source.json': broken });
    const catalog = await reader.catalog();
    assert.equal(catalog.storySource, emptyStorySource);
    assert.ok(catalog.storySourceError);
    assert.equal((await reader.script('x1') as { id: string }).id, 'x1');
  }
});

test('catalog loads schema 2 English only; scripts load lazily and repeated subscriptions reuse requests', async () => {
  const { reader, calls } = repository();
  const [first, second] = await Promise.all([reader.catalog(), reader.catalog()]);
  assert.equal(first, second);
  assert.equal(calls.filter(url => url.endsWith('manifest.json')).length, 1);
  assert.equal(calls.some(url => url.includes('/scripts/')), false);
  assert.equal(calls.some(url => url.includes('/ja.json')), false);
  assert.equal(first.index[0].id, 'x1');
  const script = await reader.script('x1');
  assert.equal(script, await reader.script('x1'));
  assert.equal(calls.filter(url => url.includes('/scripts/')).length, 1);
});

test('unknown or mismatched script IDs produce contextual load errors', async () => {
  await assert.rejects(repository().reader.script('missing'), /script missing.*not present in the index/);
  await assert.rejects(repository({ 'scripts/x1.json': { id: 1 } }).reader.script('x1'), /script x1.*scripts\/x1.json.id/);
});

test('malformed JSON and malformed English values identify the data file', async () => {
  await assert.rejects(repository({ 'scripts/x1.json': new SyntaxError('bad JSON') }).reader.script('x1'), /script x1.*\/data\/scripts\/x1.json.*bad JSON/);
  await assert.rejects(repository({ 'locales/en.json': { broken: 42 } }).reader.catalog(), /locales\/en.json.broken/);
});

test('datasets with option-control conflicts are rejected before play', async () => {
  await assert.rejects(repository({ 'build-report.json': { optionControlConflicts: [{ nid: 2 }] } }).reader.catalog(), /conflicting option navigation/);
});

test('unsupported schemas, missing English, numeric IDs and duplicate IDs are rejected', () => {
  assert.throws(() => validateManifest({ ...manifest, schema: '2' }), /schema 2 is required/);
  assert.throws(() => validateManifest({ ...manifest, locales: ['ja'] }), /English locale is required/);
  assert.throws(() => validateIndex([{ id: 1001 }]), /nonempty string/);
  const index = { id: '1001', stateKey: 'state', group: 'group', nodes: 0, registered: true };
  assert.throws(() => validateIndex([index, index]), /duplicate script ID/);
});
