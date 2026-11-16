import type { ScriptRunner } from '../engine/ScriptRunner.ts';
import { skipAudioDelivery } from '../engine/AudioDelivery.ts';
import type { RunnerEvent, RunnerSnapshot } from '../engine/types.ts';
import { voiceAssets } from './AudioManifest.ts';
import type { AudioChannel, AudioClip, AudioCue, AudioLayer, AudioManifest } from './AudioManifest.ts';

interface Playback { cue: string; channel: AudioChannel; assets: string[]; loop: boolean; active: boolean; sources: AudioBufferSourceNode[]; nodes: GainNode[]; analyser?: AnalyserNode; timers: ReturnType<typeof setTimeout>[]; startedAt: number; }
interface VoiceRequest {
  kind: 'line' | 'review' | 'cue'; cue: string; script: string; nid: number; cues: readonly string[];
  runId: number; sceneId: number; visitId?: number; gender?: string;
}
export interface AudioObservation { cue: string; asset?: string; status: 'loaded' | 'decoded' | 'scheduled' | 'played' | 'ended' | 'stopped' | 'missing' | 'failed' | 'skipped'; detail?: string; at: number; }
export interface AudioSnapshot { ready: boolean; unlocked: boolean; language: string; languages: readonly string[]; volumes: Readonly<Record<AudioChannel, number>>; }

