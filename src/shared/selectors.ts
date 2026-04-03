import { getActiveSession, getActiveSessionStatus } from './practice';
import { getPendingSessionCount, getTodayScheduleView } from './schedule';
import { AppSnapshot, AppState, HistoryPoint, SEEDED_TOPIC_LABELS, TopicScore } from './types';
import { buildLocalDate, formatDateLabel, formatDuration, formatTimeLabel, parseSlotId, toDateKey } from './time';

function buildHistory(state: AppState, now: Date): HistoryPoint[] {
  const days: HistoryPoint[] = [];
  const anchorDate = buildLocalDate(toDateKey(now, state.settings.timezone), 12, 0, state.settings.timezone);
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(anchorDate);
    day.setUTCDate(anchorDate.getUTCDate() - offset);
    const dateKey = toDateKey(day, state.settings.timezone);
    const completed = state.sessions.filter(
      (session) =>
        session.status === 'completed'
        && toDateKey(new Date(session.completedAt ?? session.scheduledFor), state.settings.timezone) === dateKey
    ).length;
    days.push({ dateKey, completed });
  }
  return days;
}

function buildWeakTopics(state: AppState, topicLabels: Record<string, string>): TopicScore[] {
  return Object.entries(state.weakTopicScores)
    .map(([topicTag, score]) => ({
      topicId: topicTag,
      topicTag,
      label: topicLabels[topicTag] ?? topicTag.replace(/_/g, ' '),
      score
    }))
    .filter((topic) => topic.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

function computeStreakDays(history: HistoryPoint[]): number {
  let streak = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if ((history[index]?.completed ?? 0) > 0) {
      streak += 1;
      continue;
    }
    if (index === history.length - 1) {
      return 0;
    }
    break;
  }
  return streak;
}

export type SnapshotPayloadStyle = 'full' | 'slim';

export function buildSnapshot(
  state: AppState,
  now: Date,
  style: SnapshotPayloadStyle = 'full',
  options: { topicLabels?: Record<string, string> } = {}
): AppSnapshot {
  const activeSessionFull = getActiveSession(state);
  const activeSession =
    style === 'slim' && activeSessionFull
      ? { ...activeSessionFull, questions: [], responses: {} }
      : activeSessionFull;
  const history = buildHistory(state, now);
  const activeSessionStatus = activeSessionFull ? getActiveSessionStatus(activeSessionFull, now) : null;
  const completedToday = history[history.length - 1]?.completed ?? 0;
  const topicLabels = {
    ...SEEDED_TOPIC_LABELS,
    ...(options.topicLabels ?? {})
  };

  let overdueSummary: string | null = null;
  if (activeSessionFull) {
    const slotDate = parseSlotId(activeSessionFull.slotId, state.settings.timezone);
    overdueSummary = `Active session from ${formatDateLabel(slotDate, state.settings.timezone)} at ${formatTimeLabel(slotDate, state.settings.timezone)}. ${activeSessionStatus?.canComplete ? 'You can finish it now.' : `Minimum timer remaining: ${formatDuration(activeSessionStatus?.remainingMs ?? 0)}.`}`;
  }

  return {
    now: now.toISOString(),
    settings: state.settings,
    activeSession,
    activeSessionStatus,
    schedule: getTodayScheduleView(state, now),
    weakTopics: buildWeakTopics(state, topicLabels),
    history,
    streakDays: computeStreakDays(history),
    completedToday,
    pendingCount: getPendingSessionCount(state),
    overdueSummary
  };
}

/** Derive a slim snapshot from a full one (avoids recomputing schedule/history). */
export function slimDownSnapshot(snapshot: AppSnapshot): AppSnapshot {
  if (!snapshot.activeSession) {
    return snapshot;
  }
  return {
    ...snapshot,
    activeSession: {
      ...snapshot.activeSession,
      questions: [],
      responses: {}
    }
  };
}
