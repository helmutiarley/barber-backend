import { pino } from 'pino';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { loadConfig, type AppConfig } from '../../src/config';
import { buildContainer } from '../../src/container';
import type { User } from '../../src/entities/user.entity';
import { getTestDataSource, truncateAll } from '../support/db';
import {
  makeAppointment,
  makeAuthenticatedUser,
  makeBarber,
  makeClientProfile,
} from '../support/factories';

const UNKNOWN_UUID = '11111111-1111-4111-8111-111111111111';
const LAST_MONTH = new Date('2030-02-20T13:00:00.000Z');
const LAST_YEAR = new Date('2029-03-01T13:00:00.000Z');

describe('clients routes', () => {
  let dataSource: DataSource;
  let config: AppConfig;
  let app: ReturnType<typeof createApp>;
  let client: User;
  let clientAuth: string;
  let managerAuth: string;
  let barberAuth: string;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    config = loadConfig();
    app = createApp(buildContainer({ config, logger: pino({ level: 'silent' }), dataSource }));
  });

  beforeEach(async () => {
    await truncateAll(dataSource);

    const clientAccount = await makeAuthenticatedUser(dataSource, config, {
      name: 'Ana Souza',
      email: 'ana@test.local',
      phone: '+5511999990000',
      role: 'CLIENT',
    });
    client = clientAccount.user;
    clientAuth = clientAccount.authHeader;

    managerAuth = (await makeAuthenticatedUser(dataSource, config, { role: 'MANAGER' })).authHeader;

    const barberAccount = await makeAuthenticatedUser(dataSource, config, { role: 'BARBER' });
    barberAuth = barberAccount.authHeader;
    await makeBarber(dataSource, { userId: barberAccount.user.id });
  });

  function get(path: string, auth: string) {
    return request(app).get(path).set('Authorization', auth);
  }

  describe('GET /v1/clients', () => {
    it('lists clients with their profiles, paginated', async () => {
      await makeClientProfile(dataSource, { userId: client.id, preferences: 'fade' });
      await makeAuthenticatedUser(dataSource, config, { name: 'Bruno Lima', role: 'CLIENT' });

      const response = await get('/v1/clients?limit=1&offset=0', managerAuth);

      expect(response.status).toBe(200);
      expect(response.body.meta).toEqual({ total: 2, limit: 1, offset: 0 });
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({ name: 'Ana Souza', preferences: 'fade' });
    });

    it('searches across name, email and phone', async () => {
      await makeAuthenticatedUser(dataSource, config, { name: 'Bruno Lima', role: 'CLIENT' });

      const response = await get('/v1/clients?search=99999', managerAuth);

      expect(response.body.data.map((row: { name: string }) => row.name)).toEqual(['Ana Souza']);
    });

    it('filters by birthday month and by inactivity', async () => {
      await makeClientProfile(dataSource, { userId: client.id, birthday: '1988-03-14' });
      const regular = await makeAuthenticatedUser(dataSource, config, {
        name: 'Bruno Lima',
        role: 'CLIENT',
      });
      await makeAppointment(dataSource, {
        clientId: regular.user.id,
        status: 'completed',
        startsAt: LAST_MONTH,
      });

      const birthdays = await get('/v1/clients?birthdayMonth=3', managerAuth);
      const lapsed = await get('/v1/clients?inactiveSince=2030-01-01', managerAuth);

      expect(birthdays.body.data.map((row: { name: string }) => row.name)).toEqual(['Ana Souza']);
      expect(lapsed.body.data.map((row: { name: string }) => row.name)).toEqual(['Ana Souza']);
    });

    it('is closed to barbers and clients', async () => {
      expect((await get('/v1/clients', barberAuth)).status).toBe(403);
      expect((await get('/v1/clients', clientAuth)).status).toBe(403);
      expect((await request(app).get('/v1/clients')).status).toBe(401);
    });

    it('rejects a birthday month outside the calendar', async () => {
      const response = await get('/v1/clients?birthdayMonth=13', managerAuth);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /v1/clients/:id', () => {
    beforeEach(async () => {
      await makeClientProfile(dataSource, {
        userId: client.id,
        birthday: '1988-03-14',
        preferences: 'máquina 2 na lateral',
        internalNotes: 'always fifteen minutes late',
      });
      await makeAppointment(dataSource, {
        clientId: client.id,
        status: 'completed',
        startsAt: LAST_MONTH,
        price: 5000,
      });
    });

    it('gives staff the notes and the computed stats', async () => {
      const response = await get(`/v1/clients/${client.id}`, managerAuth);

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        email: 'ana@test.local',
        birthday: '1988-03-14',
        internalNotes: 'always fifteen minutes late',
        stats: {
          visits: 1,
          lastVisitAt: LAST_MONTH.toISOString(),
          averageTicketCents: 5000,
          noShows: 0,
        },
      });
    });

    it('gives a barber preferences without any way to contact the client', async () => {
      const response = await get(`/v1/clients/${client.id}`, barberAuth);

      expect(response.status).toBe(200);
      expect(response.body.data.preferences).toBe('máquina 2 na lateral');
      expect(response.body.data).not.toHaveProperty('email');
      expect(response.body.data).not.toHaveProperty('phone');
      expect(response.body.data).not.toHaveProperty('internalNotes');
    });

    it('lets a client read themselves, but nobody else', async () => {
      const other = await makeAuthenticatedUser(dataSource, config, { role: 'CLIENT' });

      const own = await get(`/v1/clients/${client.id}`, clientAuth);
      const theirs = await get(`/v1/clients/${other.user.id}`, clientAuth);

      expect(own.status).toBe(200);
      expect(own.body.data).not.toHaveProperty('internalNotes');
      expect(theirs.status).toBe(403);
    });

    it('404s a staff user asked for through the CRM', async () => {
      const manager = await makeAuthenticatedUser(dataSource, config, { role: 'MANAGER' });

      const response = await get(`/v1/clients/${manager.user.id}`, managerAuth);

      expect(response.status).toBe(404);
    });

    it('404s an unknown id and 400s a malformed one', async () => {
      expect((await get(`/v1/clients/${UNKNOWN_UUID}`, managerAuth)).status).toBe(404);
      expect((await get('/v1/clients/not-a-uuid', managerAuth)).status).toBe(400);
    });
  });

  describe('GET /v1/clients/me', () => {
    it('returns the self shape, empty when no profile row exists yet', async () => {
      const response = await get('/v1/clients/me', clientAuth);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({
        id: client.id,
        name: 'Ana Souza',
        email: 'ana@test.local',
        phone: '+5511999990000',
        birthday: null,
        preferences: null,
      });
    });

    it('is not shadowed by the :id route', async () => {
      const response = await get('/v1/clients/me', clientAuth);

      expect(response.status).not.toBe(400);
    });

    it('has nothing to show a manager, who is not a client', async () => {
      expect((await get('/v1/clients/me', managerAuth)).status).toBe(404);
    });

    it('needs a token', async () => {
      expect((await request(app).get('/v1/clients/me')).status).toBe(401);
    });
  });

  describe('PATCH /v1/clients/:id', () => {
    it('creates the profile row on the first edit', async () => {
      const response = await request(app)
        .patch(`/v1/clients/${client.id}`)
        .set('Authorization', managerAuth)
        .send({ preferences: 'fade', internalNotes: 'prefers Rafael' });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        preferences: 'fade',
        internalNotes: 'prefers Rafael',
      });

      const reread = await get(`/v1/clients/${client.id}`, managerAuth);
      expect(reread.body.data.internalNotes).toBe('prefers Rafael');
    });

    it('leaves the other fields alone on a partial edit', async () => {
      await makeClientProfile(dataSource, {
        userId: client.id,
        preferences: 'fade',
        internalNotes: 'prefers Rafael',
      });

      const response = await request(app)
        .patch(`/v1/clients/${client.id}`)
        .set('Authorization', managerAuth)
        .send({ birthday: '1988-03-14' });

      expect(response.body.data).toMatchObject({
        birthday: '1988-03-14',
        preferences: 'fade',
        internalNotes: 'prefers Rafael',
      });
    });

    it('refuses a barber and a client', async () => {
      const patch = (auth: string) =>
        request(app)
          .patch(`/v1/clients/${client.id}`)
          .set('Authorization', auth)
          .send({ preferences: 'fade' });

      expect((await patch(barberAuth)).status).toBe(403);
      expect((await patch(clientAuth)).status).toBe(403);
    });

    it('rejects an empty edit and a birthday that is not a date', async () => {
      const patch = (payload: Record<string, unknown>) =>
        request(app)
          .patch(`/v1/clients/${client.id}`)
          .set('Authorization', managerAuth)
          .send(payload);

      expect((await patch({})).status).toBe(400);
      expect((await patch({ birthday: '14/03/1988' })).status).toBe(400);
    });
  });

  describe('PATCH /v1/clients/me', () => {
    it('lets a client set their own birthday and preferences', async () => {
      const response = await request(app)
        .patch('/v1/clients/me')
        .set('Authorization', clientAuth)
        .send({ birthday: '1988-03-14', preferences: 'sem máquina' });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        birthday: '1988-03-14',
        preferences: 'sem máquina',
      });
      expect(response.body.data).not.toHaveProperty('internalNotes');
    });

    it('ignores internal notes rather than writing them', async () => {
      await request(app)
        .patch('/v1/clients/me')
        .set('Authorization', clientAuth)
        .send({ preferences: 'fade', internalNotes: 'I am a delight' });

      const staffView = await get(`/v1/clients/${client.id}`, managerAuth);
      expect(staffView.body.data.preferences).toBe('fade');
      expect(staffView.body.data.internalNotes).toBeNull();
    });
  });

  describe('GET /v1/clients/:id/history', () => {
    beforeEach(async () => {
      await makeAppointment(dataSource, {
        clientId: client.id,
        status: 'completed',
        startsAt: LAST_YEAR,
      });
      await makeAppointment(dataSource, {
        clientId: client.id,
        status: 'completed',
        startsAt: LAST_MONTH,
      });
    });

    it('returns the appointments of that client alone, newest first', async () => {
      const response = await get(`/v1/clients/${client.id}/history`, managerAuth);

      expect(response.status).toBe(200);
      expect(response.body.meta.total).toBe(2);
      expect(response.body.data[0].startsAt).toBe(LAST_MONTH.toISOString());
    });

    it('shows nothing of another client', async () => {
      const other = await makeAuthenticatedUser(dataSource, config, { role: 'CLIENT' });
      await makeAppointment(dataSource, { clientId: other.user.id, startsAt: LAST_MONTH });

      const response = await get(`/v1/clients/${client.id}/history`, managerAuth);

      expect(
        response.body.data.every((row: { clientId: string }) => row.clientId === client.id),
      ).toBe(true);
    });

    it('is open to barbers and closed to other clients', async () => {
      const other = await makeAuthenticatedUser(dataSource, config, { role: 'CLIENT' });

      expect((await get(`/v1/clients/${client.id}/history`, barberAuth)).status).toBe(200);
      expect((await get(`/v1/clients/${client.id}/history`, other.authHeader)).status).toBe(403);
      expect((await get(`/v1/clients/${client.id}/history`, clientAuth)).status).toBe(200);
    });
  });
});
