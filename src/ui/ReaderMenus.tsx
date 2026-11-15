import type { MouseEvent, ReactNode } from 'react';
import { ReaderDialog } from './ReaderDialog.tsx';
import { ReaderIcon, readerArt, stopRepeatedButtonKey } from './ReaderArtwork.tsx';

export function EntryMenu({ active, ready, busy, selectedLabel, onBegin, onResume, openStories, openSettings, developerHref, onOpenDeveloper }: {
  active: boolean; ready: boolean; busy: boolean; selectedLabel: string;
  onBegin(): void; onResume(): void; openStories(opener: HTMLElement): void; openSettings(opener: HTMLElement): void;
  developerHref: string; onOpenDeveloper?(event: MouseEvent<HTMLAnchorElement>): void;
}) {
  return <section className="reader-entry" aria-label="Story entry menu" data-testid="entry-menu" onClick={event => event.stopPropagation()}>
    <div className="entry-scene" aria-hidden="true" />
    <img className="entry-paper entry-paper-left" src={readerArt('entry-paper-left')} alt="" />
    <img className="entry-paper entry-paper-right" src={readerArt('entry-paper-right')} alt="" />
    <div className="entry-title"><p>Second Coming of Solaris</p><h1>Unwritten Dreams</h1><span>Solaris School Reader</span></div>
    <div className="entry-toolbar"><button className="reader-round" aria-label="Settings" aria-haspopup="dialog" onClick={event => openSettings(event.currentTarget)} onKeyDown={stopRepeatedButtonKey} data-testid="settings"><ReaderIcon name="settings" /></button><a className="reader-round" href={developerHref} onClick={onOpenDeveloper} aria-label="Open developer view" title="Developer view" data-testid="switch-view"><ReaderIcon name="rule" /></a></div>
    <div className="entry-actions">
      {active && <button type="button" className="entry-action entry-resume" onClick={onResume} onKeyDown={stopRepeatedButtonKey} data-testid="resume"><img src={readerArt('entry-resume-icon')} alt="" /><span>Resume reading</span></button>}
      <button type="button" className="entry-action" disabled={!ready || !selectedLabel || busy} onClick={onBegin} onKeyDown={stopRepeatedButtonKey} data-testid="start"><img src={readerArt('entry-open-icon')} alt="" /><span>Open story</span></button>
      <button type="button" className="entry-select" disabled={!ready || busy} onClick={event => openStories(event.currentTarget)} onKeyDown={stopRepeatedButtonKey} data-testid="open-stories"><ReaderIcon name="book" /><span>Select a story</span></button>
      {selectedLabel && <p className="entry-selection">Selected: {selectedLabel}</p>}
    </div>
    <p className="entry-footnote">A school, a new beginning, and choices along the way.</p>
  </section>;
}

export function ReaderLoading({ message }: { message: string }) {
  return <div className="reader-loading" role="status" aria-live="polite" aria-busy="true" data-testid="reader-loading">
    <div className="loading-emblem"><img src={readerArt('school-emblem')} alt="Solaris School emblem" /><img className="loading-emblem-caption" src={readerArt('school-emblem-caption')} alt="" /></div>
    <div className="loading-caption"><span className="loading-line" aria-hidden="true" /><p>{message}</p></div>
  </div>;
}

export function HandbookMenu({ id, restoreFocusTo, active, busy, onClose, onSettings, onStories, onEntry, onRestart, developerHref, onOpenDeveloper, onJourney, fullPlaythrough = false }: {
  id: string; restoreFocusTo: HTMLElement | null; active: boolean; busy: boolean;
  onClose(): void; onSettings(): void; onStories(): void; onEntry(): void; onRestart(): void;
  developerHref: string; onOpenDeveloper?(event: MouseEvent<HTMLAnchorElement>): void;
  onJourney?(): void; fullPlaythrough?: boolean;
}) {
  return <ReaderDialog id={id} title="School Handbook" className="reader-handbook" restoreFocusTo={restoreFocusTo} onClose={onClose}
    actions={<button type="button" className="handbook-settings" onClick={onSettings} onKeyDown={stopRepeatedButtonKey}><ReaderIcon name="settings" />Settings</button>}>
    <div className="handbook-body"><p>{active ? 'Your story is waiting. Pick up where you left off.' : 'Open a story and make a new beginning.'}</p><p className="handbook-note">Progress stays in this page. Scene effects and text continue while the menu is open.</p></div>
    <div className="handbook-actions">
      <button type="button" onClick={onClose} disabled={!active || busy} onKeyDown={stopRepeatedButtonKey}><span className="handbook-action-icon"><ReaderIcon name="book" /></span><span>Resume</span></button>
      <button type="button" onClick={onJourney ?? onStories} disabled={busy} onKeyDown={stopRepeatedButtonKey} data-testid="menu-stories"><span className="handbook-action-icon"><ReaderIcon name="history" /></span><span>{onJourney ? 'School year' : 'Select story'}</span></button>
      <button type="button" onClick={onEntry} disabled={busy} onKeyDown={stopRepeatedButtonKey} data-testid="menu-entry"><span className="handbook-action-icon"><ReaderIcon name="home" /></span><span>Entry menu</span></button>
    </div>
    <div className="handbook-secondary"><button type="button" onClick={onRestart} disabled={!active || busy} onKeyDown={stopRepeatedButtonKey} data-testid="restart">{fullPlaythrough ? 'New playthrough' : 'Restart scene'}</button><a href={developerHref} onClick={onOpenDeveloper} data-testid="switch-view">Developer view</a></div>
  </ReaderDialog>;
}

export function StoryLibrary({ id, restoreFocusTo, onClose, children }: { id: string; restoreFocusTo: HTMLElement | null; onClose(): void; children: ReactNode }) {
  return <ReaderDialog id={id} title="Select a story" className="reader-library" restoreFocusTo={restoreFocusTo} onClose={onClose}><div className="library-paper"><p>Begin a new school year and follow its story.</p>{children}</div></ReaderDialog>;
}
