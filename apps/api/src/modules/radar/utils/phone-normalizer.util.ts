const PHONE_PATTERN = /^[+\d][\d\s\-().]{5,20}$/;

export function looksLikePhone(value: string): boolean {
  return PHONE_PATTERN.test(value.trim());
}

export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) {
    return '+' + trimmed.slice(1).replace(/\D/g, '');
  }
  return trimmed.replace(/\D/g, '');
}
