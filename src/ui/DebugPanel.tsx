import { expressionTalker, resolveBackground, resolveCG, resolveQuizIllustration } from '../assets/AssetResolver.ts';
import { emptyVisualAssets } from '../assets/VisualAssets.ts';
import type { RuntimeAssetIssue, VisualAssets } from '../assets/VisualAssets.ts';
import { characterCoordinates, previewCoordinateFrame } from '../engine/StageCoordinates.ts';
import type { RunnerSnapshot, StageOp } from '../engine/types.ts';
import type { QuizResult } from '../engine/Quiz.ts';
import { roverDialogueAvatar, schoolAssetsForGender } from '../spine/SchoolRover.ts';
import { schoolPortraitByTalker, resolveSchoolPortrait } from '../spine/SchoolPortraitAssets.ts';

export function stageLabel(operation: StageOp): string {
  const fields = ['mode', 'id', 'who', 'expr', 'pos', 'hidePortrait', 'hideAvatar', 'effect', 'dur', 'fadeIn', 'fadeOut', 'fade', 'cue', 'fx', 'fxType', 'customType', 'path', 'amp', 'actionId']
    .filter(key => operation[key] != null)
    .map(key => `${key}=${String(operation[key])}`);
  return `${operation.op}${fields.length ? ` · ${fields.join(' · ')}` : ''}`;
}

interface Props {
  snapshot: RunnerSnapshot;
  readingInputReady?: boolean;
  quizInputReady?: boolean;
  assets?: VisualAssets;
  backgroundVariant?: 'day' | 'night';
  onBackgroundVariantChange?(variant: 'day' | 'night'): void;
  onInstantChange?(instant: boolean): void;
  onHiddenOverride?(optionIndex: number): void;
  onQuizResultOverride?(result: QuizResult): void;
  gender?: 'male' | 'female';
  runtimeIssues?: readonly RuntimeAssetIssue[];
  sourceError?: string;
}

