import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ReaderIcon, stopRepeatedButtonKey } from './ReaderArtwork.tsx';

/** Native focus trapping; this dialog changes UI state, never engine clocks. */
export function ReaderDialog({ id, title, children, className = '', restoreFocusTo, onClose, actions, testId }: {
  id: string; title: string; children: ReactNode; className?: string;
  restoreFocusTo: HTMLElement | null; onClose(): void; actions?: ReactNode; testId?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const current = dialog.current!;
    const previousFocus = restoreFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    current.showModal();
    close.current?.focus();
    return () => {
      if (current.open) current.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [restoreFocusTo]);
  return <dialog ref={dialog} id={id} className={`reader-modal ${className}`} aria-modal="true" aria-labelledby={`${id}-title`}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onKeyDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <div className="reader-modal-toolbar">{actions}<button ref={close} className="reader-round reader-close" type="button" aria-label={`Close ${title}`} onClick={onClose} onKeyDown={stopRepeatedButtonKey} data-testid={`${testId ?? (className.includes('handbook') ? 'menu' : 'stories')}-close`}><ReaderIcon name="close" /></button></div>
    <h2 className="reader-modal-title" id={`${id}-title`}>{title}</h2>
    {children}
  </dialog>;
}
