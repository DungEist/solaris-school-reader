import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { ReaderAudio } from '../src/audio/ReaderAudio.ts';
import { voiceAssets } from '../src/audio/AudioManifest.ts';
import type { AudioManifest } from '../src/audio/AudioManifest.ts';
import type { RunnerEvent, RunnerSnapshot } from '../src/engine/types.ts';
import { greetingRows } from '../src/engine/RoleGreetings.ts';
import { initialStoryState } from '../src/engine/StoryState.ts';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import { FakeClock } from './FakeClock.ts';
import { fixture, manifest as scriptManifest, node } from './fixtures.ts';
const manifest = JSON.parse(readFileSync('public/data/maps/audio-playback.json', 'utf8')) as AudioManifest;
manifest.unresolvedEvents = { ...manifest.unresolvedEvents, play_avg_music_missing_fixture: { kind: 'music', reason: 'Unavailable fixture' } };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('actual media manifest separates controls, voice, music and effects, and retains unresolved cues', () => {
  const research = JSON.parse(readFileSync('public/data/maps/audio.json', 'utf8'));
  for (const cue of Object.keys(research)) assert.ok(manifest.events[cue] || manifest.unresolved[cue], cue);
  assert.equal(manifest.events.play_avg_music_3_8_slience.action, 'silence');
  assert.equal(manifest.events.stop_ui_solarschool_avg_heartbeat_loop.action, 'stop');
  assert.ok(voiceAssets(manifest, 'none', 0, 'ja', 'male', ['play_vo_avg_3_8_changli_01']).length);
  assert.equal(voiceAssets(manifest, 'none', 0, 'ja', 'male', ['play_ui_solarschool_avg_mood_shock', 'play_avg_music_3_8_funny_03']).length, 0);
  for (const line of Object.values(manifest.lines)) for (const asset of Object.values(line.variants)) assert.ok(manifest.assets[asset]);
  for (const asset of Object.values(manifest.assets)) assert.ok(existsSync(`public/${asset.url}`), asset.url);
  assert.equal(manifest.events.play_avg_music_3_8_funny_03.clips?.length, 1, 'transition clip must not enter the main playlist');
  assert.equal(manifest.events.play_avg_music_3_8_cafe_day.clips?.[0].loop, false);
  assert.equal(manifest.events.play_avg_music_3_8_cafe_day.clips?.[1].loop, true);
  assert.equal(manifest.events.play_avg_music_3_8_op_ending.loop, false);
  assert.equal(manifest.events.play_avg_music_3_8_cafe_night.clips?.[0].loop, true, 'the repeating root repeats its finite leaf');
});
function harness(slow = false) {
  let eventListener: (e: RunnerEvent) => void = () => {}; let stateListener = () => {};
  let snapshot = { runId: 1, sceneId: 1, status: 'dialogue', stagePhase: 'start', storyState: {} } as RunnerSnapshot;
  let serial = 0; let release: (() => void) | null = null;
  const sources: { stopped: boolean; start(): void; stop(): void; connect(): void; disconnect(): void; onended: unknown; loop: boolean }[] = [];
  class Context {
    state = 'suspended'; currentTime = 0; destination = {};
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createGain() { return { gain: { value: 0, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
    createBufferSource() { const s = { stopped: false, start() {}, stop() { this.stopped = true; }, connect() {}, disconnect() {}, onended: null, loop: false, playbackRate: { value: 1 } }; sources.push(s); return s; }
    async decodeAudioData() { if (slow) await new Promise<void>(r => { release = r; }); return { duration: 200, length: 96000, numberOfChannels: 1, sampleRate: 48000 }; }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'http://localhost/' } });
  const fetcher = (async (url: unknown) => String(url).includes('manifest') ? new Response(JSON.stringify(manifest)) : new Response(new Uint8Array([1, 2]))) as typeof fetch;
  const audio = new ReaderAudio({ onEvent(fn) { eventListener = fn; return () => {}; }, subscribe(fn) { stateListener = fn; return () => {}; }, getSnapshot() { return snapshot; } }, '/', fetcher);
  const emit = (body: object) => eventListener({ runId: 1, sequence: ++serial, scriptId: 'test', nid: 1, flowActionIndex: 0, ...body } as RunnerEvent);
  const cue = (cue: string, timing?: object) => emit({ type: 'stage', operation: { op: 'audio', cue }, timing });
  return { audio, sources, emit, cue, ready: async () => { await audio.load('manifest'); audio.unlock(); await tick(); }, release: () => release?.(), scene: () => { snapshot = { ...snapshot, sceneId: 2 }; stateListener(); } };
}
test('music silence preserves ambience and paired stops remove a looping effect', async () => {
  const h = harness(); await h.ready();
  h.cue('play_avg_music_3_8_cafe_day'); h.cue('play_amb_avg_solarschool_train_inside'); h.cue('play_ui_solarschool_avg_heartbeat_loop'); await tick(); await tick();
  assert.equal(h.audio.inspect().tracks.length, 3);
  h.cue('play_avg_music_3_8_slience'); h.cue('stop_ui_solarschool_avg_heartbeat_loop');
  assert.deepEqual(h.audio.inspect().tracks.map(t => t.slot), ['ambience']); h.audio.dispose();
});
test('late decode cannot resurrect an advanced voice or a scene loop', async () => {
  const h = harness(true); await h.ready(); h.cue('play_vo_avg_3_8_changli_01'); await tick();
  h.emit({ type: 'navigation' }); h.release(); await tick();
  assert.equal(h.sources.length, 0);
  h.cue('play_ui_solarschool_avg_heartbeat_loop'); await tick(); h.scene(); h.release(); await tick();
  assert.equal(h.sources.length, 0); h.audio.dispose();
});
test('checkpoint rebuilds persistent audio and never redelivers its one-shot', async () => {
  const h = harness(); await h.ready();
  h.emit({ type: 'checkpointRestored', history: [], audioHistory: ['play_amb_avg_solarschool_train_inside', 'play_ui_solarschool_avg_train_stop', 'play_ui_solarschool_avg_heartbeat_loop', '__scene__', 'play_avg_music_3_8_slience'] }); await tick(); await tick();
  assert.deepEqual(h.audio.inspect().tracks.map(t => t.slot), ['ambience']);
  assert.equal(h.audio.observations.some(o => o.cue === 'play_ui_solarschool_avg_train_stop'), false); h.audio.dispose();
});
test('early settled fast-forward one-shots are consumed, and duplicate events do not replay', async () => {
  const h = harness(); await h.ready(); h.cue('play_ui_solarschool_avg_train_stop', { delivery: 'instant', dueAtMs: 2000, appliedAtMs: 0 }); await tick();
  assert.equal(h.sources.length, 0); assert.ok(h.audio.observations.some(o => o.status === 'skipped')); h.audio.dispose();
});
test('fixed Changli greeting uses the explicit source RoleTalk and RoleSpine pair', () => {
  const source = JSON.parse(readFileSync('public/data/maps/story-source.json', 'utf8'));
  const state = { ...initialStoryState(source), dayIndex: 1, locationId: 1008, favor: { '1': { unlocked: true } } } as unknown as ReturnType<typeof initialStoryState>;
  const row = greetingRows(state, source).find(row => row.RoleId === 1);
  assert.ok(row); const spine = source.roleSpines[String(row.RoleSpineId)];
  assert.equal(spine.TextKey, 'SolarSchool_CharacterUI_FixedLocation_1_4'); assert.equal(spine.AudioId, 'play_vo_avg_3_8_changli_01');
});
test('an unresolved authored music change replaces previous BGM, including on restore', async () => {
  const h = harness(); await h.ready(); h.cue('play_avg_music_3_8_funny_03'); await tick(); await tick();
  h.cue('play_avg_music_missing_fixture');
  assert.equal(h.audio.inspect().tracks.length, 0);
  h.emit({ type: 'checkpointRestored', history: [], audioHistory: ['play_avg_music_3_8_funny_03', 'play_avg_music_missing_fixture'] });
  await tick(); assert.equal(h.audio.inspect().tracks.length, 0); h.audio.dispose();
});
test('an unviewed map request selects its character preface before the resident greeting', () => {
  const source = JSON.parse(readFileSync('public/data/maps/story-source.json', 'utf8'));
  const state = { ...initialStoryState(source), dayIndex: 1, locationId: 1008, favor: { '1': { unlocked: true } }, behaviors: { '1104': { state: 'Appeared' } } } as unknown as ReturnType<typeof initialStoryState>;
  assert.equal(greetingRows(state, source).find(row => row.RoleId === 1)?.TalkType, 3);
  assert.equal(greetingRows({ ...state, specialTalkViewed: { '1104': true } }, source).find(row => row.RoleId === 1)?.RoleSpineId, 1001);
});

test('instant delivery consumes flagged loops without reviving them on restore, and applies flagged controls', async () => {
  const runner = new ScriptRunner({ clock: new FakeClock(), instantTransitions: true });
  const h = harness(); await h.ready();
  runner.onEvent(event => h.emit(event));
  const skipped = 'play_ui_solarschool_avg_hotpoop';
  const heartbeat = 'play_ui_solarschool_avg_heartbeat_loop';
  runner.load(fixture([node(1, { stage: [
    { op: 'audio', cue: skipped, t: 1, skipOnUltraFastForward: true },
    { op: 'audio', cue: 'stop_ui_solarschool_avg_heartbeat_loop', t: 2, skipOnUltraFastForward: true },
    { op: 'audio', cue: 'play_avg_music_3_8_slience', t: 3, skipOnUltraFastForward: true },
  ] })], [{ op: 'configure', config: { initialAudio: [heartbeat, 'play_avg_music_3_8_funny_03'] } }, { op: 'talk', nids: [1] }]), scriptManifest);
  runner.start(); await tick(); await tick();
  assert.equal(h.audio.inspect().tracks.length, 0);
  const checkpoint = runner.createCheckpoint();
  assert.ok(checkpoint); assert.ok(checkpoint.snapshot.audioHistory); assert.ok(!checkpoint.snapshot.audioHistory.includes(skipped));
  assert.ok(checkpoint.snapshot.audioHistory.includes('stop_ui_solarschool_avg_heartbeat_loop'));
  runner.restoreCheckpoint(checkpoint); await tick(); await tick();
  assert.equal(h.audio.inspect().tracks.length, 0);
  assert.ok(!h.audio.observations.some(o => o.cue === skipped && o.status === 'played'));
  runner.dispose(); h.audio.dispose();
});

test('every authored music event resolves original media and spring_day loops inside its media range', () => {
  const research = JSON.parse(readFileSync('public/data/maps/audio.json', 'utf8'));
  for (const cue of Object.keys(research).filter(cue => cue.includes('music'))) {
    assert.ok(manifest.events[cue], cue);
    for (const id of manifest.events[cue].variants?.default ?? []) assert.ok(manifest.assets[id], `${cue}: ${id}`);
  }
  const spring = manifest.events.play_avg_music_3_8_spring_day;
  assert.equal(spring.kind, 'music'); assert.equal(spring.loop, true);
  assert.equal(spring.clips?.[0].offset, 2.4); assert.equal(spring.clips?.[0].duration, 103.2);
  for (const event of Object.values(manifest.events)) for (const clip of event.clips ?? [])
    assert.ok(clip.offset + clip.duration <= (manifest.assets[clip.asset] as { duration: number }).duration + .1, `${clip.asset}: authored loop excludes pre-entry silence`);
});
