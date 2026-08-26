import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Barber } from '../../src/entities/barber.entity';
import type { Service } from '../../src/entities/service.entity';
import type { User } from '../../src/entities/user.entity';
import { ConflictError } from '../../src/errors/app-error';
import { getTestDataSource, truncateAll } from '../support/db';
import { makeBarber, makeService, makeUser, withTestShop } from '../support/factories';
import { AppointmentsRepository } from '../../src/repositories/appointments.repository';

const AT_10_00 = new Date('2030-03-01T10:00:00.000Z');
const AT_10_30 = new Date('2030-03-01T10:30:00.000Z');
const AT_11_00 = new Date('2030-03-01T11:00:00.000Z');

describe('AppointmentsRepository', () => {
  let dataSource: DataSource;
  let repository: AppointmentsRepository;
  let client: User;
  let barber: Barber;
  let service: Service;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    repository = new AppointmentsRepository(withTestShop(dataSource));
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    client = await makeUser(dataSource, { role: 'CLIENT' });
    barber = await makeBarber(dataSource);
    service = await makeService(dataSource);
  });

  function booking(startsAt: Date, endsAt: Date) {
    return {
      clientId: client.id,
      barberId: barber.id,
      serviceId: service.id,
      startsAt,
      endsAt,
      price: 4500,
      durationMinutes: 30,
      createdBy: client.id,
    };
  }

  it('persists an appointment with cents round-tripping through numeric', async () => {
    const created = await repository.create(booking(AT_10_00, AT_10_30));

    const reloaded = await repository.findById(created.id);
    expect(reloaded?.price).toBe(4500);
    expect(reloaded?.status).toBe('scheduled');
    expect(reloaded?.startsAt.toISOString()).toBe(AT_10_00.toISOString());
  });

  it('rejects an overlapping booking for the same barber', async () => {
    await repository.create(booking(AT_10_00, AT_10_30));

    await expect(
      repository.create(booking(new Date('2030-03-01T10:15:00.000Z'), AT_11_00)),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows back-to-back appointments', async () => {
    await repository.create(booking(AT_10_00, AT_10_30));

    await expect(repository.create(booking(AT_10_30, AT_11_00))).resolves.toBeDefined();
  });

  it('allows the same slot for a different barber', async () => {
    const other = await makeBarber(dataSource, { displayName: 'Other' });
    await repository.create(booking(AT_10_00, AT_10_30));

    await expect(
      repository.create({ ...booking(AT_10_00, AT_10_30), barberId: other.id }),
    ).resolves.toBeDefined();
  });

  describe('findOverlapping', () => {
    beforeEach(async () => {
      await repository.create(booking(AT_10_00, AT_10_30));
    });

    it('finds a partial overlap', async () => {
      const found = await repository.findOverlapping(
        barber.id,
        new Date('2030-03-01T10:15:00.000Z'),
        AT_11_00,
      );
      expect(found).toHaveLength(1);
    });

    it('ignores a touching slot', async () => {
      const found = await repository.findOverlapping(barber.id, AT_10_30, AT_11_00);
      expect(found).toHaveLength(0);
    });

    it('ignores cancelled appointments', async () => {
      await dataSource.query(`UPDATE appointments SET status = 'cancelled'`);

      const found = await repository.findOverlapping(barber.id, AT_10_00, AT_10_30);
      expect(found).toHaveLength(0);
    });

    it('ignores the appointment being rescheduled', async () => {
      const [existing] = await repository.findOverlapping(barber.id, AT_10_00, AT_10_30);

      const found = await repository.findOverlapping(barber.id, AT_10_00, AT_10_30, existing.id);
      expect(found).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('moves an appointment to a free slot', async () => {
      const created = await repository.create(booking(AT_10_00, AT_10_30));

      const moved = await repository.update(created.id, { startsAt: AT_10_30, endsAt: AT_11_00 });

      expect(moved?.startsAt.toISOString()).toBe(AT_10_30.toISOString());
    });

    it('refuses to move one on top of another', async () => {
      const created = await repository.create(booking(AT_10_00, AT_10_30));
      await repository.create(booking(AT_10_30, AT_11_00));

      await expect(
        repository.update(created.id, { startsAt: AT_10_30, endsAt: AT_11_00 }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('lets a cancelled appointment sit on top of a live one', async () => {
      const created = await repository.create(booking(AT_10_00, AT_10_30));
      await repository.create(booking(AT_10_30, AT_11_00));

      const cancelled = await repository.update(created.id, {
        status: 'cancelled',
        startsAt: AT_10_30,
        endsAt: AT_11_00,
      });

      expect(cancelled?.status).toBe('cancelled');
    });

    it('returns the row untouched when there is nothing to change', async () => {
      const created = await repository.create(booking(AT_10_00, AT_10_30));

      await expect(repository.update(created.id, {})).resolves.toMatchObject({ id: created.id });
    });
  });

  describe('findMany', () => {
    const page = { limit: 10, offset: 0 };

    beforeEach(async () => {
      await repository.create(booking(AT_10_00, AT_10_30));
      await repository.create(booking(AT_10_30, AT_11_00));
      await repository.create(
        booking(new Date('2030-03-05T10:00:00.000Z'), new Date('2030-03-05T10:30:00.000Z')),
      );
    });

    it('bounds the result to the requested range, inclusive of both ends', async () => {
      const [rows, total] = await repository.findMany({ from: AT_10_00, to: AT_10_30 }, page);

      expect(rows).toHaveLength(2);
      expect(total).toBe(2);
    });

    it('counts every match, not just the page', async () => {
      const [rows, total] = await repository.findMany(
        { from: AT_10_00, to: new Date('2030-03-06T00:00:00.000Z') },
        { limit: 2, offset: 0 },
      );

      expect(rows).toHaveLength(2);
      expect(total).toBe(3);
    });

    it('pages through in a stable order', async () => {
      const range = { from: AT_10_00, to: new Date('2030-03-06T00:00:00.000Z') };
      const [firstPage] = await repository.findMany(range, { limit: 2, offset: 0 });
      const [secondPage] = await repository.findMany(range, { limit: 2, offset: 2 });

      expect(secondPage).toHaveLength(1);
      expect(firstPage.map((row) => row.id)).not.toContain(secondPage[0].id);
      expect(secondPage[0].startsAt.toISOString()).toBe('2030-03-05T10:00:00.000Z');
    });

    it('filters by status', async () => {
      await dataSource.query(`UPDATE appointments SET status = 'completed' WHERE starts_at = $1`, [
        AT_10_00,
      ]);

      const [rows] = await repository.findMany(
        { from: AT_10_00, to: new Date('2030-03-06T00:00:00.000Z'), status: ['completed'] },
        page,
      );

      expect(rows).toHaveLength(1);
    });

    it('filters by barber', async () => {
      const other = await makeBarber(dataSource, { displayName: 'Other' });

      const [rows] = await repository.findMany(
        { from: AT_10_00, to: new Date('2030-03-06T00:00:00.000Z'), barberId: other.id },
        page,
      );

      expect(rows).toHaveLength(0);
    });
  });

  describe('findForClient', () => {
    it('returns only that client, newest first', async () => {
      const other = await makeUser(dataSource, { role: 'CLIENT', email: 'other@barber.local' });
      await repository.create(booking(AT_10_00, AT_10_30));
      await repository.create({ ...booking(AT_10_30, AT_11_00), clientId: other.id });

      const [rows, total] = await repository.findForClient(client.id, { limit: 10, offset: 0 });

      expect(total).toBe(1);
      expect(rows[0].clientId).toBe(client.id);
    });
  });

  describe('findBetween', () => {
    it('keeps cancelled appointments, because they explain the gap', async () => {
      await repository.create(booking(AT_10_00, AT_10_30));
      await dataSource.query(`UPDATE appointments SET status = 'cancelled'`);

      const found = await repository.findBetween(barber.id, AT_10_00, AT_11_00);

      expect(found).toHaveLength(1);
    });
  });
});
