import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import type { RunnerEvent } from '../src/engine/types.ts';
import { ReaderPresentations } from '../src/ui/ReaderPresentations.ts';
import type { ReaderPresentationSource } from '../src/ui/ReaderPresentations.ts';
import { FakeClock } from './FakeClock.ts';
import { fixture, manifest, node } from './fixtures.ts';

const definitions: ReaderPresentationSource = {
  schema: 1,
  introductions: { '12': { id: 12, nameKey: 'abby', influenceKey: 'uncle', textKey: 'introduction', color: '95a55b' } },
  lettersByAction: { '1107': { id: 2100, pages: [{ id: 21000, paragraphKeys: ['cookie'] }] } },
  english: { cookie: 'Bạn cắn một miếng bánh quy.' },
};
const letterOp = { op: 'activityAction', kind: 'SolarSchool', actionId: 1107, t: 0 };

test('introduction uses its delivered source duration while rerenders leave engine events and stage positions intact', () => {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock });
  const presentations = new ReaderPresentations(runner, clock);
  presentations.setSource(definitions);
  runner.load(fixture([node(1, { stage: [
    { op: 'enter', who: '1316', expr: 700028, pos: [0, 420, .75], t: 0 },
    { op: 'roleIntro', introId: 12, dur: 5, t: 0 },
  ] })]), manifest); runner.start();
  try {
    const notice = presentations.getSnapshot().introduction;
    assert.equal(notice?.definition.id, 12);
    const before = runner.getSnapshot();
    for (let i = 0; i < 20; i++) assert.equal(presentations.getSnapshot().introduction, notice);
    assert.equal(runner.getSnapshot(), before);
    clock.advanceBy(4999);
    assert.equal(presentations.getSnapshot().introduction, notice);
    clock.advanceBy(1);
    assert.equal(presentations.getSnapshot().introduction, null);
    assert.equal(runner.getSnapshot().stageEvents.filter(e => e.operation.op === 'roleIntro').length, 1);
    assert.deepEqual(runner.getSnapshot().stageState.characters['1316'].position, before.stageState.characters['1316'].position);
  } finally { presentations.dispose(); runner.dispose(); }
});

test('duplicate delivery, confirmations and view subscriptions never replay a letter or mutate the shared session', () => {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock });
  let replay: ((event: RunnerEvent) => void) | undefined;
  const source = { getSnapshot: runner.getSnapshot, subscribe: runner.subscribe, onEvent: (listener: (event: RunnerEvent) => void) => { replay = listener; return runner.onEvent(listener); } };
  const presentations = new ReaderPresentations(source, clock);
  presentations.setSource(definitions);
  runner.load(fixture([node(1, { stage: [letterOp, { ...letterOp, t: .1 }] })]), manifest); runner.start();
  clock.advanceBy(100);
  try {
    assert.equal(presentations.getSnapshot().letters.length, 2, 'distinct delivered source events are preserved');
    const first = presentations.getSnapshot().letters[0];
    const event = runner.getSnapshot().stageEvents.find(e => e.sequence === first.stageSequence)!;
    const before = runner.getSnapshot();
    replay!(event); replay!(event);
    assert.equal(presentations.getSnapshot().letters.length, 2);
    const unsubscribe = presentations.subscribe(() => {}); unsubscribe();
    presentations.dismissLetter('stale');
    presentations.dismissLetter(first.id); presentations.dismissLetter(first.id);
    assert.equal(presentations.getSnapshot().letters.length, 1);
    presentations.dismissLetter(presentations.getSnapshot().letters[0].id);
    replay!(event);
    assert.equal(presentations.getSnapshot().letters.length, 0);
    assert.equal(runner.getSnapshot(), before, 'UI confirmation cannot execute engine commands');
    runner.restart();
    const current = presentations.getSnapshot().letters[0];
    assert.notEqual(current.id, first.id);
    presentations.dismissLetter(first.id);
    assert.equal(presentations.getSnapshot().letters[0], current);
  } finally { presentations.dispose(); runner.dispose(); }
});

test('late presentation data does not replay an expired introduction; actual letters wait for their data', () => {
  const clock = new FakeClock(), runner = new ScriptRunner({ clock });
  const presentations = new ReaderPresentations(runner, clock);
  runner.load(fixture([node(1, { stage: [{ op: 'roleIntro', introId: 12, dur: 5, t: 0 }, letterOp] })]), manifest); runner.start();
  clock.advanceBy(6000);
  try {
    presentations.setSource(definitions);
    assert.equal(presentations.getSnapshot().introduction, null);
    assert.equal(presentations.getSnapshot().letters.length, 1);
    presentations.setSource({ ...definitions });
    assert.equal(presentations.getSnapshot().letters.length, 1);
    runner.load(fixture([node(2, { stage: [
      { op: 'activityAction', kind: 'SolarSchool', actionId: 7087, t: 0 },
      { op: 'activityAction', kind: 'SolarSchool', actionId: 99999, t: 0 },
      { op: 'roleIntro', introId: 12, t: 0 },
    ] })]), manifest); runner.start();
    assert.equal(presentations.getSnapshot().introduction, null, 'missing display duration is not invented');
    assert.equal(presentations.getSnapshot().letters.length, 0, 'unsupported results and metadata are not notices');
  } finally { presentations.dispose(); runner.dispose(); }
});

