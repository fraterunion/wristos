export type DataImportStatus =
  | 'CREATED'
  | 'UPLOADING'
  | 'PROCESSING'
  | 'READY_FOR_REVIEW'
  | 'IMPORTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type DataImportFileStatus = 'UPLOADED' | 'PROCESSING' | 'PARSED' | 'FAILED';

export type DataImportFileType = 'PDF' | 'XLSX' | 'CSV' | 'JSON';

export type DataImportEntityType =
  | 'INVENTORY'
  | 'CLIENTS'
  | 'DEALS'
  | 'PAYMENTS'
  | 'EXPENSES'
  | 'ACCOUNTS'
  | 'TREASURY'
  | 'INVESTORS'
  | 'RADAR'
  | 'UNKNOWN';

export type DataImportSession = {
  id: string;
  tenantId: string;
  createdByUserId: string;
  status: DataImportStatus;
  title: string | null;
  totalFiles: number;
  processedFiles: number;
  totalRows: number;
  validRows: number;
  warningRows: number;
  invalidRows: number;
  importedRows: number;
  dryRunVersion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DataImportFile = {
  id: string;
  sessionId: string;
  originalFilename: string;
  mimeType: string;
  fileType: DataImportFileType;
  byteSize: number;
  checksum: string | null;
  status: DataImportFileStatus;
  detectedEntityType: DataImportEntityType;
  sheetNames: string[] | null;
  rowCount: number;
  classificationMeta: unknown;
  fieldMapping: MappingEntry[] | null;
  mappingVersion: string | null;
  extractionProvider: string | null;
  extractionModel: string | null;
  extractionError: string | null;
  errorMessage: string | null;
  pdfPhase1Message: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DataImportSessionDetail = DataImportSession & {
  files: DataImportFile[];
};

export type DataImportRecord = {
  id: string;
  fileId: string;
  entityType: DataImportEntityType;
  sourceSheet: string | null;
  sourceRowNumber: number | null;
  rawData: Record<string, unknown>;
  normalizedData: unknown;
  validationErrors: unknown;
  validationWarnings: unknown;
  isValid: boolean;
  isSelected: boolean;
  duplicateStatus: string;
  importStatus: string;
  createdAt: string;
};

export type DataImportRecordsPage = {
  page: number;
  limit: number;
  total: number;
  records: DataImportRecord[];
};

// ─── Inventory Import V1 types ───────────────────────────────────────────────

export type WatchImportField =
  | 'brand' | 'model' | 'reference' | 'serialNumber'
  | 'condition' | 'ownershipType' | 'costCurrency' | 'cost'
  | 'priceMin' | 'priceMax' | 'status'
  | 'consignmentOwnerName' | 'consignmentSplitPercentage'
  | 'imageUrl';

export const SKIP_FIELD = '__skip__' as const;

export type MappingEntry = {
  sourceColumn: string;
  targetField: WatchImportField | typeof SKIP_FIELD;
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

export type WatchRowState = 'VALID' | 'WARNING' | 'INVALID';

export type ValidationIssue = {
  code: string;
  field: string;
  message: string;
};

// ─── PDF Invoice Import (Sprint 3) ───────────────────────────────────────────

export type InvoiceMetadata = {
  supplierName?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  currency?: string;
  notes?: string;
};

export type ExtractedWatch = {
  brand?: string;
  model?: string;
  referenceNumber?: string;
  serialNumber?: string;
  condition?: string;
  ownershipType?: string;
  costCurrency?: string;
  purchasePrice?: number;
  askingPriceMin?: number;
  askingPriceMax?: number;
  watchStatus?: string;
  consignmentOwnerName?: string;
  consignmentSplitPercentage?: number;
  imageUrl?: string;
  confidence?: Record<string, number>;
};

export type InventoryInvoiceExtraction = {
  invoice: InvoiceMetadata;
  watches: ExtractedWatch[];
  extractionVersion: string;
  overallConfidence?: number;
};

export type ExtractionState = 'not_processed' | 'processing' | 'failed' | 'corrupt' | 'ready';

export type DocumentExtractionResponse = {
  fileId: string;
  extractionState: ExtractionState;
  extraction: InventoryInvoiceExtraction | null;
  extractionProvider: string | null;
  extractionModel: string | null;
  extractionError: string | null;
  watchCount: number;
};
