import { EngineError } from './EngineError.ts';
import { validateQuizDefinition } from './QuizValidation.ts';
import type { ErrorInfo, Manifest, Metadata, Navigation, Script, ScriptConfig, ScriptIndexEntry, ScriptNode, Speaker } from './types.ts';

type Context = Partial<ErrorInfo>;
type Obj = Record<string, unknown>;

function fail(message: string, path: string, context: Context = {}, code = 'MALFORMED_DATA'): never {
  throw new EngineError(code, message, { ...context, path });
}

function object(value: unknown, path: string, context: Context = {}): Obj {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('expected an object', path, context);
  return value as Obj;
}

function array(value: unknown, path: string, context: Context = {}): unknown[] {
  if (!Array.isArray(value)) fail('expected an array', path, context);
  return value;
}

function string(value: unknown, path: string, context: Context = {}, nullable = false): void {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !value.trim()) fail('expected a nonempty string', path, context);
}

function number(value: unknown, path: string, context: Context = {}, nullable = false): void {
  if (nullable && value === null) return;
  if (!Number.isSafeInteger(value)) fail('expected an integer', path, context);
}

function boolean(value: unknown, path: string, context: Context = {}): void {
  if (typeof value !== 'boolean') fail('expected a boolean', path, context);
}

/** Reject non-JSON metadata too, so later debug serialization cannot crash. */
function checkJson(value: unknown, path: string, context: Context, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object') fail('expected JSON data', path, context);
  if (ancestors.has(value)) fail('cyclic data is not JSON', path, context);
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, i) => checkJson(item, `${path}[${i}]`, context, ancestors));
  } else {
    for (const [key, item] of Object.entries(value)) checkJson(item, `${path}.${key}`, context, ancestors);
  }
  ancestors.delete(value);
}

export function freezeJson<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

function immutableCopy<T>(value: unknown): T {
  return freezeJson(structuredClone(value)) as T;
}

function actions(value: unknown, path: string, context: Context): void {
  if (value === undefined) return;
  array(value, path, context).forEach((item, i) => object(item, `${path}[${i}]`, context));
}

function stageOperations(value: unknown, path: string, context: Context, phases: readonly string[]): void {
  array(value, path, context).forEach((item, index) => {
    const stPath = `${path}[${index}]`;
    const stage = object(item, stPath, context);
    string(stage.op, `${stPath}.op`, context);
    if (typeof stage.t !== 'number' || !Number.isFinite(stage.t) || stage.t < 0 || stage.t * 1000 > Number.MAX_SAFE_INTEGER) fail('t must be a finite, nonnegative schedulable time in seconds', `${stPath}.t`, context);
    for (const field of ['dur', 'fadeIn', 'fadeOut', 'fade']) {
      const duration = stage[field];
      if (duration != null && (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0 || duration * 1000 > Number.MAX_SAFE_INTEGER)) fail(`${field} must be a finite, nonnegative duration in seconds`, `${stPath}.${field}`, context);
    }
    if (stage.phase !== undefined && !phases.includes(String(stage.phase))) fail(`phase must be ${phases.join(' or ')}`, `${stPath}.phase`, context);
    if (stage.quiz !== undefined) {
      if (stage.op !== 'activityAction' || stage.kind !== 'SolarSchool') fail('quiz must be a SolarSchool activity performance', `${stPath}.quiz`, context);
      validateQuizDefinition(stage.quiz, `${stPath}.quiz`, context);
      if (stage.actionId !== (stage.quiz as { actionId: number }).actionId) fail('quiz action must match the stage activity ID', `${stPath}.actionId`, context);
    }
  });
}

function navigation(value: unknown, path: string, context: Context): void {
  const next = object(value, path, context);
  if (!['seq', 'jump', 'end'].includes(String(next.type))) fail('next.type must be seq, jump, or end', `${path}.type`, context);
  if (next.type === 'jump') number(next.to, `${path}.to`, context);
}

