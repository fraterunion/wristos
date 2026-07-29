export type TaxonomySeverity = 'CRITICAL' | 'WARNING' | 'MANUAL_REVIEW' | 'INFORMATIONAL';

export type ResolutionType =
  | 'ACCEPT_AS_IS'
  | 'CORRECT_VALUE'
  | 'MAP_ENTITY'
  | 'MERGE_EXACT_DUPLICATE'
  | 'KEEP_SEPARATE'
  | 'EXCLUDE_FROM_MIGRATION'
  | 'DEFER'
  | 'CONFIRM_SCOPE_DIFFERENCE'
  | 'CONFIRM_FORMULA_OVERRIDE'
  | 'ACKNOWLEDGE_WARNING'
  | 'CHOOSE_CANONICAL_NAME'
  | 'MARK_SERIAL_UNKNOWN'
  | 'CONFIRM_INVENTORY_OVERLAP';

export type TaxonomyCode =
  | 'REQUIRED_SHEET_MISSING'
  | 'PARSER_FAILURE'
  | 'AMBIGUOUS_CXC_BLOCK'
  | 'AMBIGUOUS_CXP_BLOCK'
  | 'CXP_FORMULA_ERROR'
  | 'CXC_BALANCE_MISMATCH'
  | 'CXP_BALANCE_MISMATCH'
  | 'SALE_PROFIT_MISMATCH'
  | 'DUPLICATE_INVENTORY_SERIAL'
  | 'DUPLICATE_SOLD_SERIAL'
  | 'SOLD_SERIAL_IN_CURRENT_INVENTORY'
  | 'SPARSE_OR_POLLUTED_SERIAL'
  | 'MISSING_REFERENCE'
  | 'MISSING_SERIAL'
  | 'CUSTOMER_EXACT_DUPLICATE'
  | 'CUSTOMER_POSSIBLE_DUPLICATE'
  | 'INVALID_DATE'
  | 'INVALID_AMOUNT'
  | 'CASH_BALANCE_MISMATCH'
  | 'BANK_BALANCE_MISMATCH'
  | 'BANK_ONE_PERCENT_MISMATCH'
  | 'BANK_TOTAL_CELL_DRIFT'
  | 'PARTNER_BALANCE_MISMATCH'
  | 'PROFIT_SPLIT_MISMATCH'
  | 'REPORT_RECONCILIATION_MISMATCH'
  | 'REPORT_SCOPE_REVIEW'
  | 'DEFERRED_DESTINATION'
  | 'UNMAPPED_DESTINATION_FIELD'
  | 'UNCLASSIFIED_PARTNER_MOVEMENT';

export type IssueTaxonomyRule = {
  code: TaxonomyCode;
  severity: TaxonomySeverity;
  blocksDryRun: boolean;
  allowedResolutions: ResolutionType[];
  bulkAllowed: boolean;
  reasonRequired: boolean;
  description: string;
};

