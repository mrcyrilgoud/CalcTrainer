import { describe, expect, it } from 'vitest';

import { completeSession, getActiveSessionStatus, recordSelfCheck, revealWorkedSolution, submitAnswer } from '../src/shared/practice';
import { queueDueSessions } from '../src/shared/schedule';
import { createDefaultState } from '../src/shared/storage';
import { Question } from '../src/shared/types';

function makeDate(hour: number, minute = 0): Date {
  return new Date(2026, 2, 23, hour, minute, 0, 0);
}

function correctAnswerText(question: Question): string {
  switch (question.answerSchema.kind) {
    case 'multiple_choice':
      return String(question.answerSchema.correctIndex);
    case 'numeric':
      return String(question.answerSchema.correctValue);
    case 'structured':
      return question.answerSchema.acceptableAnswers[0] ?? '';
    case 'derivation':
      return '';
  }
}

describe('practice session completion', () => {
  it('blocks completion until both timer and question requirements are met', () => {
    const seeded = queueDueSessions(createDefaultState(makeDate(8, 30)), makeDate(9, 5)).state;
    const activeSession = seeded.sessions.find((session) => session.id === seeded.activeSessionId);
    expect(activeSession).toBeDefined();
    if (!activeSession) {
      return;
    }

    let workingState = seeded;
    for (const question of activeSession.questions) {
      if (question.promptType === 'derivation') {
        workingState = revealWorkedSolution(workingState, activeSession.id, question.id, makeDate(9, 7));
        workingState = recordSelfCheck(workingState, activeSession.id, question.id, 'solid');
      } else {
        workingState = submitAnswer(
          workingState,
          activeSession.id,
          question.id,
          correctAnswerText(question),
          makeDate(9, 7)
        ).state;
      }
    }

    const earlyCompletion = completeSession(workingState, activeSession.id, makeDate(9, 8));
    expect(earlyCompletion.completed).toBe(false);
    expect(earlyCompletion.reason).toContain('10-minute');

    const finalCompletion = completeSession(workingState, activeSession.id, makeDate(9, 16));
    expect(finalCompletion.completed).toBe(true);
    expect(finalCompletion.state.sessions.find((session) => session.id === activeSession.id)?.status).toBe('completed');
  });

  it('lets an auto-graded question be completed through the paper-review path', () => {
    const seeded = queueDueSessions(createDefaultState(makeDate(8, 30)), makeDate(9, 5)).state;
    const activeSession = seeded.sessions.find((session) => session.id === seeded.activeSessionId);
    expect(activeSession).toBeDefined();
    if (!activeSession) {
      return;
    }

    const paperQuestion = activeSession.questions.find((question) => question.promptType !== 'derivation');
    expect(paperQuestion).toBeDefined();
    if (!paperQuestion) {
      return;
    }

    let workingState = revealWorkedSolution(seeded, activeSession.id, paperQuestion.id, makeDate(9, 6));
    workingState = recordSelfCheck(workingState, activeSession.id, paperQuestion.id, 'needs_work');

    const updatedSession = workingState.sessions.find((session) => session.id === activeSession.id);
    expect(updatedSession).toBeDefined();
    if (!updatedSession) {
      return;
    }

    const status = getActiveSessionStatus(updatedSession, makeDate(9, 6));
    expect(status.answeredCount).toBe(1);
    expect(workingState.weakTopicScores[paperQuestion.topicTag]).toBe(2);
  });

  it('only replaces the active session branch when submitting an answer', () => {
    const seeded = queueDueSessions(createDefaultState(makeDate(8, 30)), makeDate(11, 5)).state;
    const activeSession = seeded.sessions.find((session) => session.id === seeded.activeSessionId);
    const queuedSession = seeded.sessions.find((session) => session.status === 'pending');

    expect(activeSession).toBeDefined();
    expect(queuedSession).toBeDefined();
    if (!activeSession || !queuedSession) {
      return;
    }

    const answerableQuestion = activeSession.questions.find((question) => question.promptType !== 'derivation');
    expect(answerableQuestion).toBeDefined();
    if (!answerableQuestion) {
      return;
    }

    const result = submitAnswer(
      seeded,
      activeSession.id,
      answerableQuestion.id,
      correctAnswerText(answerableQuestion),
      makeDate(11, 6)
    );

    expect(result.state).not.toBe(seeded);
    expect(result.state.settings).toBe(seeded.settings);
    expect(result.state.sessions.find((session) => session.id === queuedSession.id)).toBe(queuedSession);
  });
});
