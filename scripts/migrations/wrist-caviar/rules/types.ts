import type { Disposition } from '../config';

export type WristCaviarRuleId =
  | 'WC_DEFER_CRYPTO_SHEET'
  | 'WC_DEFER_OSCAR_SHEET'
  | 'WC_EXCLUDE_EMPTY_CXC_CARD'
  | 'WC_EXCLUDE_EMPTY_CXP_CARD'
  | 'WC_BANK_ONE_PERCENT_AS_COMMISSION'
  | 'WC_RUNNING_BALANCE_VALIDATION_ONLY'
  | 'WC_HISTORICAL_SALE_NO_CURRENT_WATCH'
  | 'WC_EXACT_NORMALIZED_CUSTOMER_CANONICALIZATION'
  | 'WC_REFERENCE_OPTIONAL_FOR_HISTORICAL_SALE'
  | 'WC_SERIAL_OPTIONAL_FOR_HISTORICAL_SALE'
  | 'WC_POLLUTED_SERIAL_AS_NULL'
  | 'WC_REPORTE_RECONCILIATION_ONLY'
  | 'WC_FREE_FORM_CREDITOR_SUPPORTED'
  | 'WC_BLANK_TEMPLATE_ROW_EXCLUDED'
  | 'WC_PARTNER_ENTRY_AS_CONTRIBUTION'
  | 'WC_PARTNER_EXIT_AS_WITHDRAWAL'
  | 'WC_EXPENSE_ALIAS_MAP'
  | 'WC_EXPENSE_UNMAPPED_AS_OTHER'
  | 'WC_OPTIONAL_EXPENSE_ACCOUNT'
  | 'WC_SUMMARY_ROW_EXCLUDED';

export type RuleAudit = {
  ruleId: WristCaviarRuleId;
  description: string;
  changesData: boolean;
  appliedAt: string;
};

export type RuleDispositionPatch = {
  disposition: Disposition;
  dispositionReason: string;
  payloadPatch?: Record<string, unknown>;
  audit: RuleAudit;
};
