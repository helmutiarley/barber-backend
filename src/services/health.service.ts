import type { Cradle } from '../container';
import type { HealthRepository } from '../repositories/health.repository';

export interface HealthStatus {
  status: 'ok';
}

export class HealthService {
  private readonly healthRepository: HealthRepository;

  constructor({ healthRepository }: Cradle) {
    this.healthRepository = healthRepository;
  }

  async check(): Promise<HealthStatus> {
    await this.healthRepository.ping();
    return { status: 'ok' };
  }
}
