import { describe, expect, it } from 'vitest';
import { centsToDecimalString, decimalStringToCents, moneyTransformer } from '../../src/lib/money';

describe('centsToDecimalString', () => {
  it.each([
    [4500, '45.00'],
    [5, '0.05'],
    [0, '0.00'],
    [123456789, '1234567.89'],
    [-250, '-2.50'],
  ])('formats %i cents as %s', (cents, expected) => {
    expect(centsToDecimalString(cents)).toBe(expected);
  });

  it('rejects fractional cents', () => {
    expect(() => centsToDecimalString(45.5)).toThrow(/integer number of cents/);
  });
});

describe('decimalStringToCents', () => {
  it.each([
    ['45.00', 4500],
    ['0.05', 5],
    ['45', 4500],
    ['45.5', 4550],
    ['1234567.89', 123456789],
    ['-2.50', -250],
  ])('parses %s as %i cents', (value, expected) => {
    expect(decimalStringToCents(value)).toBe(expected);
  });

  it('rejects unparseable values', () => {
    expect(() => decimalStringToCents('R$ 45')).toThrow(/monetary amount/);
  });
});

describe('moneyTransformer', () => {
  it('round-trips through the database representation', () => {
    const stored = moneyTransformer.to(4500) as string;
    expect(stored).toBe('45.00');
    expect(moneyTransformer.from(stored)).toBe(4500);
  });

  it('passes null through in both directions', () => {
    expect(moneyTransformer.to(null)).toBeNull();
    expect(moneyTransformer.from(null)).toBeNull();
  });
});
