import type { FlowAction, Script } from './types.ts';
import type { PreparedScript, TalkBlock } from './validation.ts';

export interface FlowHandlers {
  action(action: FlowAction, index: number): void;
  configure(action: Extract<FlowAction, { op: 'configure' }>): void;
  movie(action: Extract<FlowAction, { op: 'movie' }>): void;
  unsupported(action: Extract<FlowAction, { op: 'unsupported' }>): void;
  completed(index: number): void;
}

/** Ordered flow execution. A talk block pauses dispatch until nextBlock is called. */
export class FlowDispatcher {
  private index = -1;
  private done = false;
  private readonly script: Script;
  private readonly blocks: ReadonlyMap<number, TalkBlock>;
  private readonly handlers: FlowHandlers;

  constructor(prepared: PreparedScript, handlers: FlowHandlers, afterIndex = -1) {
    this.script = prepared.script;
    this.blocks = prepared.blocks;
    this.handlers = handlers;
    this.index = afterIndex;
  }

  nextBlock(): TalkBlock | null {
    if (this.done) return null;
    while (++this.index < this.script.flowActions.length) {
      const action = this.script.flowActions[this.index];
      this.handlers.action(action, this.index);
      switch (action.op) {
        case 'talk': return this.blocks.get(this.index)!;
        case 'configure': this.handlers.configure(action); break;
        case 'movie': this.handlers.movie(action); break;
        case 'unsupported': this.handlers.unsupported(action); break;
      }
    }
    this.done = true;
    this.handlers.completed(this.index);
    return null;
  }
}

/** Read movie audio references as metadata; they never become audio operations. */
export function movieAudioCues(raw: unknown): readonly string[] {
  const cues = new Set<string>();
  const visit = (value: unknown, key = '') => {
    if (typeof value === 'string') {
      if (value.includes('WwiseAudio/Events/') || ['AudioEvent', 'cue'].includes(key)) {
        const cue = value.split('/').at(-1)?.split('.')[0];
        if (cue) cues.add(cue);
      }
    } else if (Array.isArray(value)) {
      value.forEach(item => visit(item, key));
    } else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([name, item]) => visit(item, name));
    }
  };
  visit(raw);
  return Object.freeze([...cues]);
}
