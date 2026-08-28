import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError } from '../../src/errors/app-error';
import { CashMovementsRepository } from '../../src/repositories/cash-movements.repository';
import { CashRegisterSessionsRepository } from '../../src/repositories/cash-register-sessions.repository';
import { getTestDataSource, truncateAll } from '../support/db';
import { makeMovement, makeSession, makeUser, withTestShop } from '../support/factories';

const PAGE = { limit: 50, offset: 0 };

describe('cash register repositories', () => {
  let dataSource: DataSource;
  let sessions: CashRegisterSessionsRepository;
  let movements: CashMovementsRepository;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    sessions = new CashRegisterSessionsRepository(withTestShop(dataSource));
    movements = new CashMovementsRepository(withTestShop(dataSource));
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

      expect(await movements.sumBySession(session.id)).toEqual({
        in: 7500,
        out: 2000,
        cashIn: 7500,
        cashOut: 2000,
        discount: 0,
        byMethod: [{ method: 'cash', in: 7500, out: 2000, discount: 0 }],
      });
    });

    it('splits the totals by method, keeping the drawer on its own', async () => {
      const session = await makeSession(dataSource);
      await makeMovement(dataSource, { sessionId: session.id, type: 'in', amount: 4500 });
      await makeMovement(dataSource, {
        sessionId: session.id,
        type: 'in',
        method: 'pix',
        amount: 3000,
      });
      await makeMovement(dataSource, {
        sessionId: session.id,
        type: 'in',
        method: 'credit',
        amount: 4825,
        discountAmount: 175,
        discountReason: 'card_processing_fee',
      });
      await makeMovement(dataSource, {
        sessionId: session.id,
        type: 'out',
        source: 'withdrawal',
        amount: 2000,
      });

      const totals = await movements.sumBySession(session.id);

      expect(totals).toMatchObject({
        in: 12_325,
        out: 2000,
        cashIn: 4500,
        cashOut: 2000,
        discount: 175,
      });
      expect(totals.byMethod).toEqual(
        expect.arrayContaining([
          { method: 'cash', in: 4500, out: 2000, discount: 0 },
          { method: 'pix', in: 3000, out: 0, discount: 0 },
          { method: 'credit', in: 4825, out: 0, discount: 175 },
        ]),
      );
    });

    it('reports zero for a session nothing has moved through', async () => {
      const session = await makeSession(dataSource);

      expect(await movements.sumBySession(session.id)).toEqual({
        in: 0,
        out: 0,
        cashIn: 0,
        cashOut: 0,
        discount: 0,
        byMethod: [],
      });
    });

    it('compensates the card discount when a payment is voided', async () => {
      const session = await makeSession(dataSource);
      const movement = {
        sessionId: session.id,
        source: 'payment' as const,
        method: 'credit' as const,
        amount: 4825,
        discountAmount: 175,
        discountReason: 'card_processing_fee' as const,
      };

      await makeMovement(dataSource, { ...movement, type: 'in' });
      await makeMovement(dataSource, { ...movement, type: 'out' });

      expect(await movements.sumBySession(session.id)).toEqual({
        in: 4825,
        out: 4825,
        cashIn: 0,
        cashOut: 0,
        discount: 0,
        byMethod: [{ method: 'credit', in: 4825, out: 4825, discount: 0 }],
      });
    });

    it('counts only its own session', async () => {
      const yesterday = await makeSession(dataSource, { status: 'closed' });
      const today = await makeSession(dataSource);
      await makeMovement(dataSource, { sessionId: yesterday.id, amount: 9999 });
      await makeMovement(dataSource, { sessionId: today.id, amount: 1000 });

      expect(await movements.sumBySession(today.id)).toEqual({
        in: 1000,
        out: 0,
        cashIn: 1000,
        cashOut: 0,
        discount: 0,
        byMethod: [{ method: 'cash', in: 1000, out: 0, discount: 0 }],
      });
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
