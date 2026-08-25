import { Router } from 'express';
import type { AppConfig } from '../config';
import { wrapHandler } from '../lib/wrap-handler';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import {
  barberIdParamsSchema,
  rangeQuerySchema,
  revenueQuerySchema,
  topServicesQuerySchema,
} from '../schemas/reports.schemas';

export function reportsRoutes(config: AppConfig): Router {
  const router = Router();

  const authenticated = authenticate(config);

  const owner = authorize('ADMIN', 'MANAGER');

  router.get(
    '/reports/revenue',
    authenticated,
    owner,
    validate({ query: revenueQuerySchema }),
    wrapHandler('reportsController.revenue'),
  );

  router.get(
    '/reports/average-ticket',
    authenticated,
    owner,
    validate({ query: rangeQuerySchema }),
    wrapHandler('reportsController.averageTicket'),
  );

  router.get(
    '/reports/top-services',
    authenticated,
    owner,
    validate({ query: topServicesQuerySchema }),
    wrapHandler('reportsController.topServices'),
  );

  router.get(
    '/reports/products',
    authenticated,
    owner,
    validate({ query: rangeQuerySchema }),
    wrapHandler('reportsController.products'),
  );

  router.get(
    '/reports/dre',
    authenticated,
    owner,
    validate({ query: rangeQuerySchema }),
    wrapHandler('reportsController.dre'),
  );

  router.get(
    '/reports/occupancy',
    authenticated,
    owner,
    validate({ query: rangeQuerySchema }),
    wrapHandler('reportsController.occupancy'),
  );

  router.get(
    '/reports/no-shows',
    authenticated,
    owner,
    validate({ query: rangeQuerySchema }),
    wrapHandler('reportsController.noShows'),
  );

  router.get(
    '/reports/clients',
    authenticated,
    owner,
    validate({ query: rangeQuerySchema }),
    wrapHandler('reportsController.clients'),
  );

  router.get(
    '/reports/barbers/:id/summary',
    authenticated,
    authorize('ADMIN', 'MANAGER', 'BARBER'),
    validate({ params: barberIdParamsSchema, query: rangeQuerySchema }),
    wrapHandler('reportsController.barberSummary'),
  );

  return router;
}
