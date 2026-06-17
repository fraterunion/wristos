export const PUBLIC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizePublicSlug(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidPublicSlug(value: string): boolean {
  return PUBLIC_SLUG_PATTERN.test(normalizePublicSlug(value));
}
