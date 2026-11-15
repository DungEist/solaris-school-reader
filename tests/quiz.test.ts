import assert from 'node:assert/strict';
import test from 'node:test';
import { initialQuizState, reduceQuiz } from '../src/engine/Quiz.ts';
import { validateQuizDefinition } from '../src/engine/QuizValidation.ts';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import { ManualReader } from '../src/ui/ManualReader.ts';
import { DialogueBacklog } from '../src/ui/DialogueBacklog.ts';
import { resolveQuizIllustration, solarQuizImageRoot, ueQuizIllustrationWebpPath, ueReferenceWebpPath } from '../src/assets/AssetResolver.ts';
import { emptyVisualAssets } from '../src/assets/VisualAssets.ts';
import { validateVisualManifest, validateVisualMap } from '../src/assets/VisualAssetRepository.ts';
import { FakeClock, TimerPrecisionClock } from './FakeClock.ts';
import { fixture, manifest, node, option } from './fixtures.ts';
import { quizFixture, quizImage, quizOperation } from './quiz-fixtures.ts';

const token = { runId: 3, visitId: 7, instanceId: 11 };
const continuation = { phase: 'end', next: { type: 'seq' } } as const;

test('quiz reducer preserves source order/raw metadata and grades stable IDs using only explicit booleans', () => {
  const definition = quizFixture();
  const state = initialQuizState(definition, token, continuation);
  assert.deepEqual(state.definition, definition);
  assert.notEqual(state.definition, definition);
  assert.deepEqual(state.definition.answers.map(answer => answer.id), [21, 8, 45]);
  assert.ok(Object.isFrozen(state.definition.answers[0].raw));
  assert.ok(Object.isFrozen(state.continuation.next));
  assert.equal(Reflect.set(state.definition.answers[0].raw, 'IsCorrect', true), false);
  // The label/key says "yes", but the explicit flag is false.
  const incorrect = reduceQuiz(state, { type: 'answer', token, answerId: 21 });
  assert.equal(incorrect.result, 'incorrect');
  const correct = reduceQuiz(state, { type: 'answer', token, answerId: 8 });
  assert.equal(correct.result, 'correct');
  assert.equal(correct.resultSource, 'data');
  assert.equal(correct.selectedAnswerId, 8);
  assert.equal(state.phase, 'question');
  assert.equal(state.selectedAnswerId, null);
  assert.deepEqual(correct.continuation, continuation);
});

test('quiz reducer rejects indexes, rapid duplicates, stale visit/instance inputs and premature Continue', () => {
  const state = initialQuizState(quizFixture(), token, continuation);
  for (const answerId of [0, 1, NaN, Infinity, 8.5]) assert.equal(reduceQuiz(state, { type: 'answer', token, answerId }), state);
  for (const key of ['runId', 'visitId', 'instanceId'] as const) {
    assert.equal(reduceQuiz(state, { type: 'answer', token: { ...token, [key]: 999 }, answerId: 8 }), state);
  }
  assert.equal(reduceQuiz(state, { type: 'continue', token }), state);
  assert.equal(reduceQuiz(state, { type: 'overrideResult', token, result: 'correct' }), state);
  const selected = reduceQuiz(state, { type: 'answer', token, answerId: 8 });
  for (let i = 0; i < 20; i++) assert.equal(reduceQuiz(selected, { type: 'answer', token, answerId: 21 }), selected);
  assert.equal(reduceQuiz(selected, { type: 'overrideResult', token, result: 'incorrect' }), selected);
  const continued = reduceQuiz(selected, { type: 'continue', token });
  assert.equal(continued.phase, 'continued');
  assert.equal(reduceQuiz(continued, { type: 'continue', token }), continued);
  assert.equal(reduceQuiz(continued, { type: 'answer', token, answerId: 45 }), continued);
});

test('absent correctness stays unresolved until one explicit debug result override', () => {
  const definition = quizFixture({ answers: [{ id: 21, textKey: 'answer-yes', correct: null }] });
  validateQuizDefinition(definition, 'quiz');
  const state = initialQuizState(definition, token, continuation);
  const unresolved = reduceQuiz(state, { type: 'answer', token, answerId: 21 });
  assert.equal(unresolved.phase, 'unresolved');
  assert.equal(unresolved.result, null);
  assert.equal(reduceQuiz(unresolved, { type: 'continue', token }), unresolved);
  const overridden = reduceQuiz(unresolved, { type: 'overrideResult', token, result: 'incorrect' });
  assert.equal(overridden.resultSource, 'debug-override');
  assert.equal(overridden.result, 'incorrect');
  assert.equal(reduceQuiz(overridden, { type: 'overrideResult', token, result: 'correct' }), overridden);
  assert.equal(reduceQuiz(overridden, { type: 'continue', token }).phase, 'continued');
});

