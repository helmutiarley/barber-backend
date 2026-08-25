import type { DataSource, EntityManager, Repository } from 'typeorm';
import type { Cradle } from '../container';
import { CashMovement } from '../entities/cash-movement.entity';
import type { CashMovementSource, CashMovementType } from '../entities/enums';
import { decimalStringToCents } from '../lib/money';

export interface NewMovement {
  sessionId: string;
  type: CashMovementType;
  source: CashMovementSource;

  amount: number;
  paymentId?: string | null;
  expenseId?: string | null;
  advanceId?: string | null;
  periodId?: string | null;
  description?: string | null;
  createdBy: string;
}

export interface MovementTotals {
  in: number;
  out: number;
}

interface RawTotals {
  in: string | null;
  out: string | null;
}

export class CashMovementsRepository {
  private readonly dataSource: DataSource;

  constructor({ dataSource }: Cradle) {
    this.dataSource = dataSource;
  }

  async create(data: NewMovement, manager?: EntityManager): Promise<CashMovement> {
    const repository = this.repo(manager);

    return repository.save(
      repository.create({
        paymentId: null,
        expenseId: null,
        advanceId: null,
        periodId: null,
        description: null,
        ...data,
      }),
    );
  }

  async findBySession(sessionId: string): Promise<CashMovement[]> {
    return this.repo().find({ where: { sessionId }, order: { createdAt: 'ASC', id: 'ASC' } });
  }

  async sumBySession(sessionId: string, manager?: EntityManager): Promise<MovementTotals> {
    const raw = await this.repo(manager)
      .createQueryBuilder('m')
      .select(`SUM(m.amount) FILTER (WHERE m.type = 'in')`, 'in')
      .addSelect(`SUM(m.amount) FILTER (WHERE m.type = 'out')`, 'out')
      .where('m.session_id = :sessionId', { sessionId })
      .getRawOne<RawTotals>();

    return {

      in: raw?.in ? decimalStringToCents(raw.in) : 0,
      out: raw?.out ? decimalStringToCents(raw.out) : 0,
    };
  }

  private repo(manager?: EntityManager): Repository<CashMovement> {
    return (manager ?? this.dataSource).getRepository(CashMovement);
  }
}
