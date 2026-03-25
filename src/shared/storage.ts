import fs from 'node:fs';
import path from 'node:path';

import { createDefaultSettings, sanitizeSettings } from './settings';
import { AppState, PracticeSession, TOPIC_TAGS, TopicTag } from './types';

function createEmptyWeakTopicScores(): Record<TopicTag, number> {
  return Object.fromEntries(TOPIC_TAGS.map((topicTag) => [topicTag, 0])) as Record<TopicTag, number>;
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
    questions: Array.isArray(rawSession.questions) ? rawSession.questions : [],
    responses: responses as PracticeSession['responses']
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
  for (const topicTag of TOPIC_TAGS) {
    weakTopicScores[topicTag] = Number(raw?.weakTopicScores?.[topicTag] ?? 0);
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

export function loadStateFile(filePath: string): AppState {
  const primaryResult = tryLoadStateFile(filePath);
  if (primaryResult.state) {
    return primaryResult.state;
  }

  const backupPath = getBackupFilePath(filePath);
  const backupResult = tryLoadStateFile(backupPath);
  if (backupResult.state) {
    if (primaryResult.exists) {
      console.error(`CalcTrainer recovered state from backup ${backupPath}.`, primaryResult.error);
      archiveCorruptFile(filePath);
    }
    return backupResult.state;
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
  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFilePath, serializeState(state), 'utf8');

  try {
    fs.renameSync(tempFilePath, filePath);
    fs.copyFileSync(filePath, getBackupFilePath(filePath));
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.rmSync(tempFilePath, { force: true });
    }
  }
}
