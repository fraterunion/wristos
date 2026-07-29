import type { RuleDispositionPatch } from './types';

/**
 * Empty / template CXC blocks: null principal and no payment lines.
 * WC_EXCLUDE_EMPTY_CXC_CARD
 */
export function classifyReceivableCard(input: {
  principal: number | null | undefined;
  payments: unknown[];
}): RuleDispositionPatch | null {
  const payCount = input.payments?.length ?? 0;
  if ((input.principal == null || Number.isNaN(Number(input.principal))) && payCount === 0) {
    return {
      disposition: 'EXCLUDED',
      dispositionReason: 'empty_cxc_card_excluded',
      audit: {
        ruleId: 'WC_EXCLUDE_EMPTY_CXC_CARD',
        description: 'CXC block with null principal and no payments excluded as empty/template',
        changesData: false,
        appliedAt: new Date().toISOString(),
      },
    };
  }
  return null;
}

