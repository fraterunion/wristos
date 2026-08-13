/**
 * Deterministic detection of a mid-draft CORRECTION — "No. Era Batman."
 * "No. Fueron 480." "No. Fue por Bancos." "No. Era Abraham Bosquez." — as
 * distinct from a reversal of a PAST, already-executed action (that's
 * reversals/expense-correction-language.ts / transfer-correction-language.ts,
 * triggered by undo/delete verbs, never by bare negation + copula).
 *
 * Classification is closed-form and value-shape-driven, never guesses:
 *   - digits present            -> amount
 *   - efectivo/bancos/césar     -> payment
 *   - pesos/dólares/mxn/usd     -> currency
 *   - anything else             -> 'watch-or-customer' (genuinely ambiguous
 *     from text alone — "Batman" and "Abraham Bosquez" use the identical
 *     "Era <X>." template; NaturalLanguageAssistantService resolves this by
 *     trying the SAME async watch/client resolvers the original extraction
 *     used, never by inventing a classification here).
 */

export type DraftCorrectionField = 'amount' | 'currency' | 'payment' | 'watch-or-customer';

export interface DraftCorrectionMatch {
  field: DraftCorrectionField;
  /** The value with negation/copula/article/trailing punctuation already stripped. */
  rawValue: string;
}

/** The only two capabilities with the watch+customer+amount+currency+payment slot shape this targets. */
export const DRAFT_CORRECTION_CAPABILITIES = new Set(['REGISTER_SALE', 'REGISTER_PURCHASE']);

const NEGATION_OPENER_RE = /^\s*no[.,;:]?\s+/i;
const COPULA_RE = /^(eran|era|fueron|fue)\s+/i;
const LEADING_ARTICLE_RE = /^(el|la|los|las|un|una)\s+/i;
const TRAILING_PUNCTUATION_RE = /[.!?¡¿]+$/g;

const CASH_RE = /\b(efectivo|cash|caja)\b/i;
const BANK_RE = /\b(bancos?|transferencia( bancaria)?|banco)\b/i;
const CESAR_RE = /\bc[eé]sar\b/i;
const MXN_RE = /\b(pesos?|mxn|moneda nacional)\b/i;
const USD_RE = /\b(d[oó]lares?|usd|dlls?|dls)\b/i;
const MONEY_SHAPE_RE = /\d/;

export function detectDraftCorrectionLanguage(text: string, intent: string | undefined): DraftCorrectionMatch | null {
  if (!intent || !DRAFT_CORRECTION_CAPABILITIES.has(intent)) return null;

  const trimmed = text.trim();
  if (!NEGATION_OPENER_RE.test(trimmed)) return null;

  let value = trimmed.replace(NEGATION_OPENER_RE, '').trim();
  if (!value) return null;
  value = value.replace(COPULA_RE, '').trim();
  value = value.replace(TRAILING_PUNCTUATION_RE, '').trim();
  value = value.replace(LEADING_ARTICLE_RE, '').trim();
  if (!value) return null;

  if (CASH_RE.test(value) || BANK_RE.test(value) || CESAR_RE.test(value)) {
    return { field: 'payment', rawValue: value };
  }
  if (MONEY_SHAPE_RE.test(value)) {
    return { field: 'amount', rawValue: value };
  }
  if (MXN_RE.test(value) || USD_RE.test(value)) {
    return { field: 'currency', rawValue: value };
  }
  return { field: 'watch-or-customer', rawValue: value };
}

/** CASH|BANK|CESAR from a payment-correction's raw value, remapped per capability's actual binding enum. */
export function detectCorrectedAccount(value: string, intent: string): 'CASH' | 'BANCOS' | 'BANK' | 'CESAR' | null {
  if (CASH_RE.test(value)) return 'CASH';
  if (BANK_RE.test(value)) return intent === 'REGISTER_SALE' ? 'BANCOS' : 'BANK';
  if (CESAR_RE.test(value)) return 'CESAR';
  return null;
}

/** MXN|USD from a currency-correction's raw value. */
export function detectCorrectedCurrency(value: string): 'MXN' | 'USD' | null {
  if (USD_RE.test(value)) return 'USD';
  if (MXN_RE.test(value)) return 'MXN';
  return null;
}

/** Plain numeric parse for an amount-correction's raw value — matches ClarificationFieldLockService.bindFreeText's existing parsing (no mil/k shorthand, by design: same known limitation, not new). */
export function parseCorrectedAmount(value: string): number | null {
  const parsed = Number(value.replace(/,/g, '').replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
