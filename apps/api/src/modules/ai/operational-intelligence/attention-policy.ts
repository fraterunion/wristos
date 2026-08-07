/**
 * Conservative attention thresholds for GET_ATTENTION_ITEMS.
 *
 * Defaults chosen for Wrist Caviar–scale inventory (~70 active watches,
 * deal volume in the mid-hundreds, CXC often sparse). Prefer INFO/WATCH
 * over IMPORTANT unless concentration or absolute size is clearly material.
 *
 * Not user-configurable in V1.
 */

export const ATTENTION_POLICY = Object.freeze({
  /** Days in inventory before an item is considered aged (uses Watch.createdAt). */
  AGED_INVENTORY_DAYS: 120,
  /** MXN cost floor for high-value aged inventory callouts. */
  HIGH_VALUE_INVENTORY_MXN: 200_000,
  /** MXN outstanding floor for large receivable callouts (per client, per currency). */
  LARGE_RECEIVABLE_MXN: 100_000,
  /** Share of active inventory capital for single-item concentration. */
  CONCENTRATION_PERCENT: 15,
  /** Gross margin % below which a recent sale is flagged (revenue − COGS only). */
  LOW_MARGIN_PERCENT: 8,
  /** Lookback window for low-margin recent sales. */
  LOW_MARGIN_LOOKBACK_DAYS: 45,
  /** Crypto price age (hours) treated as stale for attention. */
  CRYPTO_STALE_HOURS: 72,
  /** Max attention items returned (stable severity then type order). */
  MAX_ITEMS: 8,
} as const);

export type AttentionSeverity = 'INFO' | 'WATCH' | 'IMPORTANT';

export type AttentionRuleId =
  | 'AGED_HIGH_VALUE_INVENTORY'
  | 'LARGE_RECEIVABLE'
  | 'INVENTORY_CONCENTRATION'
  | 'STALE_CRYPTO_VALUATION'
  | 'LOW_MARGIN_RECENT_SALE'
  | 'RECEIVABLE_CONCENTRATION';