function config(value: unknown, path: string, context: Context): void {
  const cfg = object(value, path, context);
  if (cfg.initialBackground !== undefined) number(cfg.initialBackground, `${path}.initialBackground`, context, true);
  if (cfg.initialAudio !== undefined) array(cfg.initialAudio, `${path}.initialAudio`, context).forEach((item, i) => string(item, `${path}.initialAudio[${i}]`, context, true));
  if (cfg.subtype !== undefined) string(cfg.subtype, `${path}.subtype`, context, true);
}

export function validateManifest(value: unknown, context: Context = {}): Manifest {
  const m = object(value, 'manifest.json', context);
  if (m.schema !== 2) fail(`schema 2 is required; received ${String(m.schema)}`, 'manifest.json.schema', context, 'UNSUPPORTED_SCHEMA');
  checkJson(m, 'manifest.json', context);
  number(m.activityId, 'manifest.json.activityId', context);
  string(m.titleKey, 'manifest.json.titleKey', context);
  object(m.source, 'manifest.json.source', context);
  string(m.defaultLocale, 'manifest.json.defaultLocale', context);
  const locales = array(m.locales, 'manifest.json.locales', context);
  locales.forEach((item, i) => string(item, `manifest.json.locales[${i}]`, context));
  if (!locales.includes('en')) fail('an English locale is required', 'manifest.json.locales', context, 'MISSING_ENGLISH');
  string(m.scripts, 'manifest.json.scripts', context);
  string(m.report, 'manifest.json.report', context);
  return immutableCopy<Manifest>(m);
}

export interface TalkBlock {
  readonly flowActionIndex: number;
  readonly nids: readonly number[];
  readonly firstNid: number | null;
  readonly successors: ReadonlyMap<number, number | null>;
  readonly nodes: ReadonlyMap<number, ScriptNode>;
}

export interface PreparedScript {
  readonly script: Script;
  readonly blocks: ReadonlyMap<number, TalkBlock>;
  readonly diagnostics: readonly ErrorInfo[];
}

