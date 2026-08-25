import type { FindOptionsWhere, Repository } from 'typeorm';
import type { Cradle } from '../container';
import { Barber } from '../entities/barber.entity';

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

  constructor({ dataSource }: Cradle) {
    this.repository = dataSource.getRepository(Barber);
  }

  async findById(id: string): Promise<Barber | null> {
    return this.repository.findOneBy({ id });
  }

  async findByUserId(userId: string): Promise<Barber | null> {
    return this.repository.findOneBy({ userId });
  }

  async findMany(filters: BarberFilters = {}): Promise<Barber[]> {
    const where: FindOptionsWhere<Barber> = {};
    if (filters.active !== undefined) where.active = filters.active;

    return this.repository.find({ where, order: { displayName: 'ASC' } });
  }

  async create(data: NewBarber): Promise<Barber> {
    return this.repository.save(
      this.repository.create({ photoUrl: null, specialties: [], ...data }),
    );
  }

  async update(
    id: string,
    data: Partial<Omit<NewBarber, 'userId'>> & { active?: boolean },
  ): Promise<Barber | null> {

    if (Object.keys(data).length > 0) {
      await this.repository.update({ id }, data);
    }

    return this.findById(id);
  }
}
