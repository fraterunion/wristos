import {
  detectExplicitCurrency,
  normalizeMoneyFieldWithDefault,
  parseSalesLocalizedNumber,
  parseSalesMonetary,
} from './sales-money';

describe('detectExplicitCurrency', () => {
  it('treats bare $ as no currency claim', () => {
    expect(detectExplicitCurrency('$')).toBeNull();
    expect(detectExplicitCurrency('$298,000')).toBeNull();
    expect(detectExplicitCurrency('$1.353.642,00')).toBeNull();
    expect(detectExplicitCurrency('298000')).toBeNull();
  });

  it('detects USD including UDS, DOLARES, DLS, US$', () => {
    expect(detectExplicitCurrency('USD')).toBe('USD');
    expect(detectExplicitCurrency('40,500 USD')).toBe('USD');
    expect(detectExplicitCurrency('22,400 UDS')).toBe('USD');
    expect(detectExplicitCurrency('DOLARES')).toBe('USD');
    expect(detectExplicitCurrency('DÓLARES 18000')).toBe('USD');
    expect(detectExplicitCurrency('DLS')).toBe('USD');
    expect(detectExplicitCurrency('US$93,000')).toBe('USD');
    expect(detectExplicitCurrency('$93,000 USD')).toBe('USD');
  });

  it('detects MXN labels', () => {
    expect(detectExplicitCurrency('MXN')).toBe('MXN');
    expect(detectExplicitCurrency('pesos')).toBe('MXN');
    expect(detectExplicitCurrency('1,234 MXN')).toBe('MXN');
  });
});

describe('parseSalesLocalizedNumber', () => {
  it('parses European/Mexican thousands + decimal comma', () => {
    expect(parseSalesLocalizedNumber('1.353.642,00')).toEqual({ status: 'ok', value: 1353642 });
    expect(parseSalesLocalizedNumber('298.000,00')).toEqual({ status: 'ok', value: 298000 });
    expect(parseSalesLocalizedNumber('40.500,00')).toEqual({ status: 'ok', value: 40500 });
  });

  it('parses US thousands + decimal dot', () => {
    expect(parseSalesLocalizedNumber('1,353,642.00')).toEqual({ status: 'ok', value: 1353642 });
    expect(parseSalesLocalizedNumber('298,000.00')).toEqual({ status: 'ok', value: 298000 });
  });

  it('parses plain integers and US thousands without decimals', () => {
    expect(parseSalesLocalizedNumber('298000')).toEqual({ status: 'ok', value: 298000 });
    expect(parseSalesLocalizedNumber('298,000')).toEqual({ status: 'ok', value: 298000 });
    expect(parseSalesLocalizedNumber('1.353.642')).toEqual({ status: 'ok', value: 1353642 });
  });

  it('parses short decimals', () => {
    expect(parseSalesLocalizedNumber('1,23')).toEqual({ status: 'ok', value: 1.23 });
    expect(parseSalesLocalizedNumber('1234.56')).toEqual({ status: 'ok', value: 1234.56 });
  });

  it('preserves explicit negatives', () => {
    expect(parseSalesLocalizedNumber('-298.000,00')).toEqual({ status: 'ok', value: -298000 });
    expect(parseSalesLocalizedNumber('-1,353,642.00')).toEqual({ status: 'ok', value: -1353642 });
    expect(parseSalesLocalizedNumber('-500')).toEqual({ status: 'ok', value: -500 });
  });

  it('rejects truly ambiguous forms', () => {
    expect(parseSalesLocalizedNumber('1.234')).toEqual({
      status: 'error',
      code: 'AMBIGUOUS_NUMBER_FORMAT',
    });
    expect(parseSalesLocalizedNumber('15.000')).toEqual({
      status: 'error',
      code: 'AMBIGUOUS_NUMBER_FORMAT',
    });
    expect(parseSalesLocalizedNumber('1.2345')).toEqual({
      status: 'error',
      code: 'AMBIGUOUS_NUMBER_FORMAT',
    });
  });
});

describe('parseSalesMonetary', () => {
  it('parses European amounts with bare $ and no USD claim', () => {
    expect(parseSalesMonetary('$1.353.642,00')).toEqual({ status: 'ok', value: 1353642 });
    expect(parseSalesMonetary('$298.000,00')).toEqual({ status: 'ok', value: 298000 });
  });

  it('parses US-style amounts', () => {
    expect(parseSalesMonetary('1,353,642.00')).toEqual({ status: 'ok', value: 1353642 });
    expect(parseSalesMonetary('298,000.00')).toEqual({ status: 'ok', value: 298000 });
    expect(parseSalesMonetary('298000')).toEqual({ status: 'ok', value: 298000 });
    expect(parseSalesMonetary('$298,000')).toEqual({ status: 'ok', value: 298000 });
  });

  it('detects explicit USD on either side of the amount', () => {
    expect(parseSalesMonetary('USD 40,500')).toEqual({
      status: 'ok',
      value: 40500,
      detectedCurrency: 'USD',
    });
    expect(parseSalesMonetary('40.500,00 USD')).toEqual({
      status: 'ok',
      value: 40500,
      detectedCurrency: 'USD',
    });
    expect(parseSalesMonetary('22,400 UDS')).toEqual({
      status: 'ok',
      value: 22400,
      detectedCurrency: 'USD',
    });
  });

  it('preserves negatives with currency labels', () => {
    expect(parseSalesMonetary('USD -1,000.50')).toEqual({
      status: 'ok',
      value: -1000.5,
      detectedCurrency: 'USD',
    });
    expect(parseSalesMonetary('-298.000,00')).toEqual({ status: 'ok', value: -298000 });
  });

  it('rejects conflicting foreign currency symbols', () => {
    expect(parseSalesMonetary('€1.234,56')).toEqual({
      status: 'error',
      code: 'CONFLICTING_CURRENCY',
    });
  });
});

describe('normalizeMoneyFieldWithDefault', () => {
  it('assumes MXN when currency is not explicit', () => {
    const money = normalizeMoneyFieldWithDefault(298000, null, 17.5, false);
    expect(money).toEqual({
      mxn: 298000,
      original: 298000,
      currency: 'MXN',
      rate: null,
      assumedMxn: true,
    });
  });

  it('applies FX only for explicit USD', () => {
    const money = normalizeMoneyFieldWithDefault(1000, 'USD', 17.5, true);
    expect(money).toEqual({
      mxn: 17500,
      original: 1000,
      currency: 'USD',
      rate: 17.5,
      assumedMxn: false,
    });
  });

  it('does not claim FX for labeled USD without rate', () => {
    const money = normalizeMoneyFieldWithDefault(1000, 'USD', null, true);
    expect(money?.currency).toBe('USD');
    expect(money?.rate).toBeNull();
    expect(money?.mxn).toBe(1000);
  });
});
