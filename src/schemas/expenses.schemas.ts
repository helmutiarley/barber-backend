import { z } from 'zod';
import { EXPENSE_CATEGORIES, EXPENSE_KINDS, PAYMENT_METHODS } from '../entities/enums';

const amountCents = z.coerce.number().int().positive().max(100_000_000);

const dueDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'must be a real date');

const booleanFlag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

const description = z.string().trim().min(1).max(200);

export const createExpenseSchema = z
  .object({
    description,
    category: z.enum(EXPENSE_CATEGORIES),
    kind: z.enum(EXPENSE_KINDS),
    amountCents,
    dueDate: dueDate.nullable().optional(),
    recurring: z.boolean().optional(),

    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    paidAt: z.coerce.date().optional(),
  })
  .refine((body) => body.paymentMethod !== undefined || body.paidAt === undefined, {
    message: 'requires paymentMethod',
    path: ['paidAt'],
  });

export const updateExpenseSchema = z
  .object({
    description: description.optional(),
    category: z.enum(EXPENSE_CATEGORIES).optional(),
    kind: z.enum(EXPENSE_KINDS).optional(),
    amountCents: amountCents.optional(),
    dueDate: dueDate.nullable().optional(),
    recurring: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

export const payExpenseSchema = z.object({
  paymentMethod: z.enum(PAYMENT_METHODS),

  paidAt: z.coerce.date().optional(),
});

export const listExpensesQuerySchema = z
  .object({
    category: z.enum(EXPENSE_CATEGORIES).optional(),
    kind: z.enum(EXPENSE_KINDS).optional(),
    paid: booleanFlag,
    overdue: booleanFlag,

    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((query) => !query.from || !query.to || query.to.getTime() >= query.from.getTime(), {
    message: 'must not be before from',
    path: ['to'],
  });

export const expenseIdParamsSchema = z.object({ id: z.uuid() });

export type CreateExpenseBody = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseBody = z.infer<typeof updateExpenseSchema>;
export type PayExpenseBody = z.infer<typeof payExpenseSchema>;
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
export type ExpenseIdParams = z.infer<typeof expenseIdParamsSchema>;
