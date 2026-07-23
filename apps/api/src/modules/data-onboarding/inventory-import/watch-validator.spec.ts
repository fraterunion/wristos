import { WatchOwnershipType, WatchStatus } from '@prisma/client';

import { DryRunContext, NormalizedWatchRow } from './watch-import.types';
import { ERROR_CODES, WARNING_CODES, hasMinimumWatchIdentity, validateNormalizedWatch } from './watch-validator';

function makeCtx(overrides?: Partial<DryRunContext>): DryRunContext {
  return {
    existingSerials: new Set(),
    fileSerialsSeen: new Map(),
    fxRate: null,
    ...overrides,
  };
}

function validRow(): NormalizedWatchRow {
  return {
    brand: 'Rolex',
    model: 'Submariner',
    condition: 'Excelente',
    cost: 15000,
    priceMin: 18000,
    priceMax: 22000,
    ownershipType: WatchOwnershipType.OWNED,
    costCurrency: 'MXN',
  };
}

describe('validateNormalizedWatch — valid row', () => {
  it('returns VALID with no errors or warnings for a clean row', () => {
    const result = validateNormalizedWatch(validRow(), makeCtx(), 'rec-1');
    expect(result.state).toBe('VALID');
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('validateNormalizedWatch — partial import identity', () => {
  it('allows brand+model without condition/priceMin/priceMax/cost', () => {
    const result = validateNormalizedWatch(
      { brand: 'Rolex', model: 'Submariner' },
      makeCtx(),
      'rec-1',
    );
    expect(result.state).toBe('VALID');
    expect(result.errors).toHaveLength(0);
  });

  it('allows only brand', () => {
    const result = validateNormalizedWatch({ brand: 'Rolex' }, makeCtx(), 'rec-1');
    expect(result.state).toBe('VALID');
    expect(hasMinimumWatchIdentity({ brand: 'Rolex' })).toBe(true);
  });

  it('allows only model', () => {
    const result = validateNormalizedWatch({ model: 'Submariner' }, makeCtx(), 'rec-1');
    expect(result.state).toBe('VALID');
  });

  it('allows only price (cost)', () => {
    const result = validateNormalizedWatch({ cost: 1500000, costCurrency: 'MXN' }, makeCtx(), 'rec-1');
    expect(result.state).toBe('VALID');
  });

  it('is INVALID when no brand/model/price', () => {
    const result = validateNormalizedWatch(
      { reference: '126610LN', serialNumber: 'ABC123' },
      makeCtx(),
      'rec-1',
    );
    expect(result.state).toBe('INVALID');
    expect(result.errors.some((e) => e.code === ERROR_CODES.IDENTITY_FIELDS_MISSING)).toBe(true);
  });

  it('does not error on missing optional enrichment fields', () => {
    const result = validateNormalizedWatch(
      { brand: 'Omega', model: 'Speedmaster' },
      makeCtx(),
      'rec-1',
    );
    expect(result.errors.some((e) => e.field === 'condition')).toBe(false);
    expect(result.errors.some((e) => e.field === 'priceMin')).toBe(false);
    expect(result.errors.some((e) => e.field === 'priceMax')).toBe(false);
    expect(result.errors.some((e) => e.field === 'cost')).toBe(false);
  });
});

describe('validateNormalizedWatch — currency assumed warning', () => {
  it('adds non-blocking MXN assumption warning', () => {
    const result = validateNormalizedWatch(
      { brand: 'Rolex', model: 'Sub', cost: 1625641.75, costCurrency: 'MXN', currencyAssumedMxn: true },
      makeCtx(),
      'rec-1',
    );
    expect(result.state).toBe('WARNING');
    expect(result.warnings.some((w) => w.code === WARNING_CODES.CURRENCY_ASSUMED_MXN)).toBe(true);
    expect(result.warnings.find((w) => w.code === WARNING_CODES.CURRENCY_ASSUMED_MXN)?.message).toContain(
      'Moneda no indicada explícitamente',
    );
  });
});

describe('validateNormalizedWatch — numeric constraints', () => {
  it('errors on negative cost', () => {
    const result = validateNormalizedWatch({ ...validRow(), cost: -100 }, makeCtx(), 'rec-1');
    expect(result.state).toBe('INVALID');
    expect(result.errors.some((e) => e.code === ERROR_CODES.NEGATIVE_COST)).toBe(true);
  });

  it('warns on zero cost', () => {
    const result = validateNormalizedWatch({ ...validRow(), cost: 0 }, makeCtx(), 'rec-1');
    expect(result.state).toBe('WARNING');
    expect(result.warnings.some((w) => w.code === WARNING_CODES.COST_IS_ZERO)).toBe(true);
  });

  it('errors when priceMax < priceMin', () => {
    const result = validateNormalizedWatch({ ...validRow(), priceMin: 20000, priceMax: 10000 }, makeCtx(), 'rec-1');
    expect(result.state).toBe('INVALID');
    expect(result.errors.some((e) => e.code === ERROR_CODES.PRICE_MAX_BELOW_MIN)).toBe(true);
  });

  it('warns when priceMin === priceMax', () => {
    const result = validateNormalizedWatch({ ...validRow(), priceMin: 15000, priceMax: 15000 }, makeCtx(), 'rec-1');
    expect(result.state).toBe('WARNING');
    expect(result.warnings.some((w) => w.code === WARNING_CODES.PRICE_RANGE_IDENTICAL)).toBe(true);
  });
});

describe('validateNormalizedWatch — consignment rules', () => {
  it('errors when CONSIGNMENT without owner name', () => {
    const result = validateNormalizedWatch(
      { ...validRow(), ownershipType: WatchOwnershipType.CONSIGNMENT },
      makeCtx(),
      'rec-1',
    );
    expect(result.state).toBe('INVALID');
    expect(result.errors.some((e) => e.code === ERROR_CODES.CONSIGNMENT_MISSING_OWNER)).toBe(true);
  });

  it('passes when CONSIGNMENT with owner name', () => {
    const result = validateNormalizedWatch(
      { ...validRow(), ownershipType: WatchOwnershipType.CONSIGNMENT, consignmentOwnerName: 'Carlos' },
      makeCtx(),
      'rec-1',
    );
    expect(result.errors.some((e) => e.code === ERROR_CODES.CONSIGNMENT_MISSING_OWNER)).toBe(false);
  });

  it('errors when split percentage is out of 0-100 range', () => {
    const result = validateNormalizedWatch(
      {
        ...validRow(),
        ownershipType: WatchOwnershipType.CONSIGNMENT,
        consignmentOwnerName: 'Carlos',
        consignmentSplitPercentage: 150,
      },
      makeCtx(),
      'rec-1',
    );
    expect(result.errors.some((e) => e.code === ERROR_CODES.SPLIT_OUT_OF_RANGE)).toBe(true);
  });
});

describe('validateNormalizedWatch — status warnings', () => {
  it('warns when status is not AVAILABLE', () => {
    const result = validateNormalizedWatch(
      { ...validRow(), status: WatchStatus.SOLD },
      makeCtx(),
      'rec-1',
    );
    expect(result.state).toBe('WARNING');
    expect(result.warnings.some((w) => w.code === WARNING_CODES.STATUS_NOT_AVAILABLE)).toBe(true);
  });
});

describe('validateNormalizedWatch — USD exchange rate warning', () => {
  it('warns when USD exchange rate was applied', () => {
    const result = validateNormalizedWatch(
      { ...validRow(), costCurrency: 'USD', costOriginalAmount: 1000, costExchangeRate: 17.5 },
      makeCtx({ fxRate: 17.5 }),
      'rec-1',
    );
    expect(result.warnings.some((w) => w.code === WARNING_CODES.USD_EXCHANGE_RATE_APPLIED)).toBe(true);
  });
});

describe('validateNormalizedWatch — serial checks', () => {
  it('errors on second in-file serial duplicate', () => {
    const ctx = makeCtx();
    validateNormalizedWatch({ ...validRow(), serialNumber: 'SN-1' }, ctx, 'rec-1');
    const second = validateNormalizedWatch({ ...validRow(), serialNumber: 'SN-1' }, ctx, 'rec-2');
    expect(second.state).toBe('INVALID');
    expect(second.errors.some((e) => e.code === ERROR_CODES.SERIAL_DUPLICATE_IN_FILE)).toBe(true);
  });

  it('warns when serial exists in DB', () => {
    const result = validateNormalizedWatch(
      { ...validRow(), serialNumber: 'EXISTS' },
      makeCtx({ existingSerials: new Set(['EXISTS']) }),
      'rec-1',
    );
    expect(result.state).toBe('WARNING');
    expect(result.warnings.some((w) => w.code === WARNING_CODES.SERIAL_EXISTS_IN_DB)).toBe(true);
  });
});

describe('validateNormalizedWatch — parse issues', () => {
  it('surfaces structured parse failures as errors', () => {
    const result = validateNormalizedWatch(
      {
        ...validRow(),
        cost: undefined,
        parseIssues: [{ field: 'priceMax', code: 'CONFLICTING_CURRENCY' }],
      },
      makeCtx(),
      'rec-1',
    );
    expect(result.state).toBe('INVALID');
    expect(result.errors.some((e) => e.code === ERROR_CODES.CONFLICTING_CURRENCY)).toBe(true);
  });
});
