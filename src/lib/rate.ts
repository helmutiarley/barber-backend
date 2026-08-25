import type { ValueTransformer } from 'typeorm';

const RATE_PATTERN = /^\d(?:\.\d{1,4})?$/;

export function fitsRateScale(rate: number): boolean {
  return RATE_PATTERN.test(String(rate));
}

export function assertRate(rate: number): void {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error(`A rate must be a fraction between 0 and 1, received ${rate}`);
  }
  if (!fitsRateScale(rate)) {
    throw new Error(`A rate must have at most four decimal places, received ${rate}`);
  }
}

export const rateTransformer: ValueTransformer = {
  to(rate: number | null | undefined): string | null {
    if (rate === null || rate === undefined) return null;
    assertRate(rate);

    return rate.toFixed(4);
  },
  from(value: string | null): number | null {
    return value === null ? null : Number(value);
  },
};
