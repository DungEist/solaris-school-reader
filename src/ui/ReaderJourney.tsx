import type { EnglishCatalog } from '../data/EnglishScriptRepository.ts';
import type { JourneyOption, JourneySnapshot, StoryPlaythrough } from '../engine/Playthrough.ts';
import type { StoryState } from '../engine/StoryState.ts';
import { favorCap, storyDate } from '../engine/StoryState.ts';
import { effectiveAttributes } from '../engine/StoryAttributes.ts';
import type { PlayerTextProfile } from '../text/EnglishText.ts';
import { formattedEnglishText, parseEnglishText } from '../text/FormattedEnglishText.ts';
import { RevealedText } from './RevealedText.tsx';
import { ReaderDialog } from './ReaderDialog.tsx';
import { readerArt, stopRepeatedButtonKey } from './ReaderArtwork.tsx';
import type { ReactNode } from 'react';
import { currentJourneyDecision, dispatchJourneyControl, journeyActionGroups } from './JourneyDecision.ts';
import type { JourneyDecisionControl } from './JourneyDecision.ts';

const title = (key: unknown, catalog: EnglishCatalog, fallback: string) => typeof key === 'string' ? catalog.english[key] || fallback : fallback;
const readerText = (key: unknown, catalog: EnglishCatalog, profile: PlayerTextProfile, fallback: string) => typeof key === 'string' && catalog.english[key] !== undefined ? formattedEnglishText(key, catalog.english, profile) : parseEnglishText(fallback, profile);
function SourceName({ value, profile }: { value: string; profile: PlayerTextProfile }) { return <RevealedText document={parseEnglishText(value, profile)} />; }

export function ReaderJourney({ journey, snapshot, state, catalog, profile, disabled = false }: { journey: StoryPlaythrough; snapshot: JourneySnapshot; state: StoryState; catalog: EnglishCatalog; profile: PlayerTextProfile; disabled?: boolean }) {
  const source = catalog.storySource;
  if (!source) return null;
  const date = state.dayIndex === null ? null : storyDate(state.dayIndex);
  const values = effectiveAttributes(state, source).value ?? state.attributes;
  const decision = currentJourneyDecision(snapshot);
  return <section className="journey-panel" aria-label="School year" data-testid="journey-panel" data-phase={snapshot.phase}>
    <div className="journey-heading"><h2>{date ? `${String(date.month).padStart(2, '0')}/${String(date.day).padStart(2, '0')}` : 'School year'}</h2><p>{snapshot.phase === 'planning' ? 'How will you spend your time?' : snapshot.phase === 'complete' ? 'Your school year is complete.' : 'Your school year so far.'}</p></div>
    <dl className="journey-stats">{Object.entries(values).map(([id, value]) => <div key={id}><dt><img src={readerArt(`attribute-${id}`)} alt="" />{title(source.attrs?.[id]?.Name, catalog, 'Attribute')}</dt><dd>{value.toLocaleString('en')}</dd></div>)}</dl>
    {snapshot.phase === 'planning' && <div className="journey-actions">{journeyActionGroups.map(group => {
      const options = snapshot.options.filter(option => option.kind === group.kind);
      return options.length > 0 && <section key={group.kind}><h3>{group.name}</h3><div className="journey-options">{options.map(option => <JourneyButton key={option.id} option={option} catalog={catalog} profile={profile} disabled={disabled || snapshot.busy} onSelect={() => { void journey.select(option.id); }} />)}</div></section>;
    })}{decision?.control && <JourneyControl journey={journey} control={decision.control} catalog={catalog} profile={profile} disabled={disabled || snapshot.busy} />}</div>}
    {snapshot.phase === 'complete' && decision?.control && <JourneyControl journey={journey} control={decision.control} catalog={catalog} profile={profile} disabled={disabled || snapshot.busy} />}
    <div className="journey-records"><section><h3>Friendships</h3><dl className="journey-favor">{Object.entries(state.favor).filter(([, favor]) => favor.unlocked).map(([id, favor]) => <div key={id}><dt>{title(source.roles?.[id]?.Name, catalog, 'Friend')}</dt><dd>{title(`SolarSchool_humanitiesClassFavor_${favor.level}`, catalog, `Level ${favor.level}`)} · {favor.points}/{favorCap(source, id, favor.level) ?? '—'}</dd></div>)}</dl></section>
      <section><h3>Inventory</h3><ul>{Object.entries(state.items).filter(([, quantity]) => quantity.min > 0).map(([id, quantity]) => <li key={id}><SourceName value={title(source.items[id]?.Name, catalog, 'Item')} profile={profile} /><span>×{quantity.min}</span></li>)}</ul></section>
      <section><h3>Requests</h3><ul>{Object.entries(state.behaviors).filter(([, progress]) => progress.state && progress.state !== 'Appeared').map(([id, progress]) => { const row = Object.values(source.behaviors ?? {}).find(r => String(r.BehaviorId) === id); return <li key={id}><span><SourceName value={title(row?.Name, catalog, 'Request')} profile={profile} /></span><span>{progress.state === 'Accepted' ? `${progress.count}/${row?.FinishCount ?? '—'}` : progress.state === 'Finished' ? 'Completed' : 'Expired'}</span></li>; })}</ul></section>
      <section><h3>Journeys</h3><ul>{Object.entries(state.requests).filter(([id]) => source.requests?.[id]?.ShowType === 2).map(([id, progress]) => <li key={id}><span><SourceName value={title(source.requests?.[id]?.Name, catalog, 'Journey')} profile={profile} /></span><span>{progress.status === 'expired' ? 'Expired' : `${progress.progress}/${source.requests?.[id]?.TargetProgress ?? '—'}${progress.rewardClaimed ? ' · Reward received' : ''}`}</span></li>)}</ul></section></div>
  </section>;
}

