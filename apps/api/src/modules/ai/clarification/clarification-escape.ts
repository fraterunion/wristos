/**
 * Conversational escape hatches while a clarification is pending.
 * Deterministic only — never invents business values, never weakens field lock
 * for vague answers like names, "Pesos", or "Pepsi".
 */

/** Explicit cancel / abandon phrases (whole utterance). */
export function looksLikeClarificationCancel(text: string): boolean {
  return /^(cancela(?:r)?|olvida(?:lo)?|olv[ií]dalo|ya\s+no|mejor\s+no|d[eé]jalo|deja(?:lo)?|no\s+importa|no)\.?$/i.test(
    text.trim(),
  );
}

/**
 * High-confidence topic change: the utterance clearly starts a different
 * capability than the pending write. Vague replies never match.
 */
export function detectHighConfidenceTopicChange(
  text: string,
  pendingIntent: string,
): { kind: 'TOPIC_CHANGE'; hintedIntent?: string } | null {
  const t = text.trim();
  if (!t || t.length < 8) return null;

  // Closed clarification answers must never be treated as topic changes.
  if (/^(pesos?|d[oó]lares?|mxn|usd|efectivo|bancos?|c[eé]sar|pagad[oa]|a\s+cr[eé]dito|parcial)\.?$/i.test(t)) {
    return null;
  }

  const rules: Array<{ intent: string; pattern: RegExp }> = [
    {
      intent: 'REVERSE_EXPENSE',
      pattern:
        /^(revierte|deshaz|borra|elimina|anula).*(gasto)|^(deshaz eso|me equivoqu[eé])/i,
    },
    {
      intent: 'REGISTER_EXPENSE',
      pattern:
        /^(registra(?:r)?|anota(?:r)?|apunta(?:r)?)\s+(un\s+)?gasto\b|^gast[eé](\s|$)|^pagu[eé]\s+\d/i,
    },
    {
      intent: 'REGISTER_SALE',
      pattern: /^(vend[ií]|vendo)(\s|$)|^(registra(?:r)?)\s+(una\s+)?venta\b/i,
    },
    {
      intent: 'REGISTER_PURCHASE',
      pattern: /^(compr[eé]|compro)(\s|$)|^(registra(?:r)?)\s+(una\s+)?compra\b/i,
    },
    {
      intent: 'REGISTER_TREASURY_TRANSFER',
      pattern:
        /^(transfiere|transferir|haz\s+una\s+transferencia)\b|^pasa\s+\d/i,
    },
    {
      intent: 'REGISTER_RECEIVABLE_PAYMENT',
      pattern: /^(c[oó]brale|cobrale|recibe(?:r)?\s+pago|registra(?:r)?\s+cobro)\b/i,
    },
    {
      intent: 'REGISTER_PAYABLE_PAYMENT',
      pattern: /^(p[aá]gale|pagale|registra(?:r)?\s+pago\s+a)\b/i,
    },
    {
      intent: 'CREATE_CLIENT',
      pattern: /^(crea(?:r)?|alta\s+de)\s+(un\s+)?cliente\b|^nuevo\s+cliente\b/i,
    },
    {
      intent: 'CREATE_RECEIVABLE',
      pattern: /^(nos\s+debe|crea(?:r)?\s+(una\s+)?cuenta\s+por\s+cobrar)\b/i,
    },
    {
      intent: 'CREATE_PAYABLE',
      pattern: /^(le\s+debemos|crea(?:r)?\s+(una\s+)?cuenta\s+por\s+pagar)\b/i,
    },
    {
      intent: 'REGISTER_CAPITAL_CONTRIBUTION',
      pattern: /^(aportaci[oó]n|registra(?:r)?\s+aportaci[oó]n)\b/i,
    },
    {
      intent: 'REGISTER_CAPITAL_DISTRIBUTION',
      pattern: /^(distribuci[oó]n|registra(?:r)?\s+distribuci[oó]n)\b/i,
    },
    {
      intent: 'SEARCH_INVENTORY',
      pattern: /^(busca(?:r)?|encuentra)\s+(el\s+|un\s+)?reloj\b|^busca(?:r)?\s+.+\ben\s+inventario\b/i,
    },
    {
      intent: 'SEARCH_CLIENT',
      pattern: /^(busca(?:r)?|encuentra)\s+(al?\s+|un\s+)?cliente\b|^busca(?:r)?\s+a\s+\w+/i,
    },
    {
      intent: 'GET_LIQUIDITY',
      pattern: /^(dime|dame|muestra(?:me)?|mu[eé]strame)\s+(la\s+)?liquidez\b|^cu[aá]l\s+es\s+mi\s+liquidez\b/i,
    },
  ];

  for (const rule of rules) {
    if (!rule.pattern.test(t)) continue;
    if (rule.intent === pendingIntent) {
      // Same capability restart still abandons the stale clarification draft.
      return { kind: 'TOPIC_CHANGE', hintedIntent: rule.intent };
    }
    return { kind: 'TOPIC_CHANGE', hintedIntent: rule.intent };
  }

  return null;
}
