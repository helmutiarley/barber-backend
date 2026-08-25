import { z } from 'zod';
import { PAYMENT_METHODS } from '../entities/enums';

const amountCents = z.coerce.number().int().positive().max(100_000_000);

const paymentItemSchema = z.object({
  amountCents,
  method: z.enum(PAYMENT_METHODS),

  paidAt: z.coerce.date().optional(),
});

export const recordPaymentsSchema = z.object({
  payments: z.array(paymentItemSchema).min(1).max(4),
});

export const listPaymentsQuerySchema = z
  .object({
    method: z.enum(PAYMENT_METHODS).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    sessionId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((query) => !query.from || !query.to || query.to.getTime() >= query.from.getTime(), {
    message: 'must not be before from',
    path: ['to'],
  });

export const voidPaymentSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .default({});

export const paymentIdParamsSchema = z.object({ id: z.uuid() });

export type RecordPaymentsBody = z.infer<typeof recordPaymentsSchema>;
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;
export type VoidPaymentBody = z.infer<typeof voidPaymentSchema>;
export type PaymentIdParams = z.infer<typeof paymentIdParamsSchema>;
