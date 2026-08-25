import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cradle } from '../../src/container';
import type { ClientProfile } from '../../src/entities/client-profile.entity';
import type { User } from '../../src/entities/user.entity';
import { ForbiddenError, NotFoundError } from '../../src/errors/app-error';
import type { AuthenticatedUser } from '../../src/lib/actor';
import type { ClientStats } from '../../src/repositories/client-profiles.repository';
import { ClientsService } from '../../src/services/clients.service';

const LAST_VISIT = new Date('2030-02-20T13:00:00.000Z');

const client = {
  id: 'client-1',
  name: 'Ana Souza',
  email: 'ana@test.local',
  phone: '+5511999990000',
  role: 'CLIENT',
  active: true,
} as User;

const profile = {
  id: 'profile-1',
  userId: client.id,
  birthday: '1988-03-14',
  preferences: 'máquina 2 na lateral',
  internalNotes: 'always fifteen minutes late',
} as ClientProfile;

const stats: ClientStats = {
  visits: 4,
  lastVisitAt: LAST_VISIT,
  averageTicket: 4500,
  noShows: 1,
};

const ADMIN_ACTOR: AuthenticatedUser = { id: 'admin-1', role: 'ADMIN' };
const MANAGER_ACTOR: AuthenticatedUser = { id: 'manager-1', role: 'MANAGER' };
const BARBER_ACTOR: AuthenticatedUser = { id: 'barber-user-1', role: 'BARBER' };
const SELF_ACTOR: AuthenticatedUser = { id: client.id, role: 'CLIENT' };
const OTHER_CLIENT_ACTOR: AuthenticatedUser = { id: 'client-2', role: 'CLIENT' };

interface Overrides {
  clientProfilesRepository?: Record<string, unknown>;
  usersRepository?: Record<string, unknown>;
  appointmentsService?: Record<string, unknown>;
}

function buildService(overrides: Overrides = {}) {
  const clientProfilesRepository = {
    findByUserId: vi.fn().mockResolvedValue(profile),
    findMany: vi.fn().mockResolvedValue([[], 0]),
    findStats: vi.fn().mockResolvedValue(stats),
    upsert: vi.fn(async (_userId: string, changes: Record<string, unknown>) => ({
      ...profile,
      ...changes,
    })),
    ...overrides.clientProfilesRepository,
  };
  const usersRepository = {
    findById: vi.fn().mockResolvedValue(client),
    ...overrides.usersRepository,
  };
  const appointmentsService = {
    listForClient: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
    ...overrides.appointmentsService,
  };

  const cradle = {
    clientProfilesRepository,
    usersRepository,
    appointmentsService,
  } as unknown as Cradle;

  return {
    service: new ClientsService(cradle),
    clientProfilesRepository,
    usersRepository,
    appointmentsService,
  };
}

