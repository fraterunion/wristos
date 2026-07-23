import { WatchOwnershipType, WatchStatus } from '@prisma/client';

import { normalizeWatchRow, parseCurrency, parseMonetary, parseOwnershipType, parsePercentage, parseWatchStatus } from './watch-normalizer';
import { MappingEntry, SKIP_FIELD } from './watch-import.types';

function moneyValue(raw: unknown): number | null {
  const result = parseMonetary(raw);
  return result.status === 'ok' ? result.value : null;
}

function moneyError(raw: unknown): string | null {
  const result = parseMonetary(raw);
  return result.status === 'error' ? result.code : null;
}

describe('parseMonetary — accepted US formats', () => {
  it('parses plain integers', () => {
    expect(moneyValue('15000')).toBe(15000);
    expect(moneyValue('0')).toBe(0);
  });

  it('parses decimal values', () => {
    expect(moneyValue('15000.50')).toBe(15000.5);
    expect(moneyValue('1234.56')).toBeCloseTo(1234.56);
    expect(moneyValue('0.5')).toBe(0.5);
    expect(moneyValue('1234.567')).toBeCloseTo(1234.567);
  });

  it('parses US thousands grouping', () => {
    expect(moneyValue('1,234,567')).toBe(1234567);
    expect(moneyValue('1,234')).toBe(1234);
    expect(moneyValue('1,234.56')).toBeCloseTo(1234.56);
  });

  it('strips $ and MXN/USD codes', () => {
    expect(moneyValue('$15,000')).toBe(15000);
    expect(moneyValue('$1,234.56')).toBeCloseTo(1234.56);
    expect(moneyValue('$1,234')).toBe(1234);
    expect(moneyValue('MXN 15000')).toBe(15000);
    expect(moneyValue('MXN 1,234')).toBe(1234);
    expect(moneyValue('MXN 1,234.56')).toBeCloseTo(1234.56);
    expect(moneyValue('USD 8500')).toBe(8500);
    expect(moneyValue('USD 1,234')).toBe(1234);
    expect(moneyValue('USD 1,234.56')).toBeCloseTo(1234.56);
  });

  it('detects explicit currency labels (bare $ is not USD)', () => {
    expect(parseMonetary('$1,625,641.75')).toEqual({ status: 'ok', value: 1625641.75 });
    expect(parseMonetary('1,625,641.75 MXN')).toEqual({
      status: 'ok',
      value: 1625641.75,
      detectedCurrency: 'MXN',
    });
    expect(parseMonetary('USD 93,000')).toEqual({
      status: 'ok',
      value: 93000,
      detectedCurrency: 'USD',
    });
    expect(parseMonetary('US$93,000')).toEqual({
      status: 'ok',
      value: 93000,
      detectedCurrency: 'USD',
    });
    expect(parseMonetary('$93,000 USD')).toEqual({
      status: 'ok',
      value: 93000,
      detectedCurrency: 'USD',
    });
    expect(parseMonetary('$93,000')).toEqual({ status: 'ok', value: 93000 });
  });

  it('parses negative numbers (validator rejects them later)', () => {
    expect(moneyValue('-100')).toBe(-100);
    expect(moneyValue('-1,234.56')).toBeCloseTo(-1234.56);
  });
});

describe('parseMonetary — empty input', () => {
  it('returns empty status', () => {
    expect(parseMonetary('').status).toBe('empty');
    expect(parseMonetary(null).status).toBe('empty');
    expect(parseMonetary(undefined).status).toBe('empty');
    expect(parseMonetary('  ').status).toBe('empty');
  });
});

