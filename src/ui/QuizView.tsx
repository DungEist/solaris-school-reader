import { useEffect, useId, useMemo, useRef } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { resolveQuizIllustration } from '../assets/AssetResolver.ts';
import type { ResolvedVisualAsset } from '../assets/AssetResolver.ts';
import type { VisualAssets } from '../assets/VisualAssets.ts';
import type { QuizState } from '../engine/Quiz.ts';
import type { PlayerTextProfile } from '../text/EnglishText.ts';
import { formattedEnglishText, parseEnglishText } from '../text/FormattedEnglishText.ts';
import { RevealedText } from './RevealedText.tsx';

interface Props {
  quiz: QuizState;
  english: Readonly<Record<string, string>>;
  profile: PlayerTextProfile;
  assets: VisualAssets;
  failedUrls: ReadonlySet<string>;
  inputReady: boolean;
  historyOpen: boolean;
  answer(id: number): void;
  continueQuiz(): void;
  onImageError(asset: ResolvedVisualAsset): void;
  developer?: boolean;
  developerHref?: string;
  onOpenDeveloper?(event: MouseEvent<HTMLAnchorElement>): void;
}

function buttonKey(event: KeyboardEvent<HTMLButtonElement>): void {
  if (![' ', 'Enter'].includes(event.key)) return;
  event.stopPropagation();
  if (event.repeat || event.nativeEvent.isComposing) event.preventDefault();
}

/** A quiz is a runner interaction; rendering never selects or continues it. */
export function QuizView({ quiz, english, profile, assets, failedUrls, inputReady, historyOpen, answer, continueQuiz, onImageError, developer = true, developerHref = '/debug', onOpenDeveloper }: Props) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const textFor = (key: string | null, fallback: string) => !developer && key && english[key] === undefined ? parseEnglishText(fallback, profile) : formattedEnglishText(key, english, profile);
  const text = useMemo(() => ({
    title: textFor(quiz.definition.titleKey, 'Question'),
    question: textFor(quiz.definition.questionKey, 'Question text unavailable.'),
    answers: quiz.definition.answers.map(option => textFor(option.textKey, 'Answer text unavailable.')),
  }), [quiz.definition, english, profile.playerName, profile.gender, developer]);
  const illustration = quiz.definition.illustration ? resolveQuizIllustration(assets, quiz.definition.id, quiz.definition.illustration) : null;
  // Focus once per interaction. Closing History retains its own focus restore.
  useEffect(() => { if (!historyOpen) heading.current?.focus(); }, [quiz.runId, quiz.visitId, quiz.instanceId]);
  return (
    <section className="quiz-view" aria-labelledby={titleId} data-testid="quiz" data-quiz-id={quiz.definition.id} data-instance-id={quiz.instanceId} data-phase={quiz.phase} data-selected-answer-id={quiz.selectedAnswerId ?? ''}>
      <h3 id={titleId} ref={heading} tabIndex={-1} data-testid="quiz-title">{text.title.text ? <RevealedText document={text.title} /> : 'Question'}</h3>
      <div className={`quiz-content${illustration ? ' quiz-with-illustration' : ''}`}>
        {illustration && <div className="quiz-illustration">
          {illustration.url && !failedUrls.has(illustration.url)
            ? <img src={illustration.url} alt="Question illustration" width={illustration.width ?? undefined} height={illustration.height ?? undefined} onError={() => onImageError(illustration)} data-testid="quiz-illustration" />
            : <p className="quiz-illustration-fallback" role="img" aria-label="Question illustration unavailable" data-testid="quiz-illustration-fallback">Question illustration unavailable.</p>}
        </div>}
        <p className="quiz-question" data-testid="quiz-question"><RevealedText document={text.question} /></p>
      </div>
      <div className="quiz-answers" role="group" aria-label="Quiz answers">
        {quiz.definition.answers.map((option, index) => <button key={option.id} type="button" aria-pressed={quiz.selectedAnswerId === option.id} disabled={historyOpen || !inputReady || quiz.phase !== 'question'} onKeyDown={buttonKey} onClick={event => { event.stopPropagation(); answer(option.id); }} data-testid="quiz-answer" data-answer-id={option.id}>
          {text.answers[index].text ? <RevealedText document={text.answers[index]} /> : `Answer ${index + 1}`}
        </button>)}
      </div>
      {quiz.phase === 'result' && <p className={`quiz-result quiz-${quiz.result}`} role="status" data-testid="quiz-result" data-result={quiz.result}>{quiz.result === 'correct' ? 'Correct.' : 'Incorrect.'}</p>}
      {quiz.phase === 'unresolved' && <p className="quiz-result" role="status">The answer result is unavailable. {developer ? <a href="#debug-quiz-result">Debug → Quiz result override</a> : <a href={developerHref} onClick={onOpenDeveloper}>Open developer view</a>} to investigate.</p>}
      {quiz.phase === 'result' && <button className="quiz-continue" type="button" disabled={historyOpen || !inputReady} onKeyDown={buttonKey} onClick={event => { event.stopPropagation(); continueQuiz(); }} data-testid="quiz-continue">Continue</button>}
    </section>
  );
}
