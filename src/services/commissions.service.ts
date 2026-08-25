import type { DataSource, EntityManager } from 'typeorm';
import type { AppConfig } from '../config';
import type { Cradle } from '../container';
import type { Appointment } from '../entities/appointment.entity';
import type { CommissionAdvance } from '../entities/commission-advance.entity';
import type { CommissionEntry } from '../entities/commission-entry.entity';
import type { CommissionPeriod } from '../entities/commission-period.entity';
import type { CommissionRule } from '../entities/commission-rule.entity';
import type {
  CommissionAppliesTo,
  CommissionBase,
  CommissionPeriodStatus,
  PaymentMethod,
} from '../entities/enums';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/app-error';
import type { AuthenticatedUser } from '../lib/actor';
import type { Clock } from '../lib/clock';
import { shopRangeBounds, toShopDate } from '../lib/shop-time';
import { withTransaction } from '../lib/transaction';
import type { BarbersRepository } from '../repositories/barbers.repository';
import type { CommissionAdvancesRepository } from '../repositories/commission-advances.repository';
import type { CommissionEntriesRepository } from '../repositories/commission-entries.repository';
import type { CommissionPeriodsRepository } from '../repositories/commission-periods.repository';
import type {
  CommissionRuleChanges,
  CommissionRulesRepository,
  RuleScope,
} from '../repositories/commission-rules.repository';
import type { PaymentsRepository } from '../repositories/payments.repository';
import type { ServicesRepository } from '../repositories/services.repository';
import type { CashRegisterService } from './cash-register.service';

export interface CommissionRuleDto {
  id: string;
  barberId: string | null;
  serviceId: string | null;
  rate: number;
  base: CommissionBase;
  appliesTo: CommissionAppliesTo;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommissionEntryDto {
  id: string;
  barberId: string;

  appointmentId: string | null;
  productSaleId: string | null;
  ruleId: string;
  rate: number;
  base: CommissionBase;
  baseAmountCents: number;
  amountCents: number;

  periodId: string | null;
  createdAt: string;
}

export interface CreateRuleInput {

  barberId?: string | null;
  serviceId?: string | null;
  rate: number;
  base: CommissionBase;
  appliesTo?: CommissionAppliesTo;
}

export interface UpdateRuleInput {
  rate?: number;
  base?: CommissionBase;
  active?: boolean;
}

export interface ListRulesInput {
  appliesTo?: CommissionAppliesTo;
  active?: boolean;
}

export interface PageInput {
  limit: number;
  offset: number;
}

export interface ListEntriesInput extends PageInput {
  barberId?: string;
  periodId?: string;
  from?: Date;
  to?: Date;
}

export interface PagedEntries extends PageInput {
  items: CommissionEntryDto[];
  total: number;
}

export interface CommissionAdvanceDto {
  id: string;
  barberId: string;
  amountCents: number;
  periodId: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
}

export interface CommissionPeriodDto {
  id: string;
  barberId: string;
  startsOn: string;
  endsOn: string;
  status: CommissionPeriodStatus;
  totalEntriesCents: number;
  totalAdvancesCents: number;

  totalDueCents: number;
  closedBy: string;
  closedAt: string;
  paidAt: string | null;
  paymentMethod: PaymentMethod | null;
}

export interface CommissionStatementDto {
  period: CommissionPeriodDto;
  entries: CommissionEntryDto[];
  advances: CommissionAdvanceDto[];
}

export interface ProductSaleCommissionLine {
  saleId: string;

  total: number;
}

export interface ProductSaleCommissionInput {
  barberId: string;
  lines: ProductSaleCommissionLine[];
  cardFeeCents: number;
}

export interface RecordAdvanceInput {
  barberId: string;
  amountCents: number;
  paymentMethod: PaymentMethod;
  notes?: string | null;
}

export interface ClosePeriodInput {