export function ReaderJourneyChoices({ journey, snapshot, catalog, profile, disabled = false, canInteract = () => true }: { journey: StoryPlaythrough; snapshot: JourneySnapshot; catalog: EnglishCatalog; profile: PlayerTextProfile; disabled?: boolean; canInteract?(): boolean }) {
  const decision = currentJourneyDecision(snapshot);
  if (!decision) return null;
  // Scratch cells keep their existing on-stage board. Their settlement and
  // return controls share this same decision projection.
  const options = decision.options.filter(option => option.kind !== 'scratchReveal');
  if (!options.length && !decision.control?.available) return null;
  return <div className="choices reader-journey-choices" role="group" aria-label="Available actions" data-testid="reader-actions" data-decision={decision.kind}>
    {options.map(option => <JourneyButton key={option.id} option={option} catalog={catalog} profile={profile} disabled={disabled || snapshot.busy} choice onSelect={() => { if (canInteract()) void journey.select(option.id); }} />)}
    {decision.control?.available && <JourneyControl journey={journey} control={decision.control} catalog={catalog} profile={profile} disabled={disabled || snapshot.busy} choice canInteract={canInteract} />}
  </div>;
}

function JourneyControl({ journey, control, catalog, profile, disabled, choice = false, canInteract = () => true }: { journey: StoryPlaythrough; control: JourneyDecisionControl; catalog: EnglishCatalog; profile: PlayerTextProfile; disabled: boolean; choice?: boolean; canInteract?(): boolean }) {
  return <button type="button" className={choice ? undefined : 'journey-continue'} disabled={disabled || !control.available} onClick={() => { if (canInteract()) dispatchJourneyControl(journey, control); }} onKeyDown={stopRepeatedButtonKey} data-testid={control.kind === 'continue' ? 'journey-continue' : control.kind === 'nextCycle' ? 'journey-next-cycle' : 'journey-confirm'} data-journey-control={control.kind}>
    {choice && <img className="choice-icon" src={readerArt('choice-icon')} alt="" aria-hidden="true" />}<RevealedText document={readerText(control.labelKey, catalog, profile, control.fallbackLabel)} />
  </button>;
}

