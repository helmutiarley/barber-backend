import type { Cradle } from '../container';
import type { UserRole } from '../entities/enums';
import type { User } from '../entities/user.entity';
import { ConflictError, NotFoundError, UnauthorizedError } from '../errors/app-error';
import { hashPassword, verifyPassword } from '../lib/password';
import type { UserFilters, UsersRepository } from '../repositories/users.repository';
import type { BarbersService } from './barbers.service';

export interface UserDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  active: boolean;
  createdAt: string;
}

export interface UpdateSelfInput {
  name?: string;
  phone?: string | null;
  currentPassword?: string;
  newPassword?: string;
}

export interface CreateStaffInput {
  name: string;
  email: string;
  phone?: string | null;
  password: string;
  role: Extract<UserRole, 'MANAGER' | 'BARBER'>;
}

export interface UpdateUserInput {
  name?: string;
  phone?: string | null;
  role?: UserRole;
  active?: boolean;
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
  };
}

export class UsersService {
  private readonly usersRepository: UsersRepository;
  private readonly barbersService: BarbersService;

  constructor({ usersRepository, barbersService }: Cradle) {
    this.usersRepository = usersRepository;
    this.barbersService = barbersService;
  }

  async getById(id: string): Promise<UserDto> {
    const user = await this.usersRepository.findById(id);
    if (!user) {
      throw new NotFoundError(`User ${id} not found`);
    }

    return toUserDto(user);
  }

  async updateSelf(id: string, input: UpdateSelfInput): Promise<UserDto> {
    const user = await this.usersRepository.findByIdWithPassword(id);
    if (!user) {
      throw new NotFoundError(`User ${id} not found`);
    }

    const changes: Parameters<UsersRepository['update']>[1] = {};
    if (input.name !== undefined) changes.name = input.name;
    if (input.phone !== undefined) changes.phone = input.phone;

    if (input.newPassword) {

      const currentIsValid =
        user.passwordHash !== null &&
        input.currentPassword !== undefined &&
        (await verifyPassword(user.passwordHash, input.currentPassword));

      if (!currentIsValid) {
        throw new UnauthorizedError('Current password is incorrect');
      }

      changes.passwordHash = await hashPassword(input.newPassword);
    }

    const updated = await this.usersRepository.update(id, changes);
    return toUserDto(updated!);
  }

  async createStaff(input: CreateStaffInput): Promise<UserDto> {
    const existing = await this.usersRepository.findByEmail(input.email);
    if (existing) {
      throw new ConflictError('This email is already registered');
    }

    const user = await this.usersRepository.create({
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      passwordHash: await hashPassword(input.password),
      role: input.role,
    });

    return toUserDto(user);
  }

  async list(filters: UserFilters): Promise<UserDto[]> {
    const users = await this.usersRepository.findMany(filters);
    return users.map(toUserDto);
  }

  async updateUser(id: string, input: UpdateUserInput): Promise<UserDto> {
    const user = await this.usersRepository.findById(id);
    if (!user) {
      throw new NotFoundError(`User ${id} not found`);
    }

    if (input.active === false && user.role === 'BARBER') {
      await this.barbersService.deactivateByUserId(user.id);
    }

    const updated = await this.usersRepository.update(id, input);
    return toUserDto(updated!);
  }
}
