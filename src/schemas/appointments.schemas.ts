import { z } from 'zod';
import { APPOINTMENT_STATUSES } from '../entities/enums';

const walkInSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(8).max(20),
});

export const createAppointmentSchema = z
  .object({
    clientId: z.uuid().optional(),

    walkIn: walkInSchema.optional(),
    barberId: z.uuid(),
    serviceId: z.uuid(),
    startsAt: z.coerce.date(),
    notes: z.string().trim().min(1).max(1000).optional(),

    force: z.boolean().optional(),
  })
  .refine((body) => !(body.clientId && body.walkIn), {
    message: 'send either clientId or walkIn, not both',
    path: ['walkIn'],
  });

export const appointmentIdParamsSchema = z.object({
  id: z.uuid(),
});

export const rescheduleAppointmentSchema = z.object({
  startsAt: z.coerce.date(),
  notes: z.string().trim().min(1).max(1000).nullable().optional(),

  force: z.boolean().optional(),
});

export const cancelAppointmentSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .default({});

const MAX_RANGE_DAYS = 92;
const DAY_IN_MS = 86_400_000;

const statusFilter = z
  .union([z.enum(APPOINTMENT_STATUSES), z.array(z.enum(APPOINTMENT_STATUSES)).min(1)])
  .transform((value) => (Array.isArray(value) ? value : [value]))
  .optional();

export const listAppointmentsQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    barberId: z.uuid().optional(),
    clientId: z.uuid().optional(),
    status: statusFilter,
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((query) => query.to.getTime() >= query.from.getTime(), {
    message: 'must not be before from',
    path: ['to'],
  })
  .refine((query) => query.to.getTime() - query.from.getTime() <= MAX_RANGE_DAYS * DAY_IN_MS, {
    message: `must be at most ${MAX_RANGE_DAYS} days after from`,
    path: ['to'],
  });

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const agendaQuerySchema = z.object({

  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
});

export const barberIdParamsSchema = z.object({ id: z.uuid() });

export type CreateAppointmentBody = z.infer<typeof createAppointmentSchema>;
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;
export type PageQuery = z.infer<typeof pageQuerySchema>;
export type AgendaQuery = z.infer<typeof agendaQuerySchema>;
export type BarberIdParams = z.infer<typeof barberIdParamsSchema>;
export type AppointmentIdParams = z.infer<typeof appointmentIdParamsSchema>;
export type CancelAppointmentBody = z.infer<typeof cancelAppointmentSchema>;
export type RescheduleAppointmentBody = z.infer<typeof rescheduleAppointmentSchema>;
