import type { EntityManager } from 'typeorm';
import type { AppConfig } from '../config';
import type { Cradle } from '../container';
import type { CashMovement } from '../entities/cash-movement.entity';
import type { CashRegisterSession } from '../entities/cash-register-session.entity';
import {
  PAYMENT_METHODS,
  type CashMovementDiscountReason,
  type CashMovementSource,
  type CashMovementType,
  type ManualCashMovementSource,
  type PaymentMethod,
} from '../entities/enums';
import { ConflictError, NotFoundError, ValidationError } from '../errors/app-error';
import type { AuthenticatedUser } from '../lib/actor';
import type { Clock } from '../lib/clock';
import { shopDayBounds, toShopDate } from '../lib/shop-time';
import type { AppointmentsRepository } from '../repositories/appointments.repository';
import type { CashMovementsRepository } from '../repositories/cash-movements.repository';
import type { CashRegisterSessionsRepository } from '../repositories/cash-register-sessions.repository';

export interface SessionDto {
  id: string;
  status: 'open' | 'closed';
  openedBy: string;
  openedAt: string;
  openingBalanceCents: number;
  closedBy: string | null;
  closedAt: string | null;
  expectedBalanceCents: number | null;
  countedBalanceCents: number | null;
  differenceCents: number | null;
  notes: string | null;
}

export interface MovementDto {
  id: string;
  sessionId: string;
  type: CashMovementType;
  source: CashMovementSource;
  method: PaymentMethod;
  amountCents: number;
  discountCents: number;
  discountReason: CashMovementDiscountReason | null;
  paymentId: string | null;
  expenseId: string | null;
  advanceId: string | null;
  periodId: string | null;
  description: string | null;
  createdBy: string;
  createdAt: string;
}

export interface MethodTotalsDto {
  method: PaymentMethod;
  inCents: number;
  outCents: number;
  discountCents: number;
  netCents: number;
}

export interface CurrentSessionDto {
  session: SessionDto;
  pendingAppointmentsCount: number;
  totals: {
    inCents: number;
    outCents: number;
    discountCents: number;

    cashInCents: number;
    cashOutCents: number;
    expectedBalanceCents: number;
    byMethod: MethodTotalsDto[];
  };
}

export interface SessionDetailDto {
  session: SessionDto;
  movements: MovementDto[];
}

export interface PageInput {
  limit: number;
  offset: number;
}

export interface PagedSessions extends PageInput {
  items: SessionDto[];
  total: number;
}

export interface OpenSessionInput {
  openingBalanceCents: number;
}

export interface CloseSessionInput {
  countedBalanceCents: number;
  notes?: string | null;
}

export interface ManualMovementInput {
  type: CashMovementType;
  source: ManualCashMovementSource;
  amountCents: number;
  description: string;
}

export interface ModuleMovementInput {
  sessionId: string;
  type: CashMovementType;
  source: CashMovementSource;
  method?: PaymentMethod;
  amountCents: number;
  discountCents?: number;
  discountReason?: CashMovementDiscountReason | null;
  paymentId?: string | null;
  expenseId?: string | null;
  advanceId?: string | null;
  periodId?: string | null;
  description?: string | null;
  createdBy: string;
}

export interface SessionFiltersInput {
  from?: Date;
  to?: Date;
}

export class CashRegisterService {
  private readonly appointmentsRepository: AppointmentsRepository;
  private readonly cashRegisterSessionsRepository: CashRegisterSessionsRepository;
  private readonly cashMovementsRepository: CashMovementsRepository;
  private readonly clock: Clock;
  private readonly config: AppConfig;

  constructor({
    appointmentsRepository,
    cashRegisterSessionsRepository,
    cashMovementsRepository,
    clock,
    config,
  }: Cradle) {
    this.appointmentsRepository = appointmentsRepository;
    this.cashRegisterSessionsRepository = cashRegisterSessionsRepository;
    this.cashMovementsRepository = cashMovementsRepository;
    this.clock = clock;
    this.config = config;
  }

  async open(input: OpenSessionInput, actor: AuthenticatedUser): Promise<SessionDto> {
    if (await this.cashRegisterSessionsRepository.findOpen()) {
      throw new ConflictError('A cash register session is already open');
    }

    const session = await this.cashRegisterSessionsRepository.create({
      openedBy: actor.id,
      openedAt: this.clock.now(),
      openingBalance: input.openingBalanceCents,
    });

    return toSessionDto(session);
  }

  async close(input: CloseSessionInput, actor: AuthenticatedUser): Promise<SessionDto> {
    const session = await this.requireOpenSession();
    const pendingAppointmentsCount = await this.pendingAppointmentsCount();
    if (pendingAppointmentsCount > 0) {
      throw new ConflictError('There are appointments pending payment or completion', {
        reason: 'PENDING_APPOINTMENTS',
        pendingAppointmentsCount,
      });
    }

    const expected = await this.expectedBalance(session);
    const difference = input.countedBalanceCents - expected;
    const notes = input.notes?.trim() || null;

    if (difference !== 0 && !notes) {
      throw new ValidationError('Closing with a difference requires notes explaining it', {
        expectedBalanceCents: expected,
        countedBalanceCents: input.countedBalanceCents,
        differenceCents: difference,
      });
    }

    const closed = await this.cashRegisterSessionsRepository.close(session.id, {
      closedBy: actor.id,
      closedAt: this.clock.now(),
      expectedBalance: expected,
      countedBalance: input.countedBalanceCents,
      difference,
      notes,
    });

    return toSessionDto(closed ?? session);
  }

