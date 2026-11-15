import type { Metadata } from '../engine/types.ts';
import type { ConsequenceNotice, RelationshipNotice } from './ReaderPresentations.ts';
import { ReaderDialog } from './ReaderDialog.tsx';
import { readerArt, stopRepeatedButtonKey } from './ReaderArtwork.tsx';
import { parseEnglishText } from '../text/FormattedEnglishText.ts';
import type { PlayerTextProfile } from '../text/EnglishText.ts';
import { RevealedText } from './RevealedText.tsx';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

type English = Readonly<Record<string, string>>;
const label = (change: Metadata, english: English, fallback: string): string =>
  typeof change.labelKey === 'string' && english[change.labelKey] ? english[change.labelKey]
    : typeof change.label === 'string' && change.label.trim() ? change.label : fallback;
const number = (value: unknown): string => typeof value === 'number' ? `${value > 0 ? '+' : ''}${value}` : '';
const hideMissingArt = (event: React.SyntheticEvent<HTMLImageElement>) => { event.currentTarget.hidden = true; };

/** The Reader stage establishes CSS containment. A planning-page notice uses
 * the viewport outside that stage so scrolling cannot hide a delivered gain. */
export function ReaderViewportConsequences({ children }: { children: ReactNode }) {
  const content = <div className="reader-app reader-planning-consequences">{children}</div>;
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}

/** Delivered mutations only. Nothing here reads route conditions, changes
 * inventory, or sends a playback command. Gain and favor cards share a layer
 * so simultaneous source rewards remain visible together, as in the game. */
export function ReaderConsequences({ notices, english, profile = { playerName: 'Rover', gender: 'male' } }: { notices: readonly ConsequenceNotice[]; english: English; profile?: PlayerTextProfile }) {
  if (!notices.length) return null;
  return <aside className="reader-consequences" aria-label="Story consequences" aria-live="polite" aria-atomic="false" data-testid="reader-consequences">
    {notices.map(notice => <div className="consequence-group" key={notice.id} data-stage-sequence={notice.stageSequence}>
      {notice.changes.map((change, i) => {
        const kind = String(change.kind);
        const name = label(change, english, kind === 'favor' ? 'Intimacy' : kind === 'item' ? 'Item' : kind === 'requestUnlocked' ? 'New request' : 'Attribute');
        return <div className={`consequence-card consequence-${kind}`} key={i} data-testid={`consequence-${kind}`}>
          {kind === 'attribute' && <img className="consequence-icon" src={readerArt(`attribute-${change.attributeId}`)} alt="" onError={hideMissingArt} />}
          {kind === 'favor' && <img className="consequence-portrait" src={readerArt(`favor-head-${change.roleId}`)} alt="" onError={hideMissingArt} />}
          {kind === 'item' && <img className="consequence-item-icon" src={readerArt('icon-book')} alt="" />}
          <div className="consequence-copy">
            {kind === 'requestUnlocked' && <span className="consequence-caption">Request unlocked</span>}
            {kind === 'item' && <span className="consequence-caption">{typeof change.value === 'number' && change.value < 0 ? 'Item used' : 'Received'}</span>}
            <span className="consequence-name">{kind === 'favor' && <span aria-hidden="true">✦ </span>}<RevealedText document={parseEnglishText(name, profile)} /></span>
            {kind !== 'requestUnlocked' && <span className="consequence-value">{number(change.value)}</span>}
          </div>
          {kind === 'attribute' && typeof change.value === 'number' && change.value > 0 && <span className="consequence-up" aria-hidden="true">⬆</span>}
        </div>;
      })}
    </div>)}
  </aside>;
}

export function ReaderRelationship({ id, notice, english, onClose, profile = { playerName: 'Rover', gender: 'male' } }: { id: string; notice: RelationshipNotice; english: English; onClose(): void; profile?: PlayerTextProfile }) {
  const change = notice.change;
  const name = label(change, english, 'this character');
  const tier = typeof change.tierLabelKey === 'string' ? english[change.tierLabelKey] : typeof change.tierLabel === 'string' ? change.tierLabel : undefined;
  const description = typeof change.descriptionKey === 'string' ? english[change.descriptionKey] : typeof change.description === 'string' ? change.description : undefined;
  const increased = typeof change.before === 'number' && typeof change.after === 'number' && change.after > change.before;
  const title = increased ? 'Intimacy Increased!' : 'Intimacy Changed';
  return <ReaderDialog id={id} title={title} className="reader-relationship" testId="relationship" restoreFocusTo={null} onClose={onClose}>
    <div className="relationship-card" data-testid="reader-relationship" data-stage-sequence={notice.stageSequence}>
      <div className="relationship-portrait"><img src={readerArt(`favor-role-${change.roleId}`)} alt="" onError={hideMissingArt} /></div>
      <h3>{title}</h3>
      <div className="relationship-paper">
        <p className="relationship-tier"><img src={readerArt('favor-tier-icon')} alt="" /><span>Your Intimacy with {name} has {increased ? 'increased' : 'changed'} to <strong>{tier ?? 'a new level'}</strong></span></p>
        {description && <p className="relationship-unlock"><span aria-hidden="true">✓</span><span><RevealedText document={parseEnglishText(description, profile)} /></span></p>}
      </div>
      <img className="relationship-stroke" src={readerArt('favor-popup-stroke')} alt="" aria-hidden="true" />
    </div>
    <button type="button" className="relationship-confirm" onClick={onClose} onKeyDown={stopRepeatedButtonKey} data-testid="relationship-confirm">Confirm</button>
  </ReaderDialog>;
}
