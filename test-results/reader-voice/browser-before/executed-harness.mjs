/** Actual public Reader voice playback and Story Review, with destination PCM.
 * No script selector, engine command, synthetic speech, or dubbed audio.
 * Run through the existing REA controlled-process networking environment.
 * --phase=before uses the preserved browser-before/site snapshot.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argument = (name, fallback) => process.argv.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3) ?? fallback;
const phase = argument('phase', 'before');
const route = argument('route', 'opening');
const resultDir = process.env.READER_RESULT_DIR ? resolve(process.env.READER_RESULT_DIR) : join(root, 'test-results/reader-voice/browser-' + phase);
const site = process.env.READER_SITE_DIR ? resolve(process.env.READER_SITE_DIR) : phase === 'before' ? join(root, 'test-results/reader-voice/browser-before/site') : join(root, 'dist');
const profile = await mkdtemp(join(tmpdir(), 'reader-voice-'));
const manifest = JSON.parse(await readFile(join(site, 'data/maps/audio-playback.json'), 'utf8'));
const checkpoints = [
  { name: 'train-first', script: '1001', nid: 1, textKey: 'EVENT_AVGmain_1_1', duration: 17.1689375 },
  { name: 'train-later-first', script: '1002', nid: 1, textKey: 'EVENT_AVGmain_5_1', duration: 17.1689375 },
  { name: 'train-later-second', script: '1002', nid: 2, textKey: 'EVENT_AVGmain_5_2', duration: 14.7093125 },
  { name: 'chisa', script: '1004', nid: 3, textKey: 'EVENT_AVGmain_15_3', duration: 15.251770833 },
];
const errors = [], navigation = [], measurements = [], served = new Map();
const tid = id => `[data-testid="${id}"]`;
let browser, client, server, failure;
const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = async path => hashBytes(await readFile(path));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav' };

class CDP {
  next = 0; pending = new Map(); sessionId;
  constructor(input, output) {
    this.input = input; let buffer = '';
    output.setEncoding('utf8'); output.on('data', chunk => {
      buffer += chunk; let end;
      while ((end = buffer.indexOf('\0')) >= 0) { const packet = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (packet) this.receive(JSON.parse(packet)); }
    });
    const broken = error => { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); } this.pending.clear(); };
    input.on('error', broken); output.on('error', broken);
  }
  receive(message) {
    if (message.id) {
      const item = this.pending.get(message.id); if (!item) return;
      this.pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) errors.push(`HTTP ${message.params.response.status}: ${new URL(message.params.response.url).pathname}`);
  }
  send(method, params = {}) {
    return new Promise((resolveResult, reject) => {
      const id = ++this.next, timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 30000);
      this.pending.set(id, { resolve: resolveResult, reject, timer });
      this.input.write(JSON.stringify({ id, method, params, sessionId: method.startsWith('Target.') ? undefined : this.sessionId }) + '\0');
    });
  }
  async evaluate(expression) {
    const value = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
    return value.result.value;
  }
}
async function until(expression, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  do { if (await client.evaluate(expression)) return; await delay(50); } while (Date.now() < deadline);
  throw new Error('Timed out: ' + label);
}
const settle = () => client.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const state = () => client.evaluate(`({...document.querySelector('${tid('runner-state')}').dataset})`);
const audio = () => client.evaluate(`JSON.parse(document.querySelector('${tid('audio-probe')}').textContent)`);
async function clickSelector(selector) {
  await until(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e&&!e.disabled&&e.getClientRects().length;})()`, selector);
  const point = await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest',behavior:'instant'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  await settle();
}
const click = id => clickSelector(tid(id));
async function dismissNotices() {
  for (let index = 0; index < 12; index++) {
    const selector = await client.evaluate(`['relationship-confirm','letter-confirm','role-intro-confirm','journey-confirm'].map(id=>'[data-testid="'+id+'"]').find(s=>{const e=document.querySelector(s);return e&&!e.disabled&&e.getClientRects().length;})||null`);
    if (!selector) return; await clickSelector(selector);
  }
}
async function publicStep() {
  await dismissNotices();
  const before = await state();
  assert.notEqual(before.status, 'error', 'The ordinary public route stays playable.');
  const decision = await client.evaluate(`(()=>{
    const available=s=>Array.from(document.querySelectorAll(s)).filter(e=>!e.disabled&&e.getClientRects().length);
    const next=available('[data-testid="journey-next-cycle"]')[0];if(next)return{selector:'[data-testid="journey-next-cycle"]',kind:'next-cycle'};
    const controls=available('[data-testid="reader-actions"] [data-journey-control]');if(controls.length)return{selector:'[data-testid="reader-actions"] [data-journey-control="'+controls[0].dataset.journeyControl+'"]',kind:'journey-control'};
    const actions=available('[data-testid="reader-actions"] [data-journey-option]');if(actions.length){const action=actions.find(e=>e.dataset.journeyOption.startsWith('explore:'))??actions[0];return{selector:'[data-testid="reader-actions"] [data-journey-option="'+action.dataset.journeyOption+'"]',kind:'journey-option'};}
    const quiz=available('[data-testid="quiz-answer"]')[0];if(quiz)return{selector:'[data-testid="quiz-answer"][data-answer-id="'+quiz.dataset.answerId+'"]',kind:'quiz-answer'};
    const quizContinue=available('[data-testid="quiz-continue"]')[0];if(quizContinue)return{selector:'[data-testid="quiz-continue"]',kind:'quiz-continue'};
    const options=available('[data-testid="choice"]');if(options.length){const preferred={'1003:1':'12','1003:6':'15'};const s=document.querySelector('[data-testid="runner-state"]').dataset;const option=options.find(e=>e.dataset.optionId===preferred[s.scriptId+':'+s.nid])??options[0];return{selector:'[data-testid="choice"][data-option-id="'+option.dataset.optionId+'"]:not(:disabled)',kind:'dialogue-choice'};}
    const advance=available('[data-testid="advance"]')[0];if(advance)return{selector:'[data-testid="advance"]',kind:'advance'};
    return null;
  })()`);
  if (!decision) { await delay(75); return false; }
  await clickSelector(decision.selector); const after = await state();
  navigation.push({ before, action: decision, after });
  await writeFile(join(resultDir, 'navigation-progress.json'), JSON.stringify({ phase, route, steps: navigation.length, last: navigation.at(-1) }, null, 2) + '\n');
  return true;
}
async function publicRouteTo(script, nid, timeoutSeconds = 180) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  for (let steps = 0; steps < 20000 && Date.now() < deadline; steps++) {
    const current = await state();
    if (current.scriptId === script && current.nid === String(nid)) return;
    await publicStep();
    if (steps % 80 === 0) console.log(JSON.stringify({ progress: 'Public route', target: `${script}/${nid}`, current, actions: navigation.length }));
  }
  throw new Error('Bounded public route did not reach ' + script + '/' + nid);
}

function destinationProbe() {
  const nativeConnect = AudioNode.prototype.connect;
  const nativeContext = window.AudioContext;
  const observations = [], contexts = [], captures = new Map(), edges = new WeakMap();
  const workletSource = `class ReaderDestinationPCM extends AudioWorkletProcessor {
    constructor(){super();this.active=null;this.port.onmessage=e=>{if(e.data.command==='arm'){this.active=e.data.name;this.port.postMessage({type:'armed',name:this.active,frame:currentFrame,sampleRate});}if(e.data.command==='stop'){const name=this.active;this.active=null;this.port.postMessage({type:'stopped',name,frame:currentFrame,sampleRate});}};}
    process(inputs,outputs){const input=inputs[0]??[],output=outputs[0];for(let c=0;c<2;c++)if(input[c])output[c].set(input[c]);else output[c].fill(0);if(this.active){const left=new Float32Array(output[0]),right=new Float32Array(output[1]);this.port.postMessage({type:'pcm',name:this.active,frame:currentFrame,sampleRate,left:left.buffer,right:right.buffer},[left.buffer,right.buffer]);}return true;}
  }registerProcessor('reader-destination-pcm',ReaderDestinationPCM);`;
  class ObservedContext extends nativeContext {
    constructor(...args) {
      super(...args); const context = this;
      const record = { context, destinationSources: [], ready: false }; contexts.push(record);
      const moduleURL = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }));
      record.readyPromise = context.audioWorklet.addModule(moduleURL).then(() => {
        URL.revokeObjectURL(moduleURL);
        const tap = new AudioWorkletNode(context, 'reader-destination-pcm', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
        const driver = context.createGain(); driver.gain.value = 0;
        nativeConnect.call(tap, driver); nativeConnect.call(driver, context.destination);
        record.tap = tap; record.driver = driver;
        for (const source of record.destinationSources) nativeConnect.call(source, tap);
        tap.port.onmessage = event => {
          const data = event.data, capture = captures.get(data.name); if (!capture) return;
          if (data.type === 'armed') { capture.startFrame = data.frame; capture.sampleRate = data.sampleRate; capture.armEpochMs = performance.timeOrigin + performance.now(); capture.armResolve(); }
          else if (data.type === 'pcm') {
            if (!capture.blocks.length) {
              const timestamp = context.getOutputTimestamp();
              capture.firstPCM = { frame: data.frame, contextSeconds: data.frame / data.sampleRate, receivedEpochMs: performance.timeOrigin + performance.now(), outputTimestamp: timestamp,
                outputEpochMs: performance.timeOrigin + timestamp.performanceTime + (data.frame / data.sampleRate - timestamp.contextTime) * 1000 };
            }
            capture.blocks.push({ frame: data.frame, left: new Float32Array(data.left), right: new Float32Array(data.right) });
          } else if (data.type === 'stopped') { capture.endFrame = data.frame; capture.stopEpochMs = performance.timeOrigin + performance.now(); capture.stopResolve(); }
        };
        record.ready = true;
      }).catch(error => { record.error = String(error); });
    }
  }
  window.AudioContext = ObservedContext;
  AudioNode.prototype.connect = function(destination, ...args) {
    const result = nativeConnect.call(this, destination, ...args);
    if (destination instanceof AudioNode) { const connected = edges.get(this) ?? []; if (!connected.includes(destination)) connected.push(destination); edges.set(this, connected); }
    if (destination === this.context.destination) {
      const record = contexts.find(value => value.context === this.context);
      if (record && !record.destinationSources.includes(this)) {
        record.destinationSources.push(this);
        observations.push({ type: 'destination-connect', node: this.constructor.name, initialGain: this.gain?.value ?? null, at: performance.now() });
        if (record.tap) nativeConnect.call(this, record.tap);
      }
    }
    return result;
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function(...args) {
    const record = contexts.find(value => value.context === this.context), visited = new Set();
    const destinationChannel = node => { if (visited.has(node)) return -1; visited.add(node); const index = record?.destinationSources.indexOf(node) ?? -1; if (index >= 0) return index; for (const next of edges.get(node) ?? []) { const found = destinationChannel(next); if (found >= 0) return found; } return -1; };
    const channel = ['music', 'effects', 'voice'][destinationChannel(this)] ?? 'unclassified';
    const observation = { type: 'source-start', channel, at: performance.now(), contextTime: this.context.currentTime, when: args[0] ?? 0, effectiveWhen: Math.max(args[0] ?? 0, this.context.currentTime), offset: args[1] ?? 0, durationArgument: args[2] ?? null, channels: this.buffer?.numberOfChannels, duration: this.buffer?.duration, sampleRate: this.buffer?.sampleRate, rate: this.playbackRate.value, loop: this.loop };
    observations.push(observation);
    if (channel === 'voice') for (const capture of captures.values()) if (!capture.endFrame && capture.record.context === this.context) capture.voiceSources.push({ ...observation, buffer: this.buffer });
    return start.apply(this, args);
  };
  const decode = nativeContext.prototype.decodeAudioData;
  nativeContext.prototype.decodeAudioData = function(...args) {
    const promise = decode.apply(this, args);
    promise.then(buffer => observations.push({ type: 'decoded', at: performance.now(), channels: buffer.numberOfChannels, duration: buffer.duration, sampleRate: buffer.sampleRate }), error => observations.push({ type: 'decode-failed', at: performance.now(), error: String(error) }));
    return promise;
  };
  const base64 = values => { const bytes = new Uint8Array(values.buffer); let text = ''; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(text); };
  window.__readerVoiceCapture = {
    ready() { return contexts.some(value => value.ready && value.context.state === 'running'); },
    status() { return contexts.map(value => ({ ready: value.ready, state: value.context.state, sampleRate: value.context.sampleRate, destinationChannels: value.context.destination.channelCount, destinationSources: value.destinationSources.length, error: value.error })); },
    arm(name) { const record = contexts.find(value => value.ready && value.context.state === 'running'); if (!record) throw new Error('Actual Reader AudioContext is not running.'); const capture = { name, blocks: [], voiceSources: [], record }; captures.set(name, capture); return new Promise(resolve => { capture.armResolve = resolve; record.tap.port.postMessage({ command: 'arm', name }); }); },
    stop(name) { const capture = captures.get(name); return new Promise(resolve => { capture.stopResolve = resolve; capture.record.tap.port.postMessage({ command: 'stop' }); }); },
    result(name) {
      const capture = captures.get(name), blocks = capture.blocks;
      if (!blocks.length) throw new Error('No actual destination PCM blocks were captured.');
      const firstFrame = blocks[0].frame, endFrame = blocks.at(-1).frame + blocks.at(-1).left.length;
      const values = new Float32Array((endFrame - firstFrame) * 2), observedFrames = blocks.reduce((sum, block) => sum + block.left.length, 0), observedValues = new Float32Array(observedFrames * 2), gaps = [], blockIndex = []; let rawOffset = 0;
      for (let b = 0; b < blocks.length; b++) {
        const block = blocks[b];
        if (b && block.frame !== blocks[b - 1].frame + blocks[b - 1].left.length) {
          const fromFrame = blocks[b - 1].frame + blocks[b - 1].left.length, toFrame = block.frame; let expectedVoicePeak = 0;
          for (const source of capture.voiceSources) {
            const begin = Math.max(0, Math.floor(((fromFrame / capture.sampleRate - source.effectiveWhen) * source.rate + source.offset) * source.buffer.sampleRate));
            const end = Math.min(source.buffer.length, Math.ceil(((toFrame / capture.sampleRate - source.effectiveWhen) * source.rate + source.offset) * source.buffer.sampleRate));
            for (let channel = 0; channel < source.buffer.numberOfChannels; channel++) { const samples = source.buffer.getChannelData(channel); for (let i = begin; i < end; i++) expectedVoicePeak = Math.max(expectedVoicePeak, Math.abs(samples[i])); }
          }
          gaps.push({ fromFrame, toFrame, missingFrames: toFrame - fromFrame, relativeStartSeconds: (fromFrame - firstFrame) / capture.sampleRate, relativeEndSeconds: (toFrame - firstFrame) / capture.sampleRate, expectedVoicePeak, coversDecodedVoiceSignal: expectedVoicePeak > 1e-6 });
        }
        blockIndex.push({ contextFrame: block.frame, frames: block.left.length, observedFloat32Offset: rawOffset });
        for (let i = 0; i < block.left.length; i++) { const at = (block.frame - firstFrame + i) * 2; values[at] = block.left[i]; values[at + 1] = block.right[i]; observedValues[rawOffset++] = block.left[i]; observedValues[rawOffset++] = block.right[i]; }
      }
      return { name, sampleRate: capture.sampleRate, channels: 2, frames: endFrame - firstFrame, observedFrames, missingFrames: endFrame - firstFrame - observedFrames, firstFrame, endFrame, blocks: blocks.length, blockIndex, contextFrameGaps: gaps.length, gapIntervals: gaps, coversAllDecodedVoiceSignal: gaps.every(gap => !gap.coversDecodedVoiceSignal), decodedVoiceSources: capture.voiceSources.map(({ buffer, ...source }) => source), armEpochMs: capture.armEpochMs, stopEpochMs: capture.stopEpochMs, firstPCM: capture.firstPCM, baseLatency: capture.record.context.baseLatency, outputLatency: capture.record.context.outputLatency, pcmFloat32LE: base64(values), observedPCMFloat32LE: base64(observedValues), observations: observations.slice(), gapScope: 'Raw observed PCM contains exactly the captured blocks without interpolation. The timeline WAV places those blocks at their original context frames and fills explicitly unobserved gaps with zero. Each gap is checked against the actual decoded voice buffer at its scheduled source clock; a gap overlapping nonzero voice invalidates full-utterance coverage.' };
    },
    release(name) { captures.delete(name); },
  };
}

async function run(executable, args) {
  const command = spawn(executable, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
  command.stdout.on('data', value => { stdout += value; }); command.stderr.on('data', value => { stderr += value; });
  const code = await new Promise((resolveCode, reject) => { command.on('error', reject); command.on('exit', resolveCode); });
  assert.equal(code, 0, executable + ': ' + stderr); return stdout;
}
async function saveAudio(folder, recording) {
  const pcm = Buffer.from(recording.pcmFloat32LE, 'base64'); delete recording.pcmFloat32LE;
  const raw = Buffer.from(recording.observedPCMFloat32LE, 'base64'); delete recording.observedPCMFloat32LE;
  assert.equal(pcm.length, recording.frames * recording.channels * 4); assert.equal(raw.length, recording.observedFrames * recording.channels * 4);
  const rawFile = join(folder, 'observed-destination.f32le'); await writeFile(rawFile, raw);
  const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(3, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(recording.sampleRate, 24); header.writeUInt32LE(recording.sampleRate * 8, 28); header.writeUInt16LE(8, 32); header.writeUInt16LE(32, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  const file = join(folder, 'destination.wav'); await writeFile(file, Buffer.concat([header, pcm]));
  const values = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4), channels = [0, 1].map(channel => {
    let sum = 0, peak = 0, nonzeroSamples = 0;
    for (let i = channel; i < values.length; i += 2) { const value = values[i]; assert.ok(Number.isFinite(value)); sum += value * value; peak = Math.max(peak, Math.abs(value)); nonzeroSamples += Number(Math.abs(value) > 1e-6); }
    return { channel, rms: Math.sqrt(sum / recording.frames), peak, nonzeroSamples };
  });
  return { file, sha256: await hash(file), rawObservedPCM: { file: rawFile, sha256: await hash(rawFile), frames: recording.observedFrames }, format: 'IEEE float32 LE stereo WAV', source: 'actual AudioContext destination connections mirrored after their channel gains; explicit context gaps are retained in the block index and zero-filled in this timeline WAV', durationSeconds: recording.frames / recording.sampleRate, channels, audible: channels.some(value => value.nonzeroSamples > 0), coversAllDecodedVoiceSignal: recording.coversAllDecodedVoiceSignal };
}
async function screenshot(folder, index) {
  const clock = await client.evaluate('({epochMs:performance.timeOrigin+performance.now(),performanceNow:performance.now()})');
  const data = await client.send('Page.captureScreenshot', { format: 'jpeg', quality: 90, captureBeyondViewport: false });
  const file = `frame-${String(index).padStart(4, '0')}.jpg`; await writeFile(join(folder, file), Buffer.from(data.data, 'base64'));
  return { file, ...clock, reader: await state() };
}
async function encode(folder, frames, recording) {
  const lines = ['ffconcat version 1.0'];
  for (let i = 0; i < frames.length; i++) { lines.push("file '" + join(folder, frames[i].file).replaceAll("'", "'\\''") + "'", 'option framerate 1000'); if (i + 1 < frames.length) lines.push('duration ' + ((frames[i + 1].epochMs - frames[i].epochMs) / 1000).toFixed(9)); }
  const listing = join(folder, 'actual-frames.ffconcat'); await writeFile(listing, lines.join('\n') + '\n');
  const offset = (recording.firstPCM.outputEpochMs - frames[0].epochMs) / 1000;
  const filter = offset < 0 ? `atrim=start=${(-offset).toFixed(6)},asetpts=PTS-STARTPTS,apad` : `adelay=${Math.round(offset * 1000)}:all=1,apad`;
  const file = join(folder, 'reader-with-actual-audio.mp4');
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listing, '-i', join(folder, 'destination.wav'), '-map', '0:v:0', '-map', '1:a:0', '-af', filter, '-t', String((frames.at(-1).epochMs - frames[0].epochMs) / 1000), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-enc_time_base', '1:1000', '-fps_mode', 'vfr', '-video_track_timescale', '1000000', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', file]);
  const probe = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type,width,height,sample_rate,channels:format=duration', '-of', 'json', file]));
  assert.ok(probe.streams.some(stream => stream.codec_type === 'audio' && stream.channels === 2));
  return { file, sha256: await hash(file), observedFrames: frames.length, pcmOffsetRelativeToFirstVideoFrameSeconds: offset, probe,
    scope: 'Actual CDP screenshots at observed timestamps, muxed with the captured destination WAV at the AudioContext output timestamp. No source-file substitution, synthetic voice, dubbing, frame interpolation, or playback-rate change.' };
}
async function record(checkpoint, mode, action) {
  const name = checkpoint.name + '-' + mode, folder = join(resultDir, name); await mkdir(folder, { recursive: true });
  const before = await state(), audioBefore = await audio();
  await client.evaluate(`window.__readerVoiceCapture.arm(${JSON.stringify(name)})`);
  const frames = [await screenshot(folder, 0)];
  const trigger = action ? await action() : { available: false };
  if (mode === 'auto') await until(`(()=>{const s=document.querySelector('${tid('runner-state')}').dataset;return s.scriptId===${JSON.stringify(checkpoint.script)}&&s.nid===${JSON.stringify(String(checkpoint.nid))};})()`, name + ' actual public line');
  const deadline = Date.now() + (mode === 'review' && !trigger?.available ? 2 : checkpoint.duration + 2) * 1000;
  while (Date.now() < deadline) { await delay(90); frames.push(await screenshot(folder, frames.length)); }
  await client.evaluate(`window.__readerVoiceCapture.stop(${JSON.stringify(name)})`);
  const recording = await client.evaluate(`window.__readerVoiceCapture.result(${JSON.stringify(name)})`); await client.evaluate(`window.__readerVoiceCapture.release(${JSON.stringify(name)})`);
  const actualAudio = await saveAudio(folder, recording), after = await state(), audioAfter = await audio();
  const line = manifest.lines[`${checkpoint.script}:${checkpoint.nid}`] ?? null;
  const result = { checkpoint, mode, directory: folder, before, after, trigger, audioBefore, audioAfter, manifestLine: line, destinationRecording: recording, actualAudio, frames, encoding: await encode(folder, frames, recording) };
  assert.equal(audioAfter.state.language, 'ja'); assert.deepEqual(audioAfter.state.volumes, { music: 0, effects: 0, voice: 1 });
  if (mode === 'review') assert.equal(after.visitId, before.visitId, 'Story Review preserves the actual Reader visit.');
  await writeFile(join(folder, 'measurements.json'), JSON.stringify(result, null, 2) + '\n'); measurements.push(result);
  console.log(JSON.stringify({ progress: 'Recorded actual destination', name, lineMapped: !!line, replayAvailable: trigger?.available ?? null, audible: actualAudio.audible, pcmFrames: recording.frames, duration: actualAudio.durationSeconds, readerBefore: before, readerAfter: after }));
  return result;
}
async function review(checkpoint) {
  await click('history');
  await client.evaluate(`(()=>{const e=document.querySelector('${tid('history-scroll')}');e.scrollTop=e.scrollHeight;})()`);
  const selector = `${tid('history-voice')}[data-script-id="${checkpoint.script}"][data-node-id="${checkpoint.nid}"]`;
  return record(checkpoint, 'review', async () => {
    const available = await client.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
    const history = await client.evaluate(`Array.from(document.querySelectorAll('${tid('history-entry')}')).map(e=>({id:e.dataset.entryId,kind:e.dataset.entryKind,speaker:e.querySelector('.history-speaker')?.textContent,text:e.querySelector('.history-text')?.textContent,buttons:Array.from(e.querySelectorAll('button')).map(b=>({label:b.getAttribute('aria-label'),script:b.dataset.scriptId,nid:b.dataset.nodeId}))}))`);
    if (available) await clickSelector(selector);
    return { available, selector, history };
  }).finally(() => click('history-close'));
}

try {
  await mkdir(resultDir, { recursive: true });
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      const filename = resolve(site, '.' + (extname(pathname) ? pathname : '/index.html')); if (!filename.startsWith(site + sep)) throw new Error('Invalid local path');
      const bytes = await readFile(filename); served.set(pathname, { pathname, file: filename, bytes: bytes.length, sha256: hashBytes(bytes) });
      response.writeHead(200, { 'Content-Type': mime[extname(filename)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(bytes);
    } catch { response.writeHead(404); response.end('Missing preserved local asset'); }
  });
  await new Promise((resolveServer, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveServer); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = spawn(process.env.CHROMIUM_BIN ?? '/usr/bin/chromium', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', `--user-data-dir=${profile}`, '--remote-debugging-pipe', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  client = new CDP(browser.stdio[3], browser.stdio[4]);
  const target = await client.send('Target.createTarget', { url: 'about:blank' }); client.sessionId = (await client.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
  for (const domain of ['Page', 'Runtime', 'Network']) await client.send(domain + '.enable');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await client.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${destinationProbe.toString()})()` });
  await client.send('Page.navigate', { url: origin + '/?audioProbe=1' });
  await until(`!document.querySelector('${tid('reader-loading')}')&&document.querySelector('${tid('start')}')&&!document.querySelector('${tid('start')}').disabled`, 'ordinary public Start');
  assert.equal(await client.evaluate(`document.querySelector('${tid('interface')}').dataset.interface`), 'reader');
  await click('settings');
  for (const [channel, value] of [['music', 0], ['effects', 0], ['voice', 1]]) {
    await client.evaluate(`(()=>{const e=document.querySelector('${tid('volume-' + channel)}');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  }
  await client.evaluate(`(()=>{const e=document.querySelector('select[aria-label="Voice language"]');e.value='ja';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  if (!await client.evaluate(`document.querySelector('${tid('instant-text')}').checked`)) await click('instant-text');
  await click('settings-close'); await until('window.__readerVoiceCapture.ready()', 'actual running AudioContext and destination PCM tap'); await delay(500);
  await record(checkpoints[0], 'auto', async () => { await click('start'); return { available: true, publicControl: 'Start' }; });
  await review(checkpoints[0]);
  await publicRouteTo('1004', 2);
  await record(checkpoints[3], 'auto', async () => { await publicStep(); return { available: true, publicControl: 'ordinary Advance from 1004/2' }; });
  await review(checkpoints[3]);
  if (route === 'later') {
    await publicRouteTo('1002', 1, Number(argument('route-seconds', '240')));
    // Capture begins at the genuinely reached later-cycle line. Its public
    // arrival telemetry is retained; review captures the entire utterance.
    await record(checkpoints[1], 'auto', async () => ({ available: true, publicControl: 'already reached through public next-cycle', entryAlreadyDelivered: true }));
    await review(checkpoints[1]);
    await record(checkpoints[2], 'auto', async () => { await publicStep(); return { available: true, publicControl: 'ordinary Advance from 1002/1' }; });
    await review(checkpoints[2]);
  }
  assert.deepEqual(errors, []);
} catch (error) { failure = error.stack ?? String(error); }
finally {
  if (client) try { await client.send('Browser.close'); } catch {}
  if (browser && browser.exitCode === null) { browser.kill('SIGTERM'); await Promise.race([new Promise(resolveExit => browser.once('exit', resolveExit)), delay(1500)]); if (browser.exitCode === null) browser.kill('SIGKILL'); }
  if (server) await new Promise(resolveServer => server.close(resolveServer)); await rm(profile, { recursive: true, force: true });
  const report = { passed: !failure, failure, errors, phase, route, site, source: { html: { file: join(site, 'index.html'), sha256: await hash(join(site, 'index.html')) }, audioManifest: { file: join(site, 'data/maps/audio-playback.json'), sha256: await hash(join(site, 'data/maps/audio-playback.json')) }, harness: { file: fileURLToPath(import.meta.url), sha256: await hash(fileURLToPath(import.meta.url)) } }, served: [...served.values()], navigation,
    measurements: measurements.map(({ frames, destinationRecording, audioBefore, audioAfter, ...value }) => ({ ...value, frames: frames.length, destinationRecording: { ...destinationRecording, observations: destinationRecording.observations.length }, audioBefore: { state: audioBefore.state, tracks: audioBefore.tracks }, audioAfter: { state: audioAfter.state, tracks: audioAfter.tracks, observations: audioAfter.observations } })),
    scope: 'Ordinary public Start and actual Reader advances/eligible choices, plus Story Review replay controls. No script loading, stage/voice injection, or engine-state mutation. A pre-page Web Audio observer mirrors final channel gain connections to the real AudioContext destination into a stereo AudioWorklet, retaining actual PCM and output clock mapping. Videos use actual CDP screenshots and that destination WAV; no dubbed source audio. The existing opt-in audioProbe observes the Reader audio owner independently.' };
  await mkdir(resultDir, { recursive: true }); await writeFile(join(resultDir, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, phase, route, recordings: measurements.length, report: join(resultDir, 'browser-report.json'), failure })); if (failure) process.exitCode = 1;
}
