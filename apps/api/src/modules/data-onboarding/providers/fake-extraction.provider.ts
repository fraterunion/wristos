import type { InventoryInvoiceExtraction } from '../inventory-import/inventory-invoice-extraction.types';
import type { HistoricalSalesExtractionDocument } from '../sales-import/historical-sale-extraction.types';
import { ExtractionError, ExtractionErrorCode } from './extraction-errors';
import type { DocumentExtractionProvider } from './document-extraction.provider.interface';
import { HISTORICAL_SALES_EXTRACTION_VERSION } from './prompts/historical-sales-extraction-v1';

// ─── Inventory scenario responses ─────────────────────────────────────────────

const INVENTORY_SCENARIOS: Record<string, () => InventoryInvoiceExtraction | never> = {
  'single-watch': () => ({
    invoice: {
      supplierName: 'Fake Supplier S.A.',
      invoiceNumber: 'INV-FAKE-001',
      invoiceDate: '2026-07-19',
      currency: 'MXN',
      subtotal: 150000,
      taxes: 24000,
      total: 174000,
    },
    watches: [
      {
        brand: 'Rolex',
        model: 'Submariner',
        referenceNumber: '126610LN',
        serialNumber: 'FAKE-SN-001',
        year: 2023,
        condition: 'Excelente',
        ownershipType: 'OWNED',
        costCurrency: 'MXN',
        purchasePrice: 150000,
        askingPriceMin: 180000,
        askingPriceMax: 220000,
        watchStatus: 'AVAILABLE',
        box: true,
        papers: true,
        confidence: { brand: 0.99, model: 0.99, purchasePrice: 0.85, serialNumber: 0.95 },
      },
    ],
    extractionVersion: 'v1',
    overallConfidence: 0.92,
  }),

  'multi-watch': () => ({
    invoice: {
      supplierName: 'Proveedor Multi S.A.',
      invoiceNumber: 'INV-MULTI-001',
      invoiceDate: '2026-07-19',
      currency: 'MXN',
      subtotal: 620000,
      taxes: 99200,
      total: 719200,
    },
    watches: [
      {
        brand: 'Rolex', model: 'Submariner', referenceNumber: '126610LN',
        serialNumber: 'FAKE-SN-001', purchasePrice: 150000, costCurrency: 'MXN',
        watchStatus: 'AVAILABLE', ownershipType: 'OWNED', box: true, papers: true,
        confidence: { purchasePrice: 0.95 },
      },
      {
        brand: 'Omega', model: 'Speedmaster Moonwatch', referenceNumber: '310.30.42.50.01.001',
        serialNumber: 'FAKE-SN-002', purchasePrice: 85000, costCurrency: 'MXN',
        watchStatus: 'AVAILABLE', ownershipType: 'OWNED', box: true, papers: false,
        confidence: { purchasePrice: 0.90 },
      },
      {
        brand: 'Patek Philippe', model: 'Nautilus', referenceNumber: '5711/1A-010',
        serialNumber: 'FAKE-SN-003', purchasePrice: 385000, costCurrency: 'MXN',
        watchStatus: 'AVAILABLE', ownershipType: 'CONSIGNMENT',
        confidence: { purchasePrice: 0.88 },
      },
    ],
    extractionVersion: 'v1',
    overallConfidence: 0.91,
  }),

  'no-watch': () => ({
    invoice: {
      supplierName: 'Proveedor Sin Relojes',
      invoiceNumber: 'INV-NORELOJES-001',
      invoiceDate: '2026-07-19',
      currency: 'MXN',
    },
    watches: [],
    extractionVersion: 'v1',
    overallConfidence: 0.95,
  }),

  'invoice-total-only': () => ({
    invoice: {
      supplierName: 'Factura Sin Líneas',
      invoiceNumber: 'INV-TOTAL-001',
      invoiceDate: '2026-07-19',
      currency: 'MXN',
      total: 430000,
    },
    watches: [
      { brand: 'Rolex', model: 'Datejust', referenceNumber: '126300', serialNumber: 'FAKE-SN-A1',
        watchStatus: 'AVAILABLE', ownershipType: 'OWNED', confidence: { brand: 0.99 } },
      { brand: 'Tudor', model: 'Black Bay', referenceNumber: 'M79230B-0008', serialNumber: 'FAKE-SN-A2',
        watchStatus: 'AVAILABLE', ownershipType: 'OWNED', confidence: { brand: 0.99 } },
    ],
    extractionVersion: 'v1',
    overallConfidence: 0.75,
  }),

  'duplicate-serial': () => ({
    invoice: {
      supplierName: 'Proveedor con Seriales Duplicados',
      invoiceNumber: 'INV-DUP-001',
      invoiceDate: '2026-07-19',
      currency: 'MXN',
    },
    watches: [
      { brand: 'Rolex', model: 'GMT-Master II', serialNumber: 'DUPLICATE-001',
        purchasePrice: 200000, costCurrency: 'MXN', watchStatus: 'AVAILABLE', ownershipType: 'OWNED' },
      { brand: 'Rolex', model: 'GMT-Master II', serialNumber: 'DUPLICATE-001',
        purchasePrice: 200000, costCurrency: 'MXN', watchStatus: 'AVAILABLE', ownershipType: 'OWNED' },
    ],
    extractionVersion: 'v1',
    overallConfidence: 0.88,
  }),

  'accessory-lines': () => ({
    invoice: {
      supplierName: 'Proveedor con Accesorios',
      invoiceNumber: 'INV-ACC-001',
      invoiceDate: '2026-07-19',
      currency: 'USD',
      subtotal: 15800,
      total: 15800,
    },
    watches: [
      { brand: 'Rolex', model: 'Submariner', referenceNumber: '126610LN',
        serialNumber: 'FAKE-SN-ACC', purchasePrice: 15800, costCurrency: 'USD',
        watchStatus: 'AVAILABLE', ownershipType: 'OWNED',
        accessories: 'Estuche adicional, tarjeta de garantía',
        box: true, papers: true,
        confidence: { purchasePrice: 0.92 } },
    ],
    extractionVersion: 'v1',
    overallConfidence: 0.89,
  }),

  'prompt-injection': () => ({
    invoice: {
      supplierName: 'Proveedor Legítimo S.A.',
      invoiceNumber: 'INV-INJECT-001',
      invoiceDate: '2026-07-19',
      currency: 'MXN',
    },
    watches: [
      { brand: 'Omega', model: 'Seamaster', serialNumber: 'LEGIT-SN-001',
        purchasePrice: 75000, costCurrency: 'MXN',
        watchStatus: 'AVAILABLE', ownershipType: 'OWNED',
        confidence: { brand: 0.95, serialNumber: 0.90 } },
    ],
    extractionVersion: 'v1',
    overallConfidence: 0.85,
  }),
};

