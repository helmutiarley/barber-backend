import type { RequestHandler } from 'express';
import type { UserRole } from '../entities/enums';
import { ForbiddenError, UnauthorizedError } from '../errors/app-error';

export function authorize(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError('You do not have access to this resource'));
      return;
    }

    next();
  };
}
