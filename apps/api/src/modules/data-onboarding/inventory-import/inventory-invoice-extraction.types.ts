import { z } from 'zod';

// ─── Capacity constants ───────────────────────────────────────────────────────

/** Maximum watches the AI may return per invoice (H-02). Matches tool schema maxItems. */
export const MAX_EXTRACTED_WATCHES = 50;

/** Soft alias kept for any old references. */
export const MAX_WATCHES_PER_INVOICE = MAX_EXTRACTED_WATCHES;

/**
 * Maximum output tokens for the extraction request.
 * Configurable via DOCUMENT_EXTRACTION_MAX_TOKENS; default 8192.
 * Valid range: 1024–16000 (bounded in resolveMaxTokens).
 */
export function resolveMaxTokens(): number {
  const raw = process.env.DOCUMENT_EXTRACTION_MAX_TOKENS;
  if (!raw) return 8192;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1024 || n > 16000) return 8192;
  return n;
}

// ─── Field length bounds ──────────────────────────────────────────────────────

const MAX_SHORT = 150;  // brand, model, reference, serial
const MAX_MED   = 200;  // condition, supplier name
const MAX_LONG  = 2000; // notes, accessories
const MAX_URL   = 500;

// ─── Monetary bounds (L-01) ──────────────────────────────────────────────────

/** Absolute maximum for any single monetary field (covers high-value complications). */
export const MAX_WATCH_PRICE = 100_000_000;

// ─── Image URL schema (M-02) — HTTPS only ────────────────────────────────────

const SafeImageUrlSchema = z
  .string()
  .max(MAX_URL)
  .url()
  .refine(
    (url) => {
      try {
        return new URL(url).protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Only HTTPS image URLs are allowed' },
  )
  .optional();

// ─── Monetary field helper ────────────────────────────────────────────────────

const moneyField = () => z.number().min(0).max(MAX_WATCH_PRICE).optional();

// ─── Invoice metadata schema ──────────────────────────────────────────────────

export const InvoiceMetadataSchema = z.object({
  supplierName:  z.string().max(MAX_MED).optional(),
  invoiceNumber: z.string().max(100).optional(),
  invoiceDate:   z.string().max(50).optional(),
  currency:      z.string().max(20).optional(),
  subtotal:      moneyField(),
  taxes:         moneyField(),
  shipping:      moneyField(),
  total:         moneyField(),
  notes:         z.string().max(MAX_LONG).optional(),
});

// ─── Per-watch schema ─────────────────────────────────────────────────────────

export const ExtractedWatchSchema = z.object({
  brand:          z.string().max(MAX_SHORT).optional(),
  model:          z.string().max(MAX_SHORT).optional(),
  referenceNumber: z.string().max(MAX_SHORT).optional(),
  serialNumber:   z.string().max(MAX_SHORT).optional(),
  year:           z.number().int().min(1800).max(2100).optional(),
  condition:      z.string().max(MAX_MED).optional(),

  // L-03: enum-constrained fields aligned to production Prisma enums
  ownershipType:  z.enum(['OWNED', 'CONSIGNMENT']).optional(),
  costCurrency:   z.enum(['MXN', 'USD']).optional(),
  watchStatus:    z.enum(['AVAILABLE', 'RESERVED', 'SOLD', 'IN_TRANSIT', 'IN_SERVICE']).optional(),

  // L-01: price fields bounded + min ≤ max enforced below via superRefine
  purchasePrice:  moneyField(),
  askingPriceMin: moneyField(),
  askingPriceMax: moneyField(),

  box:          z.boolean().optional(),
  papers:       z.boolean().optional(),
  accessories:  z.string().max(MAX_LONG).optional(),
  notes:        z.string().max(MAX_LONG).optional(),

  consignmentOwnerName:       z.string().max(MAX_MED).optional(),
  consignmentSplitPercentage: z.number().min(0).max(100).optional(),

  imageUrl:   SafeImageUrlSchema,
  confidence: z.record(z.string(), z.number().min(0).max(1)).optional(),
}).superRefine((w, ctx) => {
  // L-01: askingPriceMin must not exceed askingPriceMax
  if (w.askingPriceMin != null && w.askingPriceMax != null && w.askingPriceMin > w.askingPriceMax) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'askingPriceMin must be ≤ askingPriceMax',
      path: ['askingPriceMin'],
    });
  }
});

