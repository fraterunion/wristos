/**
 * Deterministic dealer-shorthand money parser.
 *
 * There is no existing deterministic utility for this in the codebase —
 * intent-adapter/normalization.ts's normalizeMoney only cleans up the
 * *format* of an amount the provider already expanded to plain digits (see
 * that file's own doc comment); expanding "500k"/"500 mil" into a number is
 * currently entirely delegated to the LLM via prompt instructions. This fills
 * that gap for the router. Downstream, normalizeMoney still runs on whatever
 * numeric value this produces (via buildIntentCandidate -> normalizeEntities)
 * so this only needs to get the MAGNITUDE right, not the final ".00" string
 * format.
 */

const NUMBER_CORE = '\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?|\\d+(?:\\.\\d+)?';

/** Matches one money-shaped token: optional $, digits (with optional thousands commas/decimal), optional k/mil/millón(es) suffix. */
// Alternation order matters: "millon(es)?" must be tried before "mil", since
// "mil" is a literal prefix of "millones" and regex alternation picks the
// first matching branch, not the longest — "millon" first avoids "millones"
// being misread as "mil" + stray "lones".
export const MONEY_TOKEN_RE = new RegExp(`\\$?\\s*(${NUMBER_CORE})\\s*(millon(?:es)?|mil|k)?`, 'i');

/**
 * Parses one already-isolated money-shaped substring (e.g. "500k", "500 mil",
 * "$500,000", "1,500", "1.5 millones") into a plain number. Returns null if
 * the substring isn't money-shaped at all.
 */
export function parseMoneyToken(rawToken: string): number | null {
  const match = MONEY_TOKEN_RE.exec(rawToken.trim());
  if (!match) return null;
  const numberPart = match[1].replace(/,/g, '');
  const suffix = match[2]?.toLowerCase();
  let value = Number(numberPart);
  if (!Number.isFinite(value)) return null;
  if (suffix === 'k' || suffix === 'mil') value *= 1000;
  else if (suffix?.startsWith('millon')) value *= 1_000_000;
  return value;
}

/**
 * Finds the first money-shaped mention anywhere in `folded` text, returning
 * both the parsed amount and its index (for currency-alias/account-alias
 * proximity lookups in the same clause). Returns null if none found.
 */
export function findFirstMoneyMention(folded: string): { amount: number; index: number; length: number } | null {
  const match = MONEY_TOKEN_RE.exec(folded);
  if (!match || match[1] === undefined) return null;
  const amount = parseMoneyToken(match[0]);
  if (amount === null) return null;
  return { amount, index: match.index, length: match[0].length };
}
