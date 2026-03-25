import { describe, expect, it } from 'vitest';

import { queueDueSessions, getTodayScheduleView } from '../src/shared/schedule';
import { createDefaultState } from '../src/shared/storage';

function makeDate(hour: number, minute = 0): Date {
  return new Date(2026, 2, 23, hour, minute, 0, 0);
}

describe('scheduler', () => {
  it('queues only due slots inside the configured window', () => {
    const state = createDefaultState(makeDate(8, 30));
    const result = queueDueSessions(state, makeDate(14, 15));

    expect(result.createdSessionIds).toHaveLength(3);
    expect(result.state.sessions.map((session) => session.slotId)).toEqual([
      '2026-03-23T09:00',
      '2026-03-23T11:00',
      '2026-03-23T13:00'
    ]);
    expect(result.activatedSessionId).toBe('2026-03-23T09:00');
  });

  it('renders today schedule with active, queued, and upcoming states', () => {
    const initial = createDefaultState(makeDate(8, 30));
    const queued = queueDueSessions(initial, makeDate(14, 15)).state;
    const schedule = getTodayScheduleView(queued, makeDate(14, 15));

    expect(schedule.map((slot) => [slot.slotId, slot.status])).toEqual([
      ['2026-03-23T09:00', 'active'],
      ['2026-03-23T11:00', 'queued'],
      ['2026-03-23T13:00', 'queued'],
      ['2026-03-23T15:00', 'upcoming'],
      ['2026-03-23T17:00', 'upcoming'],
      ['2026-03-23T19:00', 'upcoming']
    ]);
  });
});
