import assert from 'node:assert/strict';
import test from 'node:test';
import { ScriptRunner } from '../src/engine/ScriptRunner.ts';
import type { Script } from '../src/engine/types.ts';
import { fixture, manifest, node, option } from './fixtures.ts';

function play(script: Script, options: { maxAutomaticSteps?: number } = {}): ScriptRunner {
  const runner = new ScriptRunner({ ...options, instantTransitions: true });
  assert.equal(runner.load(script, manifest), true, runner.getSnapshot().error?.message ?? 'fixture failed to load');
  runner.start();
  return runner;
}

function displayed(runner: ScriptRunner): number[] {
  return runner.getSnapshot().events.filter(event => event.type === 'dialogue').map(event => event.node.nid);
}

test('sequential navigation follows the talk nids, independently of the nodes array order', () => {
  const runner = play(fixture([node(7), node(42), node(91)], [{ op: 'talk', nids: [91, 7, 42] }]));
  assert.equal(runner.getSnapshot().nid, 91);
  runner.advance();
  assert.equal(runner.getSnapshot().nid, 7);
  runner.advance();
  assert.equal(runner.getSnapshot().nid, 42);
  runner.advance();
  assert.equal(runner.getSnapshot().status, 'completed');
  assert.deepEqual(displayed(runner), [91, 7, 42]);
  assert.deepEqual(runner.getSnapshot().navigationHistory.map(entry => entry.to), [91, 7, 42, null]);
});

test('jump navigation resolves the destination by nid and skips intervening nodes', () => {
  const runner = play(fixture([node(101, { next: { type: 'jump', to: 900 } }), node(55), node(900, { next: { type: 'end' } })]));
  runner.advance();
  assert.equal(runner.getSnapshot().nid, 900);
  runner.advance();
  assert.deepEqual(displayed(runner), [101, 900]);
  assert.equal(runner.getSnapshot().navigationHistory[1].reason, 'jump');
  assert.equal(runner.getSnapshot().status, 'completed');
});

test('choices without navigation actions follow option.next=seq and ignore legacy to and node.next', () => {
  const runner = play(fixture([
    node(2, { next: { type: 'end' }, options: [option({ to: 999 })] }),
    node(80, { next: { type: 'end' } }),
  ]));
  assert.equal(runner.getSnapshot().status, 'choices');
  assert.equal(runner.advance(), false);
  assert.equal(runner.getSnapshot().choiceHistory.length, 0);
  assert.equal(runner.choose(0), true);
  assert.equal(runner.getSnapshot().nid, 80);
  assert.equal(runner.getSnapshot().choiceHistory.length, 1);
  runner.advance();
  assert.equal(runner.choose(0), false);
  assert.equal(runner.getSnapshot().choiceHistory.length, 1);
});

test('FinishTalk ends only its talk block, then ordered configuration and later talks continue', () => {
  const script = fixture([
    node(10, { options: [option({ next: { type: 'end' } })] }), node(20), node(90), node(91, { next: { type: 'end' } }),
  ], [
    { op: 'configure', config: { initialBackground: 1 } },
    { op: 'talk', nids: [10, 20] },
    { op: 'configure', config: { initialBackground: 2 } },
    { op: 'talk', nids: [90, 91] },
  ]);
  const runner = play({ ...script, config: { initialBackground: 999 } });
  runner.choose(0);
  assert.equal(runner.getSnapshot().nid, 90);
  assert.equal(runner.getSnapshot().flowActionIndex, 3);
  assert.equal(runner.getSnapshot().status, 'dialogue');
  assert.deepEqual(runner.getSnapshot().events.filter(event => event.type === 'flow').map(event => event.flowActionIndex), [0, 1, 2, 3]);
  assert.deepEqual(runner.getSnapshot().stageEvents.map(event => event.operation.id), [1, 2]);
  assert.equal(runner.getSnapshot().events.some(event => event.type === 'completed'), false);
  runner.advance();
  runner.advance();
  assert.deepEqual(displayed(runner), [10, 90, 91]);
  assert.equal(runner.getSnapshot().events.filter(event => event.type === 'completed').length, 1);
  assert.equal(runner.getSnapshot().flowActionIndex, 4);
});

test('empty talk blocks and an empty script dispatch to completion normally', () => {
  for (const actions of [[], [{ op: 'talk', nids: [] }, { op: 'configure', config: {} }, { op: 'talk', nids: [] }]] as const) {
    const runner = play(fixture([], actions));
    assert.equal(runner.getSnapshot().status, 'completed');
    assert.equal(runner.getSnapshot().events.filter(event => event.type === 'completed').length, 1);
  }
});

