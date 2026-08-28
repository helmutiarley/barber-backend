import type { EntityManager } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/config';
import type { Cradle } from '../../src/container';
import type { Appointment } from '../../src/entities/appointment.entity';
import type { Barber } from '../../src/entities/barber.entity';
import type { Service } from '../../src/entities/service.entity';
import type { User } from '../../src/entities/user.entity';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../src/errors/app-error';
import type { AuthenticatedUser } from '../../src/lib/actor';
import type { Clock } from '../../src/lib/clock';
import {
  AppointmentsService,
  type CreateAppointmentInput,
} from '../../src/services/appointments.service';

const NOW = new Date('2030-03-01T09:00:00.000Z');
const AT_10_00 = new Date('2030-03-01T10:00:00.000Z');
const AT_10_30 = new Date('2030-03-01T10:30:00.000Z');

const NEXT_WEEK = new Date('2030-03-08T10:00:00.000Z');

const client = { id: 'client-1', active: true } as User;
const barber = { id: 'barber-1', active: true } as Barber;
const service = { id: 'service-1', active: true, price: 4500, durationMinutes: 30 } as Service;

const storedAppointment = {
  id: 'appointment-1',
  clientId: client.id,
  barberId: barber.id,
  serviceId: service.id,
  status: 'scheduled',
  startsAt: AT_10_00,
  endsAt: AT_10_30,
  price: 4500,
  durationMinutes: 30,
  notes: null,
  cancelledReason: null,
  cancelledBy: null,
  createdBy: client.id,
  createdAt: NOW,
  updatedAt: NOW,
} as Appointment;

function buildService(overrides: Partial<Record<string, Record<string, unknown>>> = {}) {
  const appointmentsRepository = {
    findOverlapping: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
    create: vi.fn(async (data: Record<string, unknown>) => ({
      ...storedAppointment,
      ...data,
    })),
    update: vi.fn(async (id: string, changes: Record<string, unknown>) => ({
      ...storedAppointment,
      id,
      ...changes,
    })),
  };
  const barbersRepository = { findById: vi.fn().mockResolvedValue(barber) };
  const paymentsRepository = {
    sumPaidForAppointments: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, 0]))),
  };
  const servicesRepository = { findById: vi.fn().mockResolvedValue(service) };
  const usersRepository = { findById: vi.fn().mockResolvedValue(client) };
  const availabilityService = { isAvailable: vi.fn().mockResolvedValue(true) };
  const commissionsService = {
    recordForAppointment: vi.fn().mockResolvedValue({ id: 'entry-1' }),
  };
  const cashRegisterService = {
    requireOpenSession: vi.fn().mockResolvedValue({ id: 'session-1' }),
  };
  const clock: Clock = { now: () => NOW };
  const config = { cancellationWindowHours: 24 } as AppConfig;

  Object.assign(appointmentsRepository, overrides.appointmentsRepository);
  Object.assign(barbersRepository, overrides.barbersRepository);
  Object.assign(paymentsRepository, overrides.paymentsRepository);
  Object.assign(servicesRepository, overrides.servicesRepository);
  Object.assign(usersRepository, overrides.usersRepository);
  Object.assign(availabilityService, overrides.availabilityService);
  Object.assign(commissionsService, overrides.commissionsService);
  Object.assign(cashRegisterService, overrides.cashRegisterService);

  const manager = { marker: 'entity-manager' } as unknown as EntityManager;
  const dataSource = {
    transaction: vi.fn(async (work: (manager: EntityManager) => Promise<unknown>) => work(manager)),
  };

  const cradle = {
    appointmentsRepository,
    barbersRepository,
    paymentsRepository,
    servicesRepository,
    usersRepository,
    availabilityService,
    commissionsService,
    cashRegisterService,
    dataSource,
    clock,
    config,
  } as unknown as Cradle;

  return {
    service: new AppointmentsService(cradle),
    appointmentsRepository,
    barbersRepository,
    paymentsRepository,
    servicesRepository,
    usersRepository,
    availabilityService,
    commissionsService,
    cashRegisterService,
    dataSource,
    manager,
  };
}

const validInput: CreateAppointmentInput = {
  clientId: client.id,
  barberId: barber.id,
  serviceId: service.id,
  startsAt: AT_10_00,
};

