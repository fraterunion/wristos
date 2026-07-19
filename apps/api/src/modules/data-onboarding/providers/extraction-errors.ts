/**
 * Typed error hierarchy for document extraction providers.
 *
 * All provider implementations must throw ExtractionError instances so that
 * PdfInvoiceImportService can safely serialize only the code + safeMessage into
 * the database and HTTP response — never raw AI output or Zod validation values.
 */

export enum ExtractionErrorCode {
  /** Timed out waiting for provider response. */
  TIMEOUT = 'EXTRACTION_TIMEOUT',
  /** Provider returned a response that did not match the expected schema. */
  SCHEMA_INVALID = 'EXTRACTION_SCHEMA_INVALID',
  /** Provider returned no usable structured output (tool call absent / empty). */
  NO_TOOL_RESPONSE = 'EXTRACTION_NO_TOOL_RESPONSE',
  /** Document has more pages than the configured limit. */
  PAGE_LIMIT_EXCEEDED = 'EXTRACTION_PAGE_LIMIT_EXCEEDED',
  /** Provider hit max_tokens before completing the response (document too large). */
  OUTPUT_TRUNCATED = 'EXTRACTION_OUTPUT_TRUNCATED',
  /** PDF is password-protected and cannot be read. */
  PDF_ENCRYPTED = 'EXTRACTION_PDF_ENCRYPTED',
  /** PDF bytes are corrupt or unreadable. */
  PDF_CORRUPT = 'EXTRACTION_PDF_CORRUPT',
  /** Any other unclassified provider error. */
  PROVIDER_ERROR = 'EXTRACTION_PROVIDER_ERROR',
}

export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  readonly safeMessage: string;
  readonly debugInfo?: Record<string, unknown>;

  constructor(code: ExtractionErrorCode, safeMessage: string, debugInfo?: Record<string, unknown>) {
    super(safeMessage);
    this.name = 'ExtractionError';
    this.code = code;
    this.safeMessage = safeMessage;
    this.debugInfo = debugInfo;
  }
}

export function isExtractionError(err: unknown): err is ExtractionError {
  return err instanceof ExtractionError;
}

/**
 * Serializes any extraction error into a safe structured object that can be
 * persisted in the database or returned in a HTTP response.
 *
 * IMPORTANT: The returned object MUST NOT contain raw AI response content,
 * Zod offending values, or internal stack traces.
 */
export function buildSafeExtractionRecord(
  err: unknown,
  provider: string,
  model: string,
): {
  code: string;
  category: string;
  safeMessage: string;
  provider: string;
  model: string;
  occurredAt: string;
} {
  const code = isExtractionError(err) ? err.code : ExtractionErrorCode.PROVIDER_ERROR;
  const safeMessage = isExtractionError(err)
    ? err.safeMessage
    : 'Error interno al procesar el documento. Intente de nuevo.';

  const category =
    code === ExtractionErrorCode.TIMEOUT          ? 'timeout' :
    code === ExtractionErrorCode.OUTPUT_TRUNCATED ? 'capacity' :
    code === ExtractionErrorCode.SCHEMA_INVALID   ? 'schema' :
    code === ExtractionErrorCode.NO_TOOL_RESPONSE ? 'schema' :
    code === ExtractionErrorCode.PAGE_LIMIT_EXCEEDED ? 'validation' :
    code === ExtractionErrorCode.PDF_ENCRYPTED    ? 'validation' :
    code === ExtractionErrorCode.PDF_CORRUPT      ? 'validation' :
    'provider';

  return { code, category, safeMessage, provider, model, occurredAt: new Date().toISOString() };
}