test('movie-only scripts skip media and all associated audio before completing later flow actions', () => {
  const raw = { Name: 'PlayMovie', Params: { Mp4FrameEvents: [{ Second: 0, EventActions: [{ Name: 'PostAkEvent', Params: { AkEvent: '/Game/Aki/WwiseAudio/Events/movie_cue.movie_cue' } }] }] } };
  const runner = play(fixture([], [
    { op: 'configure', config: { initialAudio: ['movie_cue', 'normal_cue'] } },
    { op: 'movie', videoName: 'fixture-movie', raw },
    { op: 'unsupported', raw: { Name: 'AfterMovie', Params: { keep: 'metadata' } } },
  ]));
  assert.equal(runner.getSnapshot().status, 'completed');
  assert.deepEqual(runner.getSnapshot().events.filter(event => event.type === 'movieSkipped').map(event => event.suppressedAudio), [['movie_cue']]);
  assert.deepEqual(runner.getSnapshot().stageEvents.map(event => event.operation.cue), ['normal_cue']);
  assert.equal(runner.getSnapshot().events.some(event => event.type === 'debug' && event.code === 'unsupported-flow-action'), true);
  runner.start();
  runner.advance();
  assert.equal(runner.getSnapshot().events.filter(event => event.type === 'completed').length, 1);
});

test('start/end stages occur once per visit, at entry and chosen exit, with timing intact', () => {
  const runner = play(fixture([node(10, {
    stage: [
      { op: 'move', t: 2, dur: 0.75, pos: [1, 2, 3] },
      { op: 'enter', t: 0, fadeIn: 0.4 },
      { op: 'modify', t: 0.25, phase: 'start', expr: 7 },
      { op: 'exit', t: 1.5, phase: 'end', fadeOut: 0.8 },
    ],
    options: [option({ next: { type: 'end' } })],
  })]));
  const before = runner.getSnapshot();
  assert.deepEqual(before.stageEvents.map(event => [event.phase, event.operation.op, event.operation.t]), [['start', 'enter', 0], ['start', 'modify', 0.25], ['start', 'move', 2]]);
  assert.equal(before.stageEvents[2].operation.dur, 0.75);
  for (let i = 0; i < 20; i++) {
    const unsubscribe = runner.subscribe(() => runner.getSnapshot());
    runner.getSnapshot();
    unsubscribe();
  }
  runner.advance(); // A choice is still pending, so the node is not left.
  assert.equal(runner.getSnapshot().stageEvents.length, 3);
  runner.choose(0);
  const after = runner.getSnapshot();
  assert.equal(before.stageEvents.length, 3);
  assert.equal(after.stageEvents.length, 4);
  assert.equal(after.stageEvents[3].phase, 'end');
  assert.equal(after.stageEvents[3].operation.fadeOut, 0.8);
  const choice = after.events.find(event => event.type === 'choiceSelected')!;
  const end = after.stageEvents[3];
  const finish = after.events.find(event => event.type === 'talkComplete')!;
  assert.ok(choice.sequence < end.sequence && end.sequence < finish.sequence);
  assert.equal(new Set(after.stageEvents.map(event => event.visitId)).size, 1);
});

test('restarting cancels the old visit and resets navigation and choice history', () => {
  const runner = play(fixture([node(9, { stage: [{ op: 'enter', t: 0 }, { op: 'exit', t: 0, phase: 'end' }], options: [option({ optionId: 15, next: { type: 'end' } })] })]));
  const original = runner.getSnapshot();
  runner.restart();
  assert.equal(runner.getSnapshot().runId, original.runId + 1);
  assert.equal(runner.getSnapshot().stageEvents.length, 1);
  assert.equal(runner.getSnapshot().stageEvents[0].phase, 'start');
  runner.choose(0);
  assert.equal(runner.getSnapshot().choiceHistory.length, 1);
  runner.restart();
  assert.equal(runner.getSnapshot().choiceHistory.length, 0);
  assert.equal(runner.getSnapshot().navigationHistory.length, 1);
  assert.equal(original.status, 'choices');
  assert.equal(original.stageEvents.length, 1);
});

