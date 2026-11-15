import type { ScriptRunner } from '../engine/ScriptRunner.ts';
import type { RunnerEvent, Speaker, VisitToken } from '../engine/types.ts';
import { speakerName } from '../text/EnglishText.ts';
import type { PlayerTextProfile } from '../text/EnglishText.ts';
import { formattedEnglishText, parseEnglishText } from '../text/FormattedEnglishText.ts';
import type { FormattedEnglishText } from '../text/FormattedEnglishText.ts';

export interface BacklogEntry extends VisitToken {
  readonly id: string;
  readonly kind: 'dialogue' | 'choice';
  readonly scriptId: string;
  readonly nodeId: number;
  readonly voiceCues?: readonly string[];
  readonly speakerName: string;
  readonly document: FormattedEnglishText;
}

type BacklogSource = Pick<ScriptRunner, 'getSnapshot' | 'subscribe' | 'onEvent'>;

/** Readable snapshots only. Runner events own visits; rendering and text clocks
 * never record entries or drive navigation. Technical history stays in Debug. */
export class DialogueBacklog {
  private readonly runner: BacklogSource;
  private english: Readonly<Record<string, string>> = {};
  private speakers: Readonly<Record<string, Speaker>> = {};
  private profile: PlayerTextProfile = { playerName: 'Rover', gender: 'male' };
  private runId: number;
  private entries: readonly BacklogEntry[] = Object.freeze([]);
  private readonly seen = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeEvents: () => void;
  private readonly unsubscribeState: () => void;
  private disposed = false;

  constructor(runner: BacklogSource) {
    this.runner = runner;
    this.runId = runner.getSnapshot().runId;
    this.unsubscribeEvents = runner.onEvent(event => this.record(event));
    this.unsubscribeState = runner.subscribe(() => this.syncRun());
    this.syncRun();
  }

  getSnapshot = (): readonly BacklogEntry[] => this.entries;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  setTextContext(english: Readonly<Record<string, string>>, speakers: Readonly<Record<string, Speaker>>, profile: PlayerTextProfile): void {
    if (this.disposed) return;
    this.english = english;
    this.speakers = speakers;
    this.profile = { ...profile };
    // Older entries already contain resolved, frozen text and speaker names.
  }

  /** Explicit Start clears immediately, including while its script loads.
   * Retain seen visits so the current line cannot be backfilled afterward. */
  clear(): void {
    if (!this.disposed && this.entries.length) this.publish(Object.freeze([]));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeEvents();
    this.unsubscribeState();
    this.listeners.clear();
  }

  private syncRun(): void {
    if (this.disposed) return;
    const state = this.runner.getSnapshot();
    if (state.status === 'disposed') { this.dispose(); return; }
    if (state.runId !== this.runId) {
      this.runId = state.runId;
      this.seen.clear();
      this.clear();
    }
    // Completion leaves entries available until the next Start/Restart.
  }

  private record(event: RunnerEvent): void {
    if (this.disposed || event.runId !== this.runner.getSnapshot().runId) return;
    this.syncRun();
    if (event.type === 'checkpointRestored') {
      this.seen.clear(); this.publish(Object.freeze([]));
      for (const entry of event.history) this.record(entry);
      return;
    }
    if (this.disposed || event.type !== 'dialogue' && event.type !== 'choiceSelected' && event.type !== 'interactionVoice') return;
    const kind = event.type === 'choiceSelected' ? 'choice' : 'dialogue';
    const visitId = event.type === 'interactionVoice' ? -event.sequence : event.visitId;
    const id = `${event.runId}:${visitId}:${kind}`;
    if (this.seen.has(id)) return;
    this.seen.add(id);

    let document: FormattedEnglishText;
    let name: string;
    let nodeId: number;
    if (event.type === 'interactionVoice') {
      if (!event.textKey) return;
      document = formattedEnglishText(event.textKey, this.english, this.profile);
      if (!document.text.trim()) return;
      name = event.speakerId ? speakerName({ speakerId: event.speakerId, textKey: event.textKey } as import('../engine/types.ts').ScriptNode, this.speakers, this.english, this.profile) : '';
      nodeId = -(event.interactionId ?? event.sequence);
    } else if (event.type === 'dialogue') {
      if (event.node.kind === 'silent') return;
      document = formattedEnglishText(event.node.textKey, this.english, this.profile);
      if (!document.text.trim()) return;
      name = speakerName(event.node, this.speakers, this.english, this.profile);
      nodeId = event.node.nid;
    } else {
      if (event.entry.debugOverride || event.entry.decision === 'automatic') return;
      document = formattedEnglishText(event.entry.textKey, this.english, this.profile);
      // Match the existing visible choice's fallback label exactly.
      if (!document.text) document = parseEnglishText(`Choice ${event.entry.optionIndex + 1}`, this.profile);
      name = this.profile.playerName || 'You';
      nodeId = event.entry.nid;
    }
    const entry: BacklogEntry = Object.freeze({
      id, kind, scriptId: event.scriptId, nodeId,
      runId: event.runId, visitId, speakerName: name, document,
      voiceCues: Object.freeze(event.type === 'interactionVoice' ? event.cue ? [event.cue] : [] : event.type === 'dialogue' ? typeof event.node.voice === 'string' ? [event.node.voice] : [...event.node.voice ?? []] : []),
    });
    this.publish(Object.freeze([...this.entries, entry]));
  }

  private publish(entries: readonly BacklogEntry[]): void {
    this.entries = entries;
    for (const listener of this.listeners) listener();
  }
}
