import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import { StoryPlaythrough } from '../src/engine/Playthrough.ts';
import type { EnglishCatalog } from '../src/data/EnglishScriptRepository.ts';
import { validateStorySource } from '../src/engine/StoryState.ts';
import { sourceList } from '../src/engine/StoryState.ts';

const read = (path: string) => JSON.parse(readFileSync(new URL(`../public/data/${path}`, import.meta.url), 'utf8'));
export const realSource = validateStorySource(read('maps/story-source.json'));
export const realCatalog: EnglishCatalog = Object.freeze({ manifest: read('manifest.json'), english: read('locales/en.json'), speakers: read('speakers.json'), index: read('scripts.index.json'), report: read('build-report.json'), storySource: realSource });
const scripts = new Map<string, unknown>();
export const realScript = (id: string) => { if (!scripts.has(id)) scripts.set(id, read(`scripts/${id}.json`)); return scripts.get(id)!; };
export interface PlaythroughPolicy { readonly choices?: Readonly<Record<string, number>>; readonly option?: string; readonly behavior?: number; readonly accept?: number; readonly visit?: boolean; }

export function playthroughHarness(seed = 1) {
  const runner = new ScriptRunner({ instantTransitions: true });
  const journey = new StoryPlaythrough(runner, async id => realScript(id));
  const visited = new Set<string>();
  const choices: { script: string; node: number; option: number | null }[] = [];
  const steps: string[] = [];
  runner.onEvent(event => { if (event.type === 'checkpointRestored') visited.clear(); });
  async function step(policy: PlaythroughPolicy = {}) {
    await journey.flush();
    const state = runner.getSnapshot(), progress = journey.getSnapshot();
    assert.notEqual(progress.phase, 'blocked', JSON.stringify({ script: state.scriptId, node: state.nid, diagnostics: progress.diagnostics.slice(-4) }));
    if (policy.option && progress.options.some(option => option.id === policy.option && option.condition.value === 'true')) {
      steps.push(`day${progress.dayIndex}/slot${progress.timeSlot}/${policy.option}`);
      assert.equal(await journey.select(policy.option), true); return;
    }
    if (progress.interaction) {
      const type = progress.interaction.kind;
      if (type === 'event' || type === 'ending' || progress.interaction.requiresChoice) {
        const option = progress.options.find(option => option.condition.value === 'true');
        assert.ok(option, `No available ${type} option`); assert.equal(await journey.select(option.id), true); return;
      }
      if (type === 'request' && progress.interaction.sourceId === policy.accept) {
        const option = progress.options.find(option => option.condition.value === 'true');
        if (option) { assert.equal(await journey.select(option.id), true); return; }
      }
      await journey.dismissInteraction(); return;
    }
    if (progress.phase === 'planning') {
      const explore = progress.options.find(o => o.kind === 'explore' && o.condition.value === 'true');
      if (explore) { steps.push(`day${progress.dayIndex}/${explore.id}`); assert.equal(await journey.select(explore.id), true); return; }
      const request = progress.options.find(o => o.kind === 'request' && o.sourceId === policy.accept && o.condition.value === 'true');
      if (request) { assert.equal(await journey.select(request.id), true); return; }
      const reward = progress.options.find(o => o.kind === 'reward' && o.condition.value === 'true');
      if (reward) { assert.equal(await journey.select(reward.id), true); return; }
      const location = progress.options.find(o => o.kind === 'location' && o.condition.value === 'true'
        && !visited.has(`${progress.dayIndex}:${progress.timeSlot}:${o.sourceId}`)
        && (policy.visit !== false || progress.instanceId !== 1));
      if (location) {
        steps.push(`day${progress.dayIndex}/slot${progress.timeSlot}/${location.id}`);
        assert.equal(await journey.select(location.id), true);
        const row = realSource.locations?.[String(location.sourceId)];
        const finished = progress.instanceId !== 1
          ? !row?.IsSeparate || policy.visit === false || (location.progress ?? 0) + 1 >= (sourceList(row?.ActionIdList) ?? []).length
          : journey.getSnapshot().sceneCount === progress.sceneCount;
        if (finished) visited.add(`${progress.dayIndex}:${progress.timeSlot}:${location.sourceId}`);
        return;
      }
      const locationOption = progress.options.find(o => o.kind === 'locationOption' && o.condition.value === 'true'
        && !visited.has(`${progress.dayIndex}:${progress.timeSlot}:option:${o.sourceId}`));
      if (locationOption) { visited.add(`${progress.dayIndex}:${progress.timeSlot}:option:${locationOption.sourceId}`); steps.push(`day${progress.dayIndex}/slot${progress.timeSlot}/${locationOption.id}`); assert.equal(await journey.select(locationOption.id), true); return; }
      const behavior = progress.options.find(o => o.kind === 'behavior' && o.condition.value === 'true' && o.sourceId === policy.behavior);
      if (behavior) { steps.push(`day${progress.dayIndex}/slot${progress.timeSlot}/${behavior.id}`); assert.equal(await journey.select(behavior.id), true); return; }
      assert.equal(await journey.continue(), true); return;
    }
    if (state.status === 'quiz' && state.quiz) {
      if (state.quiz.phase === 'question') {
        const answer = state.quiz.definition.answers.find(o => o.correct === true) ?? state.quiz.definition.answers[0];
        assert.ok(answer); assert.equal(runner.answerQuiz(answer.id, state.quiz), true);
      } else assert.equal(runner.continueQuiz(state.quiz), true);
      return;
    }
    if (state.status === 'choices' && !state.hiddenChoice) {
      const preferred = policy.choices?.[`${state.scriptId}/${state.nid}`];
      const index = preferred === undefined ? state.choiceConditions.findIndex(c => c.value === 'true') : state.choices.findIndex(o => o.optionId === preferred);
      assert.ok(index >= 0, `No eligible response at ${state.scriptId}/${state.nid}`);
      choices.push({ script: state.scriptId!, node: state.nid!, option: state.choices[index].optionId });
      assert.equal(runner.choose(index, state), true, `${state.scriptId}/${state.nid}/${state.choices[index].optionId}`); return;
    }
    assert.ok(['dialogue', 'choices'].includes(state.status), `Unexpected ${state.status}, ${progress.phase} at ${state.scriptId}/${state.nid}`);
    assert.equal(runner.advance(state), true, `Cannot advance ${state.scriptId}/${state.nid}: ${JSON.stringify(state.branchResolution)}`);
  }
  async function until(predicate: () => boolean, policy: PlaythroughPolicy | (() => PlaythroughPolicy) = {}, max = 60000) {
    for (let count = 0; count < max; count++) { await journey.flush(); if (predicate()) return count; await step(typeof policy === 'function' ? policy() : policy); }
    assert.fail(`Playthrough exceeded ${max} inputs at ${runner.getSnapshot().scriptId}/${runner.getSnapshot().nid}, day ${runner.getSnapshot().storyState.dayIndex}`);
  }
  return { runner, journey, choices, steps,
    start: () => { visited.clear(); return journey.start(realCatalog, seed); },
    startNextCycle: () => { visited.clear(); return journey.startNextCycle(); },
    step, until, dispose: () => { journey.dispose(); runner.dispose(); } };
}
