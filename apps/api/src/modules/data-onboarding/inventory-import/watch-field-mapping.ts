import { createHash } from 'crypto';

import { normalizeHeaderKey } from '../utils/header-normalization.util';
import {
  MappingEntry,
  MappingProposal,
  SKIP_FIELD,
  WATCH_IMPORT_FIELDS,
  WatchImportField,
} from './watch-import.types';

type AliasEntry = {
  field: WatchImportField;
  aliases: string[];
  priority: number;
};

const ALIAS_TABLE: AliasEntry[] = [
  {
    field: 'brand',
    aliases: ['marca', 'brand', 'fabricante', 'manufacturer', 'make'],
    priority: 1,
  },
  {
    field: 'model',
    aliases: ['modelo', 'model', 'nombre_modelo', 'watch_model'],
    priority: 1,
  },
  {
    field: 'reference',
    aliases: [
      'referencia', 'reference', 'ref', 'ref_number', 'ref_no', 'numero_referencia',
      'ref_num', 'numero_de_referencia', 'num_ref', 'numero_ref',
    ],
    priority: 1,
  },
  {
    field: 'serialNumber',
    aliases: [
      'serie', 'serial', 'serial_number', 'numero_serie', 'numero_de_serie',
      'no_serie', 'sn', 's_n', 'serial_no', 'num_serie',
    ],
    priority: 1,
  },
  {
    field: 'condition',
    aliases: [
      'condicion', 'condition', 'estado_reloj', 'estado_del_reloj',
      'watch_condition', 'cond', 'condicion_del_reloj',
    ],
    priority: 1,
  },
  {
    field: 'ownershipType',
    aliases: [
      'tipo_propiedad', 'propiedad', 'ownership', 'ownership_type',
      'tipo_de_propiedad', 'tipo_pertenencia',
    ],
    priority: 1,
  },
  {
    field: 'costCurrency',
    aliases: [
      'moneda', 'currency', 'moneda_costo', 'cost_currency', 'divisa',
      'moneda_de_costo',
    ],
    priority: 2,
  },
  {
    field: 'cost',
    aliases: [
      'costo', 'cost', 'precio_costo', 'costo_de_adquisicion', 'acquisition_cost',
      'precio_compra', 'purchase_price', 'cost_price', 'costo_adquisicion',
    ],
    priority: 1,
  },
  {
    field: 'priceMin',
    aliases: [
      'precio_minimo', 'precio_min', 'price_min', 'minimum_price',
      'piso', 'precio_piso', 'precio_minimo_venta',
    ],
    priority: 1,
  },
  {
    field: 'priceMax',
    aliases: [
      'precio_maximo', 'precio_max', 'price_max', 'maximum_price',
      'techo', 'precio_techo', 'precio_venta', 'selling_price',
      'asking_price', 'precio_de_venta', 'sale_price',
    ],
    priority: 1,
  },
  {
    field: 'status',
    aliases: [
      'status', 'estatus', 'watch_status', 'estado_inventario',
    ],
    priority: 2,
  },
  {
    field: 'consignmentOwnerName',
    aliases: [
      'propietario', 'owner', 'consignment_owner', 'dueno', 'owner_name',
      'nombre_propietario', 'propietario_consignacion', 'consignador',
    ],
    priority: 2,
  },
  {
    field: 'consignmentSplitPercentage',
    aliases: [
      'split', 'porcentaje_split', 'commission_percentage', 'porcentaje_consignacion',
      'split_percentage', 'comision', 'porcentaje_comision',
    ],
    priority: 2,
  },
  {
    field: 'imageUrl',
    aliases: [
      'imagen', 'image', 'foto', 'photo', 'url', 'image_url', 'foto_url',
      'imagen_url', 'link_imagen',
    ],
    priority: 3,
  },
];

const NORMALIZED_ALIAS_MAP = new Map<string, { field: WatchImportField; priority: number }>();

for (const entry of ALIAS_TABLE) {
  for (const alias of entry.aliases) {
    const key = normalizeHeaderKey(alias);
    if (!NORMALIZED_ALIAS_MAP.has(key)) {
      NORMALIZED_ALIAS_MAP.set(key, { field: entry.field, priority: entry.priority });
    }
  }
}

export function matchHeaderToField(
  header: string,
): { field: WatchImportField; confidence: 'HIGH' | 'MEDIUM' | 'LOW' } | null {
  const normalized = normalizeHeaderKey(header);
  const match = NORMALIZED_ALIAS_MAP.get(normalized);
  if (!match) return null;
  const confidence = match.priority === 1 ? 'HIGH' : match.priority === 2 ? 'MEDIUM' : 'LOW';
  return { field: match.field, confidence };
}

export function proposeMapping(headers: string[], sampleRows: Record<string, string>[]): MappingProposal[] {
  const usedFields = new Set<WatchImportField>();

  return headers.map((header) => {
    const match = matchHeaderToField(header);
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

export function buildMappingVersion(mapping: MappingEntry[]): string {
  const sorted = [...mapping].sort((a, b) => a.sourceColumn.localeCompare(b.sourceColumn));
  const canonical = JSON.stringify(sorted);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/**
 * Deterministic identity of a dry run: session + every inventory file's id,
 * mapping version, and staged row count. Commit requires the exact same base;
 * remapping or reprocessing the source changes it and invalidates the dry run.
 * Returns null when any file lacks a mapping version (dry run not allowed).
 */
export function buildDryRunBase(
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

/**
 * Exact deterministic dry-run version check. A stored dry-run version has the
 * shape `<base>:<iso-timestamp>`; the base must equal the recomputed base
 * exactly. Empty or malformed versions are always rejected.
 */
export function isDryRunVersionCurrent(storedVersion: string | null, currentBase: string | null): boolean {
  if (!storedVersion || !currentBase) return false;
  const separatorIndex = storedVersion.indexOf(':');
  if (separatorIndex <= 0) return false;
  const storedBase = storedVersion.slice(0, separatorIndex);
  return storedBase === currentBase;
}

export function mappingToLookup(mapping: MappingEntry[]): Map<string, WatchImportField | typeof SKIP_FIELD> {
  const map = new Map<string, WatchImportField | typeof SKIP_FIELD>();
  for (const entry of mapping) {
    map.set(entry.sourceColumn, entry.targetField);
  }
  return map;
}

export function validateMappingEntries(mapping: MappingEntry[]): string[] {
  const errors: string[] = [];
  const seenTargets = new Set<string>();

  for (const entry of mapping) {
    if (!entry.sourceColumn || entry.sourceColumn.trim() === '') {
      errors.push('sourceColumn must not be empty');
      continue;
    }
    if (entry.targetField !== SKIP_FIELD && !(WATCH_IMPORT_FIELDS as readonly string[]).includes(entry.targetField)) {
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
