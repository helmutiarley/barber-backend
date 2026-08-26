import type { FindOptionsWhere, Repository } from 'typeorm';
import type { Cradle } from '../container';
import { Service } from '../entities/service.entity';
import { requireShopId } from '../lib/shop-context';

export interface NewService {
  name: string;
  description?: string | null;

  price: number;
  durationMinutes: number;
}

export interface ServiceFilters {
  active?: boolean;
}

export class ServicesRepository {
  private readonly repository: Repository<Service>;
  private readonly shopId: string;

  constructor({ dataSource, currentShop }: Cradle) {
    this.repository = dataSource.getRepository(Service);
    this.shopId = requireShopId(currentShop);
  }

  async findById(id: string): Promise<Service | null> {
    return this.repository.findOneBy({ id, shopId: this.shopId });
  }

  async findActiveByName(name: string): Promise<Service | null> {
    return this.repository.findOneBy({ name, active: true, shopId: this.shopId });
  }

  async findMany(filters: ServiceFilters = {}): Promise<Service[]> {
    const where: FindOptionsWhere<Service> = { shopId: this.shopId };
    if (filters.active !== undefined) where.active = filters.active;

    return this.repository.find({ where, order: { name: 'ASC' } });
  }

  async create(data: NewService): Promise<Service> {
    return this.repository.save(
      this.repository.create({ description: null, shopId: this.shopId, ...data }),
    );
  }

  async update(
    id: string,
    data: Partial<NewService> & { active?: boolean },
  ): Promise<Service | null> {
    if (Object.keys(data).length > 0) {
      await this.repository.update({ id, shopId: this.shopId }, data);
    }

    return this.findById(id);
  }
}
