import type { DataSource, EntityManager } from 'typeorm';
import type { AppConfig } from '../config';
import type { Cradle } from '../container';
import type { Appointment } from '../entities/appointment.entity';
import { CARD_PAYMENT_METHODS, type PaymentMethod } from '../entities/enums';
import type { Payment } from '../entities/payment.entity';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/app-error';
import type { AuthenticatedUser } from '../lib/actor';
import type { Clock } from '../lib/clock';
import { shopDayBounds, toShopDate } from '../lib/shop-time';
import { withTransaction } from '../lib/transaction';
import type { AppointmentsRepository } from '../repositories/appointments.repository';
import type { BarbersRepository } from '../repositories/barbers.repository';
import type { NewPayment, PaymentsRepository } from '../repositories/payments.repository';
import type { CashRegisterService } from './cash-register.service';
import type { CommissionsService } from './commissions.service';

export interface PaymentDto {
  id: string;
  appointmentId: string | null;
  amountCents: number;
  method: PaymentMethod;
  cardFeeCents: number;
  netAmountCents: number;
  cashRegisterSessionId: string | null;
  receivedBy: string;
  paidAt: string;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
}

export interface PaymentItemInput {
  amountCents: number;
  method: PaymentMethod;

  paidAt?: Date;
}

export interface SalePaymentInput {
  amountCents: number;
  method: PaymentMethod;
}

export interface ListPaymentsInput extends PageInput {
  method?: PaymentMethod;
  from?: Date;
  to?: Date;
  sessionId?: string;
}

export interface PageInput {
  limit: number;
  offset: number;
}

export interface PagedPayments extends PageInput {
  items: PaymentDto[];
  total: number;
}

export interface VoidPaymentInput {
  reason?: string | null;
}

const PAYABLE_STATUSES = ['confirmed', 'completed'];
const STAFF_ROLES = ['ADMIN', 'MANAGER'] as const;

function isStaff(actor: AuthenticatedUser): boolean {
  return (STAFF_ROLES as readonly string[]).includes(actor.role);
}

export class PaymentsService {
  private readonly paymentsRepository: PaymentsRepository;
  private readonly appointmentsRepository: AppointmentsRepository;
  private readonly barbersRepository: BarbersRepository;
  private readonly cashRegisterService: CashRegisterService;
  private readonly commissionsService: CommissionsService;

  private readonly dataSource: DataSource;
  private readonly clock: Clock;
  private readonly config: AppConfig;

  constructor({
    paymentsRepository,
    appointmentsRepository,
    barbersRepository,
    cashRegisterService,
    commissionsService,
    dataSource,
    clock,
    config,
  }: Cradle) {
    this.paymentsRepository = paymentsRepository;
    this.appointmentsRepository = appointmentsRepository;
    this.barbersRepository = barbersRepository;
    this.cashRegisterService = cashRegisterService;
    this.commissionsService = commissionsService;
    this.dataSource = dataSource;
    this.clock = clock;
    this.config = config;
  }

  async recordPayments(
    appointmentId: string,
    items: PaymentItemInput[],
    actor: AuthenticatedUser,
  ): Promise<PaymentDto[]> {
    const appointment = await this.requireAppointment(appointmentId);

    if (!PAYABLE_STATUSES.includes(appointment.status)) {
      throw new ConflictError(`An appointment that is ${appointment.status} cannot be paid`);
    }

    const rows = items.map((item) => this.toRow(appointment, item, actor));
    await this.assertNoOverpay(appointment, rows);

    const payments = await withTransaction(this.dataSource, async (manager) => {

      const session = await this.cashRegisterService.requireOpenSession(manager);

      const created = await this.paymentsRepository.create(
        rows.map((row) => ({ ...row, cashRegisterSessionId: session.id })),
        manager,
      );

      for (const payment of created) {
        await this.cashRegisterService.recordMovement(
          {
            sessionId: session.id,
            type: 'in',
            source: 'payment',
            method: payment.method,
            amountCents: payment.amount,
            paymentId: payment.id,
            createdBy: actor.id,
          },
          manager,
        );
      }

      await this.commissionsService.recalculateNetBase(appointment, manager);

      return created;
    });

    return payments.map(toDto);
  }

