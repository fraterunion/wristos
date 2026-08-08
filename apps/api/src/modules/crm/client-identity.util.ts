/**
 * Deterministic Client identity normalization for CRM + future CREATE_CLIENT.
 * Does not invent surnames, country codes beyond MX 10-digit local convention,
 * or separate normalized columns — stores canonical values in existing fields.
 *
 * Durable DB uniqueness (migration 20260809180000) uses expression indexes that
 * MUST stay equivalent to:
 *   - email: normalizeClientEmail(stored) === lower(btrim(email))
 *   - phone: clientPhoneIdentityKey(stored) (see SQL in migration)
 */

export function normalizeClientName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Accent-insensitive lowercase key for probable-duplicate name matching only. */
export function clientNameMatchKey(name: string): string {
  return normalizeClientName(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function normalizeClientEmail(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

/**
 * Phone storage/compare policy (V1):
 * - blank → null
 * - strip to digits; require ≥ 7 digits
 * - 10-digit local MX → +52XXXXXXXXXX
 * - 12-digit starting 52 → +52...
 * - otherwise +digits if input had +, else digits
 * Comparison / durable identity key = digit key after the same rules
 * (`clientPhoneIdentityKey`).
 */
export function normalizeClientPhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  if (digits.length === 10) return `+52${digits}`;
  if (digits.length === 12 && digits.startsWith('52')) return `+${digits}`;
  if (trimmed.startsWith('+')) return `+${digits}`;
  return digits;
}

/**
 * Durable phone identity key — identical semantics to migration expression
 * `clients_tenantId_phone_identity_active_key`.
 * Prefer this over clientPhoneMatchKey(normalizeClientPhone(...)) for clarity.
 */
export function clientPhoneIdentityKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  if (digits.length === 10) return `52${digits}`;
  if (digits.length === 12 && digits.startsWith('52')) return digits;
  return digits;
}

/** @deprecated Prefer clientPhoneIdentityKey — same digit key after normalize for stored values. */
export function clientPhoneMatchKey(normalizedPhone: string | null | undefined): string | null {
  return clientPhoneIdentityKey(normalizedPhone);
}

export function isValidClientPhoneInput(raw: string | null | undefined): boolean {
  if (raw == null || raw.trim() === '') return true;
  return normalizeClientPhone(raw) != null;
}

/** Privacy-safe hash material for audits (never log raw PII). */
export function clientIdentityAuditHash(field: 'email' | 'phone', canonicalKey: string): string {
  // Lightweight non-crypto fingerprint for test/audit labels only.
  let h = 0;
  const s = `${field}:${canonicalKey}`;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `idhash_${field}_${(h >>> 0).toString(16)}`;
}
