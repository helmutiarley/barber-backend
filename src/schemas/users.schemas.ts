import { z } from 'zod';

const TENANT_ROLES = ['ADMIN', 'MANAGER', 'BARBER', 'CLIENT'] as const;

const password = z.string().min(8, 'must be at least 8 characters').max(200);

export const updateSelfSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().min(8).max(20).nullable().optional(),
    currentPassword: z.string().min(1).optional(),
    newPassword: password.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' })
  .refine((data) => !data.newPassword || data.currentPassword, {
    message: 'currentPassword is required to change the password',
    path: ['currentPassword'],
  });

export const createStaffSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  phone: z.string().trim().min(8).max(20).optional(),
  password,
  role: z.enum(['MANAGER', 'BARBER']),
});

export const listUsersQuerySchema = z.object({
  role: z.enum(TENANT_ROLES).optional(),
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().min(8).max(20).nullable().optional(),
    role: z.enum(TENANT_ROLES).optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

export const userIdParamsSchema = z.object({ id: z.uuid() });

export type UpdateSelfBody = z.infer<typeof updateSelfSchema>;
export type CreateStaffBody = z.infer<typeof createStaffSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type UpdateUserBody = z.infer<typeof updateUserSchema>;
export type UserIdParams = z.infer<typeof userIdParamsSchema>;
