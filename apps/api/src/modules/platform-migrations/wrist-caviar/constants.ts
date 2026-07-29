export const PARSER_VERSION = 'wrist-caviar-master-xlsx-v1' as const;

export const REQUIRED_CORE_SHEETS = ['VENTAS', 'INVENTARIO', 'REPORTE'] as const;

export const RECOGNIZED_SHEETS = [
  'REPORTE',
  'CUENTA CESAR',
  'GASTOS',
  'OSCAR PAPA CAMI',
  'CTAS X PAGAR',
  'CRIPTO CESAR',
  'CTAS X COBRAR',
  'INVENTARIO',
  'EFECTIVO',
  'VENTAS',
  'COBRO UTILIDADES',
  'CONTROL BANCOS',
] as const;

export type RecognizedSheetName = (typeof RECOGNIZED_SHEETS)[number];

export const MONTH_BANNER_RE =
  /^(JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE|ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO)$/i;

export const DEFAULT_MAX_FILE_MB = 25;
export const DEFAULT_MAX_ROWS_PER_SHEET = 10_000;
export const XLSX_ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
export const MONEY_TOLERANCE = 0.02;
export const CESAR_PROFIT_SHARE = 0.75;
export const EDGAR_PROFIT_SHARE = 0.25;

export function maxFileBytes(): number {
  const raw = Number(process.env.WRIST_CAVIAR_MIGRATION_MAX_FILE_MB);
  const mb = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_FILE_MB;
  return Math.floor(mb * 1024 * 1024);
}

export function maxRowsPerSheet(): number {
  const raw = Number(process.env.WRIST_CAVIAR_MIGRATION_MAX_ROWS_PER_SHEET);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_ROWS_PER_SHEET;
}
