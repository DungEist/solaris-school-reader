import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ReaderIcon } from './ReaderArtwork.tsx';

export function SettingsPanel({ id, children, restoreFocusTo, onClose, diagnostics = true }: { id: string; children: ReactNode; restoreFocusTo: HTMLElement | null; onClose(): void; diagnostics?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    dialog.current!.showModal();
    close.current!.focus();
    return () => {
      if (dialog.current?.open) dialog.current.close();
      if (restoreFocusTo?.isConnected) restoreFocusTo.focus({ preventScroll: true });
    };
  }, [restoreFocusTo]);
  return <dialog ref={dialog} id={id} className={`history-panel settings-panel${diagnostics ? '' : ' reader-settings'}`} aria-modal="true" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }} onKeyDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} data-testid="settings-panel">
    <div className="history-heading"><h2 id={`${id}-title`}>Settings</h2><button ref={close} type="button" className={diagnostics ? 'secondary' : 'reader-round reader-close'} aria-label="Close Settings" onClick={onClose} onKeyDown={event => { if (event.repeat && [' ', 'Enter'].includes(event.key)) event.preventDefault(); }} data-testid="settings-close">{diagnostics ? 'Close' : <ReaderIcon name="close" />}</button></div>
    <div className="settings-content">{children}</div>
  </dialog>;
}
