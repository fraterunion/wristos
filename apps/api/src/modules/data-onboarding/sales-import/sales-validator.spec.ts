import {
  ERROR_CODES,
  NormalizedHistoricalSale,
  SalesDryRunContext,
  WARNING_CODES,
} from './historical-sale.types';
import { hasMinimumSaleIdentity, validateNormalizedSale } from './sales-validator';

function makeCtx(overrides?: Partial<SalesDryRunContext>): SalesDryRunContext {
  return {
    existingClientsByName: new Map(),
    existingClientsByLooseName: new Map(),
    existingSerials: new Map(),
    existingByReferenceModel: new Map(),
    existingFingerprints: new Set(),
    fileFingerprintsSeen: new Map(),
    fxRate: null,
    ...overrides,
  };
}

function validSale(overrides?: Partial<NormalizedHistoricalSale>): NormalizedHistoricalSale {
  return {
    customerName: 'Juan Pérez',
    brand: 'Rolex',
    model: 'Submariner',
    salePrice: 298000,
    cost: 200000,
    extras: 5000,
    reportedProfit: 93000,
    calculatedProfit: 93000,
    saleCurrency: 'MXN',
    costCurrency: 'MXN',
    extrasCurrency: 'MXN',
    importFingerprint: 'fp-1',
    ...overrides,
  };
}

describe('hasMinimumSaleIdentity', () => {
  it('accepts any single identity field', () => {
    expect(hasMinimumSaleIdentity({ customerName: 'A' })).toBe(true);
    expect(hasMinimumSaleIdentity({ brand: 'Rolex' })).toBe(true);
    expect(hasMinimumSaleIdentity({ model: 'Sub' })).toBe(true);
    expect(hasMinimumSaleIdentity({ reference: '126610' })).toBe(true);
    expect(hasMinimumSaleIdentity({ serialNumber: 'SN1' })).toBe(true);
    expect(hasMinimumSaleIdentity({ salePrice: 1 })).toBe(true);
  });

  it('rejects empty rows', () => {
    expect(hasMinimumSaleIdentity({})).toBe(false);
    expect(hasMinimumSaleIdentity({ notes: 'solo notas', cost: 100 })).toBe(false);
  });
});

describe('validateNormalizedSale', () => {
  it('marks empty rows INVALID', () => {
    const result = validateNormalizedSale({}, makeCtx(), 'r1');
    expect(result.state).toBe('INVALID');
    expect(result.errors.some((e) => e.code === ERROR_CODES.IDENTITY_FIELDS_MISSING)).toBe(true);
  });

  it('warns on profit mismatch without blocking', () => {
    const result = validateNormalizedSale(
      validSale({ reportedProfit: 50_000, calculatedProfit: 93_000 }),
      makeCtx(),
      'r1',
    );
    expect(result.state).toBe('WARNING');
    expect(result.warnings.some((w) => w.code === WARNING_CODES.PROFIT_MISMATCH)).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('warns on negative amounts but preserves eligibility', () => {
    const result = validateNormalizedSale(validSale({ salePrice: -100 }), makeCtx(), 'r1');
    expect(result.state).toBe('WARNING');
    expect(result.warnings.some((w) => w.code === WARNING_CODES.NEGATIVE_AMOUNT_REVIEW)).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('does not require cost, extras, or serial', () => {
    const result = validateNormalizedSale(
      { brand: 'Rolex', salePrice: 1000, importFingerprint: 'fp-x' },
      makeCtx(),
      'r1',
    );
    expect(result.errors).toHaveLength(0);
  });

  it('blocks commit eligibility when salePrice is missing', () => {
    const result = validateNormalizedSale(
      { brand: 'Rolex', importFingerprint: 'fp-x' },
      makeCtx(),
      'r1',
    );
    expect(result.state).toBe('INVALID');
    expect(result.errors.some((e) => e.code === ERROR_CODES.SALE_PRICE_REQUIRED_FOR_COMMIT)).toBe(true);
  });

  it('matches exact client name and proposes create otherwise', () => {
    const ctx = makeCtx({
      existingClientsByName: new Map([['juan pérez', 'client-1']]),
    });
    const matched = validateNormalizedSale(validSale(), ctx, 'r1');
    expect(matched.warnings.some((w) => w.code === WARNING_CODES.CLIENT_MATCHED)).toBe(true);

    const created = validateNormalizedSale(validSale({ customerName: 'Nuevo Cliente' }), makeCtx(), 'r2');
    expect(created.warnings.some((w) => w.code === WARNING_CODES.CLIENT_WILL_BE_CREATED)).toBe(true);
  });

  it('flags accent-insensitive possible client duplicates', () => {
    const ctx = makeCtx({
      existingClientsByLooseName: new Map([['raul gustavo', 'client-2']]),
    });
    const result = validateNormalizedSale(validSale({ customerName: 'Raúl Gustavo' }), ctx, 'r1');
    expect(result.warnings.some((w) => w.code === WARNING_CODES.CLIENT_POSSIBLE_DUPLICATE)).toBe(true);
  });

  it('proposes watch serial match without implying commit link', () => {
    const ctx = makeCtx({ existingSerials: new Map([['SN-1', 'watch-1']]) });
    const sale = validSale({ serialNumber: 'SN-1' });
    const result = validateNormalizedSale(sale, ctx, 'r1');
    expect(result.warnings.some((w) => w.code === WARNING_CODES.WATCH_SERIAL_MATCH)).toBe(true);
    expect(sale.matchedWatchId).toBe('watch-1');
    expect(result.warnings.some((w) => w.message.includes('no se vinculará'))).toBe(true);
  });

  it('warns on reference+model possible match', () => {
    const ctx = makeCtx({
      existingByReferenceModel: new Map([['126610ln|submariner', ['watch-9']]]),
    });
    const result = validateNormalizedSale(
      validSale({ reference: '126610LN', model: 'Submariner', serialNumber: undefined }),
      ctx,
      'r1',
    );
    expect(result.warnings.some((w) => w.code === WARNING_CODES.WATCH_REFERENCE_MATCH)).toBe(true);
  });

  it('errors on duplicate fingerprint in file', () => {
    const ctx = makeCtx({ fileFingerprintsSeen: new Map([['fp-1', 'other']]) });
    const result = validateNormalizedSale(validSale({ importFingerprint: 'fp-1' }), ctx, 'r2');
    expect(result.state).toBe('INVALID');
    expect(result.errors.some((e) => e.code === ERROR_CODES.DUPLICATE_IN_FILE)).toBe(true);
  });

  it('warns on duplicate fingerprint in DB', () => {
    const ctx = makeCtx({ existingFingerprints: new Set(['fp-1']) });
    const result = validateNormalizedSale(validSale({ importFingerprint: 'fp-1' }), ctx, 'r1');
    expect(result.warnings.some((w) => w.code === WARNING_CODES.DUPLICATE_IN_DB)).toBe(true);
  });

  it('warns when currency assumed MXN', () => {
    const result = validateNormalizedSale(validSale({ currencyAssumedMxn: true }), makeCtx(), 'r1');
    expect(result.warnings.some((w) => w.code === WARNING_CODES.CURRENCY_ASSUMED_MXN)).toBe(true);
  });
});
