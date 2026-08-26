import { IsNull, type EntityManager, type FindOptionsWhere, type Repository } from 'typeorm';
import type { Cradle } from '../container';
import type { UserRole } from '../entities/enums';
import { User } from '../entities/user.entity';

export interface NewUser {
  name: string;
  email?: string | null;
  phone?: string | null;
  passwordHash?: string | null;
  role: UserRole;
}

export interface UserFilters {
  role?: UserRole;
  active?: boolean;
}

export class UsersRepository {
  private readonly repository: Repository<User>;

  private readonly shopId: string | null;

  constructor({ dataSource, currentShop }: Cradle) {
    this.repository = dataSource.getRepository(User);
    this.shopId = currentShop?.id ?? null;
  }

  async findById(id: string): Promise<User | null> {
    return this.repository.findOneBy({ id, ...this.shopWhere() });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repository.findOneBy({ email, ...this.shopWhere() });
  }

  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.scopedQuery()
      .addSelect('user.passwordHash')
      .andWhere('user.email = :email', { email })
      .getOne();
  }

  async findByIdWithPassword(id: string): Promise<User | null> {
    return this.scopedQuery()
      .addSelect('user.passwordHash')
      .andWhere('user.id = :id', { id })
      .getOne();
  }

  async findActiveClientByPhone(phone: string, manager?: EntityManager): Promise<User | null> {
    const digits = onlyDigits(phone);
    if (digits.length === 0) {
      return null;
    }

    return this.scopedQuery(manager)
      .andWhere('user.role = :role', { role: 'CLIENT' })
      .andWhere('user.active = true')
      .andWhere(`regexp_replace(user.phone, '\\D', '', 'g') = :digits`, { digits })
      .orderBy('user.createdAt', 'ASC')
      .getOne();
  }

  async create(data: NewUser, manager?: EntityManager): Promise<User> {
    const repository = this.repo(manager);

    return repository.save(
      repository.create({
        email: null,
        phone: null,
        passwordHash: null,
        shopId: this.shopId,
        ...data,
      }),
    );
  }

  async update(id: string, data: Partial<NewUser> & { active?: boolean }): Promise<User | null> {
    if (Object.keys(data).length > 0) {
      await this.repository.update({ id, ...this.shopWhere() }, data);
    }

    return this.findById(id);
  }

  async findMany(filters: UserFilters = {}): Promise<User[]> {
    const where: FindOptionsWhere<User> = { ...this.shopWhere() };
    if (filters.role !== undefined) where.role = filters.role;
    if (filters.active !== undefined) where.active = filters.active;

    return this.repository.find({ where, order: { createdAt: 'DESC' } });
  }

  private repo(manager?: EntityManager): Repository<User> {
    return manager ? manager.getRepository(User) : this.repository;
  }

  private shopWhere(): FindOptionsWhere<User> {
    return { shopId: this.shopId === null ? IsNull() : this.shopId };
  }

  private scopedQuery(manager?: EntityManager) {
    const query = this.repo(manager).createQueryBuilder('user');

    return this.shopId === null
      ? query.where('user.shopId IS NULL')
      : query.where('user.shopId = :shopId', { shopId: this.shopId });
  }
}

export function onlyDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}
