import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/config';
import { UnauthorizedError } from '../../src/errors/app-error';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from '../../src/lib/tokens';

const config = {
  jwtSecret: 'test-secret-that-is-at-least-32-characters-long',
  accessTokenTtl: '15m',
} as AppConfig;

describe('access tokens', () => {
  it('round-trips the subject and role', () => {
    const token = signAccessToken(config, { sub: 'user-1', role: 'ADMIN', shopId: 'shop-1' });

    expect(verifyAccessToken(config, token)).toMatchObject({
      sub: 'user-1',
      role: 'ADMIN',
      shopId: 'shop-1',
    });
  });

  it('rejects a token signed with another secret', () => {
    const forged = jwt.sign({ sub: 'user-1', role: 'ADMIN' }, 'a-completely-different-secret');

    expect(() => verifyAccessToken(config, forged)).toThrow(UnauthorizedError);
  });

  it('rejects an expired token', () => {
    const expired = signAccessToken(
      { ...config, accessTokenTtl: '-1s' },
      {
        sub: 'user-1',
        role: 'CLIENT',
        shopId: null,
      },
    );

    expect(() => verifyAccessToken(config, expired)).toThrow(UnauthorizedError);
  });

  it('rejects garbage', () => {
    expect(() => verifyAccessToken(config, 'not.a.token')).toThrow(UnauthorizedError);
  });
});

describe('refresh tokens', () => {
  it('generates unguessable, unique tokens', () => {
    const tokens = new Set(Array.from({ length: 100 }, generateRefreshToken));

    expect(tokens.size).toBe(100);
    expect(generateRefreshToken()).toHaveLength(43);
  });

  it('hashes deterministically and irreversibly', () => {
    const token = generateRefreshToken();

    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    expect(hashRefreshToken(token)).not.toContain(token);
    expect(hashRefreshToken(token)).toHaveLength(64);
  });
});
