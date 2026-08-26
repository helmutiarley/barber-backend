import type { FindOptionsWhere, Repository } from 'typeorm';
import type { Cradle } from '../container';
import { Barber } from '../entities/barber.entity';
import { requireShopId } from '../lib/shop-context';

export interface NewBarber {
  userId: string;
  displayName: string;
  photoUrl?: string | null;
  specialties?: string[];
}

export interface BarberFilters {
  active?: boolean;
}

export class BarbersRepository {
  private readonly repository: Repository<Barber>;
  private readonly shopId: string;

  constructor({ dataSource, currentShop }: Cradle) {
    this.repository = dataSource.getRepository(Barber);
    this.shopId = requireShopId(currentShop);
  }

  async findById(id: string): Promise<Barber | null> {
    return this.repository.findOneBy({ id, shopId: this.shopId });
  }

  async findByUserId(userId: string): Promise<Barber | null> {
    return this.repository.findOneBy({ userId, shopId: this.shopId });
  }

  async findMany(filters: BarberFilters = {}): Promise<Barber[]> {
    const where: FindOptionsWhere<Barber> = { shopId: this.shopId };
    if (filters.active !== undefined) where.active = filters.active;

    return this.repository.find({ where, order: { displayName: 'ASC' } });
  }

  async create(data: NewBarber): Promise<Barber> {
    return this.repository.save(
      this.repository.create({ photoUrl: null, specialties: [], shopId: this.shopId, ...data }),
    );
  }

  async update(
    id: string,
    data: Partial<Omit<NewBarber, 'userId'>> & { active?: boolean },
  ): Promise<Barber | null> {
    if (Object.keys(data).length > 0) {
      await this.repository.update({ id, shopId: this.shopId }, data);
    }

    return this.findById(id);
  }
}
