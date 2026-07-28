import {
  IMPORT_STORAGE_ERROR_CODE,
  isImportStorageError,
} from '../storage/import-storage.errors';

/**
 * Typed error hierarchy for document extraction providers.
 *
 * All provider implementations must throw ExtractionError instances so that
 * PdfInvoiceImportService can safely serialize only the code + safeMessage into
 * the database and HTTP response — never raw AI output or Zod validation values.
 *
 * Server logs may include full provider diagnostics via
 * serializeProviderErrorForDiagnostics — that payload must never be returned to
 * HTTP clients or persisted as extractionError.
 *
 * Storage failures use ImportStorageError (IMPORT_STORAGE_ERROR) and must not
 * be remapped to EXTRACTION_PROVIDER_ERROR.
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

  constructor(
    code: ExtractionErrorCode,
    safeMessage: string,
    debugInfo?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(safeMessage, options);
    this.name = 'ExtractionError';
    this.code = code;
    this.safeMessage = safeMessage;
    this.debugInfo = debugInfo;
  }
}

export function isExtractionError(err: unknown): err is ExtractionError {
  return err instanceof ExtractionError;
}

const MAX_DIAGNOSTIC_STRING = 8_000;
const MAX_CAUSE_DEPTH = 6;

function truncateDiagnosticString(value: string, max = MAX_DIAGNOSTIC_STRING): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…[truncated ${value.length - max} chars]`;
}

function serializeHeaders(headers: unknown): Record<string, string> | string | null {
  if (headers == null) return null;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (typeof headers === 'object') {
    try {
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
        if (value == null) continue;
        out[key] = typeof value === 'string' ? value : truncateDiagnosticString(JSON.stringify(value));
      }
      return out;
    } catch {
      return truncateDiagnosticString(String(headers));
    }
  }
  return truncateDiagnosticString(String(headers));
}

function serializeUnknownValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return truncateDiagnosticString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) return serializeErrorLayer(value, depth);
  if (typeof Headers !== 'undefined' && value instanceof Headers) return serializeHeaders(value);
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => serializeUnknownValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    try {
      return JSON.parse(
        truncateDiagnosticString(
          JSON.stringify(value, (_key, v) => {
            if (typeof v === 'bigint') return v.toString();
            if (v instanceof Error) return serializeErrorLayer(v, depth + 1);
            return v;
          }),
        ),
      );
    } catch {
      return truncateDiagnosticString(String(value));
    }
  }
  return truncateDiagnosticString(String(value));
}

function serializeErrorLayer(err: Error, depth: number): Record<string, unknown> {
  const layer: Record<string, unknown> = {
    name: err.name,
    message: truncateDiagnosticString(err.message),
    stack: err.stack ? truncateDiagnosticString(err.stack) : null,
    constructorName: err.constructor?.name ?? null,
  };

  const withExtras = err as Error & {
    status?: unknown;
    type?: unknown;
    requestID?: unknown;
    request_id?: unknown;
    error?: unknown;
    headers?: unknown;
    code?: unknown;
    cause?: unknown;
  };

  if ('status' in withExtras) layer.status = withExtras.status ?? null;
  if ('type' in withExtras) layer.type = withExtras.type ?? null;
  if ('requestID' in withExtras) layer.requestID = withExtras.requestID ?? null;
  if ('request_id' in withExtras) layer.request_id = withExtras.request_id ?? null;
  if ('code' in withExtras && !(err instanceof ExtractionError)) {
    layer.code = withExtras.code ?? null;
  }
  if ('error' in withExtras) layer.errorBody = serializeUnknownValue(withExtras.error, depth + 1);
  if ('headers' in withExtras) layer.headers = serializeHeaders(withExtras.headers);

  for (const key of Object.keys(withExtras)) {
    if (
      key in layer ||
      key === 'error' ||
      key === 'message' ||
      key === 'name' ||
      key === 'stack' ||
      key === 'cause'
    ) {
      continue;
    }
    try {
      layer[key] = serializeUnknownValue((withExtras as unknown as Record<string, unknown>)[key], depth + 1);
    } catch {
      layer[key] = '[unserializable]';
    }
  }

  if (depth < MAX_CAUSE_DEPTH && withExtras.cause !== undefined) {
    layer.cause = serializeUnknownValue(withExtras.cause, depth + 1);
  } else if (depth >= MAX_CAUSE_DEPTH && withExtras.cause !== undefined) {
    layer.cause = '[max cause depth reached]';
  }

  return layer;
}

/**
 * Full provider/SDK error dump for server logs only.
 * Never return this object to HTTP clients or store it as extractionError.
 */
export function serializeProviderErrorForDiagnostics(err: unknown): Record<string, unknown> {
  if (err == null) {
    return { kind: 'nullish', value: err };
  }
  if (err instanceof Error) {
    return {
      kind: 'error',
      ...serializeErrorLayer(err, 0),
    };
  }
  return {
    kind: typeof err,
    value: serializeUnknownValue(err),
  };
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
  if (isImportStorageError(err)) {
    return {
      code: IMPORT_STORAGE_ERROR_CODE,
      category: 'storage',
      safeMessage: err.safeMessage,
      provider,
      model,
      occurredAt: new Date().toISOString(),
    };
  }

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
