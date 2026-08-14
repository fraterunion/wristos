/**
 * Deterministic treasury/capital account-word detection + per-capability
 * remap. There is no single shared account normalizer in the codebase (see
 * audit) — Treasury/Expense/Purchase/Payable use CASH|BANK|CESAR, Sale uses
 * CASH|BANCOS|CESAR (note: BANCOS, not BANK), Capital uses
 * CASH|BANK|CESAR_ACCOUNT (note: CESAR_ACCOUNT, not CESAR). This module
 * detects a canonical CASH|BANK|CESAR triple from free text once, then
 * remaps it to the exact literal each capability's entitySchemas enum
 * expects (apps/api/src/modules/ai/intent-adapter/intent-schema.ts) — never
 * relying on downstream normalization, since normalizeEntities does not
 * touch account/destination/source fields at all.
 */

export type CanonicalAccount = 'CASH' | 'BANK' | 'CESAR';

const CESAR_RE = /\b(cuenta de cesar|cuenta cesar|cesar)\b/;
const BANK_RE = /\b(bancos?|transferencia bancaria|cuenta bancaria)\b/;
const CASH_RE = /\b(efectivo|cash|caja)\b/;

/** Scans `folded` text (see text-normalize.ts) for an account label. Order matters: CESAR checked before BANK/CASH since it's the most specific. */
export function detectCanonicalAccount(folded: string): CanonicalAccount | null {
  if (CESAR_RE.test(folded)) return 'CESAR';
  if (BANK_RE.test(folded)) return 'BANK';
  if (CASH_RE.test(folded)) return 'CASH';
  return null;
}

/** REGISTER_SALE's `destination` field uses BANCOS, not BANK. */
export function toSaleDestination(account: CanonicalAccount): 'CASH' | 'BANCOS' | 'CESAR' {
  return account === 'BANK' ? 'BANCOS' : account;
}

/** REGISTER_CAPITAL_CONTRIBUTION/DISTRIBUTION's `account` field uses CESAR_ACCOUNT, not CESAR. */
export function toCapitalAccount(account: CanonicalAccount): 'CASH' | 'BANK' | 'CESAR_ACCOUNT' {
  return account === 'CESAR' ? 'CESAR_ACCOUNT' : account;
}

/** REGISTER_TREASURY_TRANSFER / REGISTER_EXPENSE / REGISTER_PURCHASE / REGISTER_PAYABLE_PAYMENT / REGISTER_RECEIVABLE_PAYMENT all use the canonical triple as-is. */
export function toCanonicalAccount(account: CanonicalAccount): CanonicalAccount {
  return account;
}
