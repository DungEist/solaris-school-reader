import { ReaderAudio } from '../src/audio/ReaderAudio.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/App.tsx';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import { systemClock } from '../src/engine/Clock.ts';
import type { Clock } from '../src/engine/Clock.ts';
import { DialogueBacklog } from '../src/ui/DialogueBacklog.ts';
import { ManualReader } from '../src/ui/ManualReader.ts';
import { ReaderPresentations } from '../src/ui/ReaderPresentations.ts';
import { EnglishScriptRepository } from '../src/data/EnglishScriptRepository.ts';
import { StoryPlaythrough } from '../src/engine/Playthrough.ts';
import '../src/styles.css';
import '../src/reader.css';

// Development-only fixture: the real App and source data, driven by real mouse
// and keyboard input. Deliberately early text timers expose lost guard wakes.
// This entry is not referenced by the production page or production bundle.
const earlyTextClock: Clock = {
  now: systemClock.now,
  clearTimeout: systemClock.clearTimeout,
  setTimeout: (callback, delayMs) => {
    const deadline = systemClock.now() + delayMs;
    return systemClock.setTimeout(() => {
      document.documentElement.dataset.earlyWakeMs = (deadline - systemClock.now()).toFixed(3);
      callback();
    }, Math.max(1, Math.floor(delayMs) - 5));
  },
};
const runner = new ScriptRunner({ navigationDebounceMs: 200 });
const reading = new ManualReader(runner, { clock: earlyTextClock });
const backlog = new DialogueBacklog(runner);
const presentations = new ReaderPresentations(runner);
const audio = new ReaderAudio(runner);
void audio.load('/data/maps/audio-playback.json');
const repository = new EnglishScriptRepository(`${import.meta.env.BASE_URL}data/`);
const journey = new StoryPlaythrough(runner, id => repository.script(id));
const diagnostics = () => {
  document.documentElement.dataset.runnerInputReady = String(runner.getSnapshot().inputReady);
  document.documentElement.dataset.readingInputReady = String(reading.getSnapshot().inputReady);
};
const offRunner = runner.subscribe(diagnostics);
const offReading = reading.subscribe(diagnostics);
diagnostics();
const root = createRoot(document.getElementById('root')!);
root.render(<StrictMode><App audio={audio} runner={runner} reading={reading} backlog={backlog} presentations={presentations} repository={repository} journey={journey} /></StrictMode>);
const dispose = () => { audio.dispose(); journey.dispose(); offRunner(); offReading(); presentations.dispose(); backlog.dispose(); reading.dispose(); runner.dispose(); };
window.addEventListener('beforeunload', dispose);
import.meta.hot?.dispose(() => {
  window.removeEventListener('beforeunload', dispose);
  dispose();
  root.unmount();
});
