import type { FindOptionsWhere, Repository } from 'typeorm';
import type { Cradle } from '../container';
import { Service } from '../entities/service.entity';

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

  constructor({ dataSource }: Cradle) {
    this.repository = dataSource.getRepository(Service);
  }

  async findById(id: string): Promise<Service | null> {
    return this.repository.findOneBy({ id });
  }

  async findActiveByName(name: string): Promise<Service | null> {
    return this.repository.findOneBy({ name, active: true });
  }

  async findMany(filters: ServiceFilters = {}): Promise<Service[]> {
    const where: FindOptionsWhere<Service> = {};
    if (filters.active !== undefined) where.active = filters.active;

    return this.repository.find({ where, order: { name: 'ASC' } });
  }

  async create(data: NewService): Promise<Service> {
    return this.repository.save(this.repository.create({ description: null, ...data }));
  }

  async update(
    id: string,
    data: Partial<NewService> & { active?: boolean },
  ): Promise<Service | null> {

    if (Object.keys(data).length > 0) {
      await this.repository.update({ id }, data);
    }

    return this.findById(id);
  }
}
