export const SALES_IMPORT_FIELDS = [
  'saleDate',
  'customerName',
  'brand',
  'model',
  'reference',
  'serialNumber',
  'cost',
  'costCurrency',
  'salePrice',
  'saleCurrency',
  'extras',
  'extrasCurrency',
  'reportedProfit',
  'reportedProfitCurrency',
  'paymentCount',
  'notes',
  /** Shared default currency when per-field currency columns are absent. */
  'currency',
] as const;

export type SalesImportField = (typeof SALES_IMPORT_FIELDS)[number];

export const SKIP_FIELD = '__skip__' as const;
export type SkipField = typeof SKIP_FIELD;

export type SalesMappingEntry = {
  sourceColumn: string;
  targetField: SalesImportField | SkipField;
};

export type SalesMappingProposal = {
  sourceColumn: string;
  sampleValues: string[];
  suggested: SalesImportField | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
};

export type SalesMappingResponse = {
  fileId: string;
  mapping: SalesMappingEntry[];
  mappingVersion: string | null;
  proposals: SalesMappingProposal[];
  isProposed: boolean;
};

/** Sprint §6 canonical extraction shape (pre-normalization). */
export type HistoricalSaleExtraction = {
  sourceRow?: number | null;
  saleDate?: string | null;
  customerName?: string | null;

  brand?: string | null;
  model?: string | null;
  reference?: string | null;
  serialNumber?: string | null;

  cost?: number | null;
  costCurrency?: 'MXN' | 'USD' | null;

  salePrice?: number | null;
  saleCurrency?: 'MXN' | 'USD' | null;

  extras?: number | null;
  extrasCurrency?: 'MXN' | 'USD' | null;

  reportedProfit?: number | null;
  reportedProfitCurrency?: 'MXN' | 'USD' | null;

  paymentCount?: number | null;
  notes?: string | null;

  confidence?: {
    overall: number;
    saleDate?: number | null;
    customerName?: number | null;
    brand?: number | null;
    model?: number | null;
    reference?: number | null;
    serialNumber?: number | null;
    cost?: number | null;
    salePrice?: number | null;
    extras?: number | null;
    reportedProfit?: number | null;
  } | null;
};

export type MonetaryParseResult =
  | { status: 'ok'; value: number; detectedCurrency?: 'MXN' | 'USD' }
  | { status: 'empty' }
  | { status: 'error'; code: 'AMBIGUOUS_NUMBER_FORMAT' | 'CONFLICTING_CURRENCY' | 'INVALID_NUMBER_FORMAT' };

export type NormalizedMoney = {
  /** Canonical MXN amount after FX when applicable. */
  mxn: number;
  /** Amount in the source currency (equals mxn when MXN). */
  original: number;
  currency: 'MXN' | 'USD';
  /** FX rate applied (USD→MXN); null when no conversion. */
  rate: number | null;
  /** True when MXN was assumed because the source had no explicit currency label. */
  assumedMxn: boolean;
};

export type SalesParseIssue = {
  field: SalesImportField;
  code: string;
};

export type NormalizedHistoricalSale = {
  saleDate?: string;
  customerName?: string;
  brand?: string;
  model?: string;
  reference?: string;
  serialNumber?: string;

  cost?: number;
  costOriginalAmount?: number;
  costCurrency?: 'MXN' | 'USD';
  costExchangeRate?: number;

  salePrice?: number;
  salePriceOriginalAmount?: number;
  saleCurrency?: 'MXN' | 'USD';
  saleExchangeRate?: number;

  extras?: number;
  extrasOriginalAmount?: number;
  extrasCurrency?: 'MXN' | 'USD';
  extrasExchangeRate?: number;

  reportedProfit?: number;
  reportedProfitOriginalAmount?: number;
  reportedProfitCurrency?: 'MXN' | 'USD';

  calculatedProfit?: number | null;
  paymentCount?: number;
  notes?: string;

  /** True when any monetary field defaulted to MXN without an explicit label. */
  currencyAssumedMxn?: boolean;
  parseIssues?: SalesParseIssue[];

  importFingerprint?: string;

  /** Dry-run match proposals (read-only hints for review/commit). */
  matchedClientId?: string | null;
  proposedClientCreate?: boolean;
  matchedWatchId?: string | null;
  matchedWatchBy?: 'serial' | 'reference' | null;
};