function JourneyButton({ option, catalog, profile, disabled, onSelect, choice = false }: { option: JourneyOption; catalog: EnglishCatalog; profile: PlayerTextProfile; disabled: boolean; onSelect(): void; choice?: boolean }) {
  return <button type="button" disabled={disabled || option.condition.value !== 'true'} onClick={onSelect} onKeyDown={stopRepeatedButtonKey} data-testid={choice ? option.kind === 'location' ? 'place-choice' : 'journey-choice' : 'journey-option'} data-journey-option={option.id} data-journey-kind={option.kind}>{choice && <img className="choice-icon" src={readerArt('choice-icon')} alt="" aria-hidden="true" />}<span><RevealedText document={readerText(option.labelKey, catalog, profile, option.fallbackLabel || 'Continue')} /></span>{option.ownerLabelKey && catalog.english[option.ownerLabelKey] && <small className="journey-owner"><RevealedText document={readerText(option.ownerLabelKey, catalog, profile, '')} /></small>}{option.descriptionKey && catalog.english[option.descriptionKey] && <small className="journey-description"><RevealedText document={readerText(option.descriptionKey, catalog, profile, '')} /></small>}{option.progress !== undefined && <span>{choice && ' '}{option.target === undefined ? `Owned: ${option.progress}` : `${option.progress}/${option.target}`}</span>}{option.price !== undefined && <span className="journey-cost">Cost: {option.price?.toLocaleString('en') ?? '—'}{option.costKey && catalog.english[option.costKey] && <> <RevealedText document={readerText(option.costKey, catalog, profile, '')} /></>}</span>}{option.condition.value !== 'true' && <small className={choice ? 'choice-locked' : undefined}>{option.condition.value === 'false' ? 'Requirements unmet' : 'Information unavailable'}</small>}</button>;
}

