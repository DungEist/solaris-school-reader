import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ResolvedVisualAsset } from '../assets/AssetResolver.ts';
import { emptyVisualAssets } from '../assets/VisualAssets.ts';
import type { RuntimeAssetIssue, VisualAssets } from '../assets/VisualAssets.ts';
import type { EnglishCatalog } from '../data/EnglishScriptRepository.ts';
import type { ScriptRunner } from '../engine/ScriptRunner.ts';
import type { PlayerTextProfile } from '../text/EnglishText.ts';
import { DebugPanel } from './DebugPanel.tsx';
import { PlayerView } from './PlayerView.tsx';
import type { ManualReader } from './ManualReader.ts';
import type { DialogueBacklog } from './DialogueBacklog.ts';
import { HistoryPanel } from './HistoryPanel.tsx';
import { shouldHandleReadingShortcut } from './ReadingInput.ts';
import type { MouseEvent, ReactNode } from 'react';
import { SettingsPanel } from './SettingsPanel.tsx';
import { EntryMenu, HandbookMenu, ReaderLoading, StoryLibrary } from './ReaderMenus.tsx';
import { emptyPresentationSnapshot, noPresentationSubscription } from './ReaderPresentations.ts';
import type { ReaderPresentations, ReaderPresentationSource } from './ReaderPresentations.ts';
import { ReaderIntroduction, ReaderLetter } from './ReaderSpecialPresentations.tsx';
import { ReaderConsequences, ReaderRelationship, ReaderViewportConsequences } from './ReaderConsequences.tsx';
import { ReaderJourney, ReaderJourneyInteraction, ReaderJourneyChoices, JourneyDiagnostics } from './ReaderJourney.tsx';
import { currentJourneyDecision } from './JourneyDecision.ts';
import { getEmptyJourneySnapshot, noJourneySubscription } from '../engine/Playthrough.ts';
import type { StoryPlaythrough } from '../engine/Playthrough.ts';
import { ReaderDialog } from './ReaderDialog.tsx';

import type { ReaderAudio } from '../audio/ReaderAudio.ts';

interface Props {
  audio?: ReaderAudio;
  runner: ScriptRunner;
  reading: ManualReader;
  backlog: DialogueBacklog;
  catalog: EnglishCatalog | null;
  profile: PlayerTextProfile;
  busy: boolean;
  assets?: VisualAssets;
  backgroundVariant?: 'day' | 'night';
  onBackgroundVariantChange?(variant: 'day' | 'night'): void;
  developer?: boolean;
  settings?: ReactNode;
  developerHref?: string;
  onOpenDeveloper?(event: MouseEvent<HTMLAnchorElement>): void;
  sourceError?: string;
  storySelection?: ReactNode;
  beginStory?(): void;
  selectedStoryLabel?: string;
  preparing?: boolean;
  presentations?: ReaderPresentations;
  presentationSource?: ReaderPresentationSource | null;
  journey?: StoryPlaythrough;
  restartStory?(): void;
}

