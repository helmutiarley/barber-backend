import { Router } from 'express';
import { wrapHandler } from '../lib/wrap-handler';
import { validate } from '../middleware/validate';
import { tlsCheckQuerySchema } from '../schemas/platform.schemas';

export function internalRoutes(): Router {
  const router = Router();

  router.get(
    '/internal/tls-check',
    validate({ query: tlsCheckQuerySchema }),
    wrapHandler('platformController.tlsCheck'),
  );

  return router;
}
