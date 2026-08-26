import { pino } from 'pino';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { loadConfig, type AppConfig } from '../../src/config';
import { buildContainer } from '../../src/container';
import { Barber } from '../../src/entities/barber.entity';
import { Service } from '../../src/entities/service.entity';
import { User } from '../../src/entities/user.entity';
import { getTestDataSource, truncateAll } from '../support/db';
import {
  makeAuthenticatedUser,
  makeBarber,
  makeCommissionRule,
  makeService,
  makeUser,
  makeWorkingWeek,
} from '../support/factories';

const UNKNOWN_UUID = '11111111-1111-4111-8111-111111111111';
const AT_10_00 = '2030-03-01T10:00:00.000Z';
const AT_10_15 = '2030-03-01T10:15:00.000Z';
const AT_10_30 = '2030-03-01T10:30:00.000Z';
const AT_11_00 = '2030-03-01T11:00:00.000Z';

describe('appointments routes', () => {
  let dataSource: DataSource;
  let config: AppConfig;
  let app: ReturnType<typeof createApp>;
  let client: User;
  let clientAuth: string;
  let barber: Barber;
  let service: Service;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    config = loadConfig();
    app = createApp(buildContainer({ config, logger: pino({ level: 'silent' }), dataSource }));
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    const authenticated = await makeAuthenticatedUser(dataSource, config, { role: 'CLIENT' });
    client = authenticated.user;
    clientAuth = authenticated.authHeader;
    barber = await makeBarber(dataSource);

    await makeWorkingWeek(dataSource, barber.id);
    service = await makeService(dataSource, { price: 4500, durationMinutes: 30 });
  });

  function body(overrides: Record<string, unknown> = {}) {
    return {
      barberId: barber.id,
      serviceId: service.id,
      startsAt: AT_10_00,
      ...overrides,
    };
  }

  function book(overrides: Record<string, unknown> = {}, auth = clientAuth) {
    return request(app).post('/v1/appointments').set('Authorization', auth).send(body(overrides));
  }

  describe('POST /v1/appointments', () => {
    it('creates the appointment with snapshotted price and derived end time', async () => {
      const response = await book();

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        clientId: client.id,
        status: 'scheduled',
        priceCents: 4500,
        durationMinutes: 30,
        startsAt: AT_10_00,
        endsAt: AT_10_30,
      });
    });

    it('keeps the price snapshot when the catalog changes afterwards', async () => {
      const created = await book();
      await dataSource.getRepository(Service).update(service.id, { price: 9900 });

      const reloaded = await request(app)
        .get(`/v1/appointments/${created.body.data.id}`)
        .set('Authorization', clientAuth);

      expect(reloaded.body.data.priceCents).toBe(4500);
    });

    it('rejects an overlapping slot for the same barber', async () => {
      await book();

      const response = await book({ startsAt: AT_10_15 });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('allows a back-to-back slot', async () => {
      await book();

      expect((await book({ startsAt: AT_10_30 })).status).toBe(201);
    });

    it('holds the no-overlap invariant under concurrent requests', async () => {

      const responses = await Promise.all([book(), book()]);

      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([201, 409]);
    });

    it('returns 409 for an inactive service', async () => {
      const inactive = await makeService(dataSource, { active: false });

      expect((await book({ serviceId: inactive.id })).status).toBe(409);
    });

    it('returns 404 for an unknown barber', async () => {
      const response = await book({ barberId: UNKNOWN_UUID });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 with field details for a past start time', async () => {
      const response = await book({ startsAt: '2020-01-01T10:00:00.000Z' });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'startsAt' }],
      });
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await request(app)
        .post('/v1/appointments')
        .set('Authorization', clientAuth)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.details.length).toBeGreaterThan(0);
    });

    it('returns 401 without a token', async () => {
      const response = await request(app).post('/v1/appointments').send(body());

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('refuses a client booking for someone else', async () => {
      const other = await makeAuthenticatedUser(dataSource, config, { role: 'CLIENT' });

      const response = await book({ clientId: other.user.id });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('lets reception book on behalf of a client', async () => {
      const manager = await makeAuthenticatedUser(dataSource, config, { role: 'MANAGER' });

      const response = await book({ clientId: client.id }, manager.authHeader);

      expect(response.status).toBe(201);
      expect(response.body.data.clientId).toBe(client.id);
    });

    describe('walk-in', () => {
      const WALK_IN = { name: 'Cliente Balc\u00e3o', phone: '11988887777' };

      let receptionAuth: string;

      beforeEach(async () => {
        receptionAuth = (await makeAuthenticatedUser(dataSource, config, { role: 'MANAGER' }))
          .authHeader;
      });

      function clientsOnThatPhone(): Promise<User[]> {
        return dataSource.getRepository(User).findBy({ phone: WALK_IN.phone, role: 'CLIENT' });
      }

      it('registers the client from name and phone alone', async () => {
        const response = await book({ walkIn: WALK_IN }, receptionAuth);

        expect(response.status).toBe(201);

        const [registered] = await clientsOnThatPhone();
        expect(registered).toMatchObject({ name: WALK_IN.name, phone: WALK_IN.phone, email: null });
        expect(response.body.data.clientId).toBe(registered.id);
      });

      it('leaves the walk-in unable to log in', async () => {
        await book({ walkIn: WALK_IN }, receptionAuth);
        const [registered] = await clientsOnThatPhone();

        const stored = await dataSource
          .getRepository(User)
          .createQueryBuilder('user')
          .addSelect('user.passwordHash')
          .where('user.id = :id', { id: registered.id })
          .getOne();

        expect(stored?.passwordHash).toBeNull();
      });

      it('books the client already on that phone instead of a second one', async () => {
        const first = await book({ walkIn: WALK_IN }, receptionAuth);

        const second = await book(
          { walkIn: { ...WALK_IN, name: 'Nome Digitado Diferente' }, startsAt: AT_11_00 },
          receptionAuth,
        );

        expect(second.status).toBe(201);
        expect(second.body.data.clientId).toBe(first.body.data.clientId);
        expect(await clientsOnThatPhone()).toHaveLength(1);
      });

      it('books the client stored under the same digits, however the phone is typed', async () => {
        const registered = await makeUser(dataSource, {
          role: 'CLIENT',
          name: 'Cliente Antigo',
          phone: WALK_IN.phone,
        });

        const response = await book(
          { walkIn: { name: 'Nome Digitado Diferente', phone: '(11) 98888-7777' } },
          receptionAuth,
        );

        expect(response.status).toBe(201);
        expect(response.body.data.clientId).toBe(registered.id);
      });

      it('finds the walk-in by phone in the client list, punctuation and all', async () => {
        await book({ walkIn: WALK_IN }, receptionAuth);

        const response = await request(app)
          .get(`/v1/clients?search=${encodeURIComponent('(11) 98888-7777')}`)
          .set('Authorization', receptionAuth);

        expect(response.body.data).toMatchObject([
          { name: WALK_IN.name, phone: WALK_IN.phone, email: null },
        ]);
      });

      it('registers nobody when the slot is already taken', async () => {
        await book();

        const response = await book({ walkIn: WALK_IN }, receptionAuth);

        expect(response.status).toBe(409);
        expect(await clientsOnThatPhone()).toHaveLength(0);
      });

      it('refuses a client registering one', async () => {
        const response = await book({ walkIn: WALK_IN });

        expect(response.status).toBe(403);
        expect(await clientsOnThatPhone()).toHaveLength(0);
      });

      it('rejects a body naming both a client and a walk-in', async () => {
        const response = await book({ clientId: client.id, walkIn: WALK_IN }, receptionAuth);

        expect(response.status).toBe(400);
        expect(response.body.error.details).toMatchObject([{ field: 'walkIn' }]);
      });

      it('rejects a walk-in without a phone', async () => {
        const response = await book({ walkIn: { name: WALK_IN.name } }, receptionAuth);

        expect(response.status).toBe(400);
        expect(response.body.error.details).toMatchObject([{ field: 'walkIn.phone' }]);
      });
    });

    describe('availability', () => {

      const OUTSIDE_HOURS = '2030-03-01T05:00:00.000Z';

      it('refuses a slot outside the working week', async () => {
        const response = await book({ startsAt: OUTSIDE_HOURS });

        expect(response.status).toBe(409);
        expect(response.body.error.message).toMatch(/not available/);
      });

      it('refuses a slot the barber has blocked', async () => {
        const manager = await makeAuthenticatedUser(dataSource, config, { role: 'MANAGER' });
        await request(app)
          .post(`/v1/barbers/${barber.id}/blocks`)
          .set('Authorization', manager.authHeader)
          .send({ startsAt: AT_10_00, endsAt: AT_10_30, reason: 'dentist' })
          .expect(201);

        expect((await book()).status).toBe(409);
      });

      it('lets staff force a booking outside working hours', async () => {
        const admin = await makeAuthenticatedUser(dataSource, config, { role: 'ADMIN' });

        const response = await book(
          { startsAt: OUTSIDE_HOURS, clientId: client.id, force: true },
          admin.authHeader,
        );

        expect(response.status).toBe(201);
      });

      it('refuses a client who tries to force one', async () => {
        const response = await book({ startsAt: OUTSIDE_HOURS, force: true });

        expect(response.status).toBe(403);
      });

      it('still refuses an overlap when forced', async () => {
        const admin = await makeAuthenticatedUser(dataSource, config, { role: 'ADMIN' });
        await book();

        const response = await book(
          { startsAt: AT_10_15, clientId: client.id, force: true },
          admin.authHeader,
        );

        expect(response.status).toBe(409);
      });
    });
  });

  describe('GET /v1/appointments/:id', () => {
    it('returns the appointment to its own client', async () => {
      const created = await book();

      const response = await request(app)
        .get(`/v1/appointments/${created.body.data.id}`)
        .set('Authorization', clientAuth);

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(created.body.data.id);
    });

    it('hides another client\u2019s appointment', async () => {
      const created = await book();
      const other = await makeAuthenticatedUser(dataSource, config, { role: 'CLIENT' });

      const response = await request(app)
        .get(`/v1/appointments/${created.body.data.id}`)
        .set('Authorization', other.authHeader);

      expect(response.status).toBe(403);
    });

    it('returns 404 for an unknown id', async () => {
      const response = await request(app)
        .get(`/v1/appointments/${UNKNOWN_UUID}`)
        .set('Authorization', clientAuth);

      expect(response.status).toBe(404);
    });

    it('returns 401 without a token', async () => {
      const response = await request(app).get(`/v1/appointments/${UNKNOWN_UUID}`);

      expect(response.status).toBe(401);
    });
  });

  describe('GET /v1/appointments', () => {
    const MARCH = { from: '2030-03-01T00:00:00.000Z', to: '2030-03-02T00:00:00.000Z' };

    let managerAuth: string;

    beforeEach(async () => {
      managerAuth = (await makeAuthenticatedUser(dataSource, config, { role: 'MANAGER' }))
        .authHeader;
    });

    function list(query: Record<string, unknown>, auth = managerAuth) {
      return request(app).get('/v1/appointments').query(query).set('Authorization', auth);
    }

    it('returns the range with a total beside it', async () => {
      await book();
      await book({ startsAt: AT_11_00 });

      const response = await list(MARCH);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.meta).toEqual({ total: 2, limit: 50, offset: 0 });
    });

    it('counts everything that matched, not just the page', async () => {
      await book();
      await book({ startsAt: AT_11_00 });

      const response = await list({ ...MARCH, limit: 1 });

      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta.total).toBe(2);
    });

    it('pages without repeating a row', async () => {
      await book();
      await book({ startsAt: AT_11_00 });

      const first = await list({ ...MARCH, limit: 1 });
      const second = await list({ ...MARCH, limit: 1, offset: 1 });

      expect(second.body.data[0].id).not.toBe(first.body.data[0].id);
      expect(second.body.data[0].startsAt).toBe(AT_11_00);
    });

    it('excludes what falls outside the range', async () => {
      await book();

      const response = await list({
        from: '2030-04-01T00:00:00.000Z',
        to: '2030-04-02T00:00:00.000Z',
      });

      expect(response.body.data).toHaveLength(0);
      expect(response.body.meta.total).toBe(0);
    });

    it('filters by status', async () => {
      const created = await book();
      await book({ startsAt: AT_11_00 });
      await request(app)
        .post(`/v1/appointments/${created.body.data.id}/confirm`)
        .set('Authorization', managerAuth);

      const response = await list({ ...MARCH, status: 'confirmed' });

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].status).toBe('confirmed');
    });

    it('filters by barber', async () => {
      await book();
      const other = await makeBarber(dataSource, { displayName: 'Outro' });

      const response = await list({ ...MARCH, barberId: other.id });

      expect(response.body.data).toHaveLength(0);
    });

    it('demands a range', async () => {
      const response = await list({});

      expect(response.status).toBe(400);
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'from' })]),
      );
    });

    it('refuses a range wider than a quarter', async () => {
      const response = await list({
        from: '2030-01-01T00:00:00.000Z',
        to: '2030-12-31T00:00:00.000Z',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'to' })]),
      );
    });

    it('refuses a range that runs backwards', async () => {
      const response = await list({ from: MARCH.to, to: MARCH.from });

      expect(response.status).toBe(400);
    });

    it('is staff-only', async () => {
      expect((await list(MARCH, clientAuth)).status).toBe(403);
    });
  });

  describe('GET /v1/clients/me/appointments', () => {
    it('returns only the caller\u2019s own, newest first', async () => {
      await book();
      await book({ startsAt: AT_11_00 });
      const other = await makeAuthenticatedUser(dataSource, config, { role: 'CLIENT' });
      const manager = await makeAuthenticatedUser(dataSource, config, { role: 'MANAGER' });
      await book(
        { clientId: other.user.id, startsAt: '2030-03-01T12:00:00.000Z' },
        manager.authHeader,
      );

      const response = await request(app)
        .get('/v1/clients/me/appointments')
        .set('Authorization', clientAuth);

      expect(response.status).toBe(200);
      expect(response.body.meta.total).toBe(2);
      expect(response.body.data.map((row: { startsAt: string }) => row.startsAt)).toEqual([
        AT_11_00,
        AT_10_00,
      ]);
    });

    it('keeps cancelled appointments in the history', async () => {
      const created = await book();
      const manager = await makeAuthenticatedUser(dataSource, config, { role: 'MANAGER' });
      await request(app)
        .post(`/v1/appointments/${created.body.data.id}/cancel`)
        .set('Authorization', manager.authHeader)
        .send({ reason: 'Cliente ligou' });

      const response = await request(app)
        .get('/v1/clients/me/appointments')
        .set('Authorization', clientAuth);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].status).toBe('cancelled');
    });

    it('returns 401 without a token', async () => {
      expect((await request(app).get('/v1/clients/me/appointments')).status).toBe(401);
    });
  });

  describe('GET /v1/barbers/:id/agenda', () => {
    function agenda(date: string, auth: string, barberId = barber.id) {
      return request(app)
        .get(`/v1/barbers/${barberId}/agenda`)
        .query({ date })
        .set('Authorization', auth);
    }

    it('returns the shop-local day in order', async () => {
      const manager = await makeAuthenticatedUser(dataSource, config, { role: 'MANAGER' });
      await book({ startsAt: AT_11_00 });
      await book();

      const response = await agenda('2030-03-01', manager.authHeader);

      expect(response.status).toBe(200);
      expect(response.body.data.map((row: { startsAt: string }) => row.startsAt)).toEqual([
        AT_10_00,
        AT_11_00,
      ]);
    });

    it('keeps cancellations on the day, because they explain the gap', async () => {
      const manager = await makeAuthenticatedUser(dataSource, config, { role: 'MANAGER' });
      const created = await book();
      await request(app)
        .post(`/v1/appointments/${created.body.data.id}/cancel`)
        .set('Authorization', manager.authHeader)
        .send({ reason: 'Cliente ligou' });

      const response = await agenda('2030-03-01', manager.authHeader);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].status).toBe('cancelled');
    });

    it('is empty on another day', async () => {
      const manager = await makeAuthenticatedUser(dataSource, config, { role: 'MANAGER' });
      await book();

      expect((await agenda('2030-03-02', manager.authHeader)).body.data).toEqual([]);
    });

    it('lets the barber read their own and nobody else\u2019s', async () => {
      const own = await makeAuthenticatedUser(dataSource, config, { role: 'BARBER' });
      await dataSource.getRepository(Barber).update(barber.id, { userId: own.user.id });
      const stranger = await makeAuthenticatedUser(dataSource, config, { role: 'BARBER' });

      expect((await agenda('2030-03-01', own.authHeader)).status).toBe(200);
      expect((await agenda('2030-03-01', stranger.authHeader)).status).toBe(403);
    });

    it('hides it from clients', async () => {
      expect((await agenda('2030-03-01', clientAuth)).status).toBe(403);
    });

    it('returns 404 for an unknown barber', async () => {
      const manager = await makeAuthenticatedUser(dataSource, config, { role: 'MANAGER' });

      expect((await agenda('2030-03-01', manager.authHeader, UNKNOWN_UUID)).status).toBe(404);
    });

    it('rejects a malformed date', async () => {
      const manager = await makeAuthenticatedUser(dataSource, config, { role: 'MANAGER' });

      expect((await agenda('01/03/2030', manager.authHeader)).status).toBe(400);
    });
  });

  describe('transitions', () => {
    let managerAuth: string;
    let appointmentId: string;

    function post(action: string, auth: string, payload?: Record<string, unknown>) {
      const call = request(app)
        .post(`/v1/appointments/${appointmentId}/${action}`)
        .set('Authorization', auth);

      return payload ? call.send(payload) : call;
    }

    beforeEach(async () => {
      managerAuth = (await makeAuthenticatedUser(dataSource, config, { role: 'MANAGER' }))
        .authHeader;
      appointmentId = (await book()).body.data.id;

      await makeCommissionRule(dataSource);
    });

    it('walks book → confirm → complete', async () => {
      const confirmed = await post('confirm', managerAuth);
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.data.status).toBe('confirmed');

      const completed = await post('complete', managerAuth);
      expect(completed.status).toBe(200);
      expect(completed.body.data.status).toBe('completed');
    });

    it('refuses to complete an appointment nobody confirmed', async () => {
      const response = await post('complete', managerAuth);

      expect(response.status).toBe(409);
      expect(response.body.error.message).toMatch(/scheduled cannot become completed/);
    });

    it('refuses to touch a completed appointment again', async () => {
      await post('confirm', managerAuth);
      await post('complete', managerAuth);

      expect((await post('cancel', managerAuth, { reason: 'tarde' })).status).toBe(409);
    });

    it('lets the barber working it confirm, and turns away another barber', async () => {
      const own = await makeAuthenticatedUser(dataSource, config, { role: 'BARBER' });
      await dataSource.getRepository(Barber).update(barber.id, { userId: own.user.id });
      const stranger = await makeAuthenticatedUser(dataSource, config, { role: 'BARBER' });

      expect((await post('confirm', stranger.authHeader)).status).toBe(403);
      expect((await post('confirm', own.authHeader)).status).toBe(200);
    });

    it('refuses a no-show before the appointment was due', async () => {
      await post('confirm', managerAuth);

      const response = await post('no-show', managerAuth);

      expect(response.status).toBe(409);
      expect(response.body.error.message).toMatch(/has not started yet/);
    });

    it('marks a no-show once the time has passed', async () => {
      await post('confirm', managerAuth);

      await dataSource.query('UPDATE appointments SET starts_at = $1, ends_at = $2', [
        new Date(Date.now() - 7_200_000),
        new Date(Date.now() - 5_400_000),
      ]);

      const response = await post('no-show', managerAuth);

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('no_show');
    });

    describe('cancelling', () => {
      it('records who cancelled and why', async () => {
        const response = await post('cancel', managerAuth, { reason: 'Barbeiro doente' });

        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({
          status: 'cancelled',
          cancelledReason: 'Barbeiro doente',
        });
        expect(response.body.data.cancelledBy).toBeTruthy();
      });

      it('makes staff give a reason', async () => {
        const response = await post('cancel', managerAuth);

        expect(response.status).toBe(400);
        expect(response.body.error.details).toMatchObject([{ field: 'reason' }]);
      });

      it('frees the slot for someone else', async () => {
        await post('cancel', managerAuth, { reason: 'Cliente ligou' });

        expect((await book()).status).toBe(201);
      });

      it('holds the client to the cancellation window', async () => {

        await dataSource.query('UPDATE appointments SET starts_at = $1, ends_at = $2', [
          new Date(Date.now() + 3_600_000),
          new Date(Date.now() + 5_400_000),
        ]);

        const response = await post('cancel', clientAuth);

        expect(response.status).toBe(403);
        expect(response.body.error.message).toMatch(/call the shop/);
      });

      it('lets the client cancel while there is still plenty of time', async () => {
        const response = await post('cancel', clientAuth);

        expect(response.status).toBe(200);
        expect(response.body.data.cancelledBy).toBe(client.id);
      });

      it('refuses another client entirely', async () => {
        const other = await makeAuthenticatedUser(dataSource, config, { role: 'CLIENT' });

        expect((await post('cancel', other.authHeader)).status).toBe(403);
      });
    });

    it('returns 404 for an unknown appointment', async () => {
      const response = await request(app)
        .post(`/v1/appointments/${UNKNOWN_UUID}/confirm`)
        .set('Authorization', managerAuth);

      expect(response.status).toBe(404);
    });

    describe('rescheduling', () => {
      function move(startsAt: string, auth = managerAuth, extra: Record<string, unknown> = {}) {
        return request(app)
          .patch(`/v1/appointments/${appointmentId}`)
          .set('Authorization', auth)
          .send({ startsAt, ...extra });
      }

      it('moves the appointment and keeps the price', async () => {
        const response = await move(AT_11_00);

        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({
          startsAt: AT_11_00,
          endsAt: '2030-03-01T11:30:00.000Z',
          priceCents: 4500,
          status: 'scheduled',
        });
      });

      it('overlaps itself without complaining — the moved slot is its own', async () => {
        expect((await move(AT_10_15)).status).toBe(200);
      });

      it('frees the time it left behind', async () => {
        await move(AT_11_00);

        expect((await book()).status).toBe(201);
      });

      it('refuses a slot another client already holds', async () => {
        await book({ startsAt: AT_11_00 });

        expect((await move(AT_11_00)).status).toBe(409);
      });

      it('sends a confirmed appointment back to scheduled', async () => {
        await post('confirm', managerAuth);

        expect((await move(AT_11_00)).body.data.status).toBe('scheduled');
      });

      it('refuses to move a cancelled appointment', async () => {
        await post('cancel', managerAuth, { reason: 'Cliente ligou' });

        expect((await move(AT_11_00)).status).toBe(409);
      });

      it('requires a new start time', async () => {
        const response = await request(app)
          .patch(`/v1/appointments/${appointmentId}`)
          .set('Authorization', managerAuth)
          .send({});

        expect(response.status).toBe(400);
      });
    });

    it('returns 401 without a token', async () => {
      expect((await request(app).post(`/v1/appointments/${appointmentId}/confirm`)).status).toBe(
        401,
      );
    });
  });
});
