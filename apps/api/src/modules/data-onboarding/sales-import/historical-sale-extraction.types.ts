import { z } from 'zod';

import { HistoricalSaleExtraction } from './historical-sale.types';

// ─── Capacity constants ───────────────────────────────────────────────────────

/** Maximum sales the AI may return per document. Matches tool schema maxItems. */
export const MAX_EXTRACTED_SALES = 200;

export function resolveSalesMaxTokens(): number {
  const raw = process.env.DOCUMENT_EXTRACTION_MAX_TOKENS;
  if (!raw) return 8192;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1024 || n > 16000) return 8192;
  return n;
}

const MAX_SHORT = 150;
const MAX_MED = 200;
const MAX_LONG = 2000;
export const MAX_SALE_AMOUNT = 100_000_000;

const moneyField = () => z.number().min(-MAX_SALE_AMOUNT).max(MAX_SALE_AMOUNT).optional().nullable();
const currencyField = () => z.enum(['MXN', 'USD']).optional().nullable();

export const ExtractedHistoricalSaleSchema = z.object({
  sourceRow: z.number().int().optional().nullable(),
  saleDate: z.string().max(50).optional().nullable(),
  customerName: z.string().max(MAX_MED).optional().nullable(),

  brand: z.string().max(MAX_SHORT).optional().nullable(),
  model: z.string().max(MAX_SHORT).optional().nullable(),
  reference: z.string().max(MAX_SHORT).optional().nullable(),
  serialNumber: z.string().max(MAX_SHORT).optional().nullable(),

  cost: moneyField(),
  costCurrency: currencyField(),

  salePrice: moneyField(),
  saleCurrency: currencyField(),

  extras: moneyField(),
  extrasCurrency: currencyField(),

  reportedProfit: moneyField(),
  reportedProfitCurrency: currencyField(),

  paymentCount: z.number().int().min(0).max(1000).optional().nullable(),
  notes: z.string().max(MAX_LONG).optional().nullable(),

  confidence: z
    .object({
      overall: z.number().min(0).max(1),
      saleDate: z.number().min(0).max(1).optional().nullable(),
      customerName: z.number().min(0).max(1).optional().nullable(),
      brand: z.number().min(0).max(1).optional().nullable(),
      model: z.number().min(0).max(1).optional().nullable(),
      reference: z.number().min(0).max(1).optional().nullable(),
      serialNumber: z.number().min(0).max(1).optional().nullable(),
      cost: z.number().min(0).max(1).optional().nullable(),
      salePrice: z.number().min(0).max(1).optional().nullable(),
      extras: z.number().min(0).max(1).optional().nullable(),
      reportedProfit: z.number().min(0).max(1).optional().nullable(),
    })
    .optional()
    .nullable(),
});

export const HistoricalSalesExtractionSchema = z.object({
  sales: z.array(ExtractedHistoricalSaleSchema).max(MAX_EXTRACTED_SALES),
  extractionVersion: z.string().optional(),
  overallConfidence: z.number().min(0).max(1).optional(),
});

export type ExtractedHistoricalSale = z.infer<typeof ExtractedHistoricalSaleSchema>;
export type HistoricalSalesExtractionDocument = z.infer<typeof HistoricalSalesExtractionSchema>;

/** Bridged row stored as DataImportRecord.rawData (SalesImportField names). */
export type BridgedHistoricalSaleRow = {
  saleDate?: string;
  customerName?: string;
  brand?: string;
  model?: string;
  reference?: string;
  serialNumber?: string;
  cost?: number;
  costCurrency?: string;
  salePrice?: number;
  saleCurrency?: string;
  extras?: number;
  extrasCurrency?: string;
  reportedProfit?: number;
  reportedProfitCurrency?: string;
  paymentCount?: number;
  notes?: string;
  _confidence?: Record<string, number | null | undefined>;
  _sourceRow?: number | null;
};

export function bridgeExtractedHistoricalSale(sale: ExtractedHistoricalSale): BridgedHistoricalSaleRow {
  return {
    saleDate: sale.saleDate ?? undefined,
    customerName: sale.customerName ?? undefined,
    brand: sale.brand ?? undefined,
    model: sale.model ?? undefined,
    reference: sale.reference ?? undefined,
    serialNumber: sale.serialNumber ?? undefined,
    cost: sale.cost ?? undefined,
    costCurrency: sale.costCurrency ?? undefined,
    salePrice: sale.salePrice ?? undefined,
    saleCurrency: sale.saleCurrency ?? undefined,
    extras: sale.extras ?? undefined,
    extrasCurrency: sale.extrasCurrency ?? undefined,
    reportedProfit: sale.reportedProfit ?? undefined,
    reportedProfitCurrency: sale.reportedProfitCurrency ?? undefined,
    paymentCount: sale.paymentCount ?? undefined,
    notes: sale.notes ?? undefined,
    _confidence: sale.confidence ?? undefined,
    _sourceRow: sale.sourceRow ?? null,
  };
}

