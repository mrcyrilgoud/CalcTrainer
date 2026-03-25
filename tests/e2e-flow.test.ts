import { describe, expect, it } from 'vitest';

import { completeSession, recordSelfCheck, revealWorkedSolution, submitAnswer } from '../src/shared/practice';
import { buildSnapshot } from '../src/shared/selectors';
import { queueDueSessions } from '../src/shared/schedule';
import { createDefaultState, hydrateState, serializeState } from '../src/shared/storage';
import { PracticeSession, Question } from '../src/shared/types';

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

function answerSessionWithMixedPaperAndTyping(
  state: ReturnType<typeof createDefaultState>,
  session: PracticeSession,
  paperQuestionId: string,
  now: Date
) {
  let workingState = state;

  for (const question of session.questions) {
    if (question.id === paperQuestionId) {
      workingState = revealWorkedSolution(workingState, session.id, question.id, now);
      workingState = recordSelfCheck(workingState, session.id, question.id, 'solid');
      continue;
    }

    if (question.promptType === 'derivation') {
      workingState = revealWorkedSolution(workingState, session.id, question.id, now);
      workingState = recordSelfCheck(workingState, session.id, question.id, 'solid');
      continue;
    }

    workingState = submitAnswer(workingState, session.id, question.id, correctAnswerText(question), now).state;
  }

  return workingState;
}

describe('end-to-end practice flow', () => {
  it('completes one overdue session, activates the next queued session, and preserves the result through persistence', () => {
    const queuedState = queueDueSessions(createDefaultState(makeDate(8, 30)), makeDate(13, 5)).state;
    const activeSession = queuedState.sessions.find((session) => session.id === queuedState.activeSessionId);
    expect(activeSession).toBeDefined();
    if (!activeSession) {
      return;
    }

    const paperQuestion = activeSession.questions.find((question) => question.promptType !== 'derivation');
    expect(paperQuestion).toBeDefined();
    if (!paperQuestion) {
      return;
    }

    const answeredState = answerSessionWithMixedPaperAndTyping(queuedState, activeSession, paperQuestion.id, makeDate(13, 7));
    const completion = completeSession(answeredState, activeSession.id, makeDate(13, 20));

    expect(completion.completed).toBe(true);
    expect(completion.activatedSessionId).toBe('2026-03-23T11:00');

    const completedSession = completion.state.sessions.find((session) => session.id === activeSession.id);
    const nextSession = completion.state.sessions.find((session) => session.id === '2026-03-23T11:00');
    expect(completedSession?.status).toBe('completed');
    expect(nextSession?.status).toBe('active');

    const snapshot = buildSnapshot(completion.state, makeDate(13, 20));
    expect(snapshot.completedToday).toBe(1);
    expect(snapshot.pendingCount).toBe(2);
    expect(snapshot.schedule.map((slot) => [slot.slotId, slot.status])).toEqual([
      ['2026-03-23T09:00', 'completed'],
      ['2026-03-23T11:00', 'active'],
      ['2026-03-23T13:00', 'queued'],
      ['2026-03-23T15:00', 'upcoming'],
      ['2026-03-23T17:00', 'upcoming'],
      ['2026-03-23T19:00', 'upcoming']
    ]);
    expect(snapshot.overdueSummary).toContain('11:00 AM');
    expect(snapshot.overdueSummary).toContain('Minimum timer remaining: 10m.');

    const restored = hydrateState(JSON.parse(serializeState(completion.state)));
    const restoredSnapshot = buildSnapshot(restored, makeDate(13, 20));
    expect(restoredSnapshot.completedToday).toBe(1);
    expect(restoredSnapshot.pendingCount).toBe(2);
    expect(restoredSnapshot.activeSession?.id).toBe('2026-03-23T11:00');
  });

  it('does not count paper review until the self-check is recorded, and a later typed answer overrides that weak-topic signal', () => {
    const queuedState = queueDueSessions(createDefaultState(makeDate(8, 30)), makeDate(9, 5)).state;
    const activeSession = queuedState.sessions.find((session) => session.id === queuedState.activeSessionId);
    expect(activeSession).toBeDefined();
    if (!activeSession) {
      return;
    }

    const paperQuestion = activeSession.questions.find((question) => question.promptType !== 'derivation');
    expect(paperQuestion).toBeDefined();
    if (!paperQuestion) {
      return;
    }

    const revealedState = revealWorkedSolution(queuedState, activeSession.id, paperQuestion.id, makeDate(9, 6));
    const revealedSnapshot = buildSnapshot(revealedState, makeDate(9, 6));
    expect(revealedSnapshot.activeSessionStatus?.answeredCount).toBe(0);

    const paperRatedState = recordSelfCheck(revealedState, activeSession.id, paperQuestion.id, 'needs_work');
    const paperRatedSnapshot = buildSnapshot(paperRatedState, makeDate(9, 6));
    expect(paperRatedSnapshot.activeSessionStatus?.answeredCount).toBe(1);
    expect(paperRatedState.weakTopicScores[paperQuestion.topicTag]).toBe(2);

    const typedState = submitAnswer(
      paperRatedState,
      activeSession.id,
      paperQuestion.id,
      correctAnswerText(paperQuestion),
      makeDate(9, 7)
    ).state;
    const typedSnapshot = buildSnapshot(typedState, makeDate(9, 7));
    expect(typedSnapshot.activeSessionStatus?.answeredCount).toBe(1);
    expect(typedState.weakTopicScores[paperQuestion.topicTag]).toBe(0);
  });
});