/** Compile nid-based block maps and validate every canonical target before play. */
export function prepareScript(value: unknown, manifest: unknown): PreparedScript {
  const s = object(value, 'script');
  const context: Context = { scriptId: typeof s.id === 'string' ? s.id : null };
  validateManifest(manifest, context);
  string(s.id, 'script.id', context);
  string(s.stateKey, 'script.stateKey', context);
  string(s.group, 'script.group', context);
  boolean(s.needSave, 'script.needSave', context);
  boolean(s.registered, 'script.registered', context);
  config(s.config, 'script.config', context);
  const flow = array(s.flowActions, 'script.flowActions', context);
  const owners = new Map<number, number>();

  flow.forEach((item, i) => {
    const ctx = { ...context, flowActionIndex: i };
    const path = `script.flowActions[${i}]`;
    const action = object(item, path, ctx);
    if (action.op === 'configure') {
      config(action.config, `${path}.config`, ctx);
    } else if (action.op === 'talk') {
      const seen = new Set<number>();
      array(action.nids, `${path}.nids`, ctx).forEach((nid, j) => {
        number(nid, `${path}.nids[${j}]`, ctx);
        if (seen.has(nid as number)) fail('duplicate nid in talk block', `${path}.nids[${j}]`, { ...ctx, nid: nid as number });
        seen.add(nid as number);
        if (!owners.has(nid as number)) owners.set(nid as number, i);
      });
    } else if (action.op === 'movie') {
      string(action.videoName, `${path}.videoName`, ctx, true);
    } else if (action.op === 'unsupported') {
      object(action.raw, `${path}.raw`, ctx);
    } else {
      fail('unknown flow op; the builder must preserve it as unsupported', `${path}.op`, ctx);
    }
    if (action.raw !== undefined) object(action.raw, `${path}.raw`, ctx);
    checkJson(action, path, ctx);
  });

  const nids = new Set<number>();
  array(s.nodes, 'script.nodes', context).forEach((item, i) => {
    const node = object(item, `script.nodes[${i}]`, context);
    const ctx = { ...context, nid: Number.isSafeInteger(node.nid) ? node.nid as number : null, flowActionIndex: owners.get(node.nid as number) ?? null };
    const path = `script.nodes[${i}]`;
    number(node.nid, `${path}.nid`, ctx);
    if (nids.has(node.nid as number)) fail('duplicate nid in script', `${path}.nid`, ctx);
    nids.add(node.nid as number);
    if (!['line', 'narration', 'centerText', 'silent', 'option'].includes(String(node.kind))) fail('unknown node kind', `${path}.kind`, ctx);
    string(node.style, `${path}.style`, ctx);
    string(node.speakerId, `${path}.speakerId`, ctx, true);
    string(node.textKey, `${path}.textKey`, ctx, true);
    if (['line', 'narration', 'centerText'].includes(String(node.kind)) && node.textKey === null) fail('a text node needs textKey', `${path}.textKey`, ctx);
    stageOperations(node.stage, `${path}.stage`, ctx, ['start', 'end']);
    navigation(node.next, `${path}.next`, ctx);
    if (node.options !== undefined) {
      array(node.options, `${path}.options`, ctx).forEach((item, j) => {
        const optCtx = { ...ctx, optionIndex: j };
        const optPath = `${path}.options[${j}]`;
        const option = object(item, optPath, optCtx);
        string(option.textKey, `${optPath}.textKey`, optCtx, true);
        number(option.optionId, `${optPath}.optionId`, optCtx, true);
        if (option.to !== undefined) number(option.to, `${optPath}.to`, optCtx, true);
        navigation(option.next, `${optPath}.next`, optCtx);
        actions(option.actions, `${optPath}.actions`, optCtx);
        const params = option.typeParams === undefined ? null : object(option.typeParams, `${optPath}.typeParams`, optCtx);
        const raw = option.raw === undefined ? null : object(option.raw, `${optPath}.raw`, optCtx);
        if (option.performances !== undefined) stageOperations(option.performances, `${optPath}.performances`, optCtx, ['option']);
        // Refuse partially rebuilt data instead of silently dropping conditions
        // or part of an option's ordered performances.
        if (raw && Object.hasOwn(raw, 'PreCondition') && !Object.hasOwn(option, 'preCondition')) fail('preserved option PreCondition is required; rebuild schema 2 data', `${optPath}.preCondition`, optCtx);
        const rawParams = raw?.TypeParams === undefined ? null : object(raw.TypeParams, `${optPath}.raw.TypeParams`, optCtx);
        if (rawParams && !params) fail('preserved option TypeParams are required; rebuild schema 2 data', `${optPath}.typeParams`, optCtx);
        for (const source of [params, rawParams]) {
          if (source?.OptionPerformances === undefined) continue;
          const original = array(source.OptionPerformances, `${optPath}.typeParams.OptionPerformances`, optCtx);
          if (option.performances === undefined) fail('normalized option performances are required; rebuild schema 2 data', `${optPath}.performances`, optCtx);
          if (original.length !== (option.performances as unknown[]).length) fail('normalized option performances must preserve the complete source array', `${optPath}.performances`, optCtx);
        }
      });
    }
    if (node.kind === 'option' && (!Array.isArray(node.options) || !node.options.length)) fail('an option node needs choices', `${path}.options`, ctx);
    if (node.voice !== undefined) {
      if (Array.isArray(node.voice)) node.voice.forEach((item, j) => string(item, `${path}.voice[${j}]`, ctx));
      else string(node.voice, `${path}.voice`, ctx);
    }
    actions(node.actions, `${path}.actions`, ctx);
    if (node.raw !== undefined) object(node.raw, `${path}.raw`, ctx);
    checkJson(node, path, ctx);
  });
  checkJson(s, 'script', context);

  const script = immutableCopy<Script>(s);
  const nodes = new Map(script.nodes.map(node => [node.nid, node]));
  const blocks = new Map<number, TalkBlock>();
  const diagnostics: ErrorInfo[] = [];
  script.flowActions.forEach((action, flowActionIndex) => {
    if (action.op !== 'talk') return;
    const ctx = { ...context, flowActionIndex };
    const blockNodes = new Map<number, ScriptNode>();
    const successors = new Map<number, number | null>();
    action.nids.forEach((nid, i) => {
      const node = nodes.get(nid);
      if (!node) fail('talk block references a missing node', `script.flowActions[${flowActionIndex}].nids[${i}]`, { ...ctx, nid }, 'MISSING_NODE');
      blockNodes.set(nid, node);
      successors.set(nid, action.nids[i + 1] ?? null);
    });
    for (const node of blockNodes.values()) {
      const checkTarget = (next: Navigation, optionIndex?: number) => {
        if (next.type !== 'jump' || blockNodes.has(next.to)) return;
        const path = `nid ${node.nid}${optionIndex !== undefined ? `.options[${optionIndex}]` : ''}.next.to`;
        const targetCtx = { ...ctx, nid: node.nid, optionIndex, target: next.to };
        if (nodes.has(next.to)) fail(`jump target ${next.to} belongs to another talk block`, path, targetCtx, 'CROSS_BLOCK_TARGET');
        diagnostics.push(new EngineError('INVALID_TARGET', `jump target ${next.to} does not exist; sequential fallback will stay within this talk block`, { ...targetCtx, path, fatal: false }).info);
      };
      checkTarget(node.next);
      node.options?.forEach((option, i) => checkTarget(option.next, i));
    }
    blocks.set(flowActionIndex, { flowActionIndex, nids: action.nids, firstNid: action.nids[0] ?? null, successors, nodes: blockNodes });
  });
  return { script, blocks, diagnostics: Object.freeze(diagnostics) };
}

