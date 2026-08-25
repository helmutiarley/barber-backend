import { pino, type DestinationStream, type Logger } from 'pino';
import type { AppConfig } from '../config';

export type { Logger };

export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'accessToken',
  'refreshToken',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.passwordHash',
  '*.accessToken',
  '*.refreshToken',
];

export function createLogger(config: AppConfig, destination?: DestinationStream): Logger {
  const options = {
    level: config.logLevel,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  };

  if (destination) {
    return pino(options, destination);
  }

  return pino({
    ...options,
    ...(config.nodeEnv === 'development' && {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    }),
  });
}
