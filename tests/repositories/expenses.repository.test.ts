import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CashMovementsRepository } from '../../src/repositories/cash-movements.repository';
import { ExpensesRepository } from '../../src/repositories/expenses.repository';
import { getTestDataSource, truncateAll } from '../support/db';
import { makeExpense, makeSession, makeUser, withTestShop } from '../support/factories';

const PAGE = { limit: 50, offset: 0 };

describe('expenses repository', () => {
  let dataSource: DataSource;
  let repository: ExpensesRepository;
  let movements: CashMovementsRepository;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    repository = new ExpensesRepository(withTestShop(dataSource));
    movements = new CashMovementsRepository(withTestShop(dataSource));
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
  });

  it('round-trips a due date as a calendar date, not an instant', async () => {
    const manager = await makeUser(dataSource, { role: 'MANAGER' });

    const created = await repository.create({
      description: 'Aluguel',
      category: 'rent',
      kind: 'fixed',
      amount: 250_000,
      dueDate: '2030-01-01',
      paidAt: null,
      paymentMethod: null,
      recurring: true,
      createdBy: manager.id,
    });

    expect((await repository.findById(created.id))?.dueDate).toBe('2030-01-01');
    expect(created.amount).toBe(250_000);
  });

  it('keeps the amount in cents through an update', async () => {
    const expense = await makeExpense(dataSource, { amount: 3333 });

    const updated = await repository.update(expense.id, { amount: 12_345 });

    expect(updated?.amount).toBe(12_345);
  });

  describe('findMany', () => {
    it('keeps only past-due pending rows when asked for the overdue ones', async () => {
      const overdue = await makeExpense(dataSource, {
        description: 'past due',
        dueDate: '2030-01-10',
      });
      await makeExpense(dataSource, { description: 'due later', dueDate: '2030-02-20' });
      await makeExpense(dataSource, {
        description: 'paid but past due',
        dueDate: '2030-01-05',
        paidAt: new Date('2030-01-04T12:00:00.000Z'),
        paymentMethod: 'pix',
      });

      const [rows, total] = await repository.findMany({ overdue: true, today: '2030-01-15' }, PAGE);

      expect(total).toBe(1);
      expect(rows.map((row) => row.id)).toEqual([overdue.id]);
    });

    it('treats the due date itself as still on time', async () => {
      await makeExpense(dataSource, { dueDate: '2030-01-15' });

      const [, total] = await repository.findMany({ overdue: true, today: '2030-01-15' }, PAGE);

      expect(total).toBe(0);
    });

    it('splits paid from pending', async () => {
      await makeExpense(dataSource, { description: 'pending' });
      const paid = await makeExpense(dataSource, {
        description: 'paid',
        paidAt: new Date('2030-03-01T12:00:00.000Z'),
        paymentMethod: 'cash',
      });

      const [pendingRows] = await repository.findMany({ paid: false }, PAGE);
      const [paidRows] = await repository.findMany({ paid: true }, PAGE);

      expect(pendingRows.map((row) => row.description)).toEqual(['pending']);
      expect(paidRows.map((row) => row.id)).toEqual([paid.id]);
    });

    it('bounds the paid-at range inclusively and ignores pending rows', async () => {
      const inside = await makeExpense(dataSource, {
        paidAt: new Date('2030-03-10T12:00:00.000Z'),
        paymentMethod: 'pix',
      });
      await makeExpense(dataSource, {
        paidAt: new Date('2030-04-02T12:00:00.000Z'),
        paymentMethod: 'pix',
      });
      await makeExpense(dataSource, { description: 'never paid' });

      const [rows, total] = await repository.findMany(
        { from: new Date('2030-03-01T00:00:00.000Z'), to: new Date('2030-03-31T23:59:59.999Z') },
        PAGE,
      );

      expect(total).toBe(1);
      expect(rows[0].id).toBe(inside.id);
    });

    it('filters by category and by kind', async () => {
      await makeExpense(dataSource, { category: 'rent', kind: 'fixed' });
      await makeExpense(dataSource, { category: 'supplies', kind: 'variable' });

      const [byCategory] = await repository.findMany({ category: 'rent' }, PAGE);
      const [byKind] = await repository.findMany({ kind: 'variable' }, PAGE);

      expect(byCategory.map((row) => row.category)).toEqual(['rent']);
      expect(byKind.map((row) => row.kind)).toEqual(['variable']);
    });

    it('reads soonest due first, undated last, and pages', async () => {
      await makeExpense(dataSource, { description: 'later', dueDate: '2030-05-01' });
      await makeExpense(dataSource, { description: 'undated' });
      await makeExpense(dataSource, { description: 'soonest', dueDate: '2030-01-01' });

      const [first, total] = await repository.findMany({}, { limit: 2, offset: 0 });
      const [second] = await repository.findMany({}, { limit: 2, offset: 2 });

      expect(total).toBe(3);
      expect(first.map((row) => row.description)).toEqual(['soonest', 'later']);
      expect(second.map((row) => row.description)).toEqual(['undated']);
    });
  });

  it('settles a pending expense once and refuses the second attempt', async () => {
    const expense = await makeExpense(dataSource);
    const paid = { paidAt: new Date(), paymentMethod: 'pix' } as const;

    const first = await repository.markPaid(expense.id, paid);
    const second = await repository.markPaid(expense.id, { ...paid, paymentMethod: 'cash' });

    expect(first?.paymentMethod).toBe('pix');

    expect(second).toBeNull();
    expect((await repository.findById(expense.id))?.paymentMethod).toBe('pix');
  });

  it('deletes a pending expense', async () => {
    const expense = await makeExpense(dataSource);

    await repository.delete(expense.id);

    expect(await repository.findById(expense.id)).toBeNull();
  });

  it('lets a movement name the expense that emptied the drawer', async () => {
    const session = await makeSession(dataSource);
    const expense = await makeExpense(dataSource);

    const movement = await movements.create({
      sessionId: session.id,
      type: 'out',
      source: 'expense',
      amount: expense.amount,
      expenseId: expense.id,
      createdBy: session.openedBy,
    });

    expect(movement).toMatchObject({ expenseId: expense.id, paymentId: null });
  });
});
