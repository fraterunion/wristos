/** Deferred sheets — CRIPTO CESAR and OSCAR PAPA CAMI stay out of operational import. */

export const DEFERRED_SHEET_RULES = {
  CRIPTO_CESAR: {
    ruleId: 'WC_DEFER_CRYPTO_SHEET' as const,
    description: 'CRIPTO CESAR sheet is deferred from operational import',
  },
  OSCAR_PAPA_CAMI: {
    ruleId: 'WC_DEFER_OSCAR_SHEET' as const,
    description: 'OSCAR PAPA CAMI sheet is deferred; do not force into Capital',
  },
};

export function isDeferredGroup(label: string): boolean {
  const n = label.normalize('NFKC').trim().toUpperCase();
  return n.includes('CRIPTO') || n.includes('OSCAR');
}
