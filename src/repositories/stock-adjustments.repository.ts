import type { DataSource, EntityManager, Repository } from 'typeorm';
import type { Cradle } from '../container';
import type { StockAdjustmentReason } from '../entities/enums';
import { StockAdjustment } from '../entities/stock-adjustment.entity';
import { requireShopId } from '../lib/shop-context';

export interface NewStockAdjustment {
  productId: string;
  delta: number;
  reason: StockAdjustmentReason;
  resultingQuantity: number;
  notes?: string | null;
  createdBy: string;
}

export interface Page {
  limit: number;
  offset: number;
}

export class StockAdjustmentsRepository {
  private readonly dataSource: DataSource;
  private readonly shopId: string;

  constructor({ dataSource, currentShop }: Cradle) {
    this.dataSource = dataSource;
    this.shopId = requireShopId(currentShop);
  }

  async create(data: NewStockAdjustment, manager?: EntityManager): Promise<StockAdjustment> {
    const repository = this.repo(manager);

    return repository.save(repository.create({ notes: null, shopId: this.shopId, ...data }));
  }

  async findByProduct(
    productId: string,
    page: Page,
    manager?: EntityManager,
  ): Promise<[StockAdjustment[], number]> {
    return this.repo(manager).findAndCount({
      where: { productId, shopId: this.shopId },
      order: { createdAt: 'DESC', id: 'ASC' },
      take: page.limit,
      skip: page.offset,
    });
  }

  private repo(manager?: EntityManager): Repository<StockAdjustment> {
    return (manager ?? this.dataSource).getRepository(StockAdjustment);
  }
}
