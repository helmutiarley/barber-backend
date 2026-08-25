import { IsNull, type Repository } from 'typeorm';
import type { Cradle } from '../container';
import { RefreshToken } from '../entities/refresh-token.entity';

export interface NewRefreshToken {
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}

export class RefreshTokensRepository {
  private readonly repository: Repository<RefreshToken>;

  constructor({ dataSource }: Cradle) {
    this.repository = dataSource.getRepository(RefreshToken);
  }

  async create(data: NewRefreshToken): Promise<RefreshToken> {
    return this.repository.save(this.repository.create({ ...data, revokedAt: null }));
  }

  async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.repository.findOneBy({ tokenHash });
  }

  async revoke(id: string, revokedAt: Date): Promise<void> {
    await this.repository.update({ id, revokedAt: IsNull() }, { revokedAt });
  }

  async revokeFamily(familyId: string, revokedAt: Date): Promise<void> {
    await this.repository.update({ familyId, revokedAt: IsNull() }, { revokedAt });
  }
}
