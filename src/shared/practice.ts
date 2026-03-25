import { createDefaultSettings } from './settings';
import { generateQuestionsForSession } from './questions';
import {
  ActiveSessionStatus,
  AppState,
  AttemptEvaluation,
  PracticeSession,
  Question,
  QuestionProgress,
  SelfCheckRating,
  TopicTag
} from './types';

function cloneState(state: AppState): AppState {
  return {
    ...state,
    settings: {
      ...state.settings,
      activeHours: { ...state.settings.activeHours }
    },
    sessions: state.sessions.map((session) => ({
      ...session,
      questions: session.questions.map((question) => ({ ...question })),
      responses: Object.fromEntries(
        Object.entries(session.responses).map(([questionId, progress]) => [questionId, { ...progress }])
      )
    })),
    weakTopicScores: { ...state.weakTopicScores }
  };
}

function normalizeStructuredAnswer(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[\[\]]/g, '')
    .replace(/[{}]/g, '')
    .replace(/\u03c3/g, 'sigma')
    .replace(/\u00d7/g, '*');
}

function getExpectedAnswerLabel(question: Question): string | undefined {
  switch (question.answerSchema.kind) {
    case 'multiple_choice':
      return question.answerSchema.options[question.answerSchema.correctIndex];
    case 'numeric':
      return String(question.answerSchema.correctValue);
    case 'structured':
      return question.answerSchema.acceptableAnswers[0];
    case 'derivation':
      return undefined;
  }
}

function weakSignalFromSelfCheck(rating: SelfCheckRating): number {
  return rating === 'needs_work' ? 2 : -1;
}

function getProgressWeakSignal(progress: QuestionProgress): number {
  if (progress.evaluation) {
    return progress.evaluation.weakTopicSignal;
  }
  if (progress.selfCheck) {
    return weakSignalFromSelfCheck(progress.selfCheck);
  }
  return 0;
}

function adjustWeakTopicScore(
  scores: Record<TopicTag, number>,
  topicTag: TopicTag,
  previousSignal: number,
  nextSignal: number
): Record<TopicTag, number> {
  return {
    ...scores,
    [topicTag]: Math.max(0, (scores[topicTag] ?? 0) - previousSignal + nextSignal)
  };
}

function getQuestionProgress(session: PracticeSession, questionId: string): QuestionProgress {
  return session.responses[questionId] ?? {};
}

export function findSession(state: AppState, sessionId: string): PracticeSession | undefined {
  return state.sessions.find((session) => session.id === sessionId);
}

export function getActiveSession(state: AppState): PracticeSession | null {
  if (!state.activeSessionId) {
    return null;
  }
  return state.sessions.find((session) => session.id === state.activeSessionId) ?? null;
}

export function createPracticeSession(state: AppState, slotId: string, scheduledFor: string): PracticeSession {
  const settings = state.settings ?? createDefaultSettings();
  const questions = generateQuestionsForSession(state, slotId);
  const responses = Object.fromEntries(questions.map((question) => [question.id, {}]));
  return {
    id: slotId,
    slotId,
    scheduledFor,
    status: 'pending',
    minDurationMs: settings.minimumSessionMinutes * 60_000,
    targetDurationMs: settings.targetSessionMinutes * 60_000,
    questions,
    responses
  };
}

export function activateNextPendingSession(
  state: AppState,
  now: Date
): { state: AppState; activatedSessionId?: string } {
  const workingState = cloneState(state);
  const alreadyActive = getActiveSession(workingState);
  if (alreadyActive) {
    return { state: workingState };
  }

  const pendingSession = [...workingState.sessions]
    .filter((session) => session.status === 'pending')
    .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor))[0];

  if (!pendingSession) {
    workingState.activeSessionId = undefined;
    return { state: workingState };
  }

  pendingSession.status = 'active';
  pendingSession.startedAt = pendingSession.startedAt ?? now.toISOString();
  workingState.activeSessionId = pendingSession.id;
  return {
    state: workingState,
    activatedSessionId: pendingSession.id
  };
}

export function markSessionPrompted(state: AppState, sessionId: string, now: Date): AppState {
  const workingState = cloneState(state);
  const session = findSession(workingState, sessionId);
  if (!session) {
    return workingState;
  }
  session.lastPromptedAt = now.toISOString();
  return workingState;
}

export function evaluateAnswer(question: Question, answerText: string, submittedAt: Date): AttemptEvaluation {
  switch (question.answerSchema.kind) {
    case 'multiple_choice': {
      const numericAnswer = Number.parseInt(answerText, 10);
      const correct = numericAnswer === question.answerSchema.correctIndex;
      return {
        correct,
        feedback: correct
          ? 'Correct. That matches the lecture rule.'
          : 'Incorrect. Review the worked solution and the lecture summary for this concept.',
        expected: getExpectedAnswerLabel(question),
        weakTopicSignal: correct ? -1 : 2,
        submittedAt: submittedAt.toISOString()
      };
    }
    case 'numeric': {
      const numericAnswer = Number.parseFloat(answerText);
      const correct = Number.isFinite(numericAnswer)
        && Math.abs(numericAnswer - question.answerSchema.correctValue) <= question.answerSchema.tolerance;
      return {
        correct,
        feedback: Number.isFinite(numericAnswer)
          ? correct
            ? 'Correct. The arithmetic is consistent with the lecture formula.'
            : 'Incorrect. Re-run the size or parameter-count calculation carefully.'
          : 'Enter a numeric value.',
        expected: getExpectedAnswerLabel(question),
        weakTopicSignal: correct ? -1 : 2,
        submittedAt: submittedAt.toISOString()
      };
    }
    case 'structured': {
      const normalizedAnswer = normalizeStructuredAnswer(answerText);
      const acceptableAnswers = question.answerSchema.acceptableAnswers.map(normalizeStructuredAnswer);
      const correct = acceptableAnswers.includes(normalizedAnswer);
      return {
        correct,
        feedback: correct
          ? 'Correct. That matches the compact form used in the lectures.'
          : 'Incorrect. Use the lecture notation and keep only the essential factors.',
        expected: getExpectedAnswerLabel(question),
        weakTopicSignal: correct ? -1 : 2,
        submittedAt: submittedAt.toISOString()
      };
    }
    case 'derivation': {
      return {
        correct: false,
        feedback: 'Reveal the worked solution, then self-check the derivation against the checklist.',
        weakTopicSignal: 0,
        submittedAt: submittedAt.toISOString()
      };
    }
  }
}

