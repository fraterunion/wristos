import { parseCurrency } from '../inventory-import/watch-normalizer';
import { MonetaryParseResult, NormalizedMoney } from './historical-sale.types';

const USD_EXPLICIT =
  /\b(?:USD|UDS|US|DOLARES|DÓLARES|DOLLAR|DOLLARS|DLS)\b|US\s*\$|\$\s*US\b/i;
const MXN_EXPLICIT = /\b(?:MXN|MX|PESOS|PESO)\b|MX\s*\$|\$\s*MXN\b/i;

const CURRENCY_CODE_MAP: Record<string, 'MXN' | 'USD'> = {
  MXN: 'MXN',
  MX: 'MXN',
  USD: 'USD',
  US: 'USD',
  UDS: 'USD',
  DLS: 'USD',
  DOLARES: 'USD',
  DÓLARES: 'USD',
};

const FOREIGN_SYMBOLS = /[£€¥₱]/;

/**
 * Detects an explicit MXN/USD label in free text or a monetary string.
 * Recognizes sprint aliases: UDS, DOLARES, DLS, US$.
 * Bare `$` alone does NOT claim USD (or any currency).
 */
export function detectExplicitCurrency(raw: unknown): 'MXN' | 'USD' | null {
  if (raw === null || raw === undefined) return null;
  const original = String(raw).trim();
  if (original === '' || original === '$') return null;

  const fromColumn = parseCurrency(original);
  if (fromColumn) return fromColumn;

  if (/\bUDS\b/i.test(original) || /\bDLS\b/i.test(original)) return 'USD';
  if (/\bDOLARES\b/i.test(original) || /\bDÓLARES\b/i.test(original)) return 'USD';

  const parsed = parseSalesMonetary(original);
  if (parsed.status === 'ok' && parsed.detectedCurrency) return parsed.detectedCurrency;

  if (USD_EXPLICIT.test(original) && !MXN_EXPLICIT.test(original)) return 'USD';
  if (MXN_EXPLICIT.test(original) && !USD_EXPLICIT.test(original)) return 'MXN';
  return null;
}

/**
 * Parse a localized numeric amount after currency tokens have been stripped.
 *
 * Decimal separator = final `,` or `.` when the digit count after it is 1–2
 * (or when both separator types are present — last wins).
 * Thousands grouping uses the other separator / repeated same-type groups of 3.
 * Truly ambiguous forms (e.g. bare `1.234`) are rejected.
 */
export function parseSalesLocalizedNumber(raw: string): MonetaryParseResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { status: 'error', code: 'INVALID_NUMBER_FORMAT' };

  const negative = trimmed.startsWith('-');
  const s = negative ? trimmed.slice(1).trim() : trimmed;
  if (s === '' || !/^[\d.,]+$/.test(s)) {
    return { status: 'error', code: 'INVALID_NUMBER_FORMAT' };
  }

  const sign = negative ? -1 : 1;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  const finish = (value: number): MonetaryParseResult => {
    if (!Number.isFinite(value)) return { status: 'error', code: 'INVALID_NUMBER_FORMAT' };
    return { status: 'ok', value: sign * value };
  };

  // No separators → plain integer
  if (lastComma === -1 && lastDot === -1) {
    if (!/^\d+$/.test(s)) return { status: 'error', code: 'INVALID_NUMBER_FORMAT' };
    return finish(Number(s));
  }

  // Both separators present → last one is the decimal separator
  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandSep = decimalSep === ',' ? '.' : ',';
    return finishWithSeps(s, thousandSep, decimalSep, finish);
  }

  // Single separator type
  const sep = lastComma !== -1 ? ',' : '.';
  const parts = s.split(sep);
  if (parts.some((p) => p === '' || !/^\d+$/.test(p))) {
    return { status: 'error', code: 'INVALID_NUMBER_FORMAT' };
  }

  const lastPart = parts[parts.length - 1];
  const digitCountAfter = lastPart.length;

  if (parts.length > 2) {
    // Repeated same separator → thousands grouping (all groups of 3 after the first)
    if (digitCountAfter !== 3) {
      return { status: 'error', code: 'AMBIGUOUS_NUMBER_FORMAT' };
    }
    for (let i = 1; i < parts.length; i++) {
      if (parts[i].length !== 3) {
        return { status: 'error', code: 'AMBIGUOUS_NUMBER_FORMAT' };
      }
    }
    if (parts[0].length < 1 || parts[0].length > 3) {
      return { status: 'error', code: 'AMBIGUOUS_NUMBER_FORMAT' };
    }
    return finish(Number(parts.join('')));
  }

  // Exactly one separator
  if (digitCountAfter >= 1 && digitCountAfter <= 2) {
    // Decimal separator (EU comma or US/MXN dot)
    return finish(Number(`${parts[0]}.${parts[1]}`));
  }

  if (digitCountAfter === 3) {
    // `1,234` → US thousands (unambiguous in MX/US sales sheets)
    // `1.234` / `15.000` → could be EU thousands OR US decimal → reject
    if (sep === '.') {
      return { status: 'error', code: 'AMBIGUOUS_NUMBER_FORMAT' };
    }
    if (parts[0].length < 1 || parts[0].length > 3) {
      return { status: 'error', code: 'AMBIGUOUS_NUMBER_FORMAT' };
    }
    return finish(Number(parts[0] + parts[1]));
  }

  return { status: 'error', code: 'AMBIGUOUS_NUMBER_FORMAT' };
}

