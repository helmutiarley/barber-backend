import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/config';
import type { Cradle } from '../../src/container';
import type { Appointment } from '../../src/entities/appointment.entity';
import type { BarberBlock } from '../../src/entities/barber-block.entity';
import type { BarberSchedule } from '../../src/entities/barber-schedule.entity';
import type { Barber } from '../../src/entities/barber.entity';
import type { Service } from '../../src/entities/service.entity';
import { NotFoundError, ValidationError } from '../../src/errors/app-error';
import type { Clock } from '../../src/lib/clock';
import { AvailabilityService } from '../../src/services/availability.service';

const MONDAY = '2026-07-27';
const SUNDAY = '2026-07-26';
const NOW = new Date('2026-07-27T11:00:00.000Z');

const barber = { id: 'barber-1', active: true } as Barber;
const service = { id: 'service-1', active: true, durationMinutes: 30 } as Service;

const nineToSix = {
  weekday: 1,
  startTime: '09:00:00',
  endTime: '18:00:00',
  breakStart: null,
  breakEnd: null,
} as BarberSchedule;

const config = { shopTimezone: 'America/Sao_Paulo' } as AppConfig;

function utc(time: string, date = MONDAY): Date {
  return new Date(`${date}T${time}:00.000Z`);
}

interface Overrides {
  barbersRepository?: Record<string, unknown>;
  barberSchedulesRepository?: Record<string, unknown>;
  barberBlocksRepository?: Record<string, unknown>;
  appointmentsRepository?: Record<string, unknown>;
  servicesRepository?: Record<string, unknown>;
  config?: AppConfig;
  clock?: Clock;
}

function buildService(overrides: Overrides = {}) {
  const cradle = {
    barbersRepository: {
      findById: vi.fn().mockResolvedValue(barber),
      ...overrides.barbersRepository,
    },
    barberSchedulesRepository: {
      findByBarberAndWeekday: vi.fn().mockResolvedValue(nineToSix),
      ...overrides.barberSchedulesRepository,
    },
    barberBlocksRepository: {
      findOverlapping: vi.fn().mockResolvedValue([]),
      ...overrides.barberBlocksRepository,
    },
    appointmentsRepository: {
      findActiveBetween: vi.fn().mockResolvedValue([]),
      ...overrides.appointmentsRepository,
    },
    servicesRepository: {
      findById: vi.fn().mockResolvedValue(service),
      ...overrides.servicesRepository,
    },
    config: overrides.config ?? config,
    clock: overrides.clock ?? { now: () => NOW },
  } as unknown as Cradle;

  return new AvailabilityService(cradle);
}

function render(free: { startsAt: string; endsAt: string }[]): string[] {
  return free.map((slot) => `${slot.startsAt.slice(11, 16)}-${slot.endsAt.slice(11, 16)}`);
}

