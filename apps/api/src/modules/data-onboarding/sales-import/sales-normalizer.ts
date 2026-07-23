import { createHash } from 'crypto';

import { parseString } from '../inventory-import/watch-normalizer';
import {
  NormalizedHistoricalSale,
  SalesImportField,
  SalesMappingEntry,
  SalesParseIssue,
  SKIP_FIELD,
} from './historical-sale.types';
import {
  detectExplicitCurrency,
  normalizeMoneyFieldWithDefault,
  parseSalesMonetary,
} from './sales-money';

const PROFIT_TOLERANCE = 0.01;

/**
 * Parse sale dates. Supports:
 * - ISO `YYYY-MM-DD` / full ISO datetime
 * - `DD/MM/YYYY` and `DD-MM-YYYY`
 * Returns ISO date string (YYYY-MM-DD) or null when empty; throws via result object for invalid.
 */
export function parseSaleDate(raw: unknown): { status: 'ok'; iso: string } | { status: 'empty' } | { status: 'error' } {
  if (raw === null || raw === undefined) return { status: 'empty' };
  const str = String(raw).trim();
  if (str === '') return { status: 'empty' };

  // ISO date or datetime
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (
      date.getUTCFullYear() === Number(y) &&
      date.getUTCMonth() === Number(m) - 1 &&
      date.getUTCDate() === Number(d)
    ) {
      return { status: 'ok', iso: `${y}-${m}-${d}` };
    }
    return { status: 'error' };
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      const mm = String(month).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      return { status: 'ok', iso: `${year}-${mm}-${dd}` };
    }
    return { status: 'error' };
  }

  // Excel serial / Date object
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, '0');
    const d = String(raw.getUTCDate()).padStart(2, '0');
    return { status: 'ok', iso: `${y}-${m}-${d}` };
  }

  return { status: 'error' };
}

export function calculateProfit(
  salePriceMxn: number | undefined,
  costMxn: number | undefined,
  extrasMxn: number | undefined,
): number | null {
  if (salePriceMxn === undefined || costMxn === undefined) return null;
  const extras = extrasMxn ?? 0;
  if (![salePriceMxn, costMxn, extras].every(Number.isFinite)) return null;
  return Math.round((salePriceMxn - costMxn - extras) * 100) / 100;
}

export function profitsMismatch(reported: number | undefined, calculated: number | null): boolean {
  if (reported === undefined || calculated === null) return false;
  return Math.abs(reported - calculated) > PROFIT_TOLERANCE;
}

/**
 * Deterministic import fingerprint from stable source parts.
 * Empty/undefined parts become ''.
 */
