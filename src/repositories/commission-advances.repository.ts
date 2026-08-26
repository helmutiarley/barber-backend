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
import { CommissionAdvance } from '../entities/commission-advance.entity';
import { requireShopId } from '../lib/shop-context';

export interface NewCommissionAdvance {
  barberId: string;
  amount: number;
  notes: string | null;
  createdBy: string;
}

export interface CommissionAdvanceFilters {
  barberId?: string;
  periodId?: string;

  unassigned?: boolean;

  from?: Date;
  to?: Date;
}

export interface Page {
  limit: number;
  offset: number;
}

export class CommissionAdvancesRepository {
  private readonly dataSource: DataSource;
  private readonly shopId: string;

  constructor({ dataSource, currentShop }: Cradle) {
    this.dataSource = dataSource;
    this.shopId = requireShopId(currentShop);
  }

  async create(data: NewCommissionAdvance, manager?: EntityManager): Promise<CommissionAdvance> {
    const repository = this.repo(manager);

    return repository.save(repository.create({ ...data, shopId: this.shopId }));
  }

  async findById(id: string, manager?: EntityManager): Promise<CommissionAdvance | null> {
    return this.repo(manager).findOneBy({ id, shopId: this.shopId });
  }

  async findUnassignedInRange(
    barberId: string,
    start: Date,
    end: Date,
    manager?: EntityManager,
  ): Promise<CommissionAdvance[]> {
    return this.repo(manager).find({
      where: {
        barberId,
        shopId: this.shopId,
        periodId: IsNull(),
        createdAt: And(MoreThanOrEqual(start), LessThan(end)),
      },
      order: { createdAt: 'ASC' },
    });
  }

  async findByPeriod(periodId: string, manager?: EntityManager): Promise<CommissionAdvance[]> {
    return this.repo(manager).find({
      where: { periodId, shopId: this.shopId },
      order: { createdAt: 'ASC' },
    });
  }

  async assignPeriod(ids: string[], periodId: string, manager?: EntityManager): Promise<number> {
    if (ids.length === 0) return 0;

    const result = await this.repo(manager).update(
      { id: In(ids), shopId: this.shopId, periodId: IsNull() },
      { periodId },
    );

    return result.affected ?? 0;
  }

  async findMany(
    filters: CommissionAdvanceFilters,
    page: Page,
  ): Promise<[CommissionAdvance[], number]> {
    const createdAt = boundsFor(filters);

    return this.repo().findAndCount({
      where: {
        shopId: this.shopId,
        ...(filters.barberId ? { barberId: filters.barberId } : {}),
        ...(filters.periodId ? { periodId: filters.periodId } : {}),
        ...(filters.unassigned ? { periodId: IsNull() } : {}),
        ...(createdAt ? { createdAt } : {}),
      },
      order: { createdAt: 'DESC', id: 'ASC' },
      take: page.limit,
      skip: page.offset,
    });
  }

  private repo(manager?: EntityManager): Repository<CommissionAdvance> {
    return (manager ?? this.dataSource).getRepository(CommissionAdvance);
  }
}

function boundsFor(filters: CommissionAdvanceFilters) {
  if (filters.from && filters.to)
    return And(MoreThanOrEqual(filters.from), LessThanOrEqual(filters.to));
  if (filters.from) return MoreThanOrEqual(filters.from);
  if (filters.to) return LessThanOrEqual(filters.to);

  return undefined;
}
