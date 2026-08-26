import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CommissionAdvancesRepository } from '../../src/repositories/commission-advances.repository';
import { getTestDataSource, truncateAll } from '../support/db';
import {
  makeBarber,
  makeCommissionAdvance,
  makeCommissionPeriod,
  makeUser,
  withTestShop,
} from '../support/factories';

const PAGE = { limit: 50, offset: 0 };

describe('commission advances repository', () => {
  let dataSource: DataSource;
  let repository: CommissionAdvancesRepository;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    repository = new CommissionAdvancesRepository(withTestShop(dataSource));
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
  });

  it('stores the amount in cents and starts with no period', async () => {
    const barber = await makeBarber(dataSource);
    const manager = await makeUser(dataSource, { role: 'MANAGER' });

    const created = await repository.create({
      barberId: barber.id,
      amount: 15_000,
      notes: 'Adiantamento pedido na sexta',
      createdBy: manager.id,
    });

    expect(await repository.findById(created.id)).toMatchObject({
      amount: 15_000,
      notes: 'Adiantamento pedido na sexta',
      periodId: null,
    });
  });

  describe('findUnassignedInRange', () => {
    it('takes only this barber, only inside the range, only unassigned', async () => {
      const barber = await makeBarber(dataSource);
      const period = await makeCommissionPeriod(dataSource, { barberId: barber.id });

      const wanted = await makeCommissionAdvance(dataSource, {
        barberId: barber.id,
        createdAt: new Date('2026-03-05T12:00:00.000Z'),
      });
      await makeCommissionAdvance(dataSource, {
        barberId: barber.id,
        createdAt: new Date('2026-02-20T12:00:00.000Z'),
      });
      await makeCommissionAdvance(dataSource, {
        barberId: barber.id,
        createdAt: new Date('2026-03-06T12:00:00.000Z'),
        periodId: period.id,
      });
      await makeCommissionAdvance(dataSource, {
        createdAt: new Date('2026-03-07T12:00:00.000Z'),
      });

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

      const onStart = await makeCommissionAdvance(dataSource, {
        barberId: barber.id,
        createdAt: start,
      });
      await makeCommissionAdvance(dataSource, { barberId: barber.id, createdAt: end });

      const found = await repository.findUnassignedInRange(barber.id, start, end);

      expect(found.map((row) => row.id)).toEqual([onStart.id]);
    });
  });

  describe('assignPeriod', () => {
    it('stamps the period and reads back by it', async () => {
      const barber = await makeBarber(dataSource);
      const period = await makeCommissionPeriod(dataSource, { barberId: barber.id });
      const first = await makeCommissionAdvance(dataSource, { barberId: barber.id });
      const second = await makeCommissionAdvance(dataSource, { barberId: barber.id });

      const affected = await repository.assignPeriod([first.id, second.id], period.id);

      expect(affected).toBe(2);
      expect((await repository.findByPeriod(period.id)).map((row) => row.id)).toEqual([
        first.id,
        second.id,
      ]);
    });

    it('leaves an advance another period already claimed alone', async () => {
      const barber = await makeBarber(dataSource);
      const first = await makeCommissionPeriod(dataSource, {
        barberId: barber.id,
        startsOn: '2026-01-01',
        endsOn: '2026-01-31',
      });
      const second = await makeCommissionPeriod(dataSource, {
        barberId: barber.id,
        startsOn: '2026-02-01',
        endsOn: '2026-02-28',
      });
      const claimed = await makeCommissionAdvance(dataSource, {
        barberId: barber.id,
        periodId: first.id,
      });

      expect(await repository.assignPeriod([claimed.id], second.id)).toBe(0);
      expect((await repository.findById(claimed.id))?.periodId).toBe(first.id);
    });

    it('does nothing, quietly, for an empty list', async () => {
      const period = await makeCommissionPeriod(dataSource);

      expect(await repository.assignPeriod([], period.id)).toBe(0);
    });
  });

  describe('findMany', () => {
    it('filters by barber, by period and by unassigned', async () => {
      const barber = await makeBarber(dataSource);
      const period = await makeCommissionPeriod(dataSource, { barberId: barber.id });
      const settled = await makeCommissionAdvance(dataSource, {
        barberId: barber.id,
        periodId: period.id,
      });
      const open = await makeCommissionAdvance(dataSource, { barberId: barber.id });
      await makeCommissionAdvance(dataSource);

      const [mine, mineTotal] = await repository.findMany({ barberId: barber.id }, PAGE);
      const [byPeriod] = await repository.findMany({ periodId: period.id }, PAGE);
      const [unassigned] = await repository.findMany(
        { barberId: barber.id, unassigned: true },
        PAGE,
      );

      expect(mineTotal).toBe(2);
      expect(mine.map((row) => row.id).sort()).toEqual([settled.id, open.id].sort());
      expect(byPeriod.map((row) => row.id)).toEqual([settled.id]);
      expect(unassigned.map((row) => row.id)).toEqual([open.id]);
    });

    it('reads newest first and pages', async () => {
      const barber = await makeBarber(dataSource);
      const oldest = await makeCommissionAdvance(dataSource, {
        barberId: barber.id,
        createdAt: new Date('2026-01-01T12:00:00.000Z'),
      });
      const middle = await makeCommissionAdvance(dataSource, {
        barberId: barber.id,
        createdAt: new Date('2026-02-01T12:00:00.000Z'),
      });
      const newest = await makeCommissionAdvance(dataSource, {
        barberId: barber.id,
        createdAt: new Date('2026-03-01T12:00:00.000Z'),
      });

      const [first, total] = await repository.findMany({}, { limit: 2, offset: 0 });
      const [second] = await repository.findMany({}, { limit: 2, offset: 2 });

      expect(total).toBe(3);
      expect(first.map((row) => row.id)).toEqual([newest.id, middle.id]);
      expect(second.map((row) => row.id)).toEqual([oldest.id]);
    });
  });

  it('joins a caller transaction and disappears when it rolls back', async () => {
    const barber = await makeBarber(dataSource);
    const manager = await makeUser(dataSource, { role: 'MANAGER' });

    await expect(
      dataSource.transaction(async (entityManager) => {
        await repository.create(
          { barberId: barber.id, amount: 5000, notes: null, createdBy: manager.id },
          entityManager,
        );

        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');

    const [, total] = await repository.findMany({ barberId: barber.id }, PAGE);
    expect(total).toBe(0);
  });
});
