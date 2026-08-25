import type { RequestHandler } from 'express';
import type { Cradle } from '../container';

export function wrapHandler(fullName: `${string}.${string}`): RequestHandler {
  return async (req, res, next) => {
    try {
      const [controllerName, methodName] = fullName.split('.');
      const controller = req.container.resolve(controllerName as keyof Cradle);
      const method = Reflect.get(controller as object, methodName as string);
      if (typeof method !== 'function') {
        throw new Error(`Handler ${fullName} not found`);
      }
      await Reflect.apply(method, controller, [req, res, next]);
    } catch (error) {
      next(error);
    }
  };
}
