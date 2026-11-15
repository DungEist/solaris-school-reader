import { useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { ResolvedVisualAsset } from '../assets/AssetResolver.ts';
import type { VisualAssets } from '../assets/VisualAssets.ts';
import type { EnglishCatalog } from '../data/EnglishScriptRepository.ts';
import type { RunnerSnapshot } from '../engine/types.ts';
import { speakerName } from '../text/EnglishText.ts';
import type { PlayerTextProfile } from '../text/EnglishText.ts';
import { VisualStage } from './VisualStage.tsx';
import type { ReadingSnapshot } from './ManualReader.ts';
import { formattedEnglishText } from '../text/FormattedEnglishText.ts';
import { RevealedText } from './RevealedText.tsx';
import { isReadingKey } from './ReadingInput.ts';
import { QuizView } from './QuizView.tsx';
import { ReaderIcon, readerArt, stopRepeatedButtonKey } from './ReaderArtwork.tsx';
import { SpeakerAvatar, speakerAvatarView } from './SpeakerAvatar.tsx';
import { readSystemOptionCondition, storyDate } from '../engine/StoryState.ts';

interface Props {
  snapshot: RunnerSnapshot;
  reading: ReadingSnapshot;
  catalog: EnglishCatalog | null;
  profile: PlayerTextProfile;
  busy: boolean;
  assets: VisualAssets;
  backgroundVariant: 'day' | 'night';
  failedUrls: ReadonlySet<string>;
  onImageError(asset: ResolvedVisualAsset): void;
  historyId: string;
  historyOpen: boolean;
  inputsBlocked?: boolean;
  historyCount: number;
  openHistory(opener: HTMLElement): void;
  advance(): void;
  choose(index: number): void;
  answerQuiz(id: number): void;
  continueQuiz(): void;
  restart(): void;
  developer?: boolean;
  developerHref?: string;
  onOpenDeveloper?(event: MouseEvent<HTMLAnchorElement>): void;
  settingsId?: string;
  settingsOpen?: boolean;
  openSettings?(opener: HTMLElement): void;
  menuId?: string;
  menuOpen?: boolean;
  openMenu?(opener: HTMLElement): void;
  uiHidden?: boolean;
  entryOpen?: boolean;
  onToggleUI?(): void;
  fullPlaythrough?: boolean;
  stageChoices?: ReactNode;
  stageContext?: ReactNode;
}

export function PlayerView({ snapshot, reading, catalog, profile, busy, assets, backgroundVariant, failedUrls, onImageError, historyId, historyOpen, inputsBlocked = historyOpen, historyCount, openHistory, advance, choose, answerQuiz, continueQuiz, restart, developer = false, developerHref = '/debug', onOpenDeveloper, settingsId, settingsOpen, openSettings, menuId, menuOpen, openMenu, uiHidden = false, entryOpen = false, onToggleUI, fullPlaythrough = false, stageChoices, stageContext }: Props) {
  const stageRoot = useRef<HTMLElement>(null);
  const screenOffset = snapshot.effects.screenOffset;
  const stageScale = screenOffset.some(value => value !== 0) ? (stageRoot.current?.clientWidth ?? 0) / 2560 : 0;
  const dialogue = snapshot.dialogue;
  const movies = snapshot.events.filter(event => event.type === 'movieSkipped');
  const determined = snapshot.hiddenChoice && snapshot.branchResolution?.optionIndex !== null && snapshot.branchResolution?.optionIndex !== undefined;
  const canAdvance = !inputsBlocked && !busy && reading.inputReady && ['dialogue', 'choices'].includes(snapshot.status) && (!reading.complete || snapshot.status === 'dialogue' || determined);
  const optionPresentation = useMemo(() => snapshot.choices.map((option, i) => {
    const condition = readSystemOptionCondition(option.preCondition), unmet = snapshot.choiceConditions[i]?.value !== 'true';
    const textKey = !developer && unmet && condition?.unmetTextKey ? condition.unmetTextKey : option.textKey;
    return { textKey, text: formattedEnglishText(textKey, catalog?.english ?? {}, profile), hidden: !developer && unmet && condition?.hideWhenUnmet, hideConditionText: condition?.hideConditionTextWhenUnmet };
  }), [snapshot.choices, snapshot.choiceConditions, catalog?.english, profile.playerName, profile.gender, developer]);
  const avatar = speakerAvatarView(snapshot);
  const name = dialogue && catalog ? speakerName(dialogue, catalog.speakers, catalog.english, profile) : '';
  const date = snapshot.storyState.dayIndex === null ? null : storyDate(snapshot.storyState.dayIndex);
  const dateLabel = date ? `${String(date.month).padStart(2, '0')}/${String(date.day).padStart(2, '0')}` : '—';
  const slotLabel = ['Morning', 'Day', 'Noon', 'Dusk', 'Night'][(snapshot.storyState.timeSlot ?? 1) - 1] ?? 'Story';
  const narration = !!dialogue && (['narration', 'centerText'].includes(dialogue.kind) || !dialogue.speakerId || name === 'Narrator' || !catalog?.english[catalog.speakers[dialogue.speakerId]?.nameKey ?? '']);
  const restore = useRef<HTMLButtonElement>(null);
  const hide = useRef<HTMLButtonElement>(null);
  const previouslyHidden = useRef(false);
  useEffect(() => {
    if (uiHidden) restore.current?.focus({ preventScroll: true });
    else if (previouslyHidden.current) hide.current?.focus({ preventScroll: true });
    previouslyHidden.current = uiHidden;
  }, [uiHidden]);
  const advanceKey = (event: KeyboardEvent<HTMLElement>) => {
    if (![' ', 'Enter'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    const accepted = isReadingKey(event.nativeEvent);
    event.preventDefault();
    event.stopPropagation();
    if (accepted && canAdvance) advance();
  };
  const choiceControls = catalog && !snapshot.quiz && !snapshot.hiddenChoice && snapshot.choices.length > 0 && (
    <div className="choices" role="group" aria-label="Dialogue choices" hidden={!developer && (uiHidden || entryOpen)}>
      {snapshot.choices.map((option, i) => (optionPresentation[i].hidden ? null :
        <button key={i} type="button" disabled={inputsBlocked || busy || !reading.complete || snapshot.status !== 'choices' || !reading.inputReady || snapshot.choiceConditions[i]?.value !== 'true'} onClick={event => { event.stopPropagation(); choose(i); }} onKeyDown={stopRepeatedButtonKey} data-testid="choice" data-option-index={i} data-option-id={option.optionId ?? ''}>
          {!developer && <img className="choice-icon" src={readerArt('choice-icon')} alt="" aria-hidden="true" />}
          {!developer && optionPresentation[i].textKey && catalog.english[optionPresentation[i].textKey!] === undefined ? 'Response unavailable.' : optionPresentation[i].text.text ? <RevealedText document={optionPresentation[i].text} /> : `Choice ${i + 1}`}
          {!developer && snapshot.choiceConditions[i]?.value !== 'true' && !optionPresentation[i].hideConditionText && <span className="choice-locked">Requirements unmet</span>}
        </button>
      ))}
    </div>
  );
  return (
    <section ref={stageRoot} className="player" aria-label="Script player" data-testid="runner-state" data-status={snapshot.status} data-script-id={snapshot.scriptId ?? ''} data-nid={snapshot.nid ?? ''} data-flow-action-index={snapshot.flowActionIndex} data-visit-id={snapshot.visitId} data-run-id={snapshot.runId} data-hidden-choice={snapshot.hiddenChoice} data-input-ready={!inputsBlocked && reading.inputReady && ['dialogue', 'choices'].includes(snapshot.status)} data-text-complete={reading.complete} data-history-open={historyOpen} data-settings-open={settingsOpen} data-menu-open={menuOpen} data-ui-hidden={uiHidden} data-entry-open={entryOpen} data-vfx-screen-offset={screenOffset.join(',')} data-vfx-portrait-targets={snapshot.effects.active.filter(effect => effect.target === 'portrait').map(effect => effect.who).join(',')} style={stageScale ? { transform: `translate(${screenOffset[0] * stageScale}px,${-screenOffset[1] * stageScale}px)` } : undefined}>
      {developer && <div className="player-heading">
        <h2>{snapshot.scriptId ? `Script ${snapshot.scriptId}` : 'Script player'}</h2>
        <span className={`status status-${snapshot.status}`} data-testid="runner-status">{snapshot.status}</span>
      </div>}
      <VisualStage key={`${snapshot.runId}:${snapshot.sceneId}`} state={snapshot.stageState} presentation={snapshot.presentation} effects={snapshot.effects} assets={assets} catalog={catalog} profile={profile} backgroundVariant={backgroundVariant} failedUrls={failedUrls} onImageError={onImageError} diagnostics={developer} />
      {!developer && stageContext}
      {!developer && !entryOpen && <div className="reader-toolbar">
        {uiHidden ? <button ref={restore} className="reader-restore" type="button" onClick={onToggleUI} onKeyDown={stopRepeatedButtonKey} data-testid="restore-ui"><ReaderIcon name="hide" />Show interface <span className="reader-key">Esc</span></button> : <>
          <button ref={hide} className="reader-round" type="button" aria-label="Hide interface" title="Hide interface" onClick={onToggleUI} onKeyDown={stopRepeatedButtonKey} data-testid="hide-ui"><ReaderIcon name="hide" /></button>
          <button className="reader-round" type="button" aria-label={`History (${historyCount}) — Story Review`} title="Story Review" aria-haspopup="dialog" aria-expanded={historyOpen} aria-controls={historyId} onClick={event => openHistory(event.currentTarget)} onKeyDown={stopRepeatedButtonKey} data-testid="history"><ReaderIcon name="history" /><span className="sr-only">History ({historyCount})</span></button>
          <button className="reader-round" type="button" aria-label="Settings" title="Settings" aria-haspopup="dialog" aria-expanded={settingsOpen} aria-controls={settingsId} onClick={event => openSettings?.(event.currentTarget)} onKeyDown={stopRepeatedButtonKey} data-testid="settings"><ReaderIcon name="settings" /></button>
          <button className="reader-round" type="button" aria-label="School Handbook menu" title="School Handbook" aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls={menuId} onClick={event => openMenu?.(event.currentTarget)} onKeyDown={stopRepeatedButtonKey} data-testid="menu"><ReaderIcon name="menu" /></button>
        </>}
      </div>}
      {!developer && <div className="reader-calendar" hidden={uiHidden || entryOpen} role="img" aria-label={`Calendar — ${date ? `${dateLabel}, ${slotLabel}` : 'source date unavailable'}`}><img className="calendar-grid" src={readerArt('calendar-grid')} alt="" /><img className="calendar-pink" src={readerArt('calendar-pink')} alt="" /><div className="calendar-frame"><strong>{dateLabel}</strong><span>{date ? slotLabel : snapshot.status === 'completed' ? 'Review' : 'Story'}</span></div><img className="calendar-ribbon" src={readerArt('calendar-ribbon')} alt="" /><img className="calendar-bird" src={readerArt('calendar-bird')} alt="" /></div>}
      {!developer && avatar && !snapshot.quiz && <div className="reader-avatar-layer" hidden={uiHidden || entryOpen}><SpeakerAvatar snapshot={snapshot} view={avatar} assets={assets} catalog={catalog} profile={profile} /></div>}
      <div className={`dialogue-box dialogue-${dialogue?.kind ?? 'empty'}${narration ? ' reader-narration' : ''}${snapshot.quiz ? ' reader-quiz-dialogue' : ''}`} hidden={!developer && (uiHidden || entryOpen)}>
        {snapshot.status === 'idle' && <p>{developer ? 'Select a script and press Start.' : 'Begin reading when you’re ready.'}</p>}
        {snapshot.status === 'ready' && <p>Script loaded.</p>}
        {snapshot.quiz && <QuizView quiz={snapshot.quiz} english={catalog?.english ?? {}} profile={profile} assets={assets} failedUrls={failedUrls} inputReady={!busy && snapshot.inputReady} historyOpen={inputsBlocked} answer={answerQuiz} continueQuiz={continueQuiz} onImageError={onImageError} developer={developer} developerHref={developerHref} onOpenDeveloper={onOpenDeveloper} />}
        {!snapshot.quiz && dialogue && catalog && (
          <>
            {(developer || !narration) && <p className="speaker" data-testid="speaker-name"><span>{name}</span></p>}
            <div className="dialogue-text-area" role="button" tabIndex={canAdvance ? 0 : -1} aria-disabled={!canAdvance} aria-label={reading.complete ? 'Advance dialogue' : 'Show full dialogue'} onClick={event => { event.stopPropagation(); if (canAdvance) advance(); }} onKeyDown={advanceKey} data-testid="dialogue-text-area">
              <p className="dialogue-text" data-testid="dialogue-text" data-visible-graphemes={reading.visibleGraphemes} aria-live={reading.complete ? 'polite' : 'off'}>{!developer && dialogue.textKey && catalog.english[dialogue.textKey] === undefined ? 'Text unavailable.' : <RevealedText document={reading.document} visibleGraphemes={reading.visibleGraphemes} />}</p>
            </div>
          </>
        )}
        {snapshot.status === 'choices' && !snapshot.hiddenChoice && <p className="choice-prompt reader-choice-prompt">Choose a response to continue.</p>}
        {snapshot.status === 'choices' && snapshot.hiddenChoice && !determined && <p className="choice-prompt" data-testid="hidden-choice-notice">This scene needs story information or a branch rule that isn’t available. {developer ? <a href="#debug-hidden-choices">Debug → Hidden branch override</a> : <a href={developerHref} onClick={onOpenDeveloper}>Open developer view</a>} to investigate.</p>}
        {snapshot.status === 'ending' && <p className="transition-notice" role="status" data-testid="ending-notice">{developer ? snapshot.stagePhase === 'option' ? 'Applying the selected branch’s scheduled performances…' : 'Finishing this node’s scheduled end operations…' : 'Continuing…'}</p>}
        {snapshot.status === 'running' && snapshot.pendingStage.length > 0 && <p className="transition-notice" role="status">{developer ? 'Applying this scene’s scheduled operations…' : 'Continuing…'}</p>}
        {developer && choiceControls}
        {snapshot.status === 'completed' && (
          <p className="completion" role="status" data-testid="completion">{developer ? `Script ${snapshot.scriptId} completed. All ${snapshot.flowActionIndex} flow actions finished.` : stageChoices ? 'Choose what to do next.' : fullPlaythrough ? 'Your school year continues.' : 'You’ve reached the end of this scene.'}</p>
        )}
        {snapshot.error && <div className="error" role="alert">{developer ? <><strong>{snapshot.error.code}</strong><p>{snapshot.error.message}</p></> : <p>This scene couldn’t continue. <a href={developerHref} onClick={onOpenDeveloper}>Open developer view</a> for details.</p>}</div>}
        {developer && movies.map(event => <p className="movie-notice" key={event.sequence}>Skipped movie {event.videoName ?? '(unnamed)'} and its audio.</p>)}
        {!developer && !stageChoices && <button className="paper-advance" type="button" onClick={advance} onKeyDown={advanceKey} disabled={!canAdvance} data-testid="advance" aria-label={reading.complete ? 'Advance dialogue' : 'Show full dialogue'}><img src={readerArt('advance-arrow')} alt="" /><span className="sr-only">Advance</span></button>}
      </div>
      {!developer && (stageChoices || choiceControls)}
      {developer && <div className="play-controls">
        <button type="button" onClick={advance} onKeyDown={advanceKey} disabled={!canAdvance} data-testid="advance">Advance</button>
        <button type="button" className="secondary" onClick={restart} disabled={inputsBlocked || busy || !snapshot.scriptId || snapshot.status === 'error'} data-testid="restart">Restart</button>
        <button type="button" className="secondary" aria-haspopup="dialog" aria-expanded={historyOpen} aria-controls={historyId} onClick={event => { event.stopPropagation(); openHistory(event.currentTarget); }} onKeyDown={event => { if (event.repeat && [' ', 'Enter'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); } }} data-testid="history">History ({historyCount})</button>
      </div>}
      <p className="control-hint" hidden={!developer && (uiHidden || entryOpen || !!stageChoices)}>{snapshot.quiz ? 'Select an answer, then Continue.' : <><span className="keyboard-hint">Click / Space / Enter</span><span className="touch-hint">Tap the dialogue</span>: reveal, then continue.</>}{developer && ' Restart restores the script’s entry story state and clears playback history.'}</p>
    </section>
  );
}
