import {
  CAPITAL_ACCOUNT_LABELS,
  normalizeCapitalContributionAccount,
} from './register-capital-contribution.binding';

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

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
 * Deterministic REGISTER_CAPITAL_DISTRIBUTION enrichment before Planner.
 * Defaults paidAt to today (UTC day) when absent. Does NOT default CapitalAccount.
 */
export function enrichCapitalDistributionEntities(
  entities: Record<string, unknown>,
  now: Date = new Date(),
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...entities };

  if (next.amount != null && (next.currency == null || next.currency === '')) {
    next.currency = 'MXN';
  }
  if (typeof next.currency === 'string') {
    next.currency = next.currency.trim().toUpperCase();
  }

  const account =
    normalizeCapitalContributionAccount(next.account) ??
    normalizeCapitalContributionAccount(next.capitalAccount) ??
    normalizeCapitalContributionAccount(next.accountQuery);
  if (account) {
    next.account = account;
    next.accountLabel = CAPITAL_ACCOUNT_LABELS[account];
  }

  const date =
    normalizeDateField(next.paidAt) ??
    normalizeDateField(next.date) ??
    normalizeDateField(next.effectiveDate) ??
    todayIso(now);
  next.paidAt = date;
  next.date = date;

  return next;
}
