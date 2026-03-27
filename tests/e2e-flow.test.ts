import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { completeSession, recordSelfCheck, revealWorkedSolution, submitAnswer } from '../src/shared/practice';
import { buildSnapshot } from '../src/shared/selectors';
import { queueDueSessions } from '../src/shared/schedule';
import {
  COMPLETED_SESSION_RETENTION_MS,
  createDefaultState,
  hydrateState,
  loadStateFile,
  saveStateFile,
  serializeState
} from '../src/shared/storage';
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

  it('completes the first active session and then the next queued session in one continuous flow', () => {
    const queuedState = queueDueSessions(createDefaultState(makeDate(8, 30)), makeDate(13, 5)).state;
    const first = queuedState.sessions.find((session) => session.id === queuedState.activeSessionId);
    expect(first).toBeDefined();
    if (!first) {
      return;
    }

    const paperQuestion = first.questions.find((question) => question.promptType !== 'derivation');
    expect(paperQuestion).toBeDefined();
    if (!paperQuestion) {
      return;
    }

    const afterFirst = completeSession(
      answerSessionWithMixedPaperAndTyping(queuedState, first, paperQuestion.id, makeDate(13, 7)),
      first.id,
      makeDate(13, 20)
    ).state;

    const second = afterFirst.sessions.find((session) => session.id === afterFirst.activeSessionId);
    expect(second?.id).toBe('2026-03-23T11:00');
    if (!second) {
      return;
    }

    const paper2 = second.questions.find((question) => question.promptType !== 'derivation');
    expect(paper2).toBeDefined();
    if (!paper2) {
      return;
    }

    const answeredSecond = answerSessionWithMixedPaperAndTyping(afterFirst, second, paper2.id, makeDate(13, 22));
    const completion2 = completeSession(answeredSecond, second.id, makeDate(13, 35));

    expect(completion2.completed).toBe(true);
    expect(completion2.state.sessions.find((s) => s.id === second.id)?.status).toBe('completed');

    const snapshot = buildSnapshot(completion2.state, makeDate(13, 35));
    expect(snapshot.completedToday).toBe(2);
    expect(snapshot.schedule.filter((slot) => slot.status === 'completed').length).toBeGreaterThanOrEqual(2);
  });

  it('saveStateFile plus loadStateFile preserves an in-progress session and prunes stale completed rows', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calctrainer-e2e-'));
    const filePath = path.join(tempDir, 'calc-trainer-state.json');
    const now = new Date('2026-03-20T12:00:00.000Z');

    let state = queueDueSessions(createDefaultState(now), now).state;
    const active = state.sessions.find((session) => session.id === state.activeSessionId);
    expect(active).toBeDefined();
    if (!active) {
      return;
    }

    const paper = active.questions.find((question) => question.promptType !== 'derivation');
    expect(paper).toBeDefined();
    if (!paper) {
      return;
    }

    state = answerSessionWithMixedPaperAndTyping(state, active, paper.id, now);
    state = completeSession(state, active.id, new Date(now.getTime() + 15 * 60_000)).state;

    const ancientCompletedAt = new Date(now.getTime() - COMPLETED_SESSION_RETENTION_MS - 48 * 60 * 60 * 1000).toISOString();
    state = {
      ...state,
      sessions: [
        ...state.sessions,
        {
          id: 'stale-slot',
          slotId: '2026-02-01T09:00',
          scheduledFor: '2026-02-01T17:00:00.000Z',
          status: 'completed' as const,
          completedAt: ancientCompletedAt,
          minDurationMs: 600_000,
          targetDurationMs: 900_000,
          questions: [],
          responses: {}
        }
      ]
    };

    saveStateFile(filePath, state);
    const loaded = loadStateFile(filePath);

    expect(loaded.sessions.some((session) => session.id === 'stale-slot')).toBe(false);
    const reloadedActive = loaded.sessions.find((session) => session.id === loaded.activeSessionId);
    expect(reloadedActive?.status).toBe('active');
    expect(reloadedActive?.questions.length).toBeGreaterThan(0);

    const snap = buildSnapshot(loaded, now);
    expect(snap.pendingCount).toBeGreaterThan(0);
  });

  it('slim snapshot matches full snapshot except active session question payload', () => {
    const queuedState = queueDueSessions(createDefaultState(makeDate(8, 30)), makeDate(13, 5)).state;
    const now = makeDate(13, 5);
    const full = buildSnapshot(queuedState, now, 'full');
    const slim = buildSnapshot(queuedState, now, 'slim');

    expect(full.activeSession?.questions.length).toBeGreaterThan(0);
    expect(slim.activeSession?.questions).toEqual([]);
    expect(slim.activeSession?.responses).toEqual({});
    expect(slim.activeSessionStatus).toEqual(full.activeSessionStatus);
    expect(slim.schedule).toEqual(full.schedule);
    expect(slim.history).toEqual(full.history);
    expect(slim.settings).toEqual(full.settings);
  });
});
