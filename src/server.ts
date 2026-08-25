import 'reflect-metadata';
import 'dotenv/config';
import { createApp } from './app';
import { loadConfig } from './config';
import { buildContainer } from './container';
import { createDataSource } from './lib/data-source';
import { createLogger } from './lib/logger';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  const dataSource = createDataSource(config);
  await dataSource.initialize();
  logger.info('database connection established');

  const container = buildContainer({ config, logger, dataSource });
  const app = createApp(container);

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.nodeEnv }, 'server listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await dataSource.destroy();
      logger.info('shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

function describeStartupError(error: unknown): string {
  if ((error as { code?: string }).code === 'ECONNREFUSED') {
    return 'cannot reach the database — start it with `npm run start:db`';
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

main().catch((error) => {

  console.error(describeStartupError(error));
  process.exit(1);
});
