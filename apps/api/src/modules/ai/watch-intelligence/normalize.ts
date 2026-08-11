/**
 * Text / reference normalization for watch intelligence.
 * Preserves meaningful reference tokens; does not fuzzy serials.
 */

const ACCENT_MAP: Record<string, string> = {
  á: 'a',
  é: 'e',
  í: 'i',
  ó: 'o',
  ú: 'u',
  ü: 'u',
  ñ: 'n',
  à: 'a',
  è: 'e',
  ì: 'i',
  ò: 'o',
  ù: 'u',
};

export function stripAccents(s: string): string {
  return s.replace(/[áéíóúüñàèìòù]/gi, (ch) => ACCENT_MAP[ch.toLowerCase()] ?? ch);
}

/** Lowercase, collapse whitespace, strip most punctuation (keep alnum). */
export function normalizeWatchText(raw: string): string {
  return stripAccents(String(raw ?? ''))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+/.-]/gu, ' ')
    .replace(/[/\-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeWatchQuery(normalized: string): string[] {
  return normalized.split(' ').filter((t) => t.length > 0);
}

/**
 * Canonicalize reference for comparison: strip spaces/hyphens, upper case.
 * "126710 BLNR" | "126710-BLNR" | "126710BLNR" → "126710BLNR"
 */
export function normalizeReference(raw: string): string {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[\s\-_./]/g, '')
    .trim();
}

/** Detect likely reference tokens (alphanumeric with digits, length ≥ 5). */
export function extractReferenceHints(raw: string): string[] {
  const hints = new Set<string>();
  // Token-level only — never treat the whole utterance as one reference
  // (e.g. "Pepsi 126710BLNR" must not become "PEPSI126710BLNR").
  const parts = String(raw ?? '')
    .toUpperCase()
    .split(/[\s,;|]+/)
    .map((p) => normalizeReference(p))
    .filter((p) => p.length >= 5 && /\d/.test(p) && /^[A-Z0-9]+$/.test(p));
  for (const p of parts) {
    // Require letter+digit mix typical of full refs — reject bare numeric prefixes ("126710")
    // that would false-match every 126710* inventory row.
    if (/\d/.test(p) && /[A-Z]/.test(p) && p.length >= 6) {
      hints.add(p);
    }
  }
  // Also accept spaced refs joined: "126710 BLNR" → look at consecutive digit+alpha tokens
  const rawParts = String(raw ?? '')
    .toUpperCase()
    .split(/[\s,;|]+/)
    .filter(Boolean);
  for (let i = 0; i < rawParts.length - 1; i++) {
    const a = normalizeReference(rawParts[i]!);
    const b = normalizeReference(rawParts[i + 1]!);
    if (/^\d{4,8}$/.test(a) && /^[A-Z]{2,6}$/.test(b)) {
      hints.add(`${a}${b}`);
    }
  }
  return [...hints];
}

export function referencesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeReference(a) === normalizeReference(b);
}

/** Conservative edit-distance for brand typos (max 2 for words ≥ 5). */
export function withinTypoDistance(a: string, b: string, maxDist = 2): boolean {
  const x = normalizeWatchText(a);
  const y = normalizeWatchText(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.abs(x.length - y.length) > maxDist) return false;
  if (Math.min(x.length, y.length) < 5) return x === y;
  return levenshtein(x, y) <= maxDist;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}
