import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LIGHTER_REOPEN_DELAY_MINUTES,
  MAX_LIGHTER_REOPEN_DELAY_MINUTES,
  MIN_LIGHTER_REOPEN_DELAY_MINUTES,
  resolveLocalTimezone
} from '../src/shared/settings';
import { getQuestionBankCoverage } from '../src/shared/questions';
import { buildSnapshot } from '../src/shared/selectors';
import {
  COMPLETED_SESSION_RETENTION_MS,
  createDefaultState,
  hydrateState,
  loadStateFile,
  pruneStateForPersistence,
  saveStateFile,
  serializeState
} from '../src/shared/storage';
import { queueDueSessions } from '../src/shared/schedule';
import { TOPIC_TAGS } from '../src/shared/types';

describe('storage and question coverage', () => {
  it('covers every planned topic tag in the seeded bank', () => {
    expect(getQuestionBankCoverage().sort()).toEqual([...TOPIC_TAGS].sort());
  });

  it('hydrates persisted state without losing overdue sessions', () => {
    const dueState = queueDueSessions(createDefaultState(new Date(2026, 2, 23, 8, 0)), new Date(2026, 2, 23, 11, 1)).state;
    const restored = hydrateState(JSON.parse(serializeState(dueState)));

    expect(restored.activeSessionId).toBe(dueState.activeSessionId);
    expect(restored.sessions).toHaveLength(dueState.sessions.length);
    expect(restored.sessions[0]?.status).toBe('active');
    expect(restored.sessions[1]?.status).toBe('pending');
  });

  it('defaults persisted settings to lighter enforcement and preserves explicit strict mode', () => {
    expect(createDefaultState().settings.enforcementStyle).toBe('lighter');
    expect(createDefaultState().settings.lighterReopenDelayMinutes).toBe(DEFAULT_LIGHTER_REOPEN_DELAY_MINUTES);

    const restored = hydrateState({
      settings: {
        enforcementStyle: 'strict',
        lighterReopenDelayMinutes: 5
      }
    });

    expect(restored.settings.enforcementStyle).toBe('strict');
    expect(restored.settings.lighterReopenDelayMinutes).toBe(5);
  });

  it('clamps lighter reopen delay settings on hydrate', () => {
    const clampedLow = hydrateState({
      settings: {
        lighterReopenDelayMinutes: 0
      }
    });
    const clampedHigh = hydrateState({
      settings: {
        lighterReopenDelayMinutes: 999
      }
    });

    expect(clampedLow.settings.lighterReopenDelayMinutes).toBe(MIN_LIGHTER_REOPEN_DELAY_MINUTES);
    expect(clampedHigh.settings.lighterReopenDelayMinutes).toBe(MAX_LIGHTER_REOPEN_DELAY_MINUTES);
  });

  it('falls back to the local timezone when persisted settings contain an invalid zone', () => {
    const restored = hydrateState({
      settings: {
        timezone: 'Mars/Phobos'
      }
    });

    expect(restored.settings.timezone).toBe(resolveLocalTimezone());
  });

  it('recovers from a corrupt primary state file using the backup copy', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calctrainer-storage-'));
    const filePath = path.join(tempDir, 'calc-trainer-state.json');
    const dueState = queueDueSessions(createDefaultState(new Date(2026, 2, 23, 8, 0)), new Date(2026, 2, 23, 11, 1)).state;

    saveStateFile(filePath, dueState);
    fs.writeFileSync(filePath, '{"broken"', 'utf8');

    const restored = loadStateFile(filePath);
    const archivedFiles = fs.readdirSync(tempDir).filter((fileName) => fileName.includes('.corrupt-'));

    expect(restored.activeSessionId).toBe(dueState.activeSessionId);
    expect(restored.sessions).toHaveLength(dueState.sessions.length);
    expect(archivedFiles).toHaveLength(1);
    expect(fs.existsSync(`${filePath}.bak`)).toBe(true);
  });

  it('returns pruned state even when rewriting the file during load is not permitted', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calctrainer-storage-'));
    const filePath = path.join(tempDir, 'calc-trainer-state.json');
    const now = new Date('2026-03-28T12:00:00.000Z');
    const ancientCompletedAt = new Date(now.getTime() - COMPLETED_SESSION_RETENTION_MS - 24 * 60 * 60 * 1000).toISOString();
    const state = createDefaultState(now);

    state.sessions = [
      {
        id: 'old-done',
        slotId: '2026-03-01T09:00',
        scheduledFor: '2026-03-01T16:00:00.000Z',
        status: 'completed',
        completedAt: ancientCompletedAt,
        minDurationMs: 600_000,
        targetDurationMs: 900_000,
        questions: [{ id: 'q', templateId: 't', title: 't', source: 's', topicTag: 'conv_output_size', difficulty: 'medium', promptType: 'numeric', stem: 'x', workedSolution: 'y', answerSchema: { kind: 'numeric', correctValue: 1, tolerance: 0 } }],
        responses: { q: {} }
      }
    ];

    fs.writeFileSync(filePath, serializeState(state), 'utf8');
    fs.chmodSync(tempDir, 0o555);

    try {
      const loaded = loadStateFile(filePath);
      expect(loaded.sessions).toEqual([]);
    } finally {
      fs.chmodSync(tempDir, 0o755);
    }
  });

  it('builds seven-day history in the configured timezone across DST boundaries', () => {
    const state = createDefaultState(new Date('2026-03-09T07:30:00.000Z'));
    state.settings.timezone = 'America/Los_Angeles';
    state.sessions = [
      {
        id: 'completed-1',
        slotId: '2026-03-08T09:00',
        scheduledFor: '2026-03-08T16:00:00.000Z',
        status: 'completed',
        completedAt: '2026-03-08T18:00:00.000Z',
        minDurationMs: 600_000,
        targetDurationMs: 900_000,
        questions: [],
        responses: {}
      }
    ];

    const snapshot = buildSnapshot(state, new Date('2026-03-09T07:30:00.000Z'));

    expect(snapshot.history.map((entry) => entry.dateKey)).toContain('2026-03-08');
    expect(snapshot.history[snapshot.history.length - 2]?.dateKey).toBe('2026-03-08');
    expect(snapshot.history[snapshot.history.length - 2]?.completed).toBe(1);
    expect(snapshot.history[snapshot.history.length - 1]?.dateKey).toBe('2026-03-09');
  });

  it('prunes completed sessions older than the retention window and strips question payloads from kept completed sessions', () => {
    const now = new Date('2026-03-20T12:00:00.000Z');
    const oldCompletedAt = new Date(now.getTime() - COMPLETED_SESSION_RETENTION_MS - 24 * 60 * 60 * 1000).toISOString();
    const recentCompletedAt = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const state = createDefaultState(now);
    state.sessions = [
      {
        id: 'old-done',
        slotId: '2026-03-01T09:00',
        scheduledFor: '2026-03-01T16:00:00.000Z',
        status: 'completed',
        completedAt: oldCompletedAt,
        minDurationMs: 600_000,
        targetDurationMs: 900_000,
        questions: [{ id: 'q', templateId: 't', title: 't', source: 's', topicTag: 'conv_output_size', difficulty: 'medium', promptType: 'numeric', stem: 'x', workedSolution: 'y', answerSchema: { kind: 'numeric', correctValue: 1, tolerance: 0 } }],
        responses: { q: {} }
      },
      {
        id: 'recent-done',
        slotId: '2026-03-18T09:00',
        scheduledFor: '2026-03-18T16:00:00.000Z',
        status: 'completed',
        completedAt: recentCompletedAt,
        minDurationMs: 600_000,
        targetDurationMs: 900_000,
        questions: [{ id: 'q2', templateId: 't2', title: 't', source: 's', topicTag: 'conv_output_size', difficulty: 'medium', promptType: 'numeric', stem: 'x', workedSolution: 'y', answerSchema: { kind: 'numeric', correctValue: 1, tolerance: 0 } }],
        responses: { q2: { answerText: '1' } }
      }
    ];

    const { next, changed } = pruneStateForPersistence(state, now);
    expect(changed).toBe(true);
    expect(next.sessions).toHaveLength(1);
    expect(next.sessions[0]?.id).toBe('recent-done');
    expect(next.sessions[0]?.questions).toEqual([]);
    expect(next.sessions[0]?.responses).toEqual({});
  });

  it('buildSnapshot slim mode omits active session questions while preserving status fields', () => {
    const dueState = queueDueSessions(createDefaultState(new Date(2026, 2, 23, 8, 0)), new Date(2026, 2, 23, 11, 1)).state;
    const full = buildSnapshot(dueState, new Date(2026, 2, 23, 11, 1), 'full');
    const slim = buildSnapshot(dueState, new Date(2026, 2, 23, 11, 1), 'slim');

    expect(full.activeSession?.questions.length).toBeGreaterThan(0);
    expect(slim.activeSession?.questions).toEqual([]);
    expect(slim.activeSession?.responses).toEqual({});
    expect(slim.activeSessionStatus).toEqual(full.activeSessionStatus);
    expect(slim.schedule).toEqual(full.schedule);
  });
});