/** One owner outside React. Fetch/decode never block the script or reveal clocks. */
export class ReaderAudio {
  private manifest: AudioManifest | null = null;
  private context: AudioContext | null = null;
  private gains: Partial<Record<AudioChannel, GainNode>> = {};
  private analysers: Partial<Record<AudioChannel, AnalyserNode>> = {};
  private tracks = new Map<string, Playback>();
  private cache = new Map<string, Promise<AudioBuffer>>();
  private cacheBytes = new Map<string, number>();
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void)[];
  private run = -1; private scene = -1;
  private serial = 0;
  private seen = new Set<string>();
  private pendingPersistent = new Map<string, string>();
  private pendingVoice: VoiceRequest | null = null;
  private disposed = false;
  private state: AudioSnapshot = Object.freeze({ ready: false, unlocked: false, language: 'ja', languages: [], volumes: { music: 0.65, effects: 0.7, voice: 1 } });
  readonly observations: AudioObservation[] = [];
  private runner: Pick<ScriptRunner, 'onEvent' | 'subscribe' | 'getSnapshot'>;
  private baseUrl: string;
  private fetcher: typeof fetch;
  constructor(runner: Pick<ScriptRunner, 'onEvent' | 'subscribe' | 'getSnapshot'>, baseUrl = '/', fetcher: typeof fetch = fetch) {
    this.runner = runner; this.baseUrl = baseUrl; this.fetcher = fetcher.bind(globalThis);
    this.unsubscribe = [runner.onEvent(event => this.consume(event)), runner.subscribe(() => this.sync())];
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  async load(url: string): Promise<void> {
    try {
      const response = await this.fetcher(url); if (!response.ok) throw new Error(`Audio manifest HTTP ${response.status}`);
      const manifest: AudioManifest = await response.json();
      if (manifest.schema !== 1 || !manifest.events || !manifest.assets || !manifest.lines) throw new Error('Invalid audio manifest');
      if (this.disposed) return;
      this.manifest = manifest;
      this.update({ languages: manifest.languages, language: manifest.languages.includes(this.state.language) ? this.state.language : manifest.languages.includes('ja') ? 'ja' : manifest.languages[0] ?? 'ja' });
    } catch (error) { this.note('manifest', 'failed', undefined, String(error)); }
    if (this.disposed) return;
    this.update({ ready: true });
    this.flushVoice();
  }
  /** Called synchronously by a real pointer/key gesture, before any async scene load. */
  unlock(): void {
    if (this.disposed) return;
    try {
      this.context ??= new AudioContext();
      for (const channel of ['music', 'effects', 'voice'] as const) if (!this.gains[channel]) {
        const gain = this.context.createGain(); gain.gain.value = this.state.volumes[channel]; gain.connect(this.context.destination); this.gains[channel] = gain;
      }
      void this.context.resume().then(() => {
        if (this.disposed) return;
        this.update({ unlocked: this.context?.state === 'running' });
        for (const [slot, cue] of this.pendingPersistent) this.playCue(cue, slot);
        this.pendingPersistent.clear();
        this.flushVoice();
      }).catch(error => this.note('gesture', 'failed', undefined, String(error)));
    } catch (error) { this.note('gesture', 'failed', undefined, String(error)); }
  }
  volume(channel: AudioChannel, value: number): void {
    const level = Math.max(0, Math.min(1, value));
    this.update({ volumes: Object.freeze({ ...this.state.volumes, [channel]: level }) });
    this.gains[channel]?.gain.setTargetAtTime(level, this.context!.currentTime, 0.02);
  }
  language(value: string): void { if (this.state.languages.includes(value)) { this.stopSlot('voice'); this.update({ language: value }); this.flushVoice(); } }
  resolvedVoice(script: string, nid: number, cues: readonly string[] = [], gender = 'male'): string[] {
    return this.manifest ? voiceAssets(this.manifest, script, nid, this.state.language, gender, cues) : [];
  }
  replay(script: string, nid: number, cues: readonly string[] = [], gender = 'male'): void {
    this.unlock();
    this.requestVoice({ kind: 'review', cue: `review:${script}:${nid}`, script, nid, cues, gender });
  }
  stopVoice(): void { this.pendingVoice = null; this.stopSlot('voice'); }
  dispose(): void { this.disposed = true; this.stopAll(); this.unsubscribe.forEach(stop => stop()); this.listeners.clear(); Object.values(this.analysers).forEach(node => node.disconnect()); void this.context?.close(); }
  /** Retain only the latest player-owned request while loading or unlocking.
   * Readiness is not a second dialogue event, and never replays a restored line. */
  private requestVoice(request: Omit<VoiceRequest, 'runId' | 'sceneId'>): void {
    this.stopVoice();
    if (this.disposed) return;
    const snapshot = this.runner.getSnapshot();
    this.pendingVoice = { ...request, runId: snapshot.runId, sceneId: snapshot.sceneId };
    this.flushVoice();
  }
  private flushVoice(): void {
    const request = this.pendingVoice;
    if (!request || this.disposed || !this.manifest || !this.state.unlocked || this.context?.state !== 'running') return;
    const snapshot = this.runner.getSnapshot();
    if (snapshot.runId !== request.runId || snapshot.sceneId !== request.sceneId ||
        (request.kind === 'line' && (snapshot.scriptId !== request.script || snapshot.nid !== request.nid || snapshot.visitId !== request.visitId || !snapshot.dialogue || snapshot.stagePhase === 'end'))) {
      this.stopVoice(); return;
    }
    this.pendingVoice = null;
    const ids = voiceAssets(this.manifest, request.kind === 'cue' ? '' : request.script, request.nid, this.state.language, request.gender ?? this.gender, request.cues);
    if (!ids.length) return;
    const event = request.kind === 'cue' ? this.manifest.events[request.cue] : undefined;
    const selected = event && !event.sequence ? [ids[this.serial++ % ids.length]] : ids;
    this.start('voice', request.cue, 'voice', event?.clips?.map(clip => clip.asset) ?? selected, false, event?.clips);
  }
  private update(patch: Partial<AudioSnapshot>): void { this.state = Object.freeze({ ...this.state, ...patch }); for (const notify of this.listeners) notify(); }
  private note(cue: string, status: AudioObservation['status'], asset?: string, detail?: string): void {
    this.observations.push({ cue, asset, status, detail, at: performance.now() });
    if (this.observations.length > 1500) this.observations.splice(0, 500);
  }
  private sync(): void {
    const snapshot = this.runner.getSnapshot();
    if (snapshot.runId !== this.run) { this.stopAll(); this.run = snapshot.runId; this.scene = snapshot.sceneId; this.seen.clear(); }
    else if (snapshot.sceneId !== this.scene) {
      this.scene = snapshot.sceneId;
      this.stopVoice();
      for (const slot of this.tracks.keys()) if (slot !== 'music' && slot !== 'ambience') this.stopSlot(slot);
      for (const slot of this.pendingPersistent.keys()) if (slot !== 'music' && slot !== 'ambience') this.pendingPersistent.delete(slot);
    }
    if (snapshot.stagePhase === 'end' || ['idle', 'ready', 'disposed', 'error'].includes(snapshot.status)) this.stopVoice();
    if (snapshot.status === 'disposed') this.stopAll();
  }
  private consume(event: RunnerEvent): void {
    this.sync();
    if (event.runId !== this.runner.getSnapshot().runId) return;
    const key = `${event.runId}:${event.sequence}`;
    if (this.seen.has(key)) return; this.seen.add(key);
    if (event.type === 'checkpointRestored') {
      this.stopAll();
      const persistent = new Map<string, string>();
      for (const cue of event.audioHistory ?? []) this.reducePersistent(persistent, cue);
      for (const [slot, cue] of persistent) this.playCue(cue, slot);
      return;
    }
    if (event.type === 'navigation' || event.type === 'choiceSelected' || event.type === 'completed') this.stopVoice();
    if (event.type === 'interactionVoice') {
      this.stopVoice();
      if (event.cue) this.requestVoice({ kind: 'cue', cue: event.cue, script: event.scriptId, nid: event.nid ?? -1, cues: [event.cue] });
      return;
    }
    if (event.type === 'stage' && event.operation.op === 'audio' && typeof event.operation.cue === 'string') {
      const cue = event.operation.cue; const definition = this.manifest?.events[cue];
      if (skipAudioDelivery(event.operation, event.timing)) { this.note(cue, 'skipped'); return; }
      if (definition?.action === 'play' && !definition.loop && event.timing && event.timing.delivery !== 'scheduled' && event.timing.appliedAtMs < event.timing.dueAtMs) { this.note(cue, 'skipped'); return; }
      this.playCue(cue); return;
    }
    if (event.type === 'dialogue') {
      this.stopVoice();
      const cues = typeof event.node.voice === 'string' ? [event.node.voice] : event.node.voice ?? [];
      // These are authored TalkAkEvent effects; they are not character voice.
      for (const cue of cues) if (this.manifest?.events[cue]?.kind !== 'voice') this.playCue(cue);
      this.requestVoice({ kind: 'line', cue: `line:${event.scriptId}:${event.node.nid}`, script: event.scriptId, nid: event.node.nid, cues, visitId: event.visitId });
    }
  }
  gender = 'male';
  private slot(cue: string, event: AudioCue): string {
    return event.kind === 'music' ? 'music' : event.kind === 'ambience' ? 'ambience' : event.kind === 'voice' ? 'voice' : event.loop ? cue : `shot:${++this.serial}`;
  }
  private reducePersistent(state: Map<string, string>, cue: string): void {
    if (cue === '__scene__') { for (const slot of state.keys()) if (slot !== 'music' && slot !== 'ambience') state.delete(slot); return; }
    const event = this.manifest?.events[cue];
    if (!event) { const kind = this.manifest?.unresolvedEvents?.[cue]?.kind; if (kind === 'music' || kind === 'ambience') state.delete(kind); return; }
    if (event.action === 'stop') { for (const [slot, value] of state) if (slot === event.target || value === event.target) state.delete(slot); return; }
    if (event.action === 'silence') { state.delete(event.kind === 'music' ? 'music' : event.kind === 'ambience' ? 'ambience' : 'voice'); return; }
    if (event.kind === 'music' && !event.loop) state.delete('music');
    if (event.loop && event.kind !== 'voice') state.set(this.slot(cue, event), cue);
  }
  private playCue(cue: string, forcedSlot?: string): void {
    const event = this.manifest?.events[cue];
    if (!event) {
      const kind = this.manifest?.unresolvedEvents?.[cue]?.kind;
      if (kind === 'music' || kind === 'ambience') { this.stopSlot(kind); this.pendingPersistent.delete(kind); }
      this.note(cue, 'missing', undefined, this.manifest?.unresolved[cue]); return;
    }
    if (event.action === 'stop') {
      if (this.pendingVoice?.cue === event.target || event.target === 'voice') this.stopVoice();
      for (const [slot, track] of this.tracks) if (slot === event.target || track.cue === event.target) this.stopSlot(slot);
      for (const [slot, value] of this.pendingPersistent) if (slot === event.target || value === event.target) this.pendingPersistent.delete(slot);
      return;
    }
    const slot = forcedSlot ?? this.slot(cue, event);
    if (event.action === 'silence') { if (event.kind === 'voice') this.stopVoice(); else this.stopSlot(event.kind === 'ambience' ? 'ambience' : slot); this.pendingPersistent.delete(slot); return; }
    if (event.kind === 'voice') { this.requestVoice({ kind: 'cue', cue, script: '', nid: -1, cues: [cue] }); return; }
    const ids = event.variants?.default ?? [];
    if (!ids.length) { this.stopSlot(slot); this.note(cue, 'missing'); return; }
    if (this.tracks.get(slot)?.cue === cue && event.loop) return;
    if (!this.state.unlocked) { if (event.loop) this.pendingPersistent.set(slot, cue); this.note(cue, 'skipped', undefined, 'Awaiting player gesture'); return; }
    if (event.layers) { this.startAmbience(slot, cue, event.layers); return; }
    const selected = event.sequence ? ids : [ids[this.serial++ % ids.length]];
    this.start(slot, cue, event.kind === 'music' ? 'music' : 'effects', event.clips?.map(c => c.asset) ?? selected, !!event.loop, event.clips);
  }
  private start(slot: string, cue: string, channel: AudioChannel, ids: string[], loop: boolean, clips?: AudioClip[]): void {
    this.stopSlot(slot);
    if (!this.context || !this.state.unlocked) return;
    const track: Playback = { cue, channel, assets: ids, loop, active: true, sources: [], nodes: [], timers: [], startedAt: this.context.currentTime };
    this.tracks.set(slot, track);
    // Sequences decode together. A stale completion never connects a source.
    void Promise.all(ids.map(id => this.buffer(id, cue))).then(buffers => {
      if (!track.active || this.tracks.get(slot) !== track || !this.context) return;
      if (channel !== 'voice' && !loop && this.context.currentTime - track.startedAt > 3) { this.stopSlot(slot); this.note(cue, 'skipped', undefined, 'Late one-shot'); return; }
      let offset = 0; const start = this.context.currentTime;
      buffers.forEach((buffer, index) => {
        const clip = clips?.[index];
        if (clip && (clip.offset >= buffer.duration || clip.duration <= 0)) throw new Error('Invalid authored clip bounds');
        const source = this.context!.createBufferSource(); let playbackBuffer = buffer;
        // Pad the small authored silence between the media end and segment exit.
        if (clip && clip.offset + clip.duration > buffer.duration + 0.001) {
          const padded = this.context!.createBuffer(buffer.numberOfChannels, Math.ceil((clip.offset + clip.duration) * buffer.sampleRate), buffer.sampleRate);
          for (let c = 0; c < buffer.numberOfChannels; c++) padded.copyToChannel(buffer.getChannelData(c), c);
          playbackBuffer = padded;
        }
        source.buffer = playbackBuffer;
        source.loop = clip?.loop ?? (loop && index === buffers.length - 1);
        if (clip) { source.loopStart = clip.offset; source.loopEnd = clip.offset + clip.duration; }
        const setting = this.manifest?.events[cue]?.assetSettings?.[ids[index]];
        const gain = this.context!.createGain(); gain.gain.value = setting?.gain ?? 1;
        source.playbackRate.value = setting?.rate ?? 1;
        source.connect(gain); gain.connect(this.gains[channel]!); track.nodes.push(gain); track.sources.push(source);
        source.onended = () => { source.disconnect(); gain.disconnect(); this.note(cue, 'ended', ids[index]); if (track.active && index === buffers.length - 1 && !loop) { track.active = false; this.tracks.delete(slot); } };
        const when = start + offset;
        if (clip && !clip.loop) source.start(when, clip.offset, clip.duration); else source.start(when, clip?.offset ?? 0);
        if (!offset) this.note(cue, 'played', ids[index]);
        else {
          this.note(cue, 'scheduled', ids[index]);
          const observeStart = () => {
            if (!track.active || !this.context) return;
            const remaining = when - this.context.currentTime;
            if (remaining > 0.01) track.timers.push(setTimeout(observeStart, Math.max(20, remaining * 1000)));
            else this.note(cue, 'played', ids[index]);
          };
          track.timers.push(setTimeout(observeStart, offset * 1000));
        }
        offset += clip?.duration ?? buffer.duration;
      });
    }).catch(error => { if (track.active) { this.stopSlot(slot); this.note(cue, 'failed', undefined, String(error)); } });
  }
  private startAmbience(slot: string, cue: string, layers: NonNullable<AudioCue['layers']>): void {
    this.stopSlot(slot); if (!this.context) return;
    const track: Playback = { cue, channel: 'effects', assets: [...layers.continuous, ...layers.random.flatMap(group => group.variants)].map(x => x.asset), loop: true, active: true, sources: [], nodes: [], timers: [], startedAt: this.context.currentTime };
    this.tracks.set(slot, track);
    const schedule = (when: number, task: () => void) => {
      const wake = () => {
        if (!track.active || !this.context) return;
        const remaining = when - this.context.currentTime;
        if (remaining > 0.01) track.timers.push(setTimeout(wake, Math.max(25, remaining * 1000)));
        else task();
      };
      track.timers.push(setTimeout(wake, Math.max(0, when - this.context!.currentTime) * 1000));
    };
    const launch = async (layer: AudioLayer, gainFactor = 1, fade = 0): Promise<number | null> => {
      try {
        const buffer = await this.buffer(layer.asset, cue);
        if (!track.active || !this.context || this.tracks.get(slot) !== track) return null;
        const source = this.context.createBufferSource(); source.buffer = buffer; source.loop = layer.loop; source.playbackRate.value = layer.rate;
        const gain = this.context.createGain(), level = layer.gain * gainFactor, duration = buffer.duration / layer.rate, now = this.context.currentTime;
        gain.gain.value = fade ? 0 : level;
        if (fade) { gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(level, now + Math.min(fade, duration / 2)); gain.gain.setValueAtTime(level, now + Math.max(0, duration - fade)); gain.gain.linearRampToValueAtTime(0, now + duration); }
        source.connect(gain); gain.connect(this.gains.effects!); track.sources.push(source); track.nodes.push(gain);
        source.onended = () => { source.disconnect(); gain.disconnect(); track.sources = track.sources.filter(x => x !== source); track.nodes = track.nodes.filter(x => x !== gain); this.note(cue, 'ended', layer.asset); };
        source.start(); this.note(cue, 'played', layer.asset); return duration;
      } catch (error) { if (track.active) this.note(cue, 'failed', layer.asset, String(error)); return null; }
    };
    // Independent layers keep playing even when another file is unavailable.
    for (const layer of layers.continuous) void launch(layer);
    for (const group of layers.random) {
      let bag: number[] = [], recent: number[] = [];
      const next = async () => {
        if (!track.active || !this.context) return;
        let available = group.variants.map((_, i) => i).filter(i => !recent.includes(i));
        if (!available.length) available = group.variants.map((_, i) => i);
        if (group.shuffle) { bag = bag.filter(i => available.includes(i)); if (!bag.length) bag = [...available]; available = bag; }
        const index = available[Math.floor(Math.random() * available.length)]; if (index === undefined) return;
        bag = bag.filter(i => i !== index); recent.push(index); const avoid = Math.min(group.avoidRepeat, group.variants.length - 1); recent = avoid ? recent.slice(-avoid) : [];
        const duration = await launch({ ...group.variants[index], loop: false }, group.gain, group.transitionMode === 1 ? group.delay : 0);
        if (!track.active || !this.context) return;
        const interval = Math.max(0.1, group.delay + group.delayMin + Math.random() * (group.delayMax - group.delayMin));
        const after = group.transitionMode === 5 ? interval : group.transitionMode === 1 ? Math.max(0.1, (duration ?? interval) - interval) : (duration ?? 0) + interval;
        schedule(this.context.currentTime + after, () => { void next(); });
      };
      void next();
    }
  }
  private buffer(id: string, cue: string): Promise<AudioBuffer> {
    const cached = this.cache.get(id); if (cached) return cached;
    const asset = this.manifest?.assets[id];
    if (!asset || !this.context) return Promise.reject(new Error(`Missing audio ${id}`));
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 6000);
    const task = this.fetcher(new URL(asset.url, new URL(this.baseUrl, location.href)), { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${asset.source}`);
      const bytes = await response.arrayBuffer(); this.note(cue, 'loaded', id);
      const buffer = await this.context!.decodeAudioData(bytes); this.note(cue, 'decoded', id);
      this.cacheBytes.set(id, buffer.length * buffer.numberOfChannels * 4); this.trimCache(id); return buffer;
    }).catch(error => { this.cache.delete(id); throw error; }).finally(() => clearTimeout(timer));
    this.cache.set(id, task); return task;
  }
  private trimCache(keep: string): void {
    let total = [...this.cacheBytes.values()].reduce((a, b) => a + b, 0);
    const live = new Set([...this.tracks.values()].flatMap(track => track.assets));
    for (const [id, size] of this.cacheBytes) if (total > 96 * 1024 * 1024 && id !== keep && !live.has(id)) { this.cache.delete(id); this.cacheBytes.delete(id); total -= size; }
  }
  private stopSlot(slot: string): void {
    const track = this.tracks.get(slot); if (!track) return;
    track.timers.forEach(clearTimeout);
    track.active = false; for (const source of track.sources) { source.onended = null; try { source.stop(); } catch { /* already ended */ } source.disconnect(); }
    track.nodes.forEach(node => node.disconnect());
    track.analyser?.disconnect();
    this.tracks.delete(slot); this.note(track.cue, 'stopped');
  }
  private stopAll(): void { this.stopVoice(); for (const slot of this.tracks.keys()) this.stopSlot(slot); this.pendingPersistent.clear(); }
  /** Passive diagnostics expose real sources and destination signal, never drive playback. */
  inspect() { return { context: this.context?.state ?? 'absent', time: this.context?.currentTime ?? 0, pendingVoice: this.pendingVoice ? { kind: this.pendingVoice.kind, cue: this.pendingVoice.cue, script: this.pendingVoice.script, nid: this.pendingVoice.nid, visitId: this.pendingVoice.visitId } : null, tracks: [...this.tracks].map(([slot, track]) => ({ slot, cue: track.cue, channel: track.channel, assets: track.assets, loop: track.loop, sources: track.sources.length })), observations: [...this.observations] }; }
  /** Passive per-cue PCM taps distinguish singing from overlapping ambience.
   * The channel gain -> audible destination connection is never replaced. */
  trackSignal(): Record<string, { cue: string; channel: AudioChannel; rms: number; peak: number; volume: number }> {
    if (!this.context) return {};
    return Object.fromEntries([...this.tracks].map(([slot, track]) => {
      const analyser = track.analyser ??= this.context!.createAnalyser();
      for (const node of track.nodes) node.connect(analyser);
      const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data);
      return [slot, { cue: track.cue, channel: track.channel, rms: Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length), peak: data.reduce((max, x) => Math.max(max, Math.abs(x)), 0), volume: this.state.volumes[track.channel] }];
    }));
  }
  signal(): Partial<Record<AudioChannel, { rms: number; peak: number }>> {
    if (!this.context) return {};
    const result: Partial<Record<AudioChannel, { rms: number; peak: number }>> = {};
    for (const channel of ['music', 'effects', 'voice'] as const) {
      const gain = this.gains[channel]; if (!gain) continue;
      const node = this.analysers[channel] ??= this.context.createAnalyser();
      // Connections to the same input are idempotent. The audible destination
      // remains the original gain -> destination path.
      gain.connect(node); const data = new Float32Array(node.fftSize); node.getFloatTimeDomainData(data);
      result[channel] = { rms: Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length), peak: data.reduce((max, x) => Math.max(max, Math.abs(x)), 0) };
    }
    return result;
  }
}
