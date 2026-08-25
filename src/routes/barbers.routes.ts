import { Router } from 'express';
import type { AppConfig } from '../config';
import { wrapHandler } from '../lib/wrap-handler';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import {
  availabilityQuerySchema,
  barberIdParamsSchema,
  blockIdParamsSchema,
  createBarberSchema,
  createBlockSchema,
  replaceScheduleSchema,
  updateBarberSchema,
} from '../schemas/barbers.schemas';

export function barbersRoutes(config: AppConfig): Router {
  const router = Router();
  const authenticated = authenticate(config);

  router.get('/barbers', wrapHandler('barbersController.list'));

  router.get(
    '/barbers/:id',
    validate({ params: barberIdParamsSchema }),
    wrapHandler('barbersController.getById'),
  );

  router.get(
    '/barbers/:id/availability',
    validate({ params: barberIdParamsSchema, query: availabilityQuerySchema }),
    wrapHandler('barbersController.availability'),
  );

  router.post(
    '/barbers',
    authenticated,
    authorize('ADMIN'),
    validate({ body: createBarberSchema }),
    wrapHandler('barbersController.create'),
  );

  router.patch(
    '/barbers/:id',
    authenticated,
    validate({ params: barberIdParamsSchema, body: updateBarberSchema }),
    wrapHandler('barbersController.update'),
  );

  router.delete(
    '/barbers/:id',
    authenticated,
    authorize('ADMIN'),
    validate({ params: barberIdParamsSchema }),
    wrapHandler('barbersController.deactivate'),
  );

  router.get(
    '/barbers/:id/schedule',
    authenticated,
    validate({ params: barberIdParamsSchema }),
    wrapHandler('barbersController.getSchedule'),
  );

  router.put(
    '/barbers/:id/schedule',
    authenticated,
    validate({ params: barberIdParamsSchema, body: replaceScheduleSchema }),
    wrapHandler('barbersController.replaceSchedule'),
  );

  router.post(
    '/barbers/:id/blocks',
    authenticated,
    validate({ params: barberIdParamsSchema, body: createBlockSchema }),
    wrapHandler('barbersController.createBlock'),
  );

  router.delete(
    '/barbers/:id/blocks/:blockId',
    authenticated,
    validate({ params: blockIdParamsSchema }),
    wrapHandler('barbersController.deleteBlock'),
  );

  return router;
}
