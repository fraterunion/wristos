/**
 * Shared text normalization for the Operational Intent Router.
 *
 * Produces two SAME-LENGTH, index-aligned strings from one input:
 *   - raw:    trimmed/whitespace-collapsed ORIGINAL text (casing/accents/
 *             punctuation preserved) — used to slice out display spans
 *             (watchQuery/customerQuery/etc.) with natural casing, exactly
 *             like a human (or the LLM) would type them.
 *   - folded: same text, lowercased + accent-folded — used for ALL regex
 *             matching (verb lexicons, markers, guards). Folding accents
 *             ("vendí" -> "vendi", "César" -> "cesar") means every lexicon
 *             pattern only needs to handle the unaccented form once, instead
 *             of accent-class regex noise throughout.
 *
 * Because per-character diacritic folding and ASCII lowercasing never change
 * string length, `raw[i]` and `folded[i]` always refer to the same character
 * position — a regex match index found in `folded` can be used directly to
 * slice `raw`.
 *
 * This is a router-only convention — it does not change any existing
 * correction-language detector (reversals/*-correction-language.ts).
 */

const COMBINING_DIACRITICS_RE = new RegExp('[̀-ͯ]', 'g');

/** Strips combining diacritical marks: "José" -> "jose", "César" -> "cesar". */
export function foldDiacritics(text: string): string {
  return text.normalize('NFD').replace(COMBINING_DIACRITICS_RE, '');
}

export interface NormalizedMessage {
  raw: string;
  folded: string;
}

export function normalizeMessage(text: string): NormalizedMessage {
  const raw = text.trim().replace(/\s+/g, ' ');
  const folded = foldDiacritics(raw).toLowerCase();
  return { raw, folded };
}
