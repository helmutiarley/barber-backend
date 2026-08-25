import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import type { AppConfig } from '../config';
import { entities } from '../entities';
import { migrations } from '../migrations';

export interface DataSourceOptions {

  logging?: boolean;
}

export function createDataSource(config: AppConfig, options: DataSourceOptions = {}): DataSource {
  return new DataSource({
    type: 'postgres',
    url: config.databaseUrl,
    synchronize: false,
    logging: options.logging ?? (config.logLevel === 'debug' || config.logLevel === 'trace'),
    namingStrategy: new SnakeNamingStrategy(),
    entities,
    migrations,
  });
}
