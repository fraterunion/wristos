import { RawIntentCandidate } from './intent-schema';

/**
 * Deterministic canonicalization of already-extracted values. This is
 * explicitly NOT a natural-language parser (see Part 5): the provider
 * identifies meaning ("35 mil" means thirty-five thousand); this module only
 * cleans up the *format* of what the provider already extracted — stripping
 * currency symbols/commas the model left in, padding decimals, mapping a
 * small fixed set of known synonyms, and filling in the current period when
 * nothing more specific was extracted. None of this re-derives meaning from
 * free text.
 */

const MONTH_NAMES_ES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

const CURRENCY_SYNONYMS: Record<string, 'MXN' | 'USD'> = {
  mxn: 'MXN', peso: 'MXN', pesos: 'MXN', 'peso mexicano': 'MXN', 'pesos mexicanos': 'MXN',
  usd: 'USD', dolar: 'USD', dolares: 'USD', dólar: 'USD', dólares: 'USD', 'us dollar': 'USD', 'us dollars': 'USD',
};

/** Strips currency symbols/thousands separators a model may have left in, e.g. "$35,000" -> "35000". */
function stripAmountNoise(raw: string): string {
  return raw.replace(/[^\d.-]/g, '');
}

/**
 * Canonicalizes an amount-like value into the strict `-?\d+\.\d{2}` format
 * the rest of the system already expects (see intent-schema.ts's `money`).
 * Returns null if the value cannot be safely interpreted as a plain number.
 */
export function normalizeMoney(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = typeof raw === 'number' ? String(raw) : stripAmountNoise(raw);
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return value.toFixed(2);
}

/** Uppercases/maps a small fixed set of known currency synonyms. Returns null if unrecognized. */
export function normalizeCurrency(raw: string | null | undefined): 'MXN' | 'USD' | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (key === 'mxn' || key === 'usd') return key.toUpperCase() as 'MXN' | 'USD';
  return CURRENCY_SYNONYMS[key] ?? null;
}

/** Accepts an already-numeric month (1-12) or a Spanish month name; returns null otherwise. */
export function normalizeMonth(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 1 && raw <= 12 ? raw : null;
  const key = raw.trim().toLowerCase();
  if (/^\d{1,2}$/.test(key)) {
    const value = Number(key);
    return value >= 1 && value <= 12 ? value : null;
  }
  return MONTH_NAMES_ES[key] ?? null;
}

export function normalizeYear(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(value) && value >= 2000 && value <= 2200 ? value : null;
}

/** Strips thousands separators from a plain (non-money) quantity, e.g. crypto amounts. */
export function normalizeQuantity(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = typeof raw === 'number' ? String(raw) : raw.replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return cleaned;
}

/** Trims/collapses whitespace on a free-text query. Never resolves it to an id. */
export function normalizeQueryText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  return trimmed.length ? trimmed.slice(0, 120) : null;
}

/**
 * Canonicalizes a limit-like value to an integer in [1, 50].
 * Accepts exact numeric strings ("10") and integers; rejects floats/noise.
 */
export function normalizeLimit(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 1 && raw <= 50 ? raw : null;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= 50 ? value : null;
}

const INVENTORY_STATUS_SYNONYMS: Record<string, 'AVAILABLE' | 'RESERVED' | 'ALL'> = {
  available: 'AVAILABLE',
  disponible: 'AVAILABLE',
  disponibles: 'AVAILABLE',
  reserved: 'RESERVED',
  reservado: 'RESERVED',
  reservados: 'RESERVED',
  all: 'ALL',
  todos: 'ALL',
  todas: 'ALL',
};

/** Maps exact enum codes or a small fixed synonym set to canonical inventory status. */
export function normalizeInventoryStatus(
  raw: string | null | undefined,
): 'AVAILABLE' | 'RESERVED' | 'ALL' | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (key === 'available' || key === 'reserved' || key === 'all') {
    return key.toUpperCase() as 'AVAILABLE' | 'RESERVED' | 'ALL';
  }
  return INVENTORY_STATUS_SYNONYMS[key] ?? null;
}