test('quiz validation rejects invented correctness, duplicate IDs and mismatched source joins', () => {
  const missing = quizFixture({ answers: [{ id: 21, textKey: 'answer-yes', correct: null }] });
  const invented = structuredClone(missing) as any;
  invented.answers[0].correct = true;
  assert.throws(() => validateQuizDefinition(invented, 'quiz'), /explicit IsCorrect/);
  const numeric = structuredClone(missing) as any;
  numeric.answers[0].raw.IsCorrect = 1;
  validateQuizDefinition(numeric, 'quiz');
  numeric.answers[0].correct = true;
  assert.throws(() => validateQuizDefinition(numeric, 'quiz'), /explicit IsCorrect/);
  for (const mutate of [
    (q: any) => { q.answers.push(q.answers[0]); },
    (q: any) => { q.answers[0].raw.GroupId = 99; },
    (q: any) => { q.raw.action.ActionType = 7; },
    (q: any) => { q.raw.action.ActionParams[0].Value = '99'; },
    (q: any) => { q.questionKey = 'invented'; },
  ]) {
    const invalid = structuredClone(quizFixture()); mutate(invalid);
    assert.throws(() => validateQuizDefinition(invalid, 'quiz'));
  }
});

test('silent start quiz stops automatic traversal while stage timers continue, then follows source nid order', () => {
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock });
  runner.load(fixture([node(40, { kind: 'silent', textKey: null, stage: [quizOperation(), { op: 'bg', mode: 'Load', id: 10, t: .5 }] }), node(0), node(8)]), manifest);
  runner.start();
  const opened = runner.getSnapshot().quiz!;
  assert.equal(runner.getSnapshot().status, 'quiz');
  assert.equal(runner.getSnapshot().nid, 40);
  assert.equal(runner.getSnapshot().events.filter(event => event.type === 'dialogue').length, 0);
  assert.equal(runner.getSnapshot().pendingStage.length, 1);
  assert.equal(runner.advance(), false);
  assert.equal(runner.choose(0), false);
  assert.equal(runner.continueQuiz(opened), false);
  clock.advanceBy(500);
  assert.equal(runner.getSnapshot().stageState.background?.id, 10);
  assert.equal(runner.getSnapshot().status, 'quiz');
  assert.equal(runner.answerQuiz(8, opened), true);
  const navigationCount = runner.getSnapshot().navigationHistory.length;
  clock.advanceBy(10_000);
  assert.equal(runner.getSnapshot().status, 'quiz', 'resultHoldMs is metadata, not auto-advance');
  assert.equal(runner.getSnapshot().navigationHistory.length, navigationCount);
  assert.equal(runner.continueQuiz(opened), true);
  assert.equal(runner.getSnapshot().nid, 0);
  assert.equal(runner.getSnapshot().status, 'dialogue');
  assert.deepEqual(runner.getSnapshot().navigationHistory.map(entry => entry.to), [40, 0]);
  assert.equal(runner.getSnapshot().choiceHistory.length, 0);
  runner.dispose();
});

test('end quiz retains a pending departure until result/Continue and scheduled ends both finish', () => {
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock });
  runner.load(fixture([node(9, { stage: [quizOperation(quizFixture(), { phase: 'end' }), { op: 'bg', mode: 'Load', id: 10, t: .5, phase: 'end' }] }), node(0)]), manifest);
  runner.start(); runner.advance();
  const quiz = runner.getSnapshot().quiz!;
  assert.equal(quiz.continuation.phase, 'end');
  assert.equal(runner.getSnapshot().nid, 9);
  assert.equal(runner.answerQuiz(21, quiz), true);
  assert.equal(runner.getSnapshot().quiz?.result, 'incorrect');
  assert.equal(runner.continueQuiz(quiz), true);
  assert.equal(runner.getSnapshot().status, 'ending');
  assert.equal(runner.getSnapshot().nid, 9);
  assert.equal(runner.advance(), false);
  clock.advanceBy(500);
  assert.equal(runner.getSnapshot().nid, 0);
  assert.equal(runner.getSnapshot().stageEvents.length, 2);
  assert.equal(runner.getSnapshot().events.filter(event => event.type === 'quizContinued').length, 1);
  runner.dispose();
});