  barberId?: string;
  startsOn: string;
  endsOn: string;
}

export interface PayPeriodInput {
  paymentMethod: PaymentMethod;
}

export interface ListPeriodsInput extends PageInput {
  barberId?: string;
  status?: CommissionPeriodStatus;
  from?: string;
  to?: string;
}

export interface PagedPeriods extends PageInput {
  items: CommissionPeriodDto[];
  total: number;
}

export interface ListAdvancesInput extends PageInput {
  barberId?: string;
  unassigned?: boolean;
  from?: Date;
  to?: Date;
}

export interface PagedAdvances extends PageInput {
  items: CommissionAdvanceDto[];
  total: number;
}

const STAFF_ROLES = ['ADMIN', 'MANAGER'] as const;

function isStaff(actor: AuthenticatedUser): boolean {
  return (STAFF_ROLES as readonly string[]).includes(actor.role);
}

export class CommissionsService {
  private readonly commissionRulesRepository: CommissionRulesRepository;
  private readonly commissionEntriesRepository: CommissionEntriesRepository;
  private readonly commissionPeriodsRepository: CommissionPeriodsRepository;
  private readonly commissionAdvancesRepository: CommissionAdvancesRepository;
  private readonly paymentsRepository: PaymentsRepository;
  private readonly barbersRepository: BarbersRepository;
  private readonly servicesRepository: ServicesRepository;
  private readonly cashRegisterService: CashRegisterService;

  private readonly dataSource: DataSource;
  private readonly clock: Clock;
  private readonly config: AppConfig;

  constructor({
    commissionRulesRepository,
    commissionEntriesRepository,
    commissionPeriodsRepository,
    commissionAdvancesRepository,
    paymentsRepository,
    barbersRepository,
    servicesRepository,
    cashRegisterService,
    dataSource,
    clock,
    config,
  }: Cradle) {
    this.commissionRulesRepository = commissionRulesRepository;
    this.commissionEntriesRepository = commissionEntriesRepository;
    this.commissionPeriodsRepository = commissionPeriodsRepository;
    this.commissionAdvancesRepository = commissionAdvancesRepository;
    this.paymentsRepository = paymentsRepository;
    this.barbersRepository = barbersRepository;
    this.servicesRepository = servicesRepository;
    this.cashRegisterService = cashRegisterService;
    this.dataSource = dataSource;
    this.clock = clock;
    this.config = config;
  }

  async createRule(input: CreateRuleInput): Promise<CommissionRuleDto> {
    const appliesTo = input.appliesTo ?? 'services';
    const serviceId = input.serviceId ?? null;

    if (appliesTo === 'products' && serviceId) {
      throw new ValidationError('A product rule cannot name a service', [
        { field: 'serviceId', message: 'must be omitted when appliesTo is products' },
      ]);
    }

    const scope: RuleScope = { barberId: input.barberId ?? null, serviceId, appliesTo };
    await this.assertReferencesExist(scope);

    if (await this.commissionRulesRepository.findActiveByScope(scope)) {
      throw new ConflictError('An active rule already covers that barber and service', {
        barberId: scope.barberId,
        serviceId: scope.serviceId,
      });
    }

    return toRuleDto(
      await this.commissionRulesRepository.create({
        ...scope,
        rate: input.rate,
        base: input.base,
      }),
    );
  }

  async listRules(input: ListRulesInput, actor: AuthenticatedUser): Promise<CommissionRuleDto[]> {
    const rules = await this.commissionRulesRepository.findMany({
      appliesTo: input.appliesTo,
      active: input.active,
      ...(isStaff(actor) ? {} : { appliesToBarberId: await this.ownBarberId(actor) }),
    });

    return rules.map(toRuleDto);
  }

  async updateRule(id: string, input: UpdateRuleInput): Promise<CommissionRuleDto> {
    const rule = await this.commissionRulesRepository.findById(id);
    if (!rule) {
      throw new NotFoundError(`Commission rule ${id} not found`);
    }

    const changes: CommissionRuleChanges = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    );

    if (changes.active === true && !rule.active) {
      const holder = await this.commissionRulesRepository.findActiveByScope(rule);
      if (holder) {
        throw new ConflictError('Another active rule already covers that barber and service', {
          ruleId: holder.id,
        });
      }
    }

    const updated = await this.commissionRulesRepository.update(id, changes);

    return toRuleDto(updated ?? rule);
  }

