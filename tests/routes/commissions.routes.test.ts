import { pino } from 'pino';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { loadConfig, type AppConfig } from '../../src/config';
import { buildContainer } from '../../src/container';
import type { Appointment } from '../../src/entities/appointment.entity';
import type { Barber } from '../../src/entities/barber.entity';
import { CashMovement } from '../../src/entities/cash-movement.entity';
import { CommissionAdvance } from '../../src/entities/commission-advance.entity';
import { CommissionEntry } from '../../src/entities/commission-entry.entity';
import { CommissionPeriod } from '../../src/entities/commission-period.entity';
import type { Service } from '../../src/entities/service.entity';
import { getTestDataSource, truncateAll } from '../support/db';
import {
  makeAppointment,
  makeAuthenticatedUser,
  makeBarber,
  makeCommissionAdvance,
  makeCommissionEntry,
  makeCommissionPeriod,
  makeCommissionRule,
  makeService,
  makeSession,
} from '../support/factories';

const UNKNOWN_UUID = '11111111-1111-4111-8111-111111111111';

describe('commissions routes', () => {
  let dataSource: DataSource;
  let config: AppConfig;
  let app: ReturnType<typeof createApp>;
  let adminAuth: string;
  let managerAuth: string;
  let barberAuth: string;
  let barber: Barber;
  let service: Service;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    config = loadConfig();
    app = createApp(buildContainer({ config, logger: pino({ level: 'silent' }), dataSource }));
  });

  beforeEach(async () => {
    await truncateAll(dataSource);

    adminAuth = (await makeAuthenticatedUser(dataSource, config, { role: 'ADMIN' })).authHeader;
    managerAuth = (await makeAuthenticatedUser(dataSource, config, { role: 'MANAGER' })).authHeader;

    const barberUser = await makeAuthenticatedUser(dataSource, config, { role: 'BARBER' });
    barberAuth = barberUser.authHeader;
    barber = await makeBarber(dataSource, { userId: barberUser.user.id });
    service = await makeService(dataSource);
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

  function confirmedCut(overrides: Partial<Appointment> = {}) {
    return makeAppointment(dataSource, {
      barberId: barber.id,
      serviceId: service.id,
      status: 'confirmed',
      price: 4500,
      ...overrides,
    });
  }

  describe('POST /v1/commission-rules', () => {
    it('creates a shop default', async () => {
      const response = await post('/v1/commission-rules', adminAuth, { rate: 0.4, base: 'gross' });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        barberId: null,
        serviceId: null,
        rate: 0.4,
        base: 'gross',
        appliesTo: 'services',
        active: true,
      });
    });

    it('refuses a rate the column would truncate', async () => {
      const response = await post('/v1/commission-rules', adminAuth, {
        rate: 0.12345,
        base: 'gross',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts four decimals', async () => {
      const response = await post('/v1/commission-rules', adminAuth, {
        rate: 0.4275,
        base: 'net',
      });

      expect(response.status).toBe(201);
      expect(response.body.data.rate).toBe(0.4275);
    });

    it('refuses a rate above one', async () => {
      const response = await post('/v1/commission-rules', adminAuth, { rate: 1.5, base: 'gross' });

      expect(response.status).toBe(400);
    });

    it('409s on a second rule for the same scope', async () => {
      await makeCommissionRule(dataSource, { barberId: barber.id });

      const response = await post('/v1/commission-rules', adminAuth, {
        barberId: barber.id,
        rate: 0.5,
        base: 'gross',
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('404s on an unknown barber', async () => {
      const response = await post('/v1/commission-rules', adminAuth, {
        barberId: UNKNOWN_UUID,
        rate: 0.4,
        base: 'gross',
      });

      expect(response.status).toBe(404);
    });

    it('is closed to managers — a rate is not a shift decision', async () => {
      const response = await post('/v1/commission-rules', managerAuth, {
        rate: 0.4,
        base: 'gross',
      });

      expect(response.status).toBe(403);
    });
  });

  describe('GET /v1/commission-rules', () => {
    it('narrows a barber to the rules that decide their own pay', async () => {
      const other = await makeBarber(dataSource);
      const shop = await makeCommissionRule(dataSource, { rate: 0.4 });
      const mine = await makeCommissionRule(dataSource, { barberId: barber.id, rate: 0.5 });
      await makeCommissionRule(dataSource, { barberId: other.id, rate: 0.7 });

      const response = await get('/v1/commission-rules', barberAuth);

      expect(response.status).toBe(200);
      expect(response.body.data.map((rule: { id: string }) => rule.id)).toEqual([mine.id, shop.id]);
    });

    it('shows staff every rule, most specific first', async () => {
      const other = await makeBarber(dataSource);
      await makeCommissionRule(dataSource, { rate: 0.4 });
      await makeCommissionRule(dataSource, { barberId: other.id, rate: 0.7 });

      const response = await get('/v1/commission-rules', managerAuth);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].barberId).toBe(other.id);
    });
  });

  describe('PATCH /v1/commission-rules/:id', () => {
    it('edits the rate without touching entries already earned', async () => {
      const rule = await makeCommissionRule(dataSource, { rate: 0.4 });
      const entry = await makeCommissionEntry(dataSource, { ruleId: rule.id, rate: 0.4 });

      const response = await patch(`/v1/commission-rules/${rule.id}`, adminAuth, { rate: 0.5 });

      expect(response.status).toBe(200);
      expect(response.body.data.rate).toBe(0.5);

      const stored = await dataSource.getRepository(CommissionEntry).findOneBy({ id: entry.id });
      expect(stored?.rate).toBe(0.4);
    });

    it('deactivates a rule', async () => {
      const rule = await makeCommissionRule(dataSource);

      const response = await patch(`/v1/commission-rules/${rule.id}`, adminAuth, { active: false });

      expect(response.body.data.active).toBe(false);
    });

    it('404s on an unknown rule', async () => {
      const response = await patch(`/v1/commission-rules/${UNKNOWN_UUID}`, adminAuth, {
        rate: 0.5,
      });

      expect(response.status).toBe(404);
    });

    it('is closed to managers', async () => {
      const rule = await makeCommissionRule(dataSource);

      expect(
        (await patch(`/v1/commission-rules/${rule.id}`, managerAuth, { rate: 0.5 })).status,
      ).toBe(403);
    });
  });

  describe('completing an appointment', () => {
    it('writes the entry the most specific rule dictates', async () => {
      await makeCommissionRule(dataSource, { rate: 0.4 });
      await makeCommissionRule(dataSource, { barberId: barber.id, rate: 0.5 });
      const winner = await makeCommissionRule(dataSource, {
        barberId: barber.id,
        serviceId: service.id,
        rate: 0.6,
      });
      const appointment = await confirmedCut();

      const response = await post(`/v1/appointments/${appointment.id}/complete`, adminAuth);

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('completed');

      const entry = await dataSource
        .getRepository(CommissionEntry)
        .findOneBy({ appointmentId: appointment.id });

      expect(entry).toMatchObject({
        barberId: barber.id,
        ruleId: winner.id,
        rate: 0.6,
        base: 'gross',
        baseAmount: 4500,
        amount: 2700,
      });
    });

    it('leaves the appointment confirmed when no rule applies', async () => {
      const appointment = await confirmedCut();

      const response = await post(`/v1/appointments/${appointment.id}/complete`, adminAuth);

      expect(response.status).toBe(409);
      expect(response.body.error.message).toMatch(/No commission rule configured/);

      const stored = await dataSource.getRepository(CommissionEntry).count();
      expect(stored).toBe(0);
      expect((await get(`/v1/appointments/${appointment.id}`, adminAuth)).body.data.status).toBe(
        'confirmed',
      );
    });

    it('uses the appointment price when a net rule has nothing paid yet', async () => {
      await makeCommissionRule(dataSource, { rate: 0.4, base: 'net' });
      const appointment = await confirmedCut();

      await post(`/v1/appointments/${appointment.id}/complete`, adminAuth);

      const entry = await dataSource
        .getRepository(CommissionEntry)
        .findOneBy({ appointmentId: appointment.id });

      expect(entry).toMatchObject({ base: 'net', baseAmount: 4500, amount: 1800 });
    });
  });

  describe('a payment landing after completion', () => {
    it('moves a net entry down to what actually arrived', async () => {
      await makeCommissionRule(dataSource, { rate: 0.4, base: 'net' });
      const appointment = await confirmedCut();
      await post(`/v1/appointments/${appointment.id}/complete`, adminAuth);

      const response = await post(`/v1/appointments/${appointment.id}/payments`, adminAuth, {
        payments: [{ amountCents: 4500, method: 'credit' }],
      });

      expect(response.status).toBe(201);
      const entry = await dataSource
        .getRepository(CommissionEntry)
        .findOneBy({ appointmentId: appointment.id });

      expect(entry?.baseAmount).toBe(response.body.data[0].netAmountCents);
      expect(entry?.amount).toBe(Math.round(entry!.baseAmount * 0.4));
    });

    it('leaves a gross entry exactly where it was', async () => {
      await makeCommissionRule(dataSource, { rate: 0.4, base: 'gross' });
      const appointment = await confirmedCut();
      await post(`/v1/appointments/${appointment.id}/complete`, adminAuth);

      await post(`/v1/appointments/${appointment.id}/payments`, adminAuth, {
        payments: [{ amountCents: 4500, method: 'credit' }],
      });

      const entry = await dataSource
        .getRepository(CommissionEntry)
        .findOneBy({ appointmentId: appointment.id });

      expect(entry).toMatchObject({ baseAmount: 4500, amount: 1800 });
    });

    it('shrinks a net entry again when the payment is voided', async () => {
      await makeSession(dataSource);
      await makeCommissionRule(dataSource, { rate: 0.4, base: 'net' });
      const appointment = await confirmedCut();
      await post(`/v1/appointments/${appointment.id}/complete`, adminAuth);

      const paid = await post(`/v1/appointments/${appointment.id}/payments`, adminAuth, {
        payments: [{ amountCents: 2000, method: 'cash' }],
      });
      await request(app)
        .delete(`/v1/payments/${paid.body.data[0].id}`)
        .set('Authorization', adminAuth)
        .send({ reason: 'wrong appointment' });

      const entry = await dataSource
        .getRepository(CommissionEntry)
        .findOneBy({ appointmentId: appointment.id });

      expect(entry).toMatchObject({ baseAmount: 4500, amount: 1800 });
    });
  });

  describe('GET /v1/commissions/entries', () => {
    it('shows a barber only their own', async () => {
      const mine = await makeCommissionEntry(dataSource, { barberId: barber.id });
      await makeCommissionEntry(dataSource);

      const response = await get('/v1/commissions/entries', barberAuth);

      expect(response.status).toBe(200);
      expect(response.body.meta.total).toBe(1);
      expect(response.body.data[0]).toMatchObject({ id: mine.id, barberId: barber.id });
    });

    it("403s a barber asking for another's", async () => {
      const other = await makeBarber(dataSource);

      const response = await get(`/v1/commissions/entries?barberId=${other.id}`, barberAuth);

      expect(response.status).toBe(403);
    });

    it('lets staff read everyone, and page', async () => {
      await makeCommissionEntry(dataSource, { barberId: barber.id });
      await makeCommissionEntry(dataSource);

      const response = await get('/v1/commissions/entries?limit=1', managerAuth);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta).toMatchObject({ total: 2, limit: 1, offset: 0 });
    });

    it('refuses a range that ends before it starts', async () => {
      const response = await get(
        '/v1/commissions/entries?from=2030-03-10&to=2030-03-01',
        managerAuth,
      );

      expect(response.status).toBe(400);
    });

    it('needs a token', async () => {
      expect((await request(app).get('/v1/commissions/entries')).status).toBe(401);
    });
  });

  const SETTLED = { startsOn: '2026-01-01', endsOn: '2026-01-15' } as const;
  const INSIDE = new Date('2026-01-05T12:00:00.000Z');

  describe('POST /v1/commission-advances', () => {
    it('takes a cash vale out of the open drawer', async () => {
      const session = await makeSession(dataSource);

      const response = await post('/v1/commission-advances', managerAuth, {
        barberId: barber.id,
        amountCents: 15_000,
        paymentMethod: 'cash',
        notes: 'vale de sexta',
      });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        barberId: barber.id,
        amountCents: 15_000,
        periodId: null,
        notes: 'vale de sexta',
      });

      const movements = await dataSource
        .getRepository(CashMovement)
        .findBy({ sessionId: session.id });

      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        type: 'out',
        source: 'advance',
        amount: 15_000,
        advanceId: response.body.data.id,
      });
    });

    it('409s a cash vale with no register open, and writes nothing', async () => {
      const response = await post('/v1/commission-advances', managerAuth, {
        barberId: barber.id,
        amountCents: 15_000,
        paymentMethod: 'cash',
      });

      expect(response.status).toBe(409);
      expect(await dataSource.getRepository(CommissionAdvance).count()).toBe(0);
    });

    it('records a Pix vale without a register', async () => {
      const response = await post('/v1/commission-advances', managerAuth, {
        barberId: barber.id,
        amountCents: 8000,
        paymentMethod: 'pix',
      });

      expect(response.status).toBe(201);
      expect(await dataSource.getRepository(CashMovement).count()).toBe(0);
    });

    it('refuses a zero or negative vale', async () => {
      const zero = await post('/v1/commission-advances', managerAuth, {
        barberId: barber.id,
        amountCents: 0,
        paymentMethod: 'pix',
      });

      expect(zero.status).toBe(400);
    });

    it('403s a barber recording their own vale', async () => {
      const response = await post('/v1/commission-advances', barberAuth, {
        barberId: barber.id,
        amountCents: 5000,
        paymentMethod: 'pix',
      });

      expect(response.status).toBe(403);
    });
  });

  describe('POST /v1/commission-periods/close', () => {
    it('settles entries against advances and freezes both', async () => {
      const entry = await makeCommissionEntry(dataSource, {
        barberId: barber.id,
        amount: 1800,
        createdAt: INSIDE,
      });
      const advance = await makeCommissionAdvance(dataSource, {
        barberId: barber.id,
        amount: 500,
        createdAt: INSIDE,
      });

      const response = await post('/v1/commission-periods/close', adminAuth, {
        barberId: barber.id,
        ...SETTLED,
      });

      expect(response.status).toBe(201);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        barberId: barber.id,
        status: 'closed',
        totalEntriesCents: 1800,
        totalAdvancesCents: 500,
        totalDueCents: 1300,
        paidAt: null,
      });

      const periodId = response.body.data[0].id;
      expect(
        (await dataSource.getRepository(CommissionEntry).findOneBy({ id: entry.id }))?.periodId,
      ).toBe(periodId);
      expect(
        (await dataSource.getRepository(CommissionAdvance).findOneBy({ id: advance.id }))?.periodId,
      ).toBe(periodId);
    });

    it('leaves rows outside the range unsettled', async () => {
      const outside = await makeCommissionEntry(dataSource, {
        barberId: barber.id,
        createdAt: new Date('2026-02-05T12:00:00.000Z'),
      });
      await makeCommissionEntry(dataSource, { barberId: barber.id, createdAt: INSIDE });

      await post('/v1/commission-periods/close', adminAuth, { barberId: barber.id, ...SETTLED });

      expect(
        (await dataSource.getRepository(CommissionEntry).findOneBy({ id: outside.id }))?.periodId,
      ).toBeNull();
    });

    it('closes every barber who has something owing when none is named', async () => {
      const other = await makeBarber(dataSource);
      await makeCommissionEntry(dataSource, { barberId: barber.id, createdAt: INSIDE });
      await makeCommissionEntry(dataSource, { barberId: other.id, createdAt: INSIDE });
      await makeBarber(dataSource);

      const response = await post('/v1/commission-periods/close', adminAuth, SETTLED);

      expect(response.status).toBe(201);
      expect(response.body.data).toHaveLength(2);
    });

    it('409s the whole run when one barber already has an overlapping period', async () => {
      await makeCommissionEntry(dataSource, { barberId: barber.id, createdAt: INSIDE });
      await makeCommissionPeriod(dataSource, { barberId: barber.id, ...SETTLED });

      const response = await post('/v1/commission-periods/close', adminAuth, SETTLED);

      expect(response.status).toBe(409);
      expect(await dataSource.getRepository(CommissionPeriod).count()).toBe(1);
    });

    it('refuses a range whose days are not over yet', async () => {
      const response = await post('/v1/commission-periods/close', adminAuth, {
        startsOn: '2099-01-01',
        endsOn: '2099-01-15',
      });

      expect(response.status).toBe(400);
    });

    it('refuses a range that ends before it starts', async () => {
      const response = await post('/v1/commission-periods/close', adminAuth, {
        startsOn: '2026-01-15',
        endsOn: '2026-01-01',
      });

      expect(response.status).toBe(400);
    });

    it('403s a manager, since payroll is an ADMIN decision', async () => {
      expect((await post('/v1/commission-periods/close', managerAuth, SETTLED)).status).toBe(403);
    });
  });

  describe('GET /v1/commission-periods', () => {
    it('shows a barber only their own', async () => {
      const mine = await makeCommissionPeriod(dataSource, { barberId: barber.id, ...SETTLED });
      await makeCommissionPeriod(dataSource, SETTLED);

      const response = await get('/v1/commission-periods', barberAuth);

      expect(response.body.meta.total).toBe(1);
      expect(response.body.data[0].id).toBe(mine.id);
    });

    it('filters by status for staff', async () => {
      await makeCommissionPeriod(dataSource, { barberId: barber.id, ...SETTLED });

      const closed = await get('/v1/commission-periods?status=closed', managerAuth);
      const paid = await get('/v1/commission-periods?status=paid', managerAuth);

      expect(closed.body.meta.total).toBe(1);
      expect(paid.body.meta.total).toBe(0);
    });
  });

  describe('GET /v1/commission-periods/:id', () => {
    it('returns the snapshot with the rows behind it', async () => {
      await makeCommissionEntry(dataSource, {
        barberId: barber.id,
        amount: 1800,
        createdAt: INSIDE,
      });
      await makeCommissionAdvance(dataSource, {
        barberId: barber.id,
        amount: 500,
        createdAt: INSIDE,
      });
      const closed = await post('/v1/commission-periods/close', adminAuth, {
        barberId: barber.id,
        ...SETTLED,
      });

      const response = await get(`/v1/commission-periods/${closed.body.data[0].id}`, barberAuth);

      expect(response.status).toBe(200);
      expect(response.body.data.period).toMatchObject({ totalDueCents: 1300 });
      expect(response.body.data.entries).toHaveLength(1);
      expect(response.body.data.advances).toHaveLength(1);
    });

    it("403s a barber reading another's statement", async () => {
      const other = await makeCommissionPeriod(dataSource, SETTLED);

      expect((await get(`/v1/commission-periods/${other.id}`, barberAuth)).status).toBe(403);
    });

    it('404s an unknown period', async () => {
      expect((await get(`/v1/commission-periods/${UNKNOWN_UUID}`, adminAuth)).status).toBe(404);
    });
  });

  describe('POST /v1/commission-periods/:id/pay', () => {
    it('pays cash out of the drawer as a payout movement', async () => {
      const session = await makeSession(dataSource);
      const period = await makeCommissionPeriod(dataSource, {
        barberId: barber.id,
        totalEntries: 20_000,
        totalAdvances: 5000,
        ...SETTLED,
      });

      const response = await post(`/v1/commission-periods/${period.id}/pay`, adminAuth, {
        paymentMethod: 'cash',
      });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ status: 'paid', paymentMethod: 'cash' });

      const movements = await dataSource
        .getRepository(CashMovement)
        .findBy({ sessionId: session.id });

      expect(movements[0]).toMatchObject({
        type: 'out',
        source: 'payout',
        amount: 15_000,
        periodId: period.id,
      });
    });

    it('409s a cash payout with no register open, and leaves the period closed', async () => {
      const period = await makeCommissionPeriod(dataSource, { barberId: barber.id, ...SETTLED });

      const response = await post(`/v1/commission-periods/${period.id}/pay`, adminAuth, {
        paymentMethod: 'cash',
      });

      expect(response.status).toBe(409);
      expect(
        (await dataSource.getRepository(CommissionPeriod).findOneBy({ id: period.id }))?.status,
      ).toBe('closed');
    });

    it('pays by Pix without a register', async () => {
      const period = await makeCommissionPeriod(dataSource, { barberId: barber.id, ...SETTLED });

      const response = await post(`/v1/commission-periods/${period.id}/pay`, adminAuth, {
        paymentMethod: 'pix',
      });

      expect(response.status).toBe(200);
      expect(await dataSource.getRepository(CashMovement).count()).toBe(0);
    });

    it('409s a second payout', async () => {
      const period = await makeCommissionPeriod(dataSource, { barberId: barber.id, ...SETTLED });
      await post(`/v1/commission-periods/${period.id}/pay`, adminAuth, { paymentMethod: 'pix' });

      const again = await post(`/v1/commission-periods/${period.id}/pay`, adminAuth, {
        paymentMethod: 'pix',
      });

      expect(again.status).toBe(409);
    });

    it('403s a manager', async () => {
      const period = await makeCommissionPeriod(dataSource, { barberId: barber.id, ...SETTLED });

      expect(
        (
          await post(`/v1/commission-periods/${period.id}/pay`, managerAuth, {
            paymentMethod: 'pix',
          })
        ).status,
      ).toBe(403);
    });
  });

  describe('once a period has closed over an entry', () => {

    async function settledCut() {
      await makeCommissionRule(dataSource, { rate: 0.4, base: 'net' });
      await makeSession(dataSource);
      const appointment = await confirmedCut();
      await post(`/v1/appointments/${appointment.id}/complete`, adminAuth);

      const paid = await post(`/v1/appointments/${appointment.id}/payments`, adminAuth, {
        payments: [{ amountCents: 2000, method: 'cash' }],
      });

      await dataSource
        .getRepository(CommissionEntry)
        .update({ appointmentId: appointment.id }, { createdAt: INSIDE });
      await post('/v1/commission-periods/close', adminAuth, { barberId: barber.id, ...SETTLED });

      return { appointment, paymentId: paid.body.data[0].id as string };
    }

    it('refuses to void the payment behind it', async () => {
      const { paymentId } = await settledCut();

      const response = await request(app)
        .delete(`/v1/payments/${paymentId}`)
        .set('Authorization', adminAuth)
        .send({ reason: 'wrong appointment' });

      expect(response.status).toBe(409);
      expect(response.body.error.message).toMatch(/closed period/);
    });

    it('refuses a late payment that would move the settled entry', async () => {
      const { appointment } = await settledCut();

      const response = await post(`/v1/appointments/${appointment.id}/payments`, adminAuth, {
        payments: [{ amountCents: 2500, method: 'cash' }],
      });

      expect(response.status).toBe(409);
      expect(response.body.error.message).toMatch(/closed period/);
    });

    it('keeps the entry and its period exactly as they were', async () => {
      const { paymentId } = await settledCut();
      await request(app)
        .delete(`/v1/payments/${paymentId}`)
        .set('Authorization', adminAuth)
        .send({});

      const entry = await dataSource
        .getRepository(CommissionEntry)
        .findOneBy({ barberId: barber.id });

      expect(entry).toMatchObject({ baseAmount: 2000, amount: 800 });
      expect(entry?.periodId).not.toBeNull();
    });
  });
});
