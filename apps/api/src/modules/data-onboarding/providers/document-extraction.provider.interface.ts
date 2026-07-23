import type { InventoryInvoiceExtraction } from '../inventory-import/inventory-invoice-extraction.types';
import type { HistoricalSalesExtractionDocument } from '../sales-import/historical-sale-extraction.types';

export const DOCUMENT_EXTRACTION_PROVIDER = Symbol('DOCUMENT_EXTRACTION_PROVIDER');

export interface DocumentExtractionProvider {
  readonly providerName: string;
  readonly modelId: string;
  extractInventoryInvoice(pdfBuffer: Buffer): Promise<InventoryInvoiceExtraction>;
  extractHistoricalSales(pdfBuffer: Buffer): Promise<HistoricalSalesExtractionDocument>;
}