  async listEntries(input: ListEntriesInput, actor: AuthenticatedUser): Promise<PagedEntries> {
    const page = { limit: input.limit, offset: input.offset };
    const barberId = await this.scopeBarberId(input.barberId, actor);

    const [rows, total] = await this.commissionEntriesRepository.findMany(
      { barberId, periodId: input.periodId, from: input.from, to: input.to },
      page,
    );

    return { items: rows.map(toEntryDto), total, ...page };
  }

  async recordAdvance(
    input: RecordAdvanceInput,
    actor: AuthenticatedUser,
  ): Promise<CommissionAdvanceDto> {
    if (!(await this.barbersRepository.findById(input.barberId))) {
      throw new NotFoundError(`Barber ${input.barberId} not found`);
    }

    const advance = await withTransaction(this.dataSource, async (manager) => {

      const session =
        input.paymentMethod === 'cash'
          ? await this.cashRegisterService.requireOpenSession(manager)
          : null;

      const created = await this.commissionAdvancesRepository.create(
        {
          barberId: input.barberId,
          amount: input.amountCents,
          notes: input.notes?.trim() || null,
          createdBy: actor.id,
        },
        manager,
      );

      if (session) {
        await this.cashRegisterService.recordMovement(
          {
            sessionId: session.id,
            type: 'out',
            source: 'advance',
            amountCents: created.amount,
            advanceId: created.id,
            description: `Adiantamento — barbeiro ${created.barberId}`,
            createdBy: actor.id,
          },
          manager,
        );
      }

      return created;
    });

    return toAdvanceDto(advance);
  }

  async closePeriod(
    input: ClosePeriodInput,
    actor: AuthenticatedUser,
  ): Promise<CommissionPeriodDto[]> {
    const { start, end } = shopRangeBounds(input.startsOn, input.endsOn, this.config.shopTimezone);
    this.assertRangeIsOver(input.endsOn);

    const barberIds = await this.closeTargets(input.barberId);
    await this.assertNoOverlap(barberIds, input.startsOn, input.endsOn);

    const closedAt = this.clock.now();

    const periods = await withTransaction(this.dataSource, async (manager) => {
      const created = [];

      for (const barberId of barberIds) {
        const entries = await this.commissionEntriesRepository.findUnassignedInRange(
          barberId,
          start,
          end,
          manager,
        );
        const advances = await this.commissionAdvancesRepository.findUnassignedInRange(
          barberId,
          start,
          end,
          manager,
        );

        if (entries.length === 0 && advances.length === 0) {
          continue;
        }

        const totalEntries = sumBy(entries, (entry) => entry.amount);
        const totalAdvances = sumBy(advances, (advance) => advance.amount);

        const period = await this.commissionPeriodsRepository.create(
          {
            barberId,
            startsOn: input.startsOn,
            endsOn: input.endsOn,
            totalEntries,
            totalAdvances,
            totalDue: totalEntries - totalAdvances,
            closedBy: actor.id,
            closedAt,
          },
          manager,
        );

        const stampedEntries = await this.commissionEntriesRepository.assignPeriod(
          entries.map((entry) => entry.id),
          period.id,
          manager,
        );
        const stampedAdvances = await this.commissionAdvancesRepository.assignPeriod(
          advances.map((advance) => advance.id),
          period.id,
          manager,
        );

        if (stampedEntries !== entries.length || stampedAdvances !== advances.length) {
          throw new ConflictError(
            'Another close claimed some of these commissions — nothing was settled',
            { barberId },
          );
        }

        created.push(period);
      }

      return created;
    });

    return periods.map(toPeriodDto);
  }

  async listPeriods(input: ListPeriodsInput, actor: AuthenticatedUser): Promise<PagedPeriods> {
    const page = { limit: input.limit, offset: input.offset };
    const barberId = await this.scopeBarberId(input.barberId, actor);

    const [rows, total] = await this.commissionPeriodsRepository.findMany(
      { barberId, status: input.status, from: input.from, to: input.to },
      page,
    );

    return { items: rows.map(toPeriodDto), total, ...page };
  }

