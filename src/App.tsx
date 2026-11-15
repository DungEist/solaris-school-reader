import type { ReaderAudio } from './audio/ReaderAudio.ts';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { VisualAssetRepository } from './assets/VisualAssetRepository.ts';
import { emptyVisualAssets } from './assets/VisualAssets.ts';
import { loadReaderVfxAssets } from './assets/ReaderVfxAssets.ts';
import type { VisualAssets } from './assets/VisualAssets.ts';
import { EnglishScriptRepository } from './data/EnglishScriptRepository.ts';
import type { EnglishCatalog } from './data/EnglishScriptRepository.ts';
import { errorInfo } from './engine/EngineError.ts';
import type { ScriptRunner } from './engine/ScriptRunner.ts';
import type { RunnerCheckpoint } from './engine/ScriptRunner.ts';
import type { ErrorInfo } from './engine/types.ts';
import type { PlayerTextProfile } from './text/EnglishText.ts';
import type { MouseEvent } from 'react';
import { interfaceHref, isDeveloperRoute } from './ui/InterfaceRoute.ts';
import { ReaderSession } from './ui/ReaderSession.tsx';
import type { ManualReader } from './ui/ManualReader.ts';
import type { DialogueBacklog } from './ui/DialogueBacklog.ts';
import type { ReaderPresentations, ReaderPresentationSource } from './ui/ReaderPresentations.ts';
import type { PlaythroughCheckpoint, StoryPlaythrough } from './engine/Playthrough.ts';

type ReaderCheckpoint = { readonly kind: 'playthrough'; readonly value: PlaythroughCheckpoint } | { readonly kind: 'scene'; readonly value: RunnerCheckpoint };

