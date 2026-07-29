import { createHash } from 'crypto';

/** Stable JSON stringify with sorted object keys (arrays keep order). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = canonicalize(obj[key]);
  }
  return out;
}

export function sha256Hex(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function fingerprintPrefix(hex: string, len = 12): string {
  return hex.slice(0, len);
}

export function candidateFingerprint(
  entityType: string,
  candidateId: string,
  payload: unknown,
): string {
  return sha256Hex({ entityType, candidateId, payload });
}

export function saleMigrationFingerprint(input: {
  datasetId: string;
  candidateId: string;
  saleDate: string | null;
  customerNormalized: string;
  brand: string;
  model: string;
  reference: string | null;
  serial: string | null;
  cost: number | null;
  salePrice: number | null;
  extras: number | null;
  approvedProfit: number | null;
}): string {
  return sha256Hex({ kind: 'historical-sale', ...input });
}