// ─── Top-level extraction schema ──────────────────────────────────────────────

export const InventoryInvoiceExtractionSchema = z.object({
  invoice:           InvoiceMetadataSchema,
  watches:           z.array(ExtractedWatchSchema).max(MAX_EXTRACTED_WATCHES),
  // M-03: extractionVersion is server-owned; the AI need not supply it
  extractionVersion: z.string().optional(),
  overallConfidence: z.number().min(0).max(1).optional(),
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type InvoiceMetadata          = z.infer<typeof InvoiceMetadataSchema>;
export type ExtractedWatch           = z.infer<typeof ExtractedWatchSchema>;
export type InventoryInvoiceExtraction = z.infer<typeof InventoryInvoiceExtractionSchema>;

/** Describes what state the extraction data is in for a PDF session. */
export type ExtractionState =
  | 'not_processed'
  | 'processing'
  | 'failed'
  | 'corrupt'
  | 'ready';

// ─── Bridge ──────────────────────────────────────────────────────────────────

/** AI field names bridged to WatchImportField names for the staged rawData record. */
export type BridgedWatchRow = {
  brand?: string;
  model?: string;
  reference?: string;
  serialNumber?: string;
  year?: number;
  condition?: string;
  ownershipType?: string;
  costCurrency?: string;
  cost?: number;
  priceMin?: number;
  priceMax?: number;
  status?: string;
  box?: boolean;
  papers?: boolean;
  accessories?: string;
  notes?: string;
  consignmentOwnerName?: string;
  consignmentSplitPercentage?: number;
  imageUrl?: string;
  _confidence?: Record<string, number>;
};

/** Renames AI field names to WatchImportField names. */
export function bridgeExtractedWatch(watch: ExtractedWatch): BridgedWatchRow {
  return {
    brand:                      watch.brand,
    model:                      watch.model,
    reference:                  watch.referenceNumber,
    serialNumber:               watch.serialNumber,
    year:                       watch.year,
    condition:                  watch.condition,
    ownershipType:              watch.ownershipType,
    costCurrency:               watch.costCurrency,
    cost:                       watch.purchasePrice,
    priceMin:                   watch.askingPriceMin,
    priceMax:                   watch.askingPriceMax,
    status:                     watch.watchStatus,
    box:                        watch.box,
    papers:                     watch.papers,
    accessories:                watch.accessories,
    notes:                      watch.notes,
    consignmentOwnerName:       watch.consignmentOwnerName,
    consignmentSplitPercentage: watch.consignmentSplitPercentage,
    imageUrl:                   watch.imageUrl,
    _confidence:                watch.confidence,
  };
}

// ─── Identity Mapping ─────────────────────────────────────────────────────────

export const PDF_IDENTITY_MAPPING = [
  { sourceColumn: 'brand',                      targetField: 'brand' },
  { sourceColumn: 'model',                      targetField: 'model' },
  { sourceColumn: 'reference',                  targetField: 'reference' },
  { sourceColumn: 'serialNumber',               targetField: 'serialNumber' },
  { sourceColumn: 'year',                       targetField: 'year' },
  { sourceColumn: 'condition',                  targetField: 'condition' },
  { sourceColumn: 'ownershipType',              targetField: 'ownershipType' },
  { sourceColumn: 'costCurrency',               targetField: 'costCurrency' },
  { sourceColumn: 'cost',                       targetField: 'cost' },
  { sourceColumn: 'priceMin',                   targetField: 'priceMin' },
  { sourceColumn: 'priceMax',                   targetField: 'priceMax' },
  { sourceColumn: 'status',                     targetField: 'status' },
  { sourceColumn: 'box',                        targetField: 'box' },
  { sourceColumn: 'papers',                     targetField: 'papers' },
  { sourceColumn: 'accessories',                targetField: 'accessories' },
  { sourceColumn: 'notes',                      targetField: 'notes' },
  { sourceColumn: 'consignmentOwnerName',       targetField: 'consignmentOwnerName' },
  { sourceColumn: 'consignmentSplitPercentage', targetField: 'consignmentSplitPercentage' },
  { sourceColumn: 'imageUrl',                   targetField: 'imageUrl' },
] as const;

// ─── Tool schema (shared with provider) ──────────────────────────────────────

/**
 * JSON Schema for the Anthropic tool input_schema.
 * Bounds must mirror the Zod schema for defence-in-depth at the model layer.
 */
export const EXTRACT_INVOICE_TOOL_INPUT_SCHEMA = {
  type: 'object' as const,
  // M-03: extractionVersion removed from required — server always assigns it
  required: ['invoice', 'watches'],
  properties: {
    invoice: {
      type: 'object',
      properties: {
        supplierName:  { type: 'string', maxLength: MAX_MED },
        invoiceNumber: { type: 'string', maxLength: 100 },
        invoiceDate:   { type: 'string', maxLength: 50 },
        currency:      { type: 'string', maxLength: 20 },
        subtotal:      { type: 'number', minimum: 0, maximum: MAX_WATCH_PRICE },
        taxes:         { type: 'number', minimum: 0, maximum: MAX_WATCH_PRICE },
        shipping:      { type: 'number', minimum: 0, maximum: MAX_WATCH_PRICE },
        total:         { type: 'number', minimum: 0, maximum: MAX_WATCH_PRICE },
        notes:         { type: 'string', maxLength: MAX_LONG },
      },
    },
    watches: {
      type: 'array',
      maxItems: MAX_EXTRACTED_WATCHES,
      items: {
        type: 'object',
        properties: {
          brand:                    { type: 'string', maxLength: MAX_SHORT },
          model:                    { type: 'string', maxLength: MAX_SHORT },
          referenceNumber:          { type: 'string', maxLength: MAX_SHORT },
          serialNumber:             { type: 'string', maxLength: MAX_SHORT },
          year:                     { type: 'integer', minimum: 1800, maximum: 2100 },
          condition:                { type: 'string', maxLength: MAX_MED },
          ownershipType:            { type: 'string', enum: ['OWNED', 'CONSIGNMENT'] },
          costCurrency:             { type: 'string', enum: ['MXN', 'USD'] },
          purchasePrice:            { type: 'number', minimum: 0, maximum: MAX_WATCH_PRICE },
          askingPriceMin:           { type: 'number', minimum: 0, maximum: MAX_WATCH_PRICE },
          askingPriceMax:           { type: 'number', minimum: 0, maximum: MAX_WATCH_PRICE },
          watchStatus:              { type: 'string', enum: ['AVAILABLE', 'RESERVED', 'SOLD', 'IN_TRANSIT', 'IN_SERVICE'] },
          box:                      { type: 'boolean' },
          papers:                   { type: 'boolean' },
          accessories:              { type: 'string', maxLength: MAX_LONG },
          notes:                    { type: 'string', maxLength: MAX_LONG },
          consignmentOwnerName:     { type: 'string', maxLength: MAX_MED },
          consignmentSplitPercentage: { type: 'number', minimum: 0, maximum: 100 },
          // M-02: HTTPS images only
          imageUrl: { type: 'string', maxLength: MAX_URL, format: 'uri', pattern: '^https://' },
          confidence: {
            type: 'object',
            additionalProperties: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
    },
    extractionVersion: { type: 'string' },
    overallConfidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};
