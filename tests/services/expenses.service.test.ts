import type { EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/config';
import type { Cradle } from '../../src/container';
import type { CashRegisterSession } from '../../src/entities/cash-register-session.entity';
import type { Expense } from '../../src/entities/expense.entity';
import { ConflictError, NotFoundError, ValidationError } from '../../src/errors/app-error';
import type { AuthenticatedUser } from '../../src/lib/actor';
import type { ExpenseChanges, PaidFields } from '../../src/repositories/expenses.repository';
import { ExpensesService } from '../../src/services/expenses.service';

const NOW = new Date('2030-03-10T18:00:00.000Z');
const MANAGER: AuthenticatedUser = { id: 'manager-1', role: 'MANAGER' };

const config = { shopTimezone: 'America/Sao_Paulo' } as AppConfig;

const pending = {
  id: 'expense-1',
  description: 'Papel toalha',
  category: 'supplies',
  kind: 'variable',
  amount: 12_000,
  dueDate: '2030-03-20',
  paidAt: null,
  paymentMethod: null,
  recurring: false,
  createdBy: MANAGER.id,
  createdAt: NOW,
} as Expense;

const paid = {
  ...pending,
  id: 'expense-2',
  paidAt: NOW,
  paymentMethod: 'pix',
} as Expense;

const openSession = { id: 'session-1', status: 'open' } as CashRegisterSession;

function buildService(
  overrides: {
    expensesRepository?: Record<string, unknown>;
    cashRegisterService?: Record<string, unknown>;
  } = {},
) {
  const expensesRepository = Object.assign(
    {
      create: vi.fn(async (data: Record<string, unknown>) => ({ ...pending, ...data })),
      findById: vi.fn().mockResolvedValue(pending),
      findMany: vi.fn().mockResolvedValue([[pending], 1]),
      update: vi.fn(async (id: string, changes: ExpenseChanges) => ({
        ...pending,
        id,
        ...changes,
      })),
      markPaid: vi.fn(async (id: string, data: PaidFields) => ({ ...pending, id, ...data })),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    overrides.expensesRepository,
  );

  const cashRegisterService = Object.assign(
    {
      requireOpenSession: vi.fn().mockResolvedValue(openSession),
      recordMovement: vi.fn().mockResolvedValue({ id: 'movement-1' }),
    },
    overrides.cashRegisterService,
  );

  const manager = { marker: 'entity-manager' } as unknown as EntityManager;
  const dataSource = {
    transaction: vi.fn(async (work: (manager: EntityManager) => Promise<unknown>) => work(manager)),
  };

  const cradle = {
    expensesRepository,
    cashRegisterService,
    dataSource,
    clock: { now: () => NOW },
    config,
  } as unknown as Cradle;

  return {
    service: new ExpensesService(cradle),
    expensesRepository,
    cashRegisterService,
    dataSource,
    manager,
  };
}

describe('ExpensesService.create', () => {
  it('leaves an expense pending when no payment method is given', async () => {
    const harness = buildService();

    const expense = await harness.service.create(
      {
        description: '  Papel toalha  ',
        category: 'supplies',
        kind: 'variable',
        amountCents: 12_000,
      },
      MANAGER,
    );

    expect(expense).toMatchObject({ paidAt: null, paymentMethod: null, amountCents: 12_000 });

    expect(harness.dataSource.transaction).not.toHaveBeenCalled();
    expect(harness.expensesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Papel toalha', createdBy: MANAGER.id }),
    );
  });

  it('pays inline down the same path as /pay when a method is given', async () => {
    const harness = buildService();

    const expense = await harness.service.create(
      {
        description: 'Aluguel',
        category: 'rent',
        kind: 'fixed',
        amountCents: 250_000,
        paymentMethod: 'cash',
      },
      MANAGER,
    );

    expect(expense.paymentMethod).toBe('cash');
    expect(harness.dataSource.transaction).toHaveBeenCalledTimes(1);

    expect(harness.expensesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ paidAt: NOW, paymentMethod: 'cash' }),
      harness.manager,
    );
    expect(harness.cashRegisterService.recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'out', source: 'expense', expenseId: pending.id }),
      harness.manager,
    );
  });

  it('writes nothing at all when the drawer is closed', async () => {
    const harness = buildService({
      cashRegisterService: {
        requireOpenSession: vi
          .fn()
          .mockRejectedValue(new ConflictError('No cash register session is open')),
      },
    });

    await expect(
      harness.service.create(
        {
          description: 'Café e copos',
          category: 'supplies',
          kind: 'variable',
          amountCents: 7500,
          paymentMethod: 'cash',
        },
        MANAGER,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(harness.expensesRepository.create).not.toHaveBeenCalled();
  });
});

