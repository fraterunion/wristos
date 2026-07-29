import type { RuleDispositionPatch } from './types';

/**
 * WC_PARTNER_ENTRY_AS_CONTRIBUTION / WC_PARTNER_EXIT_AS_WITHDRAWAL
 *
 * CUENTA CESAR rows are cash movements. Parser leaves classification UNCLASSIFIED.
 * Wrist Caviar rule: entry-only → CONTRIBUTION, exit-only → WITHDRAWAL.
 * Both/neither amounts remain CONFLICT for human review.
 */
export function classifyPartnerMovement(input: {
  entryAmount: number | null | undefined;
  exitAmount: number | null | undefined;
  classification: string;
}): { classification: 'CONTRIBUTION' | 'WITHDRAWAL' | 'UNCLASSIFIED'; patch: RuleDispositionPatch | null } {
  if (input.classification === 'CONTRIBUTION' || input.classification === 'WITHDRAWAL') {
    return {
      classification: input.classification,
      patch: null,
    };
  }
  const hasEntry = input.entryAmount != null && Number(input.entryAmount) !== 0;
  const hasExit = input.exitAmount != null && Number(input.exitAmount) !== 0;

  if (hasEntry && !hasExit) {
    return {
      classification: 'CONTRIBUTION',
      patch: {
        disposition: 'CREATE',
        dispositionReason: 'partner_entry_as_contribution',
        payloadPatch: { classification: 'CONTRIBUTION' },
        audit: {
          ruleId: 'WC_PARTNER_ENTRY_AS_CONTRIBUTION',
          description: 'CUENTA CESAR entry-only row classified as CONTRIBUTION',
          changesData: true,
          appliedAt: new Date().toISOString(),
        },
      },
    };
  }
  if (hasExit && !hasEntry) {
    return {
      classification: 'WITHDRAWAL',
      patch: {
        disposition: 'CREATE',
        dispositionReason: 'partner_exit_as_withdrawal',
        payloadPatch: { classification: 'WITHDRAWAL' },
        audit: {
          ruleId: 'WC_PARTNER_EXIT_AS_WITHDRAWAL',
          description: 'CUENTA CESAR exit-only row classified as WITHDRAWAL',
          changesData: true,
          appliedAt: new Date().toISOString(),
        },
      },
    };
  }
  return { classification: 'UNCLASSIFIED', patch: null };
}
