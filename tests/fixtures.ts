import type { FlowAction, Manifest, Script, ScriptNode, ScriptOption } from '../src/engine/types.ts';

export const manifest: Manifest = {
  schema: 2, activityId: 111700001, titleKey: 'activity-title',
  source: { gameVersion: '3.8.0', resVersion: '3.8.6' },
  defaultLocale: 'en', locales: ['en'], scripts: 'scripts.index.json', report: 'build-report.json',
};

export function node(nid: number, overrides: Partial<ScriptNode> = {}): ScriptNode {
  return { nid, kind: 'line', style: 'VisualNovelTalk', speakerId: '999', textKey: `line-${nid}`, stage: [], next: { type: 'seq' }, ...overrides };
}

export function option(overrides: Partial<ScriptOption> = {}): ScriptOption {
  return { textKey: 'choice', to: null, next: { type: 'seq' }, optionId: null, ...overrides };
}

export function fixture(nodes: readonly ScriptNode[], flowActions?: readonly FlowAction[]): Script {
  return {
    id: 'fixture', stateKey: 'fixture-state', group: 'test', registered: true, needSave: false, config: {}, nodes,
    flowActions: flowActions ?? [{ op: 'configure', config: {} }, { op: 'talk', nids: nodes.map(item => item.nid) }],
  };
}
