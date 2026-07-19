import {
  InventoryInvoiceExtractionSchema,
  MAX_EXTRACTED_WATCHES,
  MAX_WATCH_PRICE,
  bridgeExtractedWatch,
  PDF_IDENTITY_MAPPING,
} from './inventory-invoice-extraction.types';

describe('InventoryInvoiceExtractionSchema', () => {
  const minimal = {
    invoice: {},
    watches: [],
    extractionVersion: 'v1',
  };

  it('accepts a minimal extraction with empty invoice and no watches', () => {
    expect(InventoryInvoiceExtractionSchema.safeParse(minimal).success).toBe(true);
  });

  it('accepts a fully populated extraction', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      invoice: {
        supplierName: 'Acme Watches',
        invoiceNumber: 'INV-001',
        invoiceDate: '2026-07-19',
        currency: 'MXN',
        subtotal: 500000,
        taxes: 80000,
        shipping: 5000,
        total: 585000,
        notes: 'Primera compra',
      },
      watches: [
        {
          brand: 'Rolex',
          model: 'Submariner',
          referenceNumber: '126610LN',
          serialNumber: 'SN-ABCD',
          year: 2023,
          condition: 'Excelente',
          ownershipType: 'OWNED',
          costCurrency: 'USD',
          purchasePrice: 12000,
          askingPriceMin: 200000,
          askingPriceMax: 250000,
          watchStatus: 'AVAILABLE',
          box: true,
          papers: true,
          accessories: 'Caja adicional',
          notes: 'Pieza especial',
          confidence: { brand: 0.99, purchasePrice: 0.85 },
        },
      ],
      extractionVersion: 'v1',
      overallConfidence: 0.92,
    });
    expect(result.success).toBe(true);
  });

  // M-03: extractionVersion is now server-owned and optional in the schema
  it('accepts extraction WITHOUT extractionVersion (M-03)', () => {
    const { extractionVersion: _, ...withoutVersion } = minimal;
    expect(InventoryInvoiceExtractionSchema.safeParse(withoutVersion).success).toBe(true);
  });

  it('rejects confidence scores outside 0–1', () => {
    expect(InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      overallConfidence: 1.5,
    }).success).toBe(false);
  });

  it('accepts partial watches (missing optional fields)', () => {
    expect(InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ brand: 'Omega', model: 'Speedmaster' }],
    }).success).toBe(true);
  });

  // ─── H-02: watch count cap ────────────────────────────────────────────────

  it('accepts exactly MAX_EXTRACTED_WATCHES watches', () => {
    const watches = Array.from({ length: MAX_EXTRACTED_WATCHES }, (_, i) => ({ brand: `Brand ${i}` }));
    expect(InventoryInvoiceExtractionSchema.safeParse({ ...minimal, watches }).success).toBe(true);
  });

  it('rejects more than MAX_EXTRACTED_WATCHES watches', () => {
    const watches = Array.from({ length: MAX_EXTRACTED_WATCHES + 1 }, (_, i) => ({ brand: `Brand ${i}` }));
    expect(InventoryInvoiceExtractionSchema.safeParse({ ...minimal, watches }).success).toBe(false);
  });

  // ─── L-03: enum constraints ───────────────────────────────────────────────

  it('accepts valid enum values for ownershipType, costCurrency, watchStatus', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ ownershipType: 'OWNED', costCurrency: 'MXN', watchStatus: 'AVAILABLE' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts CONSIGNMENT and USD', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ ownershipType: 'CONSIGNMENT', costCurrency: 'USD', watchStatus: 'IN_SERVICE' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid costCurrency (EUR)', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ costCurrency: 'EUR' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid watchStatus', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ watchStatus: 'BROKEN' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid ownershipType', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ ownershipType: 'STOLEN' }],
    });
    expect(result.success).toBe(false);
  });

  // ─── L-01: monetary bounds ────────────────────────────────────────────────

  it('accepts a normal MXN price', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ purchasePrice: 185000, costCurrency: 'MXN' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a normal USD price', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ purchasePrice: 12000, costCurrency: 'USD' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a price that exceeds MAX_WATCH_PRICE', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ purchasePrice: MAX_WATCH_PRICE + 1 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a negative price', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ purchasePrice: -1 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects askingPriceMin > askingPriceMax (L-01)', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ askingPriceMin: 250000, askingPriceMax: 200000 }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts askingPriceMin === askingPriceMax', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ askingPriceMin: 200000, askingPriceMax: 200000 }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts invoice financial fields within bounds', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      invoice: { subtotal: 500000, taxes: 80000, shipping: 5000, total: 585000 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invoice total exceeding MAX_WATCH_PRICE', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      invoice: { total: MAX_WATCH_PRICE + 1 },
    });
    expect(result.success).toBe(false);
  });

  // ─── M-02: image URL validation ───────────────────────────────────────────

  it('accepts a valid HTTPS image URL', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ imageUrl: 'https://cdn.example.com/watch/rolex-sub.jpg' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an HTTP image URL (must be HTTPS)', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ imageUrl: 'http://example.com/image.jpg' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a javascript: URL', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ imageUrl: 'javascript:alert(1)' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a data: URI', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ imageUrl: 'data:image/png;base64,abc123' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a file: URI', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ imageUrl: 'file:///etc/passwd' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a plain string that is not a URL', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ imageUrl: 'not-a-url' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts omitted imageUrl', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ brand: 'Rolex' }],
    });
    expect(result.success).toBe(true);
  });

  // ─── M-04: null handling (Zod .optional() rejects null directly) ─────────

  it('rejects explicit null for optional fields (enforced by optional() not nullish())', () => {
    // Our null-stripping is done in the provider before parsing.
    // Verifies the schema itself does NOT accept null.
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ brand: null }],
    });
    expect(result.success).toBe(false);
  });

  // ─── New watch fields ─────────────────────────────────────────────────────

  it('accepts year within valid range', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ year: 2020 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects year outside valid range', () => {
    expect(InventoryInvoiceExtractionSchema.safeParse({ ...minimal, watches: [{ year: 1700 }] }).success).toBe(false);
    expect(InventoryInvoiceExtractionSchema.safeParse({ ...minimal, watches: [{ year: 2200 }] }).success).toBe(false);
  });

  it('accepts box and papers as booleans', () => {
    const result = InventoryInvoiceExtractionSchema.safeParse({
      ...minimal,
      watches: [{ box: true, papers: false }],
    });
    expect(result.success).toBe(true);
  });
});

