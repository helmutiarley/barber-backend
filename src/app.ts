import type { AwilixContainer } from 'awilix';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Cradle } from './container';
import { NotFoundError } from './errors/app-error';
import { errorHandler } from './middleware/error-handler';
import { scopePerRequest } from './middleware/scope';
import { appointmentsRoutes } from './routes/appointments.routes';
import { authRoutes } from './routes/auth.routes';
import { barbersRoutes } from './routes/barbers.routes';
import { cashRegisterRoutes } from './routes/cash-register.routes';
import { clientsRoutes } from './routes/clients.routes';
import { commissionsRoutes } from './routes/commissions.routes';
import { expensesRoutes } from './routes/expenses.routes';
import { healthRoutes } from './routes/health.routes';
import { paymentsRoutes } from './routes/payments.routes';
import { productSalesRoutes } from './routes/product-sales.routes';
import { productsRoutes } from './routes/products.routes';
import { reportsRoutes } from './routes/reports.routes';
import { servicesRoutes } from './routes/services.routes';
import { usersRoutes } from './routes/users.routes';

export function createApp(container: AwilixContainer<Cradle>): Express {
  const app = express();

  app.use(pinoHttp({ logger: container.resolve('logger') }));
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(scopePerRequest(container));

  const config = container.resolve('config');

  app.use(healthRoutes());
  app.use('/v1', authRoutes());
  app.use('/v1', usersRoutes(config));
  app.use('/v1', barbersRoutes(config));
  app.use('/v1', servicesRoutes(config));
  app.use('/v1', appointmentsRoutes(config));
  app.use('/v1', clientsRoutes(config));
  app.use('/v1', paymentsRoutes(config));
  app.use('/v1', cashRegisterRoutes(config));
  app.use('/v1', expensesRoutes(config));
  app.use('/v1', commissionsRoutes(config));
  app.use('/v1', productsRoutes(config));
  app.use('/v1', productSalesRoutes(config));
  app.use('/v1', reportsRoutes(config));

  app.use((req, _res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
  });

  app.use(errorHandler);

  return app;
}
