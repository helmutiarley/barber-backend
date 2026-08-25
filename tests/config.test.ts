import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '4000',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  LOG_LEVEL: 'warn',
  JWT_SECRET: 'a-secret-that-is-at-least-32-characters-long',
};

describe('loadConfig', () => {
  it('parses a valid environment into a typed config', () => {
    const config = loadConfig(validEnv);

    expect(config).toEqual({
      nodeEnv: 'test',
      port: 4000,
      databaseUrl: 'postgres://user:pass@localhost:5432/db',
      logLevel: 'warn',
      jwtSecret: validEnv.JWT_SECRET,
      accessTokenTtl: '15m',
      refreshTokenTtlDays: 30,
      shopTimezone: 'America/Sao_Paulo',
      cancellationWindowHours: 24,
      cardFeeRates: { debit: 0.015, credit: 0.035 },
    });
  });

  it('applies defaults for optional variables', () => {
    const config = loadConfig({
      DATABASE_URL: validEnv.DATABASE_URL,
      JWT_SECRET: validEnv.JWT_SECRET,
    });

    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe('info');
    expect(config.shopTimezone).toBe('America/Sao_Paulo');
    expect(config.cancellationWindowHours).toBe(24);
  });

  it('accepts a shop that lets clients cancel until the last minute', () => {
    expect(
      loadConfig({ ...validEnv, CANCELLATION_WINDOW_HOURS: '0' }).cancellationWindowHours,
    ).toBe(0);
  });

  it('rejects a cancellation window that is not a number', () => {
    expect(() => loadConfig({ ...validEnv, CANCELLATION_WINDOW_HOURS: 'soon' })).toThrow(
      /CANCELLATION_WINDOW_HOURS/,
    );
  });

  it('reads card fee rates as fractions', () => {
    const config = loadConfig({ ...validEnv, CARD_FEE_RATE_CREDIT: '0.0499' });

    expect(config.cardFeeRates).toEqual({ debit: 0.015, credit: 0.0499 });
  });

  it('rejects a card fee rate given as a percentage', () => {

    expect(() => loadConfig({ ...validEnv, CARD_FEE_RATE_CREDIT: '3.5' })).toThrow(
      /CARD_FEE_RATE_CREDIT/,
    );
  });

  it('accepts another IANA zone', () => {
    expect(loadConfig({ ...validEnv, SHOP_TIMEZONE: 'Europe/Lisbon' }).shopTimezone).toBe(
      'Europe/Lisbon',
    );
  });

  it('rejects a timezone that is not a real IANA zone', () => {

    expect(() => loadConfig({ ...validEnv, SHOP_TIMEZONE: 'Mars/Olympus' })).toThrow(
      /SHOP_TIMEZONE/,
    );
  });

  it('throws a readable error when DATABASE_URL is missing', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', JWT_SECRET: validEnv.JWT_SECRET })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects a JWT secret that is too short to be safe', () => {
    expect(() => loadConfig({ ...validEnv, JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
  });

  it('throws when DATABASE_URL is not a postgres url', () => {
    expect(() => loadConfig({ ...validEnv, DATABASE_URL: 'mysql://nope' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('throws when PORT is not a number', () => {
    expect(() => loadConfig({ ...validEnv, PORT: 'abc' })).toThrow(/PORT/);
  });
});
