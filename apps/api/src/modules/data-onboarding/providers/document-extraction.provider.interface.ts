import type { InventoryInvoiceExtraction } from '../inventory-import/inventory-invoice-extraction.types';

export const DOCUMENT_EXTRACTION_PROVIDER = Symbol('DOCUMENT_EXTRACTION_PROVIDER');

export interface DocumentExtractionProvider {
  readonly providerName: string;
  readonly modelId: string;
  extractInventoryInvoice(pdfBuffer: Buffer): Promise<InventoryInvoiceExtraction>;
}
