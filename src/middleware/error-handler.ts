import type { ErrorRequestHandler } from 'express';

import type {} from 'pino-http';
import { AppError } from '../errors/app-error';

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof AppError) {
    req.log.warn({ code: error.code }, error.message);
    res.status(error.httpStatus).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    });
    return;
  }

  req.log.error({ err: error }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
};
