import { pino } from 'pino';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { loadConfig, type AppConfig } from '../../src/config';
import { buildContainer } from '../../src/container';
import { BarberSchedule } from '../../src/entities/barber-schedule.entity';
import { Barber } from '../../src/entities/barber.entity';
import { getTestDataSource, truncateAll } from '../support/db';
import {
  makeAppointment,
  makeAuthenticatedUser,
  makeBarber,
  makeBlock,
  makeSchedule,
  makeService,
  makeUser,
} from '../support/factories';

const UNKNOWN_UUID = '11111111-1111-4111-8111-111111111111';

describe('barbers routes', () => {
  let dataSource: DataSource;
  let config: AppConfig;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    config = loadConfig();
    app = createApp(buildContainer({ config, logger: pino({ level: 'silent' }), dataSource }));
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
  });

  const asRole = (role: 'ADMIN' | 'MANAGER' | 'BARBER' | 'CLIENT') =>
    makeAuthenticatedUser(dataSource, config, { role });

  describe('GET /v1/barbers', () => {
    it('is public and lists active barbers without internal fields', async () => {
      const barber = await makeBarber(dataSource, { displayName: 'Rafael' });

      const response = await request(app).get('/v1/barbers');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toEqual({
        id: barber.id,
        displayName: 'Rafael',
        photoUrl: null,
        specialties: [],
      });
    });

    it('hides deactivated barbers from the booking roster', async () => {
      await makeBarber(dataSource, { displayName: 'Ativo' });
      await makeBarber(dataSource, { displayName: 'Saiu', active: false });

      const response = await request(app).get('/v1/barbers');

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].displayName).toBe('Ativo');
    });
  });

  describe('GET /v1/barbers/:id', () => {
    it('is public', async () => {
      const barber = await makeBarber(dataSource);

      const response = await request(app).get(`/v1/barbers/${barber.id}`);

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(barber.id);
    });

    it('404s on an unknown id', async () => {
      expect((await request(app).get(`/v1/barbers/${UNKNOWN_UUID}`)).status).toBe(404);
    });
  });

  describe('POST /v1/barbers', () => {
    it('creates a profile for a BARBER user', async () => {
      const { authHeader } = await asRole('ADMIN');
      const user = await makeUser(dataSource, { role: 'BARBER' });

      const response = await request(app)
        .post('/v1/barbers')
        .set('Authorization', authHeader)
        .send({ userId: user.id, displayName: 'Bruno', specialties: ['fade'] });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        userId: user.id,
        displayName: 'Bruno',
        specialties: ['fade'],
        active: true,
      });
    });

    it('rejects a user who is not a BARBER', async () => {
      const { authHeader } = await asRole('ADMIN');
      const client = await makeUser(dataSource, { role: 'CLIENT' });

      const response = await request(app)
        .post('/v1/barbers')
        .set('Authorization', authHeader)
        .send({ userId: client.id, displayName: 'Nope' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('refuses a second profile for the same user', async () => {
      const { authHeader } = await asRole('ADMIN');
      const barber = await makeBarber(dataSource);

      const response = await request(app)
        .post('/v1/barbers')
        .set('Authorization', authHeader)
        .send({ userId: barber.userId, displayName: 'Duplicate' });

      expect(response.status).toBe(409);
    });

    it.each([['MANAGER'], ['BARBER'], ['CLIENT']] as const)('forbids %s', async (role) => {
      const { authHeader } = await asRole(role);
      const user = await makeUser(dataSource, { role: 'BARBER' });

      const response = await request(app)
        .post('/v1/barbers')
        .set('Authorization', authHeader)
        .send({ userId: user.id, displayName: 'Nope' });

      expect(response.status).toBe(403);
    });

    it('requires a token', async () => {
      expect((await request(app).post('/v1/barbers').send({})).status).toBe(401);
    });
  });

  describe('PATCH /v1/barbers/:id', () => {
    it('lets a barber edit their own profile', async () => {
      const { user, authHeader } = await asRole('BARBER');
      const barber = await makeBarber(dataSource, { userId: user.id });

      const response = await request(app)
        .patch(`/v1/barbers/${barber.id}`)
        .set('Authorization', authHeader)
        .send({ displayName: 'Rafa', specialties: ['beard'] });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ displayName: 'Rafa', specialties: ['beard'] });
    });

    it('stops a barber editing someone else', async () => {
      const { authHeader } = await asRole('BARBER');
      const other = await makeBarber(dataSource);

      const response = await request(app)
        .patch(`/v1/barbers/${other.id}`)
        .set('Authorization', authHeader)
        .send({ displayName: 'Hijack' });

      expect(response.status).toBe(403);
    });

    it('lets an ADMIN edit anyone', async () => {
      const { authHeader } = await asRole('ADMIN');
      const barber = await makeBarber(dataSource);

      const response = await request(app)
        .patch(`/v1/barbers/${barber.id}`)
        .set('Authorization', authHeader)
        .send({ displayName: 'Renamed' });

      expect(response.status).toBe(200);
    });
  });

  describe('DELETE /v1/barbers/:id', () => {
    it('soft deletes, keeping the row', async () => {
      const { authHeader } = await asRole('ADMIN');
      const barber = await makeBarber(dataSource);

      const response = await request(app)
        .delete(`/v1/barbers/${barber.id}`)
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.data.active).toBe(false);
      expect((await request(app).get('/v1/barbers')).body.data).toHaveLength(0);
    });

    it('refuses while a future appointment stands, and lists it', async () => {
      const { authHeader } = await asRole('ADMIN');
      const barber = await makeBarber(dataSource);
      const startsAt = new Date(Date.now() + 86_400_000);
      const appointment = await makeAppointment(dataSource, { barberId: barber.id, startsAt });

      const response = await request(app)
        .delete(`/v1/barbers/${barber.id}`)
        .set('Authorization', authHeader);

      expect(response.status).toBe(409);
      expect(response.body.error.details).toEqual([
        { id: appointment.id, startsAt: startsAt.toISOString() },
      ]);

      const unchanged = await dataSource.getRepository(Barber).findOneBy({ id: barber.id });
      expect(unchanged?.active).toBe(true);
    });

    it('goes through once that appointment is cancelled', async () => {
      const { authHeader } = await asRole('ADMIN');
      const barber = await makeBarber(dataSource);
      await makeAppointment(dataSource, { barberId: barber.id, status: 'cancelled' });

      const response = await request(app)
        .delete(`/v1/barbers/${barber.id}`)
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.data.active).toBe(false);
    });
  });

  describe('PUT /v1/barbers/:id/schedule', () => {
    const week = {
      days: [
        { weekday: 1, startTime: '09:00', endTime: '18:00' },
        {
          weekday: 2,
          startTime: '09:00',
          endTime: '18:00',
          breakStart: '12:00',
          breakEnd: '13:00',
        },
      ],
    };

    it('stores the week and normalises times to HH:MM:SS', async () => {
      const { authHeader } = await asRole('ADMIN');
      const barber = await makeBarber(dataSource);

      const response = await request(app)
        .put(`/v1/barbers/${barber.id}/schedule`)
        .set('Authorization', authHeader)
        .send(week);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([
        {
          weekday: 1,
          startTime: '09:00:00',
          endTime: '18:00:00',
          breakStart: null,
          breakEnd: null,
        },
        {
          weekday: 2,
          startTime: '09:00:00',
          endTime: '18:00:00',
          breakStart: '12:00:00',
          breakEnd: '13:00:00',
        },
      ]);
    });

    it('replaces rather than appends', async () => {
      const { authHeader } = await asRole('ADMIN');
      const barber = await makeBarber(dataSource);

      await request(app)
        .put(`/v1/barbers/${barber.id}/schedule`)
        .set('Authorization', authHeader)
        .send(week);
      await request(app)
        .put(`/v1/barbers/${barber.id}/schedule`)
        .set('Authorization', authHeader)
        .send(week);

      const stored = await dataSource.getRepository(BarberSchedule).findBy({ barberId: barber.id });
      expect(stored).toHaveLength(2);
    });

    it('lets a barber set their own week', async () => {
      const { user, authHeader } = await asRole('BARBER');
      const barber = await makeBarber(dataSource, { userId: user.id });

      const response = await request(app)
        .put(`/v1/barbers/${barber.id}/schedule`)
        .set('Authorization', authHeader)
        .send(week);

      expect(response.status).toBe(200);
    });

    it("stops a barber rewriting someone else's week", async () => {
      const { authHeader } = await asRole('BARBER');
      const other = await makeBarber(dataSource);

      const response = await request(app)
        .put(`/v1/barbers/${other.id}/schedule`)
        .set('Authorization', authHeader)
        .send(week);

      expect(response.status).toBe(403);
    });

    it.each([
      ['end before start', { weekday: 1, startTime: '18:00', endTime: '09:00' }],
      ['weekday out of range', { weekday: 9, startTime: '09:00', endTime: '18:00' }],
      [
        'break outside the window',
        {
          weekday: 1,
          startTime: '09:00',
          endTime: '18:00',
          breakStart: '19:00',
          breakEnd: '20:00',
        },
      ],
      ['half a break', { weekday: 1, startTime: '09:00', endTime: '18:00', breakStart: '12:00' }],
    ])('rejects %s', async (_label, day) => {
      const { authHeader } = await asRole('ADMIN');
      const barber = await makeBarber(dataSource);

      const response = await request(app)
        .put(`/v1/barbers/${barber.id}/schedule`)
        .set('Authorization', authHeader)
        .send({ days: [day] });

      expect(response.status).toBe(400);
    });

    it('rejects two entries for the same weekday', async () => {
      const { authHeader } = await asRole('ADMIN');
      const barber = await makeBarber(dataSource);

      const response = await request(app)
        .put(`/v1/barbers/${barber.id}/schedule`)
        .set('Authorization', authHeader)
        .send({
          days: [
            { weekday: 1, startTime: '09:00', endTime: '12:00' },
            { weekday: 1, startTime: '13:00', endTime: '18:00' },
          ],
        });

      expect(response.status).toBe(400);
    });

    it('empties the week when given no days', async () => {
      const { authHeader } = await asRole('ADMIN');
      const barber = await makeBarber(dataSource);
      await makeSchedule(dataSource, { barberId: barber.id });

      const response = await request(app)
        .put(`/v1/barbers/${barber.id}/schedule`)
        .set('Authorization', authHeader)
        .send({ days: [] });

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });
  });

  describe('GET /v1/barbers/:id/schedule', () => {
    it('needs a token', async () => {
      const barber = await makeBarber(dataSource);

      expect((await request(app).get(`/v1/barbers/${barber.id}/schedule`)).status).toBe(401);
    });

    it('is readable by any authenticated user', async () => {
      const { authHeader } = await asRole('CLIENT');
      const barber = await makeBarber(dataSource);
      await makeSchedule(dataSource, { barberId: barber.id, weekday: 3 });

      const response = await request(app)
        .get(`/v1/barbers/${barber.id}/schedule`)
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].weekday).toBe(3);
    });
  });

  describe('blocks', () => {
    const startsAt = '2030-03-04T13:00:00.000Z';
    const endsAt = '2030-03-04T14:00:00.000Z';

    it('creates and then removes a block', async () => {
      const { authHeader } = await asRole('MANAGER');
      const barber = await makeBarber(dataSource);

      const created = await request(app)
        .post(`/v1/barbers/${barber.id}/blocks`)
        .set('Authorization', authHeader)
        .send({ startsAt, endsAt, reason: 'dentist' });

      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({ startsAt, endsAt, reason: 'dentist' });

      const deleted = await request(app)
        .delete(`/v1/barbers/${barber.id}/blocks/${created.body.data.id}`)
        .set('Authorization', authHeader);

      expect(deleted.status).toBe(204);
    });

    it('refuses a block over a live appointment', async () => {
      const { authHeader } = await asRole('ADMIN');
      const barber = await makeBarber(dataSource);
      const appointment = await makeAppointment(dataSource, {
        barberId: barber.id,
        startsAt: new Date('2030-03-04T13:30:00.000Z'),
      });

      const response = await request(app)
        .post(`/v1/barbers/${barber.id}/blocks`)
        .set('Authorization', authHeader)
        .send({ startsAt, endsAt });

      expect(response.status).toBe(409);
      expect(response.body.error.details).toEqual([
        { id: appointment.id, startsAt: '2030-03-04T13:30:00.000Z' },
      ]);
    });

    it('allows a block over a cancelled appointment', async () => {
      const { authHeader } = await asRole('ADMIN');
      const barber = await makeBarber(dataSource);
      await makeAppointment(dataSource, {
        barberId: barber.id,
        startsAt: new Date('2030-03-04T13:30:00.000Z'),
        status: 'cancelled',
      });

      const response = await request(app)
        .post(`/v1/barbers/${barber.id}/blocks`)
        .set('Authorization', authHeader)
        .send({ startsAt, endsAt });

      expect(response.status).toBe(201);
    });

    it('rejects a block that ends before it starts', async () => {
      const { authHeader } = await asRole('ADMIN');
      const barber = await makeBarber(dataSource);

      const response = await request(app)
        .post(`/v1/barbers/${barber.id}/blocks`)
        .set('Authorization', authHeader)
        .send({ startsAt: endsAt, endsAt: startsAt });

      expect(response.status).toBe(400);
    });

    it("404s deleting another barber's block", async () => {
      const { authHeader } = await asRole('ADMIN');
      const barber = await makeBarber(dataSource);
      const other = await makeBarber(dataSource);
      const block = await makeBlock(dataSource, {
        barberId: other.id,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
      });

      const response = await request(app)
        .delete(`/v1/barbers/${barber.id}/blocks/${block.id}`)
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
    });
  });

  describe('GET /v1/barbers/:id/availability', () => {

    const MONDAY = '2030-03-04';

    async function barberWorkingMonday() {
      const barber = await makeBarber(dataSource);
      await makeSchedule(dataSource, {
        barberId: barber.id,
        weekday: 1,
        startTime: '09:00:00',
        endTime: '18:00:00',
      });

      return barber;
    }

    it('is public and returns the working window in UTC', async () => {
      const barber = await barberWorkingMonday();

      const response = await request(app).get(
        `/v1/barbers/${barber.id}/availability?date=${MONDAY}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        barberId: barber.id,
        date: MONDAY,
        timezone: 'America/Sao_Paulo',
        free: [{ startsAt: '2030-03-04T12:00:00.000Z', endsAt: '2030-03-04T21:00:00.000Z' }],
      });
    });

    it('drops a booked slot out of the free list', async () => {
      const barber = await barberWorkingMonday();
      await makeAppointment(dataSource, {
        barberId: barber.id,
        startsAt: new Date('2030-03-04T14:00:00.000Z'),
      });

      const response = await request(app).get(
        `/v1/barbers/${barber.id}/availability?date=${MONDAY}`,
      );

      expect(response.body.data.free).toEqual([
        { startsAt: '2030-03-04T12:00:00.000Z', endsAt: '2030-03-04T14:00:00.000Z' },
        { startsAt: '2030-03-04T14:30:00.000Z', endsAt: '2030-03-04T21:00:00.000Z' },
      ]);
    });

    it('subtracts blocks', async () => {
      const barber = await barberWorkingMonday();
      await makeBlock(dataSource, {
        barberId: barber.id,
        startsAt: new Date('2030-03-04T12:00:00.000Z'),
        endsAt: new Date('2030-03-04T15:00:00.000Z'),
        reason: 'vacation',
      });

      const response = await request(app).get(
        `/v1/barbers/${barber.id}/availability?date=${MONDAY}`,
      );

      expect(response.body.data.free).toEqual([
        { startsAt: '2030-03-04T15:00:00.000Z', endsAt: '2030-03-04T21:00:00.000Z' },
      ]);
    });

    it('is empty on a day the barber does not work', async () => {
      const barber = await barberWorkingMonday();

      const response = await request(app).get(
        `/v1/barbers/${barber.id}/availability?date=2030-03-05`,
      );

      expect(response.body.data.free).toEqual([]);
    });

    it('adds bookable start times when given a service', async () => {
      const barber = await barberWorkingMonday();
      const service = await makeService(dataSource, { durationMinutes: 60 });

      const response = await request(app).get(
        `/v1/barbers/${barber.id}/availability?date=${MONDAY}&serviceId=${service.id}&slotMinutes=60`,
      );

      expect(response.body.data.slots).toHaveLength(9);
      expect(response.body.data.slots.at(0)).toBe('2030-03-04T12:00:00.000Z');
      expect(response.body.data.slots.at(-1)).toBe('2030-03-04T20:00:00.000Z');
    });

    it('rejects a malformed date', async () => {
      const barber = await barberWorkingMonday();

      expect(
        (await request(app).get(`/v1/barbers/${barber.id}/availability?date=04-03-2030`)).status,
      ).toBe(400);
    });
  });
});
