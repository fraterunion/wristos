/**
 * Shared reversal error taxonomy (26A).
 * Preserve domain-specific codes when they carry semantics
 * (e.g. STALE_TREASURY_TRANSFER_INVARIANT).
 */

export const REVERSAL_ERROR_CODES = [
  'REVERSAL_TARGET_NOT_FOUND',
  'REVERSAL_TARGET_AMBIGUOUS',
  'REVERSAL_TARGET_STALE',
  'REVERSAL_ALREADY_APPLIED',
  'REVERSAL_ALREADY_REVERSED_EXTERNALLY',
  'REVERSAL_INVARIANT',
  'REVERSAL_BLOCKED',
] as const;

export type ReversalErrorCode = (typeof REVERSAL_ERROR_CODES)[number];

export function mapDomainReverseCausalityToError(
  causality: 'SAME_COMMAND' | 'EXTERNAL' | 'APPLIED',
): ReversalErrorCode | null {
  if (causality === 'SAME_COMMAND') return 'REVERSAL_ALREADY_APPLIED';
  if (causality === 'EXTERNAL') return 'REVERSAL_ALREADY_REVERSED_EXTERNALLY';
  return null;
}
