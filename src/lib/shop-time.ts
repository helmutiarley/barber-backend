import { DateTime } from 'luxon';
import type { TimeOfDay } from '../entities/barber-schedule.entity';
import { ValidationError } from '../errors/app-error';

export function normaliseTimeOfDay(timeOfDay: TimeOfDay): TimeOfDay {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(timeOfDay);
  if (!match) {
    throw new ValidationError(`Invalid time of day: ${timeOfDay}`);
  }

  return `${match[1]}:${match[2]}:${match[3] ?? '00'}`;
}

export function minutesOfDay(timeOfDay: TimeOfDay): number {
  const [hours, minutes] = normaliseTimeOfDay(timeOfDay).split(':').map(Number);

  return hours * 60 + minutes;
}

export function toInstant(date: string, timeOfDay: TimeOfDay, zone: string): Date {
  const dateTime = DateTime.fromISO(`${date}T${normaliseTimeOfDay(timeOfDay)}`, { zone });

  if (!dateTime.isValid) {
    throw new ValidationError(`Invalid shop-local time: ${date} ${timeOfDay} (${zone})`);
  }

  return dateTime.toJSDate();
}

export function toShopDate(instant: Date, zone: string): string {
  return DateTime.fromJSDate(instant, { zone }).toFormat('yyyy-MM-dd');
}

export function toShopTimeOfDay(instant: Date, zone: string): TimeOfDay {
  return DateTime.fromJSDate(instant, { zone }).toFormat('HH:mm:ss');
}

export function weekdayOf(date: string): number {
  const dateTime = DateTime.fromISO(date);

  if (!dateTime.isValid) {
    throw new ValidationError(`Invalid date: ${date}`);
  }

  return dateTime.weekday % 7;
}

export function shopDayBounds(date: string, zone: string): { start: Date; end: Date } {
  const startOfDay = DateTime.fromISO(date, { zone }).startOf('day');

  if (!startOfDay.isValid) {
    throw new ValidationError(`Invalid date: ${date}`);
  }

  return {
    start: startOfDay.toJSDate(),
    end: startOfDay.plus({ days: 1 }).startOf('day').toJSDate(),
  };
}

export function shopRangeBounds(
  startsOn: string,
  endsOn: string,
  zone: string,
): { start: Date; end: Date } {
  const { start } = shopDayBounds(startsOn, zone);
  const { end } = shopDayBounds(endsOn, zone);

  if (end <= start) {
    throw new ValidationError(`Range ends before it starts: ${startsOn}..${endsOn}`);
  }

  return { start, end };
}

export function shopMonthRange(instant: Date, zone: string): { from: string; to: string } {
  const local = DateTime.fromJSDate(instant, { zone });

  if (!local.isValid) {
    throw new ValidationError(`Invalid timezone: ${zone}`);
  }

  return {
    from: local.startOf('month').toFormat('yyyy-MM-dd'),
    to: local.endOf('month').toFormat('yyyy-MM-dd'),
  };
}

export function eachShopDate(from: string, to: string): string[] {
  let cursor = DateTime.fromISO(from);
  const last = DateTime.fromISO(to);

  if (!cursor.isValid || !last.isValid) {
    throw new ValidationError(`Invalid date range: ${from}..${to}`);
  }

  if (last < cursor) {
    throw new ValidationError(`Range ends before it starts: ${from}..${to}`);
  }

  const dates: string[] = [];

  while (cursor <= last) {
    dates.push(cursor.toFormat('yyyy-MM-dd'));
    cursor = cursor.plus({ days: 1 });
  }

  return dates;
}
