import type { Request, Response } from 'express';
import type { Cradle } from '../container';
import type { HealthService } from '../services/health.service';

export class HealthController {
  private readonly healthService: HealthService;

  constructor({ healthService }: Cradle) {
    this.healthService = healthService;
  }

  check = async (_req: Request, res: Response): Promise<void> => {
    res.json(await this.healthService.check());
  };
}
