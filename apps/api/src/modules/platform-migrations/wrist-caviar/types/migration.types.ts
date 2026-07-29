import type { RecognizedSheetName } from '../constants';

export type MigrationReadiness = 'READY_FOR_DRY_RUN' | 'NEEDS_REVIEW' | 'BLOCKED';
export type IssueSeverity = 'CRITICAL' | 'WARNING' | 'MANUAL_REVIEW' | 'INFORMATIONAL';
export type SheetClassification =
  | 'OPERATIONAL'
  | 'RECONCILIATION'
  | 'DERIVED'
  | 'DEFERRED'
  | 'UNKNOWN'
  | 'MISSING';
export type SheetParseStatus = 'PARSED' | 'PARTIAL' | 'FAILED' | 'SKIPPED' | 'UNKNOWN_SHEET';
export type DestinationClass =
  | 'CUSTOMER'
  | 'INVENTORY'
  | 'SALE'
  | 'RECEIVABLE'
  | 'PAYABLE'
  | 'EXPENSE'
  | 'CASH_LEDGER'
  | 'BANK_LEDGER'
  | 'PARTNER_LEDGER'
  | 'PROFIT_DISTRIBUTION'
  | 'CRYPTO_LEDGER'
  | 'EXTERNAL_FLOAT'
  | 'REPORTED_BALANCE'
  | 'DEFERRED'
  | 'NONE';

export type ReconciliationStatus =
  | 'MATCHED'
  | 'WITHIN_TOLERANCE'
  | 'MISMATCH'
  | 'SCOPE_REVIEW_REQUIRED'
  | 'UNAVAILABLE'
  | 'FORMULA_ERROR';

export type DuplicateConfidence =
  | 'EXACT_NORMALIZED_MATCH'
  | 'ACCENT_VARIANT'
  | 'POSSIBLE_ABBREVIATION'
  | 'POSSIBLE_TYPO';

export type CurrencyCode = 'MXN' | 'USD' | 'UNKNOWN';

export interface MigrationSourceReference {
  workbookFingerprint: string;
  parserVersion: string;
  sourceSheet: string;
  sourceRow: number;
  sourceColumnStart?: number;
  sourceColumnEnd?: number;
  sourceCellCoordinates?: string[];
  sourceBlockId?: string;
}

export interface MigrationWarning {
  code: string;
  message: string;
  severity: 'WARNING' | 'INFORMATIONAL';
  source?: MigrationSourceReference;
  category?: string;
}

export interface MigrationError {
  code: string;
  message: string;
  severity: 'CRITICAL';
  source?: MigrationSourceReference;
  category?: string;
}

export interface MigrationManualReviewItem {
  code: string;
  message: string;
  severity: 'MANUAL_REVIEW';
  source?: MigrationSourceReference;
  category?: string;
  context?: Record<string, string | number | boolean | null>;
}

export interface CustomerCandidate {
  id: string;
  displayName: string;
  normalizedName: string;
  sources: MigrationSourceReference[];
  groupKey?: string;
  duplicateSuggestions: Array<{ otherId: string; confidence: DuplicateConfidence }>;
}

export interface InventoryCandidate {
  id: string;
  brand: string;
  model: string;
  reference: string | null;
  serial: string | null;
  cost: number | null;
  usd: number | null;
  extras: number | null;
  totalCost: number | null;
  currencyContext: string | null;
  source: MigrationSourceReference;
}

export interface SaleCandidate {
  id: string;
  saleDate: string | null;
  customerName: string;
  brand: string;
  model: string;
  reference: string | null;
  serial: string | null;
  cost: number | null;
  salePrice: number | null;
  extras: number | null;
  declaredProfit: number | null;
  calculatedProfit: number | null;
  profitMismatch: boolean;
  paymentCount: number | null;
  source: MigrationSourceReference;
}

export interface ReceivablePaymentCandidate {
  id: string;
  label: string;
  amount: number | null;
  paymentDate: string | null;
  note: string | null;
  source: MigrationSourceReference;
}

export interface ReceivableCandidate {
  id: string;
  customerName: string;
  principal: number | null;
  watchOrConcept: string | null;
  declaredOutstanding: number | null;
  calculatedOutstanding: number | null;
  balanceMismatch: boolean;
  currency: CurrencyCode;
  payments: ReceivablePaymentCandidate[];
  source: MigrationSourceReference;
  ambiguous: boolean;
}

export interface PayablePaymentCandidate {
  id: string;
  label: string;
  amount: number | null;
  paymentDate: string | null;
  note: string | null;
  source: MigrationSourceReference;
}

export interface PayableCandidate {
  id: string;
  creditorName: string;
  creditorLabelRaw: string;
  principal: number | null;
  watchOrConcept: string | null;
  declaredRemaining: number | null;
  calculatedRemaining: number | null;
  balanceMismatch: boolean;
  currency: CurrencyCode;
  payments: PayablePaymentCandidate[];
  formulaErrors: string[];
  source: MigrationSourceReference;
  ambiguous: boolean;
}

export interface ExpenseCandidate {
  id: string;
  expenseDate: string | null;
  concept: string;
  account: string | null;
  amount: number | null;
  source: MigrationSourceReference;
}

