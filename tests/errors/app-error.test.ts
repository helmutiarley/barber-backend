import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../src/errors/app-error';

describe('AppError hierarchy', () => {
  it.each([
    [ValidationError, 'VALIDATION_ERROR', 400],
    [UnauthorizedError, 'UNAUTHORIZED', 401],
    [ForbiddenError, 'FORBIDDEN', 403],
    [NotFoundError, 'NOT_FOUND', 404],
    [ConflictError, 'CONFLICT', 409],
  ] as const)('%o carries the right code and httpStatus', (ErrorClass, code, httpStatus) => {
    const error = new ErrorClass();

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(code);
    expect(error.httpStatus).toBe(httpStatus);
  });

  it('keeps a custom message', () => {
    const error = new ConflictError('barber already booked');
    expect(error.message).toBe('barber already booked');
  });

  it('exposes validation details', () => {
    const error = new ValidationError('bad input', [{ field: 'name' }]);
    expect(error.details).toEqual([{ field: 'name' }]);
  });
});