export type SalesRowState = 'VALID' | 'WARNING' | 'INVALID';

export type SalesValidationIssue = {
  code: string;
  field: string;
  message: string;
};

export type SalesRowValidationResult = {
  state: SalesRowState;
  errors: SalesValidationIssue[];
  warnings: SalesValidationIssue[];
};

export type SalesDryRunContext = {
  /** Normalized client name (trim+lower) → client id. */
  existingClientsByName: Map<string, string>;
  /** Accent-stripped client name → client id (possible duplicate hints). */
  existingClientsByLooseName: Map<string, string>;
  /** Exact serial → watch id. */
  existingSerials: Map<string, string>;
  /** `${reference}|${model}` (trim+lower) → watch ids (possible matches). */
  existingByReferenceModel: Map<string, string[]>;
  /** Existing deal import fingerprints in DB. */
  existingFingerprints: Set<string>;
  /** Fingerprint → first record id within this file/session. */
  fileFingerprintsSeen: Map<string, string>;
  fxRate: number | null;
};

export type SalesDryRunSummary = {
  sessionId: string;
  dryRunVersion: string;
  total: number;
  valid: number;
  warnings: number;
  invalid: number;
  clientsMatched: number;
  clientsProposed: number;
  salesProposed: number;
  exactSerialMatches: number;
  possibleWatchMatches: number;
  duplicates: number;
  totalHistoricalRevenue: number;
  totalHistoricalCost: number;
  totalReportedProfit: number;
  totalCalculatedProfit: number;
  currenciesFound: Array<'MXN' | 'USD'>;
  fxConversions: number;
};

export type SalesCommitResult = {
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  warningCount: number;
  clientsCreated: number;
};

export const ERROR_CODES = {
  IDENTITY_FIELDS_MISSING: 'IDENTITY_FIELDS_MISSING',
  SALE_PRICE_REQUIRED_FOR_COMMIT: 'SALE_PRICE_REQUIRED_FOR_COMMIT',
  INVALID_DATE: 'INVALID_DATE',
  INVALID_CURRENCY: 'INVALID_CURRENCY',
  AMBIGUOUS_NUMBER_FORMAT: 'AMBIGUOUS_NUMBER_FORMAT',
  CONFLICTING_CURRENCY: 'CONFLICTING_CURRENCY',
  INVALID_NUMBER_FORMAT: 'INVALID_NUMBER_FORMAT',
  DUPLICATE_IN_FILE: 'DUPLICATE_IN_FILE',
} as const;

export const WARNING_CODES = {
  PROFIT_MISMATCH: 'PROFIT_MISMATCH',
  NEGATIVE_AMOUNT_REVIEW: 'NEGATIVE_AMOUNT_REVIEW',
  CURRENCY_ASSUMED_MXN: 'CURRENCY_ASSUMED_MXN',
  USD_EXCHANGE_RATE_APPLIED: 'USD_EXCHANGE_RATE_APPLIED',
  CLIENT_POSSIBLE_DUPLICATE: 'CLIENT_POSSIBLE_DUPLICATE',
  WATCH_SERIAL_MATCH: 'WATCH_SERIAL_MATCH',
  WATCH_REFERENCE_MATCH: 'WATCH_REFERENCE_MATCH',
  DUPLICATE_IN_DB: 'DUPLICATE_IN_DB',
  CLIENT_MATCHED: 'CLIENT_MATCHED',
  CLIENT_WILL_BE_CREATED: 'CLIENT_WILL_BE_CREATED',
} as const;
