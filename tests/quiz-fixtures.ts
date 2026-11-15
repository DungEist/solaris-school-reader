import type { QuizDefinition } from '../src/engine/Quiz.ts';
import type { StageOp } from '../src/engine/types.ts';

export const quizImage = '/Game/Aki/UI/UIResources/UiActivity/Image/Activity38/SolarSchool/IconExam/T_IconSolarSchoolExam2001.T_IconSolarSchoolExam2001';

export function quizFixture({ id = 1, actionId = 7003, illustration = quizImage, answers = [
  { id: 21, textKey: 'answer-yes', correct: false },
  { id: 8, textKey: 'answer-no', correct: true },
  { id: 45, textKey: 'answer-other', correct: false },
] }: { id?: number; actionId?: number; illustration?: string | null; answers?: readonly { id: number; textKey: string; correct: boolean | null }[] } = {}): QuizDefinition {
  return {
    id, actionId, titleKey: 'quiz-title', questionKey: 'quiz-question', illustration,
    answers: answers.map(answer => ({ ...answer, raw: { Id: answer.id, GroupId: id, TextKey: answer.textKey, ...(typeof answer.correct === 'boolean' ? { IsCorrect: answer.correct } : {}) } })),
    addScore: 1, resultHoldMs: 1500,
    raw: {
      question: { Id: id, ChoiceGroupId: id, Title: 'quiz-title', Desc: 'quiz-question', Image: illustration, AddScore: 1 },
      action: { Id: actionId, ActionType: 8, ActionParams: [{ Key: 'Id', Value: String(id) }], Priority: 0 },
      actionType: { Id: 8, TypeName: '第二索拉考试选项' },
      resultParameters: [{ Key: 'ExamResultHoldDuration', IntValue: 1500 }],
    },
  };
}

export function quizOperation(quiz = quizFixture(), overrides: Partial<StageOp> = {}): StageOp {
  return {
    op: 'activityAction', kind: 'SolarSchool', actionId: quiz.actionId, t: 0, quiz,
    raw: { Type: 'ActivityAction', StartTime: overrides.t ?? 0, ActivityActionConfig: { Type: 'SolarSchool', SolarSchoolActionId: quiz.actionId } },
    ...overrides,
  };
}