export interface CashLedgerCandidate {
  id: string;
  currency: 'MXN' | 'USD';
  entryDate: string | null;
  concept: string;
  entryAmount: number | null;
  exitAmount: number | null;
  exchangeRate: number | null;
  reportedBalance: number | null;
  calculatedBalance: number | null;
  balanceMismatch: boolean;
  hidden: boolean;
  source: MigrationSourceReference;
}

export interface BankLedgerCandidate {
  id: string;
  entryDate: string | null;
  reference: string | null;
  concept: string;
  deposit: number | null;
  commission: number | null;
  withdrawal: number | null;
  reportedBalance: number | null;
  calculatedBalance: number | null;
  balanceMismatch: boolean;
  comment: string | null;
  onePercentRuleStatus: 'MATCHED' | 'MISMATCH' | 'NOT_APPLICABLE' | 'UNAVAILABLE';
  source: MigrationSourceReference;
}

export interface PartnerLedgerCandidate {
  id: string;
  entryDate: string | null;
  concept: string;
  entryAmount: number | null;
  exitAmount: number | null;
  reportedBalance: number | null;
  calculatedBalance: number | null;
  balanceMismatch: boolean;
  classification: 'UNCLASSIFIED' | 'CONTRIBUTION' | 'WITHDRAWAL';
  source: MigrationSourceReference;
}

export interface ProfitDistributionCandidate {
  id: string;
  partner: 'CESAR' | 'EDGAR' | 'UNKNOWN';
  monthLabel: string | null;
  accrued: number | null;
  collected: number | null;
  outstanding: number | null;
  expectedShare: number | null;
  shareMismatch: boolean;
  source: MigrationSourceReference;
}

export interface CryptoLedgerCandidate {
  id: string;
  entryDate: string | null;
  concept: string;
  entryAmount: number | null;
  exitAmount: number | null;
  reportedBalance: number | null;
  calculatedBalance: number | null;
  balanceMismatch: boolean;
  destination: 'DEFERRED';
  source: MigrationSourceReference;
}

export interface ExternalFloatCandidate {
  id: string;
  label: string;
  concept: string;
  amount: number | null;
  reportedBalance: number | null;
  destination: 'DEFERRED';
  source: MigrationSourceReference;
}

export interface ReportedBalance {
  concept: string;
  currency: CurrencyCode;
  value: number | null;
  formula: string | null;
  formulaError: boolean;
  sourceCells: string[];
  source: MigrationSourceReference;
}

export interface ReconciliationItem {
  concept: string;
  currency: CurrencyCode;
  declaredValue: number | null;
  calculatedValue: number | null;
  difference: number | null;
  tolerance: number;
  status: ReconciliationStatus;
  notes: string | null;
  sourceCells: string[];
}

export interface SheetAnalysis {
  sheetName: string;
  recognized: boolean;
  classification: SheetClassification;
  status: SheetParseStatus;
  detectedRecords: number;
  warningCount: number;
  errorCount: number;
  manualReviewCount: number;
  notes: string[];
}

export interface NormalizedCounts {
  customers: number;
  inventory: number;
  sales: number;
  receivables: number;
  receivablePayments: number;
  payables: number;
  payablePayments: number;
  expenses: number;
  cashMxn: number;
  cashUsd: number;
  cashHidden: number;
  bankMovements: number;
  partnerLedger: number;
  profitDistributions: number;
  cryptoLedger: number;
  externalFloat: number;
  deferred: number;
  reportedBalances: number;
}

export interface IssueSummary {
  critical: number;
  warning: number;
  manualReview: number;
  informational: number;
  byCategory: Record<string, number>;
}

export interface WorkbookAnalysis {
  analysisId?: string;
  parserVersion: string;
  fingerprint: string;
  fingerprintPrefix: string;
  fileName: string;
  fileSizeBytes: number;
  readiness: MigrationReadiness;
  durationMs: number;
  sheets: SheetAnalysis[];
  unknownSheets: string[];
  missingCoreSheets: string[];
  counts: NormalizedCounts;
  issueSummary: IssueSummary;
  reconciliation: ReconciliationItem[];
  issues: Array<MigrationWarning | MigrationError | MigrationManualReviewItem>;
  customers: CustomerCandidate[];
  inventory: InventoryCandidate[];
  sales: SaleCandidate[];
  receivables: ReceivableCandidate[];
  payables: PayableCandidate[];
  expenses: ExpenseCandidate[];
  cash: CashLedgerCandidate[];
  bank: BankLedgerCandidate[];
  partnerLedger: PartnerLedgerCandidate[];
  profitDistributions: ProfitDistributionCandidate[];
  crypto: CryptoLedgerCandidate[];
  externalFloat: ExternalFloatCandidate[];
  reportedBalances: ReportedBalance[];
  operationalWrites: 0;
}

export interface SheetParseContext {
  workbookFingerprint: string;
  parserVersion: string;
  sheetName: RecognizedSheetName | string;
}

export type SheetParserResult<T> = {
  records: T[];
  warnings: MigrationWarning[];
  errors: MigrationError[];
  manualReview: MigrationManualReviewItem[];
  notes: string[];
};
