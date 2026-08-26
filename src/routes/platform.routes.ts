import { Router } from 'express';
import type { AppConfig } from '../config';
import { wrapHandler } from '../lib/wrap-handler';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { requirePlatformHost } from '../middleware/resolve-shop';
import { validate } from '../middleware/validate';
import {
  createShopSchema,
  shopIdParamsSchema,
  updateShopSchema,
} from '../schemas/platform.schemas';

export function platformRoutes(config: AppConfig): Router {
  const router = Router();

  router.use(requirePlatformHost());

  router.get(
    '/shops',
    authenticate(config),
    authorize('SUPER_ADMIN'),
    wrapHandler('platformController.list'),
  );

  router.post(
    '/shops',
    authenticate(config),
    authorize('SUPER_ADMIN'),
    validate({ body: createShopSchema }),
    wrapHandler('platformController.create'),
  );

  router.get(
    '/shops/:id',
    authenticate(config),
    authorize('SUPER_ADMIN'),
    validate({ params: shopIdParamsSchema }),
    wrapHandler('platformController.getById'),
  );

  router.get(
    '/shops/:id/domain-check',
    authenticate(config),
    authorize('SUPER_ADMIN'),
    validate({ params: shopIdParamsSchema }),
    wrapHandler('platformController.domainCheck'),
  );

  router.patch(
    '/shops/:id',
    authenticate(config),
    authorize('SUPER_ADMIN'),
    validate({ params: shopIdParamsSchema, body: updateShopSchema }),
    wrapHandler('platformController.update'),
  );

  router.delete(
    '/shops/:id',
    authenticate(config),
    authorize('SUPER_ADMIN'),
    validate({ params: shopIdParamsSchema }),
    wrapHandler('platformController.remove'),
  );

  return router;
}
