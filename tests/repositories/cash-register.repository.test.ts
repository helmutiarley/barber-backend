import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Cradle } from '../../src/container';
import { ConflictError } from '../../src/errors/app-error';
import { CashMovementsRepository } from '../../src/repositories/cash-movements.repository';
import { CashRegisterSessionsRepository } from '../../src/repositories/cash-register-sessions.repository';
import { getTestDataSource, truncateAll } from '../support/db';
import { makeMovement, makeSession, makeUser } from '../support/factories';

const PAGE = { limit: 50, offset: 0 };

describe('cash register repositories', () => {
  let dataSource: DataSource;
  let sessions: CashRegisterSessionsRepository;
  let movements: CashMovementsRepository;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    sessions = new CashRegisterSessionsRepository({ dataSource } as Cradle);
    movements = new CashMovementsRepository({ dataSource } as Cradle);
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
  });

  describe('sessions', () => {
    it('finds the open session and stops finding it after close', async () => {
      const manager = await makeUser(dataSource, { role: 'MANAGER' });
      const session = await sessions.create({
        openedBy: manager.id,
        openedAt: new Date(),
        openingBalance: 20_000,
      });

      expect(await sessions.findOpen()).toMatchObject({ id: session.id, openingBalance: 20_000 });

      await sessions.close(session.id, {
        closedBy: manager.id,
        closedAt: new Date(),
        expectedBalance: 20_000,
        countedBalance: 19_500,
        difference: -500,
        notes: 'came up short',
      });

      expect(await sessions.findOpen()).toBeNull();
    });

    it('refuses a second open session at the index, not only in the service', async () => {
      const manager = await makeUser(dataSource, { role: 'MANAGER' });
      await makeSession(dataSource, { openedBy: manager.id });

      await expect(
        sessions.create({ openedBy: manager.id, openedAt: new Date(), openingBalance: 5000 }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('allows a new session once the previous one is closed', async () => {
      const manager = await makeUser(dataSource, { role: 'MANAGER' });
      const first = await makeSession(dataSource, { openedBy: manager.id });
      await sessions.close(first.id, {
        closedBy: manager.id,
        closedAt: new Date(),
        expectedBalance: 10_000,
        countedBalance: 10_000,
        difference: 0,
        notes: null,
      });

      const second = await sessions.create({
        openedBy: manager.id,
        openedAt: new Date(),
        openingBalance: 10_000,
      });

      expect(second.status).toBe('open');
    });

    it('keeps the close snapshot as written, in cents', async () => {
      const manager = await makeUser(dataSource, { role: 'MANAGER' });
      const session = await makeSession(dataSource, { openedBy: manager.id });

      const closed = await sessions.close(session.id, {
        closedBy: manager.id,
        closedAt: new Date(),
        expectedBalance: 33_333,
        countedBalance: 33_300,
        difference: -33,
        notes: 'a few coins missing',
      });

      expect(closed).toMatchObject({
        status: 'closed',
        expectedBalance: 33_333,
        countedBalance: 33_300,
        difference: -33,
      });
    });

    it('lists sessions inside a date range, newest first', async () => {
      const manager = await makeUser(dataSource, { role: 'MANAGER' });
      const old = await makeSession(dataSource, {
        openedBy: manager.id,
        status: 'closed',
        openedAt: new Date('2030-01-05T12:00:00.000Z'),
      });
      const recent = await makeSession(dataSource, {
        openedBy: manager.id,
        status: 'closed',
        openedAt: new Date('2030-02-05T12:00:00.000Z'),
      });
      await makeSession(dataSource, {
        openedBy: manager.id,
        openedAt: new Date('2029-12-01T12:00:00.000Z'),
      });

      const [rows, total] = await sessions.findMany(
        { from: new Date('2030-01-01T00:00:00.000Z'), to: new Date('2030-03-01T00:00:00.000Z') },
        PAGE,
      );

      expect(total).toBe(2);
      expect(rows.map((row) => row.id)).toEqual([recent.id, old.id]);
    });
  });

  describe('movements', () => {
    it('sums both directions in one read', async () => {
      const session = await makeSession(dataSource);
      await makeMovement(dataSource, { sessionId: session.id, type: 'in', amount: 4500 });
      await makeMovement(dataSource, { sessionId: session.id, type: 'in', amount: 3000 });
      await makeMovement(dataSource, {
        sessionId: session.id,
        type: 'out',
        source: 'withdrawal',
        amount: 2000,
      });

      expect(await movements.sumBySession(session.id)).toEqual({ in: 7500, out: 2000 });
    });

    it('reports zero for a session nothing has moved through', async () => {
      const session = await makeSession(dataSource);

      expect(await movements.sumBySession(session.id)).toEqual({ in: 0, out: 0 });
    });

    it('counts only its own session', async () => {
      const yesterday = await makeSession(dataSource, { status: 'closed' });
      const today = await makeSession(dataSource);
      await makeMovement(dataSource, { sessionId: yesterday.id, amount: 9999 });
      await makeMovement(dataSource, { sessionId: today.id, amount: 1000 });

      expect(await movements.sumBySession(today.id)).toEqual({ in: 1000, out: 0 });
    });

    it('lists a session in the order the money moved', async () => {
      const session = await makeSession(dataSource);
      await makeMovement(dataSource, { sessionId: session.id, description: 'first' });
      await makeMovement(dataSource, { sessionId: session.id, description: 'second' });

      const rows = await movements.findBySession(session.id);

      expect(rows.map((row) => row.description)).toEqual(['first', 'second']);
    });
  });
});
