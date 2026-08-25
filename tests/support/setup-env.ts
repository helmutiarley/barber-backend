import { afterAll } from 'vitest';
import { closeTestDataSource } from './db';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://barber:barber@localhost:5432/barber_test';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long';

afterAll(closeTestDataSource);
