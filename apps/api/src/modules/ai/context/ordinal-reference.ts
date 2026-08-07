import { IntentReference } from './reference-schema';
import { ContextEntityType } from './entity-types';

const ORDINAL_PATTERNS: Array<{ pattern: RegExp; ordinal: number | 'LAST' }> = [
  { pattern: /\b(el|la)?\s*primer[oa]?\b/i, ordinal: 1 },
  { pattern: /\b(el|la)?\s*segundo\b|\bsegunda\b/i, ordinal: 2 },
  { pattern: /\b(el|la)?\s*tercer[oa]?\b/i, ordinal: 3 },
  { pattern: /\b(el|la)?\s*[uú]ltim[oa]\b/i, ordinal: 'LAST' },
];

const DEICTIC_PATTERNS: Array<{ pattern: RegExp; entityType?: ContextEntityType }> = [
  { pattern: /\b(ese|esa|eso)\s+cliente\b/i, entityType: 'CLIENT' },
  { pattern: /\b(ese|esa|eso)\s+reloj\b/i, entityType: 'WATCH' },
  { pattern: /\b(esa|ese)\s+cuenta\b/i, entityType: 'ACCOUNT_ENTRY' },
  { pattern: /\b(el|la)\s+mismo\b|\b(la)\s+misma\b/i },
  { pattern: /\b(a\s+)?(él|ella)\b/i },
  { pattern: /\b(ese|esa|eso)\b/i },
];

/**
 * Deterministic Spanish ordinal / deictic detection from operator text.
 * Does not invent meaning beyond the closed pattern list.
 */
export function detectDeterministicReference(text: string): IntentReference | null {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;

  for (const entry of ORDINAL_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      // Pure ordinal phrases (and short variants) — "El primero.", "la segunda"
      const mostlyReference = normalized.length <= 40 || /^(el|la)?\s*(primer|segund|tercer|[uú]ltim)/i.test(normalized);
      if (!mostlyReference && !/^(el|la)\s+(primer|segund|tercer|[uú]ltim)/i.test(normalized)) continue;
      if (entry.ordinal === 'LAST') {
        return { kind: 'ORDINAL', position: 'LAST' };
      }
      return { kind: 'ORDINAL', ordinal: entry.ordinal };
    }
  }

  for (const entry of DEICTIC_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      // Prefer LAST_SELECTED; resolver falls back to SINGLE_PRESENTED when needed.
      return {
        kind: 'LAST_SELECTED',
        ...(entry.entityType ? { entityType: entry.entityType } : {}),
      };
    }
  }

  if (/\b(el\s+mismo\s+cliente|misma\s+cliente|mismo\s+cliente)\b/i.test(normalized)) {
    return { kind: 'SAME_ENTITY', entityType: 'CLIENT' };
  }
  if (/\b(ahora\s+)?sus\s+cuentas\b|\bcuentas\s+del\s+cliente\b|\bmuéstrame\s+sus\s+cuentas\b/i.test(normalized)) {
    return { kind: 'LAST_SELECTED', entityType: 'CLIENT' };
  }

  return null;
}

/** True when the utterance is only a referential phrase (no new business request). */
export function isPureReferentialUtterance(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!detectDeterministicReference(normalized)) return false;
  if (looksLikeAccountsContinuation(normalized)) return false;
  if (/\b(busca|busc[ae]|vend[ií]|compr[eé]|pag[oó]|muéstr|muestr|registr|agrega|actualiz)\w*\b/i.test(normalized)) {
    return false;
  }
  return normalized.length <= 48;
}

export function looksLikeAccountsContinuation(text: string): boolean {
  return /\b(ahora\s+)?sus\s+cuentas\b|\bcuentas\s+del\s+cliente\b|\bmuéstrame\s+sus\s+cuentas\b|\bsus\s+cuentas\b/i.test(text);
}
