import { z } from 'zod';

const birthday = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'must be a real date');

const preferences = z.string().trim().min(1).max(2000).nullable();

export const listClientsQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  birthdayMonth: z.coerce.number().int().min(1).max(12).optional(),
  inactiveSince: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const updateClientSchema = z
  .object({
    birthday: birthday.nullable().optional(),
    preferences: preferences.optional(),
    internalNotes: z.string().trim().min(1).max(2000).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

export const updateOwnClientSchema = z
  .object({
    birthday: birthday.nullable().optional(),
    preferences: preferences.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

export const clientIdParamsSchema = z.object({ id: z.uuid() });

export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
export type UpdateClientBody = z.infer<typeof updateClientSchema>;
export type UpdateOwnClientBody = z.infer<typeof updateOwnClientSchema>;
export type ClientIdParams = z.infer<typeof clientIdParamsSchema>;
