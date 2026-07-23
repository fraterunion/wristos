import { WatchOwnershipType, WatchStatus } from '@prisma/client';

import {
  MappingEntry,
  MonetaryParseResult,
  NormalizedWatchRow,
  ParseIssue,
  SKIP_FIELD,
  WatchImportField,
} from './watch-import.types';

const CURRENCY_CODE_MAP: Record<string, 'MXN' | 'USD'> = {
  MXN: 'MXN',
  MX: 'MXN',
  USD: 'USD',
  US: 'USD',
};

const FOREIGN_SYMBOLS = /[£€¥₱]/;

/**
 * Strict monetary parser (V1 policy: US number format only).
 *
 * Currency precedence inside a monetary string:
 * - Explicit labels (USD, US$, MXN, …) set `detectedCurrency`
 * - Bare `$` alone is NOT treated as USD (and not as any currency claim)
 *
 * Accepted amounts: `15000`, `1234.56`, `1,234,567`, `$1,234.56`,
 * `MXN 1,234.56`, `USD 1,234`, `US$93,000`, `$93,000 USD`, negative variants.
 *
 * Rejected with a structured code — never silently reinterpreted:
 * - European decimal format (`1.234,56`, `1,23`) → AMBIGUOUS_NUMBER_FORMAT
 * - Short dot-grouped values that could be EU thousands (`1.234`) → AMBIGUOUS_NUMBER_FORMAT
 * - More than one distinct currency code, or non-MXN/USD symbols → CONFLICTING_CURRENCY
 * - Anything else non-numeric → INVALID_NUMBER_FORMAT
 */
export function parseMonetary(raw: unknown): MonetaryParseResult {
  if (raw === null || raw === undefined) return { status: 'empty' };
  const original = String(raw).trim();
  if (original === '') return { status: 'empty' };

  if (FOREIGN_SYMBOLS.test(original)) {
    return { status: 'error', code: 'CONFLICTING_CURRENCY' };
  }

  const codes = new Set<'MXN' | 'USD'>();

  // US$ / $US are explicit USD markers (before stripping bare $).
  let working = original.replace(/US\s*\$/gi, () => {
    codes.add('USD');
    return ' ';
  });
  working = working.replace(/\$\s*US\b/gi, () => {
    codes.add('USD');
    return ' ';
  });

  working = working.replace(/\b(MXN|USD|MX|US)\b/gi, (match) => {
    codes.add(CURRENCY_CODE_MAP[match.toUpperCase()]);
    return '';
  });

  if (codes.size > 1) {
    return { status: 'error', code: 'CONFLICTING_CURRENCY' };
  }

  // Bare '$' carries no currency claim (MXN default applied upstream when needed).
  const str = working.replace(/\$/g, '').trim();
  if (str === '') return { status: 'error', code: 'INVALID_NUMBER_FORMAT' };

  const detectedCurrency = codes.size === 1 ? [...codes][0] : undefined;

  const usGrouped = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
  const plainNumber = /^-?\d+(\.\d+)?$/;
  // e.g. "1.234" / "-15.000": dot followed by exactly 3 digits on a 1-3 digit
  // integer part is indistinguishable from EU thousands grouping.
  const euThousandsLookalike = /^-?\d{1,3}\.\d{3}$/;

  const withCurrency = (value: number): MonetaryParseResult =>
    detectedCurrency ? { status: 'ok', value, detectedCurrency } : { status: 'ok', value };

  if (usGrouped.test(str)) {
    return withCurrency(parseFloat(str.replace(/,/g, '')));
  }
  if (euThousandsLookalike.test(str)) {
    return { status: 'error', code: 'AMBIGUOUS_NUMBER_FORMAT' };
  }
  if (plainNumber.test(str)) {
    return withCurrency(parseFloat(str));
  }
  if (str.includes(',') || str.includes('.')) {
    return { status: 'error', code: 'AMBIGUOUS_NUMBER_FORMAT' };
  }
  return { status: 'error', code: 'INVALID_NUMBER_FORMAT' };
}

export function parseCurrency(raw: unknown): 'MXN' | 'USD' | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim().toUpperCase();
  if (str === '' || str === '$') return null;
  if (['MXN', 'MX', 'PESOS', 'PESO', 'MX$', '$MXN'].includes(str)) return 'MXN';
  if (['USD', 'US', 'DOLLAR', 'DOLLARS', 'DOLARES', 'DÓLARES', 'USD$', '$USD', 'US$'].includes(str)) return 'USD';
  return null;
}

/**
 * Detects an explicit USD/MXN label in a raw monetary-like string.
 * Bare `$` alone does not count as USD.
 */
export function detectExplicitCurrencyInText(raw: unknown): 'MXN' | 'USD' | null {
  if (raw === null || raw === undefined) return null;
  const parsed = parseMonetary(raw);
  if (parsed.status === 'ok' && parsed.detectedCurrency) return parsed.detectedCurrency;
  return parseCurrency(raw);
}

export function parseOwnershipType(raw: unknown): WatchOwnershipType | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim().toLowerCase();
  if (['owned', 'propio', 'propia', 'own', 'propiedad'].includes(str)) return WatchOwnershipType.OWNED;
  if (['consignment', 'consignacion', 'consignación', 'consig', 'consignado', 'consignada'].includes(str)) {
    return WatchOwnershipType.CONSIGNMENT;
  }
  return null;
}

