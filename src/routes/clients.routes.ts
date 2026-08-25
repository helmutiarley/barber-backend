import { Router } from 'express';
import type { AppConfig } from '../config';
import { wrapHandler } from '../lib/wrap-handler';
import { pageQuerySchema } from '../schemas/appointments.schemas';
import {
  clientIdParamsSchema,
  listClientsQuerySchema,
  updateClientSchema,
  updateOwnClientSchema,
} from '../schemas/clients.schemas';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';

export function clientsRoutes(config: AppConfig): Router {
  const router = Router();

  const authenticated = authenticate(config);

  router.get(
    '/clients',
    authenticated,
    authorize('ADMIN', 'MANAGER'),
    validate({ query: listClientsQuerySchema }),
    wrapHandler('clientsController.list'),
  );

  router.get('/clients/me', authenticated, wrapHandler('clientsController.getMine'));

  router.patch(
    '/clients/me',
    authenticated,
    validate({ body: updateOwnClientSchema }),
    wrapHandler('clientsController.updateMine'),
  );

  router.get(
    '/clients/:id',
    authenticated,
    validate({ params: clientIdParamsSchema }),
    wrapHandler('clientsController.getById'),
  );

  router.get(
    '/clients/:id/history',
    authenticated,
    validate({ params: clientIdParamsSchema, query: pageQuerySchema }),
    wrapHandler('clientsController.history'),
  );

  router.patch(
    '/clients/:id',
    authenticated,
    authorize('ADMIN', 'MANAGER'),
    validate({ params: clientIdParamsSchema, body: updateClientSchema }),
    wrapHandler('clientsController.update'),
  );

  return router;
}
