import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LIGHTER_REOPEN_DELAY_MINUTES,
  MAX_LIGHTER_REOPEN_DELAY_MINUTES,
  MIN_LIGHTER_REOPEN_DELAY_MINUTES
} from '../src/shared/settings';
import { getQuestionBankCoverage } from '../src/shared/questions';
import { createDefaultState, hydrateState, loadStateFile, saveStateFile, serializeState } from '../src/shared/storage';
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
});