export function parseWatchStatus(raw: unknown): WatchStatus | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim().toLowerCase().replace(/[\s-]/g, '_');
  const map: Record<string, WatchStatus> = {
    available: WatchStatus.AVAILABLE,
    disponible: WatchStatus.AVAILABLE,
    reserved: WatchStatus.RESERVED,
    reservado: WatchStatus.RESERVED,
    reservada: WatchStatus.RESERVED,
    sold: WatchStatus.SOLD,
    vendido: WatchStatus.SOLD,
    vendida: WatchStatus.SOLD,
    in_transit: WatchStatus.IN_TRANSIT,
    en_transito: WatchStatus.IN_TRANSIT,
    transito: WatchStatus.IN_TRANSIT,
    in_service: WatchStatus.IN_SERVICE,
    en_servicio: WatchStatus.IN_SERVICE,
    servicio: WatchStatus.IN_SERVICE,
    mantenimiento: WatchStatus.IN_SERVICE,
  };
  return map[str] ?? null;
}

export function parsePercentage(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  let str = String(raw).trim();
  if (str === '') return null;
  str = str.replace(/%$/, '').trim();
  const num = parseFloat(str);
  if (!Number.isFinite(num)) return null;
  return num;
}

export function parseString(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  return str === '' ? null : str;
}

export function normalizeWatchRow(
  rawData: Record<string, unknown>,
  mapping: MappingEntry[],
  fxRate: number | null,
): NormalizedWatchRow {
  const lookup = new Map<WatchImportField, unknown>();

  for (const entry of mapping) {
    if (entry.targetField === SKIP_FIELD) continue;
    const value = rawData[entry.sourceColumn];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      lookup.set(entry.targetField, value);
    }
  }

  const result: NormalizedWatchRow = {};
  const parseIssues: ParseIssue[] = [];

  const applyMonetary = (field: WatchImportField, raw: unknown): MonetaryParseResult => {
    const parsed = parseMonetary(raw);
    if (parsed.status === 'error') parseIssues.push({ field, code: parsed.code });
    return parsed;
  };

  const brand = parseString(lookup.get('brand'));
  if (brand !== null) result.brand = brand;

  const model = parseString(lookup.get('model'));
  if (model !== null) result.model = model;

  const reference = parseString(lookup.get('reference'));
  if (reference !== null) result.reference = reference;

  const serialNumber = parseString(lookup.get('serialNumber'));
  if (serialNumber !== null) result.serialNumber = serialNumber;

  const condition = parseString(lookup.get('condition'));
  if (condition !== null) result.condition = condition;

  const ownershipTypeRaw = lookup.get('ownershipType');
  if (ownershipTypeRaw !== undefined) {
    const ot = parseOwnershipType(ownershipTypeRaw);
    if (ot !== null) result.ownershipType = ot;
    else result.ownershipType = undefined;
  }

  const costParse = applyMonetary('cost', lookup.get('cost'));
  const priceMinParse = applyMonetary('priceMin', lookup.get('priceMin'));
  const priceMaxParse = applyMonetary('priceMax', lookup.get('priceMax'));

  // Currency precedence:
  // 1) Explicit costCurrency column (MXN/USD)
  // 2) Explicit label embedded in a monetary field (USD, US$, MXN, …)
  // 3) Default MXN — bare "$" never implies USD; no FX conversion
  const currencyRaw = lookup.get('costCurrency');
  let currency: 'MXN' | 'USD' | null = null;
  let currencyExplicit = false;

  if (currencyRaw !== undefined) {
    currency = parseCurrency(currencyRaw);
    if (currency !== null) {
      currencyExplicit = true;
    } else {
      parseIssues.push({ field: 'costCurrency', code: 'INVALID_CURRENCY' });
    }
  }

  if (currency === null) {
    const embedded =
      (costParse.status === 'ok' ? costParse.detectedCurrency : undefined) ??
      (priceMinParse.status === 'ok' ? priceMinParse.detectedCurrency : undefined) ??
      (priceMaxParse.status === 'ok' ? priceMaxParse.detectedCurrency : undefined);
    if (embedded) {
      currency = embedded;
      currencyExplicit = true;
    }
  }

  const hasAnyMonetary =
    costParse.status === 'ok' || priceMinParse.status === 'ok' || priceMaxParse.status === 'ok';

  if (currency === null) {
    currency = 'MXN';
    if (hasAnyMonetary) {
      result.currencyAssumedMxn = true;
    }
  }

  result.costCurrency = currency;

  if (costParse.status === 'ok') {
    const costRaw = costParse.value;
    // FX only when source currency is explicitly USD.
    if (currency === 'USD' && currencyExplicit && fxRate !== null) {
      result.costOriginalAmount = costRaw;
      result.costExchangeRate = fxRate;
      result.cost = Math.round(costRaw * fxRate * 100) / 100;
    } else {
      result.cost = costRaw;
    }
  }

  if (priceMinParse.status === 'ok') result.priceMin = priceMinParse.value;
  if (priceMaxParse.status === 'ok') result.priceMax = priceMaxParse.value;

  const statusRaw = lookup.get('status');
  if (statusRaw !== undefined) {
    const st = parseWatchStatus(statusRaw);
    if (st !== null) result.status = st;
  }

  const consignmentOwner = parseString(lookup.get('consignmentOwnerName'));
  if (consignmentOwner !== null) result.consignmentOwnerName = consignmentOwner;

  const splitRaw = lookup.get('consignmentSplitPercentage');
  if (splitRaw !== undefined) {
    const split = parsePercentage(splitRaw);
    if (split !== null) result.consignmentSplitPercentage = split;
  }

  const imageUrl = parseString(lookup.get('imageUrl'));
  if (imageUrl !== null) result.imageUrl = imageUrl;

  if (parseIssues.length > 0) result.parseIssues = parseIssues;

  return result;
}
