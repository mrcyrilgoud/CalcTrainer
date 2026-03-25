import { createPracticeSession, activateNextPendingSession } from './practice';
import { AppState, PracticeSession, ScheduleSlotView } from './types';
import { buildSlotId, formatTimeLabel, getDailySlotHours, parseSlotId, toDateKey } from './time';

function cloneState(state: AppState): AppState {
  return {
    ...state,
    settings: {
      ...state.settings,
      activeHours: { ...state.settings.activeHours }
    },
    sessions: state.sessions.map((session) => ({
      ...session,
      questions: session.questions.map((question) => ({ ...question })),
      responses: Object.fromEntries(
        Object.entries(session.responses).map(([questionId, progress]) => [questionId, { ...progress }])
      )
    })),
    weakTopicScores: { ...state.weakTopicScores }
  };
}

function sortSessions(sessions: PracticeSession[]): PracticeSession[] {
  return [...sessions].sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor));
}

export function queueDueSessions(
  state: AppState,
  now: Date
): { state: AppState; createdSessionIds: string[]; activatedSessionId?: string } {
  const workingState = cloneState(state);
  const todayKey = toDateKey(now);
  const createdSessionIds: string[] = [];

  for (const hour of getDailySlotHours(workingState.settings)) {
    const slotId = buildSlotId(todayKey, hour);
    const slotDate = parseSlotId(slotId);
    if (slotDate.getTime() > now.getTime()) {
      continue;
    }

    const existingSession = workingState.sessions.find((session) => session.slotId === slotId);
    if (existingSession) {
      continue;
    }

    const session = createPracticeSession(workingState, slotId, slotDate.toISOString());
    workingState.sessions.push(session);
    createdSessionIds.push(session.id);
  }

  workingState.sessions = sortSessions(workingState.sessions);
  const activation = activateNextPendingSession(workingState, now);
  return {
    state: activation.state,
    createdSessionIds,
    activatedSessionId: activation.activatedSessionId
  };
}

export function getTodayScheduleView(state: AppState, now: Date): ScheduleSlotView[] {
  const todayKey = toDateKey(now);
  return getDailySlotHours(state.settings).map((hour) => {
    const slotId = buildSlotId(todayKey, hour);
    const slotDate = parseSlotId(slotId);
    const session = state.sessions.find((candidate) => candidate.slotId === slotId);
    let status: ScheduleSlotView['status'] = 'upcoming';

    if (session?.status === 'completed') {
      status = 'completed';
    } else if (session?.status === 'active') {
      status = 'active';
    } else if (session?.status === 'pending' || slotDate.getTime() <= now.getTime()) {
      status = session ? 'queued' : slotDate.getTime() <= now.getTime() ? 'queued' : 'upcoming';
    }

    return {
      slotId,
      scheduledFor: slotDate.toISOString(),
      label: formatTimeLabel(slotDate),
      status
    };
  });
}

export function getPendingSessionCount(state: AppState): number {
  return state.sessions.filter((session) => session.status === 'active' || session.status === 'pending').length;
}
