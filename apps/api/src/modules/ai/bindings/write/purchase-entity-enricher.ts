/**
 * Deterministic REGISTER_PURCHASE entity enrichment before Planner.
 * Does not execute writes. Never invents serial/reference/year/box-papers.
 * Defaults acquiredAt to today (matches Inventario "Registrar compra") — preview must show it.
 * Defaults condition to "Bueno" (matches Ventas quick-watch stub) — disclosed in preview.
 * Does NOT default paymentMode (must clarify).
 */

export const PURCHASE_SOURCE_LABELS: Record<'CASH' | 'BANK' | 'CESAR', string> = {
  CASH: 'Efectivo',
  BANK: 'Bancos',
  CESAR: 'Cuenta César',
};

export const PURCHASE_PAYMENT_MODE_LABELS: Record<'PAID' | 'CREDIT' | 'PARTIAL', string> = {
  PAID: 'Pagado',
  CREDIT: 'A crédito',
  PARTIAL: 'Pago parcial',
};

export const PURCHASE_STATUS_LABELS: Record<'AVAILABLE' | 'IN_TRANSIT', string> = {
  AVAILABLE: 'Disponible',
  IN_TRANSIT: 'En tránsito',
};

/** Narrow commercial aliases — no fuzzy catalog search. */
const WATCH_ALIASES: Array<{
  match: RegExp;
  brand: string;
  model: string;
  label: string;
}> = [
  { match: /\bbatman\b/i, brand: 'Rolex', model: 'GMT-Master II Batman', label: 'Rolex GMT-Master II Batman' },
  { match: /\bdaytona\b/i, brand: 'Rolex', model: 'Daytona', label: 'Rolex Daytona' },
  { match: /\byacht[-\s]?master\b/i, brand: 'Rolex', model: 'Yacht-Master', label: 'Rolex Yacht-Master' },
  { match: /\bsubmariner\b/i, brand: 'Rolex', model: 'Submariner', label: 'Rolex Submariner' },
  { match: /\broyal\s*oak\b/i, brand: 'Audemars Piguet', model: 'Royal Oak', label: 'Audemars Piguet Royal Oak' },
  { match: /\bnautilus\b/i, brand: 'Patek Philippe', model: 'Nautilus', label: 'Patek Philippe Nautilus' },
  { match: /\baquanaaut\b|\baquanaut\b/i, brand: 'Patek Philippe', model: 'Aquanaut', label: 'Patek Philippe Aquanaut' },
];

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
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
  const lower = raw.toLowerCase();
  if (lower === 'hoy' || lower === 'today') return null; // handled with now
  if (lower === 'ayer' || lower === 'yesterday') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function resolveRelativeDate(value: unknown, now: Date): string | null {
  const raw = asString(value)?.toLowerCase();
  if (!raw) return null;
  if (raw === 'hoy' || raw === 'today') return todayIso(now);
  if (raw === 'ayer' || raw === 'yesterday') {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - 1);
    return todayIso(d);
  }
  return normalizeDateField(value);
}

