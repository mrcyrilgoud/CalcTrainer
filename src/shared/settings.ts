import { AppSettings } from './types';

export const SESSION_QUESTION_COUNT = 6;
export const REMINDER_PULSE_MS = 30_000;
export const STRICT_PRACTICE_SLOT_REOPEN_MS = 20_000;
export const STRICT_ACTIVE_REMINDER_REPEAT_MS = 120_000;
export const LIGHTER_ACTIVE_REMINDER_REPEAT_MS = 300_000;
export const DEFAULT_LIGHTER_REOPEN_DELAY_MINUTES = 1;
export const MIN_LIGHTER_REOPEN_DELAY_MINUTES = 1;
export const MAX_LIGHTER_REOPEN_DELAY_MINUTES = 30;

export function resolveLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
}

export function normalizeTimezone(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return resolveLocalTimezone();
  }

  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: value
    }).resolvedOptions().timeZone;
  } catch {
    return resolveLocalTimezone();
  }
}

export function createDefaultSettings(): AppSettings {
  return {
    timezone: resolveLocalTimezone(),
    activeHours: {
      startHour: 9,
      endHour: 21
    },
    reminderIntervalHours: 2,
    minimumSessionMinutes: 10,
    targetSessionMinutes: 15,
    enforcementMode: 'must_finish_session',
    enforcementStyle: 'lighter',
    lighterReopenDelayMinutes: DEFAULT_LIGHTER_REOPEN_DELAY_MINUTES
  };
}

export function normalizeLighterReopenDelayMinutes(value: unknown): number {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) {
    return DEFAULT_LIGHTER_REOPEN_DELAY_MINUTES;
  }

  return Math.min(MAX_LIGHTER_REOPEN_DELAY_MINUTES, Math.max(MIN_LIGHTER_REOPEN_DELAY_MINUTES, Math.round(parsedValue)));
}

export function sanitizeSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    timezone: normalizeTimezone(settings.timezone),
    lighterReopenDelayMinutes: normalizeLighterReopenDelayMinutes(settings.lighterReopenDelayMinutes)
  };
}

export function getPracticeReopenDelayMs(settings: AppSettings): number {
  return settings.enforcementStyle === 'strict'
    ? STRICT_PRACTICE_SLOT_REOPEN_MS
    : normalizeLighterReopenDelayMinutes(settings.lighterReopenDelayMinutes) * 60_000;
}

export function getActiveReminderRepeatMs(settings: AppSettings): number {
  return settings.enforcementStyle === 'strict' ? STRICT_ACTIVE_REMINDER_REPEAT_MS : LIGHTER_ACTIVE_REMINDER_REPEAT_MS;
}

export function shouldActivatePracticePrompt(settings: AppSettings): boolean {
  return settings.enforcementStyle === 'strict';
}

export function shouldKeepPracticeWindowOnTop(settings: AppSettings): boolean {
  return settings.enforcementStyle === 'strict';
}
