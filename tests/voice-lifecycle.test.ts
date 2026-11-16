import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ReaderAudio } from '../src/audio/ReaderAudio.ts';
import { voiceAssets } from '../src/audio/AudioManifest.ts';
import type { AudioManifest } from '../src/audio/AudioManifest.ts';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import type { RunnerEvent, Script, Speaker } from '../src/engine/types.ts';
import { DialogueBacklog } from '../src/ui/DialogueBacklog.ts';
import { FakeClock } from './FakeClock.ts';
import { fixture, manifest as scriptManifest, node } from './fixtures.ts';

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0)); };

function audioManifest(): AudioManifest {
  const assets = Object.fromEntries([
    'ja-first-male', 'ja-first-female', 'en-first-male', 'en-first-female',
    'ja-second', 'en-second', 'ja-review', 'en-review', 'ja-greeting', 'en-greeting', 'effect', 'music',
  ].map(id => [id, { url: `assets/audio/${id}.mp3`, duration: 1, source: `${id}.wem` }]));
  return {
    schema: 1, languages: ['ja', 'en'], assets,
    lines: {
      'voice-scene:1': { textKey: 'line-1', variants: { 'ja:male': 'ja-first-male', 'ja:female': 'ja-first-female', 'en:male': 'en-first-male', 'en:female': 'en-first-female' } },
      'voice-scene:2': { textKey: 'line-2', variants: { 'ja:any': 'ja-second', 'en:any': 'en-second' } },
      'review-scene:40': { textKey: 'historical-line', variants: { 'ja:any': 'ja-review', 'en:any': 'en-review' } },
    },
    events: {
      play_vo_fixture_greeting: { kind: 'voice', action: 'play', variants: { ja: ['ja-greeting'], en: ['en-greeting'] } },
      stop_vo_fixture_greeting: { kind: 'voice', action: 'stop', target: 'play_vo_fixture_greeting' },
      silence_voice_fixture: { kind: 'voice', action: 'silence' },
      play_fixture_effect: { kind: 'effects', action: 'play', variants: { default: ['effect'] } },
      play_fixture_music: { kind: 'music', action: 'play', loop: true, variants: { default: ['music'] } },
    },
    roleSpines: {}, locationAmbience: {}, unresolved: {},
  };
}
const ordinaryScript = (): Script => ({ ...fixture([node(1), node(2, { next: { type: 'end' } })]), id: 'voice-scene' });

interface TestBuffer { assetId: string; duration: number; length: number; sampleRate: number; numberOfChannels: number; }
class TestSource {
  buffer: TestBuffer | null = null;
  loop = false;
  playbackRate = { value: 1 };
  started = false;
  stopped = false;
  onended: (() => void) | null = null;
  connect() {}
  disconnect() {}
  start() { this.started = true; }
  stop() { this.stopped = true; }
  end() { this.onended?.(); }
}

/** Mock media decoding observes asset selection and source lifetime only.
 * Commands, event batching, snapshots, visits and scene changes use ScriptRunner. */
