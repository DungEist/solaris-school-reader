import { memo, useEffect, useRef, useSyncExternalStore } from 'react';
import type { BacklogEntry } from './DialogueBacklog.ts';
import { RevealedText } from './RevealedText.tsx';
import { ReaderIcon, stopRepeatedButtonKey } from './ReaderArtwork.tsx';

import type { AudioSnapshot, ReaderAudio } from '../audio/ReaderAudio.ts';

const noAudioSubscribe = () => () => {};
const noAudioSnapshot = () => null;

interface Props {
  audio?: ReaderAudio;
  gender?: string;
  id: string;
  entries: readonly BacklogEntry[];
  restoreFocusTo: HTMLElement | null;
  onClose(): void;
  diagnostics?: boolean;
}

/** A native modal traps focus and makes the surrounding page inert. Entry
 * updates do not reopen the dialog or reset its focus/scroll position. */
export const HistoryPanel = memo(function HistoryPanel({ id, entries, restoreFocusTo, onClose, diagnostics = true, audio, gender = 'male' }: Props) {
  const getAudioSnapshot = audio?.getSnapshot ?? noAudioSnapshot;
  const audioState = useSyncExternalStore<AudioSnapshot | null>(audio?.subscribe ?? noAudioSubscribe, getAudioSnapshot, getAudioSnapshot);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    closeRef.current!.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (restoreFocusTo?.isConnected) restoreFocusTo.focus({ preventScroll: true });
    };
  }, [restoreFocusTo]);

  return (
    <dialog ref={dialogRef} id={id} className={`history-panel${diagnostics ? '' : ' reader-history'}`} aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-note`} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }} onKeyDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} data-testid="history-panel">
      <div className="history-heading">
        <h2 id={`${id}-title`}>{!diagnostics && <ReaderIcon name="history" />}{diagnostics ? 'History' : 'Story Review'}</h2>
        <button ref={closeRef} type="button" className={diagnostics ? 'secondary' : 'reader-round reader-close'} aria-label="Close History" onClick={onClose} onKeyDown={event => { if (event.repeat && [' ', 'Enter'].includes(event.key)) event.preventDefault(); }} data-testid="history-close">{diagnostics ? 'Close' : <ReaderIcon name="close" />}</button>
      </div>
      <p id={`${id}-note`} className={`history-note${diagnostics ? '' : ' sr-only'}`}>Text and scene effects continue while history is open. Start or Restart clears this history.</p>
      <div className="history-scroll" role="region" aria-label="Visited dialogue and selected responses" tabIndex={0} data-testid="history-scroll">
        {entries.length ? (
          <ol className="history-entries" role="list">
            {entries.map(entry => (
              <li key={entry.id} className={`history-entry history-${entry.kind}`} data-testid="history-entry" data-entry-id={entry.id} data-entry-kind={entry.kind}>
                <div className="history-line-heading">
                  <p className="history-speaker">{entry.kind === 'choice' ? `${entry.speakerName} chose` : !diagnostics && /^Speaker \d+$/.test(entry.speakerName) ? 'Narration' : entry.speakerName}</p>
                  {entry.kind === 'dialogue' && audioState?.ready && !!audio?.resolvedVoice(entry.scriptId, entry.nodeId, entry.voiceCues, gender).length && <button type="button" className="history-voice" aria-label={`Replay ${entry.speakerName || 'dialogue'} voice`} aria-describedby={`${id}-${entry.id}-text`} title="Replay voice" onClick={() => audio.replay(entry.scriptId, entry.nodeId, entry.voiceCues, gender)} onKeyDown={stopRepeatedButtonKey} data-testid="history-voice" data-script-id={entry.scriptId} data-node-id={entry.nodeId}>
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 4.5 20 12 8 19.5Z" fill="currentColor" /></svg>
                  </button>}
                </div>
                <p id={`${id}-${entry.id}-text`} className="history-text">{!diagnostics && entry.document.text.startsWith('[Missing English text:') ? 'Text unavailable.' : <RevealedText document={entry.document} />}</p>
              </li>
            ))}
          </ol>
        ) : <p className="history-empty">No dialogue yet.</p>}
      </div>
    </dialog>
  );
});
