import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import { prepareScript, validateBuildReport, validateIndex, validateManifest } from '../src/engine/validation.ts';
import type { PreparedScript } from '../src/engine/validation.ts';
import type { Navigation, Script } from '../src/engine/types.ts';

const dataRoot = new URL('../public/data/', import.meta.url);
async function readJson<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await readFile(new URL(path, dataRoot), 'utf8')) as T;
  } catch (error) {
    throw new Error(`Real data required at public/data/${path}. Run python3 build_data.py WutheringWaves_Data public/data --locales en. ${String(error)}`);
  }
}

const manifest = validateManifest(await readJson('manifest.json'));
const index = validateIndex(await readJson('scripts.index.json'));
const scripts = await Promise.all(index.map(entry => readJson<Script>(`scripts/${entry.id}.json`)));
const byId = new Map(scripts.map(script => [script.id, script]));

test('all 11 real HideAndAutoSelect nodes preserve conditions, raw option performances and intentionally empty English keys', async () => {
  const hidden = scripts.flatMap(script => script.nodes.filter(node => node.raw?.OptionInteractionType === 'HideAndAutoSelect').map(node => ({ script, node })));
  assert.deepEqual(hidden.map(({ script, node }) => `${script.id}/${node.nid}`).sort(), ['1004/1', '1008/21', '1008/53', '1009/5', '1010/25', '1010/5', '1011/29', '1014/16', '1014/26', '1034/43', '3010/35'].sort());
  const english = await readJson<Record<string, string>>('locales/en.json');
  let explicitEmpty = 0, absent = 0;
  for (const { script, node: source } of hidden) {
    assert.equal(source.options?.length, 2);
    for (const choice of source.options!) {
      assert.deepEqual(choice.preCondition, choice.raw?.PreCondition);
      assert.deepEqual(choice.typeParams, choice.raw?.TypeParams);
      const rawPerformances = choice.typeParams?.OptionPerformances as { StartTime?: number }[];
      assert.equal(choice.performances?.length, rawPerformances.length);
      choice.performances!.forEach((operation, index) => {
        assert.equal(operation.phase, 'option');
        assert.equal(operation.t, rawPerformances[index].StartTime ?? 0);
        assert.deepEqual(operation.raw, rawPerformances[index]);
      });
      if (Object.hasOwn(english, choice.textKey!)) { assert.equal(english[choice.textKey!], ''); explicitEmpty++; }
      else absent++;
    }
    assert.equal((source.options![0].preCondition as any).Type, 'SystemCondition');
    assert.equal(source.options![1].preCondition, undefined);
    // Isolate the actual options for a deterministic selection-policy test.
    const runner = new ScriptRunner({ instantTransitions: true });
    runner.load({ ...script, nodes: [{ ...source, next: { type: 'end' } }], flowActions: [{ op: 'talk', nids: [source.nid] }] }, manifest);
    runner.start();
    assert.equal(runner.getSnapshot().hiddenChoice, true);
    assert.equal(runner.getSnapshot().choiceHistory.length, 0);
    assert.equal(runner.choose(0), false);
    assert.equal(runner.choose(1), false);
    assert.equal(runner.overrideHiddenChoice(1), true);
    assert.equal(runner.getSnapshot().choiceHistory[0].debugOverride, true);
    runner.dispose();
  }
  assert.equal(explicitEmpty, 18);
  assert.equal(absent, 4);
  assert.equal(english.Flow_318000000_3450, '');
  assert.equal(english.Flow_318000000_3451, '');
  const report: any = await readJson('build-report.json');
  assert.equal(report.hideAndAutoSelectNodes.length, 11);
  assert.equal(report.optionPerformanceCount, 74);
  assert.equal(report.missingTextKeys.en, 35);
});

function start(id: string): ScriptRunner {
  const runner = new ScriptRunner({ instantTransitions: true });
  assert.equal(runner.load(byId.get(id), manifest), true, runner.getSnapshot().error?.message ?? `script ${id} failed to load`);
  assert.equal(runner.start(), true);
  return runner;
}

