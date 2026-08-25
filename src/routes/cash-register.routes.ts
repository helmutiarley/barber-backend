import { Router } from 'express';
import type { AppConfig } from '../config';
import { wrapHandler } from '../lib/wrap-handler';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import {
  closeSessionSchema,
  createMovementSchema,
  listSessionsQuerySchema,
  openSessionSchema,
  sessionIdParamsSchema,
} from '../schemas/cash-register.schemas';

export function cashRegisterRoutes(config: AppConfig): Router {
  const router = Router();

  const authenticated = authenticate(config);
  const staffOnly = authorize('ADMIN', 'MANAGER');

  router.post(
    '/cash-register/open',
    authenticated,
    staffOnly,
    validate({ body: openSessionSchema }),
    wrapHandler('cashRegisterController.open'),
  );

  router.post(
    '/cash-register/close',
    authenticated,
    staffOnly,
    validate({ body: closeSessionSchema }),
    wrapHandler('cashRegisterController.close'),
  );

  router.get(
    '/cash-register/current',
    authenticated,
    staffOnly,
    wrapHandler('cashRegisterController.current'),
  );

  router.post(
    '/cash-register/movements',
    authenticated,
    staffOnly,
    validate({ body: createMovementSchema }),
    wrapHandler('cashRegisterController.createMovement'),
  );

  router.get(
    '/cash-register/sessions',
    authenticated,
    staffOnly,
    validate({ query: listSessionsQuerySchema }),
    wrapHandler('cashRegisterController.listSessions'),
  );

  router.get(
    '/cash-register/sessions/:id',
    authenticated,
    staffOnly,
    validate({ params: sessionIdParamsSchema }),
    wrapHandler('cashRegisterController.getSession'),
  );

  return router;
}
