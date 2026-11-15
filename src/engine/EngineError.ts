import type { ErrorInfo } from './types.ts';

export class EngineError extends Error {
  readonly info: ErrorInfo;

  constructor(code: string, message: string, context: Partial<Omit<ErrorInfo, 'code' | 'message'>> = {}) {
    const location = [
      context.scriptId != null ? `script ${context.scriptId}` : null,
      context.flowActionIndex != null ? `flow action ${context.flowActionIndex}` : null,
      context.nid != null ? `nid ${context.nid}` : null,
      context.optionIndex != null ? `option ${context.optionIndex}` : null,
      context.path ?? null,
    ].filter(Boolean).join(' · ');
    super(location ? `${location}: ${message}` : message);
    this.name = 'EngineError';
    this.info = Object.freeze({
      code, message: this.message, fatal: true,
      scriptId: null, flowActionIndex: null, nid: null,
      ...context,
    });
  }
}

export function errorInfo(error: unknown, context: Partial<ErrorInfo> = {}): ErrorInfo {
  if (error instanceof EngineError) return error.info;
  return new EngineError('RUNTIME_ERROR', error instanceof Error ? error.message : String(error), context).info;
}