// ─── bridgeExtractedWatch ─────────────────────────────────────────────────────

describe('bridgeExtractedWatch', () => {
  it('maps AI field names to WatchImportField names', () => {
    const bridged = bridgeExtractedWatch({
      brand: 'Rolex',
      model: 'Submariner',
      referenceNumber: '126610LN',
      serialNumber: 'SN-001',
      year: 2023,
      purchasePrice: 15000,
      askingPriceMin: 180000,
      askingPriceMax: 220000,
      watchStatus: 'AVAILABLE',
      box: true,
      papers: false,
      accessories: 'Caja original',
      notes: 'Pieza rara',
      confidence: { brand: 0.99 },
    });

    expect(bridged.brand).toBe('Rolex');
    expect(bridged.model).toBe('Submariner');
    expect(bridged.reference).toBe('126610LN');
    expect(bridged.serialNumber).toBe('SN-001');
    expect(bridged.year).toBe(2023);
    expect(bridged.cost).toBe(15000);
    expect(bridged.priceMin).toBe(180000);
    expect(bridged.priceMax).toBe(220000);
    expect(bridged.status).toBe('AVAILABLE');
    expect(bridged.box).toBe(true);
    expect(bridged.papers).toBe(false);
    expect(bridged.accessories).toBe('Caja original');
    expect(bridged.notes).toBe('Pieza rara');
    expect(bridged._confidence).toEqual({ brand: 0.99 });
  });

  it('omits undefined AI fields from the bridged row', () => {
    const bridged = bridgeExtractedWatch({ brand: 'Omega' });
    expect(bridged.brand).toBe('Omega');
    expect(bridged.model).toBeUndefined();
    expect(bridged.cost).toBeUndefined();
    expect(bridged.reference).toBeUndefined();
    expect(bridged.year).toBeUndefined();
    expect(bridged.box).toBeUndefined();
  });
});

// ─── PDF_IDENTITY_MAPPING ─────────────────────────────────────────────────────

describe('PDF_IDENTITY_MAPPING', () => {
  it('maps each sourceColumn to the same targetField (identity)', () => {
    for (const entry of PDF_IDENTITY_MAPPING) {
      expect(entry.sourceColumn).toBe(entry.targetField);
    }
  });

  it('covers all required WatchImportFields', () => {
    const fields = PDF_IDENTITY_MAPPING.map((e) => e.targetField);
    expect(fields).toContain('brand');
    expect(fields).toContain('model');
    expect(fields).toContain('cost');
    expect(fields).toContain('priceMin');
    expect(fields).toContain('priceMax');
    expect(fields).toContain('serialNumber');
    expect(fields).toContain('year');
    expect(fields).toContain('box');
    expect(fields).toContain('papers');
  });
});
