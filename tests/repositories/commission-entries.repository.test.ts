import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Cradle } from '../../src/container';
import { ConflictError } from '../../src/errors/app-error';
import { CommissionEntriesRepository } from '../../src/repositories/commission-entries.repository';
import { getTestDataSource, truncateAll } from '../support/db';
import {
  makeAppointment,
  makeBarber,
  makeCommissionEntry,
  makeCommissionPeriod,
  makeCommissionRule,
  makeProductSale,
} from '../support/factories';

const PAGE = { limit: 50, offset: 0 };

describe('commission entries repository', () => {
  let dataSource: DataSource;
  let repository: CommissionEntriesRepository;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    repository = new CommissionEntriesRepository({ dataSource } as Cradle);
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
  });

  it('snapshots the rate as a fraction and the money as cents', async () => {
    const appointment = await makeAppointment(dataSource, { status: 'completed' });
    const rule = await makeCommissionRule(dataSource, { rate: 0.375 });

    const created = await repository.create({
      barberId: appointment.barberId,
      appointmentId: appointment.id,
      ruleId: rule.id,
      rate: 0.375,
      base: 'net',
      baseAmount: 4500,
      amount: 1688,
    });

    expect(await repository.findById(created.id)).toMatchObject({
      rate: 0.375,
      base: 'net',
      baseAmount: 4500,
      amount: 1688,
    });
  });

  it('refuses a second entry for the same appointment', async () => {
    const entry = await makeCommissionEntry(dataSource);

    await expect(
      repository.create({
        barberId: entry.barberId,
        appointmentId: entry.appointmentId!,
        ruleId: entry.ruleId,
        rate: 0.5,
        base: 'gross',
        baseAmount: 4500,
        amount: 2250,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('finds the entry belonging to an appointment', async () => {
    const entry = await makeCommissionEntry(dataSource);

    expect((await repository.findByAppointment(entry.appointmentId!))?.id).toBe(entry.id);
    expect(await repository.findByAppointment(entry.barberId)).toBeNull();
  });

  it('moves both the base and the amount when a net base is corrected', async () => {
    const entry = await makeCommissionEntry(dataSource, { base: 'net', baseAmount: 4500 });

    const updated = await repository.updateAmounts(entry.id, { baseAmount: 4365, amount: 1746 });

    expect(updated).toMatchObject({ baseAmount: 4365, amount: 1746 });
  });

  describe('entries earned on a product sale', () => {
    it('stores one against a sale line instead of an appointment', async () => {
      const barber = await makeBarber(dataSource);
      const sale = await makeProductSale(dataSource, { soldByBarberId: barber.id, total: 3500 });
      const rule = await makeCommissionRule(dataSource, { appliesTo: 'products', rate: 0.1 });

      const created = await repository.create({
        barberId: barber.id,
        productSaleId: sale.id,
        ruleId: rule.id,
        rate: 0.1,
        base: 'gross',
        baseAmount: 3500,
        amount: 350,
      });

      expect(await repository.findById(created.id)).toMatchObject({
        appointmentId: null,
        productSaleId: sale.id,
        amount: 350,
      });
    });

    it('refuses a second entry for the same sale line', async () => {
      const barber = await makeBarber(dataSource);
      const sale = await makeProductSale(dataSource, { soldByBarberId: barber.id });
      const rule = await makeCommissionRule(dataSource, { appliesTo: 'products' });
      const row = {
        barberId: barber.id,
        productSaleId: sale.id,
        ruleId: rule.id,
        rate: 0.1,
        base: 'gross' as const,
        baseAmount: 3500,
        amount: 350,
      };

      await repository.create(row);

      await expect(repository.create(row)).rejects.toThrow(ConflictError);
    });

    it('refuses an entry that names neither a sale nor an appointment', async () => {
      const barber = await makeBarber(dataSource);
      const rule = await makeCommissionRule(dataSource);

      await expect(
        repository.create({
          barberId: barber.id,
          ruleId: rule.id,
          rate: 0.4,
          base: 'gross',
          baseAmount: 4500,
          amount: 1800,

        } as never),
      ).rejects.toThrow();
    });

    it('reads a whole basket of entries in one call', async () => {
      const barber = await makeBarber(dataSource);
      const first = await makeProductSale(dataSource, { soldByBarberId: barber.id });
      const second = await makeProductSale(dataSource, { soldByBarberId: barber.id });
      const mine = await makeCommissionEntry(dataSource, {
        barberId: barber.id,
        appointmentId: null,
        productSaleId: first.id,
      });
      const also = await makeCommissionEntry(dataSource, {
        barberId: barber.id,
        appointmentId: null,
        productSaleId: second.id,
      });
      await makeCommissionEntry(dataSource, { barberId: barber.id });

      const found = await repository.findByProductSales([first.id, second.id]);

      expect(found.map((row) => row.id).sort()).toEqual([mine.id, also.id].sort());
      expect(await repository.findByProductSales([])).toEqual([]);
    });
  });

  describe('zeroAmounts', () => {
    it('empties the amounts and keeps the provenance', async () => {
      const sale = await makeProductSale(dataSource);
      const entry = await makeCommissionEntry(dataSource, {
        appointmentId: null,
        productSaleId: sale.id,
        baseAmount: 3500,
        rate: 0.1,
      });

      expect(await repository.zeroAmounts([entry.id])).toBe(1);

      expect(await repository.findById(entry.id)).toMatchObject({
        baseAmount: 0,
        amount: 0,
        rate: 0.1,
        ruleId: entry.ruleId,
        barberId: entry.barberId,
        productSaleId: sale.id,
      });
    });

    it('refuses to touch an entry a period has settled', async () => {
      const barber = await makeBarber(dataSource);
      const period = await makeCommissionPeriod(dataSource, { barberId: barber.id });
      const entry = await makeCommissionEntry(dataSource, {
        barberId: barber.id,
        periodId: period.id,
        baseAmount: 4500,
        rate: 0.4,
      });

      expect(await repository.zeroAmounts([entry.id])).toBe(0);
      expect((await repository.findById(entry.id))?.amount).toBe(1800);
    });

    it('does nothing for an empty list', async () => {
      expect(await repository.zeroAmounts([])).toBe(0);
    });
  });

  describe('findMany', () => {
    it("keeps one barber's entries", async () => {
      const mine = await makeCommissionEntry(dataSource);
      await makeCommissionEntry(dataSource);

      const [rows, total] = await repository.findMany({ barberId: mine.barberId }, PAGE);

      expect(total).toBe(1);
      expect(rows[0].id).toBe(mine.id);
    });

    it('bounds the earned-at range inclusively', async () => {
      const barber = await makeBarber(dataSource);
      const inside = await makeCommissionEntry(dataSource, {
        barberId: barber.id,
        createdAt: new Date('2030-03-10T12:00:00.000Z'),
      });
      await makeCommissionEntry(dataSource, {
        barberId: barber.id,
        createdAt: new Date('2030-04-02T12:00:00.000Z'),
      });

      const [rows, total] = await repository.findMany(
        {
          barberId: barber.id,
          from: new Date('2030-03-01T00:00:00.000Z'),
          to: new Date('2030-03-31T23:59:59.999Z'),
        },
        PAGE,
      );

      expect(total).toBe(1);
      expect(rows[0].id).toBe(inside.id);
    });

    it('reads newest first and pages', async () => {
      const barber = await makeBarber(dataSource);
      const oldest = await makeCommissionEntry(dataSource, {
        barberId: barber.id,
        createdAt: new Date('2030-01-01T12:00:00.000Z'),
      });
      const middle = await makeCommissionEntry(dataSource, {
        barberId: barber.id,
        createdAt: new Date('2030-02-01T12:00:00.000Z'),
      });
      const newest = await makeCommissionEntry(dataSource, {
        barberId: barber.id,
        createdAt: new Date('2030-03-01T12:00:00.000Z'),
      });

      const [first, total] = await repository.findMany({}, { limit: 2, offset: 0 });
      const [second] = await repository.findMany({}, { limit: 2, offset: 2 });

      expect(total).toBe(3);
      expect(first.map((row) => row.id)).toEqual([newest.id, middle.id]);
      expect(second.map((row) => row.id)).toEqual([oldest.id]);
    });
  });

  describe('closing a period over entries', () => {
    it('sweeps only this barber, only inside the range, only unassigned', async () => {
      const barber = await makeBarber(dataSource);
      const period = await makeCommissionPeriod(dataSource, { barberId: barber.id });

      const wanted = await makeCommissionEntry(dataSource, {
        barberId: barber.id,
        createdAt: new Date('2026-03-05T12:00:00.000Z'),
      });
      await makeCommissionEntry(dataSource, {
        barberId: barber.id,
        createdAt: new Date('2026-02-20T12:00:00.000Z'),
      });
      await makeCommissionEntry(dataSource, {
        barberId: barber.id,
        createdAt: new Date('2026-03-06T12:00:00.000Z'),
        periodId: period.id,
      });
      await makeCommissionEntry(dataSource, { createdAt: new Date('2026-03-07T12:00:00.000Z') });

      const found = await repository.findUnassignedInRange(
        barber.id,
        new Date('2026-03-01T00:00:00.000Z'),
        new Date('2026-03-16T00:00:00.000Z'),
      );

      expect(found.map((row) => row.id)).toEqual([wanted.id]);
    });

    it('includes the start instant and excludes the end one', async () => {
      const barber = await makeBarber(dataSource);
      const start = new Date('2026-03-01T00:00:00.000Z');
      const end = new Date('2026-03-16T00:00:00.000Z');

      const onStart = await makeCommissionEntry(dataSource, {
        barberId: barber.id,
        createdAt: start,
      });
      await makeCommissionEntry(dataSource, { barberId: barber.id, createdAt: end });

      expect(
        (await repository.findUnassignedInRange(barber.id, start, end)).map((row) => row.id),
      ).toEqual([onStart.id]);
    });

    it('stamps the period and reads back by it', async () => {
      const barber = await makeBarber(dataSource);
      const period = await makeCommissionPeriod(dataSource, { barberId: barber.id });
      const first = await makeCommissionEntry(dataSource, { barberId: barber.id });
      const second = await makeCommissionEntry(dataSource, { barberId: barber.id });

      expect(await repository.assignPeriod([first.id, second.id], period.id)).toBe(2);
      expect((await repository.findByPeriod(period.id)).map((row) => row.id).sort()).toEqual(
        [first.id, second.id].sort(),
      );
    });

    it('leaves an entry another period already claimed alone', async () => {
      const barber = await makeBarber(dataSource);
      const january = await makeCommissionPeriod(dataSource, {
        barberId: barber.id,
        startsOn: '2026-01-01',
        endsOn: '2026-01-31',
      });
      const february = await makeCommissionPeriod(dataSource, {
        barberId: barber.id,
        startsOn: '2026-02-01',
        endsOn: '2026-02-28',
      });
      const claimed = await makeCommissionEntry(dataSource, {
        barberId: barber.id,
        periodId: january.id,
      });

      expect(await repository.assignPeriod([claimed.id], february.id)).toBe(0);
      expect((await repository.findById(claimed.id))?.periodId).toBe(january.id);
    });

    it('filters a listing by period', async () => {
      const barber = await makeBarber(dataSource);
      const period = await makeCommissionPeriod(dataSource, { barberId: barber.id });
      const settled = await makeCommissionEntry(dataSource, {
        barberId: barber.id,
        periodId: period.id,
      });
      await makeCommissionEntry(dataSource, { barberId: barber.id });

      const [rows, total] = await repository.findMany({ periodId: period.id }, PAGE);

      expect(total).toBe(1);
      expect(rows[0].id).toBe(settled.id);
    });
  });

  it('joins a caller transaction and disappears when it rolls back', async () => {
    const appointment = await makeAppointment(dataSource, { status: 'completed' });
    const rule = await makeCommissionRule(dataSource);

    await expect(
      dataSource.transaction(async (manager) => {
        await repository.create(
          {
            barberId: appointment.barberId,
            appointmentId: appointment.id,
            ruleId: rule.id,
            rate: 0.4,
            base: 'gross',
            baseAmount: 4500,
            amount: 1800,
          },
          manager,
        );

        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');

    expect(await repository.findByAppointment(appointment.id)).toBeNull();
  });
});
