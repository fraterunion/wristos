/**
 * Storage-layer errors for import file read/write/delete.
 * Distinct from ExtractionError / EXTRACTION_PROVIDER_ERROR so Cloudinary
 * failures are never mislabeled as Anthropic provider failures.
 */

export const IMPORT_STORAGE_ERROR_CODE = 'IMPORT_STORAGE_ERROR' as const;

export type ImportStorageErrorCode = typeof IMPORT_STORAGE_ERROR_CODE;

export class ImportStorageError extends Error {
  readonly code: ImportStorageErrorCode = IMPORT_STORAGE_ERROR_CODE;
  readonly safeMessage: string;
  /** HTTP status from Cloudinary when available (401/403/404/…). */
  readonly httpStatus?: number;
  /** Safe ops metadata only — never secrets, signed URLs, or file bytes. */
  readonly debugInfo?: Record<string, unknown>;

  constructor(
    safeMessage: string,
    options?: {
      httpStatus?: number;
      debugInfo?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(safeMessage, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ImportStorageError';
    this.safeMessage = safeMessage;
    this.httpStatus = options?.httpStatus;
    this.debugInfo = options?.debugInfo;
  }
}

export function isImportStorageError(err: unknown): err is ImportStorageError {
  return err instanceof ImportStorageError;
}

/** Safe user-facing message for failed import file reads. */
export const IMPORT_STORAGE_READ_SAFE_MESSAGE =
  'No fue posible leer el archivo almacenado. Intenta procesarlo nuevamente o vuelve a subirlo.';