  async current(): Promise<CurrentSessionDto> {
    const session = await this.requireOpenSession();
    const [totals, pendingAppointmentsCount] = await Promise.all([
      this.cashMovementsRepository.sumBySession(session.id),
      this.pendingAppointmentsCount(),
    ]);

    return {
      session: toSessionDto(session),
      pendingAppointmentsCount,
      totals: {
        inCents: totals.in,
        outCents: totals.out,
        discountCents: totals.discount,
        cashInCents: totals.cashIn,
        cashOutCents: totals.cashOut,
        expectedBalanceCents: session.openingBalance + totals.cashIn - totals.cashOut,
        byMethod: PAYMENT_METHODS.map((method) => {
          const row = totals.byMethod.find((entry) => entry.method === method);

          return {
            method,
            inCents: row?.in ?? 0,
            outCents: row?.out ?? 0,
            discountCents: row?.discount ?? 0,
            netCents: (row?.in ?? 0) - (row?.out ?? 0),
          };
        }),
      },
    };
  }

  async listSessions(filters: SessionFiltersInput, page: PageInput): Promise<PagedSessions> {
    const [rows, total] = await this.cashRegisterSessionsRepository.findMany(filters, page);

    return { items: rows.map(toSessionDto), total, ...page };
  }

  async getSession(id: string): Promise<SessionDetailDto> {
    const session = await this.cashRegisterSessionsRepository.findById(id);
    if (!session) {
      throw new NotFoundError(`Cash register session ${id} not found`);
    }

    return {
      session: toSessionDto(session),
      movements: (await this.cashMovementsRepository.findBySession(id)).map(toMovementDto),
    };
  }

  async recordManualMovement(
    input: ManualMovementInput,
    actor: AuthenticatedUser,
  ): Promise<MovementDto> {
    const session = await this.requireOpenSession();

    return this.recordMovement({
      sessionId: session.id,
      type: input.type,
      source: input.source,
      amountCents: input.amountCents,
      description: input.description,
      createdBy: actor.id,
    });
  }

  async recordMovement(input: ModuleMovementInput, manager?: EntityManager): Promise<MovementDto> {
    await this.assertSessionOpen(input.sessionId, manager);

    const movement = await this.cashMovementsRepository.create(
      {
        sessionId: input.sessionId,
        type: input.type,
        source: input.source,
        method: input.method ?? 'cash',
        amount: input.amountCents,
        discountAmount: input.discountCents ?? 0,
        discountReason: input.discountReason ?? null,
        paymentId: input.paymentId ?? null,
        expenseId: input.expenseId ?? null,
        advanceId: input.advanceId ?? null,
        periodId: input.periodId ?? null,
        description: input.description ?? null,
        createdBy: input.createdBy,
      },
      manager,
    );

    return toMovementDto(movement);
  }

  async requireOpenSession(manager?: EntityManager): Promise<CashRegisterSession> {
    const session = await this.cashRegisterSessionsRepository.findOpen(manager);
    if (!session) {
      throw new ConflictError('No cash register session is open');
    }

    return session;
  }

  private async expectedBalance(session: CashRegisterSession): Promise<number> {
    const totals = await this.cashMovementsRepository.sumBySession(session.id);

    return session.openingBalance + totals.cashIn - totals.cashOut;
  }

  private async pendingAppointmentsCount(): Promise<number> {
    const now = this.clock.now();
    const date = toShopDate(now, this.config.shopTimezone);
    const { start, end } = shopDayBounds(date, this.config.shopTimezone);

    return this.appointmentsRepository.countPendingClosureBetween(start, end);
  }

  private async assertSessionOpen(sessionId: string, manager?: EntityManager): Promise<void> {
    const session = await this.cashRegisterSessionsRepository.findById(sessionId, manager);

    if (!session) {
      throw new NotFoundError(`Cash register session ${sessionId} not found`);
    }
    if (session.status !== 'open') {
      throw new ConflictError('That cash register session is closed');
    }
  }
}

function toSessionDto(session: CashRegisterSession): SessionDto {
  return {
    id: session.id,
    status: session.status,
    openedBy: session.openedBy,
    openedAt: session.openedAt.toISOString(),
    openingBalanceCents: session.openingBalance,
    closedBy: session.closedBy,
    closedAt: session.closedAt?.toISOString() ?? null,
    expectedBalanceCents: session.expectedBalance,
    countedBalanceCents: session.countedBalance,
    differenceCents: session.difference,
    notes: session.notes,
  };
}

function toMovementDto(movement: CashMovement): MovementDto {
  return {
    id: movement.id,
    sessionId: movement.sessionId,
    type: movement.type,
    source: movement.source,
    method: movement.method,
    amountCents: movement.amount,
    discountCents: movement.discountAmount,
    discountReason: movement.discountReason,
    paymentId: movement.paymentId,
    expenseId: movement.expenseId,
    advanceId: movement.advanceId,
    periodId: movement.periodId,
    description: movement.description,
    createdBy: movement.createdBy,
    createdAt: movement.createdAt.toISOString(),
  };
}
