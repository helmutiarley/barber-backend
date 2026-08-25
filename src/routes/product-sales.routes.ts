import { Router } from 'express';
import type { AppConfig } from '../config';
import { wrapHandler } from '../lib/wrap-handler';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import {
  listProductSalesQuerySchema,
  saleIdParamsSchema,
  sellProductsSchema,
  voidSaleSchema,
} from '../schemas/product-sales.schemas';

export function productSalesRoutes(config: AppConfig): Router {
  const router = Router();

  const authenticated = authenticate(config);

  const counter = authorize('ADMIN', 'MANAGER');

  router.post(
    '/product-sales',
    authenticated,
    counter,
    validate({ body: sellProductsSchema }),
    wrapHandler('productSalesController.sell'),
  );

  router.get(
    '/product-sales',
    authenticated,
    counter,
    validate({ query: listProductSalesQuerySchema }),
    wrapHandler('productSalesController.list'),
  );

  router.get(
    '/product-sales/:id',
    authenticated,
    counter,
    validate({ params: saleIdParamsSchema }),
    wrapHandler('productSalesController.get'),
  );

  router.post(
    '/product-sales/:id/void',
    authenticated,
    authorize('ADMIN'),
    validate({ params: saleIdParamsSchema, body: voidSaleSchema }),
    wrapHandler('productSalesController.voidSale'),
  );

  return router;
}
