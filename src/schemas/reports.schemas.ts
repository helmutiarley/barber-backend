import { z } from 'zod';

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'must be a real date');

const rangeShape = {
  from: calendarDate.optional(),
  to: calendarDate.optional(),
};

const orderedRange = <T extends z.ZodTypeAny>(schema: T) =>
  schema.refine(
    (query: unknown) => {
      const { from, to } = query as { from?: string; to?: string };

      return !from || !to || to >= from;
    },
    { message: 'must not be before from', path: ['to'] },
  );

export const REVENUE_GROUPINGS = ['day', 'week', 'month', 'barber', 'service', 'method'] as const;

export type RevenueGrouping = (typeof REVENUE_GROUPINGS)[number];

export const revenueQuerySchema = orderedRange(
  z.object({
    ...rangeShape,
    groupBy: z.enum(REVENUE_GROUPINGS).default('day'),
  }),
);

export const rangeQuerySchema = orderedRange(z.object(rangeShape));

export const topServicesQuerySchema = orderedRange(
  z.object({
    ...rangeShape,
    limit: z.coerce.number().int().min(1).max(50).default(10),
  }),
);

export const barberIdParamsSchema = z.object({ id: z.uuid() });

export type RevenueQuery = z.infer<typeof revenueQuerySchema>;
export type RangeQuery = z.infer<typeof rangeQuerySchema>;
export type TopServicesQuery = z.infer<typeof topServicesQuerySchema>;
export type BarberIdParams = z.infer<typeof barberIdParamsSchema>;