  async recordForSale(
    input: SalePaymentInput,
    actor: AuthenticatedUser,
    manager: EntityManager,
  ): Promise<PaymentDto> {
    const cardFee = this.cardFeeFor(input.method, input.amountCents);
    const session = await this.cashRegisterService.requireOpenSession(manager);

    const [payment] = await this.paymentsRepository.create(
      [
        {
          appointmentId: null,
          amount: input.amountCents,
          method: input.method,
          cardFee,
          netAmount: input.amountCents - cardFee,
          cashRegisterSessionId: session.id,
          receivedBy: actor.id,
          paidAt: this.clock.now(),
        },
      ],
      manager,
    );

    await this.cashRegisterService.recordMovement(
      {
        sessionId: session.id,
        type: 'in',
        source: 'payment',
        method: payment.method,
        amountCents: payment.amount,
        paymentId: payment.id,
        createdBy: actor.id,
      },
      manager,
    );

    return toDto(payment);
  }

  async voidForSale(
    paymentId: string,
    reason: string | null,
    actor: AuthenticatedUser,
    manager: EntityManager,
  ): Promise<PaymentDto> {
    const payment = await this.paymentsRepository.findById(paymentId, manager);
    if (!payment) {
      throw new NotFoundError(`Payment ${paymentId} not found`);
    }
    if (payment.voidedAt) {
      throw new ConflictError('This payment has already been voided');
    }

    const session = await this.cashRegisterService.requireOpenSession(manager);

    const voided = await this.paymentsRepository.void(
      payment.id,
      { voidedAt: this.clock.now(), voidedBy: actor.id, voidReason: reason },
      manager,
    );
    if (!voided) {
      throw new NotFoundError(`Payment ${paymentId} not found`);
    }

    await this.cashRegisterService.recordMovement(
      {
        sessionId: session.id,
        type: 'out',
        source: 'payment',
        method: payment.method,
        amountCents: payment.amount,
        paymentId: payment.id,
        description: 'Voided sale',
        createdBy: actor.id,
      },
      manager,
    );

    return toDto(voided);
  }

  async listForAppointment(appointmentId: string, actor: AuthenticatedUser): Promise<PaymentDto[]> {
    const appointment = await this.requireAppointment(appointmentId);
    await this.assertWorksOnIt(appointment, actor);

    return (await this.paymentsRepository.findByAppointment(appointmentId)).map(toDto);
  }

  async list(input: ListPaymentsInput): Promise<PagedPayments> {
    const page = { limit: input.limit, offset: input.offset };
    const [rows, total] = await this.paymentsRepository.findMany(
      { method: input.method, from: input.from, to: input.to, sessionId: input.sessionId },
      page,
    );

    return { items: rows.map(toDto), total, ...page };
  }

  async voidPayment(
    id: string,
    input: VoidPaymentInput,
    actor: AuthenticatedUser,
  ): Promise<PaymentDto> {
    const payment = await this.paymentsRepository.findById(id);
    if (!payment) {
      throw new NotFoundError(`Payment ${id} not found`);
    }
    if (payment.voidedAt) {
      throw new ConflictError('This payment has already been voided');
    }

    const now = this.clock.now();
    if (!this.isSameShopDay(payment.paidAt, now)) {
      throw new ConflictError(
        'Only payments recorded today can be voided — record a refund instead',
      );
    }

    if (payment.appointmentId) {
      await this.commissionsService.assertAppointmentUnsettled(payment.appointmentId);
    }

    const voided = await withTransaction(this.dataSource, async (manager) => {

      const session = await this.cashRegisterService.requireOpenSession(manager);

      const updated = await this.paymentsRepository.void(
        payment.id,
        { voidedAt: now, voidedBy: actor.id, voidReason: input.reason?.trim() || null },
        manager,
      );

      await this.cashRegisterService.recordMovement(
        {
          sessionId: session.id,
          type: 'out',
          source: 'payment',
          method: payment.method,
          amountCents: payment.amount,
          paymentId: payment.id,
          description: 'Voided payment',
          createdBy: actor.id,
        },
        manager,
      );

      const appointment = payment.appointmentId
        ? await this.appointmentsRepository.findById(payment.appointmentId, manager)
        : null;

      if (appointment) {
        await this.commissionsService.recalculateNetBase(appointment, manager);
      }

      return updated;
    });

    if (!voided) {
      throw new NotFoundError(`Payment ${id} not found`);
    }

    return toDto(voided);
  }