export function App({ runner, reading, backlog, presentations, repository, journey, audio }: { audio: ReaderAudio; runner: ScriptRunner; reading: ManualReader; backlog: DialogueBacklog; presentations: ReaderPresentations; repository: EnglishScriptRepository; journey: StoryPlaythrough }) {
  const audioState = useSyncExternalStore(audio.subscribe, audio.getSnapshot, audio.getSnapshot);
  const snapshot = useSyncExternalStore(runner.subscribe, runner.getSnapshot, runner.getSnapshot);
  const [developer, setDeveloper] = useState(() => isDeveloperRoute(window.location.pathname));
  const loading = useRef(false);
  const readingState = useSyncExternalStore(reading.subscribe, reading.getSnapshot, reading.getSnapshot);
  const journeyState = useSyncExternalStore(journey.subscribe, journey.getSnapshot, journey.getSnapshot);
  const [checkpoint, setCheckpoint] = useState<ReaderCheckpoint | null>(null);
  const [assetRepository] = useState(() => new VisualAssetRepository(`${import.meta.env.BASE_URL}data/`, `${import.meta.env.BASE_URL}assets/solarschool/`));
  const [assets, setAssets] = useState<VisualAssets>(emptyVisualAssets);
  const [assetsReady, setAssetsReady] = useState(false);
  const [backgroundVariant, setBackgroundVariant] = useState<'day' | 'night'>('day');
  const [catalog, setCatalog] = useState<EnglishCatalog | null>(null);
  const [loadError, setLoadError] = useState<ErrorInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [profile, setProfile] = useState<PlayerTextProfile>({ playerName: 'Rover', gender: 'male' });
  const [presentationSource, setPresentationSource] = useState<ReaderPresentationSource | null>(null);
  const [presentationsReady, setPresentationsReady] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`${import.meta.env.BASE_URL}data/reader-presentations.json`).then(async response => {
      if (!response.ok) throw new Error('Presentation definitions unavailable');
      const source: ReaderPresentationSource = await response.json();
      if (source.schema !== 1 || !source.introductions || !source.lettersByAction || !source.english) throw new Error('Presentation definitions invalid');
      if (active) { presentations.setSource(source); setPresentationSource(source); }
    }).catch(() => {
      // Optional artwork/text projections never change engine availability.
    }).finally(() => { if (active) setPresentationsReady(true); });
    return () => { active = false; };
  }, [presentations]);

  useEffect(() => {
    const onPopState = () => setDeveloper(isDeveloperRoute(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const developerHref = interfaceHref(true, window.location.search, snapshot.scriptId ?? selectedId);
  const readerHref = interfaceHref(false, window.location.search, snapshot.scriptId ?? selectedId);
  function switchView(event: MouseEvent<HTMLAnchorElement>, toDeveloper: boolean) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.history.pushState(null, '', toDeveloper ? developerHref : readerHref);
    setDeveloper(toDeveloper);
  }

  // Loading data does not start a script. StrictMode may resubscribe safely.
  useEffect(() => {
    let active = true;
    repository.catalog().then(data => {
      if (!active) return;
      runner.setStageSpeakers(data.speakers);
      setCatalog(data);
      const requested = new URLSearchParams(window.location.search).get('script');
      setSelectedId(data.index.find(entry => entry.id === requested)?.id ?? data.index[0]?.id ?? '');
    }).catch(error => { if (active) setLoadError(errorInfo(error)); });
    return () => { active = false; };
  }, [repository, runner]);

  useEffect(() => {
    let active = true;
    Promise.all([assetRepository.load(), loadReaderVfxAssets(import.meta.env.BASE_URL)]).then(([data, vfx]) => {
      if (!active) return;
      runner.setVfxDefinitions(vfx.manifest?.effects ?? {});
      setAssets(Object.freeze({ ...data, vfx: vfx.manifest, issues: Object.freeze([...data.issues, ...vfx.issues]) }));
      setAssetsReady(true);
    });
    return () => { active = false; };
  }, [assetRepository, runner]);

  useEffect(() => {
    audio.gender = profile.gender;
    reading.setTextContext(catalog?.english ?? {}, profile);
    backlog.setTextContext(catalog?.english ?? {}, catalog?.speakers ?? {}, profile);
  }, [reading, backlog, catalog?.english, catalog?.speakers, profile.playerName, profile.gender]);

  const groups = useMemo(() => [...new Set(catalog?.index.map(entry => entry.group) ?? [])].sort(), [catalog]);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase('en');
    return (catalog?.index ?? []).filter(entry => (!group || entry.group === group) && (!search || `${entry.id} ${entry.group} ${entry.stateKey}`.toLocaleLowerCase('en').includes(search)));
  }, [catalog, query, group]);
  const selectionId = filtered.some(entry => entry.id === selectedId) ? selectedId : filtered[0]?.id ?? '';
  const selectedStory = catalog?.index.find(entry => entry.id === selectionId);
  const selectedStoryLabel = selectedStory ? `${selectedStory.id} · ${selectedStory.group}` : '';

  async function start(preserveStoryState = false) {
    audio.unlock();
    if (!catalog || !selectionId || loading.current) return;
    loading.current = true;
    const requestedId = selectionId;
    backlog.clear();
    setSelectedId(requestedId);
    setBusy(true);
    setLoadError(null);
    try {
      journey.stop();
      const script = await repository.script(requestedId);
      if (runner.load(script, catalog.manifest, { preserveStoryState, storySource: catalog.storySource })) {
        runner.start();
        const nextUrl = interfaceHref(isDeveloperRoute(window.location.pathname), window.location.search, requestedId);
        window.history.replaceState(null, '', nextUrl);
      }
    } catch (error) {
      setLoadError(errorInfo(error, { scriptId: requestedId }));
    } finally {
      loading.current = false;
      setBusy(false);
    }
  }

  async function beginPlaythrough() {
    audio.unlock();
    if (!catalog || loading.current) return;
    loading.current = true; setBusy(true); setLoadError(null); backlog.clear(); setCheckpoint(null);
    try {
      if (!await journey.start(catalog)) setLoadError({ code: 'PLAYTHROUGH_UNAVAILABLE', message: catalog.storySourceError ?? 'The authored activity could not start.', fatal: false, scriptId: null, flowActionIndex: null, nid: null });
      window.history.replaceState(null, '', interfaceHref(false, window.location.search, null));
    } catch (error) { setLoadError(errorInfo(error)); }
    finally { loading.current = false; setBusy(false); }
  }

  function saveCheckpoint() {
    if (journeyState.active) {
      const saved = journey.createCheckpoint(); if (saved) setCheckpoint({ kind: 'playthrough', value: saved });
    } else {
      const saved = runner.createCheckpoint(); if (saved) setCheckpoint({ kind: 'scene', value: saved });
    }
  }
  async function restoreCheckpoint() {
    if (!checkpoint || busy) return;
    setBusy(true);
    try {
      if (checkpoint.kind === 'playthrough') await journey.restoreCheckpoint(checkpoint.value);
      else { journey.stop(); runner.restoreCheckpoint(checkpoint.value); }
    } finally { setBusy(false); }
  }

  const settings = <>
    <fieldset className="audio-settings"><legend>Audio</legend>
      {(['music', 'effects', 'voice'] as const).map(channel => <label key={channel}>{channel === 'music' ? 'Music' : channel === 'effects' ? 'Effects and ambience' : 'Voice'}<input type="range" min="0" max="1" step="0.05" aria-label={channel === 'music' ? 'Music volume' : channel === 'effects' ? 'Effects and ambience volume' : 'Voice volume'} value={audioState.volumes[channel]} onChange={event => { audio.unlock(); audio.volume(channel, Number(event.target.value)); }} data-testid={`volume-${channel}`} /><output>{Math.round(audioState.volumes[channel] * 100)}%</output></label>)}
      {audioState.languages.length > 0 && <label>Voice language<select aria-label="Voice language" value={audioState.language} onChange={event => audio.language(event.target.value)}>{audioState.languages.map(language => <option key={language} value={language}>{({ ja: 'Japanese', en: 'English', zh: 'Chinese', ko: 'Korean' } as Record<string, string>)[language] ?? language}</option>)}</select></label>}
    </fieldset>
    <div className="profile-fields">
      <label>Player name<input value={profile.playerName} maxLength={80} onChange={event => setProfile(current => ({ ...current, playerName: event.target.value }))} data-testid="player-name" /></label>
      <label>Gender<select value={profile.gender} onChange={event => setProfile(current => ({ ...current, gender: event.target.value as PlayerTextProfile['gender'] }))} data-testid="gender"><option value="male">Male</option><option value="female">Female</option></select></label>
    </div>
    <div className="reading-settings" aria-label="Text settings">
      <label className="text-speed">Text speed <output htmlFor="text-speed">{readingState.textSpeed} characters/s</output><input id="text-speed" type="range" min="5" max="100" step="5" value={readingState.textSpeed} disabled={readingState.instantText} onChange={event => reading.setTextOptions({ textSpeed: Number(event.target.value) })} data-testid="text-speed" /></label>
      <label className="checkbox-label"><input type="checkbox" checked={readingState.instantText} onChange={event => reading.setTextOptions({ instantText: event.target.checked })} data-testid="instant-text" />Instant text</label>
    </div>
    <p className="history-note">Progress and checkpoints stay in this page. History is read-only. A new playthrough starts a new school year.</p>
    {snapshot.scriptId && <div className="checkpoint-controls"><button className="secondary" onClick={saveCheckpoint} disabled={busy || (journeyState.active ? !journeyState.canCheckpoint : !runner.canCheckpoint)} data-testid="save-checkpoint">Save checkpoint</button><button className="secondary" onClick={() => restoreCheckpoint()} disabled={busy || !checkpoint} data-testid="restore-checkpoint">Restore checkpoint</button>{checkpoint && <p role="status">Checkpoint saved.</p>}</div>}
    <button className="secondary" onClick={() => beginPlaythrough()} disabled={busy || !catalog} data-testid="new-playthrough">New playthrough</button>
    {developer && <button className="secondary" onClick={() => { journey.stop(); runner.resetStory(); }} disabled={busy || !snapshot.scriptId} data-testid="reset-story">Reset investigation state and replay</button>}
  </>;
  const storySelection = <div className="reader-story-fields">
    <h3>Second Coming of Solaris: Unwritten Dreams</h3>
    <p>A new school year, friendships, requests, and the choices that shape your future.</p>
    <button type="button" onClick={() => beginPlaythrough()} disabled={!catalog || busy} data-testid="library-start">Begin a new playthrough</button>
    <p className="library-note">Use Resume to return to your current school year.</p>
  </div>;

  return (
    <main className={`app ${developer ? 'developer-app' : 'reader-app'}`} data-testid="interface" data-interface={developer ? 'developer' : 'reader'}>
      {developer && <header className="page-header">
        <div><p className="eyebrow">Second Coming of Solaris · Unwritten Dreams</p><h1>Solaris School Reader</h1></div>
        <a href={developer ? readerHref : developerHref} onClick={event => switchView(event, !developer)} data-testid="switch-view">{developer ? 'Open reader' : 'Developer view'}</a>
      </header>}
      {loadError && <div className="error data-error" role="alert">{developer ? <><strong>{loadError.code}</strong><p>{loadError.message}</p></> : <p>The scene couldn’t load. <a href={developerHref} onClick={event => switchView(event, true)}>Open developer view</a> for details.</p>}</div>}
      {developer && <section className="selection-panel" aria-label="Script selection">
        <p className="eyebrow">Developer interface · explicit investigation controls</p>
        <div className="selection-fields">
          <label>Search ID or group<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="17048, 1004, x1, or a group" data-testid="script-search" /></label>
          <label>Group<select value={group} onChange={event => setGroup(event.target.value)} data-testid="group-filter"><option value="">All groups</option>{groups.map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="script-field">Script<select value={selectionId} onChange={event => setSelectedId(event.target.value)} disabled={!catalog || busy || !filtered.length} data-testid="script-select">
            {!filtered.length && <option value="">No matching scripts</option>}
            {filtered.map(entry => <option value={entry.id} key={entry.id}>{entry.id} · {entry.group} · {entry.nodes} nodes{entry.registered ? '' : ' · unregistered'}</option>)}
          </select></label>
          <button type="button" onClick={() => start()} disabled={!catalog || !selectionId || busy || !filtered.length} data-testid="start">{busy ? 'Loading…' : 'Start fresh'}</button>
        </div>
        <p className="result-count" data-testid="search-count">{filtered.length} matching scripts. Source group labels retained. Start fresh resets story state.</p>
        <button className="secondary" onClick={() => start(true)} disabled={!catalog || !selectionId || busy || !filtered.length} data-testid="continue-script">Load selected script, preserve story state (developer)</button>
        <p className="debug-note">This selects an investigation route, not an inferred story successor.</p>
        {settings}
      </section>}
      <ReaderSession audio={audio} runner={runner} reading={reading} backlog={backlog} presentations={presentations} presentationSource={presentationSource} catalog={catalog} profile={profile} busy={busy} assets={assets} backgroundVariant={backgroundVariant} onBackgroundVariantChange={setBackgroundVariant} developer={developer} settings={settings} developerHref={developerHref} onOpenDeveloper={event => switchView(event, true)} sourceError={catalog?.storySourceError} storySelection={storySelection} beginStory={() => beginPlaythrough()} selectedStoryLabel="Unwritten Dreams" preparing={!catalog && !loadError || !presentationsReady || !audioState.ready || !assetsReady} journey={journey} restartStory={() => beginPlaythrough()} />
    </main>
  );
}
