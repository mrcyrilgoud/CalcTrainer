import { createDefaultSettings } from './settings';
import { generateQuestionsForSession } from './questions';
import {
  ActiveSessionStatus,
  AppState,
  AttemptEvaluation,
  PracticeSession,
  QuestionBankState,
  Question,
  QuestionProgress,
  SelfCheckRating
} from './types';

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

function getQuestionProgress(session: PracticeSession, questionId: string): QuestionProgress {
  return session.responses[questionId] ?? {};
}

function findSessionIndex(state: AppState, sessionId: string): number {
  return state.sessions.findIndex((session) => session.id === sessionId);
}

function replaceSession(state: AppState, sessionIndex: number, session: PracticeSession): AppState {
  const nextSessions = state.sessions.slice();
  nextSessions[sessionIndex] = session;
  return {
    ...state,
    sessions: nextSessions
  };
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

export function createPracticeSession(
  state: AppState,
  slotId: string,
  scheduledFor: string,
  questionBankState?: QuestionBankState
): PracticeSession {
  const settings = state.settings ?? createDefaultSettings();
  const questions = generateQuestionsForSession(state, slotId, questionBankState);
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
  const alreadyActive = getActiveSession(state);
  if (alreadyActive) {
    return { state };
  }

  let pendingSessionIndex = -1;
  let pendingSession: PracticeSession | undefined;
  for (let index = 0; index < state.sessions.length; index += 1) {
    const session = state.sessions[index];
    if (session?.status !== 'pending') {
      continue;
    }

    if (!pendingSession || session.scheduledFor < pendingSession.scheduledFor) {
      pendingSession = session;
      pendingSessionIndex = index;
    }
  }

  if (!pendingSession) {
    if (!state.activeSessionId) {
      return { state };
    }
    return {
      state: {
        ...state,
        activeSessionId: undefined
      }
    };
  }

  const updatedSession: PracticeSession = {
    ...pendingSession,
    status: 'active',
    startedAt: pendingSession.startedAt ?? now.toISOString()
  };
  const nextState = {
    ...replaceSession(state, pendingSessionIndex, updatedSession),
    activeSessionId: pendingSession.id
  };
  return {
    state: nextState,
    activatedSessionId: pendingSession.id
  };
}

export function markSessionPrompted(state: AppState, sessionId: string, now: Date): AppState {
  const sessionIndex = findSessionIndex(state, sessionId);
  if (sessionIndex < 0) {
    return state;
  }

  const session = state.sessions[sessionIndex];
  if (!session) {
    return state;
  }

  return replaceSession(state, sessionIndex, {
    ...session,
    lastPromptedAt: now.toISOString()
  });
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
  const sessionIndex = findSessionIndex(state, sessionId);
  if (sessionIndex < 0) {
    return { state };
  }

  const session = state.sessions[sessionIndex];
  if (!session) {
    return { state };
  }
  const question = session.questions.find((candidate) => candidate.id === questionId);
  if (!question || question.promptType === 'derivation') {
    return { state };
  }

  const previousProgress = getQuestionProgress(session, questionId);
  const evaluation = evaluateAnswer(question, answerText, now);
  const previousSignal = getProgressWeakSignal(previousProgress);
  const nextSignal = evaluation.weakTopicSignal;
  const weakTopicKey = question.topicId ?? question.topicTag;
  const nextScore = Math.max(0, (state.weakTopicScores[weakTopicKey] ?? 0) - previousSignal + nextSignal);

  const updatedSession: PracticeSession = {
    ...session,
    responses: {
      ...session.responses,
      [questionId]: {
        ...previousProgress,
        answerText,
        evaluation,
        selfCheck: undefined
      }
    }
  };

  const nextStateBase = replaceSession(state, sessionIndex, updatedSession);
  const nextState = nextScore === (state.weakTopicScores[weakTopicKey] ?? 0)
    ? nextStateBase
    : {
        ...nextStateBase,
        weakTopicScores: {
          ...state.weakTopicScores,
          [weakTopicKey]: nextScore
        }
      };

  return {
    state: nextState,
    evaluation
  };
}

export function revealWorkedSolution(
  state: AppState,
  sessionId: string,
  questionId: string,
  now: Date
): AppState {
  const sessionIndex = findSessionIndex(state, sessionId);
  if (sessionIndex < 0) {
    return state;
  }

  const session = state.sessions[sessionIndex];
  if (!session) {
    return state;
  }
  const question = session.questions.find((candidate) => candidate.id === questionId);
  if (!question) {
    return state;
  }

  const previousProgress = getQuestionProgress(session, questionId);
  return replaceSession(state, sessionIndex, {
    ...session,
    responses: {
      ...session.responses,
      [questionId]: {
        ...previousProgress,
        revealedSolutionAt: now.toISOString()
      }
    }
  });
}

export function recordSelfCheck(
  state: AppState,
  sessionId: string,
  questionId: string,
  rating: SelfCheckRating
): AppState {
  const sessionIndex = findSessionIndex(state, sessionId);
  if (sessionIndex < 0) {
    return state;
  }

  const session = state.sessions[sessionIndex];
  if (!session) {
    return state;
  }
  const question = session.questions.find((candidate) => candidate.id === questionId);
  if (!question) {
    return state;
  }

  const previousProgress = getQuestionProgress(session, questionId);
  if (!previousProgress.revealedSolutionAt) {
    return state;
  }

  if (previousProgress.selfCheck === rating) {
    return state;
  }

  const previousSignal = getProgressWeakSignal(previousProgress);
  const nextSignal = weakSignalFromSelfCheck(rating);
  const weakTopicKey = question.topicId ?? question.topicTag;
  const nextScore = Math.max(0, (state.weakTopicScores[weakTopicKey] ?? 0) - previousSignal + nextSignal);

  const updatedSession: PracticeSession = {
    ...session,
    responses: {
      ...session.responses,
      [questionId]: {
        ...previousProgress,
        selfCheck: rating
      }
    }
  };
  const nextStateBase = replaceSession(state, sessionIndex, updatedSession);
  return nextScore === (state.weakTopicScores[weakTopicKey] ?? 0)
    ? nextStateBase
    : {
        ...nextStateBase,
        weakTopicScores: {
          ...state.weakTopicScores,
          [weakTopicKey]: nextScore
        }
      };
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
  const sessionIndex = findSessionIndex(state, sessionId);
  if (sessionIndex < 0) {
    return {
      state,
      completed: false,
      reason: 'Session not found.'
    };
  }

  const session = state.sessions[sessionIndex];
  if (!session) {
    return {
      state,
      completed: false,
      reason: 'Session not found.'
    };
  }

  const status = getActiveSessionStatus(session, now);
  if (!status.canComplete) {
    return {
      state,
      completed: false,
      reason: status.minDurationMet
        ? 'Finish every question before ending the session.'
        : 'The 10-minute minimum has not elapsed yet.'
    };
  }

  const nextState = replaceSession(state, sessionIndex, {
    ...session,
    status: 'completed',
    completedAt: now.toISOString()
  });
  const completedState = nextState.activeSessionId === sessionId
    ? {
        ...nextState,
        activeSessionId: undefined
      }
    : nextState;

  const activation = activateNextPendingSession(completedState, now);
  return {
    state: activation.state,
    completed: true,
    activatedSessionId: activation.activatedSessionId
  };
}
