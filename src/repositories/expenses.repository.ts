import {
  IsNull,
  type DataSource,
  type EntityManager,
  type Repository,
  type SelectQueryBuilder,
} from 'typeorm';
import type { Cradle } from '../container';
import type { ExpenseCategory, ExpenseKind, PaymentMethod } from '../entities/enums';
import { Expense } from '../entities/expense.entity';
import { requireShopId } from '../lib/shop-context';

export interface NewExpense {
  description: string;
  category: ExpenseCategory;
  kind: ExpenseKind;
  amount: number;
  dueDate: string | null;
  paidAt: Date | null;
  paymentMethod: PaymentMethod | null;
  recurring: boolean;
  createdBy: string;
}

export interface ExpenseChanges {
  description?: string;
  category?: ExpenseCategory;
  kind?: ExpenseKind;
  amount?: number;
  dueDate?: string | null;
  paidAt?: Date | null;
  paymentMethod?: PaymentMethod | null;
  recurring?: boolean;
}

export interface PaidFields {
  paidAt: Date;
  paymentMethod: PaymentMethod;
}

export interface ExpenseFilters {
  category?: ExpenseCategory;
  kind?: ExpenseKind;
  paid?: boolean;

  from?: Date;
  to?: Date;

  overdue?: boolean;
  today?: string;
}

export interface Page {
  limit: number;
  offset: number;
}

export class ExpensesRepository {
  private readonly dataSource: DataSource;
  private readonly shopId: string;

  constructor({ dataSource, currentShop }: Cradle) {
    this.dataSource = dataSource;
    this.shopId = requireShopId(currentShop);
  }

  async create(data: NewExpense, manager?: EntityManager): Promise<Expense> {
    const repository = this.repo(manager);

    return repository.save(repository.create({ ...data, shopId: this.shopId }));
  }

  async findById(id: string, manager?: EntityManager): Promise<Expense | null> {
    return this.repo(manager).findOneBy({ id, shopId: this.shopId });
  }

  async update(
    id: string,
    changes: ExpenseChanges,
    manager?: EntityManager,
  ): Promise<Expense | null> {
    await this.repo(manager).update({ id, shopId: this.shopId }, changes);

    return this.findById(id, manager);
  }

  async markPaid(id: string, data: PaidFields, manager?: EntityManager): Promise<Expense | null> {
    const result = await this.repo(manager).update(
      { id, shopId: this.shopId, paidAt: IsNull() },
      data,
    );

    return result.affected === 0 ? null : this.findById(id, manager);
  }

  async delete(id: string): Promise<void> {
    await this.repo().delete({ id, shopId: this.shopId });
  }

  async findMany(filters: ExpenseFilters, page: Page): Promise<[Expense[], number]> {
    return (
      this.query(filters)

        .orderBy('e.due_date', 'ASC', 'NULLS LAST')
        .addOrderBy('e.paid_at', 'DESC', 'NULLS LAST')
        .addOrderBy('e.id', 'ASC')
        .take(page.limit)
        .skip(page.offset)
        .getManyAndCount()
    );
  }

  private query(filters: ExpenseFilters): SelectQueryBuilder<Expense> {
    const query = this.repo()
      .createQueryBuilder('e')
      .where('e.shop_id = :shopId', { shopId: this.shopId });

    if (filters.category) query.andWhere('e.category = :category', { category: filters.category });
    if (filters.kind) query.andWhere('e.kind = :kind', { kind: filters.kind });
    if (filters.paid !== undefined) {
      query.andWhere(filters.paid ? 'e.paid_at IS NOT NULL' : 'e.paid_at IS NULL');
    }
    if (filters.from) query.andWhere('e.paid_at >= :from', { from: filters.from });
    if (filters.to) query.andWhere('e.paid_at <= :to', { to: filters.to });
    if (filters.overdue && filters.today) {

      query
        .andWhere('e.paid_at IS NULL')
        .andWhere('e.due_date < :today::date', { today: filters.today });
    }

    return query;
  }

  private repo(manager?: EntityManager): Repository<Expense> {
    return (manager ?? this.dataSource).getRepository(Expense);
  }
}
