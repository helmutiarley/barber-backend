import type { DataSource, EntityManager, Repository } from 'typeorm';
import type { Cradle } from '../container';
import type { StockAdjustmentReason } from '../entities/enums';
import { StockAdjustment } from '../entities/stock-adjustment.entity';

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

  constructor({ dataSource }: Cradle) {
    this.dataSource = dataSource;
  }

  async create(data: NewStockAdjustment, manager?: EntityManager): Promise<StockAdjustment> {
    const repository = this.repo(manager);

    return repository.save(repository.create({ notes: null, ...data }));
  }

  async findByProduct(
    productId: string,
    page: Page,
    manager?: EntityManager,
  ): Promise<[StockAdjustment[], number]> {
    return this.repo(manager).findAndCount({
      where: { productId },
      order: { createdAt: 'DESC', id: 'ASC' },
      take: page.limit,
      skip: page.offset,
    });
  }

  private repo(manager?: EntityManager): Repository<StockAdjustment> {
    return (manager ?? this.dataSource).getRepository(StockAdjustment);
  }
}
