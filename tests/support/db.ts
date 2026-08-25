import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { loadConfig } from '../../src/config';
import { createDataSource } from '../../src/lib/data-source';

let connection: Promise<DataSource> | undefined;

const DISPOSABLE_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'postgres', 'db']);

function assertDisposable(databaseUrl: string): void {
  const { hostname } = new URL(databaseUrl);

  if (DISPOSABLE_HOSTS.has(hostname) || process.env.ALLOW_NONLOCAL_TEST_DB === 'true') {
    return;
  }

  throw new Error(
    `Refusing to run integration tests against "${hostname}": every table gets truncated. ` +
      'Point TEST_DATABASE_URL at a local database, or set ALLOW_NONLOCAL_TEST_DB=true if it really is disposable.',
  );
}

export function getTestDataSource(): Promise<DataSource> {
  connection ??= (async () => {
    const config = loadConfig();
    assertDisposable(config.databaseUrl);

    const dataSource = createDataSource(config);
    await dataSource.initialize();
    await dataSource.runMigrations();
    return dataSource;
  })();

  return connection;
}

export async function closeTestDataSource(): Promise<void> {
  if (!connection) return;

  const dataSource = await connection;
  connection = undefined;

  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
}

export async function truncateAll(dataSource: DataSource): Promise<void> {
  const tables = dataSource.entityMetadatas.map((metadata) => `"${metadata.tableName}"`).join(', ');

  await dataSource.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}
