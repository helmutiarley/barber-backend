import type { ValueTransformer } from 'typeorm';

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

export function centsToDecimalString(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`Money must be an integer number of cents, received ${cents}`);
  }

  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);

  return `${sign}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function decimalStringToCents(value: string): number {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(`Cannot parse "${value}" as a monetary amount`);
  }

  const [, sign, whole, fraction = ''] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  return sign ? -cents : cents;
}

export const moneyTransformer: ValueTransformer = {
  to(cents: number | null | undefined): string | null {
    return cents === null || cents === undefined ? null : centsToDecimalString(cents);
  },
  from(value: string | null): number | null {
    return value === null ? null : decimalStringToCents(value);
  },
};
