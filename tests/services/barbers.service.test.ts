import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cradle } from '../../src/container';
import type { Appointment } from '../../src/entities/appointment.entity';
import type { Barber } from '../../src/entities/barber.entity';
import type { User } from '../../src/entities/user.entity';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../src/errors/app-error';
import type { AuthenticatedUser } from '../../src/lib/actor';
import type { Clock } from '../../src/lib/clock';
import { BarbersService } from '../../src/services/barbers.service';

const NOW = new Date('2030-03-01T09:00:00.000Z');

const barberUser = { id: 'user-1', role: 'BARBER' } as User;
const barber = {
  id: 'barber-1',
  userId: barberUser.id,
  displayName: 'Rafael',
  photoUrl: null,
  specialties: ['fade'],
  active: true,
  createdAt: NOW,
} as Barber;

const ADMIN_ACTOR: AuthenticatedUser = { id: 'admin-1', role: 'ADMIN' };
const MANAGER_ACTOR: AuthenticatedUser = { id: 'manager-1', role: 'MANAGER' };
const OWN_BARBER_ACTOR: AuthenticatedUser = { id: barberUser.id, role: 'BARBER' };
const OTHER_BARBER_ACTOR: AuthenticatedUser = { id: 'user-2', role: 'BARBER' };

interface Overrides {
  barbersRepository?: Record<string, unknown>;
  barberSchedulesRepository?: Record<string, unknown>;
  barberBlocksRepository?: Record<string, unknown>;
  usersRepository?: Record<string, unknown>;
  appointmentsRepository?: Record<string, unknown>;
}

function buildService(overrides: Overrides = {}) {
  const barbersRepository = {
    findById: vi.fn().mockResolvedValue(barber),
    findByUserId: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([barber]),
    create: vi.fn(async (data: Record<string, unknown>) => ({
      ...barber,
      ...data,
      id: 'barber-new',
    })),
    update: vi.fn(async (_id: string, data: Record<string, unknown>) => ({ ...barber, ...data })),
    ...overrides.barbersRepository,
  };
  const barberSchedulesRepository = {
    findByBarber: vi.fn().mockResolvedValue([]),
    findByBarberAndWeekday: vi.fn().mockResolvedValue(null),
    replaceWeek: vi.fn(async (_barberId: string, days: unknown[]) => days),
    ...overrides.barberSchedulesRepository,
  };
  const barberBlocksRepository = {
    findById: vi.fn().mockResolvedValue(null),
    findOverlapping: vi.fn().mockResolvedValue([]),
    create: vi.fn(async (data: Record<string, unknown>) => ({
      id: 'block-1',
      reason: null,
      ...data,
    })),
    delete: vi.fn(),
    ...overrides.barberBlocksRepository,
  };
  const usersRepository = {
    findById: vi.fn().mockResolvedValue(barberUser),
    ...overrides.usersRepository,
  };
  const appointmentsRepository = {
    findUpcomingActive: vi.fn().mockResolvedValue([]),
    findActiveBetween: vi.fn().mockResolvedValue([]),
    ...overrides.appointmentsRepository,
  };
  const clock: Clock = { now: () => NOW };

  const cradle = {
    barbersRepository,
    barberSchedulesRepository,
    barberBlocksRepository,
    usersRepository,
    appointmentsRepository,
    clock,
  } as unknown as Cradle;

  return {
    service: new BarbersService(cradle),
    barbersRepository,
    barberSchedulesRepository,
    barberBlocksRepository,
    usersRepository,
    appointmentsRepository,
  };
}

