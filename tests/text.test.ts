import assert from 'node:assert/strict';
import test from 'node:test';
import { englishText, formatEnglishText, speakerName } from '../src/text/EnglishText.ts';
import { node } from './fixtures.ts';
import { parseEnglishText } from '../src/text/FormattedEnglishText.ts';

const male = { playerName: 'Sol', gender: 'male' } as const;
const female = { playerName: 'Luna', gender: 'female' } as const;

test('English text substitutes PlayerName and gender variants independently', () => {
  const template = 'Hello, {PlayerName}. {Male=He;Female=She} is {Male=ready;Female=here}.';
  assert.equal(formatEnglishText(template, male), 'Hello, Sol. He is ready.');
  assert.equal(formatEnglishText(template, female), 'Hello, Luna. She is here.');
});

test('gender substitution supports reversed fields, nested PlayerName, and empty variants', () => {
  assert.equal(formatEnglishText('{Female=Ms. {PlayerName};Male=Mr. {PlayerName}}', male), 'Mr. Sol');
  assert.equal(formatEnglishText('{Male=;Female=Hi, {PlayerName}}', female), 'Hi, Luna');
  assert.equal(formatEnglishText('{Male=;Female=Hi}', male), '');
});

test('player names are literal text and never interpreted as tags or further substitutions', () => {
  const playerName = '<img src=x onerror=alert(1)> $& {Male=wrong;Female=wrong}';
  assert.equal(formatEnglishText('<b>{PlayerName}</b>', { playerName, gender: 'male' }), playerName);
});

test('basic formatting tags become plain text, line breaks and entities remain readable', () => {
  assert.equal(formatEnglishText('<color=#fff>Hello</color><br/><i>Sol</i> &amp; &lt;test&gt;', male), 'Hello\nSol & <test>');
  assert.equal(formatEnglishText('Unknown {QuestId} and {Male=broken}', male), 'Unknown {QuestId} and {Male=broken}');
});

test('missing English strings and speakers have readable fallbacks', () => {
  assert.equal(englishText('missing', {}, male), '[Missing English text: missing]');
  assert.equal(englishText(null, {}, male), '');
  assert.equal(speakerName(node(1, { speakerId: '83' }), {}, {}, male), 'Speaker 83');
  assert.equal(speakerName(node(1, { speakerId: null, kind: 'narration' }), {}, {}, male), 'Narration');
  assert.equal(speakerName(node(1), { '999': { nameKey: 'player', talkerId: null } }, { player: '{PlayerName}' }, female), 'Luna');
});

test('formatted text resolves branches and literal names before segmenting Unicode and punctuation', () => {
  const name = '<img src=x> &amp; {Male=literal;Female=literal}';
  const document = parseEnglishText('<b>{Female=Ms.;Male=Mr.} {PlayerName}</b><br>e\u0301 👩🏽‍🚀 🇻🇳 &amp; &#x1f642;!', { playerName: name, gender: 'female' });
  assert.equal(document.text, `Ms. ${name}\ne\u0301 👩🏽‍🚀 🇻🇳 & 🙂!`);
  const clusters = document.graphemeEnds.map((end, index) => document.text.slice(document.graphemeEnds[index - 1] ?? 0, end));
  for (const cluster of ['e\u0301', '👩🏽‍🚀', '🇻🇳', '🙂', '!']) assert.ok(clusters.includes(cluster));
  assert.deepEqual(document.runs[0].formats, [{ tag: 'strong' }]);
  assert.ok(Object.isFrozen(document.graphemeEnds));
});

test('formatted text preserves safe nested emphasis/color and flattens unsupported wrappers without rendering attributes', () => {
  const document = parseEnglishText('<color=#d19f27><u>A</u><i>B</i></color><s>C</s><ano=annotation>D</ano><span onclick="bad()">E</span><img src=x><color=red>F</color>', male);
  assert.equal(document.text, 'ABCDEF');
  assert.deepEqual(document.runs[0].formats, [{ tag: 'span', color: '#d19f27' }, { tag: 'u' }]);
  assert.deepEqual(document.runs[1].formats, [{ tag: 'span', color: '#d19f27' }, { tag: 'em' }]);
  assert.deepEqual(document.runs[2].formats, [{ tag: 's' }]);
  assert.ok(document.runs.slice(3).every(run => run.formats.length === 0));
  assert.ok(!JSON.stringify(document.runs).includes('onclick'));
  assert.equal(parseEnglishText('A &AMP; B <b unfinished', male).text, 'A & B ');
  assert.equal(parseEnglishText('1 < 2 &lt;literal&gt;', male).text, '1 < 2 <literal>');
  assert.equal(parseEnglishText('< 2', male).text, '< 2');
});

test('grapheme segmentation spans formatting boundaries and retains CRLF as one cluster', () => {
  const document = parseEnglishText('<b>e</b>\u0301\r\n<u>👩</u>🏽‍🚀', male);
  assert.equal(document.text, 'e\u0301\r\n👩🏽‍🚀');
  assert.deepEqual(document.graphemeEnds, [2, 4, document.text.length]);
});