test('silent automatic loops fail contextually before repeating stage operations', () => {
  const runner = play(fixture([node(41, { kind: 'silent', textKey: null, next: { type: 'jump', to: 41 }, stage: [{ op: 'enter', t: 0 }, { op: 'exit', t: 0, phase: 'end' }] })]));
  const state = runner.getSnapshot();
  assert.equal(state.status, 'error');
  assert.equal(state.error?.code, 'AUTOMATIC_LOOP');
  assert.equal(state.error?.scriptId, 'fixture');
  assert.equal(state.error?.flowActionIndex, 1);
  assert.equal(state.error?.nid, 41);
  assert.equal(state.stageEvents.length, 2);
});

test('an automatic step budget stops very long automatic chains', () => {
  const runner = play(fixture([node(1, { kind: 'silent', textKey: null }), node(2, { kind: 'silent', textKey: null }), node(3)]), { maxAutomaticSteps: 2 });
  assert.equal(runner.getSnapshot().error?.code, 'AUTOMATIC_LOOP');
});

test('loops separated by user input are allowed and have separate stage visits', () => {
  const runner = play(fixture([node(9, { next: { type: 'jump', to: 9 }, stage: [{ op: 'enter', t: 0 }, { op: 'exit', t: 0, phase: 'end' }] })]));
  for (let i = 0; i < 3; i++) runner.advance();
  assert.equal(runner.getSnapshot().status, 'dialogue');
  assert.equal(runner.getSnapshot().stageEvents.filter(event => event.phase === 'start').length, 4);
  assert.equal(runner.getSnapshot().stageEvents.filter(event => event.phase === 'end').length, 3);
});

test('missing targets are detected on load and fall back sequentially inside the block', () => {
  const runner = play(fixture([node(10, { next: { type: 'jump', to: 999 } }), node(20, { next: { type: 'end' } })]));
  const diagnostic = runner.getSnapshot().diagnostics[0];
  assert.equal(diagnostic.code, 'INVALID_TARGET');
  assert.equal(diagnostic.fatal, false);
  assert.equal(diagnostic.nid, 10);
  assert.equal(diagnostic.flowActionIndex, 1);
  runner.advance();
  assert.equal(runner.getSnapshot().nid, 20);
  assert.equal(runner.getSnapshot().navigationHistory[1].reason, 'invalid-target');
  runner.advance();
  assert.equal(runner.getSnapshot().status, 'completed');
});

test('cross-block targets fail instead of displaying a node from a different ShowTalk', () => {
  const runner = new ScriptRunner();
  assert.equal(runner.load(fixture([node(10, { next: { type: 'jump', to: 20 } }), node(20)], [{ op: 'talk', nids: [10] }, { op: 'talk', nids: [20] }]), manifest), false);
  assert.equal(runner.getSnapshot().error?.code, 'CROSS_BLOCK_TARGET');
  assert.equal(runner.getSnapshot().error?.flowActionIndex, 0);
  assert.equal(runner.getSnapshot().error?.nid, 10);
  assert.equal(runner.getSnapshot().stageEvents.length, 0);
});

test('ActivityAction, unsupported actions, and AVG metadata are recorded without effects', () => {
  const action = { Name: 'ActivityAction', Params: { SolarSchoolActionId: 1001, unknown: 'kept' } };
  const runner = play(fixture([node(1, {
    raw: { PlotKeyId: 15, WaitTime: 0.75 },
    actions: [action], stage: [{ op: 'activityAction', t: 0, kind: 'SolarSchool', actionId: 1001 }],
    options: [option({ optionId: 5, actions: [action], next: { type: 'end' } })],
  })]));
  assert.deepEqual(runner.getSnapshot().node?.raw, { PlotKeyId: 15, WaitTime: 0.75 });
  assert.equal(Object.isFrozen(runner.getSnapshot().node?.raw), true);
  runner.choose(0);
  assert.equal(runner.getSnapshot().choiceHistory[0].optionId, 5);
  assert.deepEqual(runner.getSnapshot().choiceHistory[0].actions, [action]);
  assert.equal(runner.getSnapshot().stageEvents[0].disposition, 'metadata');
  assert.equal('avgVars' in runner.getSnapshot(), false);
  assert.equal(runner.getSnapshot().events.filter(event => event.type === 'flow').length, 2);
  assert.deepEqual(displayed(runner), [1]);
});

test('unknown stage operations remain visible in debug output with their original metadata', () => {
  const operation = { op: 'unknown', t: 0.6, type: 'FutureStage', raw: { Keep: 'original' } };
  const runner = play(fixture([node(1, { stage: [operation] })]));
  assert.equal(runner.getSnapshot().stageEvents[0].disposition, 'unsupported');
  assert.deepEqual(runner.getSnapshot().stageEvents[0].operation, operation);
  const diagnostic = runner.getSnapshot().events.find(event => event.type === 'debug' && event.code === 'unsupported-stage-operation');
  assert.ok(diagnostic && diagnostic.type === 'debug');
  assert.deepEqual(diagnostic.data, operation);
  runner.advance();
  assert.equal(runner.getSnapshot().status, 'completed');
});

