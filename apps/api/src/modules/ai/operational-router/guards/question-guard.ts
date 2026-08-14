/**
 * Question guard — blocks the ENTIRE message from HIGH_CONFIDENCE_OPERATION
 * routing when it reads as a question rather than a completed-event
 * statement. Questions fall through to the provider/READ pipeline exactly
 * as they do today; this guard only prevents the router from misreading
 * "¿Vendimos el Bruce Wayne?" as a fresh REGISTER_SALE.
 *
 * Takes the `folded` half of a NormalizedMessage (text-normalize.ts) — ¿/?
 * survive folding untouched.
 */

/**
 * Catches unpunctuated questions ("cuanto pague por el pepsi"). Deliberately
 * excludes "ya me"/"ya le"/"ya nos" — without punctuation, "Ya le pagué"
 * (declarative: I already paid him) and "¿Ya le pagaste?" (question) are the
 * same opening words; Spanish gives no other deterministic signal, and
 * blocking a genuine completed-payment statement is worse than occasionally
 * letting an unpunctuated question reach the router (which then simply
 * won't match any lexicon's confidence bar and falls through regardless).
 */
const INTERROGATIVE_OPENERS_RE =
  /^¿?\s*(cuanto|cuanta|cuantos|cuantas|cual|cuales|quien|quienes|donde|como|cuando)\b/;

export function isQuestion(folded: string): boolean {
  const trimmed = folded.trim();
  if (trimmed.startsWith('¿') || trimmed.endsWith('?')) return true;
  return INTERROGATIVE_OPENERS_RE.test(trimmed);
}
