import type { DataSource, EntityManager, Repository, SelectQueryBuilder } from 'typeorm';
import type { Cradle } from '../container';
import { Product } from '../entities/product.entity';
import { requireShopId } from '../lib/shop-context';

export interface NewProduct {
  name: string;
  description?: string | null;

  price: number;
  cost?: number | null;
  stockQuantity: number;
  lowStockThreshold: number;
}

export interface ProductChanges {
  name?: string;
  description?: string | null;
  price?: number;
  cost?: number | null;
  lowStockThreshold?: number;
  active?: boolean;
}

export interface ProductFilters {
  active?: boolean;

  lowStock?: boolean;
  search?: string;
}

export interface Page {
  limit: number;
  offset: number;
}

export class ProductsRepository {
  private readonly dataSource: DataSource;
  private readonly shopId: string;

  constructor({ dataSource, currentShop }: Cradle) {
    this.dataSource = dataSource;
    this.shopId = requireShopId(currentShop);
  }

  async create(data: NewProduct, manager?: EntityManager): Promise<Product> {
    const repository = this.repo(manager);

    return repository.save(
      repository.create({ description: null, cost: null, shopId: this.shopId, ...data }),
    );
  }

  async findById(id: string, manager?: EntityManager): Promise<Product | null> {
    return this.repo(manager).findOneBy({ id, shopId: this.shopId });
  }

  async findActiveByName(name: string, manager?: EntityManager): Promise<Product | null> {
    return this.repo(manager).findOneBy({ name, active: true, shopId: this.shopId });
  }

  async update(
    id: string,
    changes: ProductChanges,
    manager?: EntityManager,
  ): Promise<Product | null> {

    if (Object.keys(changes).length > 0) {
      await this.repo(manager).update({ id, shopId: this.shopId }, changes);
    }

    return this.findById(id, manager);
  }

  async applyDelta(id: string, delta: number, manager?: EntityManager): Promise<Product | null> {
    const result = await this.repo(manager)
      .createQueryBuilder()
      .update(Product)
      .set({ stockQuantity: () => '"stock_quantity" + :delta' })
      .where('id = :id', { id })
      .andWhere('shop_id = :shopId', { shopId: this.shopId })
      .andWhere('"stock_quantity" + :delta >= 0')
      .setParameter('delta', delta)
      .execute();

    return result.affected === 0 ? null : this.findById(id, manager);
  }

  async findMany(filters: ProductFilters, page: Page): Promise<[Product[], number]> {
    return this.query(filters)
      .orderBy('p.name', 'ASC')
      .addOrderBy('p.id', 'ASC')
      .take(page.limit)
      .skip(page.offset)
      .getManyAndCount();
  }

  private query(filters: ProductFilters): SelectQueryBuilder<Product> {
    const query = this.repo()
      .createQueryBuilder('p')
      .where('p.shop_id = :shopId', { shopId: this.shopId });

    if (filters.active !== undefined)
      query.andWhere('p.active = :active', { active: filters.active });
    if (filters.lowStock) query.andWhere('p.stock_quantity <= p.low_stock_threshold');
    if (filters.search) {
      query.andWhere('p.name ILIKE :search', { search: `%${filters.search}%` });
    }

    return query;
  }

  private repo(manager?: EntityManager): Repository<Product> {
    return (manager ?? this.dataSource).getRepository(Product);
  }
}
