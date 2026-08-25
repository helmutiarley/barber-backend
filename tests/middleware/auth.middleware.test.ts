import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/config';
import { ForbiddenError, UnauthorizedError } from '../../src/errors/app-error';
import { signAccessToken } from '../../src/lib/tokens';
import { authenticate } from '../../src/middleware/authenticate';
import { authorize } from '../../src/middleware/authorize';

const config = {
  jwtSecret: 'test-jwt-secret-that-is-at-least-32-characters-long',
  accessTokenTtl: '15m',
} as AppConfig;

function run(middleware: ReturnType<typeof authenticate>, req: Partial<Request>) {
  const next = vi.fn() as unknown as NextFunction;
  middleware(req as Request, {} as Response, next);
  return { req, next: next as unknown as ReturnType<typeof vi.fn> };
}

describe('authenticate', () => {
  it('attaches the user from a valid Bearer token', () => {
    const token = signAccessToken(config, { sub: 'user-1', role: 'MANAGER' });

    const { req, next } = run(authenticate(config), {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual({ id: 'user-1', role: 'MANAGER' });
  });

  it.each([
    ['no header', undefined],
    ['a non-Bearer scheme', 'Basic dXNlcjpwYXNz'],
    ['a garbage token', 'Bearer not-a-jwt'],
  ])('rejects %s', (_label, authorization) => {
    const { next } = run(authenticate(config), { headers: { authorization } });

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('rejects an expired token', () => {
    const expired = signAccessToken(
      { ...config, accessTokenTtl: '-1s' },
      {
        sub: 'user-1',
        role: 'CLIENT',
      },
    );

    const { next } = run(authenticate(config), {
      headers: { authorization: `Bearer ${expired}` },
    });

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });
});

describe('authorize', () => {
  it('passes a permitted role through', () => {
    const { next } = run(authorize('ADMIN', 'MANAGER'), {
      user: { id: 'user-1', role: 'MANAGER' },
    });

    expect(next).toHaveBeenCalledWith();
  });

  it('forbids a role outside the list', () => {
    const { next } = run(authorize('ADMIN'), { user: { id: 'user-1', role: 'BARBER' } });

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it('rejects an unauthenticated request', () => {
    const { next } = run(authorize('ADMIN'), {});

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });
});