const CLIENT_ACTOR: AuthenticatedUser = { id: client.id, role: 'CLIENT' };
const MANAGER_ACTOR: AuthenticatedUser = { id: 'manager-1', role: 'MANAGER' };

describe('AppointmentsService.createAppointment', () => {
  let harness: ReturnType<typeof buildService>;

  beforeEach(() => {
    harness = buildService();
  });

  it('books the slot and snapshots price and duration', async () => {
    const result = await harness.service.createAppointment(validInput, CLIENT_ACTOR);

    expect(result).toMatchObject({
      id: 'appointment-1',
      status: 'scheduled',
      priceCents: 4500,
      durationMinutes: 30,
      startsAt: '2030-03-01T10:00:00.000Z',
      endsAt: '2030-03-01T10:30:00.000Z',
    });
  });

  it('derives endsAt from the service duration', async () => {
    const { service: appointments, appointmentsRepository } = buildService({
      servicesRepository: {
        findById: vi.fn().mockResolvedValue({ ...service, durationMinutes: 50 }),
      },
    });

    await appointments.createAppointment(validInput, CLIENT_ACTOR);

    expect(appointmentsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ endsAt: new Date('2030-03-01T10:50:00.000Z') }),
    );
  });

  it('rejects an overlapping slot before touching the database', async () => {
    harness.appointmentsRepository.findOverlapping.mockResolvedValue([{} as Appointment]);

    await expect(
      harness.service.createAppointment(validInput, CLIENT_ACTOR),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(harness.appointmentsRepository.create).not.toHaveBeenCalled();
  });

  it('checks overlap against the full appointment window, not just the start', async () => {
    await harness.service.createAppointment(validInput, CLIENT_ACTOR);

    expect(harness.appointmentsRepository.findOverlapping).toHaveBeenCalledWith(
      barber.id,
      AT_10_00,
      AT_10_30,
      undefined,
    );
  });

  it('rejects a start time in the past', async () => {
    await expect(
      harness.service.createAppointment(
        {
          ...validInput,
          startsAt: new Date('2030-03-01T08:00:00.000Z'),
        },
        CLIENT_ACTOR,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a start time exactly now', async () => {
    await expect(
      harness.service.createAppointment({ ...validInput, startsAt: NOW }, CLIENT_ACTOR),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('does not let staff force a start time in the past', async () => {
    await expect(
      harness.service.createAppointment(
        {
          ...validInput,
          startsAt: new Date('2030-03-01T08:00:00.000Z'),
          force: true,
        },
        MANAGER_ACTOR,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(harness.appointmentsRepository.create).not.toHaveBeenCalled();
  });

  it('books for the caller and records who created it', async () => {
    await harness.service.createAppointment({ ...validInput, clientId: undefined }, CLIENT_ACTOR);

    expect(harness.appointmentsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: client.id, createdBy: client.id }),
    );
  });

  it('refuses a client booking on behalf of someone else', async () => {
    await expect(
      harness.service.createAppointment({ ...validInput, clientId: 'someone-else' }, CLIENT_ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets staff book for a client and attributes creation to the staff member', async () => {
    await harness.service.createAppointment({ ...validInput, clientId: client.id }, MANAGER_ACTOR);

    expect(harness.appointmentsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: client.id, createdBy: MANAGER_ACTOR.id }),
    );
  });

  it.each([
    ['service', 'servicesRepository'],
    ['barber', 'barbersRepository'],
    ['client', 'usersRepository'],
  ])('throws NotFoundError for an unknown %s', async (_label, repositoryName) => {
    const { service: appointments } = buildService({
      [repositoryName]: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(appointments.createAppointment(validInput, CLIENT_ACTOR)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('refuses an inactive service', async () => {
    const { service: appointments } = buildService({
      servicesRepository: { findById: vi.fn().mockResolvedValue({ ...service, active: false }) },
    });

    await expect(appointments.createAppointment(validInput, CLIENT_ACTOR)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('refuses an inactive barber', async () => {
    const { service: appointments } = buildService({
      barbersRepository: { findById: vi.fn().mockResolvedValue({ ...barber, active: false }) },
    });

    await expect(appointments.createAppointment(validInput, CLIENT_ACTOR)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  describe('availability', () => {
    const unavailable = () => ({
      availabilityService: { isAvailable: vi.fn().mockResolvedValue(false) },
    });

    it('checks the barber is free over the whole appointment', async () => {
      await harness.service.createAppointment(validInput, CLIENT_ACTOR);

      expect(harness.availabilityService.isAvailable).toHaveBeenCalledWith(
        barber.id,
        AT_10_00,
        AT_10_30,
        { excludeAppointmentId: undefined },
      );
    });

    it('refuses a slot outside working hours', async () => {
      const { service: appointments, appointmentsRepository } = buildService(unavailable());

      await expect(appointments.createAppointment(validInput, CLIENT_ACTOR)).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(appointmentsRepository.create).not.toHaveBeenCalled();
    });

    it('lets staff force a booking outside working hours', async () => {
      const { service: appointments, appointmentsRepository } = buildService(unavailable());

      await appointments.createAppointment({ ...validInput, force: true }, MANAGER_ACTOR);

      expect(appointmentsRepository.create).toHaveBeenCalled();
    });

    it('does not let a client force one', async () => {
      const { service: appointments } = buildService(unavailable());

      await expect(
        appointments.createAppointment({ ...validInput, force: true }, CLIENT_ACTOR),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('still refuses an overlap when forced — two clients, one chair', async () => {
      const { service: appointments } = buildService({
        ...unavailable(),
        appointmentsRepository: { findOverlapping: vi.fn().mockResolvedValue([{} as Appointment]) },
      });

      await expect(
        appointments.createAppointment({ ...validInput, force: true }, MANAGER_ACTOR),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('skips the availability lookup entirely when forced', async () => {
      const { service: appointments, availabilityService } = buildService(unavailable());

      await appointments.createAppointment({ ...validInput, force: true }, MANAGER_ACTOR);

      expect(availabilityService.isAvailable).not.toHaveBeenCalled();
    });
  });
});

describe('AppointmentsService.getAppointment', () => {
  function harnessWithAppointment(
    overrides: Partial<Record<string, Record<string, unknown>>> = {},
  ) {
    const harness = buildService(overrides);
    harness.appointmentsRepository.findById.mockResolvedValue(storedAppointment);
    return harness;
  }

  it('returns the appointment to its own client', async () => {
    const harness = harnessWithAppointment();

    await expect(
      harness.service.getAppointment('appointment-1', CLIENT_ACTOR),
    ).resolves.toMatchObject({ id: 'appointment-1', priceCents: 4500, isPaid: false });
  });

  it.each([
    [4499, false],
    [4500, true],
    [5000, true],
  ])('reports a paid total of %i cents as isPaid=%s', async (paidCents, isPaid) => {
    const harness = harnessWithAppointment({
      paymentsRepository: {
        sumPaidForAppointments: vi
          .fn()
          .mockResolvedValue(new Map([[storedAppointment.id, paidCents]])),
      },
    });

    await expect(
      harness.service.getAppointment('appointment-1', CLIENT_ACTOR),
    ).resolves.toMatchObject({ isPaid });
  });

  it('returns the appointment to staff', async () => {
    const harness = harnessWithAppointment();

    await expect(
      harness.service.getAppointment('appointment-1', MANAGER_ACTOR),
    ).resolves.toMatchObject({ id: 'appointment-1' });
  });

  it('returns the appointment to the barber working it', async () => {
    const harness = harnessWithAppointment({
      barbersRepository: {
        findById: vi.fn().mockResolvedValue({ ...barber, userId: 'barber-user' }),
      },
    });

    await expect(
      harness.service.getAppointment('appointment-1', { id: 'barber-user', role: 'BARBER' }),
    ).resolves.toMatchObject({ id: 'appointment-1' });
  });

  it('hides it from a different client', async () => {
    const harness = harnessWithAppointment();

    await expect(
      harness.service.getAppointment('appointment-1', { id: 'other-client', role: 'CLIENT' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('hides it from a barber who is not working it', async () => {
    const harness = harnessWithAppointment({
      barbersRepository: {
        findById: vi.fn().mockResolvedValue({ ...barber, userId: 'other-user' }),
      },
    });

    await expect(
      harness.service.getAppointment('appointment-1', { id: 'barber-user', role: 'BARBER' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws NotFoundError when it does not exist', async () => {
    const harness = buildService();
    harness.appointmentsRepository.findById.mockResolvedValue(null);

    await expect(harness.service.getAppointment('missing', MANAGER_ACTOR)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

const OWN_BARBER_ACTOR: AuthenticatedUser = { id: 'barber-user', role: 'BARBER' };
const OTHER_BARBER_ACTOR: AuthenticatedUser = { id: 'someone-else', role: 'BARBER' };

const worksHere = {
  barbersRepository: { findById: vi.fn().mockResolvedValue({ ...barber, userId: 'barber-user' }) },
};

function harnessFor(
  appointment: Partial<Appointment>,
  overrides: Partial<Record<string, Record<string, unknown>>> = {},
) {
  const harness = buildService({ ...worksHere, ...overrides });
  harness.appointmentsRepository.findById.mockResolvedValue({
    ...storedAppointment,
    ...appointment,
  });

  return harness;
}

describe('AppointmentsService.confirm', () => {
  it('moves a scheduled appointment to confirmed', async () => {
    const harness = harnessFor({ status: 'scheduled' });

    const result = await harness.service.confirm('appointment-1', MANAGER_ACTOR);

    expect(result.status).toBe('confirmed');
    expect(harness.appointmentsRepository.update).toHaveBeenCalledWith('appointment-1', {
      status: 'confirmed',
    });
  });

  it('lets the barber working it confirm', async () => {
    const harness = harnessFor({ status: 'scheduled' });

    await expect(harness.service.confirm('appointment-1', OWN_BARBER_ACTOR)).resolves.toMatchObject(
      { status: 'confirmed' },
    );
  });

  it('refuses a barber working someone else’s chair', async () => {
    const harness = harnessFor({ status: 'scheduled' });

    await expect(
      harness.service.confirm('appointment-1', OTHER_BARBER_ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses the client whose appointment it is — confirming is the shop’s call', async () => {
    const harness = harnessFor({ status: 'scheduled' });

    await expect(harness.service.confirm('appointment-1', CLIENT_ACTOR)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('refuses to confirm twice', async () => {
    const harness = harnessFor({ status: 'confirmed' });

    await expect(harness.service.confirm('appointment-1', MANAGER_ACTOR)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe('AppointmentsService.complete', () => {
  it('completes a confirmed appointment', async () => {
    const harness = harnessFor({ status: 'confirmed' });

    await expect(
      harness.service.complete('appointment-1', OWN_BARBER_ACTOR),
    ).resolves.toMatchObject({ status: 'completed' });
  });

  it('records the commission in the same transaction as the status change', async () => {
    const harness = harnessFor({ status: 'confirmed' });

    await harness.service.complete('appointment-1', MANAGER_ACTOR);

    expect(harness.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(harness.appointmentsRepository.update).toHaveBeenCalledWith(
      'appointment-1',
      { status: 'completed' },
      harness.manager,
    );
    expect(harness.commissionsService.recordForAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'appointment-1', status: 'completed' }),
      harness.manager,
    );
  });

  it('lets a missing commission rule take the completion down with it', async () => {
    const harness = harnessFor({ status: 'confirmed' });
    harness.commissionsService.recordForAppointment.mockRejectedValue(
      new ConflictError('No commission rule configured for barber barber-1'),
    );

    await expect(harness.service.complete('appointment-1', MANAGER_ACTOR)).rejects.toThrow(
      /No commission rule configured/,
    );
  });

  it('refuses to complete anything while the register is closed', async () => {
    const harness = harnessFor(
      { status: 'confirmed' },
      {
        cashRegisterService: {
          requireOpenSession: vi
            .fn()
            .mockRejectedValue(new ConflictError('No cash register session is open')),
        },
      },
    );

    await expect(harness.service.complete('appointment-1', MANAGER_ACTOR)).rejects.toThrow(
      /No cash register session is open/,
    );
    expect(harness.appointmentsRepository.update).not.toHaveBeenCalled();
    expect(harness.commissionsService.recordForAppointment).not.toHaveBeenCalled();
  });

  it('refuses to complete one that was never confirmed', async () => {
    const harness = harnessFor({ status: 'scheduled' });

    await expect(harness.service.complete('appointment-1', MANAGER_ACTOR)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it.each(['completed', 'cancelled', 'no_show'] as const)('refuses to leave %s', async (status) => {
    const harness = harnessFor({ status });

    await expect(harness.service.complete('appointment-1', MANAGER_ACTOR)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe('AppointmentsService.markNoShow', () => {
  const PAST = new Date('2030-03-01T08:00:00.000Z');

  it('marks a confirmed appointment whose time has passed', async () => {
    const harness = harnessFor({ status: 'confirmed', startsAt: PAST });

    await expect(
      harness.service.markNoShow('appointment-1', OWN_BARBER_ACTOR),
    ).resolves.toMatchObject({ status: 'no_show' });
  });

  it('refuses before the appointment was due to start', async () => {
    const harness = harnessFor({ status: 'confirmed', startsAt: AT_10_00 });

    await expect(harness.service.markNoShow('appointment-1', MANAGER_ACTOR)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('refuses one that was never confirmed', async () => {
    const harness = harnessFor({ status: 'scheduled', startsAt: PAST });

    await expect(harness.service.markNoShow('appointment-1', MANAGER_ACTOR)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe('AppointmentsService.reschedule', () => {
  const LATER = new Date('2030-03-08T14:00:00.000Z');

  it('moves the appointment and keeps the price and duration snapshots', async () => {
    const harness = harnessFor({ startsAt: NEXT_WEEK });

    const result = await harness.service.reschedule(
      'appointment-1',
      { startsAt: LATER },
      CLIENT_ACTOR,
    );

    expect(result).toMatchObject({ priceCents: 4500, durationMinutes: 30 });
    expect(harness.appointmentsRepository.update).toHaveBeenCalledWith('appointment-1', {
      status: 'scheduled',
      startsAt: LATER,
      endsAt: new Date('2030-03-08T14:30:00.000Z'),
    });
  });

  it('derives the new end from the snapshot, not the current catalogue', async () => {
    const harness = harnessFor(
      { startsAt: NEXT_WEEK, durationMinutes: 45 },
      {
        servicesRepository: {
          findById: vi.fn().mockResolvedValue({ ...service, durationMinutes: 30 }),
        },
      },
    );

    await harness.service.reschedule('appointment-1', { startsAt: LATER }, CLIENT_ACTOR);

    expect(harness.appointmentsRepository.update).toHaveBeenCalledWith(
      'appointment-1',
      expect.objectContaining({ endsAt: new Date('2030-03-08T14:45:00.000Z') }),
    );
  });

  it('drops a confirmed appointment back to scheduled', async () => {
    const harness = harnessFor({ status: 'confirmed', startsAt: NEXT_WEEK });

    await expect(
      harness.service.reschedule('appointment-1', { startsAt: LATER }, MANAGER_ACTOR),
    ).resolves.toMatchObject({ status: 'scheduled' });
  });

  it('does not let the appointment block its own move', async () => {
    const harness = harnessFor({ startsAt: NEXT_WEEK });

    await harness.service.reschedule('appointment-1', { startsAt: LATER }, CLIENT_ACTOR);

    expect(harness.availabilityService.isAvailable).toHaveBeenCalledWith(
      barber.id,
      LATER,
      new Date('2030-03-08T14:30:00.000Z'),
      { excludeAppointmentId: 'appointment-1' },
    );
    expect(harness.appointmentsRepository.findOverlapping).toHaveBeenCalledWith(
      barber.id,
      LATER,
      new Date('2030-03-08T14:30:00.000Z'),
      'appointment-1',
    );
  });

  it('refuses a slot another appointment holds', async () => {
    const harness = harnessFor(
      { startsAt: NEXT_WEEK },
      {
        appointmentsRepository: { findOverlapping: vi.fn().mockResolvedValue([{} as Appointment]) },
      },
    );

    await expect(
      harness.service.reschedule('appointment-1', { startsAt: LATER }, MANAGER_ACTOR),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses a slot outside working hours', async () => {
    const harness = harnessFor(
      { startsAt: NEXT_WEEK },
      { availabilityService: { isAvailable: vi.fn().mockResolvedValue(false) } },
    );

    await expect(
      harness.service.reschedule('appointment-1', { startsAt: LATER }, MANAGER_ACTOR),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('lets staff force one outside working hours', async () => {
    const harness = harnessFor(
      { startsAt: NEXT_WEEK },
      { availabilityService: { isAvailable: vi.fn().mockResolvedValue(false) } },
    );

    await expect(
      harness.service.reschedule('appointment-1', { startsAt: LATER, force: true }, MANAGER_ACTOR),
    ).resolves.toMatchObject({ status: 'scheduled' });
  });

  it('refuses a move into the past', async () => {
    const harness = harnessFor({ startsAt: NEXT_WEEK });

    await expect(
      harness.service.reschedule(
        'appointment-1',
        { startsAt: new Date('2030-02-01T10:00:00.000Z') },
        MANAGER_ACTOR,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('holds a client to the cancellation window', async () => {
    const harness = harnessFor({ startsAt: AT_10_00 });

    await expect(
      harness.service.reschedule('appointment-1', { startsAt: LATER }, CLIENT_ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it.each(['completed', 'cancelled', 'no_show'] as const)(
    'refuses to move one that is %s',
    async (status) => {
      const harness = harnessFor({ status, startsAt: NEXT_WEEK });

      await expect(
        harness.service.reschedule('appointment-1', { startsAt: LATER }, MANAGER_ACTOR),
      ).rejects.toBeInstanceOf(ConflictError);
    },
  );

  it('leaves the notes alone when none are given', async () => {
    const harness = harnessFor({ startsAt: NEXT_WEEK });

    await harness.service.reschedule('appointment-1', { startsAt: LATER }, MANAGER_ACTOR);

    expect(harness.appointmentsRepository.update).toHaveBeenCalledWith(
      'appointment-1',
      expect.not.objectContaining({ notes: expect.anything() }),
    );
  });
});

describe('AppointmentsService.cancel', () => {
  it('lets a client call off their own booking well in advance', async () => {
    const harness = harnessFor({ startsAt: NEXT_WEEK });

    const result = await harness.service.cancel('appointment-1', {}, CLIENT_ACTOR);

    expect(result.status).toBe('cancelled');
    expect(harness.appointmentsRepository.update).toHaveBeenCalledWith('appointment-1', {
      status: 'cancelled',
      cancelledReason: null,
      cancelledBy: client.id,
    });
  });

  it('holds a client to the cancellation window', async () => {
    const harness = harnessFor({ startsAt: AT_10_00 });

    await expect(harness.service.cancel('appointment-1', {}, CLIENT_ACTOR)).rejects.toThrow(
      /24 hours/,
    );
  });

  it('refuses a client cancelling someone else’s', async () => {
    const harness = harnessFor({ startsAt: NEXT_WEEK, clientId: 'another-client' });

    await expect(harness.service.cancel('appointment-1', {}, CLIENT_ACTOR)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('lets staff cancel inside the window, with a reason on the record', async () => {
    const harness = harnessFor({ startsAt: AT_10_00 });

    await harness.service.cancel('appointment-1', { reason: 'Barbeiro doente' }, MANAGER_ACTOR);

    expect(harness.appointmentsRepository.update).toHaveBeenCalledWith('appointment-1', {
      status: 'cancelled',
      cancelledReason: 'Barbeiro doente',
      cancelledBy: MANAGER_ACTOR.id,
    });
  });

  it('makes staff say why', async () => {
    const harness = harnessFor({ startsAt: AT_10_00 });

    await expect(harness.service.cancel('appointment-1', {}, MANAGER_ACTOR)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('treats a blank reason from staff as no reason', async () => {
    const harness = harnessFor({ startsAt: AT_10_00 });

    await expect(
      harness.service.cancel('appointment-1', { reason: '   ' }, MANAGER_ACTOR),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a barber — cancelling is the shop’s decision, not the chair’s', async () => {
    const harness = harnessFor({ startsAt: NEXT_WEEK });

    await expect(
      harness.service.cancel('appointment-1', {}, OWN_BARBER_ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('cancels a confirmed appointment too', async () => {
    const harness = harnessFor({ status: 'confirmed', startsAt: AT_10_00 });

    await expect(
      harness.service.cancel('appointment-1', { reason: 'Cliente ligou' }, MANAGER_ACTOR),
    ).resolves.toMatchObject({ status: 'cancelled' });
  });

  it.each(['completed', 'cancelled', 'no_show'] as const)(
    'refuses to cancel one that is already %s',
    async (status) => {
      const harness = harnessFor({ status, startsAt: AT_10_00 });

      await expect(
        harness.service.cancel('appointment-1', { reason: 'Tarde demais' }, MANAGER_ACTOR),
      ).rejects.toBeInstanceOf(ConflictError);
    },
  );
});
