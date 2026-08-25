import type { FindOptionsWhere, Repository } from 'typeorm';
import type { Cradle } from '../container';
import type { UserRole } from '../entities/enums';
import { User } from '../entities/user.entity';

export interface NewUser {
  name: string;
  email: string;
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

  constructor({ dataSource }: Cradle) {
    this.repository = dataSource.getRepository(User);
  }

  async findById(id: string): Promise<User | null> {
    return this.repository.findOneBy({ id });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repository.findOneBy({ email });
  }

  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.repository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();
  }

  async findByIdWithPassword(id: string): Promise<User | null> {
    return this.repository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id })
      .getOne();
  }

  async create(data: NewUser): Promise<User> {
    return this.repository.save(
      this.repository.create({ phone: null, passwordHash: null, ...data }),
    );
  }

  async update(id: string, data: Partial<NewUser> & { active?: boolean }): Promise<User | null> {

    if (Object.keys(data).length > 0) {
      await this.repository.update({ id }, data);
    }

    return this.findById(id);
  }

  async findMany(filters: UserFilters = {}): Promise<User[]> {
    const where: FindOptionsWhere<User> = {};
    if (filters.role !== undefined) where.role = filters.role;
    if (filters.active !== undefined) where.active = filters.active;

    return this.repository.find({ where, order: { createdAt: 'DESC' } });
  }
}
