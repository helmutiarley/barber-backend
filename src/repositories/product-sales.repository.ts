import {
  And,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
  type DataSource,
  type EntityManager,
  type Repository,
} from 'typeorm';
import type { Cradle } from '../container';
import { ProductSale } from '../entities/product-sale.entity';

export interface NewProductSale {
  productId: string;
  quantity: number;

  unitPrice: number;
  total: number;
  soldByBarberId: string | null;
  clientId: string | null;
  paymentId: string;
  createdBy: string;
}

export interface SaleVoid {
  voidedAt: Date;
  voidedBy: string;
  voidReason: string | null;
}

export interface ProductSaleFilters {
  productId?: string;
  barberId?: string;
  clientId?: string;

  from?: Date;
  to?: Date;

  voided?: boolean;
}

export interface Page {
  limit: number;
  offset: number;
}

export class ProductSalesRepository {
  private readonly dataSource: DataSource;

  constructor({ dataSource }: Cradle) {
    this.dataSource = dataSource;
  }

  async create(data: NewProductSale[], manager?: EntityManager): Promise<ProductSale[]> {
    const repository = this.repo(manager);

    return repository.save(repository.create(data));
  }

  async findById(id: string, manager?: EntityManager): Promise<ProductSale | null> {
    return this.repo(manager).findOneBy({ id });
  }

  async findByPayment(paymentId: string, manager?: EntityManager): Promise<ProductSale[]> {
    return this.repo(manager).find({
      where: { paymentId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  async void(ids: string[], data: SaleVoid, manager?: EntityManager): Promise<ProductSale[]> {
    if (ids.length === 0) return [];

    await this.repo(manager).update({ id: In(ids), voidedAt: IsNull() }, data);

    return this.repo(manager).find({
      where: { id: In(ids) },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  async findMany(filters: ProductSaleFilters, page: Page): Promise<[ProductSale[], number]> {
    const createdAt = boundsFor(filters);

    return this.repo().findAndCount({
      where: {
        ...(filters.productId ? { productId: filters.productId } : {}),
        ...(filters.barberId ? { soldByBarberId: filters.barberId } : {}),
        ...(filters.clientId ? { clientId: filters.clientId } : {}),
        ...(createdAt ? { createdAt } : {}),
        ...(filters.voided === undefined
          ? {}
          : { voidedAt: filters.voided ? Not(IsNull()) : IsNull() }),
      },
      order: { createdAt: 'DESC', id: 'ASC' },
      take: page.limit,
      skip: page.offset,
    });
  }

  private repo(manager?: EntityManager): Repository<ProductSale> {
    return (manager ?? this.dataSource).getRepository(ProductSale);
  }
}

function boundsFor(filters: ProductSaleFilters) {
  if (filters.from && filters.to)
    return And(MoreThanOrEqual(filters.from), LessThanOrEqual(filters.to));
  if (filters.from) return MoreThanOrEqual(filters.from);
  if (filters.to) return LessThanOrEqual(filters.to);

  return undefined;
}
