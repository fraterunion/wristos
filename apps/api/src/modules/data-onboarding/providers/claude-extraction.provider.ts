import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';

import {
  EXTRACT_INVOICE_TOOL_INPUT_SCHEMA,
  InventoryInvoiceExtractionSchema,
  type InventoryInvoiceExtraction,
  resolveMaxTokens,
} from '../inventory-import/inventory-invoice-extraction.types';
import type { DocumentExtractionProvider } from './document-extraction.provider.interface';
import { ExtractionError, ExtractionErrorCode, isExtractionError } from './extraction-errors';
import { INVOICE_EXTRACTION_SYSTEM_PROMPT, INVOICE_EXTRACTION_VERSION } from './prompts/invoice-extraction-v1';

// ─── Configuration helpers ────────────────────────────────────────────────────

/** Default per-request timeout in ms. Override with DOCUMENT_EXTRACTION_TIMEOUT_MS. */
const DEFAULT_TIMEOUT_MS = 90_000;

function resolveTimeoutMs(): number {
  const raw = process.env.DOCUMENT_EXTRACTION_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

// ─── Null stripping (M-04) ────────────────────────────────────────────────────

/**
 * Recursively strips explicit null values from an AI response object before
 * Zod schema validation. LLMs frequently emit null for missing optional fields;
 * Zod .optional() rejects null (only accepts undefined), so this prevents
 * false SCHEMA_INVALID failures.
 *
 * Strips null array elements as well to keep arrays clean.
 */
function stripNullsDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((v) => v !== null).map(stripNullsDeep);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== null) result[k] = stripNullsDeep(v);
    }
    return result;
  }
  return value;
}

// ─── Tool definition ──────────────────────────────────────────────────────────

/** Anthropic tool definition. Input schema mirrors the Zod schema for defence-in-depth. */
const EXTRACT_INVOICE_TOOL: Anthropic.Tool = {
  name: 'extract_invoice',
  description: 'Extracts structured invoice metadata and watch inventory items from a supplier PDF document.',
  input_schema: EXTRACT_INVOICE_TOOL_INPUT_SCHEMA,
};

// ─── Provider ─────────────────────────────────────────────────────────────────

export class ClaudeExtractionProvider implements DocumentExtractionProvider {
  readonly providerName = 'claude';