test('quiz opened after option performances preserves selected FinishTalk and never enters the next node', () => {
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock });
  runner.load(fixture([
    node(1, { stage: [quizOperation(quizFixture(), { phase: 'end' })], options: [option({ optionId: 5, next: { type: 'end' }, performances: [{ op: 'bg', mode: 'Load', id: 10, phase: 'option', t: .1 }] })] }),
    node(2), node(90),
  ], [{ op: 'talk', nids: [1, 2] }, { op: 'talk', nids: [90] }]), manifest);
  runner.start(); runner.choose(0);
  assert.equal(runner.getSnapshot().status, 'ending');
  clock.advanceBy(100);
  const quiz = runner.getSnapshot().quiz!;
  assert.equal(runner.getSnapshot().status, 'quiz');
  assert.deepEqual(quiz.continuation.next, { type: 'end' });
  assert.equal(runner.getSnapshot().nid, 1);
  runner.answerQuiz(8, quiz); runner.continueQuiz(quiz);
  assert.equal(runner.getSnapshot().nid, 90);
  assert.equal(runner.getSnapshot().choiceHistory.length, 1);
  assert.equal(runner.getSnapshot().navigationHistory.some(entry => entry.to === 2), false);
  assert.equal(runner.getSnapshot().stageEvents.length, 2);
  runner.dispose();
});

test('multiple delivered quizzes retain order and unique instances; stale callbacks cannot answer or continue a later quiz', () => {
  const runner = new ScriptRunner({ instantTransitions: true });
  runner.load(fixture([node(1, { kind: 'silent', textKey: null, stage: [quizOperation(), quizOperation()] }), node(0)]), manifest);
  runner.start();
  const first = runner.getSnapshot().quiz!;
  assert.equal(runner.getSnapshot().events.filter(event => event.type === 'quizOpened').length, 1);
  runner.answerQuiz(8, first); runner.continueQuiz(first);
  const second = runner.getSnapshot().quiz!;
  assert.equal(second.visitId, first.visitId);
  assert.notEqual(second.instanceId, first.instanceId);
  for (let i = 0; i < 20; i++) {
    assert.equal(runner.answerQuiz(8, first), false);
    assert.equal(runner.continueQuiz(first), false);
  }
  assert.equal(runner.answerQuiz(21, second), true);
  assert.equal(runner.answerQuiz(8, second), false);
  assert.equal(runner.continueQuiz(second), true);
  assert.equal(runner.continueQuiz(second), false);
  assert.equal(runner.getSnapshot().nid, 0);
  assert.equal(runner.getSnapshot().events.filter(event => event.type === 'quizAnswered').length, 2);
  assert.equal(runner.getSnapshot().stageEvents.length, 2);
  runner.dispose();
});

test('quiz input guard recovers after rapid input; restart, script switch and disposal cancel old quiz callbacks', () => {
  const clock = new TimerPrecisionClock();
  const runner = new ScriptRunner({ clock, navigationDebounceMs: 200 });
  const source = fixture([node(1, { kind: 'silent', textKey: null, stage: [quizOperation(), quizOperation()] }), node(0)]);
  runner.load(source, manifest); runner.start();
  let quiz = runner.getSnapshot().quiz!;
  assert.equal(runner.answerQuiz(8, quiz), true);
  for (let i = 0; i < 20; i++) assert.equal(runner.continueQuiz(quiz), false);
  clock.crossDeadlineOnNextWake = true;
  clock.advanceBy(201);
  assert.equal(runner.getSnapshot().inputReady, true);
  assert.equal(runner.continueQuiz(quiz), true);
  assert.equal(runner.getSnapshot().nid, 1);
  const old = runner.getSnapshot().quiz!;
  const callbacks = [...clock.callbacks];
  runner.restart();
  quiz = runner.getSnapshot().quiz!;
  assert.notEqual(quiz.runId, old.runId);
  assert.equal(runner.getSnapshot().inputReady, true);
  assert.equal(runner.answerQuiz(8, old), false);
  assert.equal(runner.answerQuiz(8, quiz), true);
  runner.load({ ...source, id: 'switch' }, manifest); runner.start();
  assert.equal(runner.getSnapshot().quiz?.phase, 'question');
  assert.equal(runner.getSnapshot().inputReady, true);
  assert.equal(runner.continueQuiz(quiz), false);
  const afterSwitch = runner.getSnapshot();
  callbacks.forEach(callback => callback());
  assert.equal(runner.getSnapshot(), afterSwitch);
  quiz = afterSwitch.quiz!;
  runner.answerQuiz(8, quiz);
  const beforeDispose = [...clock.callbacks];
  runner.dispose();
  const disposed = runner.getSnapshot();
  beforeDispose.forEach(callback => callback());
  assert.equal(runner.getSnapshot(), disposed);
  assert.equal(disposed.quiz, null);
  assert.equal(disposed.status, 'disposed');
  assert.equal(clock.pendingTimers, 0);
});

