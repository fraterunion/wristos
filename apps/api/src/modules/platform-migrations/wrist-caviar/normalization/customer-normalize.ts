/**
 * Deterministic customer name normalization for comparison / exact grouping.
 * Does not merge spelling variants automatically.
 */
export function normalizeCustomerName(raw: string): string {
  return raw
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:]+$/g, '')
    .toLocaleLowerCase('es-MX');
}

export function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '');
}

export type DuplicateConfidence =
  | 'EXACT_NORMALIZED_MATCH'
  | 'ACCENT_VARIANT'
  | 'POSSIBLE_ABBREVIATION'
  | 'POSSIBLE_TYPO';

export function classifyNameSimilarity(aNorm: string, bNorm: string): DuplicateConfidence | null {
  if (aNorm === bNorm) return 'EXACT_NORMALIZED_MATCH';
  const a = stripAccents(aNorm);
  const b = stripAccents(bNorm);
  if (a === b) return 'ACCENT_VARIANT';
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) {
    return 'POSSIBLE_ABBREVIATION';
  }
  if (a.length >= 4 && b.length >= 4 && levenshtein(a, b) <= 2) {
    return 'POSSIBLE_TYPO';
  }
  return null;
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
