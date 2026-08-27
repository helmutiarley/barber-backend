import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTransaction } from '../../src/lib/transaction';
import { CashMovementsRepository } from '../../src/repositories/cash-movements.repository';
import { PaymentsRepository } from '../../src/repositories/payments.repository';
import { getTestDataSource, truncateAll } from '../support/db';
import {
  makeAppointment,
  makePayment,
  makeSession,
  makeUser,
  withTestShop,
} from '../support/factories';

const PAGE = { limit: 50, offset: 0 };

describe('PaymentsRepository', () => {
  let dataSource: DataSource;
  let repository: PaymentsRepository;
  let movements: CashMovementsRepository;

  beforeAll(async () => {
    dataSource = await getTestDataSource();
    repository = new PaymentsRepository(withTestShop(dataSource));
    movements = new CashMovementsRepository(withTestShop(dataSource));
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
  });

  it('inserts a split as one batch', async () => {
    const appointment = await makeAppointment(dataSource, { status: 'completed' });
    const cashier = await makeUser(dataSource, { role: 'MANAGER' });
    const session = await makeSession(dataSource);

    const rows = await repository.create([
      {
        appointmentId: appointment.id,
        amount: 3000,
        method: 'cash',
        cardFee: 0,
        netAmount: 3000,
        cashRegisterSessionId: session.id,
        receivedBy: cashier.id,
        paidAt: new Date(),
      },
      {
        appointmentId: appointment.id,
        amount: 1500,
        method: 'credit',
        cardFee: 53,
        netAmount: 1447,
        cashRegisterSessionId: null,
        receivedBy: cashier.id,
        paidAt: new Date(),
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(await repository.sumPaidForAppointment(appointment.id)).toBe(4500);
    expect(rows.map((row) => row.netAmount)).toEqual([3000, 1447]);
  });

  describe('sumPaidForAppointment', () => {
    it('ignores a voided payment', async () => {
      const appointment = await makeAppointment(dataSource, { status: 'completed' });
      await makePayment(dataSource, { appointmentId: appointment.id, amount: 3000 });
      const voided = await makePayment(dataSource, { appointmentId: appointment.id, amount: 1500 });

      await repository.void(voided.id, {
        voidedAt: new Date(),
        voidedBy: voided.receivedBy,
        voidReason: 'wrong card',
      });

      expect(await repository.sumPaidForAppointment(appointment.id)).toBe(3000);
    });

    it('is zero for an appointment nobody has paid', async () => {
      const appointment = await makeAppointment(dataSource, { status: 'completed' });

      expect(await repository.sumPaidForAppointment(appointment.id)).toBe(0);
    });
  });

  describe('void', () => {
    it('keeps the row readable and records who and why', async () => {
      const payment = await makePayment(dataSource);
      const admin = await makeUser(dataSource, { role: 'ADMIN' });
      const at = new Date();

      const voided = await repository.void(payment.id, {
        voidedAt: at,
        voidedBy: admin.id,
        voidReason: 'charged twice',
      });

      expect(voided).toMatchObject({
        id: payment.id,
        voidedBy: admin.id,
        voidReason: 'charged twice',
      });
      expect(voided?.voidedAt?.getTime()).toBe(at.getTime());
    });

    it('leaves the first void in place when it is voided again', async () => {
      const payment = await makePayment(dataSource);
      const admin = await makeUser(dataSource, { role: 'ADMIN' });
      const first = new Date('2030-01-01T12:00:00.000Z');
      await repository.void(payment.id, {
        voidedAt: first,
        voidedBy: admin.id,
        voidReason: 'first',
      });

      const again = await repository.void(payment.id, {
        voidedAt: new Date('2030-01-02T12:00:00.000Z'),
        voidedBy: admin.id,
        voidReason: 'second',
      });

      expect(again?.voidReason).toBe('first');
    });
  });

  describe('findMany', () => {
    it('filters by method, session and paid-at range, newest first', async () => {
      const session = await makeSession(dataSource);
      const inRange = await makePayment(dataSource, {
        method: 'cash',
        cashRegisterSessionId: session.id,
        paidAt: new Date('2030-02-10T12:00:00.000Z'),
      });
      await makePayment(dataSource, {
        method: 'pix',
        paidAt: new Date('2030-02-11T12:00:00.000Z'),
      });
      await makePayment(dataSource, {
        method: 'cash',
        cashRegisterSessionId: session.id,
        paidAt: new Date('2029-12-11T12:00:00.000Z'),
      });

      const [rows, total] = await repository.findMany(
        {
          method: 'cash',
          sessionId: session.id,
          from: new Date('2030-01-01T00:00:00.000Z'),
          to: new Date('2030-03-01T00:00:00.000Z'),
        },
        PAGE,
      );

      expect(total).toBe(1);
      expect(rows[0]?.id).toBe(inRange.id);
    });

    it('returns voided payments too — they are part of the history', async () => {
      const payment = await makePayment(dataSource);
      await repository.void(payment.id, {
        voidedAt: new Date(),
        voidedBy: payment.receivedBy,
        voidReason: 'mistake',
      });

      const [rows] = await repository.findMany({}, PAGE);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.voidedAt).not.toBeNull();
    });
  });

  it('rolls a payment and its movement back together when the work throws', async () => {
    const appointment = await makeAppointment(dataSource, { status: 'completed' });
    const cashier = await makeUser(dataSource, { role: 'MANAGER' });
    const session = await makeSession(dataSource);

    await expect(
      withTransaction(dataSource, async (manager) => {
        const [payment] = await repository.create(
          [
            {
              appointmentId: appointment.id,
              amount: 4500,
              method: 'cash',
              cardFee: 0,
              netAmount: 4500,
              cashRegisterSessionId: session.id,
              receivedBy: cashier.id,
              paidAt: new Date(),
            },
          ],
          manager,
        );

        await movements.create(
          {
            sessionId: session.id,
            type: 'in',
            source: 'payment',
            amount: 4500,
            paymentId: payment?.id,
            createdBy: cashier.id,
          },
          manager,
        );

        throw new Error('something later in the flow failed');
      }),
    ).rejects.toThrow('something later in the flow failed');

    expect(await repository.sumPaidForAppointment(appointment.id)).toBe(0);
    expect(await movements.sumBySession(session.id)).toEqual({
      in: 0,
      out: 0,
      cashIn: 0,
      cashOut: 0,
      byMethod: [],
    });
  });

  it('sees its own uncommitted writes through the manager', async () => {
    const appointment = await makeAppointment(dataSource, { status: 'completed' });
    const cashier = await makeUser(dataSource, { role: 'MANAGER' });

    const seenInside = await withTransaction(dataSource, async (manager) => {
      await repository.create(
        [
          {
            appointmentId: appointment.id,
            amount: 2000,
            method: 'pix',
            cardFee: 0,
            netAmount: 2000,
            cashRegisterSessionId: null,
            receivedBy: cashier.id,
            paidAt: new Date(),
          },
        ],
        manager,
      );

      return repository.sumPaidForAppointment(appointment.id, manager);
    });

    expect(seenInside).toBe(2000);
  });
});
