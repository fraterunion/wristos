/**
 * Negation guard — blocks a specific verb match from HIGH_CONFIDENCE_OPERATION
 * routing when a negation marker precedes it in the same message.
 *
 * "No vendí el Batman." / "Todavía no le pagué." / "No me ha pagado."
 * must never become a REGISTER_* write.
 *
 * Scope note: this checks negation-marker-precedes-verb-index on the WHOLE
 * normalized message, not per-clause. Multi-clause messages that both negate
 * and assert in the same sentence ("no vendí el Batman, vendí el Robin") are
 * a documented follow-up — see docs/ai/OPERATIONAL_INTENT_ROUTER.md — the
 * conservative behavior here is to block the whole message when ANY negation
 * marker precedes the matched verb, which is always safe (worst case: falls
 * through to the provider, never a false write).
 */

const NEGATION_MARKERS_RE = /\b(no|todavia no|aun no|nunca|jamas|ni)\b/g;

/**
 * `verbIndex` is the character index (into the same normalized text) where
 * the matched verb phrase begins. Returns true if a negation marker appears
 * anywhere before that index.
 */
export function isNegatedBeforeIndex(normalizedText: string, verbIndex: number): boolean {
  NEGATION_MARKERS_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NEGATION_MARKERS_RE.exec(normalizedText)) !== null) {
    if (match.index < verbIndex) return true;
  }
  return false;
}