/** React reads the engine's snapshot. Only control callbacks send commands. */
export function ReaderSession({ audio, runner, reading, backlog, catalog, profile, busy, assets = emptyVisualAssets, backgroundVariant = 'day', onBackgroundVariantChange, developer = false, settings, developerHref = '/debug', onOpenDeveloper, sourceError, storySelection, beginStory, selectedStoryLabel = '', preparing = !catalog, presentations, presentationSource, journey, restartStory }: Props) {
  const snapshot = useSyncExternalStore(runner.subscribe, runner.getSnapshot, runner.getSnapshot);
  const readingState = useSyncExternalStore(reading.subscribe, reading.getSnapshot, reading.getSnapshot);
  const entries = useSyncExternalStore(backlog.subscribe, backlog.getSnapshot, backlog.getSnapshot);
  const notices = useSyncExternalStore(presentations?.subscribe ?? noPresentationSubscription, presentations?.getSnapshot ?? emptyPresentationSnapshot, presentations?.getSnapshot ?? emptyPresentationSnapshot);
  const journeyState = useSyncExternalStore(journey?.subscribe ?? noJourneySubscription, journey?.getSnapshot ?? getEmptyJourneySnapshot, journey?.getSnapshot ?? getEmptyJourneySnapshot);
  const continuationGate = developer ? null : presentations ?? null;
  useEffect(() => {
    journey?.setContinuationGate(continuationGate);
    return () => { journey?.setContinuationGate(null); };
  }, [journey, continuationGate]);
  const presentationEnglish = useMemo(() => ({ ...presentationSource?.english, ...catalog?.english }), [presentationSource?.english, catalog?.english]);
  const historyId = useId();
  const settingsId = useId();
  const menuId = useId();
  const storiesId = useId();
  const letterId = useId();
  const relationshipId = useId();
  const journeyId = useId();
  type Panel = 'history' | 'settings' | 'menu' | 'stories' | 'journey' | null;
  const [panel, setPanel] = useState<Panel>(null);
  const panelRef = useRef<Panel>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const openPanel = useCallback((next: Panel, opener: HTMLElement) => {
    if (panelRef.current) return;
    // Block synchronously, before a native modal mounts or an event bubbles.
    panelRef.current = next;
    openerRef.current = opener;
    setPanel(next);
  }, []);
  const replacePanel = (next: Panel) => { panelRef.current = next; setPanel(next); };
  const closePanel = useCallback(() => { panelRef.current = null; setPanel(null); }, []);
  const historyOpen = panel === 'history';
  const settingsOpen = panel === 'settings';
  const menuOpen = panel === 'menu';
  const [homeOpen, setHomeOpen] = useState(false);
  const homeRef = useRef(false);
  const entryOpen = !snapshot.scriptId || homeOpen;
  const [uiHidden, setUIHidden] = useState(false);
  const hiddenRef = useRef(false);
  const toggleUI = () => { hiddenRef.current = !hiddenRef.current; setUIHidden(hiddenRef.current); };
  const resume = () => { audio?.unlock(); homeRef.current = false; setHomeOpen(false); };
  const entry = () => { closePanel(); homeRef.current = true; setHomeOpen(true); };
  useEffect(() => {
    if (panelRef.current === 'stories') closePanel();
    homeRef.current = false; setHomeOpen(false);
    hiddenRef.current = false; setUIHidden(false);
  }, [snapshot.runId, closePanel]);
  const letterPending = !developer && notices.letters.length > 0;
  const relationshipPending = !developer && notices.relationships.length > 0;
  const decision = useMemo(() => currentJourneyDecision(journeyState), [journeyState]);
  const stageInteraction = !developer && decision?.kind === 'interaction';
  const relationshipFirst = relationshipPending && (!letterPending || notices.relationships[0].stageSequence <= notices.letters[0].stageSequence);
  const journeyInteractionVisible = !!journey && !!catalog && !!journeyState.interaction && !panel && !uiHidden && !entryOpen && !letterPending && !relationshipPending;
  const consequencesInJourneyDialog = !developer && (journeyInteractionVisible || panel === 'journey');
  const planningConsequences = !developer && journeyState.active && ['planning', 'complete', 'blocked'].includes(journeyState.phase) && !panel;
  // A stage interaction has a compact receipt region. Show its latest
  // delivered event first so earlier gains cannot bury a new purchase.
  const consequenceCards = !developer ? <ReaderConsequences notices={stageInteraction ? [...notices.consequences].reverse() : notices.consequences} english={presentationEnglish} profile={profile} /> : null;
  const blocked = () => !!panelRef.current || !developer && (hiddenRef.current || homeRef.current || !runner.getSnapshot().scriptId || !!presentations?.getSnapshot().letters.length || !!presentations?.getSnapshot().relationships.length || !!journey?.getSnapshot().interaction || !!journey?.getSnapshot().busy);
  const modalOpen = !!panel || letterPending || relationshipPending || !!journeyState.interaction && !stageInteraction;
  const decisionVisible = !developer && !!decision && !modalOpen && !uiHidden && !entryOpen;
  const canInteractWithJourney = () => !panelRef.current && !busy && !hiddenRef.current && !homeRef.current && !presentations?.getSnapshot().letters.length && !presentations?.getSnapshot().relationships.length && !journey?.getSnapshot().busy;
  const stageChoices = decisionVisible && journey && catalog
    ? <ReaderJourneyChoices journey={journey} snapshot={journeyState} catalog={catalog} profile={profile} disabled={busy} canInteract={canInteractWithJourney} /> : null;
  const stageContext = stageInteraction && journeyInteractionVisible && journey && catalog
    ? <ReaderJourneyInteraction id={journeyId} journey={journey} snapshot={journeyState} state={snapshot.storyState} catalog={catalog} profile={profile} consequences={consequenceCards} onStage /> : null;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!developer && hiddenRef.current && !panelRef.current && event.key === 'Escape' && !event.repeat) {
        event.preventDefault(); hiddenRef.current = false; setUIHidden(false); return;
      }
      if (blocked() || busy || !shouldHandleReadingShortcut(event)) return;
      const current = runner.getSnapshot();
      if (current.status !== 'dialogue' && !(current.status === 'choices' && (!reading.getSnapshot().complete || current.hiddenChoice && current.branchResolution?.optionIndex !== null))) return;
      event.preventDefault();
      reading.advance(current);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [reading, runner, busy, developer, presentations, journey]);
  const [imageFailures, setImageFailures] = useState<{ runId: number; issues: readonly RuntimeAssetIssue[] }>({ runId: snapshot.runId, issues: [] });
  // Image errors are presentation diagnostics, never engine commands. A new
  // run retries images, and late errors from an older run cannot affect it.
  const runtimeIssues = imageFailures.runId === snapshot.runId ? imageFailures.issues : [];
  const failedUrls = useMemo(() => new Set(runtimeIssues.map(issue => issue.url)), [runtimeIssues]);
  const onImageError = useCallback((asset: ResolvedVisualAsset) => {
    if (!asset.url || runner.getSnapshot().runId !== snapshot.runId) return;
    const issue = { url: asset.url, label: asset.label, reason: 'The cached image could not be loaded or decoded by the browser.' };
    setImageFailures(previous => {
      if (previous.runId > snapshot.runId) return previous;
      const issues = previous.runId === snapshot.runId ? previous.issues : [];
      return issues.some(entry => entry.url === issue.url) ? previous : { runId: snapshot.runId, issues: [...issues, issue] };
    });
  }, [runner, snapshot.runId]);
  return (
    <div className={`reader-layout${developer ? '' : ' reader-surface'}`}>
      <PlayerView snapshot={snapshot} reading={readingState} catalog={catalog} profile={profile} busy={busy || journeyState.busy} assets={assets} backgroundVariant={backgroundVariant} failedUrls={failedUrls} onImageError={onImageError} historyId={historyId} historyOpen={historyOpen} inputsBlocked={modalOpen || !!journeyState.interaction || !developer && (uiHidden || entryOpen)} historyCount={entries.length} openHistory={opener => openPanel('history', opener)} developer={developer} developerHref={developerHref} onOpenDeveloper={onOpenDeveloper} settingsId={settingsId} settingsOpen={settingsOpen} openSettings={opener => openPanel('settings', opener)} menuId={menuId} menuOpen={menuOpen} openMenu={opener => openPanel('menu', opener)} uiHidden={!developer && uiHidden} entryOpen={!developer && entryOpen} onToggleUI={toggleUI} advance={() => { if (!blocked()) reading.advance(snapshot); }} choose={index => { if (!blocked()) reading.choose(index, snapshot); }} answerQuiz={id => { if (!blocked() && snapshot.quiz) runner.answerQuiz(id, snapshot.quiz); }} continueQuiz={() => { if (!blocked() && snapshot.quiz) runner.continueQuiz(snapshot.quiz); }} restart={() => { if (!blocked()) runner.restart(); }} fullPlaythrough={journeyState.active} stageChoices={stageChoices} stageContext={stageContext} />
      {developer && <><DebugPanel snapshot={snapshot} readingInputReady={!modalOpen && !busy && readingState.inputReady} quizInputReady={!modalOpen && !busy && snapshot.inputReady} assets={assets} backgroundVariant={backgroundVariant} onBackgroundVariantChange={onBackgroundVariantChange} onInstantChange={value => { if (!blocked()) runner.setInstantTransitions(value); }} onHiddenOverride={index => { if (!blocked()) reading.overrideHiddenChoice(index, snapshot); }} onQuizResultOverride={result => { if (!blocked() && snapshot.quiz) runner.overrideQuizResult(result, snapshot.quiz); }} gender={profile.gender} runtimeIssues={runtimeIssues} sourceError={sourceError} />{journeyState.active && <JourneyDiagnostics snapshot={journeyState} />}</>}
      {!developer && entryOpen && <EntryMenu active={!!snapshot.scriptId} ready={!!catalog} busy={busy} selectedLabel={selectedStoryLabel} onBegin={() => { audio?.unlock(); beginStory?.(); }} onResume={resume} openStories={opener => openPanel('stories', opener)} openSettings={opener => openPanel('settings', opener)} developerHref={developerHref} onOpenDeveloper={onOpenDeveloper} />}
      {!developer && (busy || preparing) && <ReaderLoading message={busy ? 'Opening your story…' : 'Preparing the story library…'} />}
      {historyOpen && <HistoryPanel id={historyId} entries={entries} restoreFocusTo={openerRef.current} onClose={() => { audio?.stopVoice(); closePanel(); }} diagnostics={developer} audio={audio} gender={profile.gender} />}
      {settingsOpen && <SettingsPanel id={settingsId} restoreFocusTo={openerRef.current} onClose={closePanel} diagnostics={developer}>{settings}{!developer && <div className="settings-links"><button type="button" onClick={() => replacePanel('stories')}>Select a story</button><a href={developerHref} onClick={event => { onOpenDeveloper?.(event); if (event.defaultPrevented) closePanel(); }}>Developer view</a></div>}</SettingsPanel>}
      {menuOpen && <HandbookMenu id={menuId} restoreFocusTo={openerRef.current} active={!!snapshot.scriptId} busy={busy} onClose={closePanel} onSettings={() => replacePanel('settings')} onStories={() => replacePanel('stories')} onEntry={entry} onRestart={() => { closePanel(); if (journeyState.active) restartStory?.(); else runner.restart(); }} developerHref={developerHref} onOpenDeveloper={event => { onOpenDeveloper?.(event); if (event.defaultPrevented) closePanel(); }} onJourney={journeyState.active ? () => replacePanel('journey') : undefined} fullPlaythrough={journeyState.active} />}
      {panel === 'stories' && <StoryLibrary id={storiesId} restoreFocusTo={openerRef.current} onClose={closePanel}>{storySelection}</StoryLibrary>}
      {panel === 'journey' && journey && catalog && <ReaderDialog id={journeyId} title="School year" className="reader-journey-dialog" restoreFocusTo={openerRef.current} onClose={closePanel}>{consequenceCards && <div className="journey-consequences">{consequenceCards}</div>}<ReaderJourney journey={journey} snapshot={journeyState} state={snapshot.storyState} catalog={catalog} profile={profile} /></ReaderDialog>}
      {developer && journey && catalog && journeyState.active && ['planning', 'complete', 'blocked'].includes(journeyState.phase) && !panel && !uiHidden && !entryOpen && <ReaderJourney journey={journey} snapshot={journeyState} state={snapshot.storyState} catalog={catalog} profile={profile} disabled={busy} />}
      {!developer && !uiHidden && !entryOpen && notices.introduction && <div className="reader-presentation-layer"><ReaderIntroduction notice={notices.introduction} english={presentationEnglish} profile={profile} /></div>}
      {!developer && !uiHidden && !entryOpen && !consequencesInJourneyDialog && notices.consequences.length > 0 && (planningConsequences ? <ReaderViewportConsequences>{consequenceCards}</ReaderViewportConsequences> : <div className="reader-presentation-layer">{consequenceCards}</div>)}
      {letterPending && !relationshipFirst && !panel && !uiHidden && !entryOpen && <ReaderLetter key={notices.letters[0].id} id={letterId} notice={notices.letters[0]} english={presentationEnglish} profile={profile} restoreFocusTo={null} onClose={() => presentations?.dismissLetter(notices.letters[0].id)} />}
      {relationshipFirst && !panel && !uiHidden && !entryOpen && <ReaderRelationship key={notices.relationships[0].id} id={relationshipId} notice={notices.relationships[0]} english={presentationEnglish} profile={profile} onClose={() => presentations?.dismissRelationship(notices.relationships[0].id)} />}
      {!stageInteraction && journeyInteractionVisible && journey && catalog && <ReaderJourneyInteraction id={journeyId} journey={journey} snapshot={journeyState} state={snapshot.storyState} catalog={catalog} profile={profile} consequences={consequenceCards} />}
    </div>
  );
}