test('real branch 3.8 generated data passes the schema 2 build gates', async () => {
  const report: any = validateBuildReport(await readJson('build-report.json'));
  assert.equal(manifest.schema, 2);
  assert.deepEqual(manifest.locales, ['en']);
  assert.equal(manifest.source.gameVersion, '3.8.0');
  assert.equal(report.scripts, 429);
  assert.equal(report.nodes, 8493);
  assert.equal(index.length, 429);
  assert.equal(scripts.reduce((count, script) => count + script.nodes.length, 0), 8493);
  assert.equal(report.validation.danglingJumpCount, 0);
  assert.equal(report.validation.flowRegistryResolved, '426/426');
  assert.equal(report.validation.nodesWithoutTextKeyCount, 0);
  assert.deepEqual(report.validation.endingsWithBadFlow, []);
  assert.deepEqual(report.unknownStageOps, {});
  assert.deepEqual(report.conditions.missing, []);
  assert.deepEqual(report.optionControlConflicts, []);
  assert.deepEqual(report.optionNextKinds, { jump: 318, seq: 100, end: 1 });
  assert.deepEqual(index.filter(entry => !entry.registered).map(entry => entry.id), ['x1', 'x2', 'x3']);
});

test('real 17048 nid 2 optionId 5 ends ShowTalk without displaying nid 3', () => {
  const runner = start('17048');
  runner.advance();
  assert.equal(runner.getSnapshot().nid, 2);
  const choice = runner.getSnapshot().choices.findIndex(option => option.optionId === 5);
  assert.equal(choice, 3);
  assert.deepEqual(runner.getSnapshot().choices[choice].next, { type: 'end' });
  runner.choose(choice);
  const result = runner.getSnapshot();
  assert.equal(result.status, 'completed');
  assert.equal(result.choiceHistory[0].optionId, 5);
  assert.equal(result.choiceHistory.length, 1);
  assert.deepEqual(result.events.filter(event => event.type === 'dialogue').map(event => event.node.nid), [1, 2]);
  assert.equal(result.navigationHistory.some(entry => entry.to === 3), false);
});

test('real 17048 branches by nid and real 1004 sequential choices continue', () => {
  const branch = start('17048');
  branch.advance();
  // This direct scene fixture checks the authored JumpTalk edge; the source
  // prerequisite is intentionally crossed using the explicit Developer API.
  branch.overrideChoice(branch.getSnapshot().choices.findIndex(option => option.optionId === 3));
  assert.equal(branch.getSnapshot().nid, 6);
  const sequence = start('1004');
  assert.equal(sequence.getSnapshot().nid, 1);
  assert.equal(sequence.getSnapshot().status, 'choices');
  assert.deepEqual(sequence.getSnapshot().choices[0].next, { type: 'seq' });
  assert.equal(sequence.getSnapshot().hiddenChoice, true);
  assert.equal(sequence.choose(0), false);
  assert.equal(sequence.overrideHiddenChoice(0), true);
  assert.equal(sequence.getSnapshot().nid, 2);
});

test('real movie-only 1053 dispatches configure, skips its movie/audio, and finishes normally', () => {
  const runner = start('1053');
  const state = runner.getSnapshot();
  assert.equal(state.status, 'completed');
  assert.equal(state.flowActionIndex, 2);
  assert.deepEqual(state.events.filter(event => event.type === 'flow').map(event => event.action.op), ['configure', 'movie']);
  const movie = state.events.find(event => event.type === 'movieSkipped');
  assert.ok(movie && movie.type === 'movieSkipped');
  assert.equal(movie.videoName, 'VideoSolarSchoolOP01');
  assert.deepEqual(movie.suppressedAudio, ['play_avg_music_3_8_video_p01']);
  assert.equal(state.stageEvents.some(event => event.operation.cue === 'play_avg_music_3_8_video_p01'), false);
  assert.equal(state.events.filter(event => event.type === 'completed').length, 1);
});

function advanceTo(runner: ScriptRunner, nid: number): void {
  for (let i = 0; i < 200 && runner.getSnapshot().nid !== nid; i++) {
    const snapshot = runner.getSnapshot();
    assert.ok(['dialogue', 'choices'].includes(snapshot.status), `Cannot reach real nid ${nid}: ${snapshot.status}`);
    // Structural stage traversal after a scene jump does not claim eligibility.
    if (snapshot.status === 'choices') runner.overrideChoice(0);
    else runner.advance();
  }
  assert.equal(runner.getSnapshot().nid, nid);
}

