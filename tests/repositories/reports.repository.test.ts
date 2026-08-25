import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Cradle } from '../../src/container';
import { shopRangeBounds, toInstant } from '../../src/lib/shop-time';
import { ReportsRepository } from '../../src/repositories/reports.repository';
import { getTestDataSource, truncateAll } from '../support/db';
import {
  makeAppointment,
  makeBarber,
  makeCommissionEntry,
  makeExpense,
  makePayment,
  makeProduct,
  makeProductSale,
  makeService,
  makeUser,
} from '../support/factories';

const ZONE = 'America/Sao_Paulo';

const JULY = shopRangeBounds('2026-07-01', '2026-07-31', ZONE);

function at(date: string, time: string): Date {
  return toInstant(date, time, ZONE);
}

describe('reports repository', () => {
  let dataSource: DataSource;
  let repository: ReportsRepository;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    repository = new ReportsRepository({ dataSource } as Cradle);
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
  });

  describe('revenue', () => {
    it('buckets by shop-local day, so a late-night payment stays on its own day', async () => {

      await makePayment(dataSource, { amount: 5000, paidAt: at('2026-07-15', '23:30:00') });
      await makePayment(dataSource, { amount: 3000, paidAt: at('2026-07-16', '10:00:00') });

      const buckets = await repository.revenue(JULY, 'day', ZONE);

      expect(buckets).toEqual([
        expect.objectContaining({ key: '2026-07-15', grossCents: 5000 }),
        expect.objectContaining({ key: '2026-07-16', grossCents: 3000 }),
      ]);
    });

    it('includes the last day of the range whole', async () => {
      await makePayment(dataSource, { amount: 5000, paidAt: at('2026-07-31', '23:30:00') });
      await makePayment(dataSource, { amount: 9900, paidAt: at('2026-08-01', '00:30:00') });

      const buckets = await repository.revenue(JULY, 'day', ZONE);

      expect(buckets).toEqual([expect.objectContaining({ key: '2026-07-31', grossCents: 5000 })]);
    });

    it('counts a multi-line basket once, not once per line', async () => {
      const payment = await makePayment(dataSource, {
        appointmentId: null,
        amount: 10_000,
        paidAt: at('2026-07-10', '12:00:00'),
      });
      const pomade = await makeProduct(dataSource, { price: 3500 });
      const oil = await makeProduct(dataSource, { price: 6500 });
      await makeProductSale(dataSource, {
        paymentId: payment.id,
        productId: pomade.id,
        unitPrice: 3500,
      });
      await makeProductSale(dataSource, {
        paymentId: payment.id,
        productId: oil.id,
        unitPrice: 6500,
      });

      const buckets = await repository.revenue(JULY, 'day', ZONE);

      expect(buckets).toEqual([
        expect.objectContaining({ key: '2026-07-10', grossCents: 10_000, payments: 1 }),
      ]);
    });

    it('ignores voided payments', async () => {
      await makePayment(dataSource, { amount: 5000, paidAt: at('2026-07-10', '12:00:00') });
      await makePayment(dataSource, {
        amount: 9900,
        paidAt: at('2026-07-10', '13:00:00'),
        voidedAt: at('2026-07-10', '14:00:00'),
      });

      const buckets = await repository.revenue(JULY, 'day', ZONE);

      expect(buckets).toEqual([
        expect.objectContaining({ key: '2026-07-10', grossCents: 5000, payments: 1 }),
      ]);
    });

    it('credits a product sale to whoever sold it, and leaves a house sale unattributed', async () => {
      const barber = await makeBarber(dataSource, { displayName: 'Rafael' });
      const appointment = await makeAppointment(dataSource, {
        barberId: barber.id,
        status: 'completed',
      });
      await makePayment(dataSource, {
        appointmentId: appointment.id,
        amount: 4500,
        paidAt: at('2026-07-10', '10:00:00'),
      });

      const sold = await makePayment(dataSource, {
        appointmentId: null,
        amount: 3500,
        paidAt: at('2026-07-10', '11:00:00'),
      });
      await makeProductSale(dataSource, { paymentId: sold.id, soldByBarberId: barber.id });

      const house = await makePayment(dataSource, {
        appointmentId: null,
        amount: 2000,
        paidAt: at('2026-07-10', '12:00:00'),
      });
      await makeProductSale(dataSource, { paymentId: house.id, soldByBarberId: null });

      const buckets = await repository.revenue(JULY, 'barber', ZONE);

      expect(buckets).toEqual([

        {
          key: barber.id,
          label: 'Rafael',
          grossCents: 8000,
          netCents: 8000,
          cardFeeCents: 0,
          payments: 2,
        },
        { key: null, label: null, grossCents: 2000, netCents: 2000, cardFeeCents: 0, payments: 1 },
      ]);
    });

    it('groups by service, leaving product payments under no service at all', async () => {
      const service = await makeService(dataSource, { name: 'Corte' });
      const appointment = await makeAppointment(dataSource, {
        serviceId: service.id,
        status: 'completed',
      });
      await makePayment(dataSource, {
        appointmentId: appointment.id,
        amount: 4500,
        paidAt: at('2026-07-10', '10:00:00'),
      });
      await makePayment(dataSource, {
        appointmentId: null,
        amount: 2000,
        paidAt: at('2026-07-10', '11:00:00'),
      });

      const buckets = await repository.revenue(JULY, 'service', ZONE);

      expect(buckets).toEqual([
        expect.objectContaining({ key: service.id, label: 'Corte', grossCents: 4500 }),
        expect.objectContaining({ key: null, label: null, grossCents: 2000 }),
      ]);
    });

    it('groups by method, keeping the card fee with it', async () => {
      await makePayment(dataSource, {
        method: 'credit',
        amount: 10_000,
        cardFee: 350,
        paidAt: at('2026-07-10', '10:00:00'),
      });
      await makePayment(dataSource, {
        method: 'cash',
        amount: 4000,
        paidAt: at('2026-07-10', '11:00:00'),
      });

      const buckets = await repository.revenue(JULY, 'method', ZONE);

      expect(buckets).toEqual([
        expect.objectContaining({
          key: 'credit',
          grossCents: 10_000,
          netCents: 9650,
          cardFeeCents: 350,
        }),
        expect.objectContaining({ key: 'cash', grossCents: 4000, cardFeeCents: 0 }),
      ]);
    });

    it('buckets a week to its Monday and a month to its first', async () => {

      await makePayment(dataSource, { amount: 1000, paidAt: at('2026-07-15', '10:00:00') });
      await makePayment(dataSource, { amount: 2000, paidAt: at('2026-07-18', '10:00:00') });

      expect(await repository.revenue(JULY, 'week', ZONE)).toEqual([
        expect.objectContaining({ key: '2026-07-13', grossCents: 3000 }),
      ]);
      expect(await repository.revenue(JULY, 'month', ZONE)).toEqual([
        expect.objectContaining({ key: '2026-07-01', grossCents: 3000 }),
      ]);
    });
  });

  describe('revenueTotals', () => {
    it('splits what the chair earned from what the shelf did', async () => {
      await makePayment(dataSource, {
        amount: 4500,
        method: 'credit',
        cardFee: 150,
        paidAt: at('2026-07-10', '10:00:00'),
      });
      await makePayment(dataSource, {
        appointmentId: null,
        amount: 2000,
        paidAt: at('2026-07-10', '11:00:00'),
      });

      expect(await repository.revenueTotals(JULY)).toEqual({
        grossCents: 6500,
        netCents: 6350,
        cardFeeCents: 150,
        serviceGrossCents: 4500,
        productGrossCents: 2000,
        payments: 2,
      });
    });

    it('reports zeroes for a range where nothing happened', async () => {
      expect(await repository.revenueTotals(JULY)).toEqual({
        grossCents: 0,
        netCents: 0,
        cardFeeCents: 0,
        serviceGrossCents: 0,
        productGrossCents: 0,
        payments: 0,
      });
    });
  });

  describe('ticketsByBarber', () => {
    it('counts a split-paid appointment as one ticket, not two', async () => {
      const barber = await makeBarber(dataSource, { displayName: 'Bruno' });
      const appointment = await makeAppointment(dataSource, {
        barberId: barber.id,
        status: 'completed',
        price: 6000,
      });
      await makePayment(dataSource, {
        appointmentId: appointment.id,
        amount: 4000,
        paidAt: at('2026-07-10', '10:00:00'),
      });
      await makePayment(dataSource, {
        appointmentId: appointment.id,
        amount: 2000,
        paidAt: at('2026-07-10', '10:05:00'),
      });

      expect(await repository.ticketsByBarber(JULY)).toEqual([
        { barberId: barber.id, barberName: 'Bruno', grossCents: 6000, appointments: 1 },
      ]);
    });

    it('leaves product sales out — a pomade is not a visit', async () => {
      const barber = await makeBarber(dataSource, { displayName: 'Carla' });
      const appointment = await makeAppointment(dataSource, {
        barberId: barber.id,
        status: 'completed',
      });
      await makePayment(dataSource, {
        appointmentId: appointment.id,
        amount: 4500,
        paidAt: at('2026-07-10', '10:00:00'),
      });

      const sold = await makePayment(dataSource, {
        appointmentId: null,
        amount: 3500,
        paidAt: at('2026-07-10', '11:00:00'),
      });
      await makeProductSale(dataSource, { paymentId: sold.id, soldByBarberId: barber.id });

      expect(await repository.ticketsByBarber(JULY)).toEqual([
        { barberId: barber.id, barberName: 'Carla', grossCents: 4500, appointments: 1 },
      ]);
    });
  });

  describe('topServices', () => {
    it('ranks by takings and honours the limit', async () => {
      const cut = await makeService(dataSource, { name: 'Corte' });
      const beard = await makeService(dataSource, { name: 'Barba' });

      for (const amount of [4500, 4500]) {
        const appointment = await makeAppointment(dataSource, {
          serviceId: cut.id,
          status: 'completed',
        });
        await makePayment(dataSource, {
          appointmentId: appointment.id,
          amount,
          paidAt: at('2026-07-10', '10:00:00'),
        });
      }

      const beardAppointment = await makeAppointment(dataSource, {
        serviceId: beard.id,
        status: 'completed',
      });
      await makePayment(dataSource, {
        appointmentId: beardAppointment.id,
        amount: 3000,
        paidAt: at('2026-07-10', '11:00:00'),
      });

      expect(await repository.topServices(JULY, 10)).toEqual([
        { serviceId: cut.id, serviceName: 'Corte', grossCents: 9000, appointments: 2 },
        { serviceId: beard.id, serviceName: 'Barba', grossCents: 3000, appointments: 1 },
      ]);
      expect(await repository.topServices(JULY, 1)).toHaveLength(1);
    });
  });

  describe('productsSold', () => {
    it('sums units and takings per product, skipping voided lines', async () => {
      const pomade = await makeProduct(dataSource, { price: 3500, cost: 1800 });
      const live = await makePayment(dataSource, {
        appointmentId: null,
        amount: 7000,
        paidAt: at('2026-07-10', '10:00:00'),
      });
      await makeProductSale(dataSource, {
        paymentId: live.id,
        productId: pomade.id,
        quantity: 2,
        unitPrice: 3500,
        total: 7000,
      });

      const voided = await makePayment(dataSource, {
        appointmentId: null,
        amount: 3500,
        paidAt: at('2026-07-11', '10:00:00'),
      });
      await makeProductSale(dataSource, {
        paymentId: voided.id,
        productId: pomade.id,
        unitPrice: 3500,
        voidedAt: at('2026-07-11', '11:00:00'),
      });

      expect(await repository.productsSold(JULY)).toEqual([
        {
          productId: pomade.id,
          productName: pomade.name,
          units: 2,
          revenueCents: 7000,
          costCents: 1800,
        },
      ]);
    });

    it('reports a null cost when nobody ever recorded one', async () => {
      const product = await makeProduct(dataSource, { price: 2000, cost: null });
      const payment = await makePayment(dataSource, {
        appointmentId: null,
        amount: 2000,
        paidAt: at('2026-07-10', '10:00:00'),
      });
      await makeProductSale(dataSource, {
        paymentId: payment.id,
        productId: product.id,
        unitPrice: 2000,
      });

      expect(await repository.productsSold(JULY)).toEqual([
        expect.objectContaining({ costCents: null, revenueCents: 2000 }),
      ]);
    });
  });

  describe('lowStock', () => {
    it('catches the at-threshold row and skips a retired product', async () => {
      const low = await makeProduct(dataSource, { stockQuantity: 3, lowStockThreshold: 3 });
      await makeProduct(dataSource, { stockQuantity: 10, lowStockThreshold: 3 });
      await makeProduct(dataSource, { stockQuantity: 0, lowStockThreshold: 5, active: false });

      expect(await repository.lowStock()).toEqual([
        {
          productId: low.id,
          productName: low.name,
          stockQuantity: 3,
          lowStockThreshold: 3,
        },
      ]);
    });
  });

  describe('expensesByCategory', () => {
    it('counts only what was actually paid inside the range', async () => {
      await makeExpense(dataSource, {
        category: 'rent',
        amount: 250_000,
        paidAt: at('2026-07-05', '09:00:00'),
      });
      await makeExpense(dataSource, {
        category: 'supplies',
        amount: 7500,
        paidAt: at('2026-07-06', '09:00:00'),
      });

      await makeExpense(dataSource, { category: 'salaries', amount: 100_000, paidAt: null });
      await makeExpense(dataSource, {
        category: 'rent',
        amount: 250_000,
        paidAt: at('2026-08-05', '09:00:00'),
      });

      expect(await repository.expensesByCategory(JULY)).toEqual([
        { category: 'rent', amountCents: 250_000 },
        { category: 'supplies', amountCents: 7500 },
      ]);
    });
  });

  describe('commissionsEarned', () => {
    it('sums entries by when they were earned', async () => {
      await makeCommissionEntry(dataSource, {
        baseAmount: 10_000,
        rate: 0.4,
        createdAt: at('2026-07-10', '10:00:00'),
      });
      await makeCommissionEntry(dataSource, {
        baseAmount: 5000,
        rate: 0.5,
        createdAt: at('2026-08-10', '10:00:00'),
      });

      expect(await repository.commissionsEarned(JULY)).toBe(4000);
    });

    it('is zero when nobody earned anything', async () => {
      expect(await repository.commissionsEarned(JULY)).toBe(0);
    });
  });

  describe('appointmentCounts', () => {
    it('counts by status on the agenda, not on the till', async () => {
      await makeAppointment(dataSource, {
        status: 'completed',
        startsAt: at('2026-07-10', '10:00:00'),
      });
      await makeAppointment(dataSource, {
        status: 'no_show',
        startsAt: at('2026-07-11', '10:00:00'),
      });
      await makeAppointment(dataSource, {
        status: 'completed',
        startsAt: at('2026-08-11', '10:00:00'),
      });

      expect(await repository.appointmentCounts(JULY)).toEqual({ completed: 1, no_show: 1 });
    });
  });

  describe('bookedMinutesByBarber', () => {
    it('sums duration for every status except cancelled', async () => {
      const barber = await makeBarber(dataSource);
      await makeAppointment(dataSource, {
        barberId: barber.id,
        status: 'completed',
        durationMinutes: 30,
        startsAt: at('2026-07-10', '10:00:00'),
      });
      await makeAppointment(dataSource, {
        barberId: barber.id,
        status: 'no_show',
        durationMinutes: 45,
        startsAt: at('2026-07-11', '10:00:00'),
      });
      await makeAppointment(dataSource, {
        barberId: barber.id,
        status: 'cancelled',
        durationMinutes: 60,
        startsAt: at('2026-07-12', '10:00:00'),
      });

      expect(await repository.bookedMinutesByBarber(JULY)).toEqual([
        { barberId: barber.id, minutes: 75 },
      ]);
    });
  });

  describe('clientMix', () => {
    it('splits first-timers from clients who had been before', async () => {
      const newbie = await makeUser(dataSource, { role: 'CLIENT' });
      const regular = await makeUser(dataSource, { role: 'CLIENT' });

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

      expect(await repository.clientMix(JULY)).toEqual({ newClients: 1, recurringClients: 1 });
    });
  });

  describe('inactiveClientCount', () => {
    it('counts clients with no completed cut at or after the bound', async () => {
      const active = await makeUser(dataSource, { role: 'CLIENT' });
      const dormant = await makeUser(dataSource, { role: 'CLIENT' });
      await makeUser(dataSource, { role: 'CLIENT' });

      await makeAppointment(dataSource, {
        clientId: active.id,
        status: 'completed',
        startsAt: at('2026-07-10', '10:00:00'),
      });
      await makeAppointment(dataSource, {
        clientId: dormant.id,
        status: 'completed',
        startsAt: at('2026-05-01', '10:00:00'),
      });

      expect(await repository.inactiveClientCount(JULY.start)).toBe(2);
    });
  });

  describe('commissionsByBarber', () => {
    it('groups earnings by barber', async () => {
      const barber = await makeBarber(dataSource, { displayName: 'Rafael' });
      await makeCommissionEntry(dataSource, {
        barberId: barber.id,
        baseAmount: 10_000,
        rate: 0.4,
        createdAt: at('2026-07-10', '10:00:00'),
      });

      expect(await repository.commissionsByBarber(JULY)).toEqual([
        { barberId: barber.id, barberName: 'Rafael', amountCents: 4000 },
      ]);
    });
  });
});
