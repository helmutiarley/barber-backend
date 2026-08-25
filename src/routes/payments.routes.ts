import { Router } from 'express';
import type { AppConfig } from '../config';
import { wrapHandler } from '../lib/wrap-handler';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { appointmentIdParamsSchema } from '../schemas/appointments.schemas';
import {
  listPaymentsQuerySchema,
  paymentIdParamsSchema,
  recordPaymentsSchema,
  voidPaymentSchema,
} from '../schemas/payments.schemas';

export function paymentsRoutes(config: AppConfig): Router {
  const router = Router();

  const authenticated = authenticate(config);

  router.post(
    '/appointments/:id/payments',
    authenticated,
    authorize('ADMIN', 'MANAGER'),
    validate({ params: appointmentIdParamsSchema, body: recordPaymentsSchema }),
    wrapHandler('paymentsController.record'),
  );

  router.get(
    '/appointments/:id/payments',
    authenticated,
    validate({ params: appointmentIdParamsSchema }),
    wrapHandler('paymentsController.listForAppointment'),
  );

  router.get(
    '/payments',
    authenticated,
    authorize('ADMIN', 'MANAGER'),
    validate({ query: listPaymentsQuerySchema }),
    wrapHandler('paymentsController.list'),
  );

  router.delete(
    '/payments/:id',
    authenticated,
    authorize('ADMIN'),
    validate({ params: paymentIdParamsSchema, body: voidPaymentSchema }),
    wrapHandler('paymentsController.void'),
  );

  return router;
}
