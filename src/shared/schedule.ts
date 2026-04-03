import { createPracticeSession, activateNextPendingSession } from './practice';
import { AppState, PracticeSession, QuestionBankState, ScheduleSlotView } from './types';
import { buildSlotId, formatTimeLabel, getDailySlotHours, parseSlotId, toDateKey } from './time';

function sortSessions(sessions: PracticeSession[]): PracticeSession[] {
  return [...sessions].sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor));
}

export function queueDueSessions(
  state: AppState,
  now: Date,
  questionBankState?: QuestionBankState
): { state: AppState; createdSessionIds: string[]; activatedSessionId?: string } {
  const todayKey = toDateKey(now, state.settings.timezone);
  const createdSessionIds: string[] = [];
  const existingSlotIds = new Set(state.sessions.map((session) => session.slotId));
  let nextSessions = state.sessions;

  for (const hour of getDailySlotHours(state.settings)) {
    const slotId = buildSlotId(todayKey, hour);
    const slotDate = parseSlotId(slotId, state.settings.timezone);
    if (slotDate.getTime() > now.getTime()) {
      continue;
    }

    if (existingSlotIds.has(slotId)) {
      continue;
    }

    if (nextSessions === state.sessions) {
      nextSessions = state.sessions.slice();
    }
    const workingState = {
      ...state,
      sessions: nextSessions
    };
    const session = createPracticeSession(workingState, slotId, slotDate.toISOString(), questionBankState);
    nextSessions.push(session);
    existingSlotIds.add(slotId);
    createdSessionIds.push(session.id);
  }

  const baseState = nextSessions === state.sessions
    ? state
    : {
        ...state,
        sessions: sortSessions(nextSessions)
      };
  const activation = activateNextPendingSession(baseState, now);
  return {
    state: activation.state,
    createdSessionIds,
    activatedSessionId: activation.activatedSessionId
  };
}

export function getTodayScheduleView(state: AppState, now: Date): ScheduleSlotView[] {
  const todayKey = toDateKey(now, state.settings.timezone);
  return getDailySlotHours(state.settings).map((hour) => {
    const slotId = buildSlotId(todayKey, hour);
    const slotDate = parseSlotId(slotId, state.settings.timezone);
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
      label: formatTimeLabel(slotDate, state.settings.timezone),
      status
    };
  });
}

export function getPendingSessionCount(state: AppState): number {
  return state.sessions.filter((session) => session.status === 'active' || session.status === 'pending').length;
}
