import type { RequestHandler } from 'express';
import type { AppConfig } from '../config';
import { UnauthorizedError } from '../errors/app-error';
import type { AuthenticatedUser } from '../lib/actor';
import { verifyAccessToken } from '../lib/tokens';

export type { AuthenticatedUser };

declare global {

  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function authenticate(config: AppConfig): RequestHandler {
  return (req, _res, next) => {
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      next(new UnauthorizedError('Missing or malformed Authorization header'));
      return;
    }

    try {
      const payload = verifyAccessToken(config, header.slice('Bearer '.length).trim());
      req.user = { id: payload.sub, role: payload.role };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function authenticateOptional(config: AppConfig): RequestHandler {
  const required = authenticate(config);

  return (req, res, next) => {
    if (!req.headers.authorization) {
      next();
      return;
    }

    required(req, res, next);
  };
}

export function requireUser(req: Express.Request): AuthenticatedUser {
  if (!req.user) {
    throw new UnauthorizedError('Authentication required');
  }

  return req.user;
}
