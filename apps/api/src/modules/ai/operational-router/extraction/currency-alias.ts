/**
 * Deterministic currency-word detection for the router. Complements (does
 * not replace) intent-adapter/normalization.ts's normalizeCurrency, which
 * only maps a small fixed synonym set once a `currency` field already has a
 * value — this scans free text for currency words the router itself needs
 * to decide the `currency` slot in the first place. Both funnel into the
 * same downstream normalizeCurrency pass either way.
 */

const MXN_RE = /\b(mxn|pesos?|moneda nacional|mx)\b/;
const USD_RE = /\b(usd|dolares|dlls|dls|us\$|dolar)\b/;

/** Scans `folded` text (see text-normalize.ts) for an explicit currency word. Returns null if none found. */
export function detectCurrencyAlias(folded: string): 'MXN' | 'USD' | null {
  if (USD_RE.test(folded)) return 'USD';
  if (MXN_RE.test(folded)) return 'MXN';
  return null;
}
