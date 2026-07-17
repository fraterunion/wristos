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
  invalidRows: number;
  importedRows: number;
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
