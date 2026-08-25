import { describe, expect, it } from 'vitest';
import {
  contains,
  durationMinutes,
  overlaps,
  slotsWithin,
  subtract,
  type Interval,
} from '../../src/lib/intervals';

function at(time: string): Date {
  return new Date(`2026-07-27T${time}:00.000Z`);
}

function interval(start: string, end: string): Interval {
  return { start: at(start), end: at(end) };
}

function render(intervals: Interval[]): string[] {
  return intervals.map(
    (item) => `${item.start.toISOString().slice(11, 16)}-${item.end.toISOString().slice(11, 16)}`,
  );
}

describe('overlaps', () => {
  it('is false for touching intervals, because ranges are half-open', () => {
    expect(overlaps(interval('09:00', '10:00'), interval('10:00', '11:00'))).toBe(false);
  });

  it('is true for a partial overlap', () => {
    expect(overlaps(interval('09:00', '10:00'), interval('09:30', '11:00'))).toBe(true);
  });
});

describe('contains', () => {
  it('accepts an exact fit', () => {
    expect(contains(interval('09:00', '10:00'), interval('09:00', '10:00'))).toBe(true);
  });

  it('rejects an interval running past the end', () => {
    expect(contains(interval('09:00', '10:00'), interval('09:30', '10:30'))).toBe(false);
  });
});

describe('subtract', () => {
  it('returns the base untouched when nothing overlaps', () => {
    const result = subtract([interval('09:00', '18:00')], [interval('19:00', '20:00')]);

    expect(render(result)).toEqual(['09:00-18:00']);
  });

  it('punches a hole in the middle', () => {
    const result = subtract([interval('09:00', '18:00')], [interval('12:00', '13:00')]);

    expect(render(result)).toEqual(['09:00-12:00', '13:00-18:00']);
  });

  it('trims the front and the back', () => {
    const result = subtract(
      [interval('09:00', '18:00')],
      [interval('08:00', '10:00'), interval('17:00', '19:00')],
    );

    expect(render(result)).toEqual(['10:00-17:00']);
  });

  it('removes the base entirely when fully covered', () => {
    expect(subtract([interval('09:00', '18:00')], [interval('08:00', '19:00')])).toEqual([]);
  });

  it('applies cuts cumulatively and returns them in order', () => {
    const result = subtract(
      [interval('09:00', '18:00')],
      [interval('15:00', '16:00'), interval('12:00', '13:00'), interval('09:30', '10:00')],
    );

    expect(render(result)).toEqual(['09:00-09:30', '10:00-12:00', '13:00-15:00', '16:00-18:00']);
  });

  it('ignores empty and zero-length cuts', () => {
    const result = subtract([interval('09:00', '18:00')], [interval('12:00', '12:00')]);

    expect(render(result)).toEqual(['09:00-18:00']);
  });

  it('handles overlapping cuts without splitting twice', () => {
    const result = subtract(
      [interval('09:00', '18:00')],
      [interval('12:00', '14:00'), interval('13:00', '15:00')],
    );

    expect(render(result)).toEqual(['09:00-12:00', '15:00-18:00']);
  });
});

describe('slotsWithin', () => {
  it('steps from the start of the interval', () => {
    const slots = slotsWithin(interval('09:00', '10:00'), 30, 15);

    expect(slots.map((slot) => slot.toISOString().slice(11, 16))).toEqual([
      '09:00',
      '09:15',
      '09:30',
    ]);
  });

  it('never offers a slot that would run past the end', () => {
    const slots = slotsWithin(interval('09:00', '09:20'), 30, 15);

    expect(slots).toEqual([]);
  });

  it('offers exactly one slot when the fit is exact', () => {
    expect(slotsWithin(interval('09:00', '09:30'), 30, 15)).toHaveLength(1);
  });
});

describe('durationMinutes', () => {
  it('counts whole minutes in a half-open interval', () => {
    expect(durationMinutes(interval('09:00', '10:30'))).toBe(90);
  });

  it('is zero for an empty interval', () => {
    expect(durationMinutes(interval('09:00', '09:00'))).toBe(0);
  });
});
