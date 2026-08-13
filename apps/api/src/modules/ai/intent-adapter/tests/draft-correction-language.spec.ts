import {
  detectCorrectedAccount,
  detectCorrectedCurrency,
  detectDraftCorrectionLanguage,
  parseCorrectedAmount,
} from '../draft-correction-language';

describe('detectDraftCorrectionLanguage', () => {
  it('classifies "No. Era Batman." as watch-or-customer with the article/copula/punctuation stripped', () => {
    expect(detectDraftCorrectionLanguage('No. Era Batman.', 'REGISTER_SALE')).toEqual({
      field: 'watch-or-customer',
      rawValue: 'Batman',
    });
  });

  it('classifies "No. Era Abraham Bosquez." as watch-or-customer too — genuinely ambiguous from text alone', () => {
    expect(detectDraftCorrectionLanguage('No. Era Abraham Bosquez.', 'REGISTER_SALE')).toEqual({
      field: 'watch-or-customer',
      rawValue: 'Abraham Bosquez',
    });
  });

  it('classifies "No. Fueron 480." as amount', () => {
    expect(detectDraftCorrectionLanguage('No. Fueron 480.', 'REGISTER_SALE')).toEqual({
      field: 'amount',
      rawValue: '480',
    });
  });

  it('classifies "No. Fue por Bancos." as payment', () => {
    expect(detectDraftCorrectionLanguage('No. Fue por Bancos.', 'REGISTER_SALE')).toEqual({
      field: 'payment',
      rawValue: 'por Bancos',
    });
  });

  it('classifies "No. Fue efectivo." as payment', () => {
    expect(detectDraftCorrectionLanguage('No. Fue efectivo.', 'REGISTER_SALE')).toEqual({
      field: 'payment',
      rawValue: 'efectivo',
    });
  });

  it('classifies a currency-worded correction as currency', () => {
    expect(detectDraftCorrectionLanguage('No. Fueron dólares.', 'REGISTER_SALE')).toEqual({
      field: 'currency',
      rawValue: 'dólares',
    });
  });

  it('strips a leading article from the corrected value ("el Batman" -> "Batman")', () => {
    expect(detectDraftCorrectionLanguage('No. Era el Batman.', 'REGISTER_SALE')).toEqual({
      field: 'watch-or-customer',
      rawValue: 'Batman',
    });
  });

  it('requires the negation opener — "Era Batman." alone (no "No.") is not a correction', () => {
    expect(detectDraftCorrectionLanguage('Era Batman.', 'REGISTER_SALE')).toBeNull();
  });

  it('scoped to REGISTER_SALE/REGISTER_PURCHASE only — any other capability is never treated as a correction', () => {
    expect(detectDraftCorrectionLanguage('No. Fueron 480.', 'REGISTER_RECEIVABLE_PAYMENT')).toBeNull();
    expect(detectDraftCorrectionLanguage('No. Fueron 480.', undefined)).toBeNull();
  });

  it('a bare "No." with nothing after it is not a correction', () => {
    expect(detectDraftCorrectionLanguage('No.', 'REGISTER_SALE')).toBeNull();
  });

  it('works identically for REGISTER_PURCHASE (seller instead of customer)', () => {
    expect(detectDraftCorrectionLanguage('No. Fueron 280 mil.', 'REGISTER_PURCHASE')?.field).toBe('amount');
  });
});

describe('detectCorrectedAccount', () => {
  it('maps efectivo/cash/caja to CASH regardless of capability', () => {
    expect(detectCorrectedAccount('efectivo', 'REGISTER_SALE')).toBe('CASH');
    expect(detectCorrectedAccount('cash', 'REGISTER_PURCHASE')).toBe('CASH');
  });

  it('maps bancos to BANCOS for REGISTER_SALE (matches the binding literal enum) and BANK for REGISTER_PURCHASE', () => {
    expect(detectCorrectedAccount('por bancos', 'REGISTER_SALE')).toBe('BANCOS');
    expect(detectCorrectedAccount('por bancos', 'REGISTER_PURCHASE')).toBe('BANK');
  });

  it('maps césar to CESAR', () => {
    expect(detectCorrectedAccount('cuenta césar', 'REGISTER_SALE')).toBe('CESAR');
  });

  it('returns null for unrecognized text', () => {
    expect(detectCorrectedAccount('algo raro', 'REGISTER_SALE')).toBeNull();
  });
});

describe('detectCorrectedCurrency', () => {
  it('maps pesos/mxn to MXN and dólares/usd to USD', () => {
    expect(detectCorrectedCurrency('pesos')).toBe('MXN');
    expect(detectCorrectedCurrency('mxn')).toBe('MXN');
    expect(detectCorrectedCurrency('dólares')).toBe('USD');
    expect(detectCorrectedCurrency('usd')).toBe('USD');
  });

  it('returns null for unrecognized text', () => {
    expect(detectCorrectedCurrency('Batman')).toBeNull();
  });
});

describe('parseCorrectedAmount', () => {
  it('parses a plain number', () => {
    expect(parseCorrectedAmount('480')).toBe(480);
  });

  it('parses a comma-thousands number', () => {
    expect(parseCorrectedAmount('1,500')).toBe(1500);
  });

  it('rejects zero, negative, and non-numeric text', () => {
    expect(parseCorrectedAmount('0')).toBeNull();
    expect(parseCorrectedAmount('Batman')).toBeNull();
  });
});
