import type { HistoricalSaleExtraction, SalesImportField } from '../types/data-onboarding';
import { SKIP_FIELD } from '../types/data-onboarding';

export function entityTypeForSession(
  importTarget: 'INVENTORY' | 'SALES',
): 'INVENTORY' | 'SALES' {
  return importTarget === 'SALES' ? 'SALES' : 'INVENTORY';
}

export function emptyHistoricalSale(): HistoricalSaleExtraction {
  return {
    sourceRow: null,
    saleDate: null,
    customerName: null,
    brand: null,
    model: null,
    reference: null,
    serialNumber: null,
    cost: null,
    costCurrency: null,
    salePrice: null,
    saleCurrency: null,
    extras: null,
    extrasCurrency: null,
    reportedProfit: null,
    reportedProfitCurrency: null,
    paymentCount: null,
    notes: null,
    confidence: null,
  };
}

/** salePrice − cost − (extras ?? 0) when salePrice and cost are present. */
export function clientSideCalculatedProfit(
  sale: Pick<HistoricalSaleExtraction, 'salePrice' | 'cost' | 'extras'>,
): number | null {
  if (sale.salePrice == null || sale.cost == null) return null;
  return sale.salePrice - sale.cost - (sale.extras ?? 0);
}

export function saleMatchesSearch(sale: HistoricalSaleExtraction, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const haystacks = [
    sale.customerName,
    sale.brand,
    sale.model,
    sale.reference,
    sale.serialNumber,
  ];
  return haystacks.some((v) => (v ?? '').toLowerCase().includes(needle));
}

export type SalesExtractionFilter = 'ALL' | 'MISSING_PRICE' | 'COMPLETE' | 'HAS_PRICE' | 'EMPTY_IDENTITY';

function hasIdentity(sale: HistoricalSaleExtraction): boolean {
  return Boolean(
    (sale.brand && sale.brand.trim()) ||
      (sale.model && sale.model.trim()) ||
      (sale.reference && sale.reference.trim()) ||
      (sale.serialNumber && sale.serialNumber.trim()),
  );
}

export function filterSalesByStatus(
  sales: HistoricalSaleExtraction[],
  filter: SalesExtractionFilter,
): HistoricalSaleExtraction[] {
  switch (filter) {
    case 'HAS_PRICE':
      return sales.filter((s) => s.salePrice != null);
    case 'MISSING_PRICE':
      return sales.filter((s) => s.salePrice == null);
    case 'EMPTY_IDENTITY':
      return sales.filter((s) => !hasIdentity(s));
    case 'COMPLETE':
      return sales.filter((s) => s.salePrice != null && hasIdentity(s));
    case 'ALL':
    default:
      return sales;
  }
}

export function hasProfitMismatch(sale: HistoricalSaleExtraction): boolean {
  if (sale.reportedProfit == null) return false;
  const calculated = clientSideCalculatedProfit(sale);
  if (calculated == null) return false;
  return Math.abs(sale.reportedProfit - calculated) > 1;
}

export const SALES_IMPORT_FIELD_OPTIONS: Array<{
  value: SalesImportField | typeof SKIP_FIELD;
  label: string;
}> = [
  { value: SKIP_FIELD, label: '— Ignorar —' },
  { value: 'saleDate', label: 'Fecha de venta' },
  { value: 'customerName', label: 'Cliente' },
  { value: 'brand', label: 'Marca' },
  { value: 'model', label: 'Modelo' },
  { value: 'reference', label: 'Referencia' },
  { value: 'serialNumber', label: 'Número de serie' },
  { value: 'cost', label: 'Costo' },
  { value: 'costCurrency', label: 'Moneda del costo' },
  { value: 'salePrice', label: 'Precio de venta' },
  { value: 'saleCurrency', label: 'Moneda de venta' },
  { value: 'extras', label: 'Extras' },
  { value: 'extrasCurrency', label: 'Moneda de extras' },
  { value: 'reportedProfit', label: 'Utilidad reportada' },
  { value: 'reportedProfitCurrency', label: 'Moneda de utilidad' },
  { value: 'paymentCount', label: 'Cantidad de pagos' },
  { value: 'notes', label: 'Notas' },
  { value: 'currency', label: 'Moneda (general)' },
];
