import { Router } from 'express';
import type { AppConfig } from '../config';
import { wrapHandler } from '../lib/wrap-handler';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import {
  closeCommissionPeriodSchema,
  commissionPeriodIdParamsSchema,
  commissionRuleIdParamsSchema,
  createCommissionRuleSchema,
  listCommissionAdvancesQuerySchema,
  listCommissionEntriesQuerySchema,
  listCommissionPeriodsQuerySchema,
  listCommissionRulesQuerySchema,
  payCommissionPeriodSchema,
  recordCommissionAdvanceSchema,
  updateCommissionRuleSchema,
} from '../schemas/commissions.schemas';

export function commissionsRoutes(config: AppConfig): Router {
  const router = Router();

  const authenticated = authenticate(config);

  const adminOnly = authorize('ADMIN');

  router.post(
    '/commission-rules',
    authenticated,
    adminOnly,
    validate({ body: createCommissionRuleSchema }),
    wrapHandler('commissionsController.createRule'),
  );

  router.get(
    '/commission-rules',
    authenticated,
    authorize('ADMIN', 'MANAGER', 'BARBER'),
    validate({ query: listCommissionRulesQuerySchema }),
    wrapHandler('commissionsController.listRules'),
  );

  router.patch(
    '/commission-rules/:id',
    authenticated,
    adminOnly,
    validate({ params: commissionRuleIdParamsSchema, body: updateCommissionRuleSchema }),
    wrapHandler('commissionsController.updateRule'),
  );

  router.get(
    '/commissions/entries',
    authenticated,
    authorize('ADMIN', 'MANAGER', 'BARBER'),
    validate({ query: listCommissionEntriesQuerySchema }),
    wrapHandler('commissionsController.listEntries'),
  );

  router.post(
    '/commission-advances',
    authenticated,
    authorize('ADMIN', 'MANAGER'),
    validate({ body: recordCommissionAdvanceSchema }),
    wrapHandler('commissionsController.recordAdvance'),
  );

  router.get(
    '/commission-advances',
    authenticated,
    authorize('ADMIN', 'MANAGER', 'BARBER'),
    validate({ query: listCommissionAdvancesQuerySchema }),
    wrapHandler('commissionsController.listAdvances'),
  );

  router.post(
    '/commission-periods/close',
    authenticated,
    adminOnly,
    validate({ body: closeCommissionPeriodSchema }),
    wrapHandler('commissionsController.closePeriod'),
  );

  router.get(
    '/commission-periods',
    authenticated,
    authorize('ADMIN', 'MANAGER', 'BARBER'),
    validate({ query: listCommissionPeriodsQuerySchema }),
    wrapHandler('commissionsController.listPeriods'),
  );

  router.get(
    '/commission-periods/:id',
    authenticated,
    authorize('ADMIN', 'MANAGER', 'BARBER'),
    validate({ params: commissionPeriodIdParamsSchema }),
    wrapHandler('commissionsController.getStatement'),
  );

  router.post(
    '/commission-periods/:id/pay',
    authenticated,
    adminOnly,
    validate({ params: commissionPeriodIdParamsSchema, body: payCommissionPeriodSchema }),
    wrapHandler('commissionsController.payPeriod'),
  );

  return router;
}