function finishWithSeps(
  s: string,
  thousandSep: string,
  decimalSep: string,
  finish: (value: number) => MonetaryParseResult,
): MonetaryParseResult {
  const decIdx = s.lastIndexOf(decimalSep);
  const intPart = s.slice(0, decIdx);
  const fracPart = s.slice(decIdx + 1);

  if (!/^\d+$/.test(fracPart) || fracPart.length === 0 || fracPart.length > 4) {
    return { status: 'error', code: 'AMBIGUOUS_NUMBER_FORMAT' };
  }

  if (intPart === '') {
    return finish(Number(`0.${fracPart}`));
  }

  // Integer side may use thousand separators or be plain digits
  if (intPart.includes(decimalSep)) {
    return { status: 'error', code: 'AMBIGUOUS_NUMBER_FORMAT' };
  }

  if (intPart.includes(thousandSep)) {
    const groups = intPart.split(thousandSep);
    if (groups.some((g) => g === '' || !/^\d+$/.test(g))) {
      return { status: 'error', code: 'INVALID_NUMBER_FORMAT' };
    }
    if (groups[0].length < 1 || groups[0].length > 3) {
      return { status: 'error', code: 'AMBIGUOUS_NUMBER_FORMAT' };
    }
    for (let i = 1; i < groups.length; i++) {
      if (groups[i].length !== 3) {
        return { status: 'error', code: 'AMBIGUOUS_NUMBER_FORMAT' };
      }
    }
    return finish(Number(`${groups.join('')}.${fracPart}`));
  }

  if (!/^\d+$/.test(intPart)) {
    return { status: 'error', code: 'INVALID_NUMBER_FORMAT' };
  }
  return finish(Number(`${intPart}.${fracPart}`));
}

/**
 * Sales-aware monetary parse: US + European/Mexican formats.
 * Does not change inventory `parseMonetary` (EU still rejected there).
 */
export function parseSalesMonetary(raw: unknown): MonetaryParseResult {
  if (raw === null || raw === undefined) return { status: 'empty' };
  const original = String(raw).trim();
  if (original === '') return { status: 'empty' };

  if (FOREIGN_SYMBOLS.test(original)) {
    return { status: 'error', code: 'CONFLICTING_CURRENCY' };
  }

  const codes = new Set<'MXN' | 'USD'>();

  let working = original.replace(/US\s*\$/gi, () => {
    codes.add('USD');
    return ' ';
  });
  working = working.replace(/\$\s*US\b/gi, () => {
    codes.add('USD');
    return ' ';
  });
  working = working.replace(/MX\s*\$/gi, () => {
    codes.add('MXN');
    return ' ';
  });

  working = working.replace(/\b(MXN|USD|MX|US|UDS|DLS|DOLARES|DÓLARES)\b/gi, (match) => {
    const key = match.toUpperCase().normalize('NFC');
    const mapped =
      CURRENCY_CODE_MAP[key] ??
      CURRENCY_CODE_MAP[match.toUpperCase().replace(/Ó/g, 'O')] ??
      ( /D[OÓ]LARES/i.test(match) ? 'USD' : undefined);
    if (mapped) codes.add(mapped);
    return ' ';
  });

  if (codes.size > 1) {
    return { status: 'error', code: 'CONFLICTING_CURRENCY' };
  }

  // Bare '$' carries no currency claim
  const str = working.replace(/\$/g, '').replace(/\s+/g, ' ').trim();
  if (str === '' || str === '-') {
    return { status: 'error', code: 'INVALID_NUMBER_FORMAT' };
  }

  const detectedCurrency = codes.size === 1 ? [...codes][0] : undefined;
  const parsed = parseSalesLocalizedNumber(str);
  if (parsed.status !== 'ok') return parsed;

  return detectedCurrency
    ? { status: 'ok', value: parsed.value, detectedCurrency }
    : { status: 'ok', value: parsed.value };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Normalize a monetary amount to MXN using FX only when currency is explicitly USD.
 * Bare `$` / unlabeled amounts → MXN with assumedMxn=true (no FX).
 */
export function normalizeMoneyField(
  amount: number | null | undefined,
  currency: 'MXN' | 'USD' | null | undefined,
  fxRate: number | null,
  options?: { currencyExplicit?: boolean },
): NormalizedMoney | null {
  const explicit = options?.currencyExplicit ?? currency != null;
  return normalizeMoneyFieldWithDefault(amount, currency, fxRate, explicit);
}

/** Convenience: assume MXN when currency is missing/implicit. */
export function normalizeMoneyFieldWithDefault(
  amount: number | null | undefined,
  currency: 'MXN' | 'USD' | null | undefined,
  fxRate: number | null,
  currencyExplicit: boolean,
): NormalizedMoney | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return null;

  if (currency === 'USD' && currencyExplicit && fxRate !== null) {
    return {
      mxn: roundMoney(amount * fxRate),
      original: amount,
      currency: 'USD',
      rate: fxRate,
      assumedMxn: false,
    };
  }

  if (currency === 'USD' && currencyExplicit) {
    return {
      mxn: amount,
      original: amount,
      currency: 'USD',
      rate: null,
      assumedMxn: false,
    };
  }

  return {
    mxn: amount,
    original: amount,
    currency: 'MXN',
    rate: null,
    assumedMxn: !currencyExplicit,
  };
}