export function ReaderJourneyInteraction({ id, journey, snapshot, state, catalog, profile, consequences, onStage = false }: { id: string; journey: StoryPlaythrough; snapshot: JourneySnapshot; state: StoryState; catalog: EnglishCatalog; profile: PlayerTextProfile; consequences?: ReactNode; onStage?: boolean }) {
  const interaction = snapshot.interaction;
  if (!interaction) return null;
  const heading = interaction.kind === 'roleTalk' ? 'A moment with a friend' : interaction.kind === 'ending' ? 'Choose your future' : interaction.kind === 'event' ? 'Make your choice' : interaction.kind === 'affairs' ? 'School affairs' : interaction.kind === 'scratch' ? 'Scratch ticket' : interaction.kind === 'raffle' ? 'Prize draw' : interaction.kind === 'requestDone' ? 'Request completed' : interaction.kind === 'requestFailed' ? 'Request expired' : interaction.kind === 'gift' ? 'Choose a gift' : interaction.kind === 'shop' ? 'Shop' : 'Special request';
  const required = interaction.kind === 'ending' || interaction.kind === 'event' || !!interaction.requiresChoice;
  const board = interaction.kind === 'scratch' ? state.scratchBoards[String(interaction.sourceId)] : undefined;
  const size = board ? Number(catalog.storySource?.scratchTickets?.[String(interaction.sourceId)]?.Size) : 0;
  const body = <>
    {consequences && <div className="journey-consequences">{consequences}</div>}
    <div className="journey-interaction-body" data-testid="journey-interaction" data-kind={interaction.kind}>{interaction.labelKey && catalog.english[interaction.labelKey] && <p><RevealedText document={readerText(interaction.labelKey, catalog, profile, '')} /></p>}
      {board && size > 0 && <div className="journey-scratch-grid" style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }} aria-label="Scratch ticket cells" data-testid="scratch-board">{board.rewards.map((rewardId, index) => {
        const revealed = board.revealed[String(index)], option = snapshot.options.find(candidate => candidate.kind === 'scratchReveal' && candidate.sourceId === index);
        const reward = revealed ? catalog.storySource?.rewards[String(rewardId)] : undefined;
        const rewardKey = reward?.RewardType === 0 ? catalog.storySource?.attrs?.[String(reward.TargetId)]?.Name : reward?.RewardType === 2 ? catalog.storySource?.items[String(reward.TargetId)]?.Name : undefined;
        return <button type="button" key={index} className={revealed ? 'scratch-cell scratch-cell-revealed' : 'scratch-cell'} disabled={snapshot.busy || !option || option.condition.value !== 'true'} aria-label={revealed ? `Revealed row ${Math.floor(index / size) + 1}, column ${index % size + 1}` : option?.fallbackLabel || 'Scratch cell'} data-testid="scratch-cell" data-journey-option={option?.id} onClick={() => { if (option) void journey.select(option.id); }} onKeyDown={stopRepeatedButtonKey}>{revealed ? reward ? <><SourceName value={title(rewardKey, catalog, 'Prize')} profile={profile} /><strong>{Number(reward.Value) > 0 ? '+' : ''}{String(reward.Value)}</strong></> : <span>No prize</span> : <span aria-hidden="true">✦</span>}</button>;
      })}</div>}
      {board && snapshot.options.find(option => option.kind === 'scratchReveal' && option.price !== undefined) && <p className="scratch-cost">Each scratch costs {snapshot.options.find(option => option.kind === 'scratchReveal' && option.price !== undefined)?.price} <SourceName value={title(snapshot.options.find(option => option.kind === 'scratchReveal')?.costKey, catalog, 'ticket')} profile={profile} /></p>}
      {!onStage && <><div className="journey-options">{snapshot.options.filter(option => option.kind !== 'scratchReveal').map(option => <JourneyButton key={option.id} option={option} catalog={catalog} profile={profile} disabled={snapshot.busy} onSelect={() => { void journey.select(option.id); }} />)}</div>{!required && <button type="button" onClick={() => { void journey.dismissInteraction(); }} onKeyDown={stopRepeatedButtonKey} data-testid="journey-confirm">{interaction.kind === 'requestDone' || interaction.kind === 'requestFailed' ? 'Confirm' : 'Continue'}</button>}</>}</div>
  </>;
  if (onStage) return <section className="reader-journey-context" aria-label={heading} data-testid="journey-context" data-kind={interaction.kind}><h2>{heading}</h2>{body}</section>;
  return <ReaderDialog id={id} title={heading} className={`reader-journey-dialog${required ? ' reader-journey-required' : ''}`} testId="journey-interaction" restoreFocusTo={null} onClose={() => { if (!required) void journey.dismissInteraction(); }}>{body}</ReaderDialog>;
}

export function JourneyDiagnostics({ snapshot }: { snapshot: JourneySnapshot }) {
  return <section className="debug-panel" aria-label="Playthrough diagnostics" data-testid="journey-diagnostics"><h2>Activity progression</h2><p>Day {snapshot.dayIndex ?? 'unknown'} · slot {snapshot.timeSlot ?? 'unknown'} · instance {snapshot.instanceId ?? 'unknown'} · {snapshot.phase} · {snapshot.sceneCount} scenes</p>{snapshot.endingPath.length > 0 && <p>Ending graph: {snapshot.endingPath.join(' → ')}</p>}<details><summary>Current activity options and prerequisites</summary><pre>{JSON.stringify(snapshot.options, null, 2)}</pre></details>{snapshot.diagnostics.length > 0 && <details open><summary>{snapshot.diagnostics.length} unresolved source or state diagnostics</summary><pre>{JSON.stringify(snapshot.diagnostics, null, 2)}</pre></details>}</section>;
}
