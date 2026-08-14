/**
 * Future / hypothetical tense guard.
 *
 * Every lexicon in lexicon/*.ts only matches CONJUGATED completed-event verb
 * forms (vendí, vendo, vendimos, se vendió — never bare infinitives like
 * "vender"/"comprar"), which already excludes most future/hypothetical
 * phrasing ("voy a vender", "quiero comprar el Daytona") without this guard
 * needing to fire at all, since those use the infinitive.
 *
 * The one genuinely ambiguous remainder is present-tense "vendo"/"compro"
 * preceded by a conditional/hypothetical marker ("Si vendo el Pepsi en
 * 300…"). This guard catches exactly that: a hypothetical marker in a short
 * window before the matched verb index.
 */

const HYPOTHETICAL_MARKERS_RE = /\b(si|cuando|en caso de que|supongamos que)\b/g;

const FUTURE_INTENT_PREFIX_RE =
  /\b(voy a|vamos a|va a|quiero|quisiera|planeo|pienso|me gustaria|estoy pensando en)\b/;

/**
 * Returns true if a hypothetical marker appears within `windowChars`
 * characters before the matched verb index, or if the message opens with a
 * future-intent phrase ("voy a", "quiero", …) anywhere before the verb.
 */
export function isHypotheticalBeforeIndex(
  normalizedText: string,
  verbIndex: number,
  windowChars = 20,
): boolean {
  const prefix = normalizedText.slice(0, verbIndex);
  if (FUTURE_INTENT_PREFIX_RE.test(prefix)) return true;

  HYPOTHETICAL_MARKERS_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HYPOTHETICAL_MARKERS_RE.exec(normalizedText)) !== null) {
    if (match.index < verbIndex && verbIndex - (match.index + match[0].length) <= windowChars) {
      return true;
    }
  }
  return false;
}
