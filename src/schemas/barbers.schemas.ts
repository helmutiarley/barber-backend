import { z } from 'zod';
import { normaliseTimeOfDay } from '../lib/shop-time';

const displayName = z.string().trim().min(1).max(120);
const photoUrl = z.url().max(500).nullable();
const specialties = z.array(z.string().trim().min(1).max(40)).max(20);

export const createBarberSchema = z.object({
  userId: z.uuid(),
  displayName,
  photoUrl: photoUrl.optional(),
  specialties: specialties.optional(),
});

export const updateBarberSchema = z
  .object({
    displayName: displayName.optional(),
    photoUrl: photoUrl.optional(),
    specialties: specialties.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

export const barberIdParamsSchema = z.object({ id: z.uuid() });

const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'must be HH:MM in 24-hour form')
  .transform(normaliseTimeOfDay);

const scheduleDaySchema = z
  .object({
    weekday: z.int().min(0).max(6),
    startTime: timeOfDay,
    endTime: timeOfDay,
    breakStart: timeOfDay.nullable().optional(),
    breakEnd: timeOfDay.nullable().optional(),
  })
  .superRefine((day, ctx) => {
    if (day.endTime <= day.startTime) {
      ctx.addIssue({
        code: 'custom',
        path: ['endTime'],
        message: 'must be after startTime',
      });
    }

    const hasStart = day.breakStart !== undefined && day.breakStart !== null;
    const hasEnd = day.breakEnd !== undefined && day.breakEnd !== null;

    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: 'custom',
        path: [hasStart ? 'breakEnd' : 'breakStart'],
        message: 'breakStart and breakEnd must be given together',
      });
      return;
    }

    if (!hasStart || !hasEnd) return;

    if (day.breakEnd! <= day.breakStart!) {
      ctx.addIssue({ code: 'custom', path: ['breakEnd'], message: 'must be after breakStart' });
    }
    if (day.breakStart! < day.startTime || day.breakEnd! > day.endTime) {
      ctx.addIssue({
        code: 'custom',
        path: ['breakStart'],
        message: 'break must fall inside the working window',
      });
    }
  });

export const replaceScheduleSchema = z
  .object({ days: z.array(scheduleDaySchema).max(7) })
  .refine(
    (schedule) => new Set(schedule.days.map((day) => day.weekday)).size === schedule.days.length,
    { path: ['days'], message: 'one entry per weekday at most' },
  );

export const createBlockSchema = z
  .object({
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    reason: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .refine((block) => block.endsAt > block.startsAt, {
    path: ['endsAt'],
    message: 'must be after startsAt',
  });

export const blockIdParamsSchema = z.object({ id: z.uuid(), blockId: z.uuid() });

export const availabilityQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  serviceId: z.uuid().optional(),
  slotMinutes: z.coerce.number().int().min(5).max(120).optional(),
});

export type CreateBarberBody = z.infer<typeof createBarberSchema>;
export type UpdateBarberBody = z.infer<typeof updateBarberSchema>;
export type BarberIdParams = z.infer<typeof barberIdParamsSchema>;
export type ReplaceScheduleBody = z.infer<typeof replaceScheduleSchema>;
export type CreateBlockBody = z.infer<typeof createBlockSchema>;
export type BlockIdParams = z.infer<typeof blockIdParamsSchema>;
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
