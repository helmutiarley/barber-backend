import { z } from 'zod';
import { PAYMENT_METHODS } from '../entities/enums';

const booleanFlag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

export const sellProductsSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.uuid(),
        quantity: z.coerce.number().int().positive().max(10_000),
      }),
    )
    .min(1)
    .max(50),
  method: z.enum(PAYMENT_METHODS),
  soldByBarberId: z.uuid().nullable().optional(),
  clientId: z.uuid().nullable().optional(),
});

export const voidSaleSchema = z.object({
  reason: z.string().trim().max(200).nullable().optional(),
});

export const listProductSalesQuerySchema = z
  .object({
    productId: z.uuid().optional(),
    barberId: z.uuid().optional(),
    clientId: z.uuid().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    voided: booleanFlag,
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'from must not be after to',
    path: ['from'],
  });

export const saleIdParamsSchema = z.object({ id: z.uuid() });

export type SellProductsBody = z.infer<typeof sellProductsSchema>;
export type VoidSaleBody = z.infer<typeof voidSaleSchema>;
export type ListProductSalesQuery = z.infer<typeof listProductSalesQuerySchema>;
export type SaleIdParams = z.infer<typeof saleIdParamsSchema>;
