import { AppSettings } from './types';

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildLocalDate(dateKey: string, hour: number, minute = 0): Date {
  const [yearText, monthText, dayText] = dateKey.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

export function buildSlotId(dateKey: string, hour: number): string {
  return `${dateKey}T${String(hour).padStart(2, '0')}:00`;
}

export function parseSlotId(slotId: string): Date {
  const [dateKey = toDateKey(new Date()), timePart = '00:00'] = slotId.split('T');
  const [hourText = '0', minuteText = '0'] = timePart.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  return buildLocalDate(dateKey, hour, minute);
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
  const dateKey = toDateKey(now);
  return getDailySlotHours(settings).map((hour) => buildSlotId(dateKey, hour));
}

export function formatTimeLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

export function formatDateLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric'
  }).format(date);
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
