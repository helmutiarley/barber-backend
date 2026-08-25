import { pino } from 'pino';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { loadConfig, type AppConfig } from '../../src/config';
import { buildContainer } from '../../src/container';
import { CashMovement } from '../../src/entities/cash-movement.entity';
import { Expense } from '../../src/entities/expense.entity';
import { toShopDate } from '../../src/lib/shop-time';
import { getTestDataSource, truncateAll } from '../support/db';
import { makeAuthenticatedUser, makeExpense, makeSession } from '../support/factories';

const UNKNOWN_UUID = '11111111-1111-4111-8111-111111111111';
const DAY = 86_400_000;

describe('expenses routes', () => {
  let dataSource: DataSource;
  let config: AppConfig;
  let app: ReturnType<typeof createApp>;
  let adminAuth: string;
  let managerAuth: string;
  let managerId: string;
  let barberAuth: string;

  let yesterday: string;
  let tomorrow: string;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    config = loadConfig();
    app = createApp(buildContainer({ config, logger: pino({ level: 'silent' }), dataSource }));

    const now = Date.now();
    yesterday = toShopDate(new Date(now - DAY), config.shopTimezone);
    tomorrow = toShopDate(new Date(now + DAY), config.shopTimezone);
  });

  beforeEach(async () => {
    await truncateAll(dataSource);

    adminAuth = (await makeAuthenticatedUser(dataSource, config, { role: 'ADMIN' })).authHeader;
    const manager = await makeAuthenticatedUser(dataSource, config, { role: 'MANAGER' });
    managerAuth = manager.authHeader;
    managerId = manager.user.id;
    barberAuth = (await makeAuthenticatedUser(dataSource, config, { role: 'BARBER' })).authHeader;
  });

  function get(path: string, auth: string) {
    return request(app).get(path).set('Authorization', auth);
  }

  function post(path: string, auth: string, body: object = {}) {
    return request(app).post(path).set('Authorization', auth).send(body);
  }

  function patch(path: string, auth: string, body: object = {}) {
    return request(app).patch(path).set('Authorization', auth).send(body);
  }

  function countRows() {
    return Promise.all([
      dataSource.getRepository(Expense).count(),
      dataSource.getRepository(CashMovement).count(),
    ]);
  }

  describe('POST /v1/expenses', () => {
    it('records a pending cost', async () => {
      const response = await post('/v1/expenses', managerAuth, {
        description: 'Conta de luz',
        category: 'utilities',
        kind: 'fixed',
        amountCents: 43_215,
        dueDate: tomorrow,
      });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        description: 'Conta de luz',
        amountCents: 43_215,
        dueDate: tomorrow,
        paidAt: null,
        paymentMethod: null,
        recurring: false,
        overdue: false,
        createdBy: managerId,
      });
    });

    it('pays in cash on the way in and takes it out of the drawer', async () => {
      const session = await makeSession(dataSource);

      const response = await post('/v1/expenses', managerAuth, {
        description: 'Café e copos',
        category: 'supplies',
        kind: 'variable',
        amountCents: 7500,
        paymentMethod: 'cash',
      });

      expect(response.status).toBe(201);
      expect(response.body.data.paymentMethod).toBe('cash');

      const current = await get('/v1/cash-register/current', managerAuth);
      expect(current.body.data.totals).toMatchObject({ outCents: 7500 });

      const detail = await get(`/v1/cash-register/sessions/${session.id}`, managerAuth);
      expect(detail.body.data.movements).toHaveLength(1);
      expect(detail.body.data.movements[0]).toMatchObject({
        type: 'out',
        source: 'expense',
        amountCents: 7500,
        expenseId: response.body.data.id,
      });
    });

    it('leaves nothing behind when the drawer is closed', async () => {
      const response = await post('/v1/expenses', managerAuth, {
        description: 'Café e copos',
        category: 'supplies',
        kind: 'variable',
        amountCents: 7500,
        paymentMethod: 'cash',
      });

      expect(response.status).toBe(409);

      expect(await countRows()).toEqual([0, 0]);
    });

    it('takes a pix without touching the register', async () => {
      const response = await post('/v1/expenses', managerAuth, {
        description: 'Aluguel',
        category: 'rent',
        kind: 'fixed',
        amountCents: 250_000,
        paymentMethod: 'pix',
        recurring: true,
      });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({ paymentMethod: 'pix', recurring: true });
      expect(await countRows()).toEqual([1, 0]);
    });

    it('refuses a zero amount and an unknown category', async () => {
      const base = { description: 'x', category: 'supplies', kind: 'variable', amountCents: 1 };

      expect((await post('/v1/expenses', managerAuth, { ...base, amountCents: 0 })).status).toBe(
        400,
      );
      expect((await post('/v1/expenses', managerAuth, { ...base, category: 'beer' })).status).toBe(
        400,
      );
      expect(
        (await post('/v1/expenses', managerAuth, { ...base, dueDate: '01/2030' })).status,
      ).toBe(400);
    });
  });

  describe('POST /v1/expenses/:id/pay', () => {
    it('pays a pending expense out of the open drawer', async () => {
      const session = await makeSession(dataSource);
      const expense = await makeExpense(dataSource, { amount: 9000 });

      const response = await post(`/v1/expenses/${expense.id}/pay`, managerAuth, {
        paymentMethod: 'cash',
      });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ paymentMethod: 'cash', overdue: false });
      expect(response.body.data.paidAt).not.toBeNull();

      const detail = await get(`/v1/cash-register/sessions/${session.id}`, managerAuth);
      expect(detail.body.data.movements[0]).toMatchObject({
        source: 'expense',
        amountCents: 9000,
        expenseId: expense.id,
      });
    });

    it('refuses a second payment', async () => {
      const expense = await makeExpense(dataSource);
      await post(`/v1/expenses/${expense.id}/pay`, managerAuth, { paymentMethod: 'pix' });

      const response = await post(`/v1/expenses/${expense.id}/pay`, managerAuth, {
        paymentMethod: 'pix',
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('refuses to backdate a cash payment but accepts a late pix', async () => {
      await makeSession(dataSource);
      const cash = await makeExpense(dataSource);
      const pix = await makeExpense(dataSource);
      const threeDaysAgo = new Date(Date.now() - 3 * DAY).toISOString();

      const refused = await post(`/v1/expenses/${cash.id}/pay`, managerAuth, {
        paymentMethod: 'cash',
        paidAt: threeDaysAgo,
      });
      const accepted = await post(`/v1/expenses/${pix.id}/pay`, managerAuth, {
        paymentMethod: 'pix',
        paidAt: threeDaysAgo,
      });

      expect(refused.status).toBe(400);
      expect(accepted.status).toBe(200);
      expect(accepted.body.data.paidAt).toBe(threeDaysAgo);
    });

    it('404s on an expense that is not there', async () => {
      const response = await post(`/v1/expenses/${UNKNOWN_UUID}/pay`, managerAuth, {
        paymentMethod: 'pix',
      });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /v1/expenses', () => {
    it('returns the past-due pending one alone when asked for the overdue', async () => {
      const overdue = await makeExpense(dataSource, {
        description: 'Troca da cadeira',
        category: 'maintenance',
        dueDate: yesterday,
      });
      await makeExpense(dataSource, { description: 'Conta de luz', dueDate: tomorrow });
      await makeExpense(dataSource, {
        description: 'Aluguel',
        dueDate: yesterday,
        paidAt: new Date(),
        paymentMethod: 'pix',
      });

      const response = await get('/v1/expenses?overdue=true', managerAuth);

      expect(response.status).toBe(200);
      expect(response.body.meta).toMatchObject({ total: 1, limit: 50, offset: 0 });
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({ id: overdue.id, overdue: true });
    });

    it('filters by category and by paid', async () => {
      await makeExpense(dataSource, { category: 'rent', paidAt: new Date(), paymentMethod: 'pix' });
      await makeExpense(dataSource, { category: 'supplies' });

      const rent = await get('/v1/expenses?category=rent', managerAuth);
      const pending = await get('/v1/expenses?paid=false', managerAuth);

      expect(rent.body.data.map((row: { category: string }) => row.category)).toEqual(['rent']);
      expect(pending.body.data.map((row: { category: string }) => row.category)).toEqual([
        'supplies',
      ]);
    });

    it('refuses a range that ends before it starts', async () => {
      const response = await get('/v1/expenses?from=2030-03-10&to=2030-03-01', managerAuth);

      expect(response.status).toBe(400);
    });
  });

  describe('PATCH /v1/expenses/:id', () => {
    it('edits a pending expense freely', async () => {
      const expense = await makeExpense(dataSource);

      const response = await patch(`/v1/expenses/${expense.id}`, managerAuth, {
        amountCents: 15_000,
        dueDate: tomorrow,
      });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ amountCents: 15_000, dueDate: tomorrow });
    });

    it('freezes the money on a paid one but still takes a better description', async () => {
      const expense = await makeExpense(dataSource, {
        paidAt: new Date(),
        paymentMethod: 'pix',
      });

      const refused = await patch(`/v1/expenses/${expense.id}`, managerAuth, { amountCents: 1 });
      const accepted = await patch(`/v1/expenses/${expense.id}`, managerAuth, {
        description: 'Aluguel — março',
      });

      expect(refused.status).toBe(409);
      expect(refused.body.error.details).toEqual({ fields: ['amountCents'] });
      expect(accepted.status).toBe(200);
      expect(accepted.body.data.description).toBe('Aluguel — março');
    });

    it('refuses an empty edit', async () => {
      const expense = await makeExpense(dataSource);

      expect((await patch(`/v1/expenses/${expense.id}`, managerAuth, {})).status).toBe(400);
    });
  });

  describe('DELETE /v1/expenses/:id', () => {
    it('lets an admin drop a pending expense', async () => {
      const expense = await makeExpense(dataSource);

      const response = await request(app)
        .delete(`/v1/expenses/${expense.id}`)
        .set('Authorization', adminAuth);

      expect(response.status).toBe(204);
      expect(await dataSource.getRepository(Expense).count()).toBe(0);
    });

    it('refuses to drop a paid one', async () => {
      const expense = await makeExpense(dataSource, { paidAt: new Date(), paymentMethod: 'pix' });

      const response = await request(app)
        .delete(`/v1/expenses/${expense.id}`)
        .set('Authorization', adminAuth);

      expect(response.status).toBe(409);
    });

    it('is closed to managers — destroying a record is not a shift decision', async () => {
      const expense = await makeExpense(dataSource);

      const response = await request(app)
        .delete(`/v1/expenses/${expense.id}`)
        .set('Authorization', managerAuth);

      expect(response.status).toBe(403);
      expect(await dataSource.getRepository(Expense).count()).toBe(1);
    });
  });

  describe('authorization', () => {
    it('shuts barbers out of every route', async () => {
      const expense = await makeExpense(dataSource);

      expect((await get('/v1/expenses', barberAuth)).status).toBe(403);
      expect((await get(`/v1/expenses/${expense.id}`, barberAuth)).status).toBe(403);
      expect((await post('/v1/expenses', barberAuth, {})).status).toBe(403);
      expect((await patch(`/v1/expenses/${expense.id}`, barberAuth, {})).status).toBe(403);
      expect((await post(`/v1/expenses/${expense.id}/pay`, barberAuth, {})).status).toBe(403);
    });

    it('needs a token at all', async () => {
      expect((await request(app).get('/v1/expenses')).status).toBe(401);
    });
  });
});
