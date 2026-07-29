/**
 * Destination semantics for CUENTA CESAR partner resolutions.
 * Based on Prisma schema + current one-time importer execute path.
 *
 * Current importer for entityType=partner creates only TreasuryEntry (CESAR INFLOW/OUTFLOW)
 * with classification in description. Capital InvestorContribution / InvestorDistribution
 * exist in schema but are used for profit sheet / capital UI, not yet fully wired for
 * every partner resolution type in execute-import.
 */

export type DestinationSemantic = {
  resolutionType: string;
  destinationModel: string;
  destinationEnumOrCategory: string;
  changesCapitalBalance: boolean;
  changesTreasuryBalance: boolean;
  affectsProfitDistributions: boolean;
  representableWithoutLosingMeaning: boolean;
  notes: string;
};

export const PARTNER_DESTINATION_SEMANTICS: DestinationSemantic[] = [
  {
    resolutionType: 'CLASSIFY_AS_CONTRIBUTION',
    destinationModel: 'InvestorContribution + TreasuryEntry',
    destinationEnumOrCategory: 'CapitalAccount.CESAR_ACCOUNT / TreasuryAccount.CESAR INFLOW',
    changesCapitalBalance: true,
    changesTreasuryBalance: true,
    affectsProfitDistributions: false,
    representableWithoutLosingMeaning: true,
    notes: 'Schema supports. Importer currently writes TreasuryEntry only; contribution link is the correct capital meaning.',
  },
  {
    resolutionType: 'CLASSIFY_AS_WITHDRAWAL',
    destinationModel: 'TreasuryEntry',
    destinationEnumOrCategory: 'TreasuryAccount.CESAR OUTFLOW',
    changesCapitalBalance: false,
    changesTreasuryBalance: true,
    affectsProfitDistributions: false,
    representableWithoutLosingMeaning: false,
    notes: 'No dedicated capital-withdrawal model. Treasury OUTFLOW preserves cash movement but not ownership semantics.',
  },
  {
    resolutionType: 'CLASSIFY_AS_LOAN_TO_BUSINESS',
    destinationModel: 'AccountEntry',
    destinationEnumOrCategory: 'AccountEntryCategory.LOAN (RECEIVABLE or PAYABLE)',
    changesCapitalBalance: false,
    changesTreasuryBalance: false,
    affectsProfitDistributions: false,
    representableWithoutLosingMeaning: true,
    notes: 'Schema supports LOAN category. Not wired in partner execute path yet — prefer DEFER until mapped.',
  },
  {
    resolutionType: 'CLASSIFY_AS_LOAN_REPAYMENT',
    destinationModel: 'AccountPayment on LOAN AccountEntry',
    destinationEnumOrCategory: 'AccountPayment',
    changesCapitalBalance: false,
    changesTreasuryBalance: true,
    affectsProfitDistributions: false,
    representableWithoutLosingMeaning: true,
    notes: 'Requires linked loan AccountEntry. Prefer DEFER if loan master not imported.',
  },
  {
    resolutionType: 'CLASSIFY_AS_PARTNER_ADVANCE',
    destinationModel: 'AccountEntry (LOAN closest)',
    destinationEnumOrCategory: 'AccountEntryCategory.LOAN',
    changesCapitalBalance: false,
    changesTreasuryBalance: true,
    affectsProfitDistributions: false,
    representableWithoutLosingMeaning: false,
    notes: 'No dedicated ADVANCE enum. LOAN is closest; DEFER recommended to avoid mislabeling.',
  },
  {
    resolutionType: 'CLASSIFY_AS_ADVANCE_REPAYMENT',
    destinationModel: 'AccountPayment',
    destinationEnumOrCategory: 'AccountPayment on advance/loan entry',
    changesCapitalBalance: false,
    changesTreasuryBalance: true,
    affectsProfitDistributions: false,
    representableWithoutLosingMeaning: false,
    notes: 'No dedicated ADVANCE type. DEFER recommended.',
  },
  {
    resolutionType: 'CLASSIFY_AS_REIMBURSEMENT',
    destinationModel: 'AccountEntry (REFUND closest) or TreasuryEntry',
    destinationEnumOrCategory: 'AccountEntryCategory.REFUND',
    changesCapitalBalance: false,
    changesTreasuryBalance: true,
    affectsProfitDistributions: false,
    representableWithoutLosingMeaning: false,
    notes: 'REFUND is closest but not equivalent. DEFER recommended.',
  },
  {
    resolutionType: 'CLASSIFY_AS_PROFIT_DISTRIBUTION',
    destinationModel: 'InvestorDistribution + TreasuryEntry',
    destinationEnumOrCategory: 'CapitalAccount.CESAR_ACCOUNT / Treasury OUTFLOW',
    changesCapitalBalance: false,
    changesTreasuryBalance: true,
    affectsProfitDistributions: true,
    representableWithoutLosingMeaning: true,
    notes: 'Schema supports. Use only for partner profit payouts (exits), not for utilidad inflows.',
  },
  {
    resolutionType: 'CLASSIFY_AS_BUSINESS_EXPENSE',
    destinationModel: 'OperatingExpense',
    destinationEnumOrCategory: 'OperatingExpenseCategory',
    changesCapitalBalance: false,
    changesTreasuryBalance: false,
    affectsProfitDistributions: false,
    representableWithoutLosingMeaning: false,
    notes: 'Risk of double-count vs GASTOS sheet. Do not use for Cesar ledger unless proven absent from GASTOS.',
  },
  {
    resolutionType: 'CLASSIFY_AS_WATCH_PURCHASE',
    destinationModel: 'Watch / AccountEntry PURCHASE',
    destinationEnumOrCategory: 'AccountEntryCategory.PURCHASE',
    changesCapitalBalance: false,
    changesTreasuryBalance: true,
    affectsProfitDistributions: false,
    representableWithoutLosingMeaning: false,
    notes: 'Unsafe without inventory wiring. Prefer DEFER — do not force as capital exit.',
  },
  {
    resolutionType: 'CLASSIFY_AS_TRANSFER',
    destinationModel: 'TreasuryEntry',
    destinationEnumOrCategory: 'TreasuryAccount.CESAR INFLOW or OUTFLOW',
    changesCapitalBalance: false,
    changesTreasuryBalance: true,
    affectsProfitDistributions: false,
    representableWithoutLosingMeaning: false,
    notes: 'Cash movement only; ownership meaning lost. Prefer DEFER when semantics matter.',
  },
  {
    resolutionType: 'EXCLUDE_SUMMARY_OR_INVALID_ROW',
    destinationModel: '(none)',
    destinationEnumOrCategory: 'disposition EXCLUDED',
    changesCapitalBalance: false,
    changesTreasuryBalance: false,
    affectsProfitDistributions: false,
    representableWithoutLosingMeaning: true,
    notes: 'Valid for non-movements / invalid rows.',
  },
  {
    resolutionType: 'DEFER_FOR_LATER',
    destinationModel: '(none)',
    destinationEnumOrCategory: 'disposition DEFERRED',
    changesCapitalBalance: false,
    changesTreasuryBalance: false,
    affectsProfitDistributions: false,
    representableWithoutLosingMeaning: true,
    notes: 'Preferred when schema cannot distinguish loan/advance/reimbursement/profit-inflow safely.',
  },
  {
    resolutionType: 'CORRECT_AMOUNT',
    destinationModel: 'payload correction then reclassify',
    destinationEnumOrCategory: 'CORRECT_VALUE',
    changesCapitalBalance: false,
    changesTreasuryBalance: false,
    affectsProfitDistributions: false,
    representableWithoutLosingMeaning: true,
    notes: 'Requires approvedValue amount; does not by itself choose semantic type.',
  },
];

