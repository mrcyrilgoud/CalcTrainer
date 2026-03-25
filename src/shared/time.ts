import { normalizeTimezone } from './settings';
import { AppSettings } from './types';

type TimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();
const labelFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getSystemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
}

function getDateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  const normalizedTimezone = normalizeTimezone(timeZone);
  const cacheKey = `datetime:${normalizedTimezone}`;
  const cached = dateTimeFormatterCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: normalizedTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  dateTimeFormatterCache.set(cacheKey, formatter);
  return formatter;
}

function getLabelFormatter(timeZone: string, kind: 'time' | 'date'): Intl.DateTimeFormat {
  const normalizedTimezone = normalizeTimezone(timeZone);
  const cacheKey = `${kind}:${normalizedTimezone}`;
  const cached = labelFormatterCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat('en-US', kind === 'time'
    ? {
        timeZone: normalizedTimezone,
        hour: 'numeric',
        minute: '2-digit'
      }
    : {
        timeZone: normalizedTimezone,
        month: 'short',
        day: 'numeric'
      });
  labelFormatterCache.set(cacheKey, formatter);
  return formatter;
}

function getTimeParts(date: Date, timeZone: string): TimeParts {
  const parts = getDateTimeFormatter(timeZone).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    year: values.year ?? date.getUTCFullYear(),
    month: values.month ?? (date.getUTCMonth() + 1),
    day: values.day ?? date.getUTCDate(),
    hour: values.hour ?? date.getUTCHours(),
    minute: values.minute ?? date.getUTCMinutes(),
    second: values.second ?? date.getUTCSeconds()
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getTimeParts(date, timeZone);
  const utcTimestamp = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return utcTimestamp - date.getTime();
}

export function toDateKey(date: Date, timeZone: string = getSystemTimezone()): string {
  const parts = getTimeParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function buildLocalDate(dateKey: string, hour: number, minute = 0, timeZone: string = getSystemTimezone()): Date {
  const [yearText, monthText, dayText] = dateKey.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const initialOffset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  let timestamp = utcGuess - initialOffset;
  const refinedOffset = getTimeZoneOffsetMs(new Date(timestamp), timeZone);
  if (refinedOffset !== initialOffset) {
    timestamp = utcGuess - refinedOffset;
  }
  return new Date(timestamp);
}

export function buildSlotId(dateKey: string, hour: number): string {
  return `${dateKey}T${String(hour).padStart(2, '0')}:00`;
}

export function parseSlotId(slotId: string, timeZone: string = getSystemTimezone()): Date {
  const [dateKey = toDateKey(new Date(), timeZone), timePart = '00:00'] = slotId.split('T');
  const [hourText = '0', minuteText = '0'] = timePart.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  return buildLocalDate(dateKey, hour, minute, timeZone);
}

export function getDailySlotHours(settings: AppSettings): number[] {
  const hours: number[] = [];
  for (
    let hour = settings.activeHours.startHour;
    hour <= settings.activeHours.endHour - settings.reminderIntervalHours;
    hour += settings.reminderIntervalHours
  ) {
    hours.push(hour);
  }
  return hours;
}

export function getTodaySlotIds(now: Date, settings: AppSettings): string[] {
  const dateKey = toDateKey(now, settings.timezone);
  return getDailySlotHours(settings).map((hour) => buildSlotId(dateKey, hour));
}

export function formatTimeLabel(date: Date, timeZone: string = getSystemTimezone()): string {
  return getLabelFormatter(timeZone, 'time').format(date);
}

export function formatDateLabel(date: Date, timeZone: string = getSystemTimezone()): string {
  return getLabelFormatter(timeZone, 'date').format(date);
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
