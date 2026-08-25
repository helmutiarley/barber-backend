import { z } from 'zod';
import {
  COMMISSION_APPLIES_TO,
  COMMISSION_BASES,
  COMMISSION_PERIOD_STATUSES,
  PAYMENT_METHODS,
} from '../entities/enums';
import { fitsRateScale } from '../lib/rate';

const rate = z.coerce.number().min(0).max(1).refine(fitsRateScale, {
  message: 'must have at most four decimal places',
});

export const createCommissionRuleSchema = z
  .object({

    barberId: z.uuid().nullable().optional(),
    serviceId: z.uuid().nullable().optional(),
    rate,
    base: z.enum(COMMISSION_BASES),
    appliesTo: z.enum(COMMISSION_APPLIES_TO).optional(),
  })
  .refine((body) => body.appliesTo !== 'products' || !body.serviceId, {
    message: 'must be omitted when appliesTo is products',
    path: ['serviceId'],
  });

export const updateCommissionRuleSchema = z
  .object({
    rate: rate.optional(),
    base: z.enum(COMMISSION_BASES).optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

export const listCommissionRulesQuerySchema = z.object({
  appliesTo: z.enum(COMMISSION_APPLIES_TO).optional(),
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const listCommissionEntriesQuerySchema = z
  .object({
    barberId: z.uuid().optional(),
    periodId: z.uuid().optional(),

    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((query) => !query.from || !query.to || query.to.getTime() >= query.from.getTime(), {
    message: 'must not be before from',
    path: ['to'],
  });

export const commissionRuleIdParamsSchema = z.object({ id: z.uuid() });

const amountCents = z.coerce.number().int().positive().max(100_000_000);

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'must be a real date');

export const recordCommissionAdvanceSchema = z.object({
  barberId: z.uuid(),
  amountCents,

  paymentMethod: z.enum(PAYMENT_METHODS),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const closeCommissionPeriodSchema = z
  .object({

    barberId: z.uuid().optional(),
    startsOn: calendarDate,
    endsOn: calendarDate,
  })
  .refine((body) => body.endsOn >= body.startsOn, {
    message: 'must not be before startsOn',
    path: ['endsOn'],
  });

export const payCommissionPeriodSchema = z.object({
  paymentMethod: z.enum(PAYMENT_METHODS),
});

export const listCommissionPeriodsQuerySchema = z
  .object({
    barberId: z.uuid().optional(),
    status: z.enum(COMMISSION_PERIOD_STATUSES).optional(),

    from: calendarDate.optional(),
    to: calendarDate.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((query) => !query.from || !query.to || query.to >= query.from, {
    message: 'must not be before from',
    path: ['to'],
  });

export const listCommissionAdvancesQuerySchema = z
  .object({
    barberId: z.uuid().optional(),
    unassigned: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((query) => !query.from || !query.to || query.to.getTime() >= query.from.getTime(), {
    message: 'must not be before from',
    path: ['to'],
  });

export const commissionPeriodIdParamsSchema = z.object({ id: z.uuid() });

export type CreateCommissionRuleBody = z.infer<typeof createCommissionRuleSchema>;
export type UpdateCommissionRuleBody = z.infer<typeof updateCommissionRuleSchema>;
export type ListCommissionRulesQuery = z.infer<typeof listCommissionRulesQuerySchema>;
export type ListCommissionEntriesQuery = z.infer<typeof listCommissionEntriesQuerySchema>;
export type CommissionRuleIdParams = z.infer<typeof commissionRuleIdParamsSchema>;
export type RecordCommissionAdvanceBody = z.infer<typeof recordCommissionAdvanceSchema>;
export type CloseCommissionPeriodBody = z.infer<typeof closeCommissionPeriodSchema>;
export type PayCommissionPeriodBody = z.infer<typeof payCommissionPeriodSchema>;
export type ListCommissionPeriodsQuery = z.infer<typeof listCommissionPeriodsQuerySchema>;
export type ListCommissionAdvancesQuery = z.infer<typeof listCommissionAdvancesQuerySchema>;
export type CommissionPeriodIdParams = z.infer<typeof commissionPeriodIdParamsSchema>;
