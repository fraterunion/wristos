import {
  normalizeCurrency,
  normalizeEntities,
  normalizeIsoDate,
  normalizeMonth,
  normalizeMoney,
  normalizeQueryText,
  normalizeYear,
  resolveCurrentPeriod,
} from '../normalization';

describe('normalization: format canonicalization only, never re-derived meaning', () => {
  it('normalizes amount formatting the provider may have left in (symbols, commas, missing decimals)', () => {
    expect(normalizeMoney('35000')).toBe('35000.00');
    expect(normalizeMoney('$350,000')).toBe('350000.00');
    expect(normalizeMoney(45000)).toBe('45000.00');
    expect(normalizeMoney('350000.5')).toBe('350000.50');
    expect(normalizeMoney('not a number')).toBeNull();
    expect(normalizeMoney(null)).toBeNull();
  });

  it('maps a small fixed set of currency synonyms, uppercases codes, rejects anything else', () => {
    expect(normalizeCurrency('mxn')).toBe('MXN');
    expect(normalizeCurrency('USD')).toBe('USD');
    expect(normalizeCurrency('pesos')).toBe('MXN');
    expect(normalizeCurrency('dólares')).toBe('USD');
    expect(normalizeCurrency('dolares')).toBe('USD');
    expect(normalizeCurrency('euros')).toBeNull();
  });

  it('accepts an already-numeric month or a Spanish month name; rejects out-of-range/unknown values', () => {
    expect(normalizeMonth(7)).toBe(7);
    expect(normalizeMonth('julio')).toBe(7);
    expect(normalizeMonth('Julio')).toBe(7);
    expect(normalizeMonth('7')).toBe(7);
    expect(normalizeMonth(13)).toBeNull();
    expect(normalizeMonth('not a month')).toBeNull();
  });

  it('validates year range', () => {
    expect(normalizeYear(2026)).toBe(2026);
    expect(normalizeYear('2026')).toBe(2026);
    expect(normalizeYear(1999)).toBeNull();
    expect(normalizeYear(3000)).toBeNull();
  });

  it('trims/collapses whitespace on free-text queries but never resolves them to anything else', () => {
    expect(normalizeQueryText('  Batman   GMT  ')).toBe('Batman GMT');
    expect(normalizeQueryText('José')).toBe('José');
    expect(normalizeQueryText('')).toBeNull();
  });

  it('only accepts a plain YYYY-MM-DD date', () => {
    expect(normalizeIsoDate('2026-07-15')).toBe('2026-07-15');
    expect(normalizeIsoDate('15/07/2026')).toBeNull();
    expect(normalizeIsoDate('julio 15')).toBeNull();
  });

  it('resolves the current period from a context date', () => {
    expect(resolveCurrentPeriod({ currentDate: '2026-07-15' })).toEqual({ year: 2026, month: 7 });
  });

  it('normalizes a REGISTER_SALE candidate: amount formatting + currency, leaves *Query fields untouched as text', () => {
    const out = normalizeEntities(
      { intent: 'REGISTER_SALE', entities: { watchQuery: '  Batman  ', price: '$350,000', currency: 'pesos' } },
      { currentDate: '2026-07-15' },
    );
    expect(out).toEqual({ watchQuery: 'Batman', price: '350000.00', currency: 'MXN' });
  });

  it('drops a money/currency field entirely rather than passing through an unparsable value', () => {
    const out = normalizeEntities(
      { intent: 'REGISTER_EXPENSE', entities: { amount: 'a lot', currency: 'MXN', concept: 'gasolina' } },
      { currentDate: '2026-07-15' },
    );
    expect(out).not.toHaveProperty('amount');
    expect(out).toEqual({ currency: 'MXN', concept: 'gasolina' });
  });

  it('"este mes" / no month given at all -> defaults GET_MONTHLY_PROFIT to the current period', () => {
    const out = normalizeEntities({ intent: 'GET_MONTHLY_PROFIT', entities: {} }, { currentDate: '2026-07-15' });
    expect(out).toEqual({ year: 2026, month: 7 });
  });

  it('a specific month name is canonicalized to its number, independent of the current period', () => {
    const out = normalizeEntities({ intent: 'GET_MONTHLY_PROFIT', entities: { month: 'julio' } }, { currentDate: '2026-01-01' });
    expect(out.month).toBe(7);
    // Year was never specified either -> still defaults, since "month" alone
    // does not fully specify a period without a year, matching the planner's
    // requirement that BOTH fields be present.
  });

  it('does not override an explicitly-given year/month with the current period default', () => {
    const out = normalizeEntities({ intent: 'GET_MONTHLY_PROFIT', entities: { month: 3, year: 2024 } }, { currentDate: '2026-07-15' });
    expect(out).toEqual({ month: 3, year: 2024 });
  });
});
