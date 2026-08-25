import { pino } from 'pino';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import type { AppConfig } from '../../src/config';
import { buildContainer } from '../../src/container';

const testConfig: AppConfig = {
  nodeEnv: 'test',
  port: 0,
  databaseUrl: 'postgres://unused:unused@localhost:5432/unused',
  logLevel: 'silent',
  jwtSecret: 'test-jwt-secret-that-is-at-least-32-characters-long',
  accessTokenTtl: '15m',
  refreshTokenTtlDays: 30,
  shopTimezone: 'America/Sao_Paulo',
  cancellationWindowHours: 24,
  cardFeeRates: { debit: 0.015, credit: 0.035 },
};

function buildTestApp(dataSource: Partial<DataSource>) {
  const container = buildContainer({
    config: testConfig,
    logger: pino({ level: 'silent' }),
    dataSource: dataSource as DataSource,
  });
  return createApp(container);
}

describe('GET /health', () => {
  it('returns 200 with status ok when the database responds', async () => {
    const query = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
    const app = buildTestApp({ query });

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns the 500 INTERNAL shape when the controller throws an unknown error', async () => {
    const app = buildTestApp({ query: vi.fn().mockRejectedValue(new Error('db down')) });

    const response = await request(app).get('/health');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL', message: 'Internal server error' },
    });
  });
});

describe('unknown routes', () => {
  it('returns the 404 NOT_FOUND shape', async () => {
    const app = buildTestApp({ query: vi.fn() });

    const response = await request(app).get('/nope');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /nope not found' },
    });
  });
});
