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

export function isWorkbookHistoricalSaleSourceTag(sourceTag: string | null | undefined): boolean {
  return (
    sourceTag === 'HISTORICAL_SALES_IMPORT' ||
    sourceTag === 'wrist-caviar-master-workbook-v1'
  );
}
