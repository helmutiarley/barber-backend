import { pino } from 'pino';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { loadConfig, type AppConfig } from '../../src/config';
import { buildContainer } from '../../src/container';
import type { Appointment } from '../../src/entities/appointment.entity';
import { CashMovement } from '../../src/entities/cash-movement.entity';
import { Payment } from '../../src/entities/payment.entity';
import { getTestDataSource, truncateAll } from '../support/db';
import {
  makeAppointment,
  makeAuthenticatedUser,
  makeBarber,
  makePayment,
  makeSession,
} from '../support/factories';

const UNKNOWN_UUID = '11111111-1111-4111-8111-111111111111';

describe('payments routes', () => {
  let dataSource: DataSource;
  let config: AppConfig;
  let app: ReturnType<typeof createApp>;
  let appointment: Appointment;
  let adminAuth: string;
  let managerAuth: string;
  let barberAuth: string;
  let otherBarberAuth: string;
  let clientAuth: string;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    config = loadConfig();
    app = createApp(buildContainer({ config, logger: pino({ level: 'silent' }), dataSource }));
  });

  beforeEach(async () => {
    await truncateAll(dataSource);

    adminAuth = (await makeAuthenticatedUser(dataSource, config, { role: 'ADMIN' })).authHeader;
    managerAuth = (await makeAuthenticatedUser(dataSource, config, { role: 'MANAGER' })).authHeader;

    const barberAccount = await makeAuthenticatedUser(dataSource, config, { role: 'BARBER' });
    barberAuth = barberAccount.authHeader;
    const barber = await makeBarber(dataSource, { userId: barberAccount.user.id });

    const otherBarberAccount = await makeAuthenticatedUser(dataSource, config, { role: 'BARBER' });
    otherBarberAuth = otherBarberAccount.authHeader;
    await makeBarber(dataSource, { userId: otherBarberAccount.user.id });

    const clientAccount = await makeAuthenticatedUser(dataSource, config, { role: 'CLIENT' });
    clientAuth = clientAccount.authHeader;

    appointment = await makeAppointment(dataSource, {
      status: 'completed',
      barberId: barber.id,
      clientId: clientAccount.user.id,
      price: 5000,
    });
  });

  function get(path: string, auth: string) {
    return request(app).get(path).set('Authorization', auth);
  }

  function pay(auth: string, payments: unknown[], appointmentId = appointment.id) {
    return request(app)
      .post(`/v1/appointments/${appointmentId}/payments`)
      .set('Authorization', auth)
      .send({ payments });
  }

  function countRows() {
    return Promise.all([
      dataSource.getRepository(Payment).count(),
      dataSource.getRepository(CashMovement).count(),
    ]);
  }

  describe('POST /v1/appointments/:id/payments', () => {
    it('records a card payment with its fee snapshot and no cash movement', async () => {
      const response = await pay(managerAuth, [{ amountCents: 5000, method: 'credit' }]);

      expect(response.status).toBe(201);
      expect(response.body.data[0]).toMatchObject({
        amountCents: 5000,
        method: 'credit',
        cardFeeCents: 175,
        netAmountCents: 4825,
        cashRegisterSessionId: null,
      });
      expect(await countRows()).toEqual([1, 0]);
    });

    it('records a cash payment and its movement in the open session', async () => {
      const session = await makeSession(dataSource, { openingBalance: 10_000 });

      const response = await pay(managerAuth, [{ amountCents: 5000, method: 'cash' }]);

      expect(response.status).toBe(201);
      expect(response.body.data[0].cashRegisterSessionId).toBe(session.id);

      const current = await get('/v1/cash-register/current', managerAuth);
      expect(current.body.data.totals).toEqual({
        inCents: 5000,
        outCents: 0,
        expectedBalanceCents: 15_000,
      });
    });

    it('splits across methods in one request', async () => {
      await makeSession(dataSource);

      const response = await pay(managerAuth, [
        { amountCents: 3000, method: 'cash' },
        { amountCents: 2000, method: 'pix' },
      ]);

      expect(response.status).toBe(201);
      expect(response.body.data).toHaveLength(2);

      expect(await countRows()).toEqual([2, 1]);
    });

    it('persists nothing when the second item of a batch overpays', async () => {
      await makeSession(dataSource);

      const response = await pay(managerAuth, [
        { amountCents: 3000, method: 'cash' },
        { amountCents: 3000, method: 'cash' },
      ]);

      expect(response.status).toBe(409);
      expect(response.body.error.details).toMatchObject({
        priceCents: 5000,
        attemptedCents: 6000,
      });
      expect(await countRows()).toEqual([0, 0]);
    });

    it('leaves no payment behind when cash is taken with the register closed', async () => {
      const response = await pay(managerAuth, [{ amountCents: 5000, method: 'cash' }]);

      expect(response.status).toBe(409);

      expect(await countRows()).toEqual([0, 0]);
    });

    it('refuses to pay a cancelled appointment', async () => {
      const cancelled = await makeAppointment(dataSource, { status: 'cancelled' });

      const response = await pay(managerAuth, [{ amountCents: 1000, method: 'pix' }], cancelled.id);

      expect(response.status).toBe(409);
    });

    it('lets a second payment settle the rest, then refuses the cent after', async () => {
      await pay(managerAuth, [{ amountCents: 3000, method: 'pix' }]);

      expect((await pay(managerAuth, [{ amountCents: 2000, method: 'pix' }])).status).toBe(201);
      expect((await pay(managerAuth, [{ amountCents: 1, method: 'pix' }])).status).toBe(409);
    });

    it('404s on an unknown appointment', async () => {
      const response = await pay(managerAuth, [{ amountCents: 1000, method: 'pix' }], UNKNOWN_UUID);

      expect(response.status).toBe(404);
    });

    it('rejects an unknown method and a zero amount', async () => {
      expect((await pay(managerAuth, [{ amountCents: 1000, method: 'crypto' }])).status).toBe(400);
      expect((await pay(managerAuth, [{ amountCents: 0, method: 'pix' }])).status).toBe(400);
      expect((await pay(managerAuth, [])).status).toBe(400);
    });

    it('is closed to barbers and clients', async () => {
      expect((await pay(barberAuth, [{ amountCents: 1000, method: 'pix' }])).status).toBe(403);
      expect((await pay(clientAuth, [{ amountCents: 1000, method: 'pix' }])).status).toBe(403);
    });
  });

  describe('GET /v1/appointments/:id/payments', () => {
    it('lets the barber who worked it see how it was settled', async () => {
      await pay(managerAuth, [{ amountCents: 5000, method: 'debit' }]);

      const response = await get(`/v1/appointments/${appointment.id}/payments`, barberAuth);

      expect(response.status).toBe(200);
      expect(response.body.data[0]).toMatchObject({ method: 'debit', cardFeeCents: 75 });
    });

    it('refuses another barber', async () => {
      const response = await get(`/v1/appointments/${appointment.id}/payments`, otherBarberAuth);

      expect(response.status).toBe(403);
    });

    it('refuses the client whose cut it was', async () => {
      const response = await get(`/v1/appointments/${appointment.id}/payments`, clientAuth);

      expect(response.status).toBe(403);
    });
  });

  describe('GET /v1/payments', () => {
    it('filters by method and paginates', async () => {
      await makePayment(dataSource, { appointmentId: appointment.id, method: 'pix', amount: 1000 });
      await makePayment(dataSource, {
        appointmentId: appointment.id,
        method: 'cash',
        amount: 2000,
      });

      const response = await get('/v1/payments?method=pix&limit=10', managerAuth);

      expect(response.status).toBe(200);
      expect(response.body.meta).toEqual({ total: 1, limit: 10, offset: 0 });
      expect(response.body.data[0].method).toBe('pix');
    });

    it('is closed to barbers', async () => {
      expect((await get('/v1/payments', barberAuth)).status).toBe(403);
    });
  });

  describe('DELETE /v1/payments/:id', () => {
    it('keeps the payment, marks it voided and takes the cash back out', async () => {
      const session = await makeSession(dataSource, { openingBalance: 10_000 });
      const recorded = await pay(managerAuth, [{ amountCents: 5000, method: 'cash' }]);
      const paymentId = recorded.body.data[0].id;

      const response = await request(app)
        .delete(`/v1/payments/${paymentId}`)
        .set('Authorization', adminAuth)
        .send({ reason: 'charged the wrong client' });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        id: paymentId,
        voidReason: 'charged the wrong client',
      });

      const detail = await get(`/v1/cash-register/sessions/${session.id}`, managerAuth);
      expect(detail.body.data.movements).toHaveLength(2);
      expect(detail.body.data.movements[1]).toMatchObject({
        type: 'out',
        amountCents: 5000,
        paymentId,
      });

      const listed = await get(`/v1/appointments/${appointment.id}/payments`, managerAuth);
      expect(listed.body.data).toHaveLength(1);
      const current = await get('/v1/cash-register/current', managerAuth);
      expect(current.body.data.totals.expectedBalanceCents).toBe(10_000);
    });

    it('frees the amount for a new payment', async () => {
      const recorded = await pay(managerAuth, [{ amountCents: 5000, method: 'pix' }]);
      await request(app)
        .delete(`/v1/payments/${recorded.body.data[0].id}`)
        .set('Authorization', adminAuth)
        .send({});

      const again = await pay(managerAuth, [{ amountCents: 5000, method: 'pix' }]);

      expect(again.status).toBe(201);
    });

    it('refuses a second void of the same payment', async () => {
      const recorded = await pay(managerAuth, [{ amountCents: 5000, method: 'pix' }]);
      const paymentId = recorded.body.data[0].id;
      const remove = () =>
        request(app).delete(`/v1/payments/${paymentId}`).set('Authorization', adminAuth).send({});

      expect((await remove()).status).toBe(200);
      expect((await remove()).status).toBe(409);
    });

    it('is admin-only — a manager may take money but not unmake it', async () => {
      const recorded = await pay(managerAuth, [{ amountCents: 5000, method: 'pix' }]);

      const response = await request(app)
        .delete(`/v1/payments/${recorded.body.data[0].id}`)
        .set('Authorization', managerAuth)
        .send({});

      expect(response.status).toBe(403);
    });

    it('404s on an unknown payment', async () => {
      const response = await request(app)
        .delete(`/v1/payments/${UNKNOWN_UUID}`)
        .set('Authorization', adminAuth)
        .send({});

      expect(response.status).toBe(404);
    });
  });
});