describe('ClientsService.get', () => {
  let harness: ReturnType<typeof buildService>;

  beforeEach(() => {
    harness = buildService();
  });

  it('gives staff the whole record, notes and stats included', async () => {
    const result = await harness.service.get(client.id, ADMIN_ACTOR);

    expect(result).toEqual({
      id: client.id,
      name: 'Ana Souza',
      email: 'ana@test.local',
      phone: '+5511999990000',
      active: true,
      birthday: '1988-03-14',
      preferences: 'máquina 2 na lateral',
      internalNotes: 'always fifteen minutes late',
      stats: {
        visits: 4,
        lastVisitAt: LAST_VISIT.toISOString(),
        averageTicketCents: 4500,
        noShows: 1,
      },
    });
  });

  it('gives a barber preferences and stats but no way to contact the client', async () => {
    const result = await harness.service.get(client.id, BARBER_ACTOR);

    expect(result).toEqual({
      id: client.id,
      name: 'Ana Souza',
      birthday: '1988-03-14',
      preferences: 'máquina 2 na lateral',
      stats: {
        visits: 4,
        lastVisitAt: LAST_VISIT.toISOString(),
        averageTicketCents: 4500,
        noShows: 1,
      },
    });
    expect(result).not.toHaveProperty('internalNotes');
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('phone');
  });

  it('gives a client their own profile without the notes written about them', async () => {
    const result = await harness.service.get(client.id, SELF_ACTOR);

    expect(result).toEqual({
      id: client.id,
      name: 'Ana Souza',
      email: 'ana@test.local',
      phone: '+5511999990000',
      birthday: '1988-03-14',
      preferences: 'máquina 2 na lateral',
    });
    expect(result).not.toHaveProperty('internalNotes');
  });

  it('refuses a client reading another client', async () => {
    await expect(harness.service.get(client.id, OTHER_CLIENT_ACTOR)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('reads a client with no profile row as an empty profile', async () => {
    const empty = buildService({
      clientProfilesRepository: { findByUserId: vi.fn().mockResolvedValue(null) },
    });

    const result = await empty.service.get(client.id, ADMIN_ACTOR);

    expect(result).toMatchObject({ birthday: null, preferences: null, internalNotes: null });
  });

  it('does not expose a staff user through the CRM', async () => {
    const staff = buildService({
      usersRepository: { findById: vi.fn().mockResolvedValue({ ...client, role: 'MANAGER' }) },
    });

    await expect(staff.service.get(client.id, ADMIN_ACTOR)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404s an unknown id', async () => {
    const missing = buildService({
      usersRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(missing.service.get(client.id, ADMIN_ACTOR)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ClientsService.list', () => {
  it('maps rows and passes the filters straight through', async () => {
    const inactiveSince = new Date('2030-01-01T00:00:00.000Z');
    const harness = buildService({
      clientProfilesRepository: {
        findMany: vi.fn().mockResolvedValue([
          [
            {
              id: client.id,
              name: 'Ana Souza',
              email: 'ana@test.local',
              phone: null,
              active: true,
              birthday: null,
              preferences: null,
              internalNotes: null,
            },
          ],
          7,
        ]),
      },
    });

    const result = await harness.service.list({
      search: 'ana',
      birthdayMonth: 3,
      inactiveSince,
      limit: 1,
      offset: 4,
    });

    expect(result).toMatchObject({ total: 7, limit: 1, offset: 4 });
    expect(result.items[0]).toMatchObject({ name: 'Ana Souza' });
    expect(harness.clientProfilesRepository.findMany).toHaveBeenCalledWith(
      { search: 'ana', birthdayMonth: 3, inactiveSince },
      { limit: 1, offset: 4 },
    );
  });
});

describe('ClientsService updates', () => {
  let harness: ReturnType<typeof buildService>;

  beforeEach(() => {
    harness = buildService();
  });

  it('lets a manager write internal notes', async () => {
    const result = await harness.service.updateProfile(
      client.id,
      { internalNotes: 'prefers Rafael' },
      MANAGER_ACTOR,
    );

    expect(harness.clientProfilesRepository.upsert).toHaveBeenCalledWith(client.id, {
      internalNotes: 'prefers Rafael',
    });
    expect(result.internalNotes).toBe('prefers Rafael');
  });

  it('refuses a barber editing anything', async () => {
    await expect(
      harness.service.updateProfile(client.id, { preferences: 'fade' }, BARBER_ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(harness.clientProfilesRepository.upsert).not.toHaveBeenCalled();
  });

  it('refuses a client editing another client', async () => {
    await expect(
      harness.service.updateProfile(client.id, { preferences: 'fade' }, OTHER_CLIENT_ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('returns the self shape when a client edits their own profile', async () => {
    const result = await harness.service.updateOwn(client.id, { birthday: '1990-05-05' });

    expect(result).not.toHaveProperty('internalNotes');
    expect(result.birthday).toBe('1990-05-05');
  });
});

describe('ClientsService.getHistory', () => {
  let harness: ReturnType<typeof buildService>;

  beforeEach(() => {
    harness = buildService();
  });

  it('delegates to the appointments module for staff', async () => {
    await harness.service.getHistory(client.id, ADMIN_ACTOR, { limit: 20, offset: 0 });

    expect(harness.appointmentsService.listForClient).toHaveBeenCalledWith(client.id, {
      limit: 20,
      offset: 0,
    });
  });

  it('lets a barber read it', async () => {
    await expect(
      harness.service.getHistory(client.id, BARBER_ACTOR, { limit: 20, offset: 0 }),
    ).resolves.toMatchObject({ total: 0 });
  });

  it('refuses a client reading another client', async () => {
    await expect(
      harness.service.getHistory(client.id, OTHER_CLIENT_ACTOR, { limit: 20, offset: 0 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(harness.appointmentsService.listForClient).not.toHaveBeenCalled();
  });
});
