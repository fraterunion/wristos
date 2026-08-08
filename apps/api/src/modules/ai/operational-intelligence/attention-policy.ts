/**
 * Conservative attention thresholds for GET_ATTENTION_ITEMS.
 *
 * These are initial operational thresholds chosen from current Wrist Caviar
 * operating patterns / data distribution (roughly ~70 active watches,
 * deal volume in the mid-hundreds, CXC often sparse).
 *
 * They are NOT universal financial truths.
 * They are NOT user-configurable in V1.
 *
 * Prefer INFO/WATCH over IMPORTANT unless concentration or absolute size
 * is clearly material.
 */

export const ATTENTION_POLICY = Object.freeze({
  /**
   * AGED_INVENTORY_DAYS = 120
   * Days of inventory age (Watch.acquiredAt, fallback createdAt) before an
   * item is considered aged.
   */
  AGED_INVENTORY_DAYS: 120,
  /**
   * HIGH_VALUE_INVENTORY_MXN = 200000
   * MXN cost floor for high-value aged inventory callouts.
   */
  HIGH_VALUE_INVENTORY_MXN: 200_000,
  /**
   * LARGE_RECEIVABLE_MXN = 100000
   * MXN outstanding floor for large receivable callouts (per client, MXN only).
   */
  LARGE_RECEIVABLE_MXN: 100_000,
  /**
   * CONCENTRATION_PERCENT = 15
   * Share of active inventory capital (or CXC) for concentration callouts.
   */
  CONCENTRATION_PERCENT: 15,
  /**
   * LOW_MARGIN_PERCENT = 8
   * Gross margin % below which a recent CLOSED_WON sale is flagged
   * (revenue − COGS only; not net profit).
   */
  LOW_MARGIN_PERCENT: 8,
  /** Lookback window for low-margin recent sales. */
  LOW_MARGIN_LOOKBACK_DAYS: 45,
  /**
   * CRYPTO_STALE_HOURS = 72
   * Crypto price age (hours) treated as stale for attention.
   */
  CRYPTO_STALE_HOURS: 72,
  /** Max attention items returned (stable severity then type order). */
  MAX_ITEMS: 8,
} as const);

export type AttentionSeverity = 'INFO' | 'WATCH' | 'IMPORTANT';

/** Closed set for future filtering — not free-form. */
export type AttentionCategory =
  | 'INVENTORY'
  | 'RECEIVABLES'
  | 'LIQUIDITY'
  | 'SALES'
  | 'CAPITAL'
  | 'CRYPTO';

export const ATTENTION_CATEGORIES = [
  'INVENTORY',
  'RECEIVABLES',
  'LIQUIDITY',
  'SALES',
  'CAPITAL',
  'CRYPTO',
] as const satisfies readonly AttentionCategory[];

export type AttentionRuleId =
  | 'AGED_HIGH_VALUE_INVENTORY'
  | 'LARGE_RECEIVABLE'
  | 'INVENTORY_CONCENTRATION'
  | 'STALE_CRYPTO_VALUATION'
  | 'LOW_MARGIN_RECENT_SALE'
  | 'RECEIVABLE_CONCENTRATION';

export const ATTENTION_RULE_CATEGORY: Readonly<Record<AttentionRuleId, AttentionCategory>> =
  Object.freeze({
    AGED_HIGH_VALUE_INVENTORY: 'INVENTORY',
    INVENTORY_CONCENTRATION: 'CAPITAL',
    LARGE_RECEIVABLE: 'RECEIVABLES',
    RECEIVABLE_CONCENTRATION: 'RECEIVABLES',
    STALE_CRYPTO_VALUATION: 'CRYPTO',
    LOW_MARGIN_RECENT_SALE: 'SALES',
  });
