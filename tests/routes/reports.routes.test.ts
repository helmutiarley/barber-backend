import { pino } from 'pino';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { loadConfig, type AppConfig } from '../../src/config';
import { buildContainer } from '../../src/container';
import { toInstant } from '../../src/lib/shop-time';
import { getTestDataSource, truncateAll } from '../support/db';
import {
  makeAppointment,
  makeAuthenticatedUser,
  makeBarber,
  makeCommissionEntry,
  makeExpense,
  makePayment,
  makeProduct,
  makeProductSale,
  makeService,
  makeUser,
  makeWorkingWeek,
} from '../support/factories';

const ZONE = 'America/Sao_Paulo';

const RANGE = 'from=2026-07-01&to=2026-07-31';

function at(date: string, time: string): Date {
  return toInstant(date, time, ZONE);
}

describe('reports routes', () => {
  let dataSource: DataSource;
  let config: AppConfig;
  let app: ReturnType<typeof createApp>;
  let adminAuth: string;
  let managerAuth: string;
  let barberAuth: string;
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
    barberAuth = (await makeAuthenticatedUser(dataSource, config, { role: 'BARBER' })).authHeader;
    clientAuth = (await makeAuthenticatedUser(dataSource, config, { role: 'CLIENT' })).authHeader;
  });

  function get(path: string, auth: string) {
    return request(app).get(path).set('Authorization', auth);
  }

  async function aJulyOfTrading() {
    const barber = await makeBarber(dataSource, { displayName: 'Rafael' });
    const service = await makeService(dataSource, { name: 'Corte', price: 4500 });
    const appointment = await makeAppointment(dataSource, {
      barberId: barber.id,
      serviceId: service.id,
      status: 'completed',
      price: 4500,
      startsAt: at('2026-07-10', '10:00:00'),
    });
    await makePayment(dataSource, {
      appointmentId: appointment.id,
      amount: 4500,
      method: 'credit',
      cardFee: 150,
      paidAt: at('2026-07-10', '11:00:00'),
    });

    const product = await makeProduct(dataSource, { name: 'Pomada', price: 3500, cost: 1800 });
    const sale = await makePayment(dataSource, {
      appointmentId: null,
      amount: 3500,
      paidAt: at('2026-07-10', '12:00:00'),
    });
    await makeProductSale(dataSource, {
      paymentId: sale.id,
      productId: product.id,
      unitPrice: 3500,
      soldByBarberId: barber.id,
    });

    return { barber, service, product };
  }

  describe('GET /v1/reports/revenue', () => {
    it('totals the range and cuts it into shop-local days', async () => {
      await aJulyOfTrading();

      const response = await get(`/v1/reports/revenue?${RANGE}`, managerAuth);

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        from: '2026-07-01',
        to: '2026-07-31',
        groupBy: 'day',
        totals: {
          grossCents: 8000,
          netCents: 7850,
          cardFeeCents: 150,
          serviceGrossCents: 4500,
          productGrossCents: 3500,
          payments: 2,
        },
      });
      expect(response.body.data.buckets).toEqual([
        expect.objectContaining({ key: '2026-07-10', grossCents: 8000 }),
      ]);
    });

    it('groups by barber, naming them', async () => {
      const { barber } = await aJulyOfTrading();

      const response = await get(`/v1/reports/revenue?${RANGE}&groupBy=barber`, managerAuth);

      expect(response.body.data.buckets).toEqual([
        expect.objectContaining({ key: barber.id, label: 'Rafael', grossCents: 8000 }),
      ]);
    });

    it('defaults the range to the current month when asked for nothing', async () => {
      const response = await get('/v1/reports/revenue', managerAuth);

      expect(response.status).toBe(200);
      expect(response.body.data.from).toMatch(/^\d{4}-\d{2}-01$/);
    });

    it('refuses an unknown grouping', async () => {
      const response = await get(`/v1/reports/revenue?${RANGE}&groupBy=barbershop`, managerAuth);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('refuses a range that ends before it starts', async () => {
      const response = await get('/v1/reports/revenue?from=2026-07-31&to=2026-07-01', managerAuth);

      expect(response.status).toBe(400);
      expect(response.body.error.details).toEqual([
        expect.objectContaining({ field: 'to', location: 'query' }),
      ]);
    });

    it('refuses a date that is not one', async () => {
      const response = await get('/v1/reports/revenue?from=julho', managerAuth);

      expect(response.status).toBe(400);
    });
  });

  describe('GET /v1/reports/average-ticket', () => {
    it('divides service takings by the cuts behind them, overall and per barber', async () => {
      const { barber } = await aJulyOfTrading();

      const response = await get(`/v1/reports/average-ticket?${RANGE}`, managerAuth);

      expect(response.status).toBe(200);

      expect(response.body.data.overall).toEqual({
        grossCents: 4500,
        appointments: 1,
        averageTicketCents: 4500,
      });
      expect(response.body.data.barbers).toEqual([
        expect.objectContaining({
          barberId: barber.id,
          barberName: 'Rafael',
          averageTicketCents: 4500,
        }),
      ]);
    });

    it('has no average for a month with no cuts', async () => {
      const response = await get(`/v1/reports/average-ticket?${RANGE}`, managerAuth);

      expect(response.body.data.overall.averageTicketCents).toBeNull();
    });
  });

  describe('GET /v1/reports/top-services', () => {
    it('ranks services by what they took', async () => {
      const { service } = await aJulyOfTrading();

      const response = await get(`/v1/reports/top-services?${RANGE}`, managerAuth);

      expect(response.status).toBe(200);
      expect(response.body.data.services).toEqual([
        { serviceId: service.id, serviceName: 'Corte', grossCents: 4500, appointments: 1 },
      ]);
    });

    it('honours a limit', async () => {
      await aJulyOfTrading();
      const beard = await makeService(dataSource, { name: 'Barba', price: 3000 });
      const appointment = await makeAppointment(dataSource, {
        serviceId: beard.id,
        status: 'completed',
        startsAt: at('2026-07-11', '10:00:00'),
      });
      await makePayment(dataSource, {
        appointmentId: appointment.id,
        amount: 3000,
        paidAt: at('2026-07-11', '11:00:00'),
      });

      const response = await get(`/v1/reports/top-services?${RANGE}&limit=1`, managerAuth);

      expect(response.body.data.services).toHaveLength(1);
      expect(response.body.data.services[0].serviceName).toBe('Corte');
    });
  });

  describe('GET /v1/reports/products', () => {
    it('reports units, takings and the margin behind them', async () => {
      const { product } = await aJulyOfTrading();

      const response = await get(`/v1/reports/products?${RANGE}`, managerAuth);

      expect(response.status).toBe(200);
      expect(response.body.data.products).toEqual([
        {
          productId: product.id,
          productName: 'Pomada',
          units: 1,
          revenueCents: 3500,
          costCents: 1800,
          marginCents: 1700,
        },
      ]);
      expect(response.body.data.totals).toEqual({
        units: 1,
        revenueCents: 3500,
        marginCents: 1700,
        productsWithoutCost: 0,
      });
    });

    it('carries what needs restocking, whatever the range', async () => {
      await makeProduct(dataSource, { name: 'Minoxidil', stockQuantity: 0, lowStockThreshold: 1 });

      const response = await get(`/v1/reports/products?${RANGE}`, managerAuth);

      expect(response.body.data.lowStock).toEqual([
        expect.objectContaining({ productName: 'Minoxidil', stockQuantity: 0 }),
      ]);
    });
  });

  describe('GET /v1/reports/dre', () => {
    it('nets the fees off the takings, then the expenses and the commissions', async () => {
      const { barber } = await aJulyOfTrading();
      await makeExpense(dataSource, {
        category: 'rent',
        amount: 250_000,
        paidAt: at('2026-07-05', '09:00:00'),
      });
      await makeCommissionEntry(dataSource, {
        barberId: barber.id,
        baseAmount: 4500,
        rate: 0.4,
        createdAt: at('2026-07-10', '11:00:00'),
      });

      const response = await get(`/v1/reports/dre?${RANGE}`, managerAuth);

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        revenue: {
          grossCents: 8000,
          serviceGrossCents: 4500,
          productGrossCents: 3500,
          cardFeeCents: 150,
          netCents: 7850,
        },
        expenses: { totalCents: 250_000, byCategory: [{ category: 'rent', amountCents: 250_000 }] },
        commissionsCents: 1800,

        resultCents: 7850 - 250_000 - 1800,
      });
    });

    it('leaves out an expense that has not been paid yet', async () => {
      await makeExpense(dataSource, { category: 'salaries', amount: 100_000, paidAt: null });

      const response = await get(`/v1/reports/dre?${RANGE}`, managerAuth);

      expect(response.body.data.expenses).toEqual({ totalCents: 0, byCategory: [] });
    });
  });

  describe('who may read the books', () => {
    const paths = [
      '/v1/reports/revenue',
      '/v1/reports/average-ticket',
      '/v1/reports/top-services',
      '/v1/reports/products',
      '/v1/reports/dre',
      '/v1/reports/occupancy',
      '/v1/reports/no-shows',
      '/v1/reports/clients',
    ];

    it('lets an admin and a manager in', async () => {
      for (const path of paths) {
        expect((await get(path, adminAuth)).status).toBe(200);
        expect((await get(path, managerAuth)).status).toBe(200);
      }
    });

    it('keeps barbers and clients out of the shop books', async () => {
      for (const path of paths) {
        expect((await get(path, barberAuth)).status).toBe(403);
        expect((await get(path, clientAuth)).status).toBe(403);
      }
    });

    it('answers 401 without a token', async () => {
      for (const path of paths) {
        expect((await request(app).get(path)).status).toBe(401);
      }
    });
  });

  describe('GET /v1/reports/no-shows', () => {
    it('counts and rates no-shows and cancellations per barber', async () => {
      const barber = await makeBarber(dataSource, { displayName: 'Rafael' });
      await makeAppointment(dataSource, {
        barberId: barber.id,
        status: 'completed',
        startsAt: at('2026-07-10', '10:00:00'),
      });
      await makeAppointment(dataSource, {
        barberId: barber.id,
        status: 'no_show',
        startsAt: at('2026-07-11', '10:00:00'),
      });

      const response = await get(`/v1/reports/no-shows?${RANGE}`, managerAuth);

      expect(response.status).toBe(200);
      expect(response.body.data.overall).toMatchObject({
        completed: 1,
        noShows: 1,
        total: 2,
        noShowRate: 0.5,
      });
      expect(response.body.data.barbers[0]).toMatchObject({
        barberId: barber.id,
        barberName: 'Rafael',
        noShows: 1,
      });
    });
  });

  describe('GET /v1/reports/clients', () => {
    it('splits new from recurring and counts the inactive', async () => {
      const newbie = await makeUser(dataSource, { role: 'CLIENT' });
      const regular = await makeUser(dataSource, { role: 'CLIENT' });
      await makeUser(dataSource, { role: 'CLIENT' });

      await makeAppointment(dataSource, {
        clientId: regular.id,
        status: 'completed',
        startsAt: at('2026-06-01', '10:00:00'),
      });
      await makeAppointment(dataSource, {
        clientId: regular.id,
        status: 'completed',
        startsAt: at('2026-07-10', '10:00:00'),
      });
      await makeAppointment(dataSource, {
        clientId: newbie.id,
        status: 'completed',
        startsAt: at('2026-07-15', '10:00:00'),
      });

      const response = await get(`/v1/reports/clients?${RANGE}`, managerAuth);

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        newClients: 1,
        recurringClients: 1,

        inactiveClients: expect.any(Number),
      });
      expect(response.body.data.inactiveClients).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /v1/reports/occupancy', () => {
    it('returns a rate against the schedule for an active barber', async () => {
      const barber = await makeBarber(dataSource, { displayName: 'Rafael' });
      await makeWorkingWeek(dataSource, barber.id);
      await makeAppointment(dataSource, {
        barberId: barber.id,
        status: 'completed',
        durationMinutes: 30,

        startsAt: at('2026-07-13', '10:00:00'),
      });

      const response = await get(
        '/v1/reports/occupancy?from=2026-07-13&to=2026-07-13',
        managerAuth,
      );

      expect(response.status).toBe(200);
      expect(response.body.data.barbers).toEqual([
        expect.objectContaining({
          barberId: barber.id,
          bookedMinutes: 30,
          scheduledMinutes: expect.any(Number),
          occupancyRate: expect.any(Number),
        }),
      ]);
      expect(response.body.data.barbers[0].scheduledMinutes).toBeGreaterThan(0);
    });
  });

  describe('GET /v1/reports/barbers/:id/summary', () => {
    it('lets a manager read any barber', async () => {
      const { barber } = await aJulyOfTrading();

      const response = await get(`/v1/reports/barbers/${barber.id}/summary?${RANGE}`, managerAuth);

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        barberId: barber.id,
        barberName: 'Rafael',
        cuts: 1,
        revenueCents: 8000,
      });
    });

    it('lets a barber read their own and refuses another', async () => {
      const own = await makeAuthenticatedUser(dataSource, config, { role: 'BARBER' });
      const barber = await makeBarber(dataSource, {
        userId: own.user.id,
        displayName: 'Self',
      });
      const other = await makeBarber(dataSource, { displayName: 'Other' });

      expect(
        (await get(`/v1/reports/barbers/${barber.id}/summary?${RANGE}`, own.authHeader)).status,
      ).toBe(200);
      expect(
        (await get(`/v1/reports/barbers/${other.id}/summary?${RANGE}`, own.authHeader)).status,
      ).toBe(403);
    });

    it('keeps clients out', async () => {
      const barber = await makeBarber(dataSource);

      expect((await get(`/v1/reports/barbers/${barber.id}/summary`, clientAuth)).status).toBe(403);
    });
  });
});
