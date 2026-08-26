import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { User } from '../../src/entities/user.entity';
import { ClientProfilesRepository } from '../../src/repositories/client-profiles.repository';
import { getTestDataSource, truncateAll } from '../support/db';
import {
  makeAppointment,
  makeClientProfile,
  makeUser,
  withTestShop,
} from '../support/factories';

const PAGE = { limit: 50, offset: 0 };
const LAST_MONTH = new Date('2030-02-01T13:00:00.000Z');
const LAST_YEAR = new Date('2029-03-01T13:00:00.000Z');
const CUTOFF = new Date('2030-01-01T00:00:00.000Z');

describe('ClientProfilesRepository', () => {
  let dataSource: DataSource;
  let repository: ClientProfilesRepository;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    repository = new ClientProfilesRepository(withTestShop(dataSource));
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
  });

  function client(overrides: Partial<User> = {}): Promise<User> {
    return makeUser(dataSource, { role: 'CLIENT', ...overrides });
  }

  describe('upsert', () => {
    it('creates the row on the first write', async () => {
      const user = await client();

      const created = await repository.upsert(user.id, { preferences: 'máquina 2 na lateral' });

      expect(created.id).toBeTruthy();
      expect(created.preferences).toBe('máquina 2 na lateral');
      expect(created.birthday).toBeNull();
      expect(await repository.findByUserId(user.id)).toMatchObject({ id: created.id });
    });

    it('updates in place instead of creating a second row', async () => {
      const user = await client();
      const created = await repository.upsert(user.id, { preferences: 'fade' });

      const updated = await repository.upsert(user.id, { internalNotes: 'always late' });

      expect(updated.id).toBe(created.id);
      expect(updated.preferences).toBe('fade');
      expect(updated.internalNotes).toBe('always late');
    });

    it('leaves absent fields alone but honours an explicit null', async () => {
      const user = await client();
      await repository.upsert(user.id, { preferences: 'fade', internalNotes: 'no small talk' });

      const updated = await repository.upsert(user.id, { preferences: null });

      expect(updated.preferences).toBeNull();
      expect(updated.internalNotes).toBe('no small talk');
    });

    it('round-trips a birthday as a calendar date, not an instant', async () => {
      const user = await client();

      await repository.upsert(user.id, { birthday: '1990-01-01' });

      expect((await repository.findByUserId(user.id))?.birthday).toBe('1990-01-01');
    });
  });

  describe('findMany', () => {
    it('returns clients with and without a profile, and no staff', async () => {
      const withProfile = await client({ name: 'Ana' });
      await makeClientProfile(dataSource, { userId: withProfile.id, preferences: 'fade' });
      await client({ name: 'Bruno' });
      await makeUser(dataSource, { name: 'Zé', role: 'BARBER' });

      const [rows, total] = await repository.findMany({}, PAGE);

      expect(total).toBe(2);
      expect(rows.map((row) => row.name)).toEqual(['Ana', 'Bruno']);
      expect(rows[0].preferences).toBe('fade');
      expect(rows[1].preferences).toBeNull();
    });

    it('includes deactivated clients, because history outlives the account', async () => {
      await client({ name: 'Lúcia', active: false });

      const [rows] = await repository.findMany({}, PAGE);

      expect(rows).toHaveLength(1);
      expect(rows[0].active).toBe(false);
    });

    it('paginates with a total that ignores the page', async () => {
      await client({ name: 'Ana' });
      await client({ name: 'Bruno' });
      await client({ name: 'Carla' });

      const [rows, total] = await repository.findMany({}, { limit: 2, offset: 2 });

      expect(total).toBe(3);
      expect(rows.map((row) => row.name)).toEqual(['Carla']);
    });

    it('searches by name, email and phone alike', async () => {
      await client({ name: 'Ana Souza', email: 'ana@test.local', phone: '+5511999990000' });
      await client({ name: 'Bruno Lima', email: 'bruno@test.local', phone: '+5511888880000' });

      const byName = await repository.findMany({ search: 'souza' }, PAGE);
      const byEmail = await repository.findMany({ search: 'bruno@test' }, PAGE);
      const byPhone = await repository.findMany({ search: '99999' }, PAGE);

      expect(byName[0].map((row) => row.name)).toEqual(['Ana Souza']);
      expect(byEmail[0].map((row) => row.name)).toEqual(['Bruno Lima']);
      expect(byPhone[0].map((row) => row.name)).toEqual(['Ana Souza']);
    });

    it('treats a wildcard in the search box as a character', async () => {
      await client({ name: 'Ana' });

      const [rows] = await repository.findMany({ search: '%' }, PAGE);

      expect(rows).toEqual([]);
    });

    it('filters by birthday month whatever the year', async () => {
      const march = await client({ name: 'Ana' });
      const july = await client({ name: 'Bruno' });
      await client({ name: 'Carla' });
      await makeClientProfile(dataSource, { userId: march.id, birthday: '1988-03-14' });
      await makeClientProfile(dataSource, { userId: july.id, birthday: '1995-07-02' });

      const [rows, total] = await repository.findMany({ birthdayMonth: 3 }, PAGE);

      expect(total).toBe(1);
      expect(rows[0].name).toBe('Ana');
      expect(rows[0].birthday).toBe('1988-03-14');
    });

    it('keeps the client whose last completed cut predates the cutoff', async () => {
      const lapsed = await client({ name: 'Ana' });
      const regular = await client({ name: 'Bruno' });
      await makeAppointment(dataSource, {
        clientId: lapsed.id,
        startsAt: LAST_YEAR,
        status: 'completed',
      });
      await makeAppointment(dataSource, {
        clientId: regular.id,
        startsAt: LAST_MONTH,
        status: 'completed',
      });

      const [rows] = await repository.findMany({ inactiveSince: CUTOFF }, PAGE);

      expect(rows.map((row) => row.name)).toEqual(['Ana']);
    });

    it('does not count a recent no-show as a visit', async () => {
      const noShow = await client({ name: 'Ana' });
      await makeAppointment(dataSource, {
        clientId: noShow.id,
        startsAt: LAST_MONTH,
        status: 'no_show',
      });

      const [rows] = await repository.findMany({ inactiveSince: CUTOFF }, PAGE);

      expect(rows.map((row) => row.name)).toEqual(['Ana']);
    });
  });

  describe('findStats', () => {
    it('counts only the statuses it claims to', async () => {
      const user = await client();
      const completed = { clientId: user.id, status: 'completed' as const };
      await makeAppointment(dataSource, { ...completed, startsAt: LAST_YEAR, price: 3000 });
      await makeAppointment(dataSource, { ...completed, startsAt: LAST_MONTH, price: 4500 });
      await makeAppointment(dataSource, {
        clientId: user.id,
        status: 'no_show',
        startsAt: new Date('2030-02-10T13:00:00.000Z'),
      });
      await makeAppointment(dataSource, {
        clientId: user.id,
        status: 'cancelled',
        startsAt: new Date('2030-02-11T13:00:00.000Z'),
      });

      const stats = await repository.findStats(user.id);

      expect(stats.visits).toBe(2);
      expect(stats.noShows).toBe(1);
      expect(stats.lastVisitAt?.toISOString()).toBe(LAST_MONTH.toISOString());
      expect(stats.averageTicket).toBe(3750);
    });

    it('averages to whole cents rather than a repeating decimal', async () => {
      const user = await client();
      const completed = { clientId: user.id, status: 'completed' as const };
      await makeAppointment(dataSource, { ...completed, startsAt: LAST_YEAR, price: 1000 });
      await makeAppointment(dataSource, { ...completed, startsAt: LAST_MONTH, price: 1001 });

      expect((await repository.findStats(user.id)).averageTicket).toBe(1001);
    });

    it('reports an empty history without inventing a zero ticket', async () => {
      const user = await client();

      expect(await repository.findStats(user.id)).toEqual({
        visits: 0,
        lastVisitAt: null,
        averageTicket: null,
        noShows: 0,
      });
    });

    it('ignores appointments belonging to another client', async () => {
      const user = await client();
      const other = await client();
      await makeAppointment(dataSource, {
        clientId: other.id,
        status: 'completed',
        startsAt: LAST_MONTH,
      });

      expect((await repository.findStats(user.id)).visits).toBe(0);
    });
  });
});