  async listAdvances(input: ListAdvancesInput, actor: AuthenticatedUser): Promise<PagedAdvances> {
    const page = { limit: input.limit, offset: input.offset };
    const barberId = await this.scopeBarberId(input.barberId, actor);

    const [rows, total] = await this.commissionAdvancesRepository.findMany(
      { barberId, unassigned: input.unassigned, from: input.from, to: input.to },
      page,
    );

    return { items: rows.map(toAdvanceDto), total, ...page };
  }

  async getStatement(id: string, actor: AuthenticatedUser): Promise<CommissionStatementDto> {
    const period = await this.requirePeriod(id);
    await this.assertOwnBarber(period.barberId, actor);

    return {
      period: toPeriodDto(period),
      entries: (await this.commissionEntriesRepository.findByPeriod(period.id)).map(toEntryDto),
      advances: (await this.commissionAdvancesRepository.findByPeriod(period.id)).map(toAdvanceDto),
    };
  }

  async payPeriod(
    id: string,
    input: PayPeriodInput,
    actor: AuthenticatedUser,
  ): Promise<CommissionPeriodDto> {
    const period = await this.requirePeriod(id);

    if (period.status === 'paid') {
      throw new ConflictError('This commission period has already been paid', {
        paidAt: period.paidAt?.toISOString(),
      });
    }

    const paidAt = this.clock.now();
    const movesCash = input.paymentMethod === 'cash' && period.totalDue > 0;

    const paid = await withTransaction(this.dataSource, async (manager) => {
      const session = movesCash ? await this.cashRegisterService.requireOpenSession(manager) : null;

      const updated = await this.commissionPeriodsRepository.markPaid(
        period.id,
        { paidAt, paymentMethod: input.paymentMethod },
        manager,
      );

      if (!updated) {
        throw new ConflictError('This commission period has already been paid');
      }

      if (session) {
        await this.cashRegisterService.recordMovement(
          {
            sessionId: session.id,
            type: 'out',
            source: 'payout',
            amountCents: updated.totalDue,
            periodId: updated.id,
            description: `Comissão ${updated.startsOn}..${updated.endsOn} — barbeiro ${updated.barberId}`,
            createdBy: actor.id,
          },
          manager,
        );
      }

      return updated;
    });

    return toPeriodDto(paid);
  }

  async assertAppointmentUnsettled(appointmentId: string, manager?: EntityManager): Promise<void> {
    const entry = await this.commissionEntriesRepository.findByAppointment(appointmentId, manager);

    if (entry?.periodId) {
      throw new ConflictError(
        'This appointment\u2019s commission is already settled in a closed period',
        { entryId: entry.id, periodId: entry.periodId },
      );
    }
  }

  async recordForAppointment(
    appointment: Appointment,
    manager: EntityManager,
  ): Promise<CommissionEntryDto> {
    const rule = await this.commissionRulesRepository.resolve(
      { barberId: appointment.barberId, serviceId: appointment.serviceId, appliesTo: 'services' },
      manager,
    );

    if (!rule) {
      throw new ConflictError(
        `No commission rule configured for barber ${appointment.barberId} — set one before completing appointments`,
        { barberId: appointment.barberId, serviceId: appointment.serviceId },
      );
    }

    const baseAmount = await this.baseAmountFor(appointment, rule.base, manager);

    return toEntryDto(
      await this.commissionEntriesRepository.create(
        {
          barberId: appointment.barberId,
          appointmentId: appointment.id,
          ruleId: rule.id,
          rate: rule.rate,
          base: rule.base,
          baseAmount,
          amount: amountFor(baseAmount, rule.rate),
        },
        manager,
      ),
    );
  }

  async recalculateNetBase(
    appointment: Appointment,
    manager: EntityManager,
  ): Promise<CommissionEntryDto | null> {
    const entry = await this.commissionEntriesRepository.findByAppointment(appointment.id, manager);
    if (!entry || entry.base !== 'net') {
      return null;
    }

    const baseAmount = await this.baseAmountFor(appointment, 'net', manager);
    if (baseAmount === entry.baseAmount) {
      return null;
    }

    if (entry.periodId) {
      throw new ConflictError(
        'This appointment\u2019s commission is settled in a closed period and cannot be recalculated',
        { entryId: entry.id, periodId: entry.periodId },
      );
    }

    const updated = await this.commissionEntriesRepository.updateAmounts(
      entry.id,
      { baseAmount, amount: amountFor(baseAmount, entry.rate) },
      manager,
    );

    return updated ? toEntryDto(updated) : null;
  }

