import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { AppConfig } from '../config';
import type { UserRole } from '../entities/enums';
import { UnauthorizedError } from '../errors/app-error';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
}

export function signAccessToken(config: AppConfig, payload: AccessTokenPayload): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.accessTokenTtl as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(config: AppConfig, token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (typeof decoded === 'string' || typeof decoded.sub !== 'string' || !('role' in decoded)) {
      throw new Error('malformed payload');
    }

    return { sub: decoded.sub, role: decoded.role as UserRole };
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
