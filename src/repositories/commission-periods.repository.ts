import {
  In,
  LessThanOrEqual,
  MoreThanOrEqual,
  type DataSource,
  type EntityManager,
  type Repository,
} from 'typeorm';
import type { Cradle } from '../container';
import { CommissionPeriod } from '../entities/commission-period.entity';
import type { CommissionPeriodStatus, PaymentMethod } from '../entities/enums';
import { ConflictError } from '../errors/app-error';

const EXCLUSION_VIOLATION = '23P01';

export interface NewCommissionPeriod {
  barberId: string;
  startsOn: string;
  endsOn: string;
  totalEntries: number;
  totalAdvances: number;
  totalDue: number;
  closedBy: string;
  closedAt: Date;
}

export interface PeriodPayment {
  paidAt: Date;
  paymentMethod: PaymentMethod;
}

export interface CommissionPeriodFilters {
  barberId?: string;
  status?: CommissionPeriodStatus;

  from?: string;
  to?: string;
}

export interface Page {
  limit: number;
  offset: number;
}

export class CommissionPeriodsRepository {
  private readonly dataSource: DataSource;

  constructor({ dataSource }: Cradle) {
    this.dataSource = dataSource;
  }

  async create(data: NewCommissionPeriod, manager?: EntityManager): Promise<CommissionPeriod> {
    const repository = this.repo(manager);

    try {
      return await repository.save(repository.create(data));
    } catch (error) {

      if (isExclusionViolation(error)) {
        throw new ConflictError(
          `A commission period already covers part of ${data.startsOn}..${data.endsOn} for this barber`,
        );
      }
      throw error;
    }
  }

  async findById(id: string, manager?: EntityManager): Promise<CommissionPeriod | null> {
    return this.repo(manager).findOneBy({ id });
  }

  async findOverlapping(
    barberId: string,
    startsOn: string,
    endsOn: string,
    manager?: EntityManager,
  ): Promise<CommissionPeriod | null> {
    return this.repo(manager).findOne({
      where: {
        barberId,
        startsOn: LessThanOrEqual(endsOn),
        endsOn: MoreThanOrEqual(startsOn),
      },
      order: { startsOn: 'ASC' },
    });
  }

  async findOverlappingForBarbers(
    barberIds: string[],
    startsOn: string,
    endsOn: string,
    manager?: EntityManager,
  ): Promise<CommissionPeriod[]> {
    if (barberIds.length === 0) return [];

    return this.repo(manager).find({
      where: {
        barberId: In(barberIds),
        startsOn: LessThanOrEqual(endsOn),
        endsOn: MoreThanOrEqual(startsOn),
      },
      order: { startsOn: 'ASC' },
    });
  }

  async markPaid(
    id: string,
    payment: PeriodPayment,
    manager?: EntityManager,
  ): Promise<CommissionPeriod | null> {
    const result = await this.repo(manager).update(
      { id, status: 'closed' },
      { status: 'paid', paidAt: payment.paidAt, paymentMethod: payment.paymentMethod },
    );

    return result.affected ? this.findById(id, manager) : null;
  }

  async findMany(
    filters: CommissionPeriodFilters,
    page: Page,
  ): Promise<[CommissionPeriod[], number]> {
    return this.repo().findAndCount({
      where: {
        ...(filters.barberId ? { barberId: filters.barberId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.to ? { startsOn: LessThanOrEqual(filters.to) } : {}),
        ...(filters.from ? { endsOn: MoreThanOrEqual(filters.from) } : {}),
      },
      order: { endsOn: 'DESC', id: 'ASC' },
      take: page.limit,
      skip: page.offset,
    });
  }

  private repo(manager?: EntityManager): Repository<CommissionPeriod> {
    return (manager ?? this.dataSource).getRepository(CommissionPeriod);
  }
}

function isExclusionViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === EXCLUSION_VIOLATION
  );
}
