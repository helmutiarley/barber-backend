import { Router } from 'express';
import { wrapHandler } from '../lib/wrap-handler';
import { validate } from '../middleware/validate';
import { loginSchema, refreshSchema, registerSchema } from '../schemas/auth.schemas';

export function authRoutes(): Router {
  const router = Router();

  router.post(
    '/auth/register',
    validate({ body: registerSchema }),
    wrapHandler('authController.register'),
  );

  router.post('/auth/login', validate({ body: loginSchema }), wrapHandler('authController.login'));

  router.post(
    '/auth/refresh',
    validate({ body: refreshSchema }),
    wrapHandler('authController.refresh'),
  );

  router.post(
    '/auth/logout',
    validate({ body: refreshSchema }),
    wrapHandler('authController.logout'),
  );

  return router;
}
