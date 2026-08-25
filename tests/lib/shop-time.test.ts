import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/errors/app-error';
import {
  eachShopDate,
  minutesOfDay,
  normaliseTimeOfDay,
  shopDayBounds,
  shopMonthRange,
  shopRangeBounds,
  toInstant,
  toShopDate,
  toShopTimeOfDay,
  weekdayOf,
} from '../../src/lib/shop-time';

const SAO_PAULO = 'America/Sao_Paulo';
const LISBON = 'Europe/Lisbon';

describe('normaliseTimeOfDay', () => {
  it.each([
    ['09:00', '09:00:00'],
    ['09:00:00', '09:00:00'],
    ['23:59:59', '23:59:59'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normaliseTimeOfDay(input)).toBe(expected);
  });

  it.each([['9:00'], ['0900'], ['09:0'], [''], ['noon']])('rejects %s', (input) => {
    expect(() => normaliseTimeOfDay(input)).toThrow(ValidationError);
  });
});

describe('minutesOfDay', () => {
  it.each([
    ['00:00', 0],
    ['09:30', 570],
    ['18:00', 1080],
  ])('converts %s to %i minutes', (input, expected) => {
    expect(minutesOfDay(input)).toBe(expected);
  });
});

describe('toInstant', () => {
  it('reads a wall time in the shop zone, not the server zone', () => {

    expect(toInstant('2026-07-26', '09:00', SAO_PAULO).toISOString()).toBe(
      '2026-07-26T12:00:00.000Z',
    );
  });

  it('follows the zone, not a fixed offset', () => {
    expect(toInstant('2026-07-26', '09:00', LISBON).toISOString()).toBe('2026-07-26T08:00:00.000Z');
  });

  it('keeps the same wall time either side of a DST change', () => {

    const beforeSpring = toInstant('2018-11-03', '09:00', SAO_PAULO);
    const afterSpring = toInstant('2018-11-05', '09:00', SAO_PAULO);

    expect(beforeSpring.toISOString()).toBe('2018-11-03T12:00:00.000Z');

    expect(afterSpring.toISOString()).toBe('2018-11-05T11:00:00.000Z');
  });

  it('pushes a wall time that never happened past the gap', () => {

    const instant = toInstant('2018-11-04', '00:30', SAO_PAULO);

    expect(instant.toISOString()).toBe('2018-11-04T03:30:00.000Z');
    expect(toShopTimeOfDay(instant, SAO_PAULO)).toBe('01:30:00');
  });

  it('resolves a wall time that happened twice to the later one', () => {

    const instant = toInstant('2019-02-16', '23:30', SAO_PAULO);

    expect(instant.toISOString()).toBe('2019-02-17T02:30:00.000Z');
    expect(toShopTimeOfDay(instant, SAO_PAULO)).toBe('23:30:00');
  });

  it('rejects a malformed date', () => {
    expect(() => toInstant('26-07-2026', '09:00', SAO_PAULO)).toThrow(ValidationError);
  });
});

describe('toShopDate / toShopTimeOfDay', () => {
  it('maps an instant back to the shop wall clock', () => {
    const instant = new Date('2026-07-27T01:30:00.000Z');

    expect(toShopDate(instant, SAO_PAULO)).toBe('2026-07-26');
    expect(toShopTimeOfDay(instant, SAO_PAULO)).toBe('22:30:00');
  });

  it('round-trips with toInstant', () => {
    const instant = toInstant('2026-12-31', '23:00', SAO_PAULO);

    expect(toShopDate(instant, SAO_PAULO)).toBe('2026-12-31');
    expect(toShopTimeOfDay(instant, SAO_PAULO)).toBe('23:00:00');
  });
});

describe('weekdayOf', () => {
  it.each([
    ['2026-07-26', 0],
    ['2026-07-27', 1],
    ['2026-08-01', 6],
  ])('maps %s to weekday %i', (date, expected) => {
    expect(weekdayOf(date)).toBe(expected);
  });

  it('rejects a malformed date', () => {
    expect(() => weekdayOf('not-a-date')).toThrow(ValidationError);
  });
});

describe('shopDayBounds', () => {
  it('spans midnight to midnight in the shop zone', () => {
    const { start, end } = shopDayBounds('2026-07-26', SAO_PAULO);

    expect(start.toISOString()).toBe('2026-07-26T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-27T03:00:00.000Z');
  });

  it('is 23 hours long on a spring-forward day', () => {
    const { start, end } = shopDayBounds('2018-11-04', SAO_PAULO);

    expect(end.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it('is 25 hours long on a fall-back day', () => {
    const { start, end } = shopDayBounds('2019-02-16', SAO_PAULO);

    expect(end.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000);
  });
});

describe('shopRangeBounds', () => {
  it('covers the last day whole, so a late cut still belongs to the period', () => {
    const { start, end } = shopRangeBounds('2026-03-01', '2026-03-15', SAO_PAULO);

    expect(start.toISOString()).toBe('2026-03-01T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-16T03:00:00.000Z');
  });

  it('spans a single day when both ends are the same', () => {
    const { start, end } = shopRangeBounds('2026-03-01', '2026-03-01', SAO_PAULO);

    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('shifts with the zone', () => {
    expect(shopRangeBounds('2026-03-01', '2026-03-15', LISBON).start.toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    );
  });

  it('refuses a range that ends before it starts', () => {
    expect(() => shopRangeBounds('2026-03-15', '2026-03-01', SAO_PAULO)).toThrow(ValidationError);
  });
});

describe('eachShopDate', () => {
  it('lists every inclusive day', () => {
    expect(eachShopDate('2026-07-13', '2026-07-15')).toEqual([
      '2026-07-13',
      '2026-07-14',
      '2026-07-15',
    ]);
  });

  it('is a single day when both ends match', () => {
    expect(eachShopDate('2026-07-13', '2026-07-13')).toEqual(['2026-07-13']);
  });
});

describe('shopMonthRange', () => {
  it('returns the shop-local month an instant falls in', () => {

    expect(shopMonthRange(new Date('2026-07-14T18:00:00.000Z'), SAO_PAULO)).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    });
  });
});