function harness(t: TestContext, options: { manifest?: AudioManifest; script?: Script; deferManifest?: boolean; deferResume?: boolean; deferDecode?: boolean } = {}) {
  const manifest = options.manifest ?? audioManifest();
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock });
  const manifestGate = deferred(), resumeGate = deferred();
  const decodeGates = new Map<string, ReturnType<typeof deferred>>();
  const sources: TestSource[] = [], decoding: string[] = [], fetches: string[] = [], events: RunnerEvent[] = [];
  const ids = Object.keys(manifest.assets);
  const byUrl = new Map(ids.map(id => [new URL(manifest.assets[id].url, 'http://reader.test/').href, id]));
  let context: Context | null = null;
  class Context {
    state = 'suspended'; currentTime = 0; destination = {};
    constructor() { context = this; }
    async resume() { if (options.deferResume) await resumeGate.promise; if (this.state !== 'closed') this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createGain() { return { gain: { value: 0, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
    createBufferSource() { const source = new TestSource(); sources.push(source); return source; }
    async decodeAudioData(bytes: ArrayBuffer): Promise<TestBuffer> {
      const id = ids[new DataView(bytes).getUint32(0, true)];
      assert.ok(id, 'the decoder receives a fetched manifest asset');
      decoding.push(id);
      if (options.deferDecode) {
        const gate = decodeGates.get(id) ?? deferred(); decodeGates.set(id, gate); await gate.promise;
      }
      return { assetId: id, duration: 1, length: 48_000, sampleRate: 48_000, numberOfChannels: 1 };
    }
  }
  const oldContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const oldLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'http://reader.test/' } });
  const fetcher = (async (url: unknown) => {
    fetches.push(String(url));
    if (String(url) === 'manifest') {
      if (options.deferManifest) await manifestGate.promise;
      return new Response(JSON.stringify(manifest));
    }
    const id = byUrl.get(String(url)); assert.ok(id, `unexpected audio fetch: ${String(url)}`);
    const bytes = new ArrayBuffer(4); new DataView(bytes).setUint32(0, ids.indexOf(id), true);
    return new Response(bytes);
  }) as typeof fetch;
  let deliverEvent: (event: RunnerEvent) => void = () => {};
  const audio = new ReaderAudio({
    getSnapshot: runner.getSnapshot,
    subscribe: runner.subscribe,
    onEvent(listener) { deliverEvent = listener; return runner.onEvent(listener); },
  }, '/', fetcher);
  runner.onEvent(event => events.push(event));
  const loading = audio.load('manifest');
  t.after(async () => {
    audio.dispose(); runner.dispose();
    manifestGate.release(); resumeGate.release(); for (const gate of decodeGates.values()) gate.release();
    await loading; await settle();
    if (oldContext) Object.defineProperty(globalThis, 'AudioContext', oldContext); else Reflect.deleteProperty(globalThis, 'AudioContext');
    if (oldLocation) Object.defineProperty(globalThis, 'location', oldLocation); else Reflect.deleteProperty(globalThis, 'location');
  });
  return {
    audio, runner, clock, loading, sources, decoding, fetches, events,
    context: () => { assert.ok(context); return context; },
    start: () => { assert.equal(runner.load(options.script ?? ordinaryScript(), scriptManifest), true); assert.equal(runner.start(), true); },
    releaseManifest: manifestGate.release,
    releaseResume: resumeGate.release,
    releaseDecode: (id?: string) => { if (id) decodeGates.get(id)?.release(); else for (const gate of decodeGates.values()) gate.release(); },
    startedIds: () => sources.filter(source => source.started).map(source => source.buffer?.assetId),
    deliverEvent: (event: RunnerEvent) => deliverEvent(event),
  };
}

for (const kind of ['line', 'review'] as const) for (const firstReady of ['manifest', 'resume'] as const) {
  test(`${kind} voice survives both deferred gates when ${firstReady} becomes ready first`, async t => {
    const h = harness(t, { deferManifest: true, deferResume: true });
    h.audio.unlock(); h.start();
    if (kind === 'review') h.audio.replay('review-scene', 40);
    assert.equal(h.events.filter(event => event.type === 'dialogue').length, 1);
    assert.deepEqual(h.startedIds(), []);
    if (firstReady === 'manifest') { h.releaseManifest(); await h.loading; } else { h.releaseResume(); await settle(); }
    await settle(); assert.deepEqual(h.startedIds(), [], 'one readiness gate must not start playback');
    if (firstReady === 'manifest') h.releaseResume(); else h.releaseManifest();
    await h.loading; await settle();
    assert.deepEqual(h.startedIds(), [kind === 'line' ? 'ja-first-male' : 'ja-review']);
    assert.equal(h.events.filter(event => event.type === 'dialogue').length, 1, 'readiness never redelivers dialogue');
    h.audio.unlock(); await settle();
    assert.equal(h.sources.length, 1, 'repeated gestures do not replay a consumed request');
  });
}

test('the newest dialogue replaces an earlier line before manifest and unlock complete', async t => {
  const h = harness(t, { deferManifest: true, deferResume: true });
  h.audio.unlock(); h.start(); assert.equal(h.runner.advance(), true);
  assert.equal(h.runner.getSnapshot().nid, 2);
  h.releaseManifest(); h.releaseResume(); await h.loading; await settle();
  assert.deepEqual(h.startedIds(), ['ja-second']);
  assert.ok(!h.decoding.includes('ja-first-male'), 'an obsolete request does not even fetch/decode its voice');
});

test('a new visit to the same node supersedes its old pending decode', async t => {
  const script = { ...ordinaryScript(), nodes: [node(1), node(2, { next: { type: 'jump' as const, to: 1 } })] };
  const h = harness(t, { script, deferDecode: true });
  await h.loading; h.audio.unlock(); await settle(); h.start(); await settle();
  const firstVisit = h.runner.getSnapshot().visitId;
  assert.equal(h.runner.advance(), true); await settle();
  assert.equal(h.runner.advance(), true); await settle();
  assert.equal(h.runner.getSnapshot().nid, 1); assert.ok(h.runner.getSnapshot().visitId > firstVisit);
  h.releaseDecode(); await settle();
  assert.deepEqual(h.startedIds(), ['ja-first-male'], 'only the newest visit may attach the shared decoded buffer');
});

