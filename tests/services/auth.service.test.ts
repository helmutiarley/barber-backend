import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/config';
import type { Cradle } from '../../src/container';
import type { RefreshToken } from '../../src/entities/refresh-token.entity';
import type { User } from '../../src/entities/user.entity';
import { ConflictError, UnauthorizedError } from '../../src/errors/app-error';
import type { Clock } from '../../src/lib/clock';
import { hashPassword } from '../../src/lib/password';
import { hashRefreshToken, verifyAccessToken } from '../../src/lib/tokens';
import { AuthService } from '../../src/services/auth.service';

const NOW = new Date('2030-03-01T09:00:00.000Z');
const PASSWORD = 'correct horse battery staple';

const config = {
  jwtSecret: 'test-jwt-secret-that-is-at-least-32-characters-long',
  accessTokenTtl: '15m',
  refreshTokenTtlDays: 30,
} as AppConfig;

let passwordHash: string;

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    name: 'Cliente',
    email: 'cliente@test.local',
    phone: null,
    passwordHash,
    role: 'CLIENT',
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as User;
}

function buildStoredToken(overrides: Partial<RefreshToken> = {}): RefreshToken {
  return {
    id: 'token-1',
    userId: 'user-1',
    tokenHash: 'unused',
    familyId: 'family-1',
    expiresAt: new Date('2030-04-01T09:00:00.000Z'),
    revokedAt: null,
    createdAt: NOW,
    ...overrides,
  } as RefreshToken;
}

interface Overrides {
  usersRepository?: Record<string, unknown>;
  refreshTokensRepository?: Record<string, unknown>;
}

function buildService(overrides: Overrides = {}) {
  const usersRepository = {
    findByEmail: vi.fn().mockResolvedValue(null),
    findByEmailWithPassword: vi.fn().mockResolvedValue(buildUser()),
    findById: vi.fn().mockResolvedValue(buildUser()),
    create: vi.fn(async (data: Record<string, unknown>) => buildUser(data as Partial<User>)),
    ...overrides.usersRepository,
  };
  const refreshTokensRepository = {
    create: vi.fn(async (data: Record<string, unknown>) => data),
    findByHash: vi.fn().mockResolvedValue(null),
    revoke: vi.fn(),
    revokeFamily: vi.fn(),
    ...overrides.refreshTokensRepository,
  };
  const clock: Clock = { now: () => NOW };

  const cradle = {
    usersRepository,
    refreshTokensRepository,
    config,
    clock,
  } as unknown as Cradle;

  return { service: new AuthService(cradle), usersRepository, refreshTokensRepository };
}

beforeEach(async () => {
  passwordHash ??= await hashPassword(PASSWORD);
});