test('delayed quizzes leave text/backlog clocks separate; reading input stays blocked until Continue', () => {
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock });
  const reading = new ManualReader(runner, { clock, textSpeed: 5, inputDebounceMs: 0 });
  const backlog = new DialogueBacklog(runner);
  const english = { 'line-1': 'A long line that keeps revealing.', 'line-0': 'Next.' };
  const profile = { playerName: 'Rover', gender: 'male' } as const;
  reading.setTextContext(english, profile); backlog.setTextContext(english, {}, profile);
  runner.load(fixture([node(1, { stage: [quizOperation(quizFixture(), { t: .5 })] }), node(0)]), manifest);
  runner.start();
  clock.advanceBy(500);
  assert.equal(runner.getSnapshot().status, 'quiz');
  assert.equal(reading.getSnapshot().visibleGraphemes, 2);
  assert.equal(reading.advance(), 'ignored');
  const document = reading.getSnapshot().document;
  const entries = backlog.getSnapshot();
  clock.advanceBy(500);
  assert.equal(reading.getSnapshot().visibleGraphemes, 5);
  assert.equal(reading.getSnapshot().document, document);
  assert.equal(backlog.getSnapshot(), entries);
  const quiz = runner.getSnapshot().quiz!;
  runner.answerQuiz(8, quiz); runner.continueQuiz(quiz);
  assert.equal(runner.getSnapshot().nid, 1);
  assert.equal(reading.advance(), 'revealed');
  assert.equal(reading.advance(), 'advanced');
  assert.equal(runner.getSnapshot().nid, 0);
  assert.equal(backlog.getSnapshot().length, 2);
  reading.dispose(); backlog.dispose(); runner.dispose();
});

test('unresolved engine result requires a guarded debug override and clears on restart', () => {
  const runner = new ScriptRunner({ instantTransitions: true });
  const quiz = quizFixture({ answers: [{ id: 21, textKey: 'answer-yes', correct: null }] });
  runner.load(fixture([node(1, { kind: 'silent', textKey: null, stage: [quizOperation(quiz)] })]), manifest);
  runner.start();
  const opened = runner.getSnapshot().quiz!;
  assert.equal(runner.overrideQuizResult('correct', opened), false);
  assert.equal(runner.answerQuiz(21, opened), true);
  assert.equal(runner.continueQuiz(opened), false);
  assert.equal(runner.overrideQuizResult('incorrect', opened), true);
  assert.equal(runner.overrideQuizResult('correct', opened), false);
  assert.equal(runner.getSnapshot().events.filter(event => event.type === 'quizResultOverridden').length, 1);
  runner.restart();
  assert.equal(runner.getSnapshot().quiz?.selectedAnswerId, null);
  assert.equal(runner.getSnapshot().events.filter(event => event.type === 'quizAnswered').length, 0);
  runner.dispose();
});

test('quiz illustrations resolve only their own directory and require matching validated assets', () => {
  const path = `${solarQuizImageRoot}T_IconSolarSchoolExam2001.webp`;
  assert.equal(ueQuizIllustrationWebpPath(quizImage), path);
  assert.equal(ueReferenceWebpPath(quizImage), null, 'background/CG resolution is unchanged');
  assert.equal(ueQuizIllustrationWebpPath(quizImage.replace('/IconExam/', '/Other/')), null);
  assert.equal(ueQuizIllustrationWebpPath(quizImage.replace('/IconExam/', '/IconExam/../')), null);
  assert.equal(resolveQuizIllustration(emptyVisualAssets, 1, quizImage).url, null);
  const entry = { sourceRef: quizImage, repositoryPath: path, status: 'ready', localPath: `media/${path}`, sha256: 'a'.repeat(64), width: 400, height: 300 };
  const manifest = validateVisualManifest({ backgrounds: {}, cgs: {}, quizzes: { '1': { path: quizImage } } });
  const mapping = validateVisualMap({ schema: 1, source: {}, backgrounds: {}, cgs: {}, quizzes: { '1': { question: entry } } });
  const assets = { ...emptyVisualAssets, manifest, mapping, baseUrl: '/assets/' };
  assert.equal(resolveQuizIllustration(assets, 1, quizImage).url, `/assets/media/${path}`);
  const wrong = { ...assets, mapping: { ...mapping, quizzes: { '1': { question: { ...entry, sourceRef: quizImage.replace('2001', '2002'), status: 'ready' as const } } } } };
  assert.equal(resolveQuizIllustration(wrong, 1, quizImage).url, null);
  assert.throws(() => validateVisualMap({ ...mapping, quizzes: { '1': { question: { ...entry, sha256: '' } } } }), /SHA-256/);
});
