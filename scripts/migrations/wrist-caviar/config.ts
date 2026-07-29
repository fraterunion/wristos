export const MIGRATION_SOURCE = 'wrist-caviar-master-workbook-v1' as const;
export const PARSER_VERSION = 'wrist-caviar-master-xlsx-v1' as const;
export const LOCAL_ROOT = '.local/migrations/wrist-caviar';

export const ACCEPTANCE_COUNTS = {
  sales: { min: 450, max: 490 },
  inventory: { min: 35, max: 50 },
  expenses: { min: 270, max: 310 },
  bank: { min: 500, max: 540 },
  receivables: { min: 45, max: 60 },
  payables: { min: 12, max: 25 },
  cashCombined: { min: 850, max: 950 },
  cashHidden: { min: 650, max: 760 },
} as const;

export const EXPENSE_CATEGORY_MAP: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /gasolin|combustible|pemex|^gas$/i, category: 'GASOLINE' },
  { pattern: /caseta|peaje|toll/i, category: 'TOLLS' },
  { pattern: /relojero|watchmaker|servicio reloj/i, category: 'WATCHMAKER' },
  { pattern: /estacionamiento|parking/i, category: 'PARKING' },
  { pattern: /comida|cena|almuerzo|restaurante|meals?/i, category: 'MEALS' },
  { pattern: /vuelo|avion|airline|flight/i, category: 'FLIGHTS' },
  { pattern: /viaje|hotel|uber|taxi|travel|viaticos|viáticos|chofer/i, category: 'TRAVEL' },
  { pattern: /marketing|publicidad|pauta|ads?/i, category: 'MARKETING' },
  { pattern: /comision|comisión|commission/i, category: 'COMMISSIONS' },
  { pattern: /banco|comision banc|bank fee/i, category: 'BANK_FEES' },
];

export type Disposition =
  | 'CREATE'
  | 'LINK'
  | 'SKIP'
  | 'CONFLICT'
  | 'DEFERRED'
  | 'EXCLUDED';

export type ResolutionType =
  | 'ACCEPT_SOURCE'
  | 'ACCEPT_CALCULATED'
  | 'CORRECT_VALUE'
  | 'MAP_TO_EXISTING'
  | 'MERGE_CUSTOMERS'
  | 'KEEP_SEPARATE'
  | 'EXCLUDE_INVALID_SOURCE_BLOCK'
  | 'MARK_SERIAL_UNKNOWN'
  | 'CORRECT_SERIAL'
  | 'ACKNOWLEDGE_SCOPE_DIFFERENCE'
  | 'DEFER'
  | 'FORMULA_OVERRIDE';