// ─── Sales scenario responses ─────────────────────────────────────────────────

const SALES_SCENARIOS: Record<string, () => HistoricalSalesExtractionDocument> = {
  'single-sale': () => ({
    sales: [
      {
        sourceRow: 1,
        saleDate: '2026-03-15',
        customerName: 'Cliente Fake',
        brand: 'Rolex',
        model: 'Submariner',
        reference: '126610LN',
        serialNumber: 'SALE-SN-001',
        cost: 120000,
        costCurrency: 'MXN',
        salePrice: 150000,
        saleCurrency: 'MXN',
        reportedProfit: 30000,
        reportedProfitCurrency: 'MXN',
        paymentCount: 1,
        confidence: { overall: 0.93, salePrice: 0.95, brand: 0.99 },
      },
    ],
    extractionVersion: HISTORICAL_SALES_EXTRACTION_VERSION,
    overallConfidence: 0.93,
  }),

  'multi-month': () => ({
    sales: [
      {
        sourceRow: 1,
        saleDate: '2026-01-10',
        customerName: 'Ana Pérez',
        brand: 'Rolex',
        model: 'Datejust',
        reference: '126300',
        serialNumber: 'SALE-JAN-001',
        cost: 90000,
        costCurrency: 'MXN',
        salePrice: 110000,
        saleCurrency: 'MXN',
        confidence: { overall: 0.9 },
      },
      {
        sourceRow: 2,
        saleDate: '2026-02-18',
        customerName: 'Luis Gómez',
        brand: 'Omega',
        model: 'Speedmaster',
        reference: '310.30.42.50.01.001',
        serialNumber: 'SALE-FEB-001',
        cost: 70000,
        costCurrency: 'MXN',
        salePrice: 85000,
        saleCurrency: 'MXN',
        extras: 2500,
        extrasCurrency: 'MXN',
        confidence: { overall: 0.88 },
      },
      {
        sourceRow: 3,
        saleDate: '2026-03-22',
        customerName: 'María López',
        brand: 'Tudor',
        model: 'Black Bay',
        reference: 'M79230B-0008',
        serialNumber: 'SALE-MAR-001',
        cost: 45000,
        costCurrency: 'MXN',
        salePrice: 58000,
        saleCurrency: 'MXN',
        confidence: { overall: 0.91 },
      },
    ],
    extractionVersion: HISTORICAL_SALES_EXTRACTION_VERSION,
    overallConfidence: 0.9,
  }),

  'usd-sale': () => ({
    sales: [
      {
        sourceRow: 1,
        saleDate: '2026-04-01',
        customerName: 'International Buyer',
        brand: 'Patek Philippe',
        model: 'Nautilus',
        reference: '5711/1A-010',
        serialNumber: 'SALE-USD-001',
        cost: 35000,
        costCurrency: 'USD',
        salePrice: 42000,
        saleCurrency: 'USD',
        reportedProfit: 7000,
        reportedProfitCurrency: 'USD',
        paymentCount: 2,
        notes: 'Pago en USD explícito',
        confidence: { overall: 0.94, salePrice: 0.99 },
      },
    ],
    extractionVersion: HISTORICAL_SALES_EXTRACTION_VERSION,
    overallConfidence: 0.94,
  }),

  empty: () => ({
    sales: [],
    extractionVersion: HISTORICAL_SALES_EXTRACTION_VERSION,
    overallConfidence: 0.95,
  }),
};

