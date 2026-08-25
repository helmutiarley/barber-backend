import { Router } from 'express';
import { wrapHandler } from '../lib/wrap-handler';

export function healthRoutes(): Router {
  const router = Router();
  router.get('/health', wrapHandler('healthController.check'));
  return router;
}
