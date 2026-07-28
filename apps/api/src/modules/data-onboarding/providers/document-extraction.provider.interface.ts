import type { InventoryInvoiceExtraction } from '../inventory-import/inventory-invoice-extraction.types';
import type { HistoricalSalesExtractionDocument } from '../sales-import/historical-sale-extraction.types';

export const DOCUMENT_EXTRACTION_PROVIDER = Symbol('DOCUMENT_EXTRACTION_PROVIDER');

export type HistoricalSalesChunkExtractionResult = {
  document: HistoricalSalesExtractionDocument;
  stopReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  requestId: string | null;
  durationMs: number;
};

export type HistoricalSalesChunkExtractionInput = {
  pdfBuffer: Buffer;
  startPage: number;
  endPage: number;
  maxTokens?: number;
};

export interface DocumentExtractionProvider {
  readonly providerName: string;
  readonly modelId: string;
  extractInventoryInvoice(pdfBuffer: Buffer): Promise<InventoryInvoiceExtraction>;
  extractHistoricalSales(pdfBuffer: Buffer): Promise<HistoricalSalesExtractionDocument>;
  /**
   * Extract sales from a PDF page-range fragment (already split).
   * Optional on older fakes; Claude and Fake implement it for chunked V1.
   */
  extractHistoricalSalesChunk?(
    input: HistoricalSalesChunkExtractionInput,
  ): Promise<HistoricalSalesChunkExtractionResult>;
}