describe('parseMonetary — rejected formats (never silently reinterpreted)', () => {
  it('rejects European decimal format as AMBIGUOUS_NUMBER_FORMAT', () => {
    expect(moneyError('1.234,56')).toBe('AMBIGUOUS_NUMBER_FORMAT');
    expect(moneyError('1,23')).toBe('AMBIGUOUS_NUMBER_FORMAT');
    expect(moneyError('12.345.678,90')).toBe('AMBIGUOUS_NUMBER_FORMAT');
  });

  it('rejects EU-thousands lookalikes (dot + exactly 3 digits, short integer part)', () => {
    expect(moneyError('1.234')).toBe('AMBIGUOUS_NUMBER_FORMAT');
    expect(moneyError('15.000')).toBe('AMBIGUOUS_NUMBER_FORMAT');
  });

  it('rejects misplaced separators', () => {
    expect(moneyError('12,34')).toBe('AMBIGUOUS_NUMBER_FORMAT');
    expect(moneyError('1,2345')).toBe('AMBIGUOUS_NUMBER_FORMAT');
  });

  it('rejects conflicting currency codes', () => {
    expect(moneyError('MXN 1,234 USD')).toBe('CONFLICTING_CURRENCY');
    expect(moneyError('USD 100 MXN')).toBe('CONFLICTING_CURRENCY');
  });

  it('rejects unsupported currency symbols', () => {
    expect(moneyError('€1,234')).toBe('CONFLICTING_CURRENCY');
    expect(moneyError('£500')).toBe('CONFLICTING_CURRENCY');
    expect(moneyError('¥1000')).toBe('CONFLICTING_CURRENCY');
  });

  it('rejects non-numeric strings', () => {
    expect(moneyError('abc')).toBe('INVALID_NUMBER_FORMAT');
    expect(moneyError('N/A')).toBe('INVALID_NUMBER_FORMAT');
    expect(moneyError('-')).toBe('INVALID_NUMBER_FORMAT');
    expect(moneyError('$')).toBe('INVALID_NUMBER_FORMAT');
  });
});

describe('parseCurrency', () => {
  it('maps MXN variants to MXN', () => {
    expect(parseCurrency('MXN')).toBe('MXN');
    expect(parseCurrency('mxn')).toBe('MXN');
    expect(parseCurrency('Pesos')).toBe('MXN');
    expect(parseCurrency('MX$')).toBe('MXN');
  });

  it('maps USD variants to USD', () => {
    expect(parseCurrency('USD')).toBe('USD');
    expect(parseCurrency('usd')).toBe('USD');
    expect(parseCurrency('Dollar')).toBe('USD');
    expect(parseCurrency('Dolares')).toBe('USD');
  });

  it('returns null for unrecognized values', () => {
    expect(parseCurrency('EUR')).toBeNull();
    expect(parseCurrency('')).toBeNull();
    expect(parseCurrency('unknown')).toBeNull();
  });
});

describe('parseOwnershipType', () => {
  it('recognizes OWNED variants', () => {
    expect(parseOwnershipType('owned')).toBe(WatchOwnershipType.OWNED);
    expect(parseOwnershipType('Propio')).toBe(WatchOwnershipType.OWNED);
    expect(parseOwnershipType('PROPIO')).toBe(WatchOwnershipType.OWNED);
  });

  it('recognizes CONSIGNMENT variants', () => {
    expect(parseOwnershipType('consignment')).toBe(WatchOwnershipType.CONSIGNMENT);
    expect(parseOwnershipType('Consignacion')).toBe(WatchOwnershipType.CONSIGNMENT);
    expect(parseOwnershipType('consignación')).toBe(WatchOwnershipType.CONSIGNMENT);
  });

  it('returns null for unrecognized values', () => {
    expect(parseOwnershipType('unknown')).toBeNull();
    expect(parseOwnershipType('')).toBeNull();
  });
});

describe('parseWatchStatus', () => {
  it('recognizes AVAILABLE', () => {
    expect(parseWatchStatus('available')).toBe(WatchStatus.AVAILABLE);
    expect(parseWatchStatus('Disponible')).toBe(WatchStatus.AVAILABLE);
  });

  it('recognizes SOLD', () => {
    expect(parseWatchStatus('sold')).toBe(WatchStatus.SOLD);
    expect(parseWatchStatus('Vendido')).toBe(WatchStatus.SOLD);
  });

  it('recognizes IN_TRANSIT', () => {
    expect(parseWatchStatus('in_transit')).toBe(WatchStatus.IN_TRANSIT);
    expect(parseWatchStatus('En Transito')).toBe(WatchStatus.IN_TRANSIT);
  });

  it('returns null for unrecognized', () => {
    expect(parseWatchStatus('unknown')).toBeNull();
    expect(parseWatchStatus('')).toBeNull();
  });
});

describe('parsePercentage', () => {
  it('strips trailing percent sign', () => {
    expect(parsePercentage('50%')).toBe(50);
    expect(parsePercentage('25.5%')).toBe(25.5);
  });

  it('parses plain numbers', () => {
    expect(parsePercentage('30')).toBe(30);
    expect(parsePercentage('0')).toBe(0);
  });

  it('returns null for empty/invalid', () => {
    expect(parsePercentage('')).toBeNull();
    expect(parsePercentage('abc')).toBeNull();
    expect(parsePercentage(null)).toBeNull();
  });
});

