import { z } from 'zod';

const email = z.string().trim().toLowerCase().pipe(z.email());
const password = z.string().min(8, 'must be at least 8 characters').max(200);

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email,
  phone: z.string().trim().min(8).max(20).optional(),
  password,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RegisterBody = z.infer<typeof registerSchema>;
export type LoginBody = z.infer<typeof loginSchema>;
export type RefreshBody = z.infer<typeof refreshSchema>;