test('a restart replaces a pending first-line voice without producing two sources', async t => {
  const h = harness(t, { deferDecode: true });
  await h.loading; h.audio.unlock(); await settle(); h.start(); await settle();
  const firstRun = h.runner.getSnapshot().runId;
  assert.equal(h.runner.restart(), true); await settle();
  assert.ok(h.runner.getSnapshot().runId > firstRun);
  h.releaseDecode(); await settle();
  assert.deepEqual(h.startedIds(), ['ja-first-male']);
});

test('an old-run dialogue event cannot replace a pending historical Review request', async t => {
  const h = harness(t, { deferResume: true });
  await h.loading; h.audio.unlock(); h.start();
  const oldDialogue = h.events.find(event => event.type === 'dialogue'); assert.ok(oldDialogue);
  assert.equal(h.runner.restart(), true);
  h.audio.replay('review-scene', 40); h.deliverEvent(oldDialogue);
  h.releaseResume(); await settle();
  assert.deepEqual(h.startedIds(), ['ja-review']);
});

test('pending automatic voice selects the latest installed language and player gender', async t => {
  const h = harness(t, { deferResume: true });
  await h.loading; h.audio.unlock(); h.start();
  h.audio.gender = 'female'; h.audio.language('en');
  h.releaseResume(); await settle();
  assert.deepEqual(h.startedIds(), ['en-first-female']);
  assert.deepEqual(h.audio.resolvedVoice('voice-scene', 1, [], 'female'), ['en-first-female']);
  assert.deepEqual(voiceAssets(audioManifest(), 'voice-scene', 1, 'ko', 'female'), [], 'unavailable languages never fall back to a different language');
});

test('pending Review retains its explicit gender and uses the selected language', async t => {
  const h = harness(t, { deferResume: true });
  await h.loading; h.start(); h.audio.gender = 'male';
  h.audio.replay('voice-scene', 1, [], 'female'); h.audio.language('en');
  h.releaseResume(); await settle();
  assert.deepEqual(h.startedIds(), ['en-first-female']);
});

test('changing language cancels a decoding voice instead of attaching the old language later', async t => {
  const h = harness(t, { deferDecode: true });
  await h.loading; h.audio.unlock(); await settle(); h.start(); await settle();
  h.audio.language('en'); h.releaseDecode(); await settle();
  assert.deepEqual(h.startedIds(), []);
  h.audio.replay('voice-scene', 1); await settle(); h.releaseDecode(); await settle();
  assert.deepEqual(h.startedIds(), ['en-first-male']);
});

for (const kind of ['line', 'review'] as const) {
  test(`a still-current ${kind} voice may finish decoding after three seconds`, async t => {
    const h = harness(t, { deferDecode: true });
    await h.loading; h.audio.unlock(); await settle(); h.start();
    if (kind === 'review') h.audio.replay('review-scene', 40);
    await settle(); h.context().currentTime = 4.2; h.clock.advanceBy(4200);
    h.releaseDecode(); await settle();
    assert.deepEqual(h.startedIds(), [kind === 'line' ? 'ja-first-male' : 'ja-review']);
    assert.ok(!h.audio.observations.some(observation => observation.status === 'skipped' && observation.detail === 'Late one-shot'));
  });
}

test('the late one-shot cutoff still drops an obsolete effect while retaining current voice', async t => {
  const script = { ...ordinaryScript(), nodes: [node(1, { stage: [{ op: 'audio', cue: 'play_fixture_effect', t: 0 }] }), node(2)] };
  const h = harness(t, { script, deferDecode: true });
  await h.loading; h.audio.unlock(); await settle(); h.start(); await settle();
  h.context().currentTime = 4.2; h.releaseDecode(); await settle();
  assert.deepEqual(h.startedIds(), ['ja-first-male']);
  assert.ok(h.audio.observations.some(observation => observation.cue === 'play_fixture_effect' && observation.status === 'skipped' && observation.detail === 'Late one-shot'));
});