describe('ExpensesService.pay', () => {
  it('writes the expense and its cash movement through one transaction', async () => {
    const harness = buildService();

    await harness.service.pay(pending.id, { paymentMethod: 'cash' }, MANAGER);

    expect(harness.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(harness.cashRegisterService.requireOpenSession).toHaveBeenCalledWith(harness.manager);
    expect(harness.expensesRepository.markPaid).toHaveBeenCalledWith(
      pending.id,
      { paidAt: NOW, paymentMethod: 'cash' },
      harness.manager,
    );
    expect(harness.cashRegisterService.recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: openSession.id,
        type: 'out',
        source: 'expense',
        amountCents: pending.amount,
        expenseId: pending.id,
      }),
      harness.manager,
    );
  });

  it('leaves the drawer alone for a pix payment', async () => {
    const harness = buildService();

    await harness.service.pay(pending.id, { paymentMethod: 'pix' }, MANAGER);

    expect(harness.cashRegisterService.requireOpenSession).not.toHaveBeenCalled();
    expect(harness.cashRegisterService.recordMovement).not.toHaveBeenCalled();
  });

  it('refuses to pay the same expense twice', async () => {
    const harness = buildService({
      expensesRepository: { findById: vi.fn().mockResolvedValue(paid) },
    });

    await expect(
      harness.service.pay(paid.id, { paymentMethod: 'pix' }, MANAGER),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(harness.expensesRepository.markPaid).not.toHaveBeenCalled();
  });

  it('refuses the loser of a race, even though both passed the first check', async () => {
    const harness = buildService({

      expensesRepository: { markPaid: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      harness.service.pay(pending.id, { paymentMethod: 'pix' }, MANAGER),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses cash when no register is open, and writes nothing', async () => {
    const harness = buildService({
      cashRegisterService: {
        requireOpenSession: vi
          .fn()
          .mockRejectedValue(new ConflictError('No cash register session is open')),
      },
    });

    await expect(
      harness.service.pay(pending.id, { paymentMethod: 'cash' }, MANAGER),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(harness.expensesRepository.markPaid).not.toHaveBeenCalled();
  });

  it('refuses a backdated cash payment', async () => {
    const harness = buildService();

    await expect(
      harness.service.pay(
        pending.id,
        { paymentMethod: 'cash', paidAt: new Date('2030-03-09T18:00:00.000Z') },
        MANAGER,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts a backdated pix — bookkeeping catching up is not a lie', async () => {
    const harness = buildService();
    const threeDaysAgo = new Date('2030-03-07T18:00:00.000Z');

    await harness.service.pay(pending.id, { paymentMethod: 'pix', paidAt: threeDaysAgo }, MANAGER);

    expect(harness.expensesRepository.markPaid).toHaveBeenCalledWith(
      pending.id,
      { paidAt: threeDaysAgo, paymentMethod: 'pix' },
      harness.manager,
    );
  });

  it('refuses a future payment whatever the method', async () => {
    const harness = buildService();
    const tomorrow = new Date('2030-03-11T18:00:00.000Z');

    await expect(
      harness.service.pay(pending.id, { paymentMethod: 'pix', paidAt: tomorrow }, MANAGER),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      harness.service.pay(pending.id, { paymentMethod: 'cash', paidAt: tomorrow }, MANAGER),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('404s on an expense that does not exist', async () => {
    const harness = buildService({
      expensesRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      harness.service.pay('missing', { paymentMethod: 'pix' }, MANAGER),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ExpensesService.update', () => {
  it('accepts anything while the expense is pending', async () => {
    const harness = buildService();

    const updated = await harness.service.update(pending.id, {
      amountCents: 15_000,
      dueDate: '2030-04-01',
    });

    expect(updated.amountCents).toBe(15_000);
    expect(harness.expensesRepository.update).toHaveBeenCalledWith(pending.id, {
      amount: 15_000,
      dueDate: '2030-04-01',
    });
  });

  it('lets a paid expense be re-described and re-categorised', async () => {
    const harness = buildService({
      expensesRepository: { findById: vi.fn().mockResolvedValue(paid) },
    });

    await harness.service.update(paid.id, { description: 'Aluguel — março', category: 'rent' });

    expect(harness.expensesRepository.update).toHaveBeenCalledWith(paid.id, {
      description: 'Aluguel — março',
      category: 'rent',
    });
  });

  it('freezes the money fields once paid, naming what it refused', async () => {
    const harness = buildService({
      expensesRepository: { findById: vi.fn().mockResolvedValue(paid) },
    });

    const failure = await harness.service
      .update(paid.id, { amountCents: 1, dueDate: '2030-04-01' })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ConflictError);
    expect((failure as ConflictError).details).toEqual({ fields: ['amountCents', 'dueDate'] });
    expect(harness.expensesRepository.update).not.toHaveBeenCalled();
  });
});

describe('ExpensesService.remove', () => {
  it('deletes a pending expense', async () => {
    const harness = buildService();

    await harness.service.remove(pending.id);

    expect(harness.expensesRepository.delete).toHaveBeenCalledWith(pending.id);
  });

  it('refuses to delete a paid one', async () => {
    const harness = buildService({
      expensesRepository: { findById: vi.fn().mockResolvedValue(paid) },
    });

    await expect(harness.service.remove(paid.id)).rejects.toBeInstanceOf(ConflictError);
    expect(harness.expensesRepository.delete).not.toHaveBeenCalled();
  });
});

describe('ExpensesService overdue', () => {
  it('is false the day the expense falls due and true the day after', async () => {

    const onTime = buildService({
      expensesRepository: {
        findById: vi.fn().mockResolvedValue({ ...pending, dueDate: '2030-03-10' }),
      },
    });
    const late = buildService({
      expensesRepository: {
        findById: vi.fn().mockResolvedValue({ ...pending, dueDate: '2030-03-09' }),
      },
    });

    expect((await onTime.service.get(pending.id)).overdue).toBe(false);
    expect((await late.service.get(pending.id)).overdue).toBe(true);
  });

  it('is never true for a paid expense, however late it was', async () => {
    const harness = buildService({
      expensesRepository: {
        findById: vi.fn().mockResolvedValue({ ...paid, dueDate: '2029-01-01' }),
      },
    });

    expect((await harness.service.get(paid.id)).overdue).toBe(false);
  });

  it('hands the repository today as a shop-local date so the filter compares dates', async () => {
    const harness = buildService();

    await harness.service.list({ overdue: true, limit: 20, offset: 0 });

    expect(harness.expensesRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ overdue: true, today: '2030-03-10' }),
      { limit: 20, offset: 0 },
    );
  });
});