export const ISSUE_TAXONOMY: Record<TaxonomyCode, IssueTaxonomyRule> = {
  REQUIRED_SHEET_MISSING: {
    code: 'REQUIRED_SHEET_MISSING',
    severity: 'CRITICAL',
    blocksDryRun: true,
    allowedResolutions: [],
    bulkAllowed: false,
    reasonRequired: true,
    description: 'Required workbook sheet missing',
  },
  PARSER_FAILURE: {
    code: 'PARSER_FAILURE',
    severity: 'CRITICAL',
    blocksDryRun: true,
    allowedResolutions: [],
    bulkAllowed: false,
    reasonRequired: true,
    description: 'Parser crash or unrecoverable failure',
  },
  AMBIGUOUS_CXC_BLOCK: {
    code: 'AMBIGUOUS_CXC_BLOCK',
    severity: 'MANUAL_REVIEW',
    blocksDryRun: true,
    allowedResolutions: [
      'ACCEPT_AS_IS',
      'CORRECT_VALUE',
      'EXCLUDE_FROM_MIGRATION',
      'DEFER',
    ],
    bulkAllowed: false,
    reasonRequired: false,
    description: 'Ambiguous receivable card',
  },
  AMBIGUOUS_CXP_BLOCK: {
    code: 'AMBIGUOUS_CXP_BLOCK',
    severity: 'MANUAL_REVIEW',
    blocksDryRun: true,
    allowedResolutions: [
      'ACCEPT_AS_IS',
      'CORRECT_VALUE',
      'EXCLUDE_FROM_MIGRATION',
      'CONFIRM_FORMULA_OVERRIDE',
      'DEFER',
    ],
    bulkAllowed: false,
    reasonRequired: false,
    description: 'Ambiguous payable card',
  },
  CXP_FORMULA_ERROR: {
    code: 'CXP_FORMULA_ERROR',
    severity: 'CRITICAL',
    blocksDryRun: true,
    allowedResolutions: [
      'CONFIRM_FORMULA_OVERRIDE',
      'CORRECT_VALUE',
      'EXCLUDE_FROM_MIGRATION',
      'DEFER',
    ],
    bulkAllowed: false,
    reasonRequired: true,
    description: 'Broken CXP formula — must not be trusted silently',
  },
  CXC_BALANCE_MISMATCH: {
    code: 'CXC_BALANCE_MISMATCH',
    severity: 'WARNING',
    blocksDryRun: false,
    allowedResolutions: ['ACCEPT_AS_IS', 'CORRECT_VALUE', 'ACKNOWLEDGE_WARNING'],
    bulkAllowed: true,
    reasonRequired: false,
    description: 'Receivable declared vs calculated mismatch',
  },
  CXP_BALANCE_MISMATCH: {
    code: 'CXP_BALANCE_MISMATCH',
    severity: 'WARNING',
    blocksDryRun: false,
    allowedResolutions: [
      'ACCEPT_AS_IS',
      'CORRECT_VALUE',
      'CONFIRM_FORMULA_OVERRIDE',
      'ACKNOWLEDGE_WARNING',
    ],
    bulkAllowed: true,
    reasonRequired: false,
    description: 'Payable declared vs calculated mismatch',
  },
  SALE_PROFIT_MISMATCH: {
    code: 'SALE_PROFIT_MISMATCH',
    severity: 'WARNING',
    blocksDryRun: false,
    allowedResolutions: ['ACCEPT_AS_IS', 'CORRECT_VALUE', 'ACKNOWLEDGE_WARNING'],
    bulkAllowed: true,
    reasonRequired: false,
    description: 'Declared profit ≠ price − cost − extras',
  },
  DUPLICATE_INVENTORY_SERIAL: {
    code: 'DUPLICATE_INVENTORY_SERIAL',
    severity: 'CRITICAL',
    blocksDryRun: true,
    allowedResolutions: ['CORRECT_VALUE', 'EXCLUDE_FROM_MIGRATION', 'KEEP_SEPARATE'],
    bulkAllowed: false,
    reasonRequired: true,
    description: 'Exact duplicate inventory serial',
  },
  DUPLICATE_SOLD_SERIAL: {
    code: 'DUPLICATE_SOLD_SERIAL',
    severity: 'WARNING',
    blocksDryRun: false,
    allowedResolutions: ['CORRECT_VALUE', 'KEEP_SEPARATE', 'MARK_SERIAL_UNKNOWN', 'ACKNOWLEDGE_WARNING'],
    bulkAllowed: false,
    reasonRequired: false,
    description: 'Duplicate sold serial',
  },
  SOLD_SERIAL_IN_CURRENT_INVENTORY: {
    code: 'SOLD_SERIAL_IN_CURRENT_INVENTORY',
    severity: 'WARNING',
    blocksDryRun: false,
    allowedResolutions: [
      'CONFIRM_INVENTORY_OVERLAP',
      'CORRECT_VALUE',
      'EXCLUDE_FROM_MIGRATION',
      'ACKNOWLEDGE_WARNING',
    ],
    bulkAllowed: false,
    reasonRequired: true,
    description: 'Sold serial still present in inventory',
  },
  SPARSE_OR_POLLUTED_SERIAL: {
    code: 'SPARSE_OR_POLLUTED_SERIAL',
    severity: 'WARNING',
    blocksDryRun: false,
    allowedResolutions: ['MARK_SERIAL_UNKNOWN', 'CORRECT_VALUE', 'ACKNOWLEDGE_WARNING', 'EXCLUDE_FROM_MIGRATION'],
    bulkAllowed: true,
    reasonRequired: false,
    description: 'Sparse or polluted serial field',
  },
  MISSING_REFERENCE: {
    code: 'MISSING_REFERENCE',
    severity: 'WARNING',
    blocksDryRun: false,
    allowedResolutions: ['ACKNOWLEDGE_WARNING', 'CORRECT_VALUE', 'EXCLUDE_FROM_MIGRATION'],
    bulkAllowed: true,
    reasonRequired: false,
    description: 'Missing inventory reference',
  },
  MISSING_SERIAL: {
    code: 'MISSING_SERIAL',
    severity: 'WARNING',
    blocksDryRun: false,
    allowedResolutions: ['ACKNOWLEDGE_WARNING', 'MARK_SERIAL_UNKNOWN', 'CORRECT_VALUE'],
    bulkAllowed: true,
    reasonRequired: false,
    description: 'Missing inventory serial',
  },
  CUSTOMER_EXACT_DUPLICATE: {
    code: 'CUSTOMER_EXACT_DUPLICATE',
    severity: 'INFORMATIONAL',
    blocksDryRun: false,
    allowedResolutions: ['MERGE_EXACT_DUPLICATE', 'KEEP_SEPARATE', 'CHOOSE_CANONICAL_NAME', 'ACKNOWLEDGE_WARNING'],
    bulkAllowed: true,
    reasonRequired: false,
    description: 'Exact normalized customer duplicate group',
  },
  CUSTOMER_POSSIBLE_DUPLICATE: {
    code: 'CUSTOMER_POSSIBLE_DUPLICATE',
    severity: 'MANUAL_REVIEW',
    blocksDryRun: false,
    allowedResolutions: ['KEEP_SEPARATE', 'MERGE_EXACT_DUPLICATE', 'CHOOSE_CANONICAL_NAME', 'DEFER'],
    bulkAllowed: false,
    reasonRequired: false,
    description: 'Fuzzy/possible customer duplicate — never auto-merge',
  },
  INVALID_DATE: {
    code: 'INVALID_DATE',
    severity: 'CRITICAL',
    blocksDryRun: true,
    allowedResolutions: ['CORRECT_VALUE', 'EXCLUDE_FROM_MIGRATION'],
    bulkAllowed: false,
    reasonRequired: true,
    description: 'Invalid date',
  },
  INVALID_AMOUNT: {
    code: 'INVALID_AMOUNT',
    severity: 'CRITICAL',
    blocksDryRun: true,
    allowedResolutions: ['CORRECT_VALUE', 'EXCLUDE_FROM_MIGRATION'],
    bulkAllowed: false,
    reasonRequired: true,
    description: 'Invalid amount',
  },
  CASH_BALANCE_MISMATCH: {
    code: 'CASH_BALANCE_MISMATCH',
    severity: 'WARNING',
    blocksDryRun: false,
    allowedResolutions: ['ACCEPT_AS_IS', 'CORRECT_VALUE', 'ACKNOWLEDGE_WARNING', 'CONFIRM_SCOPE_DIFFERENCE'],
    bulkAllowed: true,
    reasonRequired: false,
    description: 'Cash running balance mismatch',
  },
  BANK_BALANCE_MISMATCH: {
    code: 'BANK_BALANCE_MISMATCH',
    severity: 'WARNING',
    blocksDryRun: false,
    allowedResolutions: ['ACCEPT_AS_IS', 'CORRECT_VALUE', 'ACKNOWLEDGE_WARNING', 'CONFIRM_SCOPE_DIFFERENCE'],
    bulkAllowed: true,
    reasonRequired: false,
    description: 'Bank running balance mismatch',
  },
  BANK_ONE_PERCENT_MISMATCH: {
    code: 'BANK_ONE_PERCENT_MISMATCH',
    severity: 'WARNING',
    blocksDryRun: false,
    allowedResolutions: ['ACCEPT_AS_IS', 'ACKNOWLEDGE_WARNING', 'CORRECT_VALUE'],
    bulkAllowed: true,
    reasonRequired: false,
    description: 'Bank commission ≠ 1% where rule applies',
  },
  BANK_TOTAL_CELL_DRIFT: {
    code: 'BANK_TOTAL_CELL_DRIFT',
    severity: 'WARNING',
    blocksDryRun: false,
    allowedResolutions: ['CONFIRM_SCOPE_DIFFERENCE', 'ACKNOWLEDGE_WARNING', 'EXCLUDE_FROM_MIGRATION'],
    bulkAllowed: false,
    reasonRequired: true,
    description: 'Bank total cell drift vs ledger sequence',
  },
  PARTNER_BALANCE_MISMATCH: {
    code: 'PARTNER_BALANCE_MISMATCH',
    severity: 'WARNING',
    blocksDryRun: false,
    allowedResolutions: ['ACCEPT_AS_IS', 'CORRECT_VALUE', 'ACKNOWLEDGE_WARNING'],
    bulkAllowed: true,
    reasonRequired: false,
    description: 'Partner ledger balance mismatch',
  },
  PROFIT_SPLIT_MISMATCH: {
    code: 'PROFIT_SPLIT_MISMATCH',
    severity: 'WARNING',
    blocksDryRun: false,
    allowedResolutions: ['ACCEPT_AS_IS', 'CORRECT_VALUE', 'ACKNOWLEDGE_WARNING', 'CONFIRM_SCOPE_DIFFERENCE'],
    bulkAllowed: false,
    reasonRequired: true,
    description: '75/25 profit split mismatch',
  },
  REPORT_RECONCILIATION_MISMATCH: {
    code: 'REPORT_RECONCILIATION_MISMATCH',
    severity: 'WARNING',
    blocksDryRun: false,
    allowedResolutions: [
      'ACCEPT_AS_IS',
      'CORRECT_VALUE',
      'CONFIRM_SCOPE_DIFFERENCE',
      'ACKNOWLEDGE_WARNING',
      'EXCLUDE_FROM_MIGRATION',
    ],
    bulkAllowed: false,
    reasonRequired: true,
    description: 'REPORTE declared vs calculated mismatch',
  },
  REPORT_SCOPE_REVIEW: {
    code: 'REPORT_SCOPE_REVIEW',
    severity: 'WARNING',
    blocksDryRun: false,
    allowedResolutions: ['CONFIRM_SCOPE_DIFFERENCE', 'ACKNOWLEDGE_WARNING', 'DEFER'],
    bulkAllowed: false,
    reasonRequired: true,
    description: 'REPORTE scope review required',
  },
  DEFERRED_DESTINATION: {
    code: 'DEFERRED_DESTINATION',
    severity: 'MANUAL_REVIEW',
    blocksDryRun: false,
    allowedResolutions: ['DEFER', 'EXCLUDE_FROM_MIGRATION', 'MAP_ENTITY'],
    bulkAllowed: true,
    reasonRequired: true,
    description: 'No exact WristOS destination — defer or map',
  },
  UNMAPPED_DESTINATION_FIELD: {
    code: 'UNMAPPED_DESTINATION_FIELD',
    severity: 'MANUAL_REVIEW',
    blocksDryRun: false,
    allowedResolutions: ['DEFER', 'EXCLUDE_FROM_MIGRATION', 'MAP_ENTITY', 'ACKNOWLEDGE_WARNING'],
    bulkAllowed: false,
    reasonRequired: true,
    description: 'Unsupported destination field',
  },
  UNCLASSIFIED_PARTNER_MOVEMENT: {
    code: 'UNCLASSIFIED_PARTNER_MOVEMENT',
    severity: 'MANUAL_REVIEW',
    blocksDryRun: false,
    allowedResolutions: ['ACCEPT_AS_IS', 'DEFER', 'ACKNOWLEDGE_WARNING', 'MAP_ENTITY'],
    bulkAllowed: true,
    reasonRequired: false,
    description: 'Partner ledger movement without deterministic classification',
  },
};

