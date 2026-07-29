export const PLANNER_VERSION = 'wrist-caviar-import-planner-v1' as const;
export const SUPPORTED_PARSER_VERSIONS = ['wrist-caviar-master-xlsx-v1'] as const;
export const SUPPORTED_DATASET_VERSION_PREFIX = 'wrist-caviar-reviewed-v';

export const DEFAULT_DRY_RUN_BATCH_SIZE = 250;

export function dryRunBatchSize(): number {
  const raw = Number(process.env.WRIST_CAVIAR_DRY_RUN_BATCH_SIZE);
  if (!Number.isFinite(raw)) return DEFAULT_DRY_RUN_BATCH_SIZE;
  return Math.min(1000, Math.max(50, Math.floor(raw)));
}

export type DryRunConflictCode =
  | 'DATASET_NOT_READY'
  | 'DATASET_INTEGRITY_FAILURE'
  | 'DESTINATION_REQUIRED_FIELD_MISSING'
  | 'DESTINATION_UNIQUE_CONSTRAINT'
  | 'MULTIPLE_EXISTING_MATCHES'
  | 'CUSTOMER_MATCH_AMBIGUOUS'
  | 'INVENTORY_SERIAL_CONFLICT'
  | 'HISTORICAL_SALE_DUPLICATE_AMBIGUOUS'
  | 'DEPENDENCY_UNRESOLVED'
  | 'RECEIVABLE_BALANCE_INVALID'
  | 'PAYABLE_BALANCE_INVALID'
  | 'PAYMENT_DUPLICATE_AMBIGUOUS'
  | 'ACCOUNT_MAPPING_REQUIRED'
  | 'CATEGORY_MAPPING_REQUIRED'
  | 'DESTINATION_MODEL_UNSUPPORTED'
  | 'CAPITAL_SEMANTICS_UNSUPPORTED'
  | 'PLAN_STALE'
  | 'TENANT_MISMATCH';

export const CONFLICT_MESSAGES_ES: Record<DryRunConflictCode, string> = {
  DATASET_NOT_READY: 'El dataset no está listo para simulación.',
  DATASET_INTEGRITY_FAILURE: 'La integridad del dataset congelado no es válida.',
  DESTINATION_REQUIRED_FIELD_MISSING: 'Falta un campo requerido en el destino.',
  DESTINATION_UNIQUE_CONSTRAINT: 'La creación violaría una restricción de unicidad.',
  MULTIPLE_EXISTING_MATCHES: 'Hay varios registros existentes que coinciden exactamente.',
  CUSTOMER_MATCH_AMBIGUOUS: 'La coincidencia de cliente es ambigua.',
  INVENTORY_SERIAL_CONFLICT: 'Conflicto de número de serie en inventario.',
  HISTORICAL_SALE_DUPLICATE_AMBIGUOUS: 'La venta histórica tiene identidad ambigua.',
  DEPENDENCY_UNRESOLVED: 'Hay una dependencia sin resolver en el plan.',
  RECEIVABLE_BALANCE_INVALID: 'El saldo de CXC planificado no es válido.',
  PAYABLE_BALANCE_INVALID: 'El saldo de CXP planificado no es válido.',
  PAYMENT_DUPLICATE_AMBIGUOUS: 'El pago tiene identidad duplicada ambigua.',
  ACCOUNT_MAPPING_REQUIRED: 'Se requiere mapear una cuenta destino.',
  CATEGORY_MAPPING_REQUIRED: 'Se requiere mapear una categoría de gasto.',
  DESTINATION_MODEL_UNSUPPORTED: 'No hay un modelo destino compatible en WristOS.',
  CAPITAL_SEMANTICS_UNSUPPORTED: 'El movimiento no puede representarse sin alterar Capital.',
  PLAN_STALE: 'El plan está desactualizado respecto a la base de datos.',
  TENANT_MISMATCH: 'El dataset no pertenece al tenant seleccionado.',
};

/** Deterministic expense category mapping — only exact keyword hits. */
export const EXPENSE_CATEGORY_MAP: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /gasolin|combustible|pemex/i, category: 'GASOLINE' },
  { pattern: /caseta|peaje|toll/i, category: 'TOLLS' },
  { pattern: /relojero|watchmaker|servicio reloj/i, category: 'WATCHMAKER' },
  { pattern: /estacionamiento|parking/i, category: 'PARKING' },
  { pattern: /comida|cena|almuerzo|restaurante|meals?/i, category: 'MEALS' },
  { pattern: /vuelo|avion|airline|flight/i, category: 'FLIGHTS' },
  { pattern: /viaje|hotel|uber|taxi|travel/i, category: 'TRAVEL' },
  { pattern: /marketing|publicidad|ads?/i, category: 'MARKETING' },
  { pattern: /comision|commission/i, category: 'COMMISSIONS' },
  { pattern: /banco|comision banc|bank fee/i, category: 'BANK_FEES' },
];
