import type Anthropic from '@anthropic-ai/sdk';

import { ClaudeExtractionProvider } from './claude-extraction.provider';
import { ExtractionError, ExtractionErrorCode } from './extraction-errors';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_EXTRACTION_INPUT = {
  invoice: { supplierName: 'Test Supplier', currency: 'MXN' },
  watches: [
    { brand: 'Rolex', model: 'Submariner', purchasePrice: 50000, costCurrency: 'MXN' },
  ],
  extractionVersion: 'v1',
  overallConfidence: 0.95,
};

function makeToolUseResponse(input: unknown, stopReason = 'tool_use'): Partial<Anthropic.Message> {
  return {
    id: 'msg-test',
    type: 'message',
    role: 'assistant',
    stop_reason: stopReason as Anthropic.Message['stop_reason'],
    content: [
      { type: 'tool_use', id: 'call-1', name: 'extract_invoice', input } as Anthropic.ToolUseBlock,
    ],
  };
}

function makeTextResponse(): Partial<Anthropic.Message> {
  return {
    id: 'msg-test',
    type: 'message',
    role: 'assistant',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'I cannot extract that.' } as Anthropic.TextBlock],
  };
}

function makeMaxTokensResponse(): Partial<Anthropic.Message> {
  return {
    id: 'msg-test',
    type: 'message',
    role: 'assistant',
    stop_reason: 'max_tokens',
    content: [{ type: 'text', text: '' } as Anthropic.TextBlock],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ClaudeExtractionProvider', () => {
  let provider: ClaudeExtractionProvider;
  let mockCreate: jest.Mock;

  beforeEach(() => {
    provider = new ClaudeExtractionProvider('test-api-key', 'claude-test-model');
    mockCreate = jest.fn();
    // Replace the private client with a controlled stub
    (provider as unknown as Record<string, unknown>).client = { messages: { create: mockCreate } };
  });

  afterEach(() => jest.clearAllMocks());

  // ─── Basic happy path ─────────────────────────────────────────────────────

  it('returns parsed extraction data on a valid tool response', async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse(VALID_EXTRACTION_INPUT));

    const result = await provider.extractInventoryInvoice(Buffer.from('%PDF-test'));
    expect(result.watches).toHaveLength(1);
    expect(result.watches[0].brand).toBe('Rolex');
    expect(result.extractionVersion).toBeDefined();
  });

  it('always sets extractionVersion to the server constant, ignoring any model-provided value (M-03)', async () => {
    const inputWithDifferentVersion = { ...VALID_EXTRACTION_INPUT, extractionVersion: 'v99-model-provided' };
    mockCreate.mockResolvedValue(makeToolUseResponse(inputWithDifferentVersion));

    const result = await provider.extractInventoryInvoice(Buffer.from('%PDF-test'));
    expect(result.extractionVersion).toBe('v1');
    expect(result.extractionVersion).not.toBe('v99-model-provided');
  });

  it('succeeds when model omits extractionVersion (M-03)', async () => {
    const { extractionVersion: _, ...inputWithoutVersion } = VALID_EXTRACTION_INPUT;
    mockCreate.mockResolvedValue(makeToolUseResponse(inputWithoutVersion));

    const result = await provider.extractInventoryInvoice(Buffer.from('%PDF-test'));
    expect(result.extractionVersion).toBe('v1');
  });

  // ─── H-01: maxRetries must be 0 ──────────────────────────────────────────

  it('passes maxRetries: 0 to every request (H-01)', async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse(VALID_EXTRACTION_INPUT));

    await provider.extractInventoryInvoice(Buffer.from('%PDF-test'));

    const callOptions = mockCreate.mock.calls[0][1] as { maxRetries: number; timeout: number };
    expect(callOptions.maxRetries).toBe(0);
  });

  it('passes timeout to every request (H-01)', async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse(VALID_EXTRACTION_INPUT));

    await provider.extractInventoryInvoice(Buffer.from('%PDF-test'));

    const callOptions = mockCreate.mock.calls[0][1] as { maxRetries: number; timeout: number };
    expect(typeof callOptions.timeout).toBe('number');
    expect(callOptions.timeout).toBeGreaterThan(0);
  });

  it('makes exactly one API call even when the first call times out (H-01)', async () => {
    const timeoutErr = Object.assign(new Error('connection timed out'), { name: 'APIConnectionTimeoutError' });
    mockCreate.mockRejectedValue(timeoutErr);

    await provider.extractInventoryInvoice(Buffer.from('%PDF-')).catch(() => null);

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  // ─── H-02: max_tokens and stop_reason=max_tokens ─────────────────────────

  it('passes max_tokens in the request body (H-02)', async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse(VALID_EXTRACTION_INPUT));

    await provider.extractInventoryInvoice(Buffer.from('%PDF-test'));

    const requestBody = mockCreate.mock.calls[0][0] as { max_tokens: number };
    expect(typeof requestBody.max_tokens).toBe('number');
    expect(requestBody.max_tokens).toBeGreaterThanOrEqual(4096);
  });

  it('throws ExtractionError(OUTPUT_TRUNCATED) when stop_reason is max_tokens (H-02)', async () => {
    mockCreate.mockResolvedValue(makeMaxTokensResponse());

    const caught = await provider.extractInventoryInvoice(Buffer.from('%PDF-')).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ExtractionError);
    expect((caught as ExtractionError).code).toBe(ExtractionErrorCode.OUTPUT_TRUNCATED);
    expect((caught as ExtractionError).safeMessage).toMatch(/demasiada información/);
  });

  // ─── Timeout errors ───────────────────────────────────────────────────────

  it('throws ExtractionError(TIMEOUT) when the API error name is APIConnectionTimeoutError', async () => {
    const err = Object.assign(new Error('connection timed out'), { name: 'APIConnectionTimeoutError' });
    mockCreate.mockRejectedValue(err);

    const caught = await provider.extractInventoryInvoice(Buffer.from('%PDF-')).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ExtractionError);
    expect((caught as ExtractionError).code).toBe(ExtractionErrorCode.TIMEOUT);
    // Raw error message must not appear in the safe message
    expect((caught as ExtractionError).safeMessage).not.toContain('connection timed out');
  });

  it('throws ExtractionError(TIMEOUT) when error message contains "timeout"', async () => {
    mockCreate.mockRejectedValue(new Error('Request timeout after 90000ms'));

    const caught = await provider.extractInventoryInvoice(Buffer.from('%PDF-')).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ExtractionError);
    expect((caught as ExtractionError).code).toBe(ExtractionErrorCode.TIMEOUT);
  });

  // ─── Provider error sanitization ─────────────────────────────────────────

  it('throws ExtractionError(PROVIDER_ERROR) for a generic API failure and does not expose the original message', async () => {
    const sensitiveMessage = 'Internal server error: GPU load failed — sensitive detail';
    mockCreate.mockRejectedValue(new Error(sensitiveMessage));

    const caught = await provider.extractInventoryInvoice(Buffer.from('%PDF-')).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ExtractionError);
    expect((caught as ExtractionError).code).toBe(ExtractionErrorCode.PROVIDER_ERROR);
    expect((caught as ExtractionError).safeMessage).not.toContain(sensitiveMessage);
  });

  // ─── Structural failures ─────────────────────────────────────────────────

  it('throws ExtractionError(NO_TOOL_RESPONSE) when the response contains no tool_use block', async () => {
    mockCreate.mockResolvedValue(makeTextResponse());

    const caught = await provider.extractInventoryInvoice(Buffer.from('%PDF-')).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ExtractionError);
    expect((caught as ExtractionError).code).toBe(ExtractionErrorCode.NO_TOOL_RESPONSE);
  });

  it('throws ExtractionError(SCHEMA_INVALID) when tool input does not match the schema', async () => {
    // 'watches' must be an array, not a string
    mockCreate.mockResolvedValue(makeToolUseResponse({ invoice: {}, watches: 'invalid', extractionVersion: 'v1' }));

    const caught = await provider.extractInventoryInvoice(Buffer.from('%PDF-')).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ExtractionError);
    expect((caught as ExtractionError).code).toBe(ExtractionErrorCode.SCHEMA_INVALID);
    // debugInfo carries issue paths, but safeMessage must not expose raw AI content
    const debug = (caught as ExtractionError).debugInfo;
    expect(debug?.issueCount).toBeGreaterThan(0);
    expect((caught as ExtractionError).safeMessage).not.toContain('invalid');
  });

  // ─── M-04: null stripping ─────────────────────────────────────────────────

  it('accepts null optional fields without throwing SCHEMA_INVALID (M-04)', async () => {
    // LLMs sometimes return explicit null for missing optional fields
    const inputWithNulls = {
      invoice: { supplierName: 'Test Supplier', currency: null, notes: null },
      watches: [
        {
          brand: 'Rolex',
          model: null,
          referenceNumber: null,
          purchasePrice: 50000,
          costCurrency: 'MXN',
          watchStatus: null,
          confidence: null,
        },
      ],
      extractionVersion: 'v1',
      overallConfidence: null,
    };
    mockCreate.mockResolvedValue(makeToolUseResponse(inputWithNulls));

    const result = await provider.extractInventoryInvoice(Buffer.from('%PDF-test'));
    expect(result.watches).toHaveLength(1);
    expect(result.watches[0].brand).toBe('Rolex');
    // Null fields should have been stripped
    expect(result.watches[0].model).toBeUndefined();
    expect(result.invoice.currency).toBeUndefined();
  });

  it('treats a null watch array element as a stripped entry (M-04)', async () => {
    const inputWithNullWatch = {
      invoice: {},
      watches: [
        { brand: 'Rolex', purchasePrice: 50000, costCurrency: 'MXN' },
        null,
        { brand: 'Omega', purchasePrice: 80000, costCurrency: 'MXN' },
      ],
      extractionVersion: 'v1',
    };
    mockCreate.mockResolvedValue(makeToolUseResponse(inputWithNullWatch));

    const result = await provider.extractInventoryInvoice(Buffer.from('%PDF-test'));
    expect(result.watches).toHaveLength(2);
    expect(result.watches[0].brand).toBe('Rolex');
    expect(result.watches[1].brand).toBe('Omega');
  });

  // ─── tool_choice verification ─────────────────────────────────────────────

  it('calls messages.create with tool_choice: { type: "tool", name: "extract_invoice" }', async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse(VALID_EXTRACTION_INPUT));

    await provider.extractInventoryInvoice(Buffer.from('%PDF-test'));

    const callArgs = mockCreate.mock.calls[0][0] as { tool_choice: Anthropic.ToolChoiceTool };
    expect(callArgs.tool_choice).toEqual({ type: 'tool', name: 'extract_invoice' });
  });

  // ─── PDF document block (production request construction) ─────────────────

  it('sends exactly one messages.create call with the PDF as a base64 document block', async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse(VALID_EXTRACTION_INPUT));
    const pdfBuffer = Buffer.from('%PDF-1.4 test invoice bytes');

    await provider.extractInventoryInvoice(pdfBuffer);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const body = mockCreate.mock.calls[0][0] as Anthropic.MessageCreateParamsNonStreaming;

    // First user message
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');

    const content = body.messages[0].content as Anthropic.ContentBlockParam[];
    expect(content).toHaveLength(2);

    // First content block must be the PDF document
    const docBlock = content[0] as Anthropic.DocumentBlockParam;
    expect(docBlock.type).toBe('document');
    expect(docBlock.source.type).toBe('base64');
    expect((docBlock.source as Anthropic.Base64PDFSource).media_type).toBe('application/pdf');
    expect((docBlock.source as Anthropic.Base64PDFSource).data).toBe(pdfBuffer.toString('base64'));

    // Second content block must be the extraction instruction text
    const textBlock = content[1] as Anthropic.TextBlockParam;
    expect(textBlock.type).toBe('text');
    expect(typeof textBlock.text).toBe('string');
    expect(textBlock.text.length).toBeGreaterThan(0);
  });

  it('sends the tool input_schema as a plain JSON Schema object (not a Zod schema)', async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse(VALID_EXTRACTION_INPUT));

    await provider.extractInventoryInvoice(Buffer.from('%PDF-test'));

    const body = mockCreate.mock.calls[0][0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools).toHaveLength(1);

    const tool = body.tools![0] as Anthropic.Tool;
    expect(tool.name).toBe('extract_invoice');
    expect(tool.input_schema.type).toBe('object');
    // Must be a plain object — not a Zod schema (which would have a .parse method)
    expect(typeof (tool.input_schema as unknown as { parse?: unknown }).parse).not.toBe('function');
  });

  // ─── Error cause preservation ─────────────────────────────────────────────

  it('preserves the original SDK error as ExtractionError.cause on PROVIDER_ERROR', async () => {
    const originalErr = new Error('SDK internal error');
    mockCreate.mockRejectedValue(originalErr);

    const caught = await provider.extractInventoryInvoice(Buffer.from('%PDF-')).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ExtractionError);
    expect((caught as ExtractionError).code).toBe(ExtractionErrorCode.PROVIDER_ERROR);
    expect((caught as ExtractionError).cause).toBe(originalErr);
  });

  it('preserves the original SDK error as ExtractionError.cause on TIMEOUT', async () => {
    const timeoutErr = Object.assign(new Error('Request timed out'), { name: 'APIConnectionTimeoutError' });
    mockCreate.mockRejectedValue(timeoutErr);

    const caught = await provider.extractInventoryInvoice(Buffer.from('%PDF-')).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ExtractionError);
    expect((caught as ExtractionError).code).toBe(ExtractionErrorCode.TIMEOUT);
    expect((caught as ExtractionError).cause).toBe(timeoutErr);
  });

  // ─── Historical sales extraction ──────────────────────────────────────────

  it('extractHistoricalSales uses extract_historical_sales tool and schema', async () => {
    const salesInput = {
      sales: [
        {
          saleDate: '2026-03-15',
          brand: 'Rolex',
          model: 'Submariner',
          salePrice: 150000,
          saleCurrency: 'MXN',
        },
      ],
      overallConfidence: 0.9,
    };
    mockCreate.mockResolvedValue({
      id: 'msg-sales',
      type: 'message',
      role: 'assistant',
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 'call-sales', name: 'extract_historical_sales', input: salesInput },
      ],
    });

    const result = await provider.extractHistoricalSales(Buffer.from('%PDF-test'));
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].brand).toBe('Rolex');
    expect(result.extractionVersion).toBe('v1');

    const requestBody = mockCreate.mock.calls[0][0] as {
      tools: Array<{ name: string; input_schema: { type: string; required?: string[] } }>;
      tool_choice: { type: string; name: string };
    };
    expect(requestBody.tool_choice).toEqual({ type: 'tool', name: 'extract_historical_sales' });
    expect(requestBody.tools).toHaveLength(1);
    expect(requestBody.tools[0].name).toBe('extract_historical_sales');
    expect(requestBody.tools[0].input_schema.type).toBe('object');
    expect(requestBody.tools[0].input_schema.required).toContain('sales');
  });

  it('extractHistoricalSales passes maxRetries: 0', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-sales',
      type: 'message',
      role: 'assistant',
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'call-sales',
          name: 'extract_historical_sales',
          input: { sales: [], overallConfidence: 1 },
        },
      ],
    });

    await provider.extractHistoricalSales(Buffer.from('%PDF-test'));
    const callOptions = mockCreate.mock.calls[0][1] as { maxRetries: number };
    expect(callOptions.maxRetries).toBe(0);
  });
});