function throwScenario(scenario: string): never {
  if (scenario === 'timeout') {
    throw new ExtractionError(
      ExtractionErrorCode.TIMEOUT,
      'La extracción tardó más de 90 segundos. Intente con un documento más pequeño.',
    );
  }
  if (scenario === 'truncated') {
    throw new ExtractionError(
      ExtractionErrorCode.OUTPUT_TRUNCATED,
      'No se pudo completar la extracción porque la factura contiene demasiada información. ' +
      'Divide el documento o reduce el número de artículos e inténtalo nuevamente.',
    );
  }
  if (scenario === 'malformed') {
    throw new ExtractionError(
      ExtractionErrorCode.SCHEMA_INVALID,
      'La respuesta de extracción no cumple con el esquema esperado.',
      { issueCount: 2, issuePaths: ['watches', 'invoice'] },
    );
  }
  throw new ExtractionError(
    ExtractionErrorCode.PROVIDER_ERROR,
    'El servicio de extracción respondió con un error inesperado. Intente de nuevo.',
  );
}

const ERROR_SCENARIOS = ['timeout', 'truncated', 'malformed', 'provider-error'];

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * Fake extraction provider for local development and automated tests.
 * Returns deterministic data — never calls Anthropic.
 *
 * Set DOCUMENT_EXTRACTION_FAKE_SCENARIO to select a scenario:
 *   Inventory: single-watch, multi-watch, no-watch, malformed, timeout, truncated,
 *     prompt-injection, invoice-total-only, accessory-lines, duplicate-serial
 *   Sales: single-sale, multi-month, usd-sale, empty
 *
 * Falls back to single-watch / single-sale when no matching scenario is configured.
 */
export class FakeExtractionProvider implements DocumentExtractionProvider {
  readonly providerName = 'fake';
  readonly modelId = 'fake-v1';

  constructor(
    private readonly fixture?: Partial<InventoryInvoiceExtraction>,
    private readonly scenario?: string,
  ) {}

  async extractInventoryInvoice(_pdfBuffer: Buffer): Promise<InventoryInvoiceExtraction> {
    const activeScenario = this.scenario ?? process.env.DOCUMENT_EXTRACTION_FAKE_SCENARIO;
    if (activeScenario) {
      if (ERROR_SCENARIOS.includes(activeScenario)) {
        throwScenario(activeScenario);
      }
      const builder = INVENTORY_SCENARIOS[activeScenario];
      if (builder) {
        const base = builder();
        return this.fixture ? { ...base, ...this.fixture } : base;
      }
    }

    return {
      ...INVENTORY_SCENARIOS['single-watch'](),
      ...this.fixture,
    };
  }

  async extractHistoricalSales(_pdfBuffer: Buffer): Promise<HistoricalSalesExtractionDocument> {
    const activeScenario = this.scenario ?? process.env.DOCUMENT_EXTRACTION_FAKE_SCENARIO;
    if (activeScenario) {
      if (ERROR_SCENARIOS.includes(activeScenario)) {
        throwScenario(activeScenario);
      }
      const builder = SALES_SCENARIOS[activeScenario];
      if (builder) {
        return builder();
      }
    }

    return SALES_SCENARIOS['single-sale']();
  }
}
