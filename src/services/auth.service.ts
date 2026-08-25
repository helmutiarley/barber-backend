import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config';
import type { Cradle } from '../container';
import type { User } from '../entities/user.entity';
import { ConflictError, UnauthorizedError } from '../errors/app-error';
import type { Clock } from '../lib/clock';
import { hashPassword, verifyPassword } from '../lib/password';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../lib/tokens';
import type { RefreshTokensRepository } from '../repositories/refresh-tokens.repository';
import type { UsersRepository } from '../repositories/users.repository';
import { toUserDto, type UserDto } from './users.service';

export interface RegisterInput {
  name: string;
  email: string;
  phone?: string | null;
  password: string;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: UserDto;
}

const DAY_IN_MS = 86_400_000;

export class AuthService {
  private readonly usersRepository: UsersRepository;
  private readonly refreshTokensRepository: RefreshTokensRepository;
  private readonly config: AppConfig;
  private readonly clock: Clock;

  constructor({ usersRepository, refreshTokensRepository, config, clock }: Cradle) {
    this.usersRepository = usersRepository;
    this.refreshTokensRepository = refreshTokensRepository;
    this.config = config;
    this.clock = clock;
  }

  async register(input: RegisterInput): Promise<AuthResult> {
    const existing = await this.usersRepository.findByEmail(input.email);
    if (existing) {
      throw new ConflictError('This email is already registered');
    }

    const user = await this.usersRepository.create({
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      passwordHash: await hashPassword(input.password),

      role: 'CLIENT',
    });

    return this.issueTokens(user, randomUUID());
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.usersRepository.findByEmailWithPassword(email);

    if (!user || !user.active || !user.passwordHash) {
      throw new UnauthorizedError('Invalid credentials');
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      throw new UnauthorizedError('Invalid credentials');
    }

    return this.issueTokens(user, randomUUID());
  }

  async refresh(token: string): Promise<AuthResult> {
    const stored = await this.refreshTokensRepository.findByHash(hashRefreshToken(token));
    const now = this.clock.now();

    if (!stored) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    if (stored.revokedAt) {
      await this.refreshTokensRepository.revokeFamily(stored.familyId, now);
      throw new UnauthorizedError('Invalid refresh token');
    }

    if (stored.expiresAt.getTime() <= now.getTime()) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    const user = await this.usersRepository.findById(stored.userId);
    if (!user || !user.active) {
      await this.refreshTokensRepository.revokeFamily(stored.familyId, now);
      throw new UnauthorizedError('Invalid refresh token');
    }

    await this.refreshTokensRepository.revoke(stored.id, now);

    return this.issueTokens(user, stored.familyId);
  }

  async logout(token: string): Promise<void> {
    const stored = await this.refreshTokensRepository.findByHash(hashRefreshToken(token));
    if (stored && !stored.revokedAt) {
      await this.refreshTokensRepository.revoke(stored.id, this.clock.now());
    }
  }

  private async issueTokens(user: User, familyId: string): Promise<AuthResult> {
    const refreshToken = generateRefreshToken();

    await this.refreshTokensRepository.create({
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      familyId,
      expiresAt: new Date(this.clock.now().getTime() + this.config.refreshTokenTtlDays * DAY_IN_MS),
    });

    return {
      accessToken: signAccessToken(this.config, { sub: user.id, role: user.role }),
      refreshToken,
      user: toUserDto(user),
    };
  }
}
