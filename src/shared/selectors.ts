import { getActiveSession, getActiveSessionStatus } from './practice';
import { getPendingSessionCount, getTodayScheduleView } from './schedule';
import { AppSnapshot, AppState, HistoryPoint, TopicScore, TopicTag } from './types';
import { buildLocalDate, formatDateLabel, formatDuration, formatTimeLabel, parseSlotId, toDateKey } from './time';

const TOPIC_LABELS: Record<TopicTag, string> = {
  binary_bce_backprop: 'Binary BCE backprop',
  sigmoid_tanh_relu_derivatives: 'Activation derivatives',
  multiclass_softmax_cross_entropy: 'Softmax backprop',
  learning_rate_and_optimizer: 'Learning rate and optimizers',
  conv_output_size: 'Convolution output size',
  padding_stride_pooling: 'Padding, stride, and pooling',
  conv_parameter_count: 'Convolution parameter count'
};

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

function buildWeakTopics(state: AppState): TopicScore[] {
  return Object.entries(state.weakTopicScores)
    .map(([topicTag, score]) => ({
      topicTag: topicTag as TopicTag,
      label: TOPIC_LABELS[topicTag as TopicTag],
      score
    }))
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

export function buildSnapshot(state: AppState, now: Date): AppSnapshot {
  const activeSession = getActiveSession(state);
  const history = buildHistory(state, now);
  const activeSessionStatus = activeSession ? getActiveSessionStatus(activeSession, now) : null;
  const completedToday = history[history.length - 1]?.completed ?? 0;

  let overdueSummary: string | null = null;
  if (activeSession) {
    const slotDate = parseSlotId(activeSession.slotId, state.settings.timezone);
    overdueSummary = `Active session from ${formatDateLabel(slotDate, state.settings.timezone)} at ${formatTimeLabel(slotDate, state.settings.timezone)}. ${activeSessionStatus?.canComplete ? 'You can finish it now.' : `Minimum timer remaining: ${formatDuration(activeSessionStatus?.remainingMs ?? 0)}.`}`;
  }

  return {
    now: now.toISOString(),
    settings: state.settings,
    activeSession,
    activeSessionStatus,
    schedule: getTodayScheduleView(state, now),
    weakTopics: buildWeakTopics(state),
    history,
    streakDays: computeStreakDays(history),
    completedToday,
    pendingCount: getPendingSessionCount(state),
    overdueSummary
  };
}
