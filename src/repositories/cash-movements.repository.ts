import type { DataSource, EntityManager, Repository } from 'typeorm';
import type { Cradle } from '../container';
import { CashMovement } from '../entities/cash-movement.entity';
import type {
  CashMovementDiscountReason,
  CashMovementSource,
  CashMovementType,
  PaymentMethod,
} from '../entities/enums';
import { decimalStringToCents } from '../lib/money';
import { requireShopId } from '../lib/shop-context';

export interface NewMovement {
  sessionId: string;
  type: CashMovementType;
  source: CashMovementSource;
  method?: PaymentMethod;

  amount: number;
  discountAmount?: number;
  discountReason?: CashMovementDiscountReason | null;
  paymentId?: string | null;
  expenseId?: string | null;
  advanceId?: string | null;
  periodId?: string | null;
  description?: string | null;
  createdBy: string;
}

export interface MethodTotals {
  method: PaymentMethod;
  in: number;
  out: number;
  discount: number;
}

export interface MovementTotals {
  in: number;
  out: number;
  cashIn: number;
  cashOut: number;
  discount: number;
  byMethod: MethodTotals[];
}

interface RawMethodTotals {
  method: PaymentMethod;
  in: string | null;
  out: string | null;
  discount: string | null;
}

export class CashMovementsRepository {
  private readonly dataSource: DataSource;
  private readonly shopId: string;

  constructor({ dataSource, currentShop }: Cradle) {
    this.dataSource = dataSource;
    this.shopId = requireShopId(currentShop);
  }

  async create(data: NewMovement, manager?: EntityManager): Promise<CashMovement> {
    const repository = this.repo(manager);

    return repository.save(
      repository.create({
        method: 'cash',
        discountAmount: 0,
        discountReason: null,
        paymentId: null,
        expenseId: null,
        advanceId: null,
        periodId: null,
        description: null,
        shopId: this.shopId,
        ...data,
      }),
    );
  }

  async findBySession(sessionId: string): Promise<CashMovement[]> {
    return this.repo().find({
      where: { sessionId, shopId: this.shopId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  async sumBySession(sessionId: string, manager?: EntityManager): Promise<MovementTotals> {
    const rows = await this.repo(manager)
      .createQueryBuilder('m')
      .select('m.method::text', 'method')
      .addSelect(`SUM(m.amount) FILTER (WHERE m.type = 'in')`, 'in')
      .addSelect(`SUM(m.amount) FILTER (WHERE m.type = 'out')`, 'out')
      .addSelect(
        `SUM(CASE WHEN m.type = 'in' THEN m.discount_amount ELSE -m.discount_amount END)`,
        'discount',
      )
      .where('m.session_id = :sessionId', { sessionId })
      .andWhere('m.shop_id = :shopId', { shopId: this.shopId })
      .groupBy('1')
      .getRawMany<RawMethodTotals>();

    const byMethod = rows.map((row) => ({
      method: row.method,
      in: row.in ? decimalStringToCents(row.in) : 0,
      out: row.out ? decimalStringToCents(row.out) : 0,
      discount: row.discount ? decimalStringToCents(row.discount) : 0,
    }));

    const cash = byMethod.find((row) => row.method === 'cash');

    return {
      in: byMethod.reduce((total, row) => total + row.in, 0),
      out: byMethod.reduce((total, row) => total + row.out, 0),
      cashIn: cash?.in ?? 0,
      cashOut: cash?.out ?? 0,
      discount: byMethod.reduce((total, row) => total + row.discount, 0),
      byMethod,
    };
  }

  private repo(manager?: EntityManager): Repository<CashMovement> {
    return (manager ?? this.dataSource).getRepository(CashMovement);
  }
}
