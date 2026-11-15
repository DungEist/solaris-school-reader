import { EngineError } from './EngineError.ts';
import type { ErrorInfo } from './types.ts';

type ObjectData = Record<string, unknown>;

/** Check neutral quiz fields without interpreting English or ordinary options. */
export function validateQuizDefinition(value: unknown, path: string, context: Partial<ErrorInfo> = {}): void {
  const fail = (message: string, field: string): never => { throw new EngineError('MALFORMED_QUIZ', message, { ...context, path: field }); };
  const object = (value: unknown, field: string): ObjectData => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected quiz metadata object', field);
    return value as ObjectData;
  };
  const id = (value: unknown, field: string) => { if (!Number.isSafeInteger(value)) fail('expected a stable integer ID', field); };
  const text = (value: unknown, field: string) => { if (value !== null && (typeof value !== 'string' || !value.trim())) fail('expected a text key/reference or null', field); };
  const quiz = object(value, path);
  id(quiz.id, `${path}.id`); id(quiz.actionId, `${path}.actionId`);
  for (const key of ['titleKey', 'questionKey', 'illustration']) text(quiz[key], `${path}.${key}`);
  for (const key of ['addScore', 'resultHoldMs']) {
    if (quiz[key] !== null && (!Number.isSafeInteger(quiz[key]) || key === 'resultHoldMs' && (quiz[key] as number) < 0)) fail('expected source integer metadata or null', `${path}.${key}`);
  }
  const raw = object(quiz.raw, `${path}.raw`);
  const question = raw.question === undefined ? null : object(raw.question, `${path}.raw.question`);
  for (const [source, field] of [['Id', 'id'], ['Title', 'titleKey'], ['Desc', 'questionKey'], ['Image', 'illustration'], ['AddScore', 'addScore']] as const) {
    if (question && Object.hasOwn(question, source) && (question[source] || question[source] === 0 ? question[source] : null) !== quiz[field]) fail('normalized quiz must match its preserved question row', `${path}.${field}`);
  }
  if (!Array.isArray(quiz.answers) || !quiz.answers.length) fail('a quiz needs answer records', `${path}.answers`);
  const seen = new Set<number>();
  (quiz.answers as unknown[]).forEach((value, index) => {
    const field = `${path}.answers[${index}]`;
    const answer = object(value, field);
    id(answer.id, `${field}.id`);
    if (seen.has(answer.id as number)) fail('duplicate quiz answer ID', `${field}.id`);
    seen.add(answer.id as number);
    text(answer.textKey, `${field}.textKey`);
    if (answer.correct !== null && typeof answer.correct !== 'boolean') fail('correctness must be an explicit boolean or unresolved null', `${field}.correct`);
    const original = object(answer.raw, `${field}.raw`);
    if (Object.hasOwn(original, 'Id') && original.Id !== answer.id) fail('answer ID must match its source row', `${field}.id`);
    if (Object.hasOwn(original, 'TextKey') && (original.TextKey || null) !== answer.textKey) fail('answer text key must match its source row', `${field}.textKey`);
    const correct = typeof original.IsCorrect === 'boolean' ? original.IsCorrect : null;
    if (correct !== answer.correct) fail('correctness must match an explicit IsCorrect boolean in the source row, or remain unresolved', `${field}.correct`);
    if (question?.ChoiceGroupId !== undefined && original.GroupId !== question.ChoiceGroupId) fail('answer must belong to the question choice group', `${field}.raw.GroupId`);
  });
  if (raw.action !== undefined) {
    const action = object(raw.action, `${path}.raw.action`);
    if (action.Id !== quiz.actionId || action.ActionType !== 8) fail('quiz needs its matching SolarSchool exam action', `${path}.raw.action`);
    const params = Array.isArray(action.ActionParams) ? action.ActionParams.filter(value => value && typeof value === 'object' && (value as ObjectData).Key === 'Id') as ObjectData[] : [];
    if (params.length !== 1 || String(quiz.id) !== params[0].Value) fail('quiz ID must match the exam action Id parameter', `${path}.id`);
  }
}
