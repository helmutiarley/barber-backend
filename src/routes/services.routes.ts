import { Router } from 'express';
import type { AppConfig } from '../config';
import { wrapHandler } from '../lib/wrap-handler';
import { authenticate, authenticateOptional } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import {
  createServiceSchema,
  listServicesQuerySchema,
  serviceIdParamsSchema,
  updateServiceSchema,
} from '../schemas/services.schemas';

export function servicesRoutes(config: AppConfig): Router {
  const router = Router();

  router.get(
    '/services',
    authenticateOptional(config),
    validate({ query: listServicesQuerySchema }),
    wrapHandler('servicesController.list'),
  );

  router.get(
    '/services/:id',
    validate({ params: serviceIdParamsSchema }),
    wrapHandler('servicesController.getById'),
  );

  router.post(
    '/services',
    authenticate(config),
    authorize('ADMIN'),
    validate({ body: createServiceSchema }),
    wrapHandler('servicesController.create'),
  );

  router.patch(
    '/services/:id',
    authenticate(config),
    authorize('ADMIN'),
    validate({ params: serviceIdParamsSchema, body: updateServiceSchema }),
    wrapHandler('servicesController.update'),
  );

  router.delete(
    '/services/:id',
    authenticate(config),
    authorize('ADMIN'),
    validate({ params: serviceIdParamsSchema }),
    wrapHandler('servicesController.deactivate'),
  );

  return router;
}