export function formatPurchaseDateLabel(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  const months = [
    'ene', 'feb', 'mar', 'abr', 'may', 'jun',
    'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
  ];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

export function resolvePurchaseSource(value: unknown): 'CASH' | 'BANK' | 'CESAR' | null {
  const raw = asString(value);
  if (!raw) return null;
  const u = raw.toUpperCase().replace(/\s+/g, '_');
  if (u === 'CASH' || u === 'EFECTIVO' || u === 'CASH_ACCOUNT') return 'CASH';
  if (u === 'BANK' || u === 'BANCOS' || u === 'BANCO' || u === 'TRANSFER' || u === 'TRANSFERENCIA') {
    return 'BANK';
  }
  if (u === 'CESAR' || u === 'CUENTA_CESAR' || u === 'CUENTA-DE-CESAR') return 'CESAR';
  const lower = raw.toLowerCase();
  if (/efectivo|cash/.test(lower)) return 'CASH';
  if (/banco|bank|transfer/.test(lower)) return 'BANK';
  if (/c[eé]sar/.test(lower)) return 'CESAR';
  return null;
}

export function resolvePurchasePaymentMode(value: unknown): 'PAID' | 'CREDIT' | 'PARTIAL' | null {
  const raw = asString(value);
  if (!raw) return null;
  const u = raw.toUpperCase();
  if (u === 'PAID' || u === 'PAGADO' || u === 'CONTADO') return 'PAID';
  if (u === 'CREDIT' || u === 'CREDITO' || u === 'CRÉDITO' || u === 'PENDIENTE') return 'CREDIT';
  if (u === 'PARTIAL' || u === 'PARCIAL') return 'PARTIAL';
  const lower = raw.toLowerCase();
  if (/pagad[oa]|contado|completo|lo pagu[eé]|ya qued[oó] pagad/.test(lower)) return 'PAID';
  if (/cr[eé]dito|pendiente|no (le )?pagu[eé]|a cr[eé]dito/.test(lower)) return 'CREDIT';
  if (/parcial|pagu[eé] .* y |le di |quedaron/.test(lower)) return 'PARTIAL';
  return null;
}

export function resolveWatchIdentity(entities: Record<string, unknown>): {
  brand: string | null;
  model: string | null;
  label: string | null;
  ambiguous: boolean;
} {
  let brand = asString(entities.brand);
  let model = asString(entities.model);
  const query =
    asString(entities.watchQuery) ??
    asString(entities.watch) ??
    asString(entities.query) ??
    null;

  if (brand && model) {
    return { brand, model, label: `${brand} ${model}`, ambiguous: false };
  }

  if (query) {
    for (const alias of WATCH_ALIASES) {
      if (alias.match.test(query)) {
        return {
          brand: alias.brand,
          model: alias.model,
          label: alias.label,
          ambiguous: false,
        };
      }
    }
    // "Rolex Daytona" / "AP Royal Oak" style
    const parts = query.replace(/^(un|una|el|la)\s+/i, '').trim().split(/\s+/);
    if (parts.length >= 2) {
      const knownBrands: Array<{ match: RegExp; brand: string }> = [
        { match: /^rolex$/i, brand: 'Rolex' },
        { match: /^(ap|audemars|audemars\s*piguet)$/i, brand: 'Audemars Piguet' },
        { match: /^(patek|pp)$/i, brand: 'Patek Philippe' },
        { match: /^omega$/i, brand: 'Omega' },
        { match: /^cartier$/i, brand: 'Cartier' },
      ];
      const first = parts[0]!;
      for (const kb of knownBrands) {
        if (kb.match.test(first)) {
          return {
            brand: kb.brand,
            model: parts.slice(1).join(' '),
            label: `${kb.brand} ${parts.slice(1).join(' ')}`,
            ambiguous: false,
          };
        }
      }
    }
    if (parts.length === 1 && parts[0]) {
      return { brand: null, model: null, label: query, ambiguous: true };
    }
  }

  return { brand, model, label: brand && model ? `${brand} ${model}` : query, ambiguous: !brand || !model };
}

export function enrichPurchaseEntities(
  entities: Record<string, unknown>,
  now: Date = new Date(),
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...entities };

  // Cost aliases
  if (next.cost == null && next.purchaseAmount != null) next.cost = next.purchaseAmount;
  if (next.purchaseAmount == null && next.cost != null) next.purchaseAmount = next.cost;

  if (next.cost != null && (next.currency == null || next.currency === '')) {
    next.currency = 'MXN';
  }
  if (typeof next.currency === 'string') {
    next.currency = next.currency.trim().toUpperCase();
  }

  const identity = resolveWatchIdentity(next);
  if (identity.brand && identity.model) {
    next.brand = identity.brand;
    next.model = identity.model;
    next.watchLabel = identity.label;
    delete next.watchIdentityAmbiguous;
  } else if (identity.ambiguous) {
    next.watchIdentityAmbiguous = true;
    if (identity.label) next.watchLabel = identity.label;
  }

  // Serial: trim only; no case folding
  const serial =
    asString(next.serialNumber) ?? asString(next.serial) ?? null;
  if (serial) {
    next.serialNumber = serial;
    next.serial = serial;
  } else {
    delete next.serialNumber;
    delete next.serial;
  }

  // Never invent reference
  if (!asString(next.reference)) delete next.reference;

  // Condition default (disclosed)
  if (!asString(next.condition)) {
    next.condition = 'Bueno';
    next.conditionDefaulted = true;
  }

  // Status
  const statusRaw = asString(next.status)?.toUpperCase();
  const inTransitHint =
    /todav[ií]a no|no (me )?llega|en camino|en tr[aá]nsito|pending receipt|in transit/i.test(
      [
        asString(next.notes),
        asString(next.watchQuery),
        asString(next.statusHint),
        asString(next.rawText),
      ]
        .filter(Boolean)
        .join(' '),
    );
  if (statusRaw === 'IN_TRANSIT' || inTransitHint) {
    next.status = 'IN_TRANSIT';
  } else if (statusRaw === 'AVAILABLE' || !statusRaw) {
    next.status = 'AVAILABLE';
  }
  next.statusLabel =
    PURCHASE_STATUS_LABELS[next.status as 'AVAILABLE' | 'IN_TRANSIT'] ?? next.status;

  // Payment mode — no silent default
  const mode =
    resolvePurchasePaymentMode(next.paymentMode) ??
    resolvePurchasePaymentMode(next.payment) ??
    resolvePurchasePaymentMode(next.pago);
  if (mode) {
    next.paymentMode = mode;
    next.paymentModeLabel = PURCHASE_PAYMENT_MODE_LABELS[mode];
  } else {
    delete next.paymentMode;
    delete next.paymentModeLabel;
  }

  // Infer PARTIAL when initial payment present with cost
  const initial =
    asNumber(next.initialPaymentAmount) ??
    asNumber(next.amountPaid) ??
    asNumber(next.paidAmount);
  const cost = asNumber(next.cost) ?? asNumber(next.purchaseAmount);
  if (!mode && initial != null && cost != null && initial > 0 && initial < cost) {
    next.paymentMode = 'PARTIAL';
    next.paymentModeLabel = PURCHASE_PAYMENT_MODE_LABELS.PARTIAL;
    next.initialPaymentAmount = initial;
  } else if (initial != null) {
    next.initialPaymentAmount = initial;
  }

  // Source
  const source =
    resolvePurchaseSource(next.sourceAccount) ??
    resolvePurchaseSource(next.source) ??
    resolvePurchaseSource(next.fundingSource);
  if (source) {
    next.sourceAccount = source;
    next.source = source;
    next.sourceLabel = PURCHASE_SOURCE_LABELS[source];
    delete next.sourceUnsupported;
  } else {
    const raw =
      asString(next.sourceAccount) ?? asString(next.source) ?? asString(next.fundingSource);
    if (raw && /crypto|usdt|bitcoin|btc/i.test(raw)) {
      next.sourceUnsupported = 'CRYPTO';
    }
    if (next.paymentMode === 'CREDIT') {
      delete next.sourceAccount;
      delete next.source;
      delete next.sourceLabel;
    }
  }

  // Seller free-text
  const sellerName =
    asString(next.sellerCounterpartyName) ??
    asString(next.supplierQuery) ??
    asString(next.sellerQuery) ??
    asString(next.sellerName) ??
    asString(next.vendedor);
  if (sellerName) {
    next.sellerCounterpartyName = sellerName;
    next.sellerLabel = sellerName;
  }
  // Keep sellerClientId only if already a trusted string id (NL strips untrusted)
  if (!asString(next.sellerClientId)) delete next.sellerClientId;

  // Acquisition date — default today
  const date =
    resolveRelativeDate(next.acquiredAt, now) ??
    resolveRelativeDate(next.acquisitionDate, now) ??
    resolveRelativeDate(next.date, now) ??
    resolveRelativeDate(next.effectiveDate, now) ??
    todayIso(now);
  next.acquiredAt = date;
  next.acquisitionDate = date;
  next.date = date;
  next.dateLabel = formatPurchaseDateLabel(date);

  // Outstanding for preview when PARTIAL
  const modeFinal = asString(next.paymentMode);
  if (modeFinal === 'PARTIAL' && cost != null && initial != null && initial > 0 && initial < cost) {
    next.outstandingAmount = Number((cost - initial).toFixed(2));
  }

  return next;
}
