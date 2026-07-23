import { createHash } from 'crypto';

import { normalizeHeaderKey } from '../utils/header-normalization.util';
import {
  SalesImportField,
  SalesMappingEntry,
  SalesMappingProposal,
  SKIP_FIELD,
  SALES_IMPORT_FIELDS,
} from './historical-sale.types';

type AliasEntry = {
  field: SalesImportField;
  aliases: string[];
  priority: number;
};

const ALIAS_TABLE: AliasEntry[] = [
  {
    field: 'customerName',
    aliases: ['cliente', 'comprador', 'customer', 'customer_name', 'nombre_cliente', 'buyer', 'nombre'],
    priority: 1,
  },
  {
    field: 'brand',
    aliases: ['marca', 'brand', 'fabricante', 'make'],
    priority: 1,
  },
  {
    field: 'model',
    aliases: ['modelo', 'model', 'watch_model'],
    priority: 1,
  },
  {
    field: 'reference',
    aliases: ['referencia', 'reference', 'ref', 'ref_number', 'numero_referencia'],
    priority: 1,
  },
  {
    field: 'serialNumber',
    aliases: ['serie', 'serial', 'serial_number', 'numero_serie', 'numero_de_serie', 'sn'],
    priority: 1,
  },
  {
    field: 'cost',
    aliases: ['costo', 'cost', 'precio_costo', 'precio_compra', 'purchase_price', 'cost_price'],
    priority: 1,
  },
  {
    field: 'salePrice',
    aliases: [
      'precio', 'venta', 'precio_venta', 'sale_price', 'selling_price', 'precio_de_venta',
      'monto', 'importe', 'saleprice',
    ],
    priority: 1,
  },
  {
    field: 'extras',
    aliases: ['extras', 'extra', 'gastos_extra', 'adicionales', 'extras_amount'],
    priority: 1,
  },
  {
    field: 'reportedProfit',
    aliases: ['utilidad', 'ganancia', 'profit', 'reported_profit', 'utilidad_reportada'],
    priority: 1,
  },
  {
    field: 'paymentCount',
    aliases: ['pagos', 'num_pagos', 'numero_pagos', 'payment_count', 'payments', 'n_pagos'],
    priority: 1,
  },
  {
    field: 'saleDate',
    aliases: ['fecha', 'fecha_venta', 'sale_date', 'date', 'fecha_de_venta'],
    priority: 1,
  },
  {
    field: 'notes',
    aliases: ['notas', 'notes', 'comentarios', 'observaciones', 'comentario'],
    priority: 2,
  },
  {
    field: 'currency',
    aliases: ['moneda', 'currency', 'divisa'],
    priority: 2,
  },
  {
    field: 'saleCurrency',
    aliases: ['moneda_venta', 'sale_currency', 'currency_sale'],
    priority: 2,
  },
  {
    field: 'costCurrency',
    aliases: ['moneda_costo', 'cost_currency'],
    priority: 2,
  },
  {
    field: 'extrasCurrency',
    aliases: ['moneda_extras', 'extras_currency'],
    priority: 3,
  },
  {
    field: 'reportedProfitCurrency',
    aliases: ['moneda_utilidad', 'profit_currency'],
    priority: 3,
  },
];

const NORMALIZED_ALIAS_MAP = new Map<string, { field: SalesImportField; priority: number }>();

for (const entry of ALIAS_TABLE) {
  for (const alias of entry.aliases) {
    const key = normalizeHeaderKey(alias);
    if (!NORMALIZED_ALIAS_MAP.has(key)) {
      NORMALIZED_ALIAS_MAP.set(key, { field: entry.field, priority: entry.priority });
    }
  }
}

export function matchSalesHeaderToField(
  header: string,
): { field: SalesImportField; confidence: 'HIGH' | 'MEDIUM' | 'LOW' } | null {
  const normalized = normalizeHeaderKey(header);
  const match = NORMALIZED_ALIAS_MAP.get(normalized);
  if (!match) return null;
  const confidence = match.priority === 1 ? 'HIGH' : match.priority === 2 ? 'MEDIUM' : 'LOW';
  return { field: match.field, confidence };
}

export function proposeSalesMapping(
  headers: string[],
  sampleRows: Record<string, string>[] = [],
): SalesMappingProposal[] {
  const usedFields = new Set<SalesImportField>();

  return headers.map((header) => {
    const match = matchSalesHeaderToField(header);
    const sampleValues = sampleRows
      .slice(0, 3)
      .map((row) => row[header] ?? '')
      .filter(Boolean);

    if (!match) {
      return { sourceColumn: header, sampleValues, suggested: null, confidence: 'NONE' };
    }

    if (usedFields.has(match.field)) {
      return { sourceColumn: header, sampleValues, suggested: match.field, confidence: 'LOW' };
    }

    usedFields.add(match.field);
    return { sourceColumn: header, sampleValues, suggested: match.field, confidence: match.confidence };
  });
}

export function buildSalesMappingVersion(mapping: SalesMappingEntry[]): string {
  const sorted = [...mapping].sort((a, b) => a.sourceColumn.localeCompare(b.sourceColumn));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
}

/**
 * Deterministic dry-run base: session + every sales file's id, mapping version, and row count.
 */
export function buildSalesDryRunBase(
  sessionId: string,
  files: Array<{ id: string; mappingVersion: string | null; rowCount: number }>,
): string | null {
  if (files.length === 0) return null;
  const entries = [...files]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((f) => ({ id: f.id, mappingVersion: f.mappingVersion, rowCount: f.rowCount }));
  if (entries.some((e) => !e.mappingVersion || e.mappingVersion.trim() === '')) return null;
  return createHash('sha256').update(JSON.stringify({ sessionId, entries })).digest('hex').slice(0, 16);
}

export function isSalesDryRunVersionCurrent(storedVersion: string | null, currentBase: string | null): boolean {
  if (!storedVersion || !currentBase) return false;
  const separatorIndex = storedVersion.indexOf(':');
  if (separatorIndex <= 0) return false;
  return storedVersion.slice(0, separatorIndex) === currentBase;
}

export function salesMappingToLookup(
  mapping: SalesMappingEntry[],
): Map<string, SalesImportField | typeof SKIP_FIELD> {
  const map = new Map<string, SalesImportField | typeof SKIP_FIELD>();
  for (const entry of mapping) {
    map.set(entry.sourceColumn, entry.targetField);
  }
  return map;
}

export function validateSalesMappingEntries(mapping: SalesMappingEntry[]): string[] {
  const errors: string[] = [];
  const seenTargets = new Set<string>();

  for (const entry of mapping) {
    if (!entry.sourceColumn || entry.sourceColumn.trim() === '') {
      errors.push('sourceColumn must not be empty');
      continue;
    }
    if (
      entry.targetField !== SKIP_FIELD &&
      !(SALES_IMPORT_FIELDS as readonly string[]).includes(entry.targetField)
    ) {
      errors.push(`Unknown targetField: "${entry.targetField}"`);
      continue;
    }
    if (entry.targetField !== SKIP_FIELD) {
      if (seenTargets.has(entry.targetField)) {
        errors.push(`Duplicate mapping for targetField: "${entry.targetField}"`);
      }
      seenTargets.add(entry.targetField);
    }
  }

  return errors;
}
