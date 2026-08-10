import {
  asString,
  defaultConcept,
  normalizeManualAccountCurrency,
} from './create-manual-account.shared';

function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function normalizeDateField(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = asString(value);
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * Deterministic CREATE_RECEIVABLE / CREATE_PAYABLE enrichment before Planner.
 * - Defaults currency to MXN when amount present
 * - Never invents dueDate
 * - Strips provider-supplied clientId / accountEntryId (server resolve only)
 * - Free-text counterpartyName remains valid without Client
 */
export function enrichCreateManualAccountEntities(
  entities: Record<string, unknown>,
  kind: 'RECEIVABLE' | 'PAYABLE',
  _now: Date = new Date(),
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...entities };

  // Provider IDs are never trusted — strip before resolution.
  delete next.clientId;
  delete next.selectedClientId;
  delete next.accountEntryId;
  delete next.entryId;
  delete next.accountId;

  if (next.amount != null && (next.currency == null || next.currency === '')) {
    next.currency = 'MXN';
  }
  const currency = normalizeManualAccountCurrency(next.currency);
  if (currency) next.currency = currency;

  const name =
    asString(next.counterpartyName) ??
    asString(next.customerName) ??
    asString(next.supplierName) ??
    asString(next.name) ??
    asString(next.clientQuery) ??
    asString(next.customerQuery) ??
    asString(next.supplierQuery) ??
    asString(next.counterpartyQuery);
  if (name) {
    next.counterpartyName = name;
    if (!asString(next.clientQuery) && !asString(next.customerQuery)) {
      next.clientQuery = name;
    }
  }

  if (!asString(next.concept)) {
    next.concept =
      asString(next.notes)?.slice(0, 160) ?? defaultConcept(kind);
  }

  const issuedAt =
    normalizeDateField(next.issuedAt) ??
    normalizeDateField(next.date) ??
    normalizeDateField(next.effectiveDate);
  if (issuedAt) {
    next.issuedAt = issuedAt;
  }

  const dueDate = normalizeDateField(next.dueDate);
  if (dueDate) {
    next.dueDate = dueDate;
  }

  // Keep todayIso available for callers that want issuedAt default — domain leaves issuedAt optional.
  void todayIso;

  return next;
}

export function enrichCreateReceivableEntities(
  entities: Record<string, unknown>,
  now: Date = new Date(),
): Record<string, unknown> {
  return enrichCreateManualAccountEntities(entities, 'RECEIVABLE', now);
}

export function enrichCreatePayableEntities(
  entities: Record<string, unknown>,
  now: Date = new Date(),
): Record<string, unknown> {
  return enrichCreateManualAccountEntities(entities, 'PAYABLE', now);
}