const cancellationCases = ['stop', 'navigation', 'new run', 'new scene', 'restore', 'stage end', 'completion', 'audio dispose', 'runner dispose'] as const;
for (const gate of ['resume', 'decode'] as const) for (const kind of ['line', 'review'] as const) {
  test(`${kind} voice cannot resurrect after cancellation while ${gate} is pending`, async t => {
    for (const cancellation of cancellationCases) await t.test(cancellation, async subtest => {
      const manifest = audioManifest(); delete manifest.lines['voice-scene:2'];
      const baseScript = ordinaryScript();
      const script = cancellation === 'stage end' ? { ...baseScript, nodes: [node(1, { stage: [{ op: 'audio', cue: 'play_fixture_effect', t: 1, phase: 'end' }] }), node(2)] } :
        cancellation === 'completion' ? { ...fixture([node(1, { next: { type: 'end' } })]), id: 'voice-scene' } : baseScript;
      const h = harness(subtest, { manifest, script, deferResume: gate === 'resume', deferDecode: gate === 'decode' });
      await h.loading; h.audio.unlock(); if (gate === 'decode') await settle(); h.start();
      if (kind === 'review') h.audio.replay('review-scene', 40);
      await settle(); assert.deepEqual(h.startedIds(), []);
      if (cancellation === 'stop') h.audio.stopVoice();
      else if (cancellation === 'navigation' || cancellation === 'stage end' || cancellation === 'completion') assert.equal(h.runner.advance(), true);
      else if (cancellation === 'new run' || cancellation === 'new scene') {
        const run = h.runner.getSnapshot().runId, scene = h.runner.getSnapshot().sceneId;
        const unvoiced = { ...fixture([node(50)]), id: 'unvoiced-scene' };
        assert.equal(h.runner.load(unvoiced, scriptManifest, { continuation: cancellation === 'new scene', preserveStoryState: true }), true);
        assert.equal(h.runner.start(), true);
        assert.ok(h.runner.getSnapshot().sceneId > scene);
        assert.equal(h.runner.getSnapshot().runId === run, cancellation === 'new scene');
      } else if (cancellation === 'restore') {
        const checkpoint = h.runner.createCheckpoint(); assert.ok(checkpoint); assert.equal(h.runner.restoreCheckpoint(checkpoint), true);
      } else if (cancellation === 'audio dispose') h.audio.dispose();
      else h.runner.dispose();
      if (cancellation === 'stage end') assert.equal(h.runner.getSnapshot().stagePhase, 'end');
      h.releaseResume(); h.releaseDecode(); await settle();
      assert.deepEqual(h.startedIds(), [], `${cancellation} must invalidate the pending source`);
      assert.ok(!h.audio.inspect().tracks.some(track => track.channel === 'voice'));
    });
  });
}

test('a restored current line stays silent after manifest readiness until explicit Review', async t => {
  const h = harness(t, { deferManifest: true });
  h.audio.unlock(); await settle(); h.start();
  const checkpoint = h.runner.createCheckpoint(); assert.ok(checkpoint);
  assert.equal(h.runner.restoreCheckpoint(checkpoint), true);
  h.releaseManifest(); await h.loading; await settle();
  assert.deepEqual(h.startedIds(), []);
  h.audio.replay('voice-scene', 1); await settle();
  assert.deepEqual(h.startedIds(), ['ja-first-male']);
});

test('voice silence cancels a pending line while its current dialogue remains open', async t => {
  const script = { ...ordinaryScript(), nodes: [node(1, { stage: [{ op: 'audio', cue: 'silence_voice_fixture', t: .1 }] }), node(2)] };
  const h = harness(t, { script, deferResume: true });
  await h.loading; h.audio.unlock(); h.start(); h.clock.advanceBy(100);
  assert.equal(h.runner.getSnapshot().nid, 1);
  h.releaseResume(); await settle(); assert.deepEqual(h.startedIds(), []);
});

test('the matching voice stop cancels a pending explicit character interaction', async t => {
  const manifest = audioManifest(); delete manifest.lines['voice-scene:1'];
  const script = { ...ordinaryScript(), nodes: [node(1, { stage: [{ op: 'audio', cue: 'stop_vo_fixture_greeting', t: .1 }] }), node(2)] };
  const h = harness(t, { manifest, script, deferResume: true });
  await h.loading; h.audio.unlock(); h.start();
  assert.equal(h.runner.presentRoleVoice('play_vo_fixture_greeting'), true); h.clock.advanceBy(100);
  h.releaseResume(); await settle(); assert.deepEqual(h.startedIds(), []);
});

