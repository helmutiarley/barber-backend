import type { AwilixContainer } from 'awilix';
import type { RequestHandler } from 'express';
import type { Cradle } from '../container';

declare global {

  namespace Express {
    interface Request {
      container: AwilixContainer<Cradle>;
    }
  }
}

export function scopePerRequest(container: AwilixContainer<Cradle>): RequestHandler {
  return (req, _res, next) => {
    req.container = container.createScope();
    next();
  };
}
