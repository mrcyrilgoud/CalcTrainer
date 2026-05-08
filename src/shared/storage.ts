import fs from 'node:fs';
import path from 'node:path';

import { createDefaultSettings, sanitizeSettings } from './settings';
import { AppState, PracticeSession, Question, SEEDED_TOPIC_LABELS, TOPIC_TAGS } from './types';

/** Completed sessions older than this are dropped from persisted state. */
export const COMPLETED_SESSION_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

function createEmptyWeakTopicScores(): Record<string, number> {
  return Object.fromEntries(TOPIC_TAGS.map((topicTag) => [topicTag, 0]));
}

function hydrateQuestion(rawQuestion: Partial<Question>): Question | null {
  if (!rawQuestion.id || !rawQuestion.title || !rawQuestion.source || !rawQuestion.promptType || !rawQuestion.stem || !rawQuestion.workedSolution || !rawQuestion.answerSchema) {
    return null;
  }

  const topicTag = rawQuestion.topicId ?? rawQuestion.topicTag ?? 'generated_topic';
  const topicLabel =
    rawQuestion.topicLabel
    ?? SEEDED_TOPIC_LABELS[topicTag as keyof typeof SEEDED_TOPIC_LABELS]
    ?? topicTag.replace(/_/g, ' ');

  return {
    ...rawQuestion,
    bankQuestionId: rawQuestion.bankQuestionId ?? rawQuestion.templateId ?? rawQuestion.id,
    origin: rawQuestion.origin === 'generated' ? 'generated' : 'seeded',
    templateId: rawQuestion.templateId ?? rawQuestion.bankQuestionId ?? rawQuestion.id,
    topicId: topicTag,
    topicTag,
    topicLabel
  } as Question;
}

function getBackupFilePath(filePath: string): string {
  return `${filePath}.bak`;
}

function getCorruptFilePath(filePath: string): string {
  return `${filePath}.corrupt-${Date.now()}`;
}

function hydrateSession(rawSession: Partial<PracticeSession>): PracticeSession | null {
  if (!rawSession.id || !rawSession.slotId || !rawSession.scheduledFor || !rawSession.questions) {
    return null;
  }

  const responses = rawSession.responses && typeof rawSession.responses === 'object' ? rawSession.responses : {};
  return {
    id: rawSession.id,
    slotId: rawSession.slotId,
    scheduledFor: rawSession.scheduledFor,
    status: rawSession.status === 'completed' || rawSession.status === 'active' ? rawSession.status : 'pending',
    startedAt: rawSession.startedAt,
    completedAt: rawSession.completedAt,
    lastPromptedAt: rawSession.lastPromptedAt,
    minDurationMs: rawSession.minDurationMs ?? createDefaultSettings().minimumSessionMinutes * 60_000,
    targetDurationMs: rawSession.targetDurationMs ?? createDefaultSettings().targetSessionMinutes * 60_000,
    questions: Array.isArray(rawSession.questions)
      ? rawSession.questions.map((question) => hydrateQuestion(question)).filter((question): question is Question => question !== null)
      : [],
    responses: responses as PracticeSession['responses']
  };
}

/**
 * Drops old completed sessions and strips question payloads from retained completed
 * sessions to shrink on-disk state. Pending/active sessions are unchanged.
 */
export function pruneStateForPersistence(state: AppState, now: Date): { next: AppState; changed: boolean } {
  const cutoff = now.getTime() - COMPLETED_SESSION_RETENTION_MS;
  let changed = false;

  const nextSessions = state.sessions
    .filter((session) => {
      if (session.status !== 'completed') {
        return true;
      }
      const completedMs = new Date(session.completedAt ?? session.scheduledFor).getTime();
      if (completedMs < cutoff) {
        changed = true;
        return false;
      }
      return true;
    })
    .map((session) => {
      if (session.status !== 'completed') {
        return session;
      }
      if (session.questions.length === 0 && Object.keys(session.responses).length === 0) {
        return session;
      }
      changed = true;
      return {
        ...session,
        questions: [],
        responses: {}
      };
    });

  let activeSessionId = state.activeSessionId;
  if (activeSessionId && !nextSessions.some((session) => session.id === activeSessionId)) {
    activeSessionId = undefined;
    changed = true;
  }

  if (!changed) {
    return { next: state, changed: false };
  }

  return {
    next: {
      ...state,
      sessions: nextSessions,
      activeSessionId
    },
    changed: true
  };
}

export function createDefaultState(now: Date = new Date()): AppState {
  return {
    createdAt: now.toISOString(),
    settings: createDefaultSettings(),
    sessions: [],
    weakTopicScores: createEmptyWeakTopicScores()
  };
}

