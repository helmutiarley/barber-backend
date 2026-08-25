import {
  And,
  LessThanOrEqual,
  MoreThanOrEqual,
  type DataSource,
  type EntityManager,
  type Repository,
} from 'typeorm';
import type { Cradle } from '../container';
import { CashRegisterSession } from '../entities/cash-register-session.entity';
import { ConflictError } from '../errors/app-error';

const UNIQUE_VIOLATION = '23505';
const ONE_OPEN_INDEX = 'uq_cash_sessions_one_open';

export interface NewSession {
  openedBy: string;
  openedAt: Date;
  openingBalance: number;
}

export interface CloseSnapshot {
  closedBy: string;
  closedAt: Date;
  expectedBalance: number;
  countedBalance: number;
  difference: number;
  notes: string | null;
}

export interface SessionFilters {

  from?: Date;
  to?: Date;
}

export interface Page {
  limit: number;
  offset: number;
}

export class CashRegisterSessionsRepository {
  private readonly dataSource: DataSource;

  constructor({ dataSource }: Cradle) {
    this.dataSource = dataSource;
  }

  async findOpen(manager?: EntityManager): Promise<CashRegisterSession | null> {
    return this.repo(manager).findOneBy({ status: 'open' });
  }

  async findById(id: string, manager?: EntityManager): Promise<CashRegisterSession | null> {
    return this.repo(manager).findOneBy({ id });
  }

  async findMany(filters: SessionFilters, page: Page): Promise<[CashRegisterSession[], number]> {
    const openedAt = boundsFor(filters);

    return this.repo().findAndCount({
      where: openedAt ? { openedAt } : {},
      order: { openedAt: 'DESC', id: 'ASC' },
      take: page.limit,
      skip: page.offset,
    });
  }

  async create(data: NewSession, manager?: EntityManager): Promise<CashRegisterSession> {
    const repository = this.repo(manager);

    try {
      return await repository.save(repository.create({ ...data, status: 'open' }));
    } catch (error) {

      if (isOneOpenViolation(error)) {
        throw new ConflictError('A cash register session is already open');
      }
      throw error;
    }
  }

  async close(
    id: string,
    snapshot: CloseSnapshot,
    manager?: EntityManager,
  ): Promise<CashRegisterSession | null> {
    await this.repo(manager).update({ id }, { ...snapshot, status: 'closed' });

    return this.findById(id, manager);
  }

  private repo(manager?: EntityManager): Repository<CashRegisterSession> {
    return (manager ?? this.dataSource).getRepository(CashRegisterSession);
  }
}

function boundsFor(filters: SessionFilters) {
  if (filters.from && filters.to)
    return And(MoreThanOrEqual(filters.from), LessThanOrEqual(filters.to));
  if (filters.from) return MoreThanOrEqual(filters.from);
  if (filters.to) return LessThanOrEqual(filters.to);

  return undefined;
}

function isOneOpenViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const { code, constraint } = error as { code?: unknown; constraint?: unknown };

  return code === UNIQUE_VIOLATION && constraint === ONE_OPEN_INDEX;
}