/** Identity mapping from bridged rawData keys → SalesImportField targets. */
export const SALES_IDENTITY_MAPPING = [
  { sourceColumn: 'saleDate', targetField: 'saleDate' },
  { sourceColumn: 'customerName', targetField: 'customerName' },
  { sourceColumn: 'brand', targetField: 'brand' },
  { sourceColumn: 'model', targetField: 'model' },
  { sourceColumn: 'reference', targetField: 'reference' },
  { sourceColumn: 'serialNumber', targetField: 'serialNumber' },
  { sourceColumn: 'cost', targetField: 'cost' },
  { sourceColumn: 'costCurrency', targetField: 'costCurrency' },
  { sourceColumn: 'salePrice', targetField: 'salePrice' },
  { sourceColumn: 'saleCurrency', targetField: 'saleCurrency' },
  { sourceColumn: 'extras', targetField: 'extras' },
  { sourceColumn: 'extrasCurrency', targetField: 'extrasCurrency' },
  { sourceColumn: 'reportedProfit', targetField: 'reportedProfit' },
  { sourceColumn: 'reportedProfitCurrency', targetField: 'reportedProfitCurrency' },
  { sourceColumn: 'paymentCount', targetField: 'paymentCount' },
  { sourceColumn: 'notes', targetField: 'notes' },
] as const;

/** Coerce validated extraction into the sprint HistoricalSaleExtraction shape. */
export function toHistoricalSaleExtraction(sale: ExtractedHistoricalSale): HistoricalSaleExtraction {
  return {
    sourceRow: sale.sourceRow ?? null,
    saleDate: sale.saleDate ?? null,
    customerName: sale.customerName ?? null,
    brand: sale.brand ?? null,
    model: sale.model ?? null,
    reference: sale.reference ?? null,
    serialNumber: sale.serialNumber ?? null,
    cost: sale.cost ?? null,
    costCurrency: sale.costCurrency ?? null,
    salePrice: sale.salePrice ?? null,
    saleCurrency: sale.saleCurrency ?? null,
    extras: sale.extras ?? null,
    extrasCurrency: sale.extrasCurrency ?? null,
    reportedProfit: sale.reportedProfit ?? null,
    reportedProfitCurrency: sale.reportedProfitCurrency ?? null,
    paymentCount: sale.paymentCount ?? null,
    notes: sale.notes ?? null,
    confidence: sale.confidence ?? null,
  };
}

export const EXTRACT_HISTORICAL_SALES_TOOL_INPUT_SCHEMA = {
  type: 'object' as const,
  required: ['sales'],
  properties: {
    sales: {
      type: 'array',
      maxItems: MAX_EXTRACTED_SALES,
      items: {
        type: 'object',
        properties: {
          sourceRow: { type: 'integer' },
          saleDate: { type: 'string', maxLength: 50 },
          customerName: { type: 'string', maxLength: MAX_MED },
          brand: { type: 'string', maxLength: MAX_SHORT },
          model: { type: 'string', maxLength: MAX_SHORT },
          reference: { type: 'string', maxLength: MAX_SHORT },
          serialNumber: { type: 'string', maxLength: MAX_SHORT },
          cost: { type: 'number', minimum: -MAX_SALE_AMOUNT, maximum: MAX_SALE_AMOUNT },
          costCurrency: { type: 'string', enum: ['MXN', 'USD'] },
          salePrice: { type: 'number', minimum: -MAX_SALE_AMOUNT, maximum: MAX_SALE_AMOUNT },
          saleCurrency: { type: 'string', enum: ['MXN', 'USD'] },
          extras: { type: 'number', minimum: -MAX_SALE_AMOUNT, maximum: MAX_SALE_AMOUNT },
          extrasCurrency: { type: 'string', enum: ['MXN', 'USD'] },
          reportedProfit: { type: 'number', minimum: -MAX_SALE_AMOUNT, maximum: MAX_SALE_AMOUNT },
          reportedProfitCurrency: { type: 'string', enum: ['MXN', 'USD'] },
          paymentCount: { type: 'integer', minimum: 0, maximum: 1000 },
          notes: { type: 'string', maxLength: MAX_LONG },
          confidence: {
            type: 'object',
            required: ['overall'],
            properties: {
              overall: { type: 'number', minimum: 0, maximum: 1 },
              saleDate: { type: 'number', minimum: 0, maximum: 1 },
              customerName: { type: 'number', minimum: 0, maximum: 1 },
              brand: { type: 'number', minimum: 0, maximum: 1 },
              model: { type: 'number', minimum: 0, maximum: 1 },
              reference: { type: 'number', minimum: 0, maximum: 1 },
              serialNumber: { type: 'number', minimum: 0, maximum: 1 },
              cost: { type: 'number', minimum: 0, maximum: 1 },
              salePrice: { type: 'number', minimum: 0, maximum: 1 },
              extras: { type: 'number', minimum: 0, maximum: 1 },
              reportedProfit: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
        },
      },
    },
    extractionVersion: { type: 'string' },
    overallConfidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};