export function validateIndex(value: unknown): readonly ScriptIndexEntry[] {
  const ids = new Set<string>();
  array(value, 'scripts.index.json').forEach((item, i) => {
    const path = `scripts.index.json[${i}]`;
    const entry = object(item, path);
    const ctx = { scriptId: typeof entry.id === 'string' ? entry.id : null };
    string(entry.id, `${path}.id`, ctx);
    if (ids.has(entry.id as string)) fail('duplicate script ID', `${path}.id`, ctx);
    ids.add(entry.id as string);
    string(entry.stateKey, `${path}.stateKey`, ctx);
    string(entry.group, `${path}.group`, ctx);
    number(entry.nodes, `${path}.nodes`, ctx);
    if ((entry.nodes as number) < 0) fail('node count cannot be negative', `${path}.nodes`, ctx);
    boolean(entry.registered, `${path}.registered`, ctx);
  });
  checkJson(value, 'scripts.index.json', {});
  return immutableCopy<readonly ScriptIndexEntry[]>(value);
}

export function validateEnglish(value: unknown): Readonly<Record<string, string>> {
  const table = object(value, 'locales/en.json');
  for (const [key, text] of Object.entries(table)) {
    if (typeof text !== 'string') fail('expected English text as a string', `locales/en.json.${key}`);
  }
  return immutableCopy<Readonly<Record<string, string>>>(table);
}

export function validateSpeakers(value: unknown): Readonly<Record<string, Speaker>> {
  const table = object(value, 'speakers.json');
  for (const [id, value] of Object.entries(table)) {
    const path = `speakers.json.${id}`;
    const speaker = object(value, path);
    string(speaker.nameKey, `${path}.nameKey`, {}, true);
    number(speaker.talkerId, `${path}.talkerId`, {}, true);
  }
  checkJson(table, 'speakers.json', {});
  return immutableCopy<Readonly<Record<string, Speaker>>>(table);
}

export function validateBuildReport(value: unknown): Metadata {
  const report = object(value, 'build-report.json');
  const conflicts = array(report.optionControlConflicts, 'build-report.json.optionControlConflicts');
  if (conflicts.length) fail('conflicting option navigation must be fixed by the builder before playing', 'build-report.json.optionControlConflicts', {}, 'OPTION_CONTROL_CONFLICT');
  checkJson(report, 'build-report.json', {});
  return immutableCopy<Metadata>(report);
}

export const emptyConfig: ScriptConfig = Object.freeze({});