test('event observers receive events once and cannot reenter execution during delivery', () => {
  const runner = new ScriptRunner();
  const delivered: string[] = [];
  const unsubscribe = runner.onEvent(event => {
    delivered.push(`${event.runId}:${event.sequence}`);
    if (event.type === 'dialogue') assert.equal(runner.advance(), false);
  });
  runner.load(fixture([node(1)]), manifest);
  runner.start();
  assert.equal(runner.getSnapshot().status, 'dialogue');
  runner.advance();
  assert.equal(runner.getSnapshot().status, 'completed');
  assert.equal(delivered.length, runner.getSnapshot().events.length);
  assert.equal(new Set(delivered).size, delivered.length);
  unsubscribe();
});

test('invalid choices keep the node pending and emit a contextual recoverable error', () => {
  const runner = play(fixture([node(12, { options: [option()] })]));
  assert.equal(runner.choose(7), false);
  assert.equal(runner.getSnapshot().status, 'choices');
  assert.equal(runner.getSnapshot().nid, 12);
  assert.equal(runner.getSnapshot().choiceHistory.length, 0);
  assert.equal(runner.getSnapshot().diagnostics[0].code, 'INVALID_CHOICE');
  assert.equal(runner.getSnapshot().diagnostics[0].optionIndex, 7);
});

test('malformed data emits errors with script, flow, node, option, and field context', async t => {
  const good = fixture([node(17, { options: [option()] })]);
  const mutations: [string, (value: any) => void, string][] = [
    ['missing option.next', value => { delete value.nodes[0].options[0].next; }, 'options[0].next'],
    ['string nid', value => { value.nodes[0].nid = '17'; }, 'nid'],
    ['duplicate nid', value => { value.nodes.push(value.nodes[0]); }, 'nid'],
    ['missing block node', value => { value.flowActions[1].nids = [88]; }, 'nids[0]'],
    ['bad phase', value => { value.nodes[0].stage = [{ op: 'enter', t: 0, phase: 'exit' }]; }, 'phase'],
    ['bad time', value => { value.nodes[0].stage = [{ op: 'enter', t: -1 }]; }, '.t'],
    ['bad stage object', value => { value.nodes[0].stage = [null]; }, 'stage[0]'],
    ['missing text key', value => { value.nodes[0].textKey = null; }, 'textKey'],
    ['missing talk nids', value => { delete value.flowActions[1].nids; }, 'nids'],
  ];
  for (const [name, mutate, path] of mutations) await t.test(name, () => {
    const value = structuredClone(good);
    mutate(value);
    const runner = new ScriptRunner();
    assert.equal(runner.load(value, manifest), false);
    const error = runner.getSnapshot().error!;
    assert.equal(error.scriptId, 'fixture');
    assert.ok(error.path?.includes(path), error.message);
    assert.ok(error.message.includes('script fixture'));
    assert.equal(runner.getSnapshot().status, 'error');
    assert.equal(runner.getSnapshot().events.at(-1)?.type, 'error');
  });
  const missingNext: any = structuredClone(good);
  delete missingNext.nodes[0].options[0].next;
  const contextual = new ScriptRunner();
  contextual.load(missingNext, manifest);
  assert.equal(contextual.getSnapshot().error?.flowActionIndex, 1);
  assert.equal(contextual.getSnapshot().error?.nid, 17);
  assert.equal(contextual.getSnapshot().error?.optionIndex, 0);
  const numericId = new ScriptRunner();
  numericId.load({ ...good, id: 17048 }, manifest);
  assert.equal(numericId.getSnapshot().error?.path, 'script.id');
  const schema = new ScriptRunner();
  schema.load(good, { ...manifest, schema: 1 });
  assert.equal(schema.getSnapshot().error?.code, 'UNSUPPORTED_SCHEMA');
  const cyclic: any = structuredClone(good);
  cyclic.nodes[0].raw = { self: null };
  cyclic.nodes[0].raw.self = cyclic.nodes[0].raw;
  const cycles = new ScriptRunner();
  cycles.load(cyclic, manifest);
  assert.match(cycles.getSnapshot().error!.message, /cyclic data/);
});
