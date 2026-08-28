import type { EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/config';
import type { Cradle } from '../../src/container';
import type { Appointment } from '../../src/entities/appointment.entity';
import type { CashRegisterSession } from '../../src/entities/cash-register-session.entity';
import type { Payment } from '../../src/entities/payment.entity';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../src/errors/app-error';
import type { AuthenticatedUser } from '../../src/lib/actor';
import type { NewPayment } from '../../src/repositories/payments.repository';
import { PaymentsService } from '../../src/services/payments.service';

const NOW = new Date('2030-03-10T18:00:00.000Z');
const MANAGER: AuthenticatedUser = { id: 'manager-1', role: 'MANAGER' };
const BARBER_ACTOR: AuthenticatedUser = { id: 'barber-user-1', role: 'BARBER' };
const CLIENT_ACTOR: AuthenticatedUser = { id: 'client-1', role: 'CLIENT' };

const config = {
  shopTimezone: 'America/Sao_Paulo',
  cardFeeRates: { debit: 0.015, credit: 0.035 },
} as AppConfig;

const appointment = {
  id: 'appointment-1',
  clientId: CLIENT_ACTOR.id,
  barberId: 'barber-1',
  status: 'completed',
  price: 5000,
} as Appointment;

const openSession = { id: 'session-1', status: 'open' } as CashRegisterSession;

const cashPayment = {
  id: 'payment-1',
  appointmentId: appointment.id,
  amount: 5000,
  method: 'cash',
  cardFee: 0,
  netAmount: 5000,
  cashRegisterSessionId: openSession.id,
  receivedBy: MANAGER.id,
  paidAt: NOW,
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
} as Payment;

function buildService(
  overrides: {
    paymentsRepository?: Record<string, unknown>;
    appointmentsRepository?: Record<string, unknown>;
    barbersRepository?: Record<string, unknown>;
    cashRegisterService?: Record<string, unknown>;
    commissionsService?: Record<string, unknown>;
  } = {},
) {
  const paymentsRepository = Object.assign(
    {
      create: vi.fn(async (rows: NewPayment[]) =>
        rows.map((row, index) => ({ ...cashPayment, ...row, id: `payment-${index + 1}` })),
      ),
      findById: vi.fn().mockResolvedValue(cashPayment),
      findByAppointment: vi.fn().mockResolvedValue([cashPayment]),
      findMany: vi.fn().mockResolvedValue([[cashPayment], 1]),
      sumPaidForAppointment: vi.fn().mockResolvedValue(0),
      void: vi.fn(async (_id: string, data: Record<string, unknown>) => ({
        ...cashPayment,
        ...data,
      })),
    },
    overrides.paymentsRepository,
  );

  const appointmentsRepository = Object.assign(
    { findById: vi.fn().mockResolvedValue(appointment) },
    overrides.appointmentsRepository,
  );

  const barbersRepository = Object.assign(
    { findById: vi.fn().mockResolvedValue({ id: 'barber-1', userId: BARBER_ACTOR.id }) },
    overrides.barbersRepository,
  );

  const cashRegisterService = Object.assign(
    {
      requireOpenSession: vi.fn().mockResolvedValue(openSession),
      recordMovement: vi.fn().mockResolvedValue({ id: 'movement-1' }),
    },
    overrides.cashRegisterService,
  );

  const commissionsService = Object.assign(
    {
      recalculateNetBase: vi.fn().mockResolvedValue(null),
      assertAppointmentUnsettled: vi.fn().mockResolvedValue(undefined),
    },
    overrides.commissionsService,
  );

  const manager = { marker: 'entity-manager' } as unknown as EntityManager;
  const dataSource = {
    transaction: vi.fn(async (work: (manager: EntityManager) => Promise<unknown>) => work(manager)),
  };

  const cradle = {
    paymentsRepository,
    appointmentsRepository,
    barbersRepository,
    cashRegisterService,
    commissionsService,
    dataSource,
    clock: { now: () => NOW },
    config,
  } as unknown as Cradle;

  return {
    service: new PaymentsService(cradle),
    paymentsRepository,
    appointmentsRepository,
    barbersRepository,
    cashRegisterService,
    commissionsService,
    dataSource,
    manager,
  };
}

describe('PaymentsService.recordPayments', () => {
  it('snapshots the card fee and the net amount', async () => {
    const harness = buildService();

    const [payment] = await harness.service.recordPayments(
      appointment.id,
      [{ amountCents: 5000, method: 'credit' }],
      MANAGER,
    );

    expect(payment).toMatchObject({ cardFeeCents: 175, netAmountCents: 4825 });
  });

  it('rounds a half-cent fee up, keeping money in whole cents', async () => {
    const harness = buildService();

    await harness.service.recordPayments(
      appointment.id,

      [{ amountCents: 3010, method: 'debit' }],
      MANAGER,
    );

    const [rows] = harness.paymentsRepository.create.mock.calls[0] as [NewPayment[]];
    expect(rows[0]).toMatchObject({ cardFee: 45, netAmount: 2965 });
    expect(Number.isInteger(rows[0]?.cardFee)).toBe(true);
  });

  it('charges no fee on cash or Pix', async () => {
    const harness = buildService();

    const payments = await harness.service.recordPayments(
      appointment.id,
      [
        { amountCents: 2500, method: 'cash' },
        { amountCents: 2500, method: 'pix' },
      ],
      MANAGER,
    );

    expect(payments.map((payment) => payment.cardFeeCents)).toEqual([0, 0]);
  });

  it('writes the split and its cash movement through one transaction', async () => {
    const harness = buildService();

    await harness.service.recordPayments(
      appointment.id,
      [
        { amountCents: 3000, method: 'cash' },
        { amountCents: 2000, method: 'credit' },
      ],
      MANAGER,
    );

    expect(harness.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(harness.paymentsRepository.create).toHaveBeenCalledWith(
      expect.any(Array),
      harness.manager,
    );

    expect(harness.cashRegisterService.recordMovement).toHaveBeenCalledTimes(2);
    expect(harness.cashRegisterService.recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'in',
        source: 'payment',
        method: 'cash',
        amountCents: 3000,
      }),
      harness.manager,
    );
    expect(harness.cashRegisterService.recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'in',
        source: 'payment',
        method: 'credit',
        amountCents: 1930,
        discountCents: 70,
        discountReason: 'card_processing_fee',
      }),
      harness.manager,
    );
  });

  it('corrects a net commission in the same transaction the payment lands in', async () => {
    const harness = buildService();

    await harness.service.recordPayments(
      appointment.id,
      [{ amountCents: 2000, method: 'pix' }],
      MANAGER,
    );

    expect(harness.commissionsService.recalculateNetBase).toHaveBeenCalledWith(
      appointment,
      harness.manager,
    );
  });

  it('stamps the open session onto every row, whatever the method', async () => {
    const harness = buildService();

    await harness.service.recordPayments(
      appointment.id,
      [
        { amountCents: 3000, method: 'cash' },
        { amountCents: 2000, method: 'debit' },
      ],
      MANAGER,
    );

    const [rows] = harness.paymentsRepository.create.mock.calls[0] as [NewPayment[]];
    expect(rows[0]?.cashRegisterSessionId).toBe(openSession.id);
    expect(rows[1]?.cashRegisterSessionId).toBe(openSession.id);
  });

  it('books a pix through the register under its own method', async () => {
    const harness = buildService();

    await harness.service.recordPayments(
      appointment.id,
      [{ amountCents: 5000, method: 'pix' }],
      MANAGER,
    );

    expect(harness.cashRegisterService.requireOpenSession).toHaveBeenCalled();
    expect(harness.cashRegisterService.recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'in',
        source: 'payment',
        method: 'pix',
        amountCents: 5000,
      }),
      harness.manager,
    );
  });

  it('refuses every method when no register is open', async () => {
    const harness = buildService({
      cashRegisterService: {
        requireOpenSession: vi
          .fn()
          .mockRejectedValue(new ConflictError('No cash register session is open')),
      },
    });

    for (const method of ['cash', 'pix', 'credit'] as const) {
      await expect(
        harness.service.recordPayments(appointment.id, [{ amountCents: 5000, method }], MANAGER),
      ).rejects.toBeInstanceOf(ConflictError);
    }
  });

  it('refuses to overpay by a single cent', async () => {
    const harness = buildService({
      paymentsRepository: { sumPaidForAppointment: vi.fn().mockResolvedValue(4000) },
    });

    await expect(
      harness.service.recordPayments(
        appointment.id,
        [{ amountCents: 1001, method: 'pix' }],
        MANAGER,
      ),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { priceCents: 5000, alreadyPaidCents: 4000, attemptedCents: 1001 },
    });
    expect(harness.paymentsRepository.create).not.toHaveBeenCalled();
  });

  it('weighs the whole batch against the price, not each item', async () => {
    const harness = buildService();

    await expect(
      harness.service.recordPayments(
        appointment.id,
        [
          { amountCents: 3000, method: 'pix' },
          { amountCents: 3000, method: 'pix' },
        ],
        MANAGER,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('accepts a payment that settles the cut exactly', async () => {
    const harness = buildService({
      paymentsRepository: { sumPaidForAppointment: vi.fn().mockResolvedValue(4000) },
    });

    const [payment] = await harness.service.recordPayments(
      appointment.id,
      [{ amountCents: 1000, method: 'pix' }],
      MANAGER,
    );

    expect(payment?.amountCents).toBe(1000);
  });

  it('refuses a cancelled appointment', async () => {
    const harness = buildService({
      appointmentsRepository: {
        findById: vi.fn().mockResolvedValue({ ...appointment, status: 'cancelled' }),
      },
    });

    await expect(
      harness.service.recordPayments(
        appointment.id,
        [{ amountCents: 5000, method: 'pix' }],
        MANAGER,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('accepts a confirmed appointment — money can change hands before the cut ends', async () => {
    const harness = buildService({
      appointmentsRepository: {
        findById: vi.fn().mockResolvedValue({ ...appointment, status: 'confirmed' }),
      },
    });

    const [payment] = await harness.service.recordPayments(
      appointment.id,
      [{ amountCents: 5000, method: 'pix' }],
      MANAGER,
    );

    expect(payment?.amountCents).toBe(5000);
  });

  it('404s on an unknown appointment', async () => {
    const harness = buildService({
      appointmentsRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      harness.service.recordPayments('nope', [{ amountCents: 5000, method: 'pix' }], MANAGER),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  describe('paidAt', () => {
    it('accepts a backdated time earlier in the same shop day', async () => {
      const harness = buildService();

      const [payment] = await harness.service.recordPayments(
        appointment.id,

        [{ amountCents: 5000, method: 'pix', paidAt: new Date('2030-03-10T12:00:00.000Z') }],
        MANAGER,
      );

      expect(payment?.paidAt).toBe('2030-03-10T12:00:00.000Z');
    });

    it('refuses yesterday', async () => {
      const harness = buildService();

      await expect(
        harness.service.recordPayments(
          appointment.id,
          [{ amountCents: 5000, method: 'pix', paidAt: new Date('2030-03-09T18:00:00.000Z') }],
          MANAGER,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('refuses the future, even later today', async () => {
      const harness = buildService();

      await expect(
        harness.service.recordPayments(
          appointment.id,
          [{ amountCents: 5000, method: 'pix', paidAt: new Date('2030-03-10T21:00:00.000Z') }],
          MANAGER,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});

describe('PaymentsService.recordForSale', () => {
  it('takes counter money with no appointment behind it', async () => {
    const harness = buildService();

    const payment = await harness.service.recordForSale(
      { amountCents: 9800, method: 'cash' },
      MANAGER,
      harness.manager,
    );

    expect(harness.paymentsRepository.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          appointmentId: null,
          amount: 9800,
          method: 'cash',
          cardFee: 0,
          netAmount: 9800,
          cashRegisterSessionId: openSession.id,
          receivedBy: MANAGER.id,
        }),
      ],
      harness.manager,
    );
    expect(payment.appointmentId).toBeNull();
  });

  it('puts the cash in the open drawer', async () => {
    const harness = buildService();

    await harness.service.recordForSale(
      { amountCents: 9800, method: 'cash' },
      MANAGER,
      harness.manager,
    );

    expect(harness.cashRegisterService.recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: openSession.id,
        type: 'in',
        source: 'payment',
        amountCents: 9800,
      }),
      harness.manager,
    );
  });

  it('books only the card net amount and identifies the processing discount', async () => {
    const harness = buildService();

    const payment = await harness.service.recordForSale(
      { amountCents: 10_000, method: 'credit' },
      MANAGER,
      harness.manager,
    );

    expect(payment).toMatchObject({ cardFeeCents: 350, netAmountCents: 9650 });
    expect(harness.cashRegisterService.recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'credit',
        amountCents: 9650,
        discountCents: 350,
        discountReason: 'card_processing_fee',
      }),
      harness.manager,
    );
  });

  it('refuses a cash sale with the register closed', async () => {
    const harness = buildService({
      cashRegisterService: {
        requireOpenSession: vi.fn().mockRejectedValue(new ConflictError('closed')),
      },
    });

    await expect(
      harness.service.recordForSale(
        { amountCents: 9800, method: 'cash' },
        MANAGER,
        harness.manager,
      ),
    ).rejects.toThrow(ConflictError);
    expect(harness.paymentsRepository.create).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.voidForSale', () => {
  const salePayment = { ...cashPayment, appointmentId: null } as Payment;

  it('takes the cash back out and never touches an appointment', async () => {
    const harness = buildService({
      paymentsRepository: { findById: vi.fn().mockResolvedValue(salePayment) },
    });

    await harness.service.voidForSale(salePayment.id, 'cliente desistiu', MANAGER, harness.manager);

    expect(harness.cashRegisterService.recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'out',
        source: 'payment',
        amountCents: 5000,
        description: 'Voided sale',
      }),
      harness.manager,
    );
    expect(harness.commissionsService.recalculateNetBase).not.toHaveBeenCalled();
    expect(harness.appointmentsRepository.findById).not.toHaveBeenCalled();
  });

  it('refuses a second void', async () => {
    const harness = buildService({
      paymentsRepository: {
        findById: vi.fn().mockResolvedValue({ ...salePayment, voidedAt: NOW }),
      },
    });

    await expect(
      harness.service.voidForSale(salePayment.id, null, MANAGER, harness.manager),
    ).rejects.toThrow(ConflictError);
  });

  it('404s on an unknown payment', async () => {
    const harness = buildService({
      paymentsRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      harness.service.voidForSale('nope', null, MANAGER, harness.manager),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('PaymentsService.voidPayment', () => {
  it('keeps the payment and takes the cash back out of the open drawer', async () => {
    const harness = buildService();

    const voided = await harness.service.voidPayment(
      cashPayment.id,
      { reason: 'charged twice' },
      MANAGER,
    );

    expect(voided).toMatchObject({ id: cashPayment.id, voidReason: 'charged twice' });
    expect(harness.cashRegisterService.recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'out',
        source: 'payment',
        amountCents: 5000,
        paymentId: cashPayment.id,
      }),
      harness.manager,
    );
  });

  it('compensates in whichever register is open now, not the one it was paid into', async () => {
    const laterSession = { id: 'session-2', status: 'open' } as CashRegisterSession;
    const harness = buildService({
      cashRegisterService: {
        requireOpenSession: vi.fn().mockResolvedValue(laterSession),
        recordMovement: vi.fn().mockResolvedValue({ id: 'movement-2' }),
      },
    });

    await harness.service.voidPayment(cashPayment.id, {}, MANAGER);

    expect(harness.cashRegisterService.recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: laterSession.id }),
      harness.manager,
    );
  });

  it('refuses a cash void with the register closed', async () => {
    const harness = buildService({
      cashRegisterService: {
        requireOpenSession: vi
          .fn()
          .mockRejectedValue(new ConflictError('No cash register session is open')),
      },
    });

    await expect(harness.service.voidPayment(cashPayment.id, {}, MANAGER)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('reverses a card payment under its own method', async () => {
    const cardPayment = {
      ...cashPayment,
      method: 'credit',
      cardFee: 175,
      netAmount: 4825,
    } as Payment;
    const harness = buildService({
      paymentsRepository: {
        findById: vi.fn().mockResolvedValue(cardPayment),
      },
    });

    await harness.service.voidPayment(cashPayment.id, {}, MANAGER);

    expect(harness.cashRegisterService.recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'out',
        method: 'credit',
        amountCents: 4825,
        discountCents: 175,
        discountReason: 'card_processing_fee',
      }),
      harness.manager,
    );
  });

  it('shrinks a net commission, since the money it counted is going back', async () => {
    const harness = buildService();

    await harness.service.voidPayment(cashPayment.id, {}, MANAGER);

    expect(harness.commissionsService.recalculateNetBase).toHaveBeenCalledWith(
      appointment,
      harness.manager,
    );
  });

  it('refuses when the commission is already settled in a closed period', async () => {
    const harness = buildService({
      commissionsService: {
        assertAppointmentUnsettled: vi
          .fn()
          .mockRejectedValue(new ConflictError('Already settled in a closed period')),
      },
    });

    await expect(harness.service.voidPayment(cashPayment.id, {}, MANAGER)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(harness.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('refuses a payment taken on another day', async () => {
    const harness = buildService({
      paymentsRepository: {
        findById: vi
          .fn()
          .mockResolvedValue({ ...cashPayment, paidAt: new Date('2030-03-09T18:00:00.000Z') }),
      },
    });

    await expect(harness.service.voidPayment(cashPayment.id, {}, MANAGER)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('refuses to void the same payment twice', async () => {
    const harness = buildService({
      paymentsRepository: {
        findById: vi.fn().mockResolvedValue({ ...cashPayment, voidedAt: NOW }),
      },
    });

    await expect(harness.service.voidPayment(cashPayment.id, {}, MANAGER)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('404s on an unknown payment', async () => {
    const harness = buildService({
      paymentsRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(harness.service.voidPayment('nope', {}, MANAGER)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('PaymentsService.listForAppointment', () => {
  it('lets the barber who worked it see how it was settled', async () => {
    const harness = buildService();

    const payments = await harness.service.listForAppointment(appointment.id, BARBER_ACTOR);

    expect(payments).toHaveLength(1);
  });

  it('refuses another barber', async () => {
    const harness = buildService({
      barbersRepository: {
        findById: vi.fn().mockResolvedValue({ id: 'barber-1', userId: 'someone-else' }),
      },
    });

    await expect(
      harness.service.listForAppointment(appointment.id, BARBER_ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses the client, who never sees the fee side of it', async () => {
    const harness = buildService();

    await expect(
      harness.service.listForAppointment(appointment.id, CLIENT_ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('PaymentsService.list', () => {
  it('passes the filters through and returns the page', async () => {
    const harness = buildService();
    const from = new Date('2030-03-01T00:00:00.000Z');

    const page = await harness.service.list({ method: 'cash', from, limit: 20, offset: 0 });

    expect(harness.paymentsRepository.findMany).toHaveBeenCalledWith(
      { method: 'cash', from, to: undefined, sessionId: undefined },
      { limit: 20, offset: 0 },
    );
    expect(page).toMatchObject({ total: 1, limit: 20, offset: 0 });
  });
});
