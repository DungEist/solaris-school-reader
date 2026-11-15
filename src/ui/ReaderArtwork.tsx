import type { CSSProperties } from 'react';

/** UI-only assets, copied without conversion from the exact local source files. */
export const readerArt = (name: string) => `${import.meta.env.BASE_URL}assets/reader-ui/${name}.webp`;

export function ReaderIcon({ name, className = '' }: { name: string; className?: string }) {
  return <img className={`reader-icon ${className}`} src={readerArt(`icon-${name}`)} alt="" aria-hidden="true" draggable={false} />;
}

export function PaperHeading({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`paper-heading ${className}`}><span>{children}</span></div>;
}

export function stopRepeatedButtonKey(event: React.KeyboardEvent<HTMLElement>) {
  if (![' ', 'Enter'].includes(event.key)) return;
  event.stopPropagation();
  if (event.repeat || event.nativeEvent.isComposing) event.preventDefault();
}

export const artBackground = (name: string): CSSProperties => ({ backgroundImage: `url("${readerArt(name)}")` });
