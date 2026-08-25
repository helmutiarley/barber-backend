import { Router } from 'express';
import type { AppConfig } from '../config';
import { wrapHandler } from '../lib/wrap-handler';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import {
  createStaffSchema,
  listUsersQuerySchema,
  updateSelfSchema,
  updateUserSchema,
  userIdParamsSchema,
} from '../schemas/users.schemas';

export function usersRoutes(config: AppConfig): Router {
  const router = Router();

  const authenticated = authenticate(config);

  router.get('/users/me', authenticated, wrapHandler('usersController.getMe'));

  router.patch(
    '/users/me',
    authenticated,
    validate({ body: updateSelfSchema }),
    wrapHandler('usersController.updateMe'),
  );

  router.post(
    '/users',
    authenticated,
    authorize('ADMIN'),
    validate({ body: createStaffSchema }),
    wrapHandler('usersController.createStaff'),
  );

  router.get(
    '/users',
    authenticated,
    authorize('ADMIN', 'MANAGER'),
    validate({ query: listUsersQuerySchema }),
    wrapHandler('usersController.list'),
  );

  router.patch(
    '/users/:id',
    authenticated,
    authorize('ADMIN'),
    validate({ params: userIdParamsSchema, body: updateUserSchema }),
    wrapHandler('usersController.update'),
  );

  return router;
}