export function submitAnswer(
  state: AppState,
  sessionId: string,
  questionId: string,
  answerText: string,
  now: Date
): { state: AppState; evaluation?: AttemptEvaluation } {
  const workingState = cloneState(state);
  const session = findSession(workingState, sessionId);
  if (!session) {
    return { state: workingState };
  }

  const question = session.questions.find((candidate) => candidate.id === questionId);
  if (!question || question.promptType === 'derivation') {
    return { state: workingState };
  }

  const previousProgress = getQuestionProgress(session, questionId);
  const evaluation = evaluateAnswer(question, answerText, now);
  const previousSignal = getProgressWeakSignal(previousProgress);

  session.responses[questionId] = {
    ...previousProgress,
    answerText,
    evaluation,
    selfCheck: undefined
  };
  workingState.weakTopicScores = adjustWeakTopicScore(
    workingState.weakTopicScores,
    question.topicTag,
    previousSignal,
    evaluation.weakTopicSignal
  );

  return {
    state: workingState,
    evaluation
  };
}

export function revealWorkedSolution(
  state: AppState,
  sessionId: string,
  questionId: string,
  now: Date
): AppState {
  const workingState = cloneState(state);
  const session = findSession(workingState, sessionId);
  if (!session) {
    return workingState;
  }

  const question = session.questions.find((candidate) => candidate.id === questionId);
  if (!question) {
    return workingState;
  }

  const previousProgress = getQuestionProgress(session, questionId);
  session.responses[questionId] = {
    ...previousProgress,
    revealedSolutionAt: now.toISOString()
  };
  return workingState;
}

export function recordSelfCheck(
  state: AppState,
  sessionId: string,
  questionId: string,
  rating: SelfCheckRating
): AppState {
  const workingState = cloneState(state);
  const session = findSession(workingState, sessionId);
  if (!session) {
    return workingState;
  }

  const question = session.questions.find((candidate) => candidate.id === questionId);
  if (!question) {
    return workingState;
  }

  const previousProgress = getQuestionProgress(session, questionId);
  if (!previousProgress.revealedSolutionAt) {
    return workingState;
  }

  const previousSignal = getProgressWeakSignal(previousProgress);
  const nextSignal = weakSignalFromSelfCheck(rating);

  session.responses[questionId] = {
    ...previousProgress,
    selfCheck: rating
  };
  workingState.weakTopicScores = adjustWeakTopicScore(
    workingState.weakTopicScores,
    question.topicTag,
    previousSignal,
    nextSignal
  );
  return workingState;
}

export function isQuestionComplete(session: PracticeSession, questionId: string): boolean {
  const question = session.questions.find((candidate) => candidate.id === questionId);
  if (!question) {
    return false;
  }
  const progress = getQuestionProgress(session, questionId);
  return Boolean(progress.evaluation || (progress.revealedSolutionAt && progress.selfCheck));
}

export function getActiveSessionStatus(session: PracticeSession, now: Date): ActiveSessionStatus {
  const answeredCount = session.questions.filter((question) => isQuestionComplete(session, question.id)).length;
  const totalQuestions = session.questions.length;
  const elapsedMs = session.startedAt ? Math.max(0, now.getTime() - new Date(session.startedAt).getTime()) : 0;
  const remainingMs = Math.max(0, session.minDurationMs - elapsedMs);
  const minDurationMet = remainingMs === 0;
  const canComplete = minDurationMet && answeredCount === totalQuestions;

  return {
    answeredCount,
    totalQuestions,
    minDurationMet,
    remainingMs,
    canComplete
  };
}

export function completeSession(
  state: AppState,
  sessionId: string,
  now: Date
): { state: AppState; completed: boolean; reason?: string; activatedSessionId?: string } {
  const workingState = cloneState(state);
  const session = findSession(workingState, sessionId);
  if (!session) {
    return {
      state: workingState,
      completed: false,
      reason: 'Session not found.'
    };
  }

  const status = getActiveSessionStatus(session, now);
  if (!status.canComplete) {
    return {
      state: workingState,
      completed: false,
      reason: status.minDurationMet
        ? 'Finish every question before ending the session.'
        : 'The 10-minute minimum has not elapsed yet.'
    };
  }

  session.status = 'completed';
  session.completedAt = now.toISOString();
  if (workingState.activeSessionId === sessionId) {
    workingState.activeSessionId = undefined;
  }

  const activation = activateNextPendingSession(workingState, now);
  return {
    state: activation.state,
    completed: true,
    activatedSessionId: activation.activatedSessionId
  };
}