describe('AvailabilityService.getDay', () => {
  it('returns the working window when the day is empty', async () => {
    const result = await buildService().getDay({ barberId: barber.id, date: MONDAY });

    expect(render(result.free)).toEqual(['12:00-21:00']);
    expect(result.timezone).toBe('America/Sao_Paulo');
  });

  it('is empty on a weekday with no schedule row — closed, not always open', async () => {
    const availability = buildService({
      barberSchedulesRepository: { findByBarberAndWeekday: vi.fn().mockResolvedValue(null) },
    });

    const result = await availability.getDay({ barberId: barber.id, date: SUNDAY });

    expect(result.free).toEqual([]);
  });

  it('subtracts the lunch break', async () => {
    const availability = buildService({
      barberSchedulesRepository: {
        findByBarberAndWeekday: vi
          .fn()
          .mockResolvedValue({ ...nineToSix, breakStart: '12:00:00', breakEnd: '13:00:00' }),
      },
    });

    const result = await availability.getDay({ barberId: barber.id, date: MONDAY });

    expect(render(result.free)).toEqual(['12:00-15:00', '16:00-21:00']);
  });

  it('subtracts blocks and live appointments together', async () => {
    const availability = buildService({
      barberBlocksRepository: {
        findOverlapping: vi
          .fn()
          .mockResolvedValue([{ startsAt: utc('13:00'), endsAt: utc('14:00') }] as BarberBlock[]),
      },
      appointmentsRepository: {
        findActiveBetween: vi
          .fn()
          .mockResolvedValue([{ startsAt: utc('16:00'), endsAt: utc('16:30') }] as Appointment[]),
      },
    });

    const result = await availability.getDay({ barberId: barber.id, date: MONDAY });

    expect(render(result.free)).toEqual(['12:00-13:00', '14:00-16:00', '16:30-21:00']);
  });

  it('trims the front when a block starts before opening', async () => {
    const availability = buildService({
      barberBlocksRepository: {
        findOverlapping: vi
          .fn()
          .mockResolvedValue([{ startsAt: utc('09:00'), endsAt: utc('13:00') }] as BarberBlock[]),
      },
    });

    const result = await availability.getDay({ barberId: barber.id, date: MONDAY });

    expect(render(result.free)).toEqual(['13:00-21:00']);
  });

  it('gives an inactive barber no availability at all', async () => {
    const availability = buildService({
      barbersRepository: { findById: vi.fn().mockResolvedValue({ ...barber, active: false }) },
    });

    const result = await availability.getDay({ barberId: barber.id, date: MONDAY });

    expect(result.free).toEqual([]);
  });

  it('404s on an unknown barber', async () => {
    const availability = buildService({
      barbersRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(availability.getDay({ barberId: 'ghost', date: MONDAY })).rejects.toThrow(
      NotFoundError,
    );
  });

  describe('with a service', () => {
    it('lists start times stepped by slotMinutes', async () => {
      const availability = buildService({
        barberSchedulesRepository: {
          findByBarberAndWeekday: vi.fn().mockResolvedValue({ ...nineToSix, endTime: '10:00:00' }),
        },
      });

      const result = await availability.getDay({
        barberId: barber.id,
        date: MONDAY,
        serviceId: service.id,
        slotMinutes: 30,
      });

      expect(result.slots).toEqual([utc('12:00').toISOString(), utc('12:30').toISOString()]);
    });

    it('defaults to 15-minute steps', async () => {
      const availability = buildService({
        barberSchedulesRepository: {
          findByBarberAndWeekday: vi.fn().mockResolvedValue({ ...nineToSix, endTime: '10:00:00' }),
        },
      });

      const result = await availability.getDay({
        barberId: barber.id,
        date: MONDAY,
        serviceId: service.id,
      });

      expect(result.slots).toHaveLength(3);
    });

    it('hides start times that have already passed today', async () => {
      const availability = buildService({
        barberSchedulesRepository: {
          findByBarberAndWeekday: vi.fn().mockResolvedValue({ ...nineToSix, endTime: '11:00:00' }),
        },
        clock: { now: () => new Date('2026-07-27T13:10:00.000Z') },
      });

      const result = await availability.getDay({
        barberId: barber.id,
        date: MONDAY,
        serviceId: service.id,
      });

      expect(result.free).toEqual([
        {
          startsAt: '2026-07-27T13:10:00.000Z',
          endsAt: '2026-07-27T14:00:00.000Z',
        },
      ]);
      expect(result.slots).toEqual([
        '2026-07-27T13:15:00.000Z',
        '2026-07-27T13:30:00.000Z',
      ]);
    });

    it('returns no availability for an earlier shop day', async () => {
      const availability = buildService({
        barberSchedulesRepository: {
          findByBarberAndWeekday: vi.fn().mockResolvedValue(nineToSix),
        },
      });

      const result = await availability.getDay({
        barberId: barber.id,
        date: SUNDAY,
        serviceId: service.id,
      });

      expect(result.free).toEqual([]);
      expect(result.slots).toEqual([]);
    });

    it('omits slots that a booked appointment swallowed', async () => {
      const availability = buildService({
        barberSchedulesRepository: {
          findByBarberAndWeekday: vi.fn().mockResolvedValue({ ...nineToSix, endTime: '10:00:00' }),
        },
        appointmentsRepository: {
          findActiveBetween: vi
            .fn()
            .mockResolvedValue([{ startsAt: utc('12:00'), endsAt: utc('12:30') }] as Appointment[]),
        },
      });

      const result = await availability.getDay({
        barberId: barber.id,
        date: MONDAY,
        serviceId: service.id,
        slotMinutes: 30,
      });

      expect(result.slots).toEqual([utc('12:30').toISOString()]);
    });

    it('refuses a discontinued service', async () => {
      const availability = buildService({
        servicesRepository: { findById: vi.fn().mockResolvedValue({ ...service, active: false }) },
      });

      await expect(
        availability.getDay({ barberId: barber.id, date: MONDAY, serviceId: service.id }),
      ).rejects.toThrow(ValidationError);
    });
  });
});

describe('AvailabilityService.isAvailable', () => {
  it('accepts a booking inside the working window', async () => {
    await expect(buildService().isAvailable(barber.id, utc('14:00'), utc('14:30'))).resolves.toBe(
      true,
    );
  });

  it('rejects a start time that is not in the future', async () => {
    await expect(buildService().isAvailable(barber.id, NOW, utc('11:30'))).resolves.toBe(false);
  });

  it('accepts a booking that exactly fills a gap', async () => {
    const availability = buildService({
      appointmentsRepository: {
        findActiveBetween: vi.fn().mockResolvedValue([
          { startsAt: utc('12:00'), endsAt: utc('14:00') },
          { startsAt: utc('14:30'), endsAt: utc('21:00') },
        ] as Appointment[]),
      },
    });

    await expect(availability.isAvailable(barber.id, utc('14:00'), utc('14:30'))).resolves.toBe(
      true,
    );
  });

  it('rejects a booking before opening', async () => {
    await expect(buildService().isAvailable(barber.id, utc('11:00'), utc('11:30'))).resolves.toBe(
      false,
    );
  });

  it('rejects a booking that runs past closing', async () => {
    await expect(buildService().isAvailable(barber.id, utc('20:45'), utc('21:15'))).resolves.toBe(
      false,
    );
  });

  it('rejects a booking over a block', async () => {
    const availability = buildService({
      barberBlocksRepository: {
        findOverlapping: vi
          .fn()
          .mockResolvedValue([{ startsAt: utc('13:00'), endsAt: utc('14:00') }] as BarberBlock[]),
      },
    });

    await expect(availability.isAvailable(barber.id, utc('13:30'), utc('14:00'))).resolves.toBe(
      false,
    );
  });

  it('rejects a booking on a day the barber does not work', async () => {
    const availability = buildService({
      barberSchedulesRepository: { findByBarberAndWeekday: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      availability.isAvailable(barber.id, utc('14:00', SUNDAY), utc('14:30', SUNDAY)),
    ).resolves.toBe(false);
  });

  describe('excluding an appointment being rescheduled', () => {
    it('does not treat the appointment as an obstacle to moving itself', async () => {
      const findActiveBetween = vi.fn().mockResolvedValue([]);
      const availability = buildService({ appointmentsRepository: { findActiveBetween } });

      await availability.isAvailable(barber.id, utc('14:00'), utc('14:30'), {
        excludeAppointmentId: 'appointment-1',
      });

      expect(findActiveBetween).toHaveBeenCalledWith(
        barber.id,
        expect.any(Date),
        expect.any(Date),
        'appointment-1',
      );
    });

    it('still refuses a slot a different appointment holds', async () => {
      const availability = buildService({
        appointmentsRepository: {
          findActiveBetween: vi
            .fn()
            .mockResolvedValue([{ startsAt: utc('14:00'), endsAt: utc('14:30') }] as Appointment[]),
        },
      });

      await expect(
        availability.isAvailable(barber.id, utc('14:00'), utc('14:30'), {
          excludeAppointmentId: 'appointment-1',
        }),
      ).resolves.toBe(false);
    });
  });

  it('looks up the schedule by the shop-local weekday, not the UTC one', async () => {
    const findByBarberAndWeekday = vi.fn().mockResolvedValue(nineToSix);
    const availability = buildService({ barberSchedulesRepository: { findByBarberAndWeekday } });

    await availability.isAvailable(
      barber.id,
      utc('01:30', '2026-07-28'),
      utc('02:00', '2026-07-28'),
    );

    expect(findByBarberAndWeekday).toHaveBeenCalledWith(barber.id, 1);
  });
});
