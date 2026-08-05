export type CryptoPriceStatus = 'FRESH' | 'STALE' | 'VERY_STALE' | 'MISSING';

const HOUR_MS = 60 * 60 * 1000;
export const CRYPTO_FRESH_MAX_MS = 24 * HOUR_MS;
export const CRYPTO_STALE_MAX_MS = 72 * HOUR_MS;

/**
 * Explicit staleness for crypto mark-to-market prices.
 * FRESH ≤24h, STALE ≤72h, VERY_STALE >72h, MISSING when no price.
 */
export function resolveCryptoPriceStatus(
  capturedAt: Date | null | undefined,
  now: Date = new Date(),
): CryptoPriceStatus {
  if (!capturedAt) return 'MISSING';
  const ageMs = now.getTime() - capturedAt.getTime();
  if (ageMs <= CRYPTO_FRESH_MAX_MS) return 'FRESH';
  if (ageMs <= CRYPTO_STALE_MAX_MS) return 'STALE';
  return 'VERY_STALE';
}

/** Worst status across a set (MISSING is worst for portfolio warnings; FRESH best). */
export function worstCryptoPriceStatus(
  statuses: CryptoPriceStatus[],
): CryptoPriceStatus {
  if (statuses.length === 0) return 'MISSING';
  const rank: Record<CryptoPriceStatus, number> = {
    FRESH: 0,
    STALE: 1,
    VERY_STALE: 2,
    MISSING: 3,
  };
  return statuses.reduce((worst, s) => (rank[s] > rank[worst] ? s : worst));
}