const LEGACY_CODE_MAP: Record<string, TaxonomyCode> = {
  FORMULA_ERROR: 'CXP_FORMULA_ERROR',
  MISSING_CORE_SHEET: 'REQUIRED_SHEET_MISSING',
  PARSER_CRASH: 'PARSER_FAILURE',
  AMBIGUOUS_CXC_BLOCK: 'AMBIGUOUS_CXC_BLOCK',
  AMBIGUOUS_CXP_BLOCK: 'AMBIGUOUS_CXP_BLOCK',
  RECEIVABLE_BALANCE_MISMATCH: 'CXC_BALANCE_MISMATCH',
  PAYABLE_BALANCE_MISMATCH: 'CXP_BALANCE_MISMATCH',
  SALE_PROFIT_MISMATCH: 'SALE_PROFIT_MISMATCH',
  DUPLICATE_INVENTORY_SERIAL: 'DUPLICATE_INVENTORY_SERIAL',
  DUPLICATE_SOLD_SERIAL: 'DUPLICATE_SOLD_SERIAL',
  SOLD_SERIAL_IN_INVENTORY: 'SOLD_SERIAL_IN_CURRENT_INVENTORY',
  SPARSE_OR_POLLUTED_SERIAL: 'SPARSE_OR_POLLUTED_SERIAL',
  MISSING_REFERENCE: 'MISSING_REFERENCE',
  MISSING_SERIAL: 'MISSING_SERIAL',
  CUSTOMER_EXACT_DUPLICATE_GROUP: 'CUSTOMER_EXACT_DUPLICATE',
  AMBIGUOUS_CUSTOMER_DUPLICATE: 'CUSTOMER_POSSIBLE_DUPLICATE',
  INVALID_DATE: 'INVALID_DATE',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  CASH_RUNNING_BALANCE_MISMATCH: 'CASH_BALANCE_MISMATCH',
  BANK_RUNNING_BALANCE_MISMATCH: 'BANK_BALANCE_MISMATCH',
  BANK_ONE_PERCENT_MISMATCH: 'BANK_ONE_PERCENT_MISMATCH',
  BANK_TOTAL_CELL_DRIFT: 'BANK_TOTAL_CELL_DRIFT',
  PARTNER_LEDGER_MISMATCH: 'PARTNER_BALANCE_MISMATCH',
  PROFIT_SPLIT_MISMATCH: 'PROFIT_SPLIT_MISMATCH',
  REPORT_RECONCILIATION_MISMATCH: 'REPORT_RECONCILIATION_MISMATCH',
  DEFERRED_CRYPTO_DESTINATION: 'DEFERRED_DESTINATION',
  DEFERRED_EXTERNAL_FLOAT: 'DEFERRED_DESTINATION',
  UNCLASSIFIED_CESAR_MOVEMENT: 'UNCLASSIFIED_PARTNER_MOVEMENT',
};

