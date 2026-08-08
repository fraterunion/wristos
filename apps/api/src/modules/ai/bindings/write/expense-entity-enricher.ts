import {
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_SOURCE_LABELS,
  resolveExpenseCategory,
  resolveExpenseSource,
} from './expense-category-resolver';

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
 * Deterministic REGISTER_EXPENSE entity enrichment before Planner.
 * Does not execute writes. Never invents category enums beyond resolver policy.
 * Defaults expense date to today (matches manual Gastos UI) — preview must show it.
 */
export function enrichExpenseEntities(
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

  const concept = asString(next.concept) ?? asString(next.notes);
  const categoryResolve = resolveExpenseCategory({
    category: asString(next.category),
    concept,
    notes: asString(next.notes),
  });

  if (categoryResolve.kind === 'RESOLVED') {
    next.category = categoryResolve.category;
    next.concept = categoryResolve.concept;
    next.categoryLabel = EXPENSE_CATEGORY_LABELS[categoryResolve.category] ?? categoryResolve.category;
    if (!asString(next.notes)) next.notes = categoryResolve.concept;
    delete next.expenseUnsupportedReason;
    delete next.categoryClarifyReason;
  } else if (categoryResolve.kind === 'UNSUPPORTED') {
    delete next.category;
    delete next.categoryLabel;
    next.expenseUnsupportedReason = categoryResolve.reason;
  } else {
    delete next.category;
    delete next.categoryLabel;
    next.categoryClarifyReason = categoryResolve.reason;
  }

  const source =
    resolveExpenseSource(next.source) ??
    resolveExpenseSource(next.sourceAccount) ??
    resolveExpenseSource(next.sourceAccountId);

  if (source) {
    next.source = source;
    next.sourceLabel = EXPENSE_SOURCE_LABELS[source] ?? source;
    delete next.sourceUnsupported;
  } else {
    const rawSource =
      asString(next.source) ?? asString(next.sourceAccount) ?? asString(next.sourceAccountId);
    if (rawSource && /crypto|usdt|bitcoin|btc/i.test(rawSource)) {
      next.sourceUnsupported = 'CRYPTO';
    }
    delete next.source;
    delete next.sourceLabel;
  }

  const date =
    normalizeDateField(next.expenseDate) ??
    normalizeDateField(next.date) ??
    normalizeDateField(next.effectiveDate) ??
    todayIso(now);
  next.date = date;
  next.expenseDate = date;
  next.dateLabel = formatExpenseDateLabel(date);

  return next;
}

export function formatExpenseDateLabel(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  const months = [
    'ene',
    'feb',
    'mar',
    'abr',
    'may',
    'jun',
    'jul',
    'ago',
    'sep',
    'oct',
    'nov',
    'dic',
  ];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}