  private toRow(
    appointment: Appointment,
    item: PaymentItemInput,
    actor: AuthenticatedUser,
  ): NewPayment {
    const paidAt = item.paidAt ?? this.clock.now();
    this.assertPaidToday(paidAt);

    const cardFee = this.cardFeeFor(item.method, item.amountCents);

    return {
      appointmentId: appointment.id,
      amount: item.amountCents,
      method: item.method,
      cardFee,
      netAmount: item.amountCents - cardFee,

      cashRegisterSessionId: null,
      receivedBy: actor.id,
      paidAt,
    };
  }

  private cardFeeFor(method: PaymentMethod, amountCents: number): number {
    if (!CARD_PAYMENT_METHODS.includes(method)) {
      return 0;
    }

    return Math.round(amountCents * this.config.cardFeeRates[method as 'debit' | 'credit']);
  }

  private async assertNoOverpay(appointment: Appointment, rows: NewPayment[]): Promise<void> {
    const alreadyPaid = await this.paymentsRepository.sumPaidForAppointment(appointment.id);
    const attempted = rows.reduce((total, row) => total + row.amount, 0);

    if (alreadyPaid + attempted > appointment.price) {
      throw new ConflictError('That is more than this appointment costs', {
        priceCents: appointment.price,
        alreadyPaidCents: alreadyPaid,
        attemptedCents: attempted,
      });
    }
  }

  private assertPaidToday(paidAt: Date): void {
    const now = this.clock.now();
    const { start, end } = shopDayBounds(
      toShopDate(now, this.config.shopTimezone),
      this.config.shopTimezone,
    );

    if (paidAt < start || paidAt >= end) {
      throw new ValidationError('Payments can only be recorded for today', [
        { field: 'paidAt', message: 'must fall on the current shop day' },
      ]);
    }
    if (paidAt > now) {
      throw new ValidationError('Payments cannot be recorded in the future', [
        { field: 'paidAt', message: 'must not be in the future' },
      ]);
    }
  }

  private isSameShopDay(left: Date, right: Date): boolean {
    const zone = this.config.shopTimezone;

    return toShopDate(left, zone) === toShopDate(right, zone);
  }

  private async requireAppointment(id: string): Promise<Appointment> {
    const appointment = await this.appointmentsRepository.findById(id);
    if (!appointment) {
      throw new NotFoundError(`Appointment ${id} not found`);
    }

    return appointment;
  }

  private async assertWorksOnIt(appointment: Appointment, actor: AuthenticatedUser): Promise<void> {
    if (isStaff(actor)) {
      return;
    }

    if (actor.role === 'BARBER') {
      const barber = await this.barbersRepository.findById(appointment.barberId);
      if (barber?.userId === actor.id) {
        return;
      }
    }

    throw new ForbiddenError('Only staff or the barber who worked it may read these payments');
  }
}

function toDto(payment: Payment): PaymentDto {
  return {
    id: payment.id,
    appointmentId: payment.appointmentId,
    amountCents: payment.amount,
    method: payment.method,
    cardFeeCents: payment.cardFee,
    netAmountCents: payment.netAmount,
    cashRegisterSessionId: payment.cashRegisterSessionId,
    receivedBy: payment.receivedBy,
    paidAt: payment.paidAt.toISOString(),
    voidedAt: payment.voidedAt?.toISOString() ?? null,
    voidedBy: payment.voidedBy,
    voidReason: payment.voidReason,
  };
}
