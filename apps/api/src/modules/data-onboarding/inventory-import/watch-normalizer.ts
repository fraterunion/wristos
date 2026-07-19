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
 * Accepted: `15000`, `1234.56`, `1,234,567`, `1,234.56`, `$1,234.56`,
 * `MXN 1,234.56`, `USD 1,234`, negative variants of the above.
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

  const codes = new Set<string>();
  const withoutCodes = original.replace(/\b(MXN|USD|MX|US)\b/gi, (match) => {
    codes.add(CURRENCY_CODE_MAP[match.toUpperCase()]);
    return '';
  });
  if (codes.size > 1) {
    return { status: 'error', code: 'CONFLICTING_CURRENCY' };
  }

  // '$' is used for both MXN and USD; it carries no currency claim here.
  const str = withoutCodes.replace(/\$/g, '').trim();
  if (str === '') return { status: 'error', code: 'INVALID_NUMBER_FORMAT' };

  const usGrouped = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
  const plainNumber = /^-?\d+(\.\d+)?$/;
  // e.g. "1.234" / "-15.000": dot followed by exactly 3 digits on a 1-3 digit
  // integer part is indistinguishable from EU thousands grouping.
  const euThousandsLookalike = /^-?\d{1,3}\.\d{3}$/;

  if (usGrouped.test(str)) {
    return { status: 'ok', value: parseFloat(str.replace(/,/g, '')) };
  }
  if (euThousandsLookalike.test(str)) {
    return { status: 'error', code: 'AMBIGUOUS_NUMBER_FORMAT' };
  }
  if (plainNumber.test(str)) {
    return { status: 'ok', value: parseFloat(str) };
  }
  if (str.includes(',') || str.includes('.')) {
    return { status: 'error', code: 'AMBIGUOUS_NUMBER_FORMAT' };
  }
  return { status: 'error', code: 'INVALID_NUMBER_FORMAT' };
}

export function parseCurrency(raw: unknown): 'MXN' | 'USD' | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim().toUpperCase();
  if (['MXN', 'MX', 'PESOS', 'PESO', 'MX$', '$MXN'].includes(str)) return 'MXN';
  if (['USD', 'US', 'DOLLAR', 'DOLLARS', 'DOLARES', 'DÓLARES', 'USD$', '$USD'].includes(str)) return 'USD';
  return null;
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

  const applyMonetary = (field: WatchImportField, raw: unknown): number | null => {
    const parsed = parseMonetary(raw);
    if (parsed.status === 'ok') return parsed.value;
    if (parsed.status === 'error') parseIssues.push({ field, code: parsed.code });
    return null;
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

  const currencyRaw = lookup.get('costCurrency');
  const currency = currencyRaw !== undefined ? parseCurrency(currencyRaw) : 'MXN';
  if (currency !== null) {
    result.costCurrency = currency;
  } else {
    parseIssues.push({ field: 'costCurrency', code: 'INVALID_CURRENCY' });
  }

  const costRaw = applyMonetary('cost', lookup.get('cost'));
  if (costRaw !== null) {
    if (currency === 'USD' && fxRate !== null) {
      result.costOriginalAmount = costRaw;
      result.costExchangeRate = fxRate;
      result.cost = Math.round(costRaw * fxRate * 100) / 100;
    } else {
      result.cost = costRaw;
    }
  }

  const priceMin = applyMonetary('priceMin', lookup.get('priceMin'));
  if (priceMin !== null) result.priceMin = priceMin;

  const priceMax = applyMonetary('priceMax', lookup.get('priceMax'));
  if (priceMax !== null) result.priceMax = priceMax;

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
