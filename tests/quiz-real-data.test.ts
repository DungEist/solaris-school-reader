import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { QuizDefinition } from '../src/engine/Quiz.ts';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import type { Script, StageOp } from '../src/engine/types.ts';
import type { StageState } from '../src/engine/StageState.ts';
import { prepareScript, validateManifest } from '../src/engine/validation.ts';
import { resolveQuizIllustration } from '../src/assets/AssetResolver.ts';
import { validateVisualManifest, validateVisualMap } from '../src/assets/VisualAssetRepository.ts';
import { FakeClock } from './FakeClock.ts';

const data = new URL('../public/data/', import.meta.url);
const source = new URL('../WutheringWaves_Data/', import.meta.url);
const json = async (root: URL, path: string) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const manifest = validateManifest(await json(data, 'manifest.json'));
const quizzes: QuizDefinition[] = await json(data, 'maps/quizzes.json');
const sequences = {
  '7025': [[1, 7, 'end'], [2, 0, 'start'], [3, 8, 'start']],
  '7028': [[4, 6, 'end'], [5, 0, 'start'], [6, 7, 'start']],
  '7030': [[13, 7, 'end'], [14, 0, 'start']],
  '7033': [[15, 0, 'start'], [16, 9, 'start']],
  '7042': [[7, 46, 'end'], [8, 0, 'start'], [9, 47, 'start']],
  '14200': [[10, 0, 'start'], [11, 6, 'start'], [12, 7, 'start']],
} as const;
const scripts = new Map<string, Script>(await Promise.all(Object.keys(sequences).map(async id => [id, prepareScript(await json(data, `scripts/${id}.json`), manifest).script] as const)));

test('all 16 real quizzes preserve verified question/answer/action rows and their original table order', async () => {
  const questions = await json(source, 'BinData/SolarSchool/solarschoolexamevent.json');
  const answers = await json(source, 'BinData/SolarSchool/solarschoolexamchoice.json');
  const actions = await json(source, 'BinData/ActivityAction/activityaction.json');
  const actionTypes = await json(source, 'BinData/ActivityAction/activityactionclienttype.json');
  const params = await json(source, 'BinData/SolarSchool/solarschoolparam.json');
  const english = await json(data, 'locales/en.json');
  assert.equal(quizzes.length, 16);
  assert.equal(answers.length, 48);
  assert.deepEqual(quizzes.map(q => q.id), questions.map((q: any) => q.Id));
  assert.equal(actionTypes.find((type: any) => type.Id === 8).TypeName, '第二索拉考试选项');
  const resultHold = params.find((param: any) => param.Key === 'ExamResultHoldDuration');
  assert.equal(resultHold.IntValue, 1500);
  assert.match(resultHold.Comments, /ms/);
  for (const quiz of quizzes) {
    const question = questions.find((q: any) => q.Id === quiz.id);
    assert.deepEqual(quiz.raw.question, question);
    assert.equal(quiz.questionKey, question.Desc);
    assert.equal(quiz.titleKey, question.Title);
    assert.equal(quiz.illustration, question.Image);
    assert.equal(quiz.addScore, question.AddScore);
    assert.equal(quiz.resultHoldMs, resultHold.IntValue);
    assert.deepEqual(quiz.raw.action, actions.find((a: any) => a.Id === quiz.actionId));
    const choices = answers.filter((a: any) => a.GroupId === question.ChoiceGroupId);
    assert.deepEqual(quiz.answers.map(answer => answer.raw), choices);
    assert.deepEqual(quiz.answers.map(answer => answer.id), choices.map((a: any) => a.Id));
    assert.deepEqual(quiz.answers.map(answer => answer.correct), choices.map((a: any) => a.IsCorrect));
    assert.equal(quiz.answers.filter(answer => answer.correct === true).length, 1);
    for (const key of [quiz.titleKey, quiz.questionKey, ...quiz.answers.map(answer => answer.textKey)]) assert.ok(key && english[key]?.trim(), `Missing quiz English: ${key}`);
  }
  assert.deepEqual(Object.fromEntries(quizzes.map(q => [q.id, q.answers.find(a => a.correct)!.id])), {
    1: 1, 2: 5, 3: 9, 4: 10, 5: 15, 6: 16, 7: 20, 8: 22,
    9: 26, 10: 29, 11: 31, 12: 34, 13: 38, 14: 40, 15: 43, 16: 46,
  });
});

test('16 raw flowstate quiz performances join to separate models without converting ordinary dialogue choices', async () => {
  const flows = await json(source, 'BinData/flowState/flowstate.json');
  let count = 0;
  for (const [id, script] of scripts) {
    const flow = flows.find((flow: any) => flow.StateKey === script.stateKey);
    assert.ok(flow);
    assert.equal(typeof flow.Actions, 'string');
    const talks = JSON.parse(flow.Actions).flatMap((action: any) => action.Params?.TalkItems ?? []);
    const found: (readonly [number, number, string])[] = [];
    for (const node of script.nodes) for (const operation of node.stage) {
      if (!operation.quiz) continue;
      count++;
      const original = talks.find((talk: any) => talk.Id === node.nid);
      const phase = operation.phase ?? 'start';
      const performances = original[phase === 'start' ? 'StartPerformances' : 'EndPerformances'] ?? [];
      const performance = performances.find((p: any) => p.Type === 'ActivityAction' && p.ActivityActionConfig?.SolarSchoolActionId === operation.actionId);
      assert.deepEqual(operation.raw, performance);
      assert.equal(operation.t, 0);
      assert.equal(node.options?.length ?? 0, 0);
      assert.equal(original.Options?.length ?? 0, 0);
      assert.equal(node.kind === 'silent', phase === 'start');
      found.push([operation.quiz.id, node.nid, phase]);
    }
    assert.deepEqual(found, sequences[id as keyof typeof sequences]);
  }
  assert.equal(count, 16);
});

