import {
  And,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  type DataSource,
  type EntityManager,
  type Repository,
} from 'typeorm';
import type { Cradle } from '../container';
import type { PaymentMethod } from '../entities/enums';
import { Payment } from '../entities/payment.entity';
import { decimalStringToCents } from '../lib/money';
import { requireShopId } from '../lib/shop-context';

export interface NewPayment {
  appointmentId: string | null;
  amount: number;
  method: PaymentMethod;
  cardFee: number;
  netAmount: number;
  cashRegisterSessionId: string | null;
  receivedBy: string;
  paidAt: Date;
}

export interface VoidData {
  voidedAt: Date;
  voidedBy: string;
  voidReason: string | null;
}

export interface PaymentFilters {
  method?: PaymentMethod;

  from?: Date;
  to?: Date;
  sessionId?: string;
}

export interface Page {
  limit: number;
  offset: number;
}

export class PaymentsRepository {
  private readonly dataSource: DataSource;
  private readonly shopId: string;

  constructor({ dataSource, currentShop }: Cradle) {
    this.dataSource = dataSource;
    this.shopId = requireShopId(currentShop);
  }

  async create(rows: NewPayment[], manager?: EntityManager): Promise<Payment[]> {
    const repository = this.repo(manager);

    return repository.save(rows.map((row) => repository.create({ ...row, shopId: this.shopId })));
  }

  async findById(id: string, manager?: EntityManager): Promise<Payment | null> {
    return this.repo(manager).findOneBy({ id, shopId: this.shopId });
  }

  async findByAppointment(appointmentId: string): Promise<Payment[]> {
    return this.repo().find({
      where: { appointmentId, shopId: this.shopId },
      order: { paidAt: 'ASC', id: 'ASC' },
    });
  }

  async sumPaidForAppointment(appointmentId: string, manager?: EntityManager): Promise<number> {
    const raw = await this.repo(manager)
      .createQueryBuilder('p')
      .select('SUM(p.amount)', 'total')
      .where('p.appointment_id = :appointmentId', { appointmentId })
      .andWhere('p.shop_id = :shopId', { shopId: this.shopId })
      .andWhere('p.voided_at IS NULL')
      .getRawOne<{ total: string | null }>();

    return raw?.total ? decimalStringToCents(raw.total) : 0;
  }

  async sumNetForAppointment(
    appointmentId: string,
    manager?: EntityManager,
  ): Promise<number | null> {
    const raw = await this.repo(manager)
      .createQueryBuilder('p')
      .select('SUM(p.net_amount)', 'total')
      .where('p.appointment_id = :appointmentId', { appointmentId })
      .andWhere('p.shop_id = :shopId', { shopId: this.shopId })
      .andWhere('p.voided_at IS NULL')
      .getRawOne<{ total: string | null }>();

    return raw?.total == null ? null : decimalStringToCents(raw.total);
  }

  async findMany(filters: PaymentFilters, page: Page): Promise<[Payment[], number]> {
    const paidAt = boundsFor(filters);

    return this.repo().findAndCount({
      where: {
        shopId: this.shopId,
        ...(filters.method ? { method: filters.method } : {}),
        ...(paidAt ? { paidAt } : {}),
        ...(filters.sessionId ? { cashRegisterSessionId: filters.sessionId } : {}),
      },
      order: { paidAt: 'DESC', id: 'ASC' },
      take: page.limit,
      skip: page.offset,
    });
  }

  async void(id: string, data: VoidData, manager?: EntityManager): Promise<Payment | null> {
    await this.repo(manager).update({ id, shopId: this.shopId, voidedAt: IsNull() }, data);

    return this.findById(id, manager);
  }

  private repo(manager?: EntityManager): Repository<Payment> {
    return (manager ?? this.dataSource).getRepository(Payment);
  }
}

function boundsFor(filters: PaymentFilters) {
  if (filters.from && filters.to)
    return And(MoreThanOrEqual(filters.from), LessThanOrEqual(filters.to));
  if (filters.from) return MoreThanOrEqual(filters.from);
  if (filters.to) return LessThanOrEqual(filters.to);

  return undefined;
}
