import { WatchOwnershipType, WatchStatus } from '@prisma/client';

export const WATCH_IMPORT_FIELDS = [
  'brand',
  'model',
  'reference',
  'serialNumber',
  'condition',
  'ownershipType',
  'costCurrency',
  'cost',
  'priceMin',
  'priceMax',
  'status',
  'consignmentOwnerName',
  'consignmentSplitPercentage',
  'imageUrl',
] as const;

export type WatchImportField = (typeof WATCH_IMPORT_FIELDS)[number];

export const SKIP_FIELD = '__skip__' as const;
export type SkipField = typeof SKIP_FIELD;

export type MappingEntry = {
  sourceColumn: string;
  targetField: WatchImportField | SkipField;
};

export type MappingProposal = {
  sourceColumn: string;
  sampleValues: string[];
  suggested: WatchImportField | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
};

export type MappingResponse = {
  fileId: string;
  mapping: MappingEntry[];
  mappingVersion: string | null;
  proposals: MappingProposal[];
  isProposed: boolean;
};

export type MonetaryParseResult =
  | { status: 'ok'; value: number }
  | { status: 'empty' }
  | { status: 'error'; code: 'AMBIGUOUS_NUMBER_FORMAT' | 'CONFLICTING_CURRENCY' | 'INVALID_NUMBER_FORMAT' };

export type ParseIssue = {
  field: WatchImportField;
  code: string;
};

export type NormalizedWatchRow = {
  brand?: string;
  model?: string;
  reference?: string;
  serialNumber?: string;
  condition?: string;
  ownershipType?: WatchOwnershipType;
  costCurrency?: 'MXN' | 'USD';
  cost?: number;
  costOriginalAmount?: number;
  costExchangeRate?: number;
  priceMin?: number;
  priceMax?: number;
  status?: WatchStatus;
  consignmentOwnerName?: string;
  consignmentSplitPercentage?: number;
  imageUrl?: string;
  /** Structured parse failures (e.g. ambiguous monetary formats) surfaced as validation errors. */
  parseIssues?: ParseIssue[];
};

export type WatchRowState = 'VALID' | 'WARNING' | 'INVALID';

export type ValidationIssue = {
  code: string;
  field: string;
  message: string;
};

export type RowValidationResult = {
  state: WatchRowState;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export type DryRunContext = {
  existingSerials: Set<string>;
  fileSerialsSeen: Map<string, string>;
  fxRate: number | null;
};

export type DryRunSummary = {
  sessionId: string;
  dryRunVersion: string;
  total: number;
  valid: number;
  warnings: number;
  invalid: number;
  duplicates: number;
};

export type CommitResult = {
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  warningCount: number;
};

export type DuplicatePolicy = 'SKIP_DUPLICATES' | 'IMPORT_AS_NEW';
