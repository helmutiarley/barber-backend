import { z } from 'zod';
import { CASH_MOVEMENT_TYPES, MANUAL_CASH_MOVEMENT_SOURCES } from '../entities/enums';

const balanceCents = z.coerce.number().int().nonnegative().max(100_000_000);
const amountCents = z.coerce.number().int().positive().max(100_000_000);

export const openSessionSchema = z.object({
  openingBalanceCents: balanceCents,
});

export const closeSessionSchema = z.object({
  countedBalanceCents: balanceCents,

  notes: z.string().trim().min(1).max(1000).optional(),
});

export const createMovementSchema = z.object({
  type: z.enum(CASH_MOVEMENT_TYPES),
  source: z.enum(MANUAL_CASH_MOVEMENT_SOURCES),
  amountCents,
  description: z.string().trim().min(1).max(500),
});

export const listSessionsQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((query) => !query.from || !query.to || query.to.getTime() >= query.from.getTime(), {
    message: 'must not be before from',
    path: ['to'],
  });

export const sessionIdParamsSchema = z.object({ id: z.uuid() });

export type OpenSessionBody = z.infer<typeof openSessionSchema>;
export type CloseSessionBody = z.infer<typeof closeSessionSchema>;
export type CreateMovementBody = z.infer<typeof createMovementSchema>;
export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;
export type SessionIdParams = z.infer<typeof sessionIdParamsSchema>;
