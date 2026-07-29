import { createHash } from 'crypto';

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) out[key] = canonicalize(obj[key]);
  return out;
}

export function sha256Hex(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function prefix(hex: string, n = 12): string {
  return hex.slice(0, n);
}

export function safeLog(event: string, fields: Record<string, unknown>): void {
  // Allowed: ids, counts, fingerprints prefixes, status, duration — never PII/amounts
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ event, ...fields, ts: new Date().toISOString() }));
}
