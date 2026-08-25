import { z } from 'zod';

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  SHOP_TIMEZONE: z
    .string()
    .default('America/Sao_Paulo')
    .refine(isValidTimeZone, { message: 'must be a valid IANA time zone' }),
  CANCELLATION_WINDOW_HOURS: z.coerce.number().int().nonnegative().default(24),

  CARD_FEE_RATE_DEBIT: z.coerce.number().min(0).max(1).default(0.015),
  CARD_FEE_RATE_CREDIT: z.coerce.number().min(0).max(1).default(0.035),
});

export type LogLevel = z.infer<typeof envSchema>['LOG_LEVEL'];

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  logLevel: LogLevel;
  jwtSecret: string;
  accessTokenTtl: string;
  refreshTokenTtlDays: number;

  shopTimezone: string;

  cancellationWindowHours: number;

  cardFeeRates: Record<'debit' | 'credit', number>;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return {
    nodeEnv: result.data.NODE_ENV,
    port: result.data.PORT,
    databaseUrl: result.data.DATABASE_URL,
    logLevel: result.data.LOG_LEVEL,
    jwtSecret: result.data.JWT_SECRET,
    accessTokenTtl: result.data.ACCESS_TOKEN_TTL,
    refreshTokenTtlDays: result.data.REFRESH_TOKEN_TTL_DAYS,
    shopTimezone: result.data.SHOP_TIMEZONE,
    cancellationWindowHours: result.data.CANCELLATION_WINDOW_HOURS,
    cardFeeRates: {
      debit: result.data.CARD_FEE_RATE_DEBIT,
      credit: result.data.CARD_FEE_RATE_CREDIT,
    },
  };
}