test('real 14237 letter waits for its end-phase delivery; confirmation and restart preserve the engine lifecycle', async () => {
  const json = async (path: string) => JSON.parse(await readFile(new URL(`../public/data/${path}`, import.meta.url), 'utf8'));
  const [script, realManifest, source] = await Promise.all([json('scripts/14237.json'), json('manifest.json'), json('reader-presentations.json')]);
  const clock = new FakeClock(), runner = new ScriptRunner({ clock });
  const presentations = new ReaderPresentations(runner, clock);
  presentations.setSource(source);
  try {
    assert.equal(runner.load(script, realManifest), true);
    assert.equal(runner.start(), true); clock.advanceBy(2000);
    for (let i = 0; runner.getSnapshot().nid !== 3 && i < 5; i++) {
      assert.equal(runner.advance(), true); clock.advanceBy(2000);
    }
    assert.equal(runner.getSnapshot().nid, 3);
    // This isolates the authored letter's presentation timing after a scene
    // jump; currency eligibility is exercised by the normal-play route suite.
    assert.equal(runner.overrideChoice(0), true, 'explicit developer traversal of the source Buy a handmade cookie branch'); clock.advanceBy(2000);
    assert.equal(runner.getSnapshot().choiceHistory.at(-1)?.decision, 'debug-override');
    for (let i = 0; runner.getSnapshot().nid !== 7 && i < 5; i++) {
      assert.equal(runner.advance(), true); clock.advanceBy(2000);
    }
    assert.equal(runner.getSnapshot().nid, 7);
    assert.equal(presentations.getSnapshot().letters.length, 0, 'entering the node cannot deliver its end operation');
    assert.equal(runner.advance(), true); clock.advanceBy(2000);
    const notices = presentations.getSnapshot().letters;
    assert.equal(notices.length, 1);
    assert.equal(notices[0].definition.id, 2100);
    const before = runner.getSnapshot();
    assert.equal(before.status, 'completed', 'the requested source departure continues behind the notice');
    const delivered = before.stageEvents.filter(event => event.operation.op === 'activityAction' && event.operation.actionId === 1107);
    assert.equal(delivered.length, 1); assert.equal(delivered[0].phase, 'end');
    presentations.dismissLetter(notices[0].id);
    assert.equal(runner.getSnapshot(), before);
    assert.equal(runner.restart(), true); clock.advanceBy(2000);
    assert.equal(presentations.getSnapshot().letters.length, 0);
    assert.equal(runner.getSnapshot().nid, 1);
  } finally { presentations.dispose(); runner.dispose(); }
});

test('exported letters retain exact source pages and localization keys, without score/rank fabrication', async () => {
  const read = async (path: string) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
  const exported = await read('public/data/reader-presentations.json');
  const [letters, pages, texts] = await Promise.all([
    read('WutheringWaves_Data/BinData/SolarSchool/solarschoolletter.json'),
    read('WutheringWaves_Data/BinData/SolarSchool/solarschoolletterpage.json'),
    read('WutheringWaves_Data/Textmaps/en/multi_text/MultiText.json'),
  ]);
  assert.equal(Object.keys(exported.introductions).length, 12);
  assert.equal(Object.keys(exported.lettersByAction).length, 10);
  assert.equal(Object.keys(exported.english).length, 30);
  for (const definition of Object.values(exported.lettersByAction) as { id: number; pages: { id: number; paragraphKeys: string[] }[] }[]) {
    const raw = letters.find((l: { Id: number }) => l.Id === definition.id);
    assert.deepEqual(definition.pages.map(p => p.id), raw.PageList.slice(raw.PageStart, raw.PageEnd + 1));
    for (const page of definition.pages) {
      assert.deepEqual(page.paragraphKeys, pages.find((p: { Id: number }) => p.Id === page.id).Paragraph);
      for (const key of page.paragraphKeys) {
        assert.equal(exported.english[key], texts.find((t: { Id: string }) => t.Id === key).Content);
        assert.ok(!/\{(?:Score|Rank):/.test(exported.english[key]));
      }
    }
  }
  assert.ok(!exported.lettersByAction['7087'] && !exported.lettersByAction['7088']);
});
