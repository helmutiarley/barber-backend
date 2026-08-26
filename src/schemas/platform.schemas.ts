import { z } from 'zod';

const slugSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'must be lowercase letters, numbers and hyphens (no leading/trailing hyphen)',
  );

const domainSchema = z
  .string()
  .min(4)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, 'must be a hostname');

export const createShopSchema = z.object({
  name: z.string().min(2).max(120),
  slug: slugSchema,
  customDomain: domainSchema.optional(),
  owner: z.object({
    name: z.string().min(2).max(120),
    email: z.email(),
    password: z.string().min(8).max(128),
  }),
});
export type CreateShopBody = z.infer<typeof createShopSchema>;

export const updateShopSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    customDomain: domainSchema.nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' });
export type UpdateShopBody = z.infer<typeof updateShopSchema>;

export const shopIdParamsSchema = z.object({ id: z.uuid() });
export type ShopIdParams = z.infer<typeof shopIdParamsSchema>;

export const tlsCheckQuerySchema = z.object({ domain: z.string().min(1).max(253) });
export type TlsCheckQuery = z.infer<typeof tlsCheckQuerySchema>;