  async recordForProductSales(
    input: ProductSaleCommissionInput,
    manager: EntityManager,
  ): Promise<CommissionEntryDto[]> {
    const rule = await this.commissionRulesRepository.resolve(

      { barberId: input.barberId, serviceId: null, appliesTo: 'products' },
      manager,
    );

    if (!rule) {
      return [];
    }

    const bases =
      rule.base === 'gross'
        ? input.lines.map((line) => line.total)
        : netBasesFor(input.lines, input.cardFeeCents);

    const entries: CommissionEntryDto[] = [];

    for (const [index, line] of input.lines.entries()) {
      const baseAmount = bases[index];

      entries.push(
        toEntryDto(
          await this.commissionEntriesRepository.create(
            {
              barberId: input.barberId,
              productSaleId: line.saleId,
              ruleId: rule.id,
              rate: rule.rate,
              base: rule.base,
              baseAmount,
              amount: amountFor(baseAmount, rule.rate),
            },
            manager,
          ),
        ),
      );
    }

    return entries;
  }

  async assertProductSalesUnsettled(saleIds: string[], manager?: EntityManager): Promise<void> {
    const settled = (
      await this.commissionEntriesRepository.findByProductSales(saleIds, manager)
    ).filter((entry) => entry.periodId);

    if (settled.length > 0) {
      throw new ConflictError('This sale\u2019s commission is already settled in a closed period', {
        entries: settled.map((entry) => ({ entryId: entry.id, periodId: entry.periodId })),
      });
    }
  }

  async zeroForProductSales(saleIds: string[], manager: EntityManager): Promise<number> {
    const entries = await this.commissionEntriesRepository.findByProductSales(saleIds, manager);
    const zeroed = await this.commissionEntriesRepository.zeroAmounts(
      entries.map((entry) => entry.id),
      manager,
    );

    if (zeroed !== entries.length) {
      throw new ConflictError(
        'This sale\u2019s commission was settled while the void was being recorded',
      );
    }

    return zeroed;
  }

  private async baseAmountFor(
    appointment: Appointment,
    base: CommissionBase,
    manager: EntityManager,
  ): Promise<number> {
    if (base === 'gross') {
      return appointment.price;
    }

    const net = await this.paymentsRepository.sumNetForAppointment(appointment.id, manager);

    return net ?? appointment.price;
  }

  private assertRangeIsOver(endsOn: string): void {
    const today = toShopDate(this.clock.now(), this.config.shopTimezone);

    if (endsOn >= today) {
      throw new ValidationError('A commission period can only be closed once its days are over', [
        { field: 'endsOn', message: `must be before ${today}` },
      ]);
    }
  }

  private async closeTargets(barberId?: string): Promise<string[]> {
    if (barberId) {
      if (!(await this.barbersRepository.findById(barberId))) {
        throw new NotFoundError(`Barber ${barberId} not found`);
      }

      return [barberId];
    }

    const barbers = await this.barbersRepository.findMany({ active: true });
    if (barbers.length === 0) {
      throw new ValidationError('There are no active barbers to close a period for');
    }

    return barbers.map((barber) => barber.id);
  }

  private async assertNoOverlap(
    barberIds: string[],
    startsOn: string,
    endsOn: string,
  ): Promise<void> {
    const clashing = await this.commissionPeriodsRepository.findOverlappingForBarbers(
      barberIds,
      startsOn,
      endsOn,
    );

    if (clashing.length > 0) {
      throw new ConflictError(
        `A commission period already covers part of ${startsOn}..${endsOn} for ${clashing.length} of these barbers`,
        {
          barbers: clashing.map((period) => ({
            barberId: period.barberId,
            periodId: period.id,
            startsOn: period.startsOn,
            endsOn: period.endsOn,
          })),
        },
      );
    }
  }

