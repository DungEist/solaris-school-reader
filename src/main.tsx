import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ReaderAudio } from './audio/ReaderAudio.ts';
import { ScriptRunner } from './engine/ScriptRunner.ts';
import { ManualReader } from './ui/ManualReader.ts';
import { DialogueBacklog } from './ui/DialogueBacklog.ts';
import { ReaderPresentations } from './ui/ReaderPresentations.ts';
import { StoryPlaythrough } from './engine/Playthrough.ts';
import { EnglishScriptRepository } from './data/EnglishScriptRepository.ts';
import './styles.css';
import './reader.css';

// Entry-point ownership avoids disposing the engine during StrictMode's
// effect cleanup/re-subscription cycle. React never starts stage timers.
const runner = new ScriptRunner({ navigationDebounceMs: 200 });
const audio = new ReaderAudio(runner, import.meta.env.BASE_URL);
void audio.load(`${import.meta.env.BASE_URL}data/maps/audio-playback.json`);
const reading = new ManualReader(runner);
const backlog = new DialogueBacklog(runner);
const presentations = new ReaderPresentations(runner);
const repository = new EnglishScriptRepository(`${import.meta.env.BASE_URL}data/`);
const journey = new StoryPlaythrough(runner, id => repository.script(id));
// Optional passive VFX evidence observes the actual Reader, without exposing
// commands, injecting cues, or changing the playback clock.
const vfxProbe = new URLSearchParams(location.search).get('vfxProbe') === '1' ? document.createElement('output') : null;
if (vfxProbe) { vfxProbe.hidden = true; vfxProbe.dataset.testid = 'vfx-probe'; document.body.append(vfxProbe); }
const publishVfxProbe = () => {
  if (!vfxProbe) return;
  const state = runner.getSnapshot();
  vfxProbe.textContent = JSON.stringify({ scriptId: state.scriptId, nid: state.nid, sceneId: state.sceneId, runId: state.runId, clockMs: state.clockMs, effects: state.effects,
    pendingStage: state.pendingStage,
    moves: state.stageEvents.filter(event => event.operation.op === 'move'),
    characters: state.presentation.characters.map(view => ({ who: view.character.who, brightness: view.brightness, opacity: view.portraitOpacity, position: view.position, sourcePosition: view.character.position, expression: view.character.expression })),
    cues: state.stageEvents.filter(event => ['screenFx', 'stopScreenFx', 'portraitFx'].includes(event.operation.op)) });
};
const unsubscribeVfxProbe = vfxProbe ? runner.subscribe(publishVfxProbe) : () => {};
publishVfxProbe();
// Opt-in passive browser evidence. Public Reader gestures still own playback.
const probe = new URLSearchParams(location.search).get('audioProbe') === '1' ? document.createElement('output') : null;
const samples: unknown[] = [];
const cueSignals: Record<string, { samples: number; nonzeroSamples: number; maxRms: number; maxPeak: number; assets: string[] }> = {};
const mediaObservations: Record<string, Record<string, number>> = {};
const observed = new Set<string>();
if (probe) { probe.hidden = true; probe.dataset.testid = 'audio-probe'; document.body.append(probe); }
const probeTimer = probe ? setInterval(() => {
  const snapshot = audio.inspect(), signal = audio.signal(), trackSignal = audio.trackSignal();
  samples.push({ at: performance.now(), script: runner.getSnapshot().scriptId, nid: runner.getSnapshot().nid, signal, trackSignal, tracks: snapshot.tracks });
  for (const track of snapshot.tracks) {
    const channel = track.channel;
    const level = signal[channel]; if (!level) continue;
    const total = cueSignals[track.cue] ??= { samples: 0, nonzeroSamples: 0, maxRms: 0, maxPeak: 0, assets: [] };
    total.samples++; total.nonzeroSamples += Number(level.rms > 0); total.maxRms = Math.max(total.maxRms, level.rms); total.maxPeak = Math.max(total.maxPeak, level.peak); total.assets = [...new Set([...total.assets, ...track.assets])];
  }
  for (const observation of snapshot.observations) {
    const token = `${observation.at}:${observation.cue}:${observation.asset}:${observation.status}`;
    if (observed.has(token)) continue; observed.add(token);
    const counts = mediaObservations[`${observation.cue}|${observation.asset ?? ''}`] ??= {};
    counts[observation.status] = (counts[observation.status] ?? 0) + 1;
  }
  if (samples.length > 1500) samples.shift();
  probe.textContent = JSON.stringify({ ...snapshot, state: audio.getSnapshot(), samples, cueSignals, mediaObservations });
}, 100) : null;
const root = createRoot(document.getElementById('root')!);
root.render(<StrictMode><App audio={audio} runner={runner} reading={reading} backlog={backlog} presentations={presentations} repository={repository} journey={journey} /></StrictMode>);
const dispose = () => { if (probeTimer) clearInterval(probeTimer); probe?.remove(); unsubscribeVfxProbe(); vfxProbe?.remove(); audio.dispose(); journey.dispose(); presentations.dispose(); backlog.dispose(); reading.dispose(); runner.dispose(); };
window.addEventListener('beforeunload', dispose);
import.meta.hot?.dispose(() => {
  window.removeEventListener('beforeunload', dispose);
  dispose();
  root.unmount();
});