/** Options always safe to offer for ambiguous partner rows given current schema. */
export const PARTNER_SAFE_RESOLUTION_TYPES = [
  'DEFER_FOR_LATER',
  'EXCLUDE_SUMMARY_OR_INVALID_ROW',
  'CORRECT_AMOUNT',
  'CLASSIFY_AS_CONTRIBUTION',
  'CLASSIFY_AS_WITHDRAWAL',
  'CLASSIFY_AS_PROFIT_DISTRIBUTION',
  'CLASSIFY_AS_TRANSFER',
  'CLASSIFY_AS_LOAN_TO_BUSINESS',
  'CLASSIFY_AS_LOAN_REPAYMENT',
  'CLASSIFY_AS_PARTNER_ADVANCE',
  'CLASSIFY_AS_ADVANCE_REPAYMENT',
  'CLASSIFY_AS_REIMBURSEMENT',
] as const;

/** Watch purchase / business expense forced options are NOT offered — unsupported safely. */
export const PARTNER_UNSUPPORTED_FORCED_TYPES = [
  'CLASSIFY_AS_BUSINESS_EXPENSE',
  'CLASSIFY_AS_WATCH_PURCHASE',
] as const;

export function partnerOptionsForKind(kind: string): string[] {
  const base = [...PARTNER_SAFE_RESOLUTION_TYPES];
  // Guidance: for loans/advances/reimbursements/profit, DEFER is first in list (not auto-selected)
  if (kind === 'PROFIT') {
    return [
      'DEFER_FOR_LATER',
      'CLASSIFY_AS_PROFIT_DISTRIBUTION',
      'CLASSIFY_AS_TRANSFER',
      'CLASSIFY_AS_CONTRIBUTION',
      'CLASSIFY_AS_WITHDRAWAL',
      'EXCLUDE_SUMMARY_OR_INVALID_ROW',
      'CORRECT_AMOUNT',
    ];
  }
  if (kind === 'LOAN_OR_ADVANCE') {
    return [
      'DEFER_FOR_LATER',
      'CLASSIFY_AS_PARTNER_ADVANCE',
      'CLASSIFY_AS_LOAN_TO_BUSINESS',
      'CLASSIFY_AS_LOAN_REPAYMENT',
      'CLASSIFY_AS_ADVANCE_REPAYMENT',
      'CLASSIFY_AS_TRANSFER',
      'EXCLUDE_SUMMARY_OR_INVALID_ROW',
      'CORRECT_AMOUNT',
    ];
  }
  if (kind === 'REIMBURSEMENT') {
    return [
      'DEFER_FOR_LATER',
      'CLASSIFY_AS_REIMBURSEMENT',
      'CLASSIFY_AS_TRANSFER',
      'EXCLUDE_SUMMARY_OR_INVALID_ROW',
      'CORRECT_AMOUNT',
    ];
  }
  return base;
}
