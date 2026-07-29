import type { RuleDispositionPatch } from './types';

/**
 * Empty / template CXP blocks: null principal and no payment lines.
 * WC_EXCLUDE_EMPTY_CXP_CARD
 */
export function classifyPayableCard(input: {
  principal: number | null | undefined;
  payments: unknown[];
}): RuleDispositionPatch | null {
  const payCount = input.payments?.length ?? 0;
  if ((input.principal == null || Number.isNaN(Number(input.principal))) && payCount === 0) {
    return {
      disposition: 'EXCLUDED',
      dispositionReason: 'empty_cxp_card_excluded',
      audit: {
        ruleId: 'WC_EXCLUDE_EMPTY_CXP_CARD',
        description: 'CXP block with null principal and no payments excluded as empty/template',
        changesData: false,
        appliedAt: new Date().toISOString(),
      },
    };
  }
  return null;
}

/** Free-form creditor labels are supported by AccountEntry (classification-only). */
export function freeFormCreditorSupported(
  creditorName: string | null | undefined,
): RuleDispositionPatch | null {
  if (!creditorName || creditorName === '(sin acreedor)') return null;
  return {
    disposition: 'CREATE',
    dispositionReason: 'free_form_creditor_supported',
    audit: {
      ruleId: 'WC_FREE_FORM_CREDITOR_SUPPORTED',
      description: 'Non-empty free-form creditor accepted for AccountEntry',
      changesData: false,
      appliedAt: new Date().toISOString(),
    },
  };
}