export function mapLegacyIssueCode(
  code: string,
  sourceSheet?: string | null,
): TaxonomyCode {
  if (code === 'FORMULA_ERROR' && sourceSheet === 'CTAS X PAGAR') {
    return 'CXP_FORMULA_ERROR';
  }
  if (code === 'FORMULA_ERROR') {
    return 'CXP_FORMULA_ERROR';
  }
  return LEGACY_CODE_MAP[code] ?? 'UNMAPPED_DESTINATION_FIELD';
}

export function assertResolutionAllowed(
  taxonomyCode: TaxonomyCode,
  resolutionType: ResolutionType,
  reason?: string | null,
): void {
  const rule = ISSUE_TAXONOMY[taxonomyCode];
  if (!rule) {
    throw new Error(`Unknown taxonomy code: ${taxonomyCode}`);
  }
  if (!rule.allowedResolutions.includes(resolutionType)) {
    throw new Error(
      `Resolution ${resolutionType} is not allowed for ${taxonomyCode}`,
    );
  }
  if (rule.reasonRequired && (!reason || !reason.trim())) {
    throw new Error(`Reason is required for ${taxonomyCode} / ${resolutionType}`);
  }
  if (
    (resolutionType === 'CONFIRM_INVENTORY_OVERLAP' ||
      resolutionType === 'DEFER' ||
      resolutionType === 'CONFIRM_SCOPE_DIFFERENCE' ||
      resolutionType === 'CONFIRM_FORMULA_OVERRIDE') &&
    (!reason || !reason.trim())
  ) {
    throw new Error(`Reason is required for ${resolutionType}`);
  }
}

export function reviewStatusForResolution(
  resolutionType: ResolutionType,
): 'RESOLVED' | 'ACKNOWLEDGED' | 'EXCLUDED' | 'DEFERRED' {
  switch (resolutionType) {
    case 'EXCLUDE_FROM_MIGRATION':
      return 'EXCLUDED';
    case 'DEFER':
      return 'DEFERRED';
    case 'ACKNOWLEDGE_WARNING':
    case 'CONFIRM_SCOPE_DIFFERENCE':
      return 'ACKNOWLEDGED';
    default:
      return 'RESOLVED';
  }
}