function withoutQuiz(operation: StageOp): StageOp {
  const { quiz: ignored, ...rest } = operation;
  return rest;
}

function persistentState(state: StageState): unknown {
  // Visit/event identities and clock delivery differ after manual interaction;
  // compare the logical state, with operation order checked separately below.
  return JSON.parse(JSON.stringify(state, (key, value) => ['lastEvent', 'lastSequence', 'event'].includes(key) ? undefined : value));
}

function play(script: Script, grade: boolean, instant: boolean) {
  const clock = new FakeClock();
  const runner = new ScriptRunner({ clock, instantTransitions: instant });
  assert.equal(runner.load(script, manifest), true);
  runner.start();
  let steps = 0;
  while (runner.getSnapshot().status !== 'completed') {
    const state = runner.getSnapshot();
    assert.ok(++steps < 500, `${script.id} stalled at ${state.nid}/${state.status}`);
    assert.notEqual(state.status, 'error', state.error?.message ?? 'unexpected runner error');
    if (state.status === 'quiz') {
      const quiz = state.quiz!;
      const answer = quiz.definition.answers.find(answer => answer.correct === grade)!;
      assert.ok(answer);
      assert.equal(runner.answerQuiz(answer.id, quiz), true);
      for (let i = 0; i < 3; i++) assert.equal(runner.answerQuiz(answer.id, quiz), false);
      assert.equal(runner.getSnapshot().quiz?.result, grade ? 'correct' : 'incorrect');
      assert.equal(runner.getSnapshot().nid, state.nid, 'answering must not navigate');
      assert.equal(runner.getSnapshot().navigationHistory.length, state.navigationHistory.length);
      const answered = runner.getSnapshot();
      clock.advanceBy(1600);
      assert.equal(runner.getSnapshot().nid, answered.nid, 'source result hold is not an answer timer or auto-continue');
      assert.equal(runner.getSnapshot().quiz?.instanceId, quiz.instanceId);
      assert.equal(runner.continueQuiz(quiz), true);
      assert.equal(runner.continueQuiz(quiz), false);
    } else if (state.status === 'dialogue') assert.equal(runner.advance(state), true);
    // The grading/timing fixture exhausts script edges through the explicit
    // Developer API; it does not invent management state for a scene jump.
    else if (state.status === 'choices') assert.equal(runner.overrideChoice(0, state), true);
    else {
      assert.ok(['ending', 'running'].includes(state.status) && state.pendingStage.length > 0, `Unexpected ${script.id} status ${state.status}`);
      clock.advanceBy(Math.max(0, Math.min(...state.pendingStage.map(task => task.dueAtMs)) - clock.now()));
    }
  }
  const result = runner.getSnapshot(); runner.dispose();
  return result;
}

test('all six real scripts complete correct and incorrect routes in timed/instant mode without duplicated answers or changed navigation', () => {
  for (const [id, script] of scripts) {
    const baseline = play({ ...script, nodes: script.nodes.map(node => ({ ...node, stage: node.stage.map(withoutQuiz) })) }, true, true);
    for (const instant of [false, true]) for (const correct of [false, true]) {
      const result = play(script, correct, instant);
      const opened = result.events.filter(event => event.type === 'quizOpened');
      const answered = result.events.filter(event => event.type === 'quizAnswered');
      const continued = result.events.filter(event => event.type === 'quizContinued');
      assert.deepEqual(opened.map(event => [event.quiz.definition.id, event.nid, event.quiz.continuation.phase]), sequences[id as keyof typeof sequences]);
      assert.equal(answered.length, opened.length);
      assert.equal(continued.length, opened.length);
      assert.equal(new Set(opened.map(event => `${event.runId}:${event.quiz.visitId}:${event.quiz.instanceId}`)).size, opened.length);
      assert.deepEqual(result.navigationHistory, baseline.navigationHistory);
      assert.deepEqual(result.choiceHistory, baseline.choiceHistory);
      assert.deepEqual(result.stageEvents.map(event => [event.phase, withoutQuiz(event.operation)]), baseline.stageEvents.map(event => [event.phase, event.operation]));
      assert.deepEqual(persistentState(result.stageState), persistentState(baseline.stageState));
      assert.equal(result.stageState.appliedEvents, result.stageEvents.length);
      assert.equal(result.events.filter(event => event.type === 'completed').length, 1);
      assert.equal(result.quiz, null);
    }
  }
});

test('real quiz illustration cache resolves all 16 references across six files without blocking missing assets', async () => {
  const manifest = validateVisualManifest(await json(data, 'assets.manifest.json'));
  const mapping = validateVisualMap(await json(new URL('../public/assets/solarschool/', import.meta.url), 'asset-map.json'));
  const assets = { manifest, mapping, baseUrl: '/assets/solarschool/', issues: [] };
  const urls = new Set<string>();
  for (const quiz of quizzes) {
    const illustration = resolveQuizIllustration(assets, quiz.id, quiz.illustration);
    assert.ok(illustration.url, `${quiz.id}: ${illustration.reason}`);
    urls.add(illustration.url);
    assert.equal(resolveQuizIllustration({ ...assets, mapping: null }, quiz.id, quiz.illustration).url, null);
  }
  assert.equal(urls.size, 6);
});