  private async requirePeriod(id: string): Promise<CommissionPeriod> {
    const period = await this.commissionPeriodsRepository.findById(id);
    if (!period) {
      throw new NotFoundError(`Commission period ${id} not found`);
    }

    return period;
  }

  private async assertOwnBarber(barberId: string, actor: AuthenticatedUser): Promise<void> {
    if (isStaff(actor)) {
      return;
    }

    if ((await this.ownBarberId(actor)) !== barberId) {
      throw new ForbiddenError('You can only read your own commissions');
    }
  }

  private async scopeBarberId(
    requested: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<string | undefined> {
    if (isStaff(actor)) {
      return requested;
    }

    const own = await this.ownBarberId(actor);
    if (requested && requested !== own) {
      throw new ForbiddenError('You can only read your own commissions');
    }

    return own;
  }

  private async ownBarberId(actor: AuthenticatedUser): Promise<string> {
    const barber =
      actor.role === 'BARBER' ? await this.barbersRepository.findByUserId(actor.id) : null;

    if (!barber) {
      throw new ForbiddenError('Only staff and barbers may read commissions');
    }

    return barber.id;
  }

  private async assertReferencesExist(scope: RuleScope): Promise<void> {
    if (scope.barberId && !(await this.barbersRepository.findById(scope.barberId))) {
      throw new NotFoundError(`Barber ${scope.barberId} not found`);
    }
    if (scope.serviceId && !(await this.servicesRepository.findById(scope.serviceId))) {
      throw new NotFoundError(`Service ${scope.serviceId} not found`);
    }
  }
}

function amountFor(baseAmount: number, rate: number): number {
  return Math.round(baseAmount * rate);
}

function sumBy<T>(rows: T[], amount: (row: T) => number): number {
  return rows.reduce((total, row) => total + amount(row), 0);
}

function netBasesFor(lines: ProductSaleCommissionLine[], cardFeeCents: number): number[] {
  if (cardFeeCents === 0) {
    return lines.map((line) => line.total);
  }

  const gross = sumBy(lines, (line) => line.total);
  let allocated = 0;

  return lines.map((line, index) => {
    const share =
      index === lines.length - 1
        ? cardFeeCents - allocated
        : Math.round((cardFeeCents * line.total) / gross);
    allocated += share;

    return line.total - share;
  });
}

function toRuleDto(rule: CommissionRule): CommissionRuleDto {
  return {
    id: rule.id,
    barberId: rule.barberId,
    serviceId: rule.serviceId,
    rate: rule.rate,
    base: rule.base,
    appliesTo: rule.appliesTo,
    active: rule.active,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}

function toEntryDto(entry: CommissionEntry): CommissionEntryDto {
  return {
    id: entry.id,
    barberId: entry.barberId,
    appointmentId: entry.appointmentId,
    productSaleId: entry.productSaleId,
    ruleId: entry.ruleId,
    rate: entry.rate,
    base: entry.base,
    baseAmountCents: entry.baseAmount,
    amountCents: entry.amount,
    periodId: entry.periodId,
    createdAt: entry.createdAt.toISOString(),
  };
}

function toAdvanceDto(advance: CommissionAdvance): CommissionAdvanceDto {
  return {
    id: advance.id,
    barberId: advance.barberId,
    amountCents: advance.amount,
    periodId: advance.periodId,
    notes: advance.notes,
    createdBy: advance.createdBy,
    createdAt: advance.createdAt.toISOString(),
  };
}

function toPeriodDto(period: CommissionPeriod): CommissionPeriodDto {
  return {
    id: period.id,
    barberId: period.barberId,
    startsOn: period.startsOn,
    endsOn: period.endsOn,
    status: period.status,
    totalEntriesCents: period.totalEntries,
    totalAdvancesCents: period.totalAdvances,
    totalDueCents: period.totalDue,
    closedBy: period.closedBy,
    closedAt: period.closedAt.toISOString(),
    paidAt: period.paidAt?.toISOString() ?? null,
    paymentMethod: period.paymentMethod,
  };
}