test('real 6012 changes backgrounds and retains its CG until the source Clean at nid 26', () => {
  const runner = start('6012');
  assert.equal(runner.getSnapshot().stageState.background?.id, 700004);
  for (const [nid, background] of [[2, 700020], [3, 700020], [4, 700010], [6, 700004]]) {
    advanceTo(runner, nid);
    assert.equal(runner.getSnapshot().stageState.background?.id, background);
  }
  advanceTo(runner, 10);
  assert.equal(runner.getSnapshot().stageState.cg?.id, 700047);
  const cg = runner.getSnapshot().stageState.cg;
  advanceTo(runner, 25);
  assert.equal(runner.getSnapshot().stageState.cg, cg);
  advanceTo(runner, 26);
  assert.equal(runner.getSnapshot().stageState.cg, null);
});

test('real 1002 CG LoadImage at nid 5 persists until Clean at nid 12; restart restores initial stage', () => {
  const runner = start('1002');
  advanceTo(runner, 5);
  const loaded = runner.getSnapshot().stageState;
  assert.equal(loaded.cg?.kind, 'image'); assert.equal(loaded.cg?.id, 700012);
  advanceTo(runner, 11);
  assert.equal(runner.getSnapshot().stageState.cg, loaded.cg);
  advanceTo(runner, 12);
  assert.equal(runner.getSnapshot().stageState.cg, null);
  runner.restart();
  assert.equal(runner.getSnapshot().stageState.cg, null);
  assert.equal(runner.getSnapshot().stageState.background?.id, 700016);
});

test('real 17048 branching route loads and clears CG 700002 while the FinishTalk regression stays intact', () => {
  const runner = start('17048');
  runner.advance();
  // Isolate CG stage operations through the conditioned source edge.
  runner.overrideChoice(runner.getSnapshot().choices.findIndex(option => option.optionId === 3));
  advanceTo(runner, 7);
  assert.equal(runner.getSnapshot().stageState.cg?.id, 700002);
  advanceTo(runner, 8);
  assert.equal(runner.getSnapshot().stageState.cg, null);
  runner.advance();
  assert.equal(runner.getSnapshot().status, 'completed');
  assert.ok(!runner.getSnapshot().events.some(event => event.type === 'dialogue' && event.node.nid === 3));
});

/** Build graph paths from neutral block nids. Rejoins share paths, and choices
 * that loop back are tested with a finite exit suffix instead of autoplaying. */
type Edge = { to: string; optionIndex?: number };
const terminal = 'completed';

function graphOf(prepared: PreparedScript) {
  const graph = new Map<string, Edge[]>();
  const choiceNodes = new Set<string>();
  const key = (flow: number, nid: number) => `${flow}:${nid}`;
  const after = (flow: number): string => {
    for (let i = flow + 1; i < prepared.script.flowActions.length; i++) {
      const block = prepared.blocks.get(i);
      if (block?.firstNid != null) return key(i, block.firstNid);
    }
    return terminal;
  };
  for (const block of prepared.blocks.values()) {
    for (const node of block.nodes.values()) {
      const destination = (next: Navigation) => {
        if (next.type === 'end') return after(block.flowActionIndex);
        const nid = next.type === 'jump' ? next.to : block.successors.get(node.nid);
        return nid == null ? after(block.flowActionIndex) : key(block.flowActionIndex, nid);
      };
      const source = key(block.flowActionIndex, node.nid);
      if (node.options?.length) {
        choiceNodes.add(source);
        graph.set(source, node.options.map((option, optionIndex) => ({ to: destination(option.next), optionIndex })));
      } else graph.set(source, [{ to: destination(node.next) }]);
    }
  }
  const beginning = after(-1);
  const paths = new Map<string, number[]>([[beginning, []]]);
  const queue = [beginning];
  for (let i = 0; i < queue.length; i++) {
    const source = queue[i];
    for (const edge of graph.get(source) ?? []) {
      if (!paths.has(edge.to)) {
        paths.set(edge.to, [...paths.get(source)!, ...(edge.optionIndex == null ? [] : [edge.optionIndex])]);
        queue.push(edge.to);
      }
    }
  }
  const reverse = new Map<string, string[]>();
  for (const [source, edges] of graph) for (const edge of edges) reverse.set(edge.to, [...(reverse.get(edge.to) ?? []), source]);
  const distances = new Map<string, number>([[terminal, 0]]);
  const ends = [terminal];
  for (let i = 0; i < ends.length; i++) for (const parent of reverse.get(ends[i]) ?? []) {
    if (!distances.has(parent)) {
      distances.set(parent, distances.get(ends[i])! + 1);
      ends.push(parent);
    }
  }
  const suffix = (source: string): number[] => {
    const choices: number[] = [];
    while (source !== terminal) {
      const distance = distances.get(source);
      assert.ok(distance !== undefined, `Script ${prepared.script.id}, ${source} cannot reach completion`);
      const edge = graph.get(source)?.find(edge => (distances.get(edge.to) ?? Infinity) < distance);
      assert.ok(edge, `Script ${prepared.script.id}, ${source} has no finite exit`);
      if (edge.optionIndex !== undefined) choices.push(edge.optionIndex);
      source = edge.to;
    }
    return choices;
  };
  return { graph, choiceNodes, beginning, paths, suffix };
}

