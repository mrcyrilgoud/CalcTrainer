import fs from 'node:fs';
import path from 'node:path';

import { createDefaultSettings, sanitizeSettings } from './settings';
import { AppState, PracticeSession, TOPIC_TAGS, TopicTag } from './types';

function createEmptyWeakTopicScores(): Record<TopicTag, number> {
  return Object.fromEntries(TOPIC_TAGS.map((topicTag) => [topicTag, 0])) as Record<TopicTag, number>;
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

export function loadStateFile(filePath: string): AppState {
  try {
    const rawContents = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(rawContents) as Partial<AppState>;
    return hydrateState(parsed);
  } catch {
    return createDefaultState();
  }
}

export function saveStateFile(filePath: string, state: AppState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, serializeState(state), 'utf8');
}
