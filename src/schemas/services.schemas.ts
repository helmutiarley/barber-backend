import { z } from 'zod';

const name = z.string().trim().min(1).max(120);
const description = z.string().trim().min(1).max(1000).nullable();

const priceCents = z.int().positive().max(100_000_000);
const durationMinutes = z.int().positive().max(600);

export const createServiceSchema = z.object({
  name,
  description: description.optional(),
  priceCents,
  durationMinutes,
});

export const updateServiceSchema = z
  .object({
    name: name.optional(),
    description: description.optional(),
    priceCents: priceCents.optional(),
    durationMinutes: durationMinutes.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

export const listServicesQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const serviceIdParamsSchema = z.object({ id: z.uuid() });

export type CreateServiceBody = z.infer<typeof createServiceSchema>;
export type UpdateServiceBody = z.infer<typeof updateServiceSchema>;
export type ListServicesQuery = z.infer<typeof listServicesQuerySchema>;
export type ServiceIdParams = z.infer<typeof serviceIdParamsSchema>;
