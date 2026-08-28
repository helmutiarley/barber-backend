import { describe, expect, it, vi } from 'vitest';
import type { Cradle } from '../../src/container';
import type { CashRegisterSession } from '../../src/entities/cash-register-session.entity';
import { ConflictError, NotFoundError, ValidationError } from '../../src/errors/app-error';
import type { AuthenticatedUser } from '../../src/lib/actor';
import { CashRegisterService } from '../../src/services/cash-register.service';

const NOW = new Date('2030-03-10T18:00:00.000Z');
const MANAGER: AuthenticatedUser = { id: 'manager-1', role: 'MANAGER' };

const openSession = {
  id: 'session-1',
  status: 'open',
  openedBy: MANAGER.id,
  openedAt: new Date('2030-03-10T11:00:00.000Z'),
  openingBalance: 10_000,
  closedBy: null,
  closedAt: null,
  expectedBalance: null,
  countedBalance: null,
  difference: null,
  notes: null,
} as CashRegisterSession;

const closedSession = { ...openSession, id: 'session-0', status: 'closed' } as CashRegisterSession;

function drawerTotals(cashIn: number, cashOut: number) {
  return {
    in: cashIn,
    out: cashOut,
    cashIn,
    cashOut,
    discount: 0,
    byMethod: [{ method: 'cash' as const, in: cashIn, out: cashOut, discount: 0 }],
  };
}

function buildService(
  overrides: {
    appointmentsRepository?: Record<string, unknown>;
    cashRegisterSessionsRepository?: Record<string, unknown>;
    cashMovementsRepository?: Record<string, unknown>;
  } = {},
) {
  const appointmentsRepository = Object.assign(
    { countPendingClosureBetween: vi.fn().mockResolvedValue(0) },
    overrides.appointmentsRepository,
  );

  const cashRegisterSessionsRepository = Object.assign(
    {
      findOpen: vi.fn().mockResolvedValue(openSession),
      findById: vi.fn().mockResolvedValue(openSession),
      findMany: vi.fn().mockResolvedValue([[openSession], 1]),
      create: vi.fn(async (data: Record<string, unknown>) => ({ ...openSession, ...data })),
      close: vi.fn(async (_id: string, snapshot: Record<string, unknown>) => ({
        ...openSession,
        ...snapshot,
        status: 'closed',
      })),
    },
    overrides.cashRegisterSessionsRepository,
  );

  const cashMovementsRepository = Object.assign(
    {
      create: vi.fn(async (data: Record<string, unknown>) => ({
        id: 'movement-1',
        paymentId: null,
        description: null,
        discountAmount: 0,
        discountReason: null,
        createdAt: NOW,
        ...data,
      })),
      findBySession: vi.fn().mockResolvedValue([]),
      sumBySession: vi.fn().mockResolvedValue(drawerTotals(0, 0)),
    },
    overrides.cashMovementsRepository,
  );

  const cradle = {
    appointmentsRepository,
    cashRegisterSessionsRepository,
    cashMovementsRepository,
    clock: { now: () => NOW },
    config: { shopTimezone: 'America/Sao_Paulo' },
  } as unknown as Cradle;

  return {
    service: new CashRegisterService(cradle),
    appointmentsRepository,
    cashRegisterSessionsRepository,
    cashMovementsRepository,
  };
}