export function buildImportFingerprint(parts: Array<string | number | null | undefined>): string {
  const canonical = parts.map((p) => (p === null || p === undefined ? '' : String(p).trim().toLowerCase())).join('|');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

function parsePaymentCount(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (str === '') return null;
  const n = Number.parseInt(str, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function normalizeHistoricalSaleRow(
  rawData: Record<string, unknown>,
  mapping: SalesMappingEntry[],
  fxRate: number | null,
  fingerprintExtras?: { tenantId?: string; fileChecksum?: string; sourceRow?: number | null },
): NormalizedHistoricalSale {
  const lookup = new Map<SalesImportField, unknown>();

  for (const entry of mapping) {
    if (entry.targetField === SKIP_FIELD) continue;
    const value = rawData[entry.sourceColumn];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      lookup.set(entry.targetField, value);
    }
  }

  const result: NormalizedHistoricalSale = {};
  const parseIssues: SalesParseIssue[] = [];

  const applyMonetary = (field: SalesImportField, raw: unknown) => {
    const parsed = parseSalesMonetary(raw);
    if (parsed.status === 'error') parseIssues.push({ field, code: parsed.code });
    return parsed;
  };

  const customerName = parseString(lookup.get('customerName'));
  if (customerName !== null) result.customerName = customerName;

  const brand = parseString(lookup.get('brand'));
  if (brand !== null) result.brand = brand;

  const model = parseString(lookup.get('model'));
  if (model !== null) result.model = model;

  const reference = parseString(lookup.get('reference'));
  if (reference !== null) result.reference = reference;

  const serialNumber = parseString(lookup.get('serialNumber'));
  if (serialNumber !== null) result.serialNumber = serialNumber;

  const notes = parseString(lookup.get('notes'));
  if (notes !== null) result.notes = notes;

  const dateRaw = lookup.get('saleDate');
  if (dateRaw !== undefined) {
    const parsed = parseSaleDate(dateRaw);
    if (parsed.status === 'ok') result.saleDate = parsed.iso;
    else if (parsed.status === 'error') parseIssues.push({ field: 'saleDate', code: 'INVALID_DATE' });
  }

  const paymentCount = parsePaymentCount(lookup.get('paymentCount'));
  if (paymentCount !== null) result.paymentCount = paymentCount;

  const costParse = applyMonetary('cost', lookup.get('cost'));
  const saleParse = applyMonetary('salePrice', lookup.get('salePrice'));
  const extrasParse = applyMonetary('extras', lookup.get('extras'));
  const profitParse = applyMonetary('reportedProfit', lookup.get('reportedProfit'));

  // Shared / column currency resolution
  const resolveCurrency = (
    field: SalesImportField,
    monetaryDetected: 'MXN' | 'USD' | undefined,
  ): { currency: 'MXN' | 'USD'; explicit: boolean } => {
    const dedicated = lookup.get(field);
    if (dedicated !== undefined) {
      const col = detectExplicitCurrency(dedicated);
      if (col) return { currency: col, explicit: true };
      parseIssues.push({ field, code: 'INVALID_CURRENCY' });
    }
    if (monetaryDetected) return { currency: monetaryDetected, explicit: true };

    const shared = lookup.get('currency') ?? lookup.get('saleCurrency') ?? lookup.get('costCurrency');
    if (shared !== undefined) {
      const col = detectExplicitCurrency(shared);
      if (col) return { currency: col, explicit: true };
    }
    return { currency: 'MXN', explicit: false };
  };

  let anyAssumed = false;

  const applyNormalized = (
    amountField: 'cost' | 'salePrice' | 'extras' | 'reportedProfit',
    currencyField: 'costCurrency' | 'saleCurrency' | 'extrasCurrency' | 'reportedProfitCurrency',
    parse: ReturnType<typeof parseSalesMonetary>,
  ) => {
    if (parse.status !== 'ok') return;
    const { currency, explicit } = resolveCurrency(currencyField, parse.detectedCurrency);
    const money = normalizeMoneyFieldWithDefault(parse.value, currency, fxRate, explicit);
    if (!money) return;
    if (money.assumedMxn) anyAssumed = true;

    if (amountField === 'cost') {
      result.cost = money.mxn;
      result.costCurrency = money.currency;
      if (money.rate != null) {
        result.costOriginalAmount = money.original;
        result.costExchangeRate = money.rate;
      }
    } else if (amountField === 'salePrice') {
      result.salePrice = money.mxn;
      result.saleCurrency = money.currency;
      if (money.rate != null) {
        result.salePriceOriginalAmount = money.original;
        result.saleExchangeRate = money.rate;
      }
    } else if (amountField === 'extras') {
      result.extras = money.mxn;
      result.extrasCurrency = money.currency;
      if (money.rate != null) {
        result.extrasOriginalAmount = money.original;
        result.extrasExchangeRate = money.rate;
      }
    } else {
      result.reportedProfit = money.mxn;
      result.reportedProfitCurrency = money.currency;
      if (money.rate != null) {
        result.reportedProfitOriginalAmount = money.original;
      }
    }
  };

  applyNormalized('cost', 'costCurrency', costParse);
  applyNormalized('salePrice', 'saleCurrency', saleParse);
  applyNormalized('extras', 'extrasCurrency', extrasParse);
  applyNormalized('reportedProfit', 'reportedProfitCurrency', profitParse);

  if (anyAssumed) result.currencyAssumedMxn = true;

  // calculatedProfit when salePrice + cost present; missing extras treated as 0
  const calculated = calculateProfit(result.salePrice, result.cost, result.extras);
  result.calculatedProfit = calculated;

  if (parseIssues.length > 0) result.parseIssues = parseIssues;

  result.importFingerprint = buildImportFingerprint([
    fingerprintExtras?.tenantId,
    result.saleDate,
    result.customerName,
    result.brand,
    result.model,
    result.reference,
    result.serialNumber,
    result.salePrice,
    fingerprintExtras?.fileChecksum,
    fingerprintExtras?.sourceRow,
  ]);

  return result;
}
