import type { DataSource } from 'typeorm';
import type { Cradle } from '../container';

export class HealthRepository {
  private readonly dataSource: DataSource;

  constructor({ dataSource }: Cradle) {
    this.dataSource = dataSource;
  }

  async ping(): Promise<void> {
    await this.dataSource.query('SELECT 1');
  }
}
