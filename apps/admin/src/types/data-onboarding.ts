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
  | 'SALES'
  | 'CLIENTS'
  | 'DEALS'
  | 'PAYMENTS'
  | 'EXPENSES'
  | 'ACCOUNTS'
  | 'TREASURY'
  | 'INVESTORS'
  | 'RADAR'
  | 'UNKNOWN';

export type DataImportTarget = 'INVENTORY' | 'SALES';

export type DataImportSession = {
  id: string;
  tenantId: string;
  createdByUserId: string;
  status: DataImportStatus;
  title: string | null;
  importTarget: DataImportTarget;
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

export type SalesImportField =
  | 'saleDate'
  | 'customerName'
  | 'brand'
  | 'model'
  | 'reference'
  | 'serialNumber'
  | 'cost'
  | 'costCurrency'
  | 'salePrice'
  | 'saleCurrency'
  | 'extras'
  | 'extrasCurrency'
  | 'reportedProfit'
  | 'reportedProfitCurrency'
  | 'paymentCount'
  | 'notes'
  | 'currency';

export const SKIP_FIELD = '__skip__' as const;

export type MappingEntry = {
  sourceColumn: string;
  targetField: WatchImportField | SalesImportField | typeof SKIP_FIELD;
};

export type MappingProposal = {
  sourceColumn: string;
  sampleValues: string[];
  suggested: WatchImportField | SalesImportField | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
};

export type MappingResponse = {
  fileId: string;
  mapping: MappingEntry[];
  mappingVersion: string | null;
  proposals: MappingProposal[];
  isProposed: boolean;
};

export type SalesMappingEntry = {
  sourceColumn: string;
  targetField: SalesImportField | typeof SKIP_FIELD;
};

export type SalesMappingResponse = MappingResponse;

export type DryRunSummary = {
  sessionId: string;
  dryRunVersion: string;
  total: number;
  valid: number;
  warnings: number;
  invalid: number;
  duplicates: number;
  /** Sales dry-run extras (present when importTarget=SALES). */
  clientsMatched?: number;
  clientsProposed?: number;
  salesProposed?: number;
  exactSerialMatches?: number;
  possibleWatchMatches?: number;
  totalHistoricalRevenue?: number;
  totalHistoricalCost?: number;
  totalReportedProfit?: number;
  totalCalculatedProfit?: number;
  currenciesFound?: Array<'MXN' | 'USD'>;
  fxConversions?: number;
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
  confidence?: { overall: number } | null;
};

export type HistoricalSalesExtraction = {
  sales: HistoricalSaleExtraction[];
  extractionVersion: string;
  overallConfidence?: number;
};

export type DocumentExtractionResponse = {
  fileId: string;
  extractionState: ExtractionState;
  extraction: InventoryInvoiceExtraction | HistoricalSalesExtraction | null;
  extractionProvider: string | null;
  extractionModel: string | null;
  extractionError: string | null;
  watchCount?: number;
  saleCount?: number;
};

export type SalesDryRunSummary = DryRunSummary & {
  clientsMatched?: number;
  clientsToCreate?: number;
  clientsProposed?: number;
  serialMatches?: number;
  exactSerialMatches?: number;
  possibleWatchMatches?: number;
  salesProposed?: number;
  totalRevenue?: string;
  totalCost?: string;
  totalHistoricalRevenue?: number;
  totalHistoricalCost?: number;
  totalReportedProfit?: string | number;
  totalCalculatedProfit?: string | number;
  currenciesFound?: Array<'MXN' | 'USD'>;
  fxConversions?: number;
};