describe('BarbersService.create', () => {
  let harness: ReturnType<typeof buildService>;

  beforeEach(() => {
    harness = buildService();
  });

  it('creates a profile for a BARBER user', async () => {
    const result = await harness.service.create({
      userId: barberUser.id,
      displayName: 'Rafael',
    });

    expect(result).toMatchObject({ id: 'barber-new', displayName: 'Rafael' });
  });

  it('rejects a user that does not exist', async () => {
    const { service } = buildService({
      usersRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(service.create({ userId: 'ghost', displayName: 'X' })).rejects.toThrow(
      NotFoundError,
    );
  });

  it.each([['CLIENT'], ['ADMIN'], ['MANAGER']] as const)(
    'rejects a user whose role is %s',
    async (role) => {
      const { service } = buildService({
        usersRepository: { findById: vi.fn().mockResolvedValue({ ...barberUser, role }) },
      });

      await expect(service.create({ userId: barberUser.id, displayName: 'X' })).rejects.toThrow(
        ValidationError,
      );
    },
  );

  it('rejects a second profile for the same user', async () => {
    const { service } = buildService({
      barbersRepository: {
        findByUserId: vi.fn().mockResolvedValue(barber),
        create: vi.fn(),
      },
    });

    await expect(service.create({ userId: barberUser.id, displayName: 'X' })).rejects.toThrow(
      ConflictError,
    );
  });
});

describe('BarbersService.listPublic', () => {
  it('asks only for active barbers and hides internal fields', async () => {
    const harness = buildService();

    const result = await harness.service.listPublic();

    expect(harness.barbersRepository.findMany).toHaveBeenCalledWith({ active: true });
    expect(result[0]).toEqual({
      id: barber.id,
      displayName: barber.displayName,
      photoUrl: null,
      specialties: ['fade'],
    });
    expect(result[0]).not.toHaveProperty('userId');
  });
});

describe('BarbersService.update', () => {
  it('lets an ADMIN edit any profile', async () => {
    const harness = buildService();

    const result = await harness.service.update(barber.id, { displayName: 'Novo' }, ADMIN_ACTOR);

    expect(result.displayName).toBe('Novo');
  });

  it('lets a barber edit their own profile', async () => {
    const harness = buildService();

    await expect(
      harness.service.update(barber.id, { displayName: 'Novo' }, OWN_BARBER_ACTOR),
    ).resolves.toMatchObject({ displayName: 'Novo' });
  });

  it('refuses a barber editing someone else', async () => {
    const harness = buildService();

    await expect(
      harness.service.update(barber.id, { displayName: 'Novo' }, OTHER_BARBER_ACTOR),
    ).rejects.toThrow(ForbiddenError);
  });

  it('refuses a MANAGER: agendas yes, identities no', async () => {
    const harness = buildService();

    await expect(
      harness.service.update(barber.id, { displayName: 'Novo' }, MANAGER_ACTOR),
    ).rejects.toThrow(ForbiddenError);
  });

  it('404s on an unknown barber', async () => {
    const { service } = buildService({
      barbersRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(service.update('ghost', { displayName: 'X' }, ADMIN_ACTOR)).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('BarbersService.deactivate', () => {
  it('soft deletes when the agenda is clear', async () => {
    const harness = buildService();

    const result = await harness.service.deactivate(barber.id);

    expect(harness.barbersRepository.update).toHaveBeenCalledWith(barber.id, { active: false });
    expect(result.active).toBe(false);
  });

  it('refuses while future appointments stand, and names them', async () => {
    const upcoming = [
      { id: 'appointment-1', startsAt: new Date('2030-03-02T10:00:00.000Z') },
      { id: 'appointment-2', startsAt: new Date('2030-03-03T11:00:00.000Z') },
    ] as Appointment[];
    const harness = buildService({
      appointmentsRepository: { findUpcomingActive: vi.fn().mockResolvedValue(upcoming) },
    });

    const error = await harness.service.deactivate(barber.id).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).details).toEqual([
      { id: 'appointment-1', startsAt: '2030-03-02T10:00:00.000Z' },
      { id: 'appointment-2', startsAt: '2030-03-03T11:00:00.000Z' },
    ]);
    expect(harness.barbersRepository.update).not.toHaveBeenCalled();
  });

  it('only counts appointments from now onwards', async () => {
    const harness = buildService();

    await harness.service.deactivate(barber.id);

    expect(harness.appointmentsRepository.findUpcomingActive).toHaveBeenCalledWith(barber.id, NOW);
  });

  it('is idempotent for an already inactive barber', async () => {
    const harness = buildService({
      barbersRepository: {
        findById: vi.fn().mockResolvedValue({ ...barber, active: false }),
        update: vi.fn(),
      },
    });

    const result = await harness.service.deactivate(barber.id);

    expect(result.active).toBe(false);
    expect(harness.barbersRepository.update).not.toHaveBeenCalled();
  });
});

describe('BarbersService schedule and blocks', () => {
  const week = [{ weekday: 1, startTime: '09:00:00', endTime: '18:00:00' }];

  it.each([
    ['ADMIN', ADMIN_ACTOR],
    ['MANAGER', MANAGER_ACTOR],
    ['the barber themself', OWN_BARBER_ACTOR],
  ])('lets %s replace the week', async (_label, actor) => {
    const harness = buildService();

    await expect(harness.service.replaceSchedule(barber.id, week, actor)).resolves.toHaveLength(1);
    expect(harness.barberSchedulesRepository.replaceWeek).toHaveBeenCalledWith(barber.id, week);
  });

  it('refuses another barber', async () => {
    const harness = buildService();

    await expect(
      harness.service.replaceSchedule(barber.id, week, OTHER_BARBER_ACTOR),
    ).rejects.toThrow(ForbiddenError);
    expect(harness.barberSchedulesRepository.replaceWeek).not.toHaveBeenCalled();
  });

  it('creates a block when the period is free', async () => {
    const harness = buildService();
    const startsAt = new Date('2030-03-02T12:00:00.000Z');
    const endsAt = new Date('2030-03-02T13:00:00.000Z');

    const result = await harness.service.createBlock(
      barber.id,
      { startsAt, endsAt, reason: 'dentist' },
      MANAGER_ACTOR,
    );

    expect(result).toMatchObject({ id: 'block-1', reason: 'dentist' });
    expect(harness.appointmentsRepository.findActiveBetween).toHaveBeenCalledWith(
      barber.id,
      startsAt,
      endsAt,
    );
  });

  it('refuses a block over a live appointment', async () => {
    const harness = buildService({
      appointmentsRepository: {
        findActiveBetween: vi
          .fn()
          .mockResolvedValue([
            { id: 'appointment-9', startsAt: new Date('2030-03-02T12:30:00.000Z') },
          ] as Appointment[]),
      },
    });

    const error = await harness.service
      .createBlock(
        barber.id,
        {
          startsAt: new Date('2030-03-02T12:00:00.000Z'),
          endsAt: new Date('2030-03-02T13:00:00.000Z'),
        },
        ADMIN_ACTOR,
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).details).toEqual([
      { id: 'appointment-9', startsAt: '2030-03-02T12:30:00.000Z' },
    ]);
    expect(harness.barberBlocksRepository.create).not.toHaveBeenCalled();
  });

  it('will not delete a block belonging to a different barber', async () => {
    const harness = buildService({
      barberBlocksRepository: {
        findById: vi.fn().mockResolvedValue({ id: 'block-1', barberId: 'barber-other' }),
      },
    });

    await expect(harness.service.deleteBlock(barber.id, 'block-1', ADMIN_ACTOR)).rejects.toThrow(
      NotFoundError,
    );
    expect(harness.barberBlocksRepository.delete).not.toHaveBeenCalled();
  });
});

describe('BarbersService.deactivateByUserId', () => {
  it('does nothing for a user without a profile', async () => {
    const harness = buildService({
      barbersRepository: { findByUserId: vi.fn().mockResolvedValue(null), update: vi.fn() },
    });

    await expect(harness.service.deactivateByUserId('user-x')).resolves.toBeUndefined();
    expect(harness.barbersRepository.update).not.toHaveBeenCalled();
  });

  it('applies the same upcoming-appointment guard', async () => {
    const harness = buildService({
      barbersRepository: {
        findByUserId: vi.fn().mockResolvedValue(barber),
        update: vi.fn(),
      },
      appointmentsRepository: {
        findUpcomingActive: vi
          .fn()
          .mockResolvedValue([{ id: 'a-1', startsAt: NOW }] as Appointment[]),
      },
    });

    await expect(harness.service.deactivateByUserId(barberUser.id)).rejects.toThrow(ConflictError);
    expect(harness.barbersRepository.update).not.toHaveBeenCalled();
  });
});
