import { Router } from 'express';
import type { AppConfig } from '../config';
import { wrapHandler } from '../lib/wrap-handler';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import {
  adjustStockSchema,
  createProductSchema,
  listProductsQuerySchema,
  listStockAdjustmentsQuerySchema,
  productIdParamsSchema,
  updateProductSchema,
} from '../schemas/products.schemas';

export function productsRoutes(config: AppConfig): Router {
  const router = Router();

  const authenticated = authenticate(config);
  const adminOnly = authorize('ADMIN');

  const readers = authorize('ADMIN', 'MANAGER', 'BARBER');

  router.post(
    '/products',
    authenticated,
    adminOnly,
    validate({ body: createProductSchema }),
    wrapHandler('productsController.create'),
  );

  router.get(
    '/products',
    authenticated,
    readers,
    validate({ query: listProductsQuerySchema }),
    wrapHandler('productsController.list'),
  );

  router.get(
    '/products/:id',
    authenticated,
    readers,
    validate({ params: productIdParamsSchema }),
    wrapHandler('productsController.get'),
  );

  router.patch(
    '/products/:id',
    authenticated,
    adminOnly,
    validate({ params: productIdParamsSchema, body: updateProductSchema }),
    wrapHandler('productsController.update'),
  );

  router.post(
    '/products/:id/stock-adjustments',
    authenticated,
    authorize('ADMIN', 'MANAGER'),
    validate({ params: productIdParamsSchema, body: adjustStockSchema }),
    wrapHandler('productsController.adjustStock'),
  );

  router.get(
    '/products/:id/stock-adjustments',
    authenticated,
    authorize('ADMIN', 'MANAGER'),
    validate({ params: productIdParamsSchema, query: listStockAdjustmentsQuerySchema }),
    wrapHandler('productsController.listAdjustments'),
  );

  router.delete(
    '/products/:id',
    authenticated,
    adminOnly,
    validate({ params: productIdParamsSchema }),
    wrapHandler('productsController.deactivate'),
  );

  return router;
}
