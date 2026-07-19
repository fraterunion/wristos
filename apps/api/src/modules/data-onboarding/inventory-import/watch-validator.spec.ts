import { WatchOwnershipType, WatchStatus } from '@prisma/client';

import { DryRunContext, NormalizedWatchRow } from './watch-import.types';
import { ERROR_CODES, WARNING_CODES, validateNormalizedWatch } from './watch-validator';

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

describe('validateNormalizedWatch — required field errors', () => {
  it.each(['brand', 'model', 'condition', 'cost', 'priceMin', 'priceMax'] as const)(
    'returns INVALID when %s is missing',
    (field) => {
      const row = { ...validRow(), [field]: undefined };
      const result = validateNormalizedWatch(row, makeCtx(), 'rec-1');
      expect(result.state).toBe('INVALID');
      expect(result.errors.some((e) => e.field === field)).toBe(true);
    },
  );
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

  it('does not warn when status is AVAILABLE', () => {
    const result = validateNormalizedWatch(
      { ...validRow(), status: WatchStatus.AVAILABLE },
      makeCtx(),
      'rec-1',
    );
    expect(result.warnings.some((w) => w.code === WARNING_CODES.STATUS_NOT_AVAILABLE)).toBe(false);
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

describe('validateNormalizedWatch — serial number duplicate detection', () => {
  it('warns (not errors) when serial exists in DB — commit always skips these', () => {
    const ctx = makeCtx({ existingSerials: new Set(['ROL-123']) });
    const result = validateNormalizedWatch(
      { ...validRow(), serialNumber: 'ROL-123' },
      ctx,
      'rec-1',
    );
    expect(result.state).toBe('WARNING');
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === WARNING_CODES.SERIAL_EXISTS_IN_DB)).toBe(true);
  });

  it('no warning when serial is unique', () => {
    const ctx = makeCtx();
    const result = validateNormalizedWatch(
      { ...validRow(), serialNumber: 'ROL-999' },
      ctx,
      'rec-1',
    );
    expect(result.warnings.some((w) => w.code === WARNING_CODES.SERIAL_EXISTS_IN_DB)).toBe(false);
    expect(ctx.fileSerialsSeen.get('ROL-999')).toBe('rec-1');
  });

  it('errors when serial appears twice in file (second occurrence) — INVALID', () => {
    const ctx = makeCtx();
    // First occurrence — records it
    validateNormalizedWatch({ ...validRow(), serialNumber: 'ROL-777' }, ctx, 'rec-1');
    // Second occurrence — hard error
    const result = validateNormalizedWatch({ ...validRow(), serialNumber: 'ROL-777' }, ctx, 'rec-2');
    expect(result.state).toBe('INVALID');
    expect(result.errors.some((e) => e.code === ERROR_CODES.SERIAL_DUPLICATE_IN_FILE)).toBe(true);
  });

  it('serial in DB AND duplicated in file: second occurrence is INVALID', () => {
    const ctx = makeCtx({ existingSerials: new Set(['ROL-555']) });
    const first = validateNormalizedWatch({ ...validRow(), serialNumber: 'ROL-555' }, ctx, 'rec-1');
    expect(first.state).toBe('WARNING');
    const second = validateNormalizedWatch({ ...validRow(), serialNumber: 'ROL-555' }, ctx, 'rec-2');
    expect(second.state).toBe('INVALID');
    expect(second.errors.some((e) => e.code === ERROR_CODES.SERIAL_DUPLICATE_IN_FILE)).toBe(true);
  });

  it('normalizes serials by trimming before comparison', () => {
    const ctx = makeCtx({ existingSerials: new Set(['ROL-123']) });
    const result = validateNormalizedWatch({ ...validRow(), serialNumber: '  ROL-123  ' }, ctx, 'rec-1');
    expect(result.warnings.some((w) => w.code === WARNING_CODES.SERIAL_EXISTS_IN_DB)).toBe(true);
  });

  it('does not check serial when serialNumber is absent', () => {
    const ctx = makeCtx({ existingSerials: new Set(['ROL-123']) });
    const result = validateNormalizedWatch({ ...validRow() }, ctx, 'rec-1');
    expect(result.warnings.some((w) => w.code === WARNING_CODES.SERIAL_EXISTS_IN_DB)).toBe(false);
  });
});

describe('validateNormalizedWatch — structured parse issues', () => {
  it('turns monetary parse issues into INVALID errors without duplicate "missing" noise', () => {
    const row: NormalizedWatchRow = {
      ...validRow(),
      cost: undefined,
      parseIssues: [{ field: 'cost', code: 'AMBIGUOUS_NUMBER_FORMAT' }],
    };
    const result = validateNormalizedWatch(row, makeCtx(), 'rec-1');
    expect(result.state).toBe('INVALID');
    expect(result.errors.some((e) => e.code === ERROR_CODES.AMBIGUOUS_NUMBER_FORMAT && e.field === 'cost')).toBe(true);
    expect(result.errors.some((e) => e.code === ERROR_CODES.REQUIRED_COST_MISSING)).toBe(false);
  });

  it('turns conflicting currency parse issues into INVALID errors', () => {
    const row: NormalizedWatchRow = {
      ...validRow(),
      priceMax: undefined,
      parseIssues: [{ field: 'priceMax', code: 'CONFLICTING_CURRENCY' }],
    };
    const result = validateNormalizedWatch(row, makeCtx(), 'rec-1');
    expect(result.state).toBe('INVALID');
    expect(result.errors.some((e) => e.code === ERROR_CODES.CONFLICTING_CURRENCY)).toBe(true);
  });
});