test('closing Review before the first unlock completes discards its historical replay', async t => {
  const h = harness(t, { deferResume: true }); await h.loading; h.start();
  h.audio.replay('review-scene', 40); h.audio.stopVoice(); h.releaseResume(); await settle();
  assert.deepEqual(h.startedIds(), []);
});

test('an ended voice is not replayed by readiness, gestures or runner publications', async t => {
  const h = harness(t); await h.loading; h.audio.unlock(); await settle(); h.start(); await settle();
  assert.equal(h.sources.length, 1); h.sources[0].end();
  h.audio.unlock(); await h.audio.load('manifest'); h.runner.setInstantTransitions(true); await settle();
  assert.equal(h.sources.length, 1); assert.ok(!h.audio.inspect().tracks.some(track => track.channel === 'voice'));
});

const originalManifest = JSON.parse(readFileSync('public/data/maps/audio-playback.json', 'utf8')) as AudioManifest;
test('repaired source voice keeps the four literal keys and only the authored train alias', () => {
  const expected = [
    ['1004', 3, 'EVENT_AVGmain_15_3', 'ja_vo_EVENT_AVGmain_15_3.wem'],
    ['1001', 1, 'EVENT_AVGmain_1_1', 'ja_vo_EVENT_AVGmain_1_1.wem'],
    ['1002', 1, 'EVENT_AVGmain_5_1', 'ja_vo_EVENT_AVGmain_1_1.wem'],
    ['1002', 2, 'EVENT_AVGmain_5_2', 'ja_vo_EVENT_AVGmain_5_2.wem'],
  ] as const;
  for (const [script, nid, textKey, source] of expected) {
    assert.equal(originalManifest.lines[`${script}:${nid}`]?.textKey, textKey);
    const male = voiceAssets(originalManifest, script, nid, 'ja', 'male');
    assert.equal(male.length, 1); assert.ok(originalManifest.assets[male[0]].source.endsWith(`/${source}`));
    assert.deepEqual(voiceAssets(originalManifest, script, nid, 'ja', 'female'), male, 'these source rows have no gender suffix');
  }
  assert.deepEqual(voiceAssets(originalManifest, '1001', 1, 'ja', 'male'), voiceAssets(originalManifest, '1002', 1, 'ja', 'male'));
  assert.notDeepEqual(voiceAssets(originalManifest, '1002', 2, 'ja', 'male'), voiceAssets(originalManifest, '1002', 1, 'ja', 'male'));
});

test('the anonymous train speaker plays both authored lines and replays the first from history', async t => {
  const script = JSON.parse(readFileSync('public/data/scripts/1002.json', 'utf8')) as Script;
  const manifest: AudioManifest = { ...audioManifest(), lines: {}, assets: {}, events: {} };
  for (const key of ['1002:1', '1002:2']) {
    const line = originalManifest.lines[key]; assert.ok(line); manifest.lines[key] = line;
    for (const id of Object.values(line.variants)) manifest.assets[id] = originalManifest.assets[id];
  }
  const h = harness(t, { script, manifest });
  const backlog = new DialogueBacklog(h.runner); t.after(() => backlog.dispose());
  const english = JSON.parse(readFileSync('public/data/locales/en.json', 'utf8')) as Record<string, string>;
  const speakers = JSON.parse(readFileSync('public/data/speakers.json', 'utf8')) as Record<string, Speaker>;
  backlog.setTextContext(english, speakers, { playerName: 'Rover', gender: 'male' });
  await h.loading; h.audio.unlock(); await settle(); h.start(); await settle();
  const first = voiceAssets(originalManifest, '1002', 1, 'ja', 'male')[0];
  const second = voiceAssets(originalManifest, '1002', 2, 'ja', 'male')[0];
  assert.equal(h.runner.getSnapshot().dialogue?.speakerId, '701290'); assert.equal(backlog.getSnapshot()[0].speakerName, '???');
  assert.deepEqual(h.startedIds(), [first]);
  assert.equal(h.runner.advance(), true); await settle(); assert.deepEqual(h.startedIds(), [first, second]);
  const historical = backlog.getSnapshot()[0];
  assert.equal(historical.scriptId, '1002'); assert.equal(historical.nodeId, 1);
  h.audio.replay(historical.scriptId, historical.nodeId, historical.voiceCues, 'female'); await settle();
  assert.deepEqual(h.startedIds(), [first, second, first]);
  assert.equal(h.sources[1].stopped, true, 'Review replaces the automatic voice of the newer line');
});
