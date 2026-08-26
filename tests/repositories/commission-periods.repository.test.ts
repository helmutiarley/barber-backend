import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError } from '../../src/errors/app-error';
import { CommissionPeriodsRepository } from '../../src/repositories/commission-periods.repository';
import { getTestDataSource, truncateAll } from '../support/db';
import { makeBarber, makeCommissionPeriod, makeUser, withTestShop } from '../support/factories';

const PAGE = { limit: 50, offset: 0 };

describe('commission periods repository', () => {
  let dataSource: DataSource;
  let repository: CommissionPeriodsRepository;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    repository = new CommissionPeriodsRepository(withTestShop(dataSource));
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
  });

  it('snapshots the three totals in cents and keeps the dates as calendar days', async () => {
    const barber = await makeBarber(dataSource);
    const admin = await makeUser(dataSource, { role: 'ADMIN' });

    const created = await repository.create({
      barberId: barber.id,
      startsOn: '2026-03-01',
      endsOn: '2026-03-15',
      totalEntries: 84_250,
      totalAdvances: 20_000,
      totalDue: 64_250,
      closedBy: admin.id,
      closedAt: new Date(),
    });

    expect(await repository.findById(created.id)).toMatchObject({
      startsOn: '2026-03-01',
      endsOn: '2026-03-15',
      status: 'closed',
      totalEntries: 84_250,
      totalAdvances: 20_000,
      totalDue: 64_250,
      paidAt: null,
      paymentMethod: null,
    });
  });

  it('stores a negative total due, because drawing more than you earned is information', async () => {
    const period = await makeCommissionPeriod(dataSource, {
      totalEntries: 10_000,
      totalAdvances: 25_000,
      totalDue: -15_000,
    });

    expect((await repository.findById(period.id))?.totalDue).toBe(-15_000);
  });

  describe('overlap', () => {
    it('refuses a period overlapping one the same barber already has', async () => {
      const existing = await makeCommissionPeriod(dataSource, {
        startsOn: '2026-03-01',
        endsOn: '2026-03-15',
      });

      await expect(
        repository.create({
          barberId: existing.barberId,
          startsOn: '2026-03-10',
          endsOn: '2026-03-20',
          totalEntries: 0,
          totalAdvances: 0,
          totalDue: 0,
          closedBy: existing.closedBy,
          closedAt: new Date(),
        }),
      ).rejects.toThrow(ConflictError);
    });

    it('treats a shared boundary day as an overlap, since both ends are inclusive', async () => {
      const existing = await makeCommissionPeriod(dataSource, {
        startsOn: '2026-03-01',
        endsOn: '2026-03-15',
      });

      await expect(
        repository.create({
          barberId: existing.barberId,
          startsOn: '2026-03-15',
          endsOn: '2026-03-31',
          totalEntries: 0,
          totalAdvances: 0,
          totalDue: 0,
          closedBy: existing.closedBy,
          closedAt: new Date(),
        }),
      ).rejects.toThrow(ConflictError);
    });

    it('allows the very next day, and the same range for a different barber', async () => {
      const existing = await makeCommissionPeriod(dataSource, {
        startsOn: '2026-03-01',
        endsOn: '2026-03-15',
      });
      const other = await makeBarber(dataSource);

      const next = await repository.create({
        barberId: existing.barberId,
        startsOn: '2026-03-16',
        endsOn: '2026-03-31',
        totalEntries: 0,
        totalAdvances: 0,
        totalDue: 0,
        closedBy: existing.closedBy,
        closedAt: new Date(),
      });
      const sameRangeElsewhere = await repository.create({
        barberId: other.id,
        startsOn: '2026-03-01',
        endsOn: '2026-03-15',
        totalEntries: 0,
        totalAdvances: 0,
        totalDue: 0,
        closedBy: existing.closedBy,
        closedAt: new Date(),
      });

      expect(next.id).toBeDefined();
      expect(sameRangeElsewhere.id).toBeDefined();
    });

    it('finds the overlapping period before an insert has to fail', async () => {
      const existing = await makeCommissionPeriod(dataSource, {
        startsOn: '2026-03-01',
        endsOn: '2026-03-15',
      });

      expect(
        (await repository.findOverlapping(existing.barberId, '2026-03-14', '2026-03-20'))?.id,
      ).toBe(existing.id);
      expect(
        await repository.findOverlapping(existing.barberId, '2026-03-16', '2026-03-20'),
      ).toBeNull();
    });

    it('checks a whole payroll run in one query', async () => {
      const clashing = await makeCommissionPeriod(dataSource, {
        startsOn: '2026-03-01',
        endsOn: '2026-03-15',
      });
      const free = await makeBarber(dataSource);

      const found = await repository.findOverlappingForBarbers(
        [clashing.barberId, free.id],
        '2026-03-10',
        '2026-03-20',
      );

      expect(found.map((row) => row.barberId)).toEqual([clashing.barberId]);
      expect(await repository.findOverlappingForBarbers([], '2026-03-10', '2026-03-20')).toEqual(
        [],
      );
    });
  });

  describe('markPaid', () => {
    it('records when and how the money left', async () => {
      const period = await makeCommissionPeriod(dataSource);
      const paidAt = new Date('2026-03-16T12:00:00.000Z');

      const paid = await repository.markPaid(period.id, { paidAt, paymentMethod: 'pix' });

      expect(paid).toMatchObject({ status: 'paid', paymentMethod: 'pix' });
      expect(paid?.paidAt?.toISOString()).toBe(paidAt.toISOString());
    });

    it('returns null for a period already paid, so a double payout cannot slip through', async () => {
      const period = await makeCommissionPeriod(dataSource, {
        status: 'paid',
        paidAt: new Date(),
        paymentMethod: 'cash',
      });

      expect(
        await repository.markPaid(period.id, { paidAt: new Date(), paymentMethod: 'pix' }),
      ).toBeNull();
    });
  });

  describe('findMany', () => {
    it("keeps one barber's statements", async () => {
      const mine = await makeCommissionPeriod(dataSource);
      await makeCommissionPeriod(dataSource);

      const [rows, total] = await repository.findMany({ barberId: mine.barberId }, PAGE);

      expect(total).toBe(1);
      expect(rows[0].id).toBe(mine.id);
    });

    it('filters by status', async () => {
      const barber = await makeBarber(dataSource);
      await makeCommissionPeriod(dataSource, {
        barberId: barber.id,
        startsOn: '2026-01-01',
        endsOn: '2026-01-15',
      });
      const paid = await makeCommissionPeriod(dataSource, {
        barberId: barber.id,
        startsOn: '2026-02-01',
        endsOn: '2026-02-15',
        status: 'paid',
        paidAt: new Date(),
        paymentMethod: 'cash',
      });

      const [rows, total] = await repository.findMany({ status: 'paid' }, PAGE);

      expect(total).toBe(1);
      expect(rows[0].id).toBe(paid.id);
    });

    it('keeps periods whose range intersects the window, newest first', async () => {
      const barber = await makeBarber(dataSource);
      const january = await makeCommissionPeriod(dataSource, {
        barberId: barber.id,
        startsOn: '2026-01-01',
        endsOn: '2026-01-31',
      });
      const march = await makeCommissionPeriod(dataSource, {
        barberId: barber.id,
        startsOn: '2026-03-01',
        endsOn: '2026-03-31',
      });

      const [rows, total] = await repository.findMany({}, PAGE);
      const [intersecting] = await repository.findMany(
        { from: '2026-03-15', to: '2026-04-30' },
        PAGE,
      );

      expect(total).toBe(2);
      expect(rows.map((row) => row.id)).toEqual([march.id, january.id]);
      expect(intersecting.map((row) => row.id)).toEqual([march.id]);
    });
  });
});