describe('register', () => {
  it('creates a CLIENT and returns a usable access token', async () => {
    const { service, usersRepository } = buildService();

    const result = await service.register({
      name: 'Cliente',
      email: 'cliente@test.local',
      password: PASSWORD,
    });

    expect(usersRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'CLIENT' }),
    );
    expect(verifyAccessToken(config, result.accessToken)).toMatchObject({ role: 'CLIENT' });
  });

  it('never stores the raw password', async () => {
    const { service, usersRepository } = buildService();

    await service.register({ name: 'Cliente', email: 'c@test.local', password: PASSWORD });

    const created = usersRepository.create.mock.calls[0][0] as { passwordHash: string };
    expect(created.passwordHash).not.toContain(PASSWORD);
    expect(created.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('stores only the hash of the refresh token', async () => {
    const { service, refreshTokensRepository } = buildService();

    const result = await service.register({
      name: 'Cliente',
      email: 'c@test.local',
      password: PASSWORD,
    });

    const stored = refreshTokensRepository.create.mock.calls[0][0] as { tokenHash: string };
    expect(stored.tokenHash).toBe(hashRefreshToken(result.refreshToken));
    expect(stored.tokenHash).not.toBe(result.refreshToken);
  });

  it('rejects an email that already exists', async () => {
    const { service } = buildService({
      usersRepository: { findByEmail: vi.fn().mockResolvedValue(buildUser()) },
    });

    await expect(
      service.register({ name: 'Cliente', email: 'taken@test.local', password: PASSWORD }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('login', () => {
  it('succeeds with the right password', async () => {
    const { service } = buildService();

    await expect(service.login('cliente@test.local', PASSWORD)).resolves.toMatchObject({
      user: { email: 'cliente@test.local' },
    });
  });

  it.each([
    ['an unknown email', null],
    ['a deactivated account', buildUser({ active: false })],
    ['an account with no password (walk-in)', buildUser({ passwordHash: null })],
  ])('fails indistinguishably for %s', async (_label, user) => {
    const { service } = buildService({
      usersRepository: { findByEmailWithPassword: vi.fn().mockResolvedValue(user) },
    });

    await expect(service.login('cliente@test.local', PASSWORD)).rejects.toThrow(
      new UnauthorizedError('Invalid credentials'),
    );
  });

  it('fails with the same error for a wrong password', async () => {
    const { service } = buildService();

    await expect(service.login('cliente@test.local', 'wrong')).rejects.toThrow(
      new UnauthorizedError('Invalid credentials'),
    );
  });
});

describe('refresh', () => {
  it('rotates the token within the same family', async () => {
    const { service, refreshTokensRepository } = buildService({
      refreshTokensRepository: {
        findByHash: vi.fn().mockResolvedValue(buildStoredToken()),
      },
    });

    const result = await service.refresh('some-token');

    expect(refreshTokensRepository.revoke).toHaveBeenCalledWith('token-1', NOW);
    expect(refreshTokensRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ familyId: 'family-1' }),
    );
    expect(result.refreshToken).toBeTruthy();
  });

  it('burns the whole family when a revoked token is replayed', async () => {
    const { service, refreshTokensRepository } = buildService({
      refreshTokensRepository: {
        findByHash: vi.fn().mockResolvedValue(buildStoredToken({ revokedAt: NOW })),
      },
    });

    await expect(service.refresh('stolen-token')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(refreshTokensRepository.revokeFamily).toHaveBeenCalledWith('family-1', NOW);
    expect(refreshTokensRepository.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown token', async () => {
    const { service } = buildService();

    await expect(service.refresh('never-issued')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects an expired token without burning the family', async () => {
    const { service, refreshTokensRepository } = buildService({
      refreshTokensRepository: {
        findByHash: vi
          .fn()
          .mockResolvedValue(buildStoredToken({ expiresAt: new Date('2030-02-01T09:00:00Z') })),
      },
    });

    await expect(service.refresh('old-token')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(refreshTokensRepository.revokeFamily).not.toHaveBeenCalled();
  });

  it('rejects and burns the family when the user was deactivated', async () => {
    const { service, refreshTokensRepository } = buildService({
      usersRepository: { findById: vi.fn().mockResolvedValue(buildUser({ active: false })) },
      refreshTokensRepository: {
        findByHash: vi.fn().mockResolvedValue(buildStoredToken()),
      },
    });

    await expect(service.refresh('valid-token')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(refreshTokensRepository.revokeFamily).toHaveBeenCalledWith('family-1', NOW);
  });
});

describe('logout', () => {
  it('revokes the presented token', async () => {
    const { service, refreshTokensRepository } = buildService({
      refreshTokensRepository: {
        findByHash: vi.fn().mockResolvedValue(buildStoredToken()),
      },
    });

    await service.logout('some-token');

    expect(refreshTokensRepository.revoke).toHaveBeenCalledWith('token-1', NOW);
  });

  it('is a no-op for an unknown token', async () => {
    const { service, refreshTokensRepository } = buildService();

    await expect(service.logout('never-issued')).resolves.toBeUndefined();
    expect(refreshTokensRepository.revoke).not.toHaveBeenCalled();
  });
});
