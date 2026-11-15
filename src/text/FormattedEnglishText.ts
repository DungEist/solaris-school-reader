import { resolvePlayerTokens } from './EnglishText.ts';
import type { PlayerTextProfile } from './EnglishText.ts';

export interface TextFormat {
  readonly tag: 'strong' | 'em' | 'u' | 's' | 'span';
  readonly color?: string;
}

export interface TextRun {
  readonly text: string;
  readonly start: number;
  readonly formats: readonly TextFormat[];
}

/** Markup is parsed in full before reveal. Offsets refer to the resolved text. */
export interface FormattedEnglishText {
  readonly text: string;
  readonly runs: readonly TextRun[];
  readonly graphemeEnds: readonly number[];
}

export const emptyFormattedText: FormattedEnglishText = Object.freeze({ text: '', runs: Object.freeze([]), graphemeEnds: Object.freeze([]) });
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
const entities: Readonly<Record<string, string>> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, (entity, name: string) => {
    if (!name.startsWith('#')) return entities[name.toLowerCase()] ?? entity;
    const point = name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '\ufffd';
  });
}

export function parseEnglishText(template: string, profile: PlayerTextProfile): FormattedEnglishText {
  // Names enter as escaped text, so neither markup nor entities in a name can
  // become formatting. Gender branches are resolved before parsing any tags.
  const playerName = profile.playerName.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  const resolved = resolvePlayerTokens(template, { ...profile, playerName });
  const stack: { name: string; format?: TextFormat }[] = [];
  const runs: TextRun[] = [];
  let text = '';
  const append = (part: string) => {
    if (!part) return;
    const formats = stack.flatMap(entry => entry.format ? [entry.format] : []);
    const previous = runs.at(-1);
    if (previous && previous.formats.length === formats.length && formats.every((format, index) => format === previous.formats[index])) {
      runs[runs.length - 1] = Object.freeze({ ...previous, text: previous.text + part });
    } else runs.push(Object.freeze({ text: part, start: text.length, formats: Object.freeze(formats) }));
    text += part;
  };
  for (const part of resolved.split(/(<[^>]*>|<\/?[a-z][^>]*$)/gi)) {
    if (!part.startsWith('<') || !part.endsWith('>') && !/^<\/?[a-z]/i.test(part)) { append(decodeEntities(part)); continue; }
    if (!part.endsWith('>')) continue; // Never reveal an unterminated source tag.
    const tag = /^<\s*(\/?)\s*([a-z]+)\b([^>]*)>$/i.exec(part);
    if (!tag) continue;
    const [, closing, sourceName, attributes] = tag;
    const name = sourceName.toLowerCase();
    if (name === 'br') { if (!closing) append('\n'); continue; }
    if (closing) {
      const index = stack.findLastIndex(entry => entry.name === name);
      if (index >= 0) stack.splice(index);
      continue;
    }
    let format: TextFormat | undefined;
    const semantic = { b: 'strong', i: 'em', u: 'u', s: 's' } as const;
    if (Object.hasOwn(semantic, name)) format = Object.freeze({ tag: semantic[name as keyof typeof semantic] });
    if (name === 'color') {
      const color = /^\s*=\s*["']?(#[\da-f]{3}|#[\da-f]{4}|#[\da-f]{6}|#[\da-f]{8})["']?\s*$/i.exec(attributes)?.[1];
      if (color) format = Object.freeze({ tag: 'span', color });
    }
    // Other wrappers (including source ano annotations) retain their content.
    // No arbitrary HTML, CSS, attributes, font resources or links are rendered.
    if (!/\/\s*$/.test(attributes)) stack.push({ name, format });
  }
  const graphemeEnds = segmenter ? [...segmenter.segment(text)].map(item => item.index + item.segment.length) : text ? [text.length] : [];
  return Object.freeze({ text, runs: Object.freeze(runs), graphemeEnds: Object.freeze(graphemeEnds) });
}

export function formattedEnglishText(key: string | null, table: Readonly<Record<string, string>>, profile: PlayerTextProfile): FormattedEnglishText {
  return key === null ? emptyFormattedText : parseEnglishText(table[key] ?? `[Missing English text: ${key}]`, profile);
}
