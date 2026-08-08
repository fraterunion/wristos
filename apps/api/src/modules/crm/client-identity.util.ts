/**
 * Deterministic Client identity normalization for CRM + future CREATE_CLIENT.
 * Does not invent surnames, country codes beyond MX 10-digit local convention,
 * or separate normalized columns — stores canonical values in existing fields.
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
 * Comparison key = digits only.
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

export function clientPhoneMatchKey(normalizedPhone: string | null | undefined): string | null {
  if (!normalizedPhone) return null;
  const digits = normalizedPhone.replace(/\D/g, '');
  return digits.length >= 7 ? digits : null;
}

export function isValidClientPhoneInput(raw: string | null | undefined): boolean {
  if (raw == null || raw.trim() === '') return true;
  return normalizeClientPhone(raw) != null;
}
