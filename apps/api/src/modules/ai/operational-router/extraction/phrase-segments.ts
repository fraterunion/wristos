/**
 * Isolates raw free-text spans (watch/customer/seller mentions) from a
 * message, for capabilities whose entitySchemas accept a `*Query` field
 * (watchQuery/customerQuery/sellerQuery/…). This NEVER resolves a span to an
 * id — it only isolates the substring exactly like a human (or the LLM)
 * would type it, preserving original casing/accents, so the existing
 * downstream resolvers (WatchInventoryResolver, SaleCustomerEntityResolver,
 * etc.) can do the actual resolution unchanged.
 *
 * Relies on the index alignment between `raw` and `folded` guaranteed by
 * text-normalize.ts's normalizeMessage().
 */

export interface SpanCapture {
  text: string;
  index: number;
  /** Where the capture stopped (the stop-marker position, or end of string) — use this, not `index + text.length`, to resume scanning past this span (trimming means the two can differ). */
  endIndex: number;
}

/** Common Spanish clause/argument boundary words — a query span stops at the first one it hits. */
export const DEFAULT_STOP_MARKERS_RE = /\b(en|por|de|desde|a|al|para|y|con|mediante)\b|[,.;]/;

/**
 * Same as DEFAULT_STOP_MARKERS_RE but also stops at the first digit — for
 * customer/seller/counterparty names, which never contain digits, unlike
 * watch reference numbers ("116610LN"). Without this, "a José 80 mil" would
 * capture "José 80 mil" instead of just "José" (no marker word sits between
 * a name and a directly-following amount).
 */
export const PERSON_STOP_MARKERS_RE = /\b(en|por|de|desde|a|al|para|y|con|mediante)\b|[,.;]|\d/;

/**
 * Same as DEFAULT_STOP_MARKERS_RE but also stops at a digit that starts a
 * NEW token (whitespace immediately followed by a digit) — for watch
 * queries, which may legitimately contain digits as part of a reference
 * ("116610LN") but should still stop before an unrelated amount that
 * directly follows with no marker word ("bruce 500" -> "bruce", not
 * "bruce 500"). A digit at the very start of the span (a bare reference
 * number as the query itself) is NOT a stop condition.
 */
export const WATCH_STOP_MARKERS_RE = /\b(en|por|de|desde|a|al|para|y|con|mediante)\b|[,.;]|\s\d/;

/**
 * Captures raw text from `startIndex` up to the first stop-marker match (or
 * end of string), trimmed. Returns null if the resulting span is empty.
 */
export function captureUntilMarker(
  raw: string,
  folded: string,
  startIndex: number,
  stopMarkersRe: RegExp = DEFAULT_STOP_MARKERS_RE,
): SpanCapture | null {
  if (startIndex >= folded.length) return null;
  const searchArea = folded.slice(startIndex);
  const stopMatch = stopMarkersRe.exec(searchArea);
  const endOffset = stopMatch ? stopMatch.index : searchArea.length;
  const spanRaw = raw.slice(startIndex, startIndex + endOffset).trim();
  return spanRaw ? { text: spanRaw, index: startIndex, endIndex: startIndex + endOffset } : null;
}

/**
 * Finds the first occurrence of `markerRe` at or after `searchFromIndex`,
 * then captures raw text right after it up to the next stop marker. Returns
 * null if the marker itself isn't found or the captured span is empty.
 */
const LEADING_ARTICLE_RE = /^(un|una|unos|unas|el|la|los|las)\s+/i;

/** Strips a leading Spanish article a captured span may have picked up: "un Bruce Wayne" -> "Bruce Wayne". */
export function stripLeadingArticle(text: string): string {
  return text.replace(LEADING_ARTICLE_RE, '').trim();
}

/**
 * The correct starting point for a subsequent scan (e.g. account-alias
 * detection) that must not re-read a name span already captured earlier in
 * the same message. Without this, "Me pagó César por Bancos." would let an
 * account-alias scan starting right after the verb re-read "César" itself —
 * and since "César" is also a valid account alias (Cuenta César), silently
 * misread the counterparty's name as a treasury account.
 */
export function afterSpan(floorIndex: number, span: SpanCapture | null | undefined): number {
  return span ? Math.max(floorIndex, span.endIndex) : floorIndex;
}

export function captureAfterMarker(
  raw: string,
  folded: string,
  markerRe: RegExp,
  searchFromIndex = 0,
  stopMarkersRe: RegExp = DEFAULT_STOP_MARKERS_RE,
): SpanCapture | null {
  const searchArea = folded.slice(searchFromIndex);
  const markerMatch = markerRe.exec(searchArea);
  if (!markerMatch) return null;
  const afterMarkerIndex = searchFromIndex + markerMatch.index + markerMatch[0].length;
  return captureUntilMarker(raw, folded, afterMarkerIndex, stopMarkersRe);
}