export function DebugPanel({ snapshot, readingInputReady = snapshot.inputReady, quizInputReady = snapshot.inputReady, assets = emptyVisualAssets, backgroundVariant = 'day', onBackgroundVariantChange, onInstantChange, onHiddenOverride, onQuizResultOverride, gender = 'male', runtimeIssues = [], sourceError }: Props) {
  const debug = snapshot.events.filter(event => event.type === 'debug' || event.type === 'error' || event.type === 'movieSkipped');
  const stage = snapshot.stageState;
  const characters = Object.values(stage.characters);
  const genderAssets = schoolAssetsForGender(assets, gender);
  const quizEvents = snapshot.events.filter(event => 'quiz' in event);
  const resolved = [
    stage.background ? resolveBackground(assets, stage.background.id, backgroundVariant) : null,
    stage.cg?.kind === 'image' ? resolveCG(assets, stage.cg.id, gender) : null,
    snapshot.quiz?.definition.illustration ? resolveQuizIllustration(assets, snapshot.quiz.definition.id, snapshot.quiz.definition.illustration) : null,
  ].filter(asset => asset !== null);
  return (
    <aside className="debug-panel" aria-label="Debug panel">
      <h2>Debug</h2>
      <dl className="debug-location">
        <dt>scriptId</dt><dd data-testid="debug-script-id">{snapshot.scriptId ?? '—'}</dd>
        <dt>flowActionIndex</dt><dd data-testid="debug-flow-index">{snapshot.flowActionIndex}</dd>
        <dt>nid</dt><dd data-testid="debug-nid">{snapshot.nid ?? '—'}</dd>
        <dt>run</dt><dd>{snapshot.runId}</dd>
        <dt>visit / phase</dt><dd>{snapshot.visitId} / {snapshot.stagePhase ?? '—'}</dd>
        <dt>Stage events</dt><dd data-testid="debug-stage-count">{snapshot.stageEvents.length}</dd>
        <dt>Events applied to stage</dt><dd data-testid="debug-stage-applied">{stage.appliedEvents}</dd>
        <dt>Choices recorded</dt><dd data-testid="debug-choice-count">{snapshot.choiceHistory.length}</dd>
        <dt>Quiz answers recorded</dt><dd data-testid="debug-quiz-answer-count">{quizEvents.filter(event => event.type === 'quizAnswered').length}</dd>
      </dl>
      <details open>
        <summary>Story state and branch decisions</summary>
        {sourceError && <p className="asset-diagnostic">Story definitions unavailable: {sourceError}</p>}
        <p className="debug-note">A new playthrough uses source initial values. Missing imported state remains unknown. Rewards follow action parameters, reward groups, and ordered members; AVG flags use explicit assignments. PlotOptionId records read history. Hidden choices select the first eligible option in authored order.</p>
        <pre className="debug-scroll" data-testid="story-state">{JSON.stringify({ state: snapshot.storyState, branch: snapshot.branchResolution }, null, 2)}</pre>
        <pre className="debug-scroll" data-testid="story-mutations">{JSON.stringify(snapshot.events.filter(event => event.type === 'storyMutation'), null, 2)}</pre>
        <p className="debug-note">Automatic decisions: {snapshot.choiceHistory.filter(entry => entry.decision === 'automatic').length}. Developer overrides: {snapshot.choiceHistory.filter(entry => entry.debugOverride).length}.</p>
      </details>
      <details>
        <summary>Source visual effects</summary>
        <p className="debug-note">Effects follow the shared visit clock and authored stops. Fast-forward consumes transient effects; checkpoints restore active persistent effects. Native particle, material and sequence behavior remains unverified where listed below.</p>
        <pre className="debug-scroll" data-testid="debug-vfx">{JSON.stringify({ active: snapshot.effects.active, issues: snapshot.effects.issues, assets: assets.vfx?.effects ?? {} }, null, 2)}</pre>
      </details>
      <details open>
        <summary>Timing and transitions</summary>
        <label className="checkbox-label"><input type="checkbox" checked={snapshot.instantTransitions} disabled={!onInstantChange} onChange={event => onInstantChange?.(event.target.checked)} data-testid="instant-transitions" />Instant transitions (debug)</label>
        <dl className="debug-location">
          <dt>Clock (ms)</dt><dd>{snapshot.clockMs.toFixed(0)}</dd>
          <dt>Pending operations</dt><dd data-testid="debug-pending-count">{snapshot.pendingStage.length}</dd>
          <dt>Active visual tracks</dt><dd data-testid="debug-transition-count">{snapshot.presentation.transitions.length}</dd>
        </dl>
        <p className="debug-note">Advance/choose settle pending starts; a choice schedules its option performances, then timed ends. Applied state persists. Movement uses linear preview interpolation; source easing presets and canvas/pivot remain unresolved. Image swaps have no source fade duration.</p>
        <ul className="debug-scroll pending-operations">
          {snapshot.pendingStage.map(task => <li key={`${task.runId}:${task.visitId}:${task.phase}:${task.sourceOrder}`} data-testid="pending-stage" data-phase={task.phase} data-order={task.sourceOrder}>
            f{task.flowActionIndex} / {task.nid} · {task.phase} +{task.operation.t}s · order {task.sourceOrder}: {stageLabel(task.operation)}
          </li>)}
        </ul>
        <pre className="debug-scroll">{JSON.stringify(snapshot.presentation.transitions.map(track => ({ target: track.target, property: track.property, durationMs: track.durationMs, progress: Number(track.progress.toFixed(3)), visitId: track.event.visitId })), null, 2)}</pre>
      </details>
      {snapshot.quiz?.phase === 'unresolved' && <details open id="debug-quiz-result">
        <summary>Quiz result override (debug only)</summary>
        <p className="debug-note" data-testid="quiz-unresolved">The selected answer has no explicit IsCorrect boolean in source metadata. Result is unresolved. Choose a test result explicitly; no answer is inferred from its text.</p>
        <div className="play-controls">{(['correct', 'incorrect'] as const).map(result => <button key={result} type="button" disabled={!onQuizResultOverride || !quizInputReady} onClick={event => { event.stopPropagation(); onQuizResultOverride?.(result); }} onKeyDown={event => { if ([' ', 'Enter'].includes(event.key)) { event.stopPropagation(); if (event.repeat) event.preventDefault(); } }} data-testid="quiz-result-override" data-result={result}>Test override: {result}</button>)}</div>
      </details>}
      {quizEvents.length > 0 && <details>
        <summary>Quiz interactions ({quizEvents.length})</summary>
        <p className="debug-note">Answers use stable exam IDs and source IsCorrect booleans. Continue resumes the talk-block path and applies a correct answer’s AddScore to the active playthrough exam. Result-display duration and feedback animation IDs remain metadata. Text/stage timers continue during a quiz and History.</p>
        <ol className="debug-scroll" data-testid="quiz-events">{quizEvents.map(event => <li key={`${event.runId}:${event.sequence}`} data-testid="quiz-event" data-event={event.type} data-quiz-id={event.quiz.definition.id} data-answer-id={event.quiz.selectedAnswerId ?? ''} data-result={event.quiz.result ?? ''}>f{event.flowActionIndex} / {event.nid} · {event.type} · question {event.quiz.definition.id} · answer {event.quiz.selectedAnswerId ?? '—'} · {event.quiz.result ?? event.quiz.phase}</li>)}</ol>
        <pre className="debug-scroll">{JSON.stringify(snapshot.quiz, null, 2)}</pre>
      </details>}
      {snapshot.hiddenChoice && <details open id="debug-hidden-choices">
        <summary>Hidden branch override (debug only)</summary>
        <p className="debug-note">Automatic selection follows authored option order: the first eligible option wins; an earlier unknown blocks traversal. An override is an explicit investigation decision, recorded separately.</p>
        <div className="hidden-overrides">
          {snapshot.choices.map((option, index) => <div key={index}>
            <button type="button" disabled={!onHiddenOverride || snapshot.status !== 'choices' || !readingInputReady} onClick={() => onHiddenOverride?.(index)} onKeyDown={event => { if (event.repeat && [' ', 'Enter'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); } }} data-testid="hidden-choice-override" data-option-index={index} data-option-id={option.optionId ?? ''}>
              Debug branch {index + 1} · optionId {option.optionId ?? '—'}
            </button>
            <p><code>{option.textKey ?? 'No option text key'}</code> · {option.performances?.length ?? 0} performances</p>
            <pre className="debug-scroll">{option.preCondition === undefined ? 'No prerequisite: eligible at this position in authored order.' : JSON.stringify(option.preCondition, null, 2)}</pre>
          </div>)}
        </div>
      </details>}
      <details open>
        <summary>Persistent stage state</summary>
        <dl className="debug-location">
          <dt>Background</dt><dd data-testid="debug-background">{stage.background?.id ?? '—'}</dd>
          <dt>CG</dt><dd data-testid="debug-cg">{stage.cg ? `${stage.cg.kind} ${stage.cg.id ?? '(ID not exported)'}` : '—'}</dd>
          <dt>Characters present</dt><dd>{characters.filter(character => character.present).length} / {characters.length} tracked</dd>
        </dl>
        <div className="debug-scroll">
          {characters.length === 0 ? <p>No characters tracked.</p> : <table className="stage-table">
            <thead><tr><th>Who / expression</th><th>Visibility / effect</th><th>Position</th></tr></thead>
            <tbody>{characters.map(character => {
              const coordinates = characterCoordinates(character.position);
              return <tr key={character.who} data-testid="debug-character" data-who={character.who} data-present={character.present} data-portrait={character.portraitVisible} data-avatar={character.avatarVisible}>
                <td>{character.who}<br />expr {character.expression ?? '—'}<br />talker {expressionTalker(assets, character.expression) ?? 'unresolved'}</td>
                <td>{character.present ? 'present' : 'exited'}<br />portrait {character.portraitVisible ? 'shown' : 'hidden'}<br />avatar {character.avatarVisible ? 'shown' : 'hidden'}<br />{character.effect ?? 'no effect'}</td>
                <td>[{character.position.join(', ')}]<br /><small>left {coordinates.leftPercent.toFixed(1)}%, bottom {coordinates.bottomPercent.toFixed(1)}%</small></td>
              </tr>;
            })}</tbody>
          </table>}
        </div>
        <p className="debug-note">Preview plane: {previewCoordinateFrame.width} × {previewCoordinateFrame.height}; x is centered, increasing y moves up, floor {previewCoordinateFrame.floorPercent}%. Canvas/pivot are viewer conventions; source coordinates are retained.</p>
      </details>
      <details open>
        <summary>Asset resolution</summary>
        <label>Background preview<select value={backgroundVariant} onChange={event => onBackgroundVariantChange?.(event.target.value as 'day' | 'night')} disabled={!onBackgroundVariantChange} data-testid="background-variant">
          <option value="day">Day (default)</option><option value="night">Night (manual override)</option>
        </select></label>
        <p className="debug-note" data-testid="asset-cache-status" data-loaded={!!assets.mapping || assets.issues.length > 0}>{assets.mapping?.report ? `${assets.mapping.report.readyFiles} / ${assets.mapping.report.uniqueReferencedFiles} referenced files validated and cached.` : 'No validated asset cache map loaded.'} CG variant: {gender}.</p>
        <div className="debug-scroll asset-resolution">
          {resolved.length === 0 && <p>No background or CG image selected by this script.</p>}
          {resolved.map(asset => <div key={asset.kind} data-testid="resolved-asset" data-kind={asset.kind} data-variant={asset.variant}>
            <strong>{asset.label}</strong>
            <p>{runtimeIssues.find(issue => issue.url === asset.url)?.reason ?? asset.reason ?? 'Verified local path'}</p>
            <code>{asset.repositoryPath ?? 'No source image path'}</code>
            {asset.url && <p><code>{asset.url}</code> · {asset.width} × {asset.height}</p>}
          </div>)}
          {characters.filter(character => character.avatarVisible).map(character => {
            const avatar = roverDialogueAvatar(character, genderAssets);
            const talkerId = expressionTalker(genderAssets, avatar.character.expression);
            const definition = talkerId === null ? undefined : schoolPortraitByTalker.get(talkerId);
            const resolution = definition ? resolveSchoolPortrait(avatar.character, genderAssets, definition) : null;
            const reason = resolution?.kind === 'fallback' || resolution?.kind === 'other' ? resolution.reason : undefined;
            return <div key={`avatar-${character.who}`} data-testid="avatar-asset-resolution" data-who={character.who} data-expression={character.expression ?? ''} data-render-expression={avatar.character.expression ?? ''} data-avatar-fallback={avatar.fallback?.expressionId ?? ''} data-gender={gender} data-resource={definition?.slug ?? ''}>
              <strong>Avatar {character.who} · expression {character.expression ?? 'unspecified'} · {definition?.name ?? `talker ${talkerId ?? 'unresolved'}`}</strong>
              <p>{reason ?? (resolution?.kind === 'spine' ? 'Source animation channels supported.' : 'No registered Spine avatar for this source expression.')}</p>
              {avatar.fallback && <p data-testid="rover-avatar-fallback">{avatar.fallback.reason}</p>}
            </div>;
          })}
          {assets.issues.map((issue, index) => <p key={index} className="asset-diagnostic">{issue}</p>)}
          {runtimeIssues.map(issue => <p key={issue.url} className="asset-diagnostic" data-testid="asset-image-error">{issue.label}: {issue.reason}<br /><code>{issue.url}</code></p>)}
        </div>
      </details>
      <details open>
        <summary>Stage events ({snapshot.stageEvents.length})</summary>
        <div className="debug-scroll">
          {snapshot.stageEvents.length === 0 ? <p>No stage events.</p> : (
            <table className="stage-table">
              <thead><tr><th>Location</th><th>Phase / t</th><th>Operation</th></tr></thead>
              <tbody>{snapshot.stageEvents.map(event => (
                <tr key={`${event.runId}:${event.sequence}`} data-testid="stage-event" data-flow={event.flowActionIndex} data-nid={event.nid ?? ''} data-phase={event.phase} data-op={event.operation.op} data-visit={event.visitId ?? ''}>
                  <td>f{event.flowActionIndex} / {event.nid ?? 'config'}{event.optionIndex !== undefined && <><br />option {event.optionIndex}</>}</td>
                  <td>{event.phase} / {event.operation.t}s{event.timing && <><br /><small>{event.timing.delivery} · due {event.timing.dueAtMs.toFixed(0)} / applied {event.timing.appliedAtMs.toFixed(0)} ms · order {event.timing.sourceOrder}</small></>}</td>
                  <td>{stageLabel(event.operation)} <small>({event.disposition})</small></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </details>
      <details open>
        <summary>Navigation history ({snapshot.navigationHistory.length})</summary>
        <ol className="debug-scroll navigation-log" data-testid="navigation-history">
          {snapshot.navigationHistory.map((entry, i) => (
            <li key={i} data-testid="navigation-entry" data-from={entry.from ?? ''} data-to={entry.to ?? ''}>
              f{entry.flowActionIndex}: {entry.from ?? 'start'} → {entry.to ?? 'talk end'} ({entry.reason})
            </li>
          ))}
        </ol>
      </details>
      <details>
        <summary>Choice metadata ({snapshot.choiceHistory.length})</summary>
        <pre className="debug-scroll">{JSON.stringify(snapshot.choiceHistory, null, 2)}</pre>
      </details>
      <details open>
        <summary>Diagnostics and metadata ({debug.length})</summary>
        <ul className="debug-scroll diagnostic-log">
          {debug.map(event => (
            <li key={`${event.runId}:${event.sequence}`}>
              <strong>f{event.flowActionIndex} / {event.nid ?? '—'} · {event.type === 'debug' ? event.code : event.type}</strong>
              <p>{event.type === 'debug' ? event.message : event.type === 'error' ? event.error.message : `Skipped ${event.videoName}; suppressed audio: ${event.suppressedAudio.join(', ') || 'none'}`}</p>
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>Raw stage state and source expression metadata</summary>
        <pre className="debug-scroll">{JSON.stringify({ stage, expressions: Object.fromEntries(characters.filter(character => character.expression !== null).map(character => [character.expression, assets.manifest.expressions[String(character.expression)] ?? null])) }, null, 2)}</pre>
      </details>
      <details>
        <summary>All events and original metadata ({snapshot.events.length})</summary>
        <pre className="debug-scroll raw-events">{JSON.stringify(snapshot.events, null, 2)}</pre>
      </details>
    </aside>
  );
}
