import type { CSSProperties } from 'react';
import type { PlayerTextProfile } from '../text/EnglishText.ts';
import { formattedEnglishText } from '../text/FormattedEnglishText.ts';
import type { IntroductionDefinition, LetterDefinition, PresentationNotice } from './ReaderPresentations.ts';
import { ReaderDialog } from './ReaderDialog.tsx';
import { readerArt, stopRepeatedButtonKey } from './ReaderArtwork.tsx';
import { RevealedText } from './RevealedText.tsx';

export function ReaderIntroduction({ notice, english, profile }: { notice: PresentationNotice<IntroductionDefinition>; english: Readonly<Record<string, string>>; profile: PlayerTextProfile }) {
  const definition = notice.definition;
  const color = /^[a-f0-9]{6}$/i.test(definition.color) ? `#${definition.color}` : '#a9ca81';
  return <aside className="reader-introduction" data-testid="reader-introduction" data-intro-id={definition.id} data-stage-sequence={notice.stageSequence} aria-label="Character introduction" aria-live="polite" style={{ '--introduction-color': color } as CSSProperties}>
    <h3><RevealedText document={formattedEnglishText(definition.nameKey, english, profile)} /></h3>
    <p className="introduction-influence"><RevealedText document={formattedEnglishText(definition.influenceKey, english, profile)} /></p>
    <p><RevealedText document={formattedEnglishText(definition.textKey, english, profile)} /></p>
  </aside>;
}

export function ReaderLetter({ id, notice, english, profile, restoreFocusTo, onClose }: { id: string; notice: PresentationNotice<LetterDefinition>; english: Readonly<Record<string, string>>; profile: PlayerTextProfile; restoreFocusTo: HTMLElement | null; onClose(): void }) {
  return <ReaderDialog id={id} title="Letter" className="reader-letter" testId="letter" restoreFocusTo={restoreFocusTo} onClose={onClose}>
    <div className="reader-letter-sheet" data-testid="reader-letter" data-letter-id={notice.definition.id} data-stage-sequence={notice.stageSequence}>
      <div className="reader-letter-pages" role="region" aria-label="Letter text" tabIndex={0}>
        {notice.definition.pages.map((page, i) => <section key={page.id} aria-label={`Page ${i + 1}`}>{page.paragraphKeys.map(key => <p key={key}><RevealedText document={formattedEnglishText(key, english, profile)} /></p>)}</section>)}
      </div>
      <img className="letter-pen" src={readerArt('letter-pen')} alt="" aria-hidden="true" />
    </div>
    <button type="button" className="letter-confirm" onClick={onClose} onKeyDown={stopRepeatedButtonKey} data-testid="letter-confirm">Confirm</button>
  </ReaderDialog>;
}
