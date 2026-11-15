import type { ScriptNode, Speaker } from '../engine/types.ts';

export interface PlayerTextProfile {
  readonly playerName: string;
  readonly gender: 'male' | 'female';
}

export function resolvePlayerTokens(text: string, profile: PlayerTextProfile, depth = 0): string {
  if (depth > 10) return text;
  let result = '';
  for (let i = 0; i < text.length;) {
    if (text.startsWith('{PlayerName}', i)) {
      result += profile.playerName;
      i += '{PlayerName}'.length;
      continue;
    }
    if (text.startsWith('{Male=', i) || text.startsWith('{Female=', i)) {
      let braces = 1;
      let end = i + 1;
      for (; end < text.length; end++) {
        if (text[end] === '{') braces++;
        if (text[end] === '}' && --braces === 0) break;
      }
      if (braces === 0) {
        const body = text.slice(i + 1, end);
        let nesting = 0;
        let separator = -1;
        for (let j = 0; j < body.length; j++) {
          if (body[j] === '{') nesting++;
          if (body[j] === '}') nesting--;
          if (nesting === 0 && (body.startsWith(';Female=', j) || body.startsWith(';Male=', j))) {
            separator = j;
            break;
          }
        }
        if (separator >= 0) {
          const first = body.slice(0, separator);
          const second = body.slice(separator + 1);
          const desired = profile.gender === 'male' ? 'Male=' : 'Female=';
          const selected = [first, second].find(part => part.startsWith(desired));
          if (selected !== undefined) {
            result += resolvePlayerTokens(selected.slice(desired.length), profile, depth + 1);
            i = end + 1;
            continue;
          }
        }
      }
    }
    result += text[i++];
  }
  return result;
}

/** Plain text only: common formatting tags are removed before inserting names. */
export function formatEnglishText(template: string, profile: PlayerTextProfile): string {
  const entities: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
  const plain = template
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/?(?:b|i|u|s|color|size|font|span)\b[^>]*>/gi, '')
    .replace(/&(?:nbsp|amp|lt|gt|quot);|&#39;/g, entity => entities[entity]);
  return resolvePlayerTokens(plain, profile);
}

export function englishText(key: string | null, table: Readonly<Record<string, string>>, profile: PlayerTextProfile): string {
  if (key === null) return '';
  return formatEnglishText(table[key] ?? `[Missing English text: ${key}]`, profile);
}

export function speakerName(node: ScriptNode, speakers: Readonly<Record<string, Speaker>>, english: Readonly<Record<string, string>>, profile: PlayerTextProfile): string {
  if (node.speakerId === null) return node.kind === 'centerText' ? 'Center text' : 'Narration';
  const key = speakers[node.speakerId]?.nameKey;
  return key && english[key] ? formatEnglishText(english[key], profile) : `Speaker ${node.speakerId}`;
}
