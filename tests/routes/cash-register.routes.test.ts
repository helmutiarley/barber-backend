import { pino } from 'pino';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { loadConfig, type AppConfig } from '../../src/config';
import { buildContainer } from '../../src/container';
import { getTestDataSource, truncateAll } from '../support/db';
import { makeAuthenticatedUser, makeMovement, makeSession } from '../support/factories';

const UNKNOWN_UUID = '11111111-1111-4111-8111-111111111111';

describe('cash register routes', () => {
  let dataSource: DataSource;
  let config: AppConfig;
  let app: ReturnType<typeof createApp>;
  let managerAuth: string;
  let managerId: string;
  let barberAuth: string;
  let clientAuth: string;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    config = loadConfig();
    app = createApp(buildContainer({ config, logger: pino({ level: 'silent' }), dataSource }));
  });

  beforeEach(async () => {
    await truncateAll(dataSource);

    const manager = await makeAuthenticatedUser(dataSource, config, { role: 'MANAGER' });
    managerAuth = manager.authHeader;
    managerId = manager.user.id;
    barberAuth = (await makeAuthenticatedUser(dataSource, config, { role: 'BARBER' })).authHeader;
    clientAuth = (await makeAuthenticatedUser(dataSource, config, { role: 'CLIENT' })).authHeader;
  });

  function get(path: string, auth: string) {
    return request(app).get(path).set('Authorization', auth);
  }

  function post(path: string, auth: string, body: object = {}) {
    return request(app).post(path).set('Authorization', auth).send(body);
  }

  describe('POST /v1/cash-register/open', () => {
    it('opens the drawer with a counted starting balance', async () => {
      const response = await post('/v1/cash-register/open', managerAuth, {
        openingBalanceCents: 15_000,
      });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        status: 'open',
        openingBalanceCents: 15_000,
        openedBy: managerId,
        expectedBalanceCents: null,
      });
    });

    it('refuses a second drawer', async () => {
      await makeSession(dataSource);

      const response = await post('/v1/cash-register/open', managerAuth, {
        openingBalanceCents: 15_000,
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('refuses a negative opening balance', async () => {
      const response = await post('/v1/cash-register/open', managerAuth, {
        openingBalanceCents: -1,
      });

      expect(response.status).toBe(400);
    });

    it('is closed to barbers and clients', async () => {
      expect(
        (await post('/v1/cash-register/open', barberAuth, { openingBalanceCents: 1 })).status,
      ).toBe(403);
      expect(
        (await post('/v1/cash-register/open', clientAuth, { openingBalanceCents: 1 })).status,
      ).toBe(403);
    });

    it('needs a token at all', async () => {
      const response = await request(app)
        .post('/v1/cash-register/open')
        .send({ openingBalanceCents: 1 });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /v1/cash-register/current', () => {
    it('adds up the movements since open', async () => {
      const session = await makeSession(dataSource, { openingBalance: 10_000 });
      await makeMovement(dataSource, { sessionId: session.id, type: 'in', amount: 4500 });
      await makeMovement(dataSource, {
        sessionId: session.id,
        type: 'out',
        source: 'withdrawal',
        amount: 1500,
      });

      const response = await get('/v1/cash-register/current', managerAuth);

      expect(response.status).toBe(200);
      expect(response.body.data.totals).toEqual({
        inCents: 4500,
        outCents: 1500,
        expectedBalanceCents: 13_000,
      });
    });

    it('409s when the register is closed', async () => {
      const response = await get('/v1/cash-register/current', managerAuth);

      expect(response.status).toBe(409);
    });
  });

  describe('POST /v1/cash-register/movements', () => {
    it('records a withdrawal against the open session', async () => {
      const session = await makeSession(dataSource);

      const response = await post('/v1/cash-register/movements', managerAuth, {
        type: 'out',
        source: 'withdrawal',
        amountCents: 5000,
        description: 'taken to the bank',
      });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        sessionId: session.id,
        type: 'out',
        source: 'withdrawal',
        amountCents: 5000,
      });
    });

    it('refuses a source only another module may write', async () => {
      await makeSession(dataSource);

      const response = await post('/v1/cash-register/movements', managerAuth, {
        type: 'in',
        source: 'payment',
        amountCents: 5000,
        description: 'cash in hand, honest',
      });

      expect(response.status).toBe(400);
    });

    it('demands a description', async () => {
      await makeSession(dataSource);

      const response = await post('/v1/cash-register/movements', managerAuth, {
        type: 'in',
        source: 'deposit',
        amountCents: 5000,
      });

      expect(response.status).toBe(400);
    });

    it('409s with no register open', async () => {
      const response = await post('/v1/cash-register/movements', managerAuth, {
        type: 'in',
        source: 'deposit',
        amountCents: 5000,
        description: 'float top-up',
      });

      expect(response.status).toBe(409);
    });
  });

  describe('POST /v1/cash-register/close', () => {
    it('snapshots expected, counted and difference', async () => {
      const session = await makeSession(dataSource, { openingBalance: 10_000 });
      await makeMovement(dataSource, { sessionId: session.id, type: 'in', amount: 4500 });

      const response = await post('/v1/cash-register/close', managerAuth, {
        countedBalanceCents: 14_500,
      });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        status: 'closed',
        expectedBalanceCents: 14_500,
        countedBalanceCents: 14_500,
        differenceCents: 0,
        closedBy: managerId,
      });
    });

    it('demands notes when the count does not match', async () => {
      await makeSession(dataSource, { openingBalance: 10_000 });

      const response = await post('/v1/cash-register/close', managerAuth, {
        countedBalanceCents: 9800,
      });

      expect(response.status).toBe(400);
      expect(response.body.error.details).toMatchObject({ differenceCents: -200 });
    });

    it('accepts an explained shortfall', async () => {
      await makeSession(dataSource, { openingBalance: 10_000 });

      const response = await post('/v1/cash-register/close', managerAuth, {
        countedBalanceCents: 9800,
        notes: 'two notes went missing',
      });

      expect(response.status).toBe(200);
      expect(response.body.data.differenceCents).toBe(-200);
    });

    it('409s when nothing is open', async () => {
      const response = await post('/v1/cash-register/close', managerAuth, {
        countedBalanceCents: 10_000,
      });

      expect(response.status).toBe(409);
    });

    it('freezes the session: no movement lands after close', async () => {
      await makeSession(dataSource, { openingBalance: 10_000 });
      await post('/v1/cash-register/close', managerAuth, { countedBalanceCents: 10_000 });

      const response = await post('/v1/cash-register/movements', managerAuth, {
        type: 'in',
        source: 'deposit',
        amountCents: 1000,
        description: 'one more, after hours',
      });

      expect(response.status).toBe(409);
    });
  });

  describe('GET /v1/cash-register/sessions', () => {
    it('lists the history, newest first', async () => {
      await makeSession(dataSource, {
        status: 'closed',
        openedAt: new Date('2030-01-05T12:00:00.000Z'),
      });
      await makeSession(dataSource, { openedAt: new Date('2030-02-05T12:00:00.000Z') });

      const response = await get('/v1/cash-register/sessions?limit=10', managerAuth);

      expect(response.status).toBe(200);
      expect(response.body.meta).toEqual({ total: 2, limit: 10, offset: 0 });
      expect(response.body.data[0].openedAt).toBe('2030-02-05T12:00:00.000Z');
    });

    it('narrows to a date range', async () => {
      await makeSession(dataSource, {
        status: 'closed',
        openedAt: new Date('2029-01-05T12:00:00.000Z'),
      });
      await makeSession(dataSource, { openedAt: new Date('2030-02-05T12:00:00.000Z') });

      const response = await get(
        '/v1/cash-register/sessions?from=2030-01-01T00:00:00.000Z&to=2030-12-31T00:00:00.000Z',
        managerAuth,
      );

      expect(response.body.meta.total).toBe(1);
    });
  });

  describe('GET /v1/cash-register/sessions/:id', () => {
    it('returns the session with its movements', async () => {
      const session = await makeSession(dataSource);
      await makeMovement(dataSource, { sessionId: session.id, description: 'float top-up' });

      const response = await get(`/v1/cash-register/sessions/${session.id}`, managerAuth);

      expect(response.status).toBe(200);
      expect(response.body.data.session.id).toBe(session.id);
      expect(response.body.data.movements).toHaveLength(1);
      expect(response.body.data.movements[0].description).toBe('float top-up');
    });

    it('404s on an unknown session', async () => {
      const response = await get(`/v1/cash-register/sessions/${UNKNOWN_UUID}`, managerAuth);

      expect(response.status).toBe(404);
    });

    it('does not read the list route as a session id', async () => {
      const response = await get('/v1/cash-register/sessions', managerAuth);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });
  });
});