/**
 * Removes explicit null entity values before per-intent Zod validation.
 * Providers often emit null for omitted optionals; Zod `.optional()` rejects null.
 */
export function stripNullEntityValues(
  entities: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(entities)) {
    if (value !== null) out[key] = value;
  }
  return out;
}

/**
 * Allowlisted SEARCH_* field aliases → canonical `query`.
 * Claude sometimes mirrors write-intent *Query naming onto search intents;
 * this only remaps known aliases when `query` is absent. Never invents IDs.
 */
const SEARCH_QUERY_ALIASES: Record<'SEARCH_INVENTORY' | 'SEARCH_CLIENT', readonly string[]> = {
  SEARCH_INVENTORY: ['watchQuery'],
  SEARCH_CLIENT: ['clientQuery', 'customerQuery'],
};

function applySearchQueryAliases(
  intent: string,
  entities: Record<string, string | number | boolean | null>,
): void {
  if (intent !== 'SEARCH_INVENTORY' && intent !== 'SEARCH_CLIENT') return;
  const aliases = SEARCH_QUERY_ALIASES[intent];
  if (!('query' in entities) || entities.query === null || entities.query === '') {
    for (const alias of aliases) {
      if (alias in entities && entities[alias] !== null && entities[alias] !== '') {
        entities.query = entities[alias];
        break;
      }
    }
  }
  for (const alias of aliases) {
    delete entities[alias];
  }
}

/** Normalizes an ISO-ish date string; returns null if not a plain YYYY-MM-DD. */
export function normalizeIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

export interface RelativePeriodContext {
  currentDate: string; // ISO YYYY-MM-DD
}

/**
 * "este mes" / no month given at all -> current year/month. This does not
 * distinguish between the two cases textually (that would require parsing
 * free text); both simply mean "the provider did not extract a specific
 * period," and defaulting to the current one is the correct, safe behavior
 * either way — matching the GET_MONTHLY_PROFIT quick action's own default.
 */
export function resolveCurrentPeriod(context: RelativePeriodContext): { year: number; month: number } {
  const [year, month] = context.currentDate.split('-').map(Number);
  return { year, month };
}

/**
 * Applies the canonicalization rules above to a validated raw candidate's
 * entity bag, returning a NEW entities record. This runs before per-intent
 * Zod validation (intent-schema.ts's entitySchemas) — it only reshapes
 * values, it never adds semantic information the provider didn't already
 * extract, except for the explicit current-period default described above.
 */
