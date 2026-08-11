/**
 * 26D — Deterministic treasury-transfer correction language (server-side).
 *
 * Provider is assistive, not required for high-confidence transfer undo /
 * delete→reverse phrases. Closed allowlist with REVERSE_EXPENSE deictic layer.
 */

export type TransferCorrectionDetection =
  | {
      kind: 'LAST_ACTION_DEIXIS';
      intent: 'REVERSE_TREASURY_TRANSFER';
      entities: { useLastAction: true };
    }
  | {
      kind: 'TRANSFER_DELETE_OR_REVERSE';
      intent: 'REVERSE_TREASURY_TRANSFER';
      entities: Record<string, string | number | boolean>;
    };

function normalizeCorrectionText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.?!¿¡]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const TRANSFER_NOUN_RE = /\b(transferencia|transferencias|traspaso|traspasos|movimiento de (?:tesorer[ií]a|liquidez))\b/;

const TRANSFER_DELETE_OR_REVERSE_RE =
  /(?:revierte|revertir|deshaz|deshacer|borra|borrar|elimina|eliminar|anula|anular|quita|quitar|me equivoqu[eé])/;

const ACCOUNT_ALIASES: Array<{ re: RegExp; account: 'CASH' | 'BANK' | 'CESAR' }> = [
  { re: /\b(bancos?|bank)\b/, account: 'BANK' },
  { re: /\b(efectivo|caja|cash)\b/, account: 'CASH' },
  { re: /\b(c[eé]sar|cesar)\b/, account: 'CESAR' },
];

function parseAmount(raw: string): number | null {
  const mil = /([\d.]+)\s*(mil|k)\b/i.exec(raw);
  if (mil) {
    const n = Number(mil[1]);
    return Number.isFinite(n) ? n * 1000 : null;
  }
  const cleaned = raw.replace(/\s/g, '').replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Detect high-confidence transfer correction language.
 * Returns null when the utterance should fall through (expense / provider).
 */
export function detectTransferCorrectionLanguage(
  text: string,
): TransferCorrectionDetection | null {
  const t = normalizeCorrectionText(text);
  if (!t) return null;

  // Never steal expense language.
  if (/\bgasto\b/.test(t) || /gasolina|estacionamiento|comida|vi[aá]ticos/.test(t)) {
    return null;
  }

  // Payment / capital / sale / purchase / client / watch — not transfer reverse.
  if (
    /(?:deshaz|revierte|borra|elimina).*(?:\bpago\b|aportaci[oó]n|distribuci[oó]n|cliente|reloj|venta|compra)/.test(
      t,
    ) &&
    !TRANSFER_NOUN_RE.test(t)
  ) {
    return null;
  }

  const mentionsTransfer =
    TRANSFER_NOUN_RE.test(t) ||
    /(?:revierte|deshaz|borra|elimina).*(?:lo que acabo de mover|lo que mov[ií]|ese traspaso|esa transferencia)/.test(
      t,
    ) ||
    /me equivoqu[eé].*(?:transferencia|traspaso|con (?:esa |la )?transferencia|con (?:ese |el )?traspaso)/.test(
      t,
    );

  if (!mentionsTransfer) return null;
  if (!TRANSFER_DELETE_OR_REVERSE_RE.test(t)) return null;

  const entities: Record<string, string | number | boolean> = {};

  // "de X a Y" / "de Bancos a Efectivo"
  const direction = t.match(
    /(?:de|desde)\s+(bancos?|bank|efectivo|caja|cash|c[eé]sar|cesar)\s+(?:a|hacia|para)\s+(bancos?|bank|efectivo|caja|cash|c[eé]sar|cesar)/,
  );
  if (direction) {
    const src = ACCOUNT_ALIASES.find((a) => a.re.test(direction[1]!));
    const dst = ACCOUNT_ALIASES.find((a) => a.re.test(direction[2]!));
    if (src) entities.sourceAccount = src.account;
    if (dst) entities.destinationAccount = dst.account;
  } else {
    // Single-account mentions are weak alone — still capture if direction words present later.
    for (const a of ACCOUNT_ALIASES) {
      if (a.re.test(t) && !entities.sourceAccount) {
        // Prefer "de X" as source, "a X" as destination when present.
      }
    }
    const from = t.match(/(?:de|desde)\s+(bancos?|bank|efectivo|caja|cash|c[eé]sar|cesar)/);
    const to = t.match(/(?:a|hacia|para)\s+(bancos?|bank|efectivo|caja|cash|c[eé]sar|cesar)/);
    if (from) {
      const src = ACCOUNT_ALIASES.find((a) => a.re.test(from[1]!));
      if (src) entities.sourceAccount = src.account;
    }
    if (to) {
      const dst = ACCOUNT_ALIASES.find((a) => a.re.test(to[1]!));
      if (dst) entities.destinationAccount = dst.account;
    }
  }

  const amountMatch = t.match(/(?:de\s+)?([\d.,]+(?:\s*(?:mil|k))?)\s*(?:pesos|mxn)?/);
  if (amountMatch?.[1]) {
    const amount = parseAmount(amountMatch[1]);
    if (amount != null) entities.amount = amount;
  }
  if (/\bhoy\b/.test(t)) entities.dateLabel = 'hoy';
  else if (/\bayer\b/.test(t)) entities.dateLabel = 'ayer';
  if (
    /acabo de (hacer|mover|registrar)|que acabo de|esa transferencia$|ese traspaso$|la transferencia$/.test(
      t,
    ) &&
    !entities.amount &&
    !entities.sourceAccount
  ) {
    entities.useLastAction = true;
  }

  return {
    kind: 'TRANSFER_DELETE_OR_REVERSE',
    intent: 'REVERSE_TREASURY_TRANSFER',
    entities,
  };
}

export function isTransferCorrectionVerbUtterance(text: string): boolean {
  const t = normalizeCorrectionText(text);
  return TRANSFER_DELETE_OR_REVERSE_RE.test(t) && TRANSFER_NOUN_RE.test(t);
}
