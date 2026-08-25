import { z } from 'zod';
import { STOCK_ADJUSTMENT_REASONS } from '../entities/enums';

const priceCents = z.coerce.number().int().positive().max(100_000_000);
const costCents = z.coerce.number().int().min(0).max(100_000_000);

const booleanFlag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

const name = z.string().trim().min(1).max(120);
const quantity = z.coerce.number().int().min(0).max(1_000_000);

export const createProductSchema = z.object({
  name,
  description: z.string().trim().max(500).nullable().optional(),
  priceCents,
  costCents: costCents.nullable().optional(),

  stockQuantity: quantity.optional(),
  lowStockThreshold: quantity.optional(),
});

export const updateProductSchema = z
  .object({
    name: name.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    priceCents: priceCents.optional(),
    costCents: costCents.nullable().optional(),
    lowStockThreshold: quantity.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'No fields to update' });

export const adjustStockSchema = z.object({

  delta: z.coerce
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((value) => value !== 0, 'must not be zero'),
  reason: z.enum(STOCK_ADJUSTMENT_REASONS),
  notes: z.string().trim().max(200).nullable().optional(),
});

export const listProductsQuerySchema = z.object({
  lowStock: booleanFlag,
  includeInactive: booleanFlag,
  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const listStockAdjustmentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const productIdParamsSchema = z.object({ id: z.uuid() });

export type CreateProductBody = z.infer<typeof createProductSchema>;
export type UpdateProductBody = z.infer<typeof updateProductSchema>;
export type AdjustStockBody = z.infer<typeof adjustStockSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
export type ListStockAdjustmentsQuery = z.infer<typeof listStockAdjustmentsQuerySchema>;
export type ProductIdParams = z.infer<typeof productIdParamsSchema>;