export function hydrateState(raw: Partial<AppState> | null | undefined): AppState {
  const defaultState = createDefaultState();
  const settings = sanitizeSettings({
    ...defaultState.settings,
    ...(raw?.settings ?? {}),
    activeHours: {
      ...defaultState.settings.activeHours,
      ...(raw?.settings?.activeHours ?? {})
    }
  });

  const weakTopicScores = createEmptyWeakTopicScores();
  const rawWeakTopicScores = raw?.weakTopicScores && typeof raw.weakTopicScores === 'object' ? raw.weakTopicScores : {};
  for (const [topicId, score] of Object.entries(rawWeakTopicScores)) {
    weakTopicScores[topicId] = Number(score ?? 0);
  }
  for (const topicTag of TOPIC_TAGS) {
    weakTopicScores[topicTag] = Number(rawWeakTopicScores[topicTag] ?? weakTopicScores[topicTag] ?? 0);
  }

  const sessions = Array.isArray(raw?.sessions)
    ? raw.sessions
        .map((session) => hydrateSession(session))
        .filter((session): session is PracticeSession => session !== null)
        .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor))
    : [];

  return {
    createdAt: raw?.createdAt ?? defaultState.createdAt,
    settings,
    sessions,
    activeSessionId: raw?.activeSessionId,
    weakTopicScores
  };
}

export function serializeState(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

function tryLoadStateFile(filePath: string): { state?: AppState; error?: unknown; exists: boolean } {
  try {
    const rawContents = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(rawContents) as Partial<AppState>;
    return {
      state: hydrateState(parsed),
      exists: true
    };
  } catch (error) {
    return {
      error,
      exists: fs.existsSync(filePath)
    };
  }
}

function archiveCorruptFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const corruptFilePath = getCorruptFilePath(filePath);
  try {
    fs.renameSync(filePath, corruptFilePath);
    console.error(`CalcTrainer archived unreadable state at ${corruptFilePath}.`);
  } catch (error) {
    console.error(`CalcTrainer could not archive unreadable state at ${filePath}.`, error);
  }
}

function tryPersistPrunedState(filePath: string, state: AppState): void {
  try {
    saveStateFile(filePath, state);
  } catch (error) {
    console.error(`CalcTrainer could not rewrite pruned state at ${filePath}.`, error);
  }
}

export function loadStateFile(filePath: string): AppState {
  const primaryResult = tryLoadStateFile(filePath);
  if (primaryResult.state) {
    const pruned = pruneStateForPersistence(primaryResult.state, new Date());
    if (pruned.changed) {
      tryPersistPrunedState(filePath, pruned.next);
    }
    return pruned.next;
  }

  const backupPath = getBackupFilePath(filePath);
  const backupResult = tryLoadStateFile(backupPath);
  if (backupResult.state) {
    if (primaryResult.exists) {
      console.error(`CalcTrainer recovered state from backup ${backupPath}.`, primaryResult.error);
      archiveCorruptFile(filePath);
    }
    const pruned = pruneStateForPersistence(backupResult.state, new Date());
    if (pruned.changed) {
      tryPersistPrunedState(filePath, pruned.next);
    }
    return pruned.next;
  }

  if (primaryResult.exists) {
    console.error(`CalcTrainer could not read state file ${filePath}.`, primaryResult.error);
    archiveCorruptFile(filePath);
  }
  if (backupResult.exists) {
    console.error(`CalcTrainer could not read backup state file ${backupPath}.`, backupResult.error);
  }

  return createDefaultState();
}

export function saveStateFile(filePath: string, state: AppState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const { next: persistedState } = pruneStateForPersistence(state, new Date());
  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFilePath, serializeState(persistedState), 'utf8');

  try {
    fs.renameSync(tempFilePath, filePath);
    fs.copyFileSync(filePath, getBackupFilePath(filePath));
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.rmSync(tempFilePath, { force: true });
    }
  }
}

/**
 * Debounced wrapper around saveStateFile. Coalesces rapid mutations into a single
 * disk write while still guaranteeing the latest in-memory state is persisted on
 * a force-flush (e.g. on app quit). Persistence failures retain the pending state
 * and trigger a retry on a short backoff so that a single transient I/O error
 * cannot silently drop a write the IPC layer already reported as successful.
 */
export type StatePersistScheduler = {
  schedule: (state: AppState) => void;
  flush: () => void;
  pending: () => boolean;
  lastError: () => unknown;
};

export const DEFAULT_STATE_PERSIST_DEBOUNCE_MS = 100;
export const DEFAULT_STATE_PERSIST_RETRY_MS = 1_000;

export function createStatePersistScheduler(
  filePath: string,
  options: { debounceMs?: number; retryDelayMs?: number; onError?: (error: unknown) => void } = {}
): StatePersistScheduler {
  const debounceMs = options.debounceMs ?? DEFAULT_STATE_PERSIST_DEBOUNCE_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_STATE_PERSIST_RETRY_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingState: AppState | null = null;
  let lastError: unknown = null;

  const writeNow = (): void => {
    if (!pendingState) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const stateToWrite = pendingState;
    try {
      saveStateFile(filePath, stateToWrite);
      if (pendingState === stateToWrite) {
        pendingState = null;
      }
      lastError = null;
    } catch (error) {
      lastError = error;
      console.error(`CalcTrainer state persistence failed for ${filePath}; will retry.`, error);
      try {
        options.onError?.(error);
      } catch (innerError) {
        console.error('CalcTrainer persistence onError handler threw.', innerError);
      }
      if (!timer && pendingState) {
        timer = setTimeout(() => {
          timer = null;
          writeNow();
        }, retryDelayMs);
      }
    }
  };

  return {
    schedule(state: AppState): void {
      pendingState = state;
      if (timer) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        writeNow();
      }, debounceMs);
    },
    flush(): void {
      writeNow();
    },
    pending(): boolean {
      return pendingState !== null;
    },
    lastError(): unknown {
      return lastError;
    }
  };
}
