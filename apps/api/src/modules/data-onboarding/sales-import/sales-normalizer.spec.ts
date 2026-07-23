import { SalesMappingEntry, SKIP_FIELD } from './historical-sale.types';
import {
  buildImportFingerprint,
  calculateProfit,
  normalizeHistoricalSaleRow,
  parseSaleDate,
  profitsMismatch,
} from './sales-normalizer';

const MAPPING: SalesMappingEntry[] = [
  { sourceColumn: 'Fecha', targetField: 'saleDate' },
  { sourceColumn: 'Cliente', targetField: 'customerName' },
  { sourceColumn: 'Marca', targetField: 'brand' },
  { sourceColumn: 'Modelo', targetField: 'model' },
  { sourceColumn: 'Referencia', targetField: 'reference' },
  { sourceColumn: 'Serie', targetField: 'serialNumber' },
  { sourceColumn: 'Costo', targetField: 'cost' },
  { sourceColumn: 'Precio', targetField: 'salePrice' },
  { sourceColumn: 'Extras', targetField: 'extras' },
  { sourceColumn: 'Utilidad', targetField: 'reportedProfit' },
  { sourceColumn: 'Pagos', targetField: 'paymentCount' },
  { sourceColumn: 'Moneda', targetField: 'currency' },
  { sourceColumn: 'Notas', targetField: 'notes' },
  { sourceColumn: 'Skip', targetField: SKIP_FIELD },
];

describe('parseSaleDate', () => {
  it('parses DD/MM/YYYY', () => {
    expect(parseSaleDate('15/03/2024')).toEqual({ status: 'ok', iso: '2024-03-15' });
    expect(parseSaleDate('1-3-2024')).toEqual({ status: 'ok', iso: '2024-03-01' });
  });

  it('parses ISO dates', () => {
    expect(parseSaleDate('2024-03-15')).toEqual({ status: 'ok', iso: '2024-03-15' });
    expect(parseSaleDate('2024-03-15T10:00:00Z')).toEqual({ status: 'ok', iso: '2024-03-15' });
  });

  it('rejects impossible dates', () => {
    expect(parseSaleDate('32/01/2024')).toEqual({ status: 'error' });
    expect(parseSaleDate('not-a-date')).toEqual({ status: 'error' });
  });

  it('returns empty for blank', () => {
    expect(parseSaleDate('')).toEqual({ status: 'empty' });
    expect(parseSaleDate(null)).toEqual({ status: 'empty' });
  });
});

describe('calculateProfit / profitsMismatch', () => {
  it('calculates when salePrice and cost present; missing extras means 0', () => {
    expect(calculateProfit(100, 60, 10)).toBe(30);
    expect(calculateProfit(100, 60, undefined)).toBe(40);
    expect(calculateProfit(100, 60, 0)).toBe(40);
    expect(calculateProfit(100, undefined, 10)).toBeNull();
    expect(calculateProfit(undefined, 60, 10)).toBeNull();
  });

  it('detects mismatch beyond tolerance', () => {
    expect(profitsMismatch(30, 30)).toBe(false);
    expect(profitsMismatch(30, 29.995)).toBe(false);
    expect(profitsMismatch(30, 25)).toBe(true);
  });
});

describe('buildImportFingerprint', () => {
  it('is stable and case-insensitive', () => {
    const a = buildImportFingerprint(['t1', '2024-01-01', 'Raul', 'Rolex', null, 100]);
    const b = buildImportFingerprint(['t1', '2024-01-01', 'raul', 'ROLEX', '', 100]);
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
  });
});

describe('normalizeHistoricalSaleRow', () => {
  it('normalizes a typical MXN sale row', () => {
    const row = normalizeHistoricalSaleRow(
      {
        Fecha: '15/03/2024',
        Cliente: 'Juan Pérez',
        Marca: 'Rolex',
        Modelo: 'Submariner',
        Referencia: '126610LN',
        Serie: 'ABC123',
        Costo: '200000',
        Precio: '$298,000',
        Extras: '5000',
        Utilidad: '93000',
        Pagos: '2',
        Moneda: '',
        Notas: 'Histórica',
      },
      MAPPING,
      null,
      { tenantId: 't1', sourceRow: 2 },
    );

    expect(row.saleDate).toBe('2024-03-15');
    expect(row.customerName).toBe('Juan Pérez');
    expect(row.brand).toBe('Rolex');
    expect(row.salePrice).toBe(298000);
    expect(row.cost).toBe(200000);
    expect(row.extras).toBe(5000);
    expect(row.calculatedProfit).toBe(93000);
    expect(row.currencyAssumedMxn).toBe(true);
    expect(row.paymentCount).toBe(2);
    expect(row.importFingerprint).toBeTruthy();
  });

  it('applies FX for explicit USD sale price', () => {
    const row = normalizeHistoricalSaleRow(
      {
        Cliente: 'Buyer',
        Precio: '1000',
        Moneda: 'USD',
      },
      MAPPING,
      17.5,
    );
    expect(row.salePrice).toBe(17500);
    expect(row.salePriceOriginalAmount).toBe(1000);
    expect(row.saleExchangeRate).toBe(17.5);
    expect(row.saleCurrency).toBe('USD');
    expect(row.currencyAssumedMxn).toBeFalsy();
  });

  it('detects UDS in the amount string as USD', () => {
    const row = normalizeHistoricalSaleRow({ Precio: '22,400 UDS', Cliente: 'X' }, MAPPING, 20);
    expect(row.saleCurrency).toBe('USD');
    expect(row.salePriceOriginalAmount).toBe(22400);
    expect(row.salePrice).toBe(448000);
  });

  it('treats missing extras as 0 when calculating profit', () => {
    const row = normalizeHistoricalSaleRow(
      {
        Cliente: 'Buyer',
        Costo: '200000',
        Precio: '298000',
      },
      MAPPING,
      null,
    );
    expect(row.extras).toBeUndefined();
    expect(row.calculatedProfit).toBe(98000);
  });

  it('records parse errors for malformed extras without inventing 0', () => {
    const row = normalizeHistoricalSaleRow(
      {
        Cliente: 'Buyer',
        Costo: '200000',
        Precio: '298000',
        Extras: '1.234',
      },
      MAPPING,
      null,
    );
    expect(row.extras).toBeUndefined();
    expect(row.parseIssues?.some((i) => i.field === 'extras' && i.code === 'AMBIGUOUS_NUMBER_FORMAT')).toBe(
      true,
    );
    // salePrice + cost still yield profit with extras treated as missing → 0
    expect(row.calculatedProfit).toBe(98000);
  });

  it('parses European sale amounts', () => {
    const row = normalizeHistoricalSaleRow(
      { Precio: '1.353.642,00', Costo: '298.000,00', Cliente: 'X' },
      MAPPING,
      null,
    );
    expect(row.salePrice).toBe(1353642);
    expect(row.cost).toBe(298000);
    expect(row.calculatedProfit).toBe(1055642);
  });

  it('records INVALID_DATE parse issues', () => {
    const row = normalizeHistoricalSaleRow({ Fecha: '99/99/9999', Marca: 'Rolex' }, MAPPING, null);
    expect(row.parseIssues?.some((i) => i.code === 'INVALID_DATE')).toBe(true);
  });
});
