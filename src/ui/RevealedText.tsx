import { Fragment, createElement } from 'react';
import type { ReactNode } from 'react';
import type { FormattedEnglishText } from '../text/FormattedEnglishText.ts';

export function RevealedText({ document, visibleGraphemes = document.graphemeEnds.length }: { document: FormattedEnglishText; visibleGraphemes?: number }) {
  const offset = document.graphemeEnds[Math.min(visibleGraphemes, document.graphemeEnds.length) - 1] ?? 0;
  return <>{document.runs.map((run, index) => {
    if (run.start >= offset) return null;
    let content: ReactNode = run.text.slice(0, offset - run.start);
    for (const format of [...run.formats].reverse()) content = createElement(format.tag, format.color ? { style: { color: format.color } } : null, content);
    return <Fragment key={index}>{content}</Fragment>;
  })}</>;
}