  private readonly logger = new Logger(ClaudeExtractionProvider.name);
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.timeoutMs = resolveTimeoutMs();
    this.maxTokens = resolveMaxTokens();
  }

  get modelId(): string {
    return this.model;
  }

  async extractInventoryInvoice(pdfBuffer: Buffer): Promise<InventoryInvoiceExtraction> {
    // Stage 1: buffer received
    this.logger.debug(`[stage:buffer_received] model=${this.model} byteLength=${pdfBuffer.byteLength}`);

    const base64 = pdfBuffer.toString('base64');

    // Stage 2: base64 conversion complete
    this.logger.debug(`[stage:base64_complete] base64Length=${base64.length}`);

    // Stage 3: request payload constructed
    this.logger.debug(
      `[stage:payload_constructed] model=${this.model} maxTokens=${this.maxTokens} timeoutMs=${this.timeoutMs} ` +
      `docType=document docSourceType=base64 docMediaType=application/pdf`,
    );

    let response: Anthropic.Message;
    try {
      // Stage 4: messages.create invocation started
      this.logger.debug(`[stage:create_started] model=${this.model}`);

      response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          system: INVOICE_EXTRACTION_SYSTEM_PROMPT,
          tools: [EXTRACT_INVOICE_TOOL],
          tool_choice: { type: 'tool', name: 'extract_invoice' },
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'document',
                  source: { type: 'base64', media_type: 'application/pdf', data: base64 },
                } as Anthropic.DocumentBlockParam,
                {
                  type: 'text',
                  text: 'Extract all inventory items from this supplier invoice document.',
                },
              ],
            },
          ],
        },
        {
          timeout: this.timeoutMs,
          // H-01: disable automatic retries — a timed-out extraction should fail fast,
          // not retry 2 more times (which would triple cost and extend hang by 270 s).
          maxRetries: 0,
        },
      );

      // Stage 5: messages.create response received
      this.logger.debug(
        `[stage:create_complete] stopReason=${response.stop_reason} contentBlocks=${response.content.length}`,
      );
    } catch (err) {
      if (isExtractionError(err)) throw err;

      // Extract safe metadata for logging — never log err.error (raw body) or err.headers.
      const errMeta: Record<string, unknown> = {
        errorClass: err instanceof Error ? err.constructor.name : typeof err,
        errorName: err instanceof Error ? err.name : undefined,
      };
      if (err instanceof Error && 'status' in err) {
        const apiErr = err as { status?: unknown; type?: unknown; requestID?: unknown };
        if (typeof apiErr.status === 'number') errMeta.httpStatus = apiErr.status;
        if (typeof apiErr.type === 'string') errMeta.errorType = apiErr.type;
        if (typeof apiErr.requestID === 'string') errMeta.requestId = apiErr.requestID;
      }
      this.logger.error('[stage:create_failed] messages.create threw an error', errMeta);

      // Classify timeout vs general API failures — never expose err.message to callers
      const isTimeout =
        (err instanceof Error && (
          err.name === 'APIConnectionTimeoutError' ||
          err.message.includes('timed out') ||
          err.message.includes('timeout')
        )) ||
        (err as { status?: number }).status === 408;

      if (isTimeout) {
        throw new ExtractionError(
          ExtractionErrorCode.TIMEOUT,
          `La extracción tardó más de ${Math.round(this.timeoutMs / 1000)} segundos. Intente con un documento más pequeño.`,
          undefined,
          { cause: err },
        );
      }

      throw new ExtractionError(
        ExtractionErrorCode.PROVIDER_ERROR,
        'El servicio de extracción respondió con un error inesperado. Intente de nuevo.',
        undefined,
        { cause: err },
      );
    }

    // H-02: detect output truncation before looking for a tool block.
    // When max_tokens is hit, the JSON is incomplete and no valid tool call exists.
    if (response.stop_reason === 'max_tokens') {
      throw new ExtractionError(
        ExtractionErrorCode.OUTPUT_TRUNCATED,
        'No se pudo completar la extracción porque la factura contiene demasiada información. ' +
        'Divide el documento o reduce el número de artículos e inténtalo nuevamente.',
      );
    }

    // The model MUST call the extract_invoice tool because of tool_choice: { type: 'tool' }
    const toolBlock = response.content.find(
      (c): c is Anthropic.ToolUseBlock => c.type === 'tool_use' && c.name === 'extract_invoice',
    );
    if (!toolBlock) {
      throw new ExtractionError(
        ExtractionErrorCode.NO_TOOL_RESPONSE,
        'El proveedor de extracción no devolvió datos estructurados.',
      );
    }

    // M-04: strip explicit nulls from AI output before schema validation.
    // Zod .optional() accepts undefined but rejects null; LLMs sometimes emit null
    // for missing fields despite the prompt instruction to omit.
    const cleanedInput = stripNullsDeep(toolBlock.input);

    // toolBlock.input is already a parsed JS object — no JSON.parse or regex needed
    const validated = InventoryInvoiceExtractionSchema.safeParse(cleanedInput);
    if (!validated.success) {
      // Log only schema issue paths and counts — never log .input (AI content)
      const issueCount = validated.error.issues.length;
      const issuePaths = validated.error.issues.map((i) => i.path.join('.')).slice(0, 10);
      throw new ExtractionError(
        ExtractionErrorCode.SCHEMA_INVALID,
        'La respuesta de extracción no cumple con el esquema esperado.',
        { issueCount, issuePaths },
      );
    }

    // M-03: server always owns extractionVersion; ignore any value the model returned
    return { ...validated.data, extractionVersion: INVOICE_EXTRACTION_VERSION };
  }
}