export function normalizeEntities(
  candidate: Pick<RawIntentCandidate, 'intent' | 'entities'>,
  context: RelativePeriodContext,
): Record<string, string | number | boolean | null> {
  // Drop provider nulls first — optional Zod fields reject null ≠ omitted.
  const out: Record<string, string | number | boolean | null> = {
    ...stripNullEntityValues(candidate.entities as Record<string, string | number | boolean | null>),
  };

  applySearchQueryAliases(candidate.intent, out);

  const moneyFields: Record<string, string[]> = {
    REGISTER_SALE: ['price'],
    REGISTER_RECEIVABLE_PAYMENT: ['amount'],
    REGISTER_PAYABLE_PAYMENT: ['amount', 'exchangeRateUsed'],
    REGISTER_TREASURY_TRANSFER: ['amount'],
    REGISTER_PURCHASE: ['cost'],
    REGISTER_EXPENSE: ['amount'],
    REGISTER_SETTLEMENT: ['amount'],
    REGISTER_CRYPTO_POSITION: ['cost'],
    REGISTER_CRYPTO_PRICE: ['unitPrice'],
  };
  for (const field of moneyFields[candidate.intent] ?? []) {
    if (field in out) {
      const normalized = normalizeMoney(out[field] as string | number | null);
      if (normalized !== null) out[field] = normalized;
      else delete out[field];
    }
  }

  if (candidate.intent === 'REGISTER_CRYPTO_POSITION' && 'quantity' in out) {
    const normalized = normalizeQuantity(out.quantity as string | number | null);
    if (normalized !== null) out.quantity = normalized;
    else delete out.quantity;
  }

  if ('currency' in out) {
    const normalized = normalizeCurrency(out.currency as string | null);
    if (normalized) out.currency = normalized;
    else delete out.currency;
  }

  for (const field of ['query', 'clientQuery', 'watchQuery', 'customerQuery', 'supplierQuery', 'sourceQuery', 'destinationQuery', 'concept', 'asset', 'serial']) {
    if (field in out && typeof out[field] === 'string') {
      const normalized = normalizeQueryText(out[field] as string);
      if (normalized) out[field] = normalized;
      else delete out[field];
    }
  }

  if ('limit' in out) {
    const normalized = normalizeLimit(out.limit as string | number | null);
    if (normalized !== null) out.limit = normalized;
    else delete out.limit;
  }

  if (candidate.intent === 'SEARCH_INVENTORY' && 'status' in out) {
    if (typeof out.status !== 'string') {
      delete out.status;
    } else {
      const normalized = normalizeInventoryStatus(out.status);
      if (normalized) out.status = normalized;
      else delete out.status;
    }
  }

  for (const field of ['effectiveDate']) {
    if (field in out) {
      const normalized = normalizeIsoDate(out[field] as string | null);
      if (normalized) out[field] = normalized;
      else delete out[field];
    }
  }

  if (candidate.intent === 'GET_MONTHLY_PROFIT') {
    const month = normalizeMonth(out.month as string | number | null | undefined);
    const year = normalizeYear(out.year as string | number | null | undefined);
    if (month !== null) out.month = month;
    else delete out.month;
    if (year !== null) out.year = year;
    else delete out.year;

    // Only default when the provider did not flag this as missing/ambiguous
    // itself — that signal is preserved by the caller (intent-candidate.ts),
    // which passes only the entities considered "resolved" through here.
    if (out.month === undefined && out.year === undefined) {
      const current = resolveCurrentPeriod(context);
      out.month = current.month;
      out.year = current.year;
    }
  }

  const periodIntents = new Set([
    'GET_SALES_MARGIN_SUMMARY',
    'GET_PROFIT_BY_BRAND',
    'GET_TOP_SALES',
  ]);
  if (periodIntents.has(candidate.intent)) {
    const month = normalizeMonth(out.month as string | number | null | undefined);
    const year = normalizeYear(out.year as string | number | null | undefined);
    if (month !== null) out.month = month;
    else delete out.month;
    if (year !== null) out.year = year;
    else delete out.year;

    if (typeof out.period === 'string') {
      const p = out.period.toUpperCase();
      if (['CURRENT_MONTH', 'YEAR', 'ALL', 'CUSTOM'].includes(p)) out.period = p;
      else delete out.period;
    }

    if (typeof out.brand === 'string') {
      const brand = normalizeQueryText(out.brand);
      if (brand) out.brand = brand.toUpperCase();
      else delete out.brand;
    }

    if (candidate.intent === 'GET_TOP_SALES' && typeof out.sortBy === 'string') {
      const sort = out.sortBy.toUpperCase().replace(/\s+/g, '_');
      if (['GROSS_PROFIT', 'AGREED_PRICE', 'GROSS_MARGIN_PERCENT'].includes(sort)) out.sortBy = sort;
      else delete out.sortBy;
    }

    // Safe default: current month when no period/year/month provided.
    if (out.period === undefined && out.month === undefined && out.year === undefined) {
      out.period = 'CURRENT_MONTH';
      const current = resolveCurrentPeriod(context);
      out.month = current.month;
      out.year = current.year;
    } else if (out.period === undefined && (out.month !== undefined || out.year !== undefined)) {
      out.period = 'CUSTOM';
      if (out.year === undefined || out.month === undefined) {
        const current = resolveCurrentPeriod(context);
        if (out.year === undefined) out.year = current.year;
        if (out.month === undefined) out.month = current.month;
      }
    }
  }

  if (candidate.intent === 'GET_INVENTORY_AGING' && 'minAgeDays' in out) {
    const n = typeof out.minAgeDays === 'number' ? out.minAgeDays : Number(out.minAgeDays);
    if (Number.isFinite(n) && n >= 0) out.minAgeDays = Math.floor(n);
    else delete out.minAgeDays;
  }

  return out;
}
