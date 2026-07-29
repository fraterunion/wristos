import type { RuleDispositionPatch } from './types';

/**
 * Concepts that must not be classified by entry/exit sign alone.
 * Explicit directional rules apply only when evidence is clear; otherwise CONFLICT.
 */
export const PARTNER_SUSPICIOUS_CONCEPT =
  /prestamo|pr[eé]stamo|loan|reembolso|repayment|utilidad|profit|distribuci[oó]n|correccio[nñ]|correcci[oó]n|transfer|traspaso|\bgastos?\b|compra|venta|anticipo|adelanto|cobro\s+util/i;

export type PartnerConceptKind =
  | 'PURCHASE'
  | 'EXPENSE'
  | 'SALE'
  | 'LOAN_OR_ADVANCE'
  | 'REIMBURSEMENT'
  | 'PROFIT'
  | 'TRANSFER_OR_CORRECTION'
  | 'PLAIN';

export function classifyPartnerConcept(concept: string | null | undefined): PartnerConceptKind {
  const c = (concept || '').normalize('NFKC').trim().toLowerCase();
  if (!c) return 'PLAIN';
  if (/compra/.test(c)) return 'PURCHASE';
  if (/\bgastos?\b/.test(c)) return 'EXPENSE';
  if (/\bventa\b/.test(c)) return 'SALE';
  if (/prestamo|pr[eé]stamo|loan|anticipo|adelanto/.test(c)) return 'LOAN_OR_ADVANCE';
  if (/reembolso|repayment/.test(c)) return 'REIMBURSEMENT';
  if (/utilidad|profit|distribuci|cobro\s+util/.test(c)) return 'PROFIT';
  if (/transfer|traspaso|correccio|correcci/.test(c)) return 'TRANSFER_OR_CORRECTION';
  if (PARTNER_SUSPICIOUS_CONCEPT.test(c)) return 'TRANSFER_OR_CORRECTION';
  return 'PLAIN';
}

/**
 * WC_PARTNER_ENTRY_AS_CONTRIBUTION / WC_PARTNER_EXIT_AS_WITHDRAWAL
 * plus explicit concept rules for compra/gasto/venta.
 * Suspicious loan/profit/transfer concepts remain UNCLASSIFIED → CONFLICT.
 */
export function classifyPartnerMovement(input: {
  entryAmount: number | null | undefined;
  exitAmount: number | null | undefined;
  classification: string;
  concept?: string | null;
}): { classification: 'CONTRIBUTION' | 'WITHDRAWAL' | 'UNCLASSIFIED'; patch: RuleDispositionPatch | null } {
  if (input.classification === 'CONTRIBUTION' || input.classification === 'WITHDRAWAL') {
    return {
      classification: input.classification,
      patch: null,
    };
  }

  const hasEntry = input.entryAmount != null && Number(input.entryAmount) !== 0;
  const hasExit = input.exitAmount != null && Number(input.exitAmount) !== 0;
  const kind = classifyPartnerConcept(input.concept);

  // Explicit deterministic concept rules (not sign-alone for suspicious labels)
  if (kind === 'PURCHASE' && hasExit && !hasEntry) {
    return {
      classification: 'WITHDRAWAL',
      patch: {
        disposition: 'CREATE',
        dispositionReason: 'partner_purchase_exit_as_withdrawal',
        payloadPatch: { classification: 'WITHDRAWAL', conceptKind: kind },
        audit: {
          ruleId: 'WC_PARTNER_EXIT_AS_WITHDRAWAL',
          description: 'CUENTA CESAR compra exit classified as WITHDRAWAL (explicit purchase rule)',
          changesData: true,
          appliedAt: new Date().toISOString(),
        },
      },
    };
  }
  if (kind === 'EXPENSE' && hasExit && !hasEntry) {
    return {
      classification: 'WITHDRAWAL',
      patch: {
        disposition: 'CREATE',
        dispositionReason: 'partner_expense_exit_as_withdrawal',
        payloadPatch: { classification: 'WITHDRAWAL', conceptKind: kind },
        audit: {
          ruleId: 'WC_PARTNER_EXIT_AS_WITHDRAWAL',
          description: 'CUENTA CESAR gasto exit classified as WITHDRAWAL (explicit expense rule)',
          changesData: true,
          appliedAt: new Date().toISOString(),
        },
      },
    };
  }
  if (kind === 'SALE' && hasEntry && !hasExit) {
    return {
      classification: 'CONTRIBUTION',
      patch: {
        disposition: 'CREATE',
        dispositionReason: 'partner_sale_entry_as_contribution',
        payloadPatch: { classification: 'CONTRIBUTION', conceptKind: kind },
        audit: {
          ruleId: 'WC_PARTNER_ENTRY_AS_CONTRIBUTION',
          description: 'CUENTA CESAR venta entry classified as CONTRIBUTION (explicit sale rule)',
          changesData: true,
          appliedAt: new Date().toISOString(),
        },
      },
    };
  }

  // Loan / advance / reimbursement / profit / transfer — do not classify by sign alone
  if (
    kind === 'LOAN_OR_ADVANCE' ||
    kind === 'REIMBURSEMENT' ||
    kind === 'PROFIT' ||
    kind === 'TRANSFER_OR_CORRECTION'
  ) {
    return {
      classification: 'UNCLASSIFIED',
      patch: null,
    };
  }

  // Plain concepts: entry-only / exit-only sign rules
  if (kind === 'PLAIN' && hasEntry && !hasExit) {
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
  if (kind === 'PLAIN' && hasExit && !hasEntry) {
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
