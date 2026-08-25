import { Router } from 'express';
import type { AppConfig } from '../config';
import { wrapHandler } from '../lib/wrap-handler';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { authorize } from '../middleware/authorize';
import {
  agendaQuerySchema,
  appointmentIdParamsSchema,
  barberIdParamsSchema,
  cancelAppointmentSchema,
  createAppointmentSchema,
  listAppointmentsQuerySchema,
  pageQuerySchema,
  rescheduleAppointmentSchema,
} from '../schemas/appointments.schemas';

export function appointmentsRoutes(config: AppConfig): Router {
  const router = Router();

  const authenticated = authenticate(config);

  router.post(
    '/appointments',
    authenticated,
    validate({ body: createAppointmentSchema }),
    wrapHandler('appointmentsController.create'),
  );

  router.get(
    '/appointments',
    authenticated,
    authorize('ADMIN', 'MANAGER'),
    validate({ query: listAppointmentsQuerySchema }),
    wrapHandler('appointmentsController.list'),
  );

  router.get(
    '/clients/me/appointments',
    authenticated,
    validate({ query: pageQuerySchema }),
    wrapHandler('appointmentsController.listMine'),
  );

  router.get(
    '/barbers/:id/agenda',
    authenticated,
    validate({ params: barberIdParamsSchema, query: agendaQuerySchema }),
    wrapHandler('appointmentsController.agenda'),
  );

  router.get(
    '/appointments/:id',
    authenticated,
    validate({ params: appointmentIdParamsSchema }),
    wrapHandler('appointmentsController.getById'),
  );

  router.patch(
    '/appointments/:id',
    authenticated,
    validate({ params: appointmentIdParamsSchema, body: rescheduleAppointmentSchema }),
    wrapHandler('appointmentsController.reschedule'),
  );

  for (const [path, handler] of [
    ['confirm', 'appointmentsController.confirm'],
    ['complete', 'appointmentsController.complete'],
    ['no-show', 'appointmentsController.noShow'],
  ] as const) {
    router.post(
      `/appointments/:id/${path}`,
      authenticated,
      validate({ params: appointmentIdParamsSchema }),
      wrapHandler(handler),
    );
  }

  router.post(
    '/appointments/:id/cancel',
    authenticated,
    validate({ params: appointmentIdParamsSchema, body: cancelAppointmentSchema }),
    wrapHandler('appointmentsController.cancel'),
  );

  return router;
}
