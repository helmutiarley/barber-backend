import {
  And,
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  MoreThanOrEqual,
  type DataSource,
  type EntityManager,
  type Repository,
} from 'typeorm';
import type { Cradle } from '../container';
import { CommissionEntry } from '../entities/commission-entry.entity';
import type { CommissionBase } from '../entities/enums';
import { ConflictError } from '../errors/app-error';

const UNIQUE_VIOLATION = '23505';

interface CommissionEntryFacts {
  barberId: string;
  ruleId: string;
  rate: number;
  base: CommissionBase;
  baseAmount: number;
  amount: number;
}

export type NewCommissionEntry = CommissionEntryFacts &
  ({ appointmentId: string } | { productSaleId: string });

export interface EntryAmounts {
  baseAmount: number;
  amount: number;
}

export interface CommissionEntryFilters {
  barberId?: string;
  periodId?: string;

  from?: Date;
  to?: Date;
}

export interface Page {
  limit: number;
  offset: number;
}

export class CommissionEntriesRepository {
  private readonly dataSource: DataSource;

  constructor({ dataSource }: Cradle) {
    this.dataSource = dataSource;
  }

  async create(data: NewCommissionEntry, manager?: EntityManager): Promise<CommissionEntry> {
    const repository = this.repo(manager);

    try {
      return await repository.save(repository.create(data));
    } catch (error) {

      if (isUniqueViolation(error)) {
        throw new ConflictError(
          'appointmentId' in data
            ? 'This appointment already has a commission entry'
            : 'This sale already has a commission entry',
        );
      }
      throw error;
    }
  }

  async findById(id: string, manager?: EntityManager): Promise<CommissionEntry | null> {
    return this.repo(manager).findOneBy({ id });
  }

  async findByAppointment(
    appointmentId: string,
    manager?: EntityManager,
  ): Promise<CommissionEntry | null> {
    return this.repo(manager).findOneBy({ appointmentId });
  }

  async findByProductSales(
    productSaleIds: string[],
    manager?: EntityManager,
  ): Promise<CommissionEntry[]> {
    if (productSaleIds.length === 0) return [];

    return this.repo(manager).find({
      where: { productSaleId: In(productSaleIds) },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  async updateAmounts(
    id: string,
    amounts: EntryAmounts,
    manager?: EntityManager,
  ): Promise<CommissionEntry | null> {
    await this.repo(manager).update({ id }, amounts);

    return this.findById(id, manager);
  }

  async zeroAmounts(ids: string[], manager?: EntityManager): Promise<number> {
    if (ids.length === 0) return 0;

    const result = await this.repo(manager).update(
      { id: In(ids), periodId: IsNull() },
      { baseAmount: 0, amount: 0 },
    );

    return result.affected ?? 0;
  }

  async findUnassignedInRange(
    barberId: string,
    start: Date,
    end: Date,
    manager?: EntityManager,
  ): Promise<CommissionEntry[]> {
    return this.repo(manager).find({
      where: {
        barberId,
        periodId: IsNull(),
        createdAt: And(MoreThanOrEqual(start), LessThan(end)),
      },
      order: { createdAt: 'ASC' },
    });
  }

  async findByPeriod(periodId: string, manager?: EntityManager): Promise<CommissionEntry[]> {
    return this.repo(manager).find({ where: { periodId }, order: { createdAt: 'ASC' } });
  }

  async assignPeriod(ids: string[], periodId: string, manager?: EntityManager): Promise<number> {
    if (ids.length === 0) return 0;

    const result = await this.repo(manager).update(
      { id: In(ids), periodId: IsNull() },
      { periodId },
    );

    return result.affected ?? 0;
  }

  async findMany(
    filters: CommissionEntryFilters,
    page: Page,
  ): Promise<[CommissionEntry[], number]> {
    const createdAt = boundsFor(filters);

    return this.repo().findAndCount({
      where: {
        ...(filters.barberId ? { barberId: filters.barberId } : {}),
        ...(filters.periodId ? { periodId: filters.periodId } : {}),
        ...(createdAt ? { createdAt } : {}),
      },
      order: { createdAt: 'DESC', id: 'ASC' },
      take: page.limit,
      skip: page.offset,
    });
  }

  private repo(manager?: EntityManager): Repository<CommissionEntry> {
    return (manager ?? this.dataSource).getRepository(CommissionEntry);
  }
}

function boundsFor(filters: CommissionEntryFilters) {
  if (filters.from && filters.to)
    return And(MoreThanOrEqual(filters.from), LessThanOrEqual(filters.to));
  if (filters.from) return MoreThanOrEqual(filters.from);
  if (filters.to) return LessThanOrEqual(filters.to);

  return undefined;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}