test('headless playback covers all reachable nodes and every reachable choice edge in all 429 real scripts', t => {
  let scenarios = 0;
  let totalChoices = 0;
  let totalNodes = 0;
  for (const script of scripts) {
    const prepared = prepareScript(script, manifest);
    assert.equal(prepared.diagnostics.length, 0, `Script ${script.id} has invalid targets`);
    const { graph, choiceNodes, beginning, paths, suffix } = graphOf(prepared);
    const routes: number[][] = [suffix(beginning)];
    const expectedEdges = new Set<string>();
    const expectedNodes = new Set([...paths.keys()].filter(key => key !== terminal));
    for (const source of choiceNodes) {
      if (!paths.has(source)) continue;
      for (const edge of graph.get(source)!) {
        expectedEdges.add(`${source}:${edge.optionIndex}`);
        routes.push([...paths.get(source)!, edge.optionIndex!, ...suffix(edge.to)]);
      }
    }
    const coveredEdges = new Set<string>();
    const coveredNodes = new Set<string>();
    for (const route of routes) {
      const runner = new ScriptRunner({ instantTransitions: true });
      assert.equal(runner.load(script, manifest), true, runner.getSnapshot().error?.message ?? `script ${script.id} failed to load`);
      runner.start();
      let cursor = 0;
      let steps = 0;
      while (runner.getSnapshot().status !== 'completed') {
        const state = runner.getSnapshot();
        assert.notEqual(state.status, 'error', state.error?.message ?? 'unexpected runner error');
        assert.ok(++steps < 5000, `Script ${script.id} route ${route} did not finish`);
        if (state.status === 'choices') {
          assert.ok(cursor < route.length, `Script ${script.id} requested an unexpected choice at nid ${state.nid}`);
          const optionIndex = route[cursor++];
          // Exhaust all authored edges as explicit Developer traversals. Normal
          // route availability uses accumulated state in the playthrough tests.
          assert.equal(runner.overrideChoice(optionIndex), true);
        } else if (state.status === 'quiz') {
          assert.ok(state.quiz);
          assert.equal(runner.answerQuiz(state.quiz.definition.answers[0].id, state.quiz), true);
          assert.equal(runner.continueQuiz(state.quiz), true);
        } else {
          assert.equal(state.status, 'dialogue', `Script ${script.id} stalled in ${state.status}`);
          runner.advance();
        }
      }
      const state = runner.getSnapshot();
      assert.equal(cursor, route.length, `Script ${script.id} left route choices unused`);
      assert.equal(state.events.filter(event => event.type === 'completed').length, 1);
      assert.equal(state.events.filter(event => event.type === 'flow').length, script.flowActions.length);
      assert.equal(state.stageState.appliedEvents, state.stageEvents.length, `Script ${script.id} replayed or lost stage operations`);
      assert.equal(state.stageState.runId, state.runId);
      for (const entry of state.choiceHistory) coveredEdges.add(`${entry.flowActionIndex}:${entry.nid}:${entry.optionIndex}`);
      for (const entry of state.navigationHistory) if (entry.to !== null) coveredNodes.add(`${entry.flowActionIndex}:${entry.to}`);
      scenarios++;
    }
    assert.deepEqual(coveredEdges, expectedEdges, `Script ${script.id} choice coverage`);
    assert.deepEqual(coveredNodes, expectedNodes, `Script ${script.id} reachable node coverage`);
    totalChoices += coveredEdges.size;
    totalNodes += coveredNodes.size;
  }
  t.diagnostic(`${scripts.length} scripts, ${scenarios} completed playthroughs, ${totalNodes} reachable nodes and ${totalChoices} choice edges covered (including user-driven loops in 16001).`);
});
