/**
 * 26D — Closed allowlist for deterministic last-action deixis → reverse capability.
 *
 * REGISTER_EXPENSE → REVERSE_EXPENSE
 * REGISTER_TREASURY_TRANSFER → REVERSE_TREASURY_TRANSFER
 *
 * No generic “reverse last write”. Unsupported last writes → null.
 */

import type { ReversalCapability } from './financial-reversal.types';
import type { LastReversibleActionContext } from './financial-reversal.types';

/** Create capability → reverse capability (closed). */
export const LAST_ACTION_REVERSE_ALLOWLIST = {
  REGISTER_EXPENSE: 'REVERSE_EXPENSE',
  REGISTER_TREASURY_TRANSFER: 'REVERSE_TREASURY_TRANSFER',
} as const;

export type LastActionCreateCapability = keyof typeof LAST_ACTION_REVERSE_ALLOWLIST;

/**
 * Map a stored lastReversibleAction.capability (already the REVERSE_* form)
 * to the executable reverse intent. Returns null when unsupported.
 */
export function reverseIntentFromLastReversibleAction(
  last: LastReversibleActionContext | null | undefined,
): ReversalCapability | null {
  if (!last) return null;
  if (last.capability === 'REVERSE_EXPENSE') return 'REVERSE_EXPENSE';
  if (last.capability === 'REVERSE_TREASURY_TRANSFER') return 'REVERSE_TREASURY_TRANSFER';
  return null;
}
