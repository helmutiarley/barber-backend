import { Router } from 'express';
import type { AppConfig } from '../config';
import { wrapHandler } from '../lib/wrap-handler';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import {
  createExpenseSchema,
  expenseIdParamsSchema,
  listExpensesQuerySchema,
  payExpenseSchema,
  updateExpenseSchema,
} from '../schemas/expenses.schemas';

export function expensesRoutes(config: AppConfig): Router {
  const router = Router();

  const authenticated = authenticate(config);
  const staffOnly = authorize('ADMIN', 'MANAGER');

  router.post(
    '/expenses',
    authenticated,
    staffOnly,
    validate({ body: createExpenseSchema }),
    wrapHandler('expensesController.create'),
  );

  router.get(
    '/expenses',
    authenticated,
    staffOnly,
    validate({ query: listExpensesQuerySchema }),
    wrapHandler('expensesController.list'),
  );

  router.get(
    '/expenses/:id',
    authenticated,
    staffOnly,
    validate({ params: expenseIdParamsSchema }),
    wrapHandler('expensesController.get'),
  );

  router.patch(
    '/expenses/:id',
    authenticated,
    staffOnly,
    validate({ params: expenseIdParamsSchema, body: updateExpenseSchema }),
    wrapHandler('expensesController.update'),
  );

  router.post(
    '/expenses/:id/pay',
    authenticated,
    staffOnly,
    validate({ params: expenseIdParamsSchema, body: payExpenseSchema }),
    wrapHandler('expensesController.pay'),
  );

  router.delete(
    '/expenses/:id',
    authenticated,
    authorize('ADMIN'),
    validate({ params: expenseIdParamsSchema }),
    wrapHandler('expensesController.remove'),
  );

  return router;
}
