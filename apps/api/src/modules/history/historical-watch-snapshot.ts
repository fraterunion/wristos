/**
 * Deterministic parse of Wrist Caviar / historical-sale Notes snapshot.
 * Format written by one-time importer:
 *   brand=...; model=...; ref=...; serial=...; migration=sale_...
 *
 * Display-only. Must never be used to create or link Watch inventory.
 */

export type HistoricalWatchSnapshot = {
  brand: string | null;
  model: string | null;
  reference: string | null;
  serial: string | null;
};

export type DealWatchIdentitySource = 'LINKED_WATCH' | 'HISTORICAL_SNAPSHOT' | 'UNKNOWN';

export type ResolvedDealWatchIdentity = {
  brand: string | null;
  model: string | null;
  reference: string | null;
  serial: string | null;
  source: DealWatchIdentitySource;
};

const TOKEN =
  /(?:^|;\s*)(brand|model|ref|serial)=([^;]*)/gi;

export function parseHistoricalWatchSnapshotFromNotes(
  notes: string | null | undefined,
): HistoricalWatchSnapshot | null {
  if (!notes || !notes.includes('brand=')) return null;

  const out: HistoricalWatchSnapshot = {
    brand: null,
    model: null,
    reference: null,
    serial: null,
  };

  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(notes)) !== null) {
    const key = m[1]!.toLowerCase();
    const raw = m[2]!.trim();
    const value = raw.length > 0 ? raw : null;
    if (key === 'brand') out.brand = value;
    else if (key === 'model') out.model = value;
    else if (key === 'ref') out.reference = value;
    else if (key === 'serial') out.serial = value;
  }

  // Require at least one identity token to treat as a snapshot
  if (!out.brand && !out.model && !out.reference && !out.serial) return null;
  return out;
}

/** Trim + collapse internal whitespace. Does not change casing. */
export function normalizeWatchLabel(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
}

/** Case-insensitive grouping key (whitespace already collapsed). */
export function watchLabelGroupKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Resolve display brand/model for a CLOSED_WON deal.
 * Linked Watch wins; otherwise historical notes snapshot. Never invents inventory links.
 */
export function resolveDealWatchIdentity(deal: {
  notes?: string | null;
  watch?: {
    brand?: string | null;
    model?: string | null;
    reference?: string | null;
    serial?: string | null;
  } | null;
}): ResolvedDealWatchIdentity {
  const linkedBrand = normalizeWatchLabel(deal.watch?.brand);
  const linkedModel = normalizeWatchLabel(deal.watch?.model);
  const linkedRef = normalizeWatchLabel(deal.watch?.reference ?? null);
  const linkedSerial = normalizeWatchLabel(deal.watch?.serial ?? null);

  if (linkedBrand || linkedModel || linkedRef || linkedSerial) {
    return {
      brand: linkedBrand,
      model: linkedModel,
      reference: linkedRef,
      serial: linkedSerial,
      source: 'LINKED_WATCH',
    };
  }

  const snap = parseHistoricalWatchSnapshotFromNotes(deal.notes);
  if (snap) {
    return {
      brand: normalizeWatchLabel(snap.brand),
      model: normalizeWatchLabel(snap.model),
      reference: normalizeWatchLabel(snap.reference),
      serial: normalizeWatchLabel(snap.serial),
      source: 'HISTORICAL_SNAPSHOT',
    };
  }

  return {
    brand: null,
    model: null,
    reference: null,
    serial: null,
    source: 'UNKNOWN',
  };
}

/** Aggregation display keys — never empty, never "Histórico" / "—". */
export function resolveBrandAggregationLabel(identity: ResolvedDealWatchIdentity): string {
  return identity.brand ?? 'Sin marca';
}

export function resolveModelAggregationLabel(identity: ResolvedDealWatchIdentity): string {
  return identity.model ?? 'Sin modelo';
}

export function isWorkbookHistoricalSaleSourceTag(sourceTag: string | null | undefined): boolean {
  return (
    sourceTag === 'HISTORICAL_SALES_IMPORT' ||
    sourceTag === 'wrist-caviar-master-workbook-v1'
  );
}

/**
 * True when a deal should be treated as a completed historical snapshot for
 * display / live-AR exclusion (no deal Payment rows; open AR lives in CXC).
 */
export function isSettledHistoricalSaleSnapshot(input: {
  sourceTag?: string | null;
  importSessionId?: string | null;
  paymentCount: number;
}): boolean {
  const isHistorical =
    isWorkbookHistoricalSaleSourceTag(input.sourceTag) || input.importSessionId != null;
  return isHistorical && input.paymentCount === 0;
}
