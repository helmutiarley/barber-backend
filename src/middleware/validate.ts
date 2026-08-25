import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { ValidationError } from '../errors/app-error';

export interface ValidationSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

export interface Validated {
  body: unknown;
  params: unknown;
  query: unknown;
}

declare global {

  namespace Express {
    interface Request {
      validated: Validated;
    }
  }
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    const validated: Validated = { body: undefined, params: undefined, query: undefined };
    const issues: { location: string; field: string; message: string }[] = [];

    for (const location of ['body', 'params', 'query'] as const) {
      const schema = schemas[location];
      if (!schema) continue;

      const result = schema.safeParse(req[location]);
      if (result.success) {
        validated[location] = result.data;
      } else {
        issues.push(
          ...result.error.issues.map((issue) => ({
            location,
            field: issue.path.join('.'),
            message: issue.message,
          })),
        );
      }
    }

    if (issues.length > 0) {
      next(new ValidationError('Invalid request', issues));
      return;
    }

    req.validated = validated;
    next();
  };
}
