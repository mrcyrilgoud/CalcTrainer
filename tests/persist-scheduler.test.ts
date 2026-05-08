import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDefaultState,
  createStatePersistScheduler,
  loadStateFile
} from '../src/shared/storage';
import {
  createDefaultQuestionBankState,
  createQuestionBankPersistScheduler,
  loadQuestionBankFile
} from '../src/shared/question-bank-storage';

describe('persistence schedulers', () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calctrainer-persist-'));
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('coalesces N rapid state writes into a single disk write within the debounce window', () => {
    const filePath = path.join(tempDir, 'state.json');
    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    const scheduler = createStatePersistScheduler(filePath, { debounceMs: 50 });

    const initialWrites = writeSpy.mock.calls.length;
    for (let index = 0; index < 8; index += 1) {
      scheduler.schedule({
        ...createDefaultState(new Date('2026-05-07T12:00:00Z')),
        createdAt: `2026-05-07T12:00:0${index}.000Z`
      });
    }

    expect(scheduler.pending()).toBe(true);
    expect(writeSpy.mock.calls.length).toBe(initialWrites);

    vi.advanceTimersByTime(60);

    expect(scheduler.pending()).toBe(false);
    // saveStateFile internally writes a temp file then renames; that is exactly one writeFileSync call.
    expect(writeSpy.mock.calls.length).toBe(initialWrites + 1);

    const persisted = loadStateFile(filePath);
    expect(persisted.createdAt).toBe('2026-05-07T12:00:07.000Z');

    writeSpy.mockRestore();
  });

  it('flushes pending state writes synchronously', () => {
    const filePath = path.join(tempDir, 'state.json');
    const scheduler = createStatePersistScheduler(filePath, { debounceMs: 1_000 });

    scheduler.schedule({
      ...createDefaultState(new Date('2026-05-07T12:00:00Z')),
      createdAt: '2026-05-07T12:00:42.000Z'
    });
    expect(scheduler.pending()).toBe(true);

    scheduler.flush();
    expect(scheduler.pending()).toBe(false);
    expect(loadStateFile(filePath).createdAt).toBe('2026-05-07T12:00:42.000Z');
  });

  it('coalesces question-bank writes the same way', () => {
    const filePath = path.join(tempDir, 'question-bank.json');
    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    const scheduler = createQuestionBankPersistScheduler(filePath, { debounceMs: 30 });

    const initialWrites = writeSpy.mock.calls.length;
    const baseState = createDefaultQuestionBankState(new Date('2026-05-07T12:00:00Z'));
    for (let index = 0; index < 5; index += 1) {
      scheduler.schedule({ ...baseState, createdAt: `2026-05-07T12:00:0${index}.000Z` });
    }

    expect(scheduler.pending()).toBe(true);
    expect(writeSpy.mock.calls.length).toBe(initialWrites);

    vi.advanceTimersByTime(40);
    expect(scheduler.pending()).toBe(false);
    expect(writeSpy.mock.calls.length).toBe(initialWrites + 1);
    expect(loadQuestionBankFile(filePath).createdAt).toBe('2026-05-07T12:00:04.000Z');

    writeSpy.mockRestore();
  });

  it('retains pending state and retries when a state write fails', () => {
    const filePath = path.join(tempDir, 'state.json');
    const onError = vi.fn();
    const scheduler = createStatePersistScheduler(filePath, {
      debounceMs: 50,
      retryDelayMs: 200,
      onError
    });

    let shouldFail = true;
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation((...args) => {
      if (shouldFail) {
        throw new Error('disk full');
      }
      // Fall through to real implementation on retry by removing the mock.
      writeSpy.mockRestore();
      return fs.writeFileSync(...(args as Parameters<typeof fs.writeFileSync>));
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    scheduler.schedule({
      ...createDefaultState(new Date('2026-05-07T12:00:00Z')),
      createdAt: '2026-05-07T12:00:01.000Z'
    });

    vi.advanceTimersByTime(60);
    // First attempt failed; pending state retained and an error surfaced.
    expect(scheduler.pending()).toBe(true);
    expect(scheduler.lastError()).toBeInstanceOf(Error);
    expect(onError).toHaveBeenCalledTimes(1);

    // Allow retry to run successfully.
    shouldFail = false;
    vi.advanceTimersByTime(220);

    expect(scheduler.pending()).toBe(false);
    expect(scheduler.lastError()).toBeNull();
    expect(loadStateFile(filePath).createdAt).toBe('2026-05-07T12:00:01.000Z');

    consoleErrorSpy.mockRestore();
  });

  it('does not throw from flush() and keeps pending state when the disk write fails', () => {
    const filePath = path.join(tempDir, 'state.json');
    const scheduler = createStatePersistScheduler(filePath, { debounceMs: 50, retryDelayMs: 5_000 });

    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('readonly fs');
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    scheduler.schedule({
      ...createDefaultState(new Date('2026-05-07T12:00:00Z')),
      createdAt: '2026-05-07T12:00:42.000Z'
    });

    expect(() => scheduler.flush()).not.toThrow();
    expect(scheduler.pending()).toBe(true);
    expect(scheduler.lastError()).toBeInstanceOf(Error);

    writeSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});
