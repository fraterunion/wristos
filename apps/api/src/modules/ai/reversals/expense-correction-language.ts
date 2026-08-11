/**
 * 26C.1 — Deterministic expense correction language (server-side).
 *
 * Provider is assistive, not required for high-confidence deictic undo
 * and delete→reverse phrases. Designed so REVERSE_TREASURY_TRANSFER can
 * reuse the deictic layer later without binding it now.
 *
 * Never maps non-expense destructive language to REVERSE_EXPENSE.
 */

export type ExpenseCorrectionDetection =
  | {
      kind: 'LAST_ACTION_DEIXIS';
      intent: 'REVERSE_EXPENSE';
      entities: { useLastAction: true };
    }
  | {
      kind: 'EXPENSE_DELETE_OR_REVERSE';
      intent: 'REVERSE_EXPENSE';
      entities: Record<string, string | number | boolean>;
    }
  | {
      kind: 'BLOCKED_NON_EXPENSE_REVERSAL';
      intent: 'UNKNOWN';
      entities: Record<string, never>;
      reason: string;
    };

function normalizeCorrectionText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.?!¿¡]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Verbs that must not be stolen by pure deictic "eso" selection. */
export const EXPENSE_CORRECTION_VERB_RE =
  /\b(deshaz|deshacer|revierte|revertir|revi[eé]rtelo|deshazlo|borra|borrar|elimina|eliminar|anula|anular|quita|quitar)\b/i;

/**
 * Conservative last-action deixis — only when the utterance clearly means
 * "undo the previously referenced reversible operation", not a vague request.
 */
const LAST_ACTION_DEIXIS_RE =
  /^(deshaz eso|revierte eso|deshazlo|deshaz lo|revi[eé]rtelo|revierte lo|me equivoqu[eé](?:,)?(?:\s+(?:deshaz|revierte|deshazlo|revi[eé]rtelo|deshaz eso|revierte eso))?(?:\s+eso|\s+lo)?|me equivoqu[eé],?\s+deshaz(?:lo| eso)|me equivoqu[eé],?\s+revi[eé]rte(?:lo| eso)|deshaz lo que acabo de (hacer|registrar)|revierte lo que acabo de (hacer|registrar)|borra eso|elimina eso)$/;

const NON_EXPENSE_REVERSAL_RE =
  /(?:deshaz|revierte|revertir|borra|eliminar?|cancela(?:r)?|anul(?:a|ar)|me equivoqu[eé]).*(transferencia|transfer|venta|compra|aportaci[oó]n|distribuci[oó]n|cliente|reloj|pago\b)/;

const EXPENSE_DELETE_OR_REVERSE_RE =
  /(?:revierte|revertir|deshaz|deshacer|borra|borrar|elimina|eliminar|anula|anular|cancela el gasto|quita|quitar|me equivoqu[eé].*gasto)/;

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '').replace(/,/g, '');
  const mil = /([\d.]+)\s*(mil|k)\b/i.exec(raw);
  if (mil) {
    const n = Number(mil[1]);
    return Number.isFinite(n) ? n * 1000 : null;
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Detect high-confidence expense correction language.
 * Returns null when the utterance should fall through to the provider.
 */
export function detectExpenseCorrectionLanguage(
  text: string,
): ExpenseCorrectionDetection | null {
  const t = normalizeCorrectionText(text);
  if (!t) return null;

  // Transfer / sale / purchase / client / watch cancel — never REVERSE_EXPENSE.
  if (NON_EXPENSE_REVERSAL_RE.test(t) && !/\bgasto\b/.test(t)) {
    return {
      kind: 'BLOCKED_NON_EXPENSE_REVERSAL',
      intent: 'UNKNOWN',
      entities: {},
      reason: 'non_expense_reversal_language',
    };
  }

  if (LAST_ACTION_DEIXIS_RE.test(t)) {
    return {
      kind: 'LAST_ACTION_DEIXIS',
      intent: 'REVERSE_EXPENSE',
      entities: { useLastAction: true },
    };
  }

  const looksExpenseReverse =
    EXPENSE_DELETE_OR_REVERSE_RE.test(t) &&
    (/\bgasto\b/.test(t) ||
      /gasolina|estacionamiento|comida|vi[aá]ticos|comisi[oó]n/.test(t));

  const deleteGasto =
    /(?:borra|elimina|quita|revierte|deshaz).*(?:gasto|gasolina)/.test(t) ||
    /(?:gasto|gasolina).*(?:borra|elimina|quita|revierte|deshaz)/.test(t) ||
    /borra ese gasto|elimina el gasto|elimina ese gasto|deshaz el gasto|revierte el gasto/.test(
      t,
    );

  if (!looksExpenseReverse && !deleteGasto) {
    return null;
  }

  if (
    !(
      /(?:revierte|deshaz|borra|elimina|anula|quita).*(?:gasto|gasolina)/.test(t) ||
      /(?:gasto|gasolina).*(?:revierte|deshaz|borra|elimina|quita)/.test(t) ||
      /me equivoqu[eé].*(?:gasto|con (?:ese |el )?gasto)/.test(t)
    )
  ) {
    return null;
  }

  const entities: Record<string, string | number | boolean> = {};
  const amountMatch = t.match(/(?:de\s+)?([\d.,]+(?:\s*(?:mil|k))?)\s*(?:pesos|mxn)?/);
  if (amountMatch?.[1]) {
    const amount = parseAmount(amountMatch[1]);
    if (amount != null) entities.amount = amount;
  }
  if (/gasolina|combustible/.test(t)) {
    entities.category = 'GASOLINE';
    entities.concept = 'gasolina';
  } else if (/estacionamiento|parking/.test(t)) {
    entities.category = 'PARKING';
    entities.concept = 'estacionamiento';
  } else if (/comida|almuerzo|cena/.test(t)) {
    entities.category = 'MEALS';
    entities.concept = 'comida';
  }
  if (/\bhoy\b/.test(t)) entities.dateLabel = 'hoy';
  else if (/\bayer\b/.test(t)) entities.dateLabel = 'ayer';
  if (/banco|bancos/.test(t)) entities.source = 'BANK';
  if (/efectivo|caja/.test(t)) entities.source = 'CASH';
  if (/acabo de registrar|que acabo de/.test(t)) {
    entities.useLastAction = true;
  }

  return {
    kind: 'EXPENSE_DELETE_OR_REVERSE',
    intent: 'REVERSE_EXPENSE',
    entities,
  };
}

export function isExpenseCorrectionVerbUtterance(text: string): boolean {
  return EXPENSE_CORRECTION_VERB_RE.test(normalizeCorrectionText(text));
}