describe('CashRegisterService.open', () => {
  it('opens with the counted balance and the actor who opened it', async () => {
    const harness = buildService({
      cashRegisterSessionsRepository: { findOpen: vi.fn().mockResolvedValue(null) },
    });

    const session = await harness.service.open({ openingBalanceCents: 15_000 }, MANAGER);

    expect(harness.cashRegisterSessionsRepository.create).toHaveBeenCalledWith({
      openedBy: MANAGER.id,
      openedAt: NOW,
      openingBalance: 15_000,
    });
    expect(session).toMatchObject({ status: 'open', openingBalanceCents: 15_000 });
  });

  it('refuses a second drawer while one is open', async () => {
    const harness = buildService();

    await expect(
      harness.service.open({ openingBalanceCents: 15_000 }, MANAGER),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(harness.cashRegisterSessionsRepository.create).not.toHaveBeenCalled();
  });
});

describe('CashRegisterService.close', () => {
  it('snapshots expected, counted and difference over an in/out mix', async () => {
    const harness = buildService({
      cashMovementsRepository: {
        sumBySession: vi.fn().mockResolvedValue(drawerTotals(42_000, 7000)),
      },
    });

    const closed = await harness.service.close({ countedBalanceCents: 45_000 }, MANAGER);

    expect(closed).toMatchObject({
      status: 'closed',
      expectedBalanceCents: 45_000,
      countedBalanceCents: 45_000,
      differenceCents: 0,
    });
  });

  it('demands notes when the drawer does not match', async () => {
    const harness = buildService({
      cashMovementsRepository: { sumBySession: vi.fn().mockResolvedValue(drawerTotals(5000, 0)) },
    });

    await expect(
      harness.service.close({ countedBalanceCents: 14_900 }, MANAGER),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(harness.cashRegisterSessionsRepository.close).not.toHaveBeenCalled();
  });

  it('refuses to close while appointments still need payment or completion', async () => {
    const harness = buildService({
      appointmentsRepository: { countPendingClosureBetween: vi.fn().mockResolvedValue(2) },
    });

    await expect(
      harness.service.close({ countedBalanceCents: 10_000 }, MANAGER),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'PENDING_APPOINTMENTS', pendingAppointmentsCount: 2 },
    });
    expect(harness.appointmentsRepository.countPendingClosureBetween).toHaveBeenCalledWith(
      new Date('2030-03-10T03:00:00.000Z'),
      new Date('2030-03-11T03:00:00.000Z'),
    );
    expect(harness.cashRegisterSessionsRepository.close).not.toHaveBeenCalled();
  });

  it('accepts a shortfall that is explained', async () => {
    const harness = buildService({
      cashMovementsRepository: { sumBySession: vi.fn().mockResolvedValue(drawerTotals(5000, 0)) },
    });

    const closed = await harness.service.close(
      { countedBalanceCents: 14_900, notes: 'a note stuck to another' },
      MANAGER,
    );

    expect(closed).toMatchObject({ differenceCents: -100, notes: 'a note stuck to another' });
  });

  it('treats blank notes as no notes at all', async () => {
    const harness = buildService({
      cashMovementsRepository: { sumBySession: vi.fn().mockResolvedValue(drawerTotals(0, 0)) },
    });

    await expect(
      harness.service.close({ countedBalanceCents: 9900, notes: '   ' }, MANAGER),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('counts only the drawer, so pix and card cannot invent a difference', async () => {
    const harness = buildService({
      cashMovementsRepository: {
        sumBySession: vi.fn().mockResolvedValue({
          in: 42_000,
          out: 0,
          cashIn: 5000,
          cashOut: 0,
          discount: 0,
          byMethod: [
            { method: 'cash', in: 5000, out: 0, discount: 0 },
            { method: 'pix', in: 30_000, out: 0, discount: 0 },
            { method: 'credit', in: 7000, out: 0, discount: 0 },
          ],
        }),
      },
    });

    const closed = await harness.service.close({ countedBalanceCents: 15_000 }, MANAGER);

    expect(closed).toMatchObject({ expectedBalanceCents: 15_000, differenceCents: 0 });
  });

  it('refuses to close when nothing is open', async () => {
    const harness = buildService({
      cashRegisterSessionsRepository: { findOpen: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      harness.service.close({ countedBalanceCents: 10_000 }, MANAGER),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('CashRegisterService.current', () => {
  it('reports live totals rather than the close snapshot', async () => {
    const harness = buildService({
      cashMovementsRepository: {
        sumBySession: vi.fn().mockResolvedValue(drawerTotals(12_000, 2000)),
      },
    });

    const current = await harness.service.current();

    expect(current.totals).toMatchObject({
      inCents: 12_000,
      outCents: 2000,
      expectedBalanceCents: 20_000,
    });
    expect(current.pendingAppointmentsCount).toBe(0);
    expect(current.session.expectedBalanceCents).toBeNull();
  });

  it('totals every method but keeps the expected balance on the drawer alone', async () => {
    const harness = buildService({
      cashMovementsRepository: {
        sumBySession: vi.fn().mockResolvedValue({
          in: 22_000,
          out: 2000,
          cashIn: 12_000,
          cashOut: 2000,
          discount: 350,
          byMethod: [
            { method: 'cash', in: 12_000, out: 2000, discount: 0 },
            { method: 'pix', in: 10_000, out: 0, discount: 0 },
            { method: 'credit', in: 0, out: 0, discount: 350 },
          ],
        }),
      },
    });

    const current = await harness.service.current();

    expect(current.totals).toEqual({
      inCents: 22_000,
      outCents: 2000,
      discountCents: 350,
      cashInCents: 12_000,
      cashOutCents: 2000,
      expectedBalanceCents: 20_000,
      byMethod: [
        { method: 'cash', inCents: 12_000, outCents: 2000, discountCents: 0, netCents: 10_000 },
        { method: 'pix', inCents: 10_000, outCents: 0, discountCents: 0, netCents: 10_000 },
        { method: 'debit', inCents: 0, outCents: 0, discountCents: 0, netCents: 0 },
        { method: 'credit', inCents: 0, outCents: 0, discountCents: 350, netCents: 0 },
      ],
    });
  });

  it('is a miss, not a conflict, when the register is closed', async () => {
    const harness = buildService({
      cashRegisterSessionsRepository: { findOpen: vi.fn().mockResolvedValue(null) },
    });

    await expect(harness.service.current()).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('CashRegisterService.recordManualMovement', () => {
  it('records a withdrawal against the open session', async () => {
    const harness = buildService();

    const movement = await harness.service.recordManualMovement(
      { type: 'out', source: 'withdrawal', amountCents: 3000, description: 'bank deposit' },
      MANAGER,
    );

    expect(harness.cashMovementsRepository.create).toHaveBeenCalledWith(
      {
        sessionId: openSession.id,
        type: 'out',
        source: 'withdrawal',
        method: 'cash',
        amount: 3000,
        discountAmount: 0,
        discountReason: null,
        paymentId: null,
        expenseId: null,
        advanceId: null,
        periodId: null,
        description: 'bank deposit',
        createdBy: MANAGER.id,
      },
      undefined,
    );
    expect(movement).toMatchObject({ amountCents: 3000, source: 'withdrawal' });
  });

  it('refuses when no register is open', async () => {
    const harness = buildService({
      cashRegisterSessionsRepository: { findOpen: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      harness.service.recordManualMovement(
        { type: 'in', source: 'deposit', amountCents: 3000, description: 'float top-up' },
        MANAGER,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(harness.cashMovementsRepository.create).not.toHaveBeenCalled();
  });
});

describe('CashRegisterService.recordMovement', () => {
  it('is the seam other modules write cash through', async () => {
    const harness = buildService();
    const manager = {} as never;

    await harness.service.recordMovement(
      {
        sessionId: openSession.id,
        type: 'in',
        source: 'payment',
        amountCents: 4500,
        discountCents: 175,
        discountReason: 'card_processing_fee',
        paymentId: 'payment-1',
        createdBy: MANAGER.id,
      },
      manager,
    );

    expect(harness.cashMovementsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'payment-1',
        source: 'payment',
        amount: 4500,
        discountAmount: 175,
        discountReason: 'card_processing_fee',
      }),
      manager,
    );
  });

  it('refuses a movement aimed at a closed session', async () => {
    const harness = buildService({
      cashRegisterSessionsRepository: { findById: vi.fn().mockResolvedValue(closedSession) },
    });

    await expect(
      harness.service.recordMovement({
        sessionId: closedSession.id,
        type: 'in',
        source: 'payment',
        amountCents: 4500,
        createdBy: MANAGER.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(harness.cashMovementsRepository.create).not.toHaveBeenCalled();
  });
});

describe('CashRegisterService.getSession', () => {
  it('returns the session with its movements', async () => {
    const harness = buildService({
      cashRegisterSessionsRepository: { findById: vi.fn().mockResolvedValue(closedSession) },
      cashMovementsRepository: {
        findBySession: vi.fn().mockResolvedValue([
          {
            id: 'movement-1',
            sessionId: closedSession.id,
            type: 'in',
            source: 'payment',
            amount: 4500,
            discountAmount: 175,
            discountReason: 'card_processing_fee',
            paymentId: 'payment-1',
            description: null,
            createdBy: MANAGER.id,
            createdAt: NOW,
          },
        ]),
      },
    });

    const detail = await harness.service.getSession(closedSession.id);

    expect(detail.session.status).toBe('closed');
    expect(detail.movements).toHaveLength(1);
    expect(detail.movements[0]).toMatchObject({
      amountCents: 4500,
      discountCents: 175,
      discountReason: 'card_processing_fee',
      paymentId: 'payment-1',
    });
  });

  it('404s on an unknown session', async () => {
    const harness = buildService({
      cashRegisterSessionsRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(harness.service.getSession('nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});