describe('normalizeWatchRow', () => {
  const mapping: MappingEntry[] = [
    { sourceColumn: 'Marca', targetField: 'brand' },
    { sourceColumn: 'Modelo', targetField: 'model' },
    { sourceColumn: 'Costo', targetField: 'cost' },
    { sourceColumn: 'Moneda', targetField: 'costCurrency' },
    { sourceColumn: 'PrecioMin', targetField: 'priceMin' },
    { sourceColumn: 'PrecioMax', targetField: 'priceMax' },
    { sourceColumn: 'Condicion', targetField: 'condition' },
    { sourceColumn: 'Tipo', targetField: 'ownershipType' },
    { sourceColumn: 'Notas', targetField: SKIP_FIELD },
  ];

  it('maps basic MXN row correctly', () => {
    const raw = {
      Marca: 'Rolex',
      Modelo: 'Submariner',
      Costo: '15,000',
      Moneda: 'MXN',
      PrecioMin: '18000',
      PrecioMax: '22000',
      Condicion: 'Excelente',
      Tipo: 'owned',
      Notas: 'Ignorar',
    };
    const result = normalizeWatchRow(raw, mapping, null);
    expect(result.brand).toBe('Rolex');
    expect(result.model).toBe('Submariner');
    expect(result.cost).toBe(15000);
    expect(result.costCurrency).toBe('MXN');
    expect(result.costOriginalAmount).toBeUndefined();
    expect(result.condition).toBe('Excelente');
    expect(result.ownershipType).toBe(WatchOwnershipType.OWNED);
  });

  it('applies FX rate for USD rows', () => {
    const raw = {
      Marca: 'Patek',
      Modelo: 'Nautilus',
      Costo: '10000',
      Moneda: 'USD',
      PrecioMin: '600000',
      PrecioMax: '700000',
      Condicion: 'Mint',
      Tipo: 'owned',
      Notas: '',
    };
    const result = normalizeWatchRow(raw, mapping, 17.5);
    expect(result.costOriginalAmount).toBe(10000);
    expect(result.costExchangeRate).toBe(17.5);
    expect(result.cost).toBe(175000);
  });

  it('skips columns with SKIP_FIELD target', () => {
    const raw = { Marca: 'AP', Modelo: 'RO', Costo: '', Moneda: '', PrecioMin: '', PrecioMax: '', Condicion: '', Tipo: '', Notas: 'should be skipped' };
    const result = normalizeWatchRow(raw, mapping, null);
    expect((result as any).Notas).toBeUndefined();
    expect((result as any).notas).toBeUndefined();
  });

  it('leaves field undefined when source column is empty', () => {
    const raw = { Marca: 'Omega', Modelo: '', Costo: '5000', Moneda: '', PrecioMin: '', PrecioMax: '', Condicion: 'Good', Tipo: '', Notas: '' };
    const result = normalizeWatchRow(raw, mapping, null);
    expect(result.model).toBeUndefined();
    expect(result.costCurrency).toBe('MXN');
    expect(result.currencyAssumedMxn).toBe(true);
  });

  it('records a structured parse issue for ambiguous monetary values', () => {
    const raw = { Marca: 'Rolex', Modelo: 'Sub', Costo: '1.234,56', Moneda: 'MXN', PrecioMin: '18000', PrecioMax: '22000', Condicion: 'Buena', Tipo: 'owned', Notas: '' };
    const result = normalizeWatchRow(raw, mapping, null);
    expect(result.cost).toBeUndefined();
    expect(result.parseIssues).toEqual([{ field: 'cost', code: 'AMBIGUOUS_NUMBER_FORMAT' }]);
  });

  it('records a parse issue for unrecognized currency', () => {
    const raw = { Marca: 'Rolex', Modelo: 'Sub', Costo: '15000', Moneda: 'EUR', PrecioMin: '18000', PrecioMax: '22000', Condicion: 'Buena', Tipo: 'owned', Notas: '' };
    const result = normalizeWatchRow(raw, mapping, null);
    expect(result.costCurrency).toBe('MXN');
    expect(result.currencyAssumedMxn).toBe(true);
    expect(result.parseIssues).toEqual([{ field: 'costCurrency', code: 'INVALID_CURRENCY' }]);
  });

  it('defaults bare $ amounts to MXN with no FX conversion', () => {
    const raw = {
      Marca: 'Rolex',
      Modelo: 'Daytona',
      Costo: '$1,625,641.75',
      Moneda: '',
      PrecioMin: '',
      PrecioMax: '',
      Condicion: '',
      Tipo: '',
      Notas: '',
    };
    const result = normalizeWatchRow(raw, mapping, 17.5);
    expect(result.cost).toBeCloseTo(1625641.75);
    expect(result.costCurrency).toBe('MXN');
    expect(result.costOriginalAmount).toBeUndefined();
    expect(result.costExchangeRate).toBeUndefined();
    expect(result.currencyAssumedMxn).toBe(true);
  });

  it('treats explicit MXN label as MXN with no FX', () => {
    const raw = {
      Marca: 'Rolex',
      Modelo: 'Daytona',
      Costo: '1,625,641.75 MXN',
      Moneda: '',
      PrecioMin: '',
      PrecioMax: '',
      Condicion: '',
      Tipo: '',
      Notas: '',
    };
    const result = normalizeWatchRow(raw, mapping, 17.5);
    expect(result.cost).toBeCloseTo(1625641.75);
    expect(result.costCurrency).toBe('MXN');
    expect(result.costExchangeRate).toBeUndefined();
    expect(result.currencyAssumedMxn).toBeUndefined();
  });

  it('detects USD 93,000 and applies FX when rate provided', () => {
    const raw = {
      Marca: 'Patek',
      Modelo: 'Nautilus',
      Costo: 'USD 93,000',
      Moneda: '',
      PrecioMin: '',
      PrecioMax: '',
      Condicion: '',
      Tipo: '',
      Notas: '',
    };
    const result = normalizeWatchRow(raw, mapping, 17.5);
    expect(result.costOriginalAmount).toBe(93000);
    expect(result.costExchangeRate).toBe(17.5);
    expect(result.cost).toBe(1627500);
    expect(result.costCurrency).toBe('USD');
  });

  it('detects US$93,000 as explicit USD', () => {
    const raw = {
      Marca: 'Patek',
      Modelo: 'Nautilus',
      Costo: 'US$93,000',
      Moneda: '',
      PrecioMin: '',
      PrecioMax: '',
      Condicion: '',
      Tipo: '',
      Notas: '',
    };
    const result = normalizeWatchRow(raw, mapping, 17.5);
    expect(result.costCurrency).toBe('USD');
    expect(result.costOriginalAmount).toBe(93000);
  });

  it('detects $93,000 USD as explicit USD', () => {
    const raw = {
      Marca: 'Patek',
      Modelo: 'Nautilus',
      Costo: '$93,000 USD',
      Moneda: '',
      PrecioMin: '',
      PrecioMax: '',
      Condicion: '',
      Tipo: '',
      Notas: '',
    };
    const result = normalizeWatchRow(raw, mapping, null);
    expect(result.cost).toBe(93000);
    expect(result.costCurrency).toBe('USD');
    expect(result.currencyAssumedMxn).toBeUndefined();
  });

  it('keeps CSV explicit USD column behavior (regression)', () => {
    const raw = {
      Marca: 'Patek',
      Modelo: 'Nautilus',
      Costo: '10000',
      Moneda: 'USD',
      PrecioMin: '600000',
      PrecioMax: '700000',
      Condicion: 'Mint',
      Tipo: 'owned',
      Notas: '',
    };
    const result = normalizeWatchRow(raw, mapping, 17.5);
    expect(result.costCurrency).toBe('USD');
    expect(result.cost).toBe(175000);
    expect(result.currencyAssumedMxn).toBeUndefined();
  });

  it('keeps CSV explicit MXN column behavior without inventing USD (regression)', () => {
    const raw = {
      Marca: 'Rolex',
      Modelo: 'Submariner',
      Costo: '15000',
      Moneda: 'MXN',
      PrecioMin: '18000',
      PrecioMax: '22000',
      Condicion: 'Excelente',
      Tipo: 'owned',
      Notas: '',
    };
    const result = normalizeWatchRow(raw, mapping, 17.5);
    expect(result.cost).toBe(15000);
    expect(result.costCurrency).toBe('MXN');
    expect(result.costExchangeRate).toBeUndefined();
  });
});
