export const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

export const tenantSlug =
  process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'wrist-caviar';

/** E.164 digits only, e.g. 525551234567 — optional for WhatsApp CTA */
export const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '';
