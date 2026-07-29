import type ExcelJS from 'exceljs';

import { PARSER_VERSION } from '../constants';
import type {
  InventoryCandidate,
  MigrationError,
  MigrationManualReviewItem,
  MigrationWarning,
  SheetParseContext,
  SheetParserResult,
} from '../types/migration.types';
import {
  cellCoord,
  cellFormula,
  cellNumber,
  cellText,
  extractFxRateFromFormula,
  newCandidateId,
} from '../workbook/cell.util';

function isJunkBrand(brand: string): boolean {
  const b = brand.trim().toUpperCase();
  if (!b) return true;
  return /^(CTW|MARCA|TOTAL|MODELO|REF|SERIE|COSTO|INVENTARIO)$/i.test(b);
}

function isPollutedSerial(serial: string | null): boolean {
  if (!serial) return false;
  const s = serial.trim().toUpperCase();
  return /^(DOLARES|PESOS|USD|MXN)$/i.test(s) || /^\d{9,}$/.test(s);
}

export function parseInventarioSheet(
  worksheet: ExcelJS.Worksheet,
  ctx: SheetParseContext,
): SheetParserResult<InventoryCandidate> {
  const records: InventoryCandidate[] = [];
  const warnings: MigrationWarning[] = [];
  const errors: MigrationError[] = [];
  const manualReview: MigrationManualReviewItem[] = [];
  const notes: string[] = [];
  const serialIndex = new Map<string, number[]>();

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const brand = cellText(row.getCell(1).value).trim();
    const model = cellText(row.getCell(2).value).trim();
    if (isJunkBrand(brand)) return;
    // Spacer rows that only carry shared cost formulas
    if (!model && cellNumber(row.getCell(5).value) == null) return;

    const reference = cellText(row.getCell(3).value).trim() || null;
    const serialRaw = cellText(row.getCell(4).value).trim() || null;
    const costCell = row.getCell(5).value;
    const cost = cellNumber(costCell);
    const usd = cellNumber(row.getCell(6).value);
    const extras = cellNumber(row.getCell(7).value);
    const totalCost = cellNumber(row.getCell(8).value) ?? cost;
    const formula = cellFormula(costCell);
    const fx = extractFxRateFromFormula(formula);
    const currencyContext = fx != null ? `FX_FORMULA_RATE=${fx}` : null;

    const source = {
      workbookFingerprint: ctx.workbookFingerprint,
      parserVersion: ctx.parserVersion || PARSER_VERSION,
      sourceSheet: 'INVENTARIO',
      sourceRow: rowNumber,
      sourceColumnStart: 1,
      sourceColumnEnd: 8,
      sourceCellCoordinates: [cellCoord(rowNumber, 1), cellCoord(rowNumber, 8)],
    };

    if (!reference) {
      warnings.push({
        code: 'MISSING_REFERENCE',
        message: 'Inventario sin referencia',
        severity: 'WARNING',
        category: 'inventory',
        source,
      });
    }
    if (!serialRaw) {
      warnings.push({
        code: 'MISSING_SERIAL',
        message: 'Inventario sin número de serie',
        severity: 'WARNING',
        category: 'inventory',
        source,
      });
    }
    if (isPollutedSerial(serialRaw)) {
      warnings.push({
        code: 'SPARSE_OR_POLLUTED_SERIAL',
        message: 'Serie de inventario sospechosa',
        severity: 'WARNING',
        category: 'serial',
        source,
      });
    }
    if (cost == null && totalCost == null) {
      errors.push({
        code: 'INVALID_AMOUNT',
        message: 'Inventario sin costo parseable',
        severity: 'CRITICAL',
        category: 'amount',
        source,
      });
    }

    if (serialRaw && !isPollutedSerial(serialRaw)) {
      const key = serialRaw.toUpperCase();
      const list = serialIndex.get(key) ?? [];
      list.push(rowNumber);
      serialIndex.set(key, list);
    }

    records.push({
      id: newCandidateId('inv'),
      brand,
      model,
      reference,
      serial: serialRaw,
      cost,
      usd,
      extras,
      totalCost,
      currencyContext,
      source,
    });
  });

  for (const [, rows] of serialIndex) {
    if (rows.length > 1) {
      for (const r of rows) {
        errors.push({
          code: 'DUPLICATE_INVENTORY_SERIAL',
          message: 'Serie duplicada exacta en inventario',
          severity: 'CRITICAL',
          category: 'serial',
          source: {
            workbookFingerprint: ctx.workbookFingerprint,
            parserVersion: PARSER_VERSION,
            sourceSheet: 'INVENTARIO',
            sourceRow: r,
          },
        });
      }
    }
  }

  notes.push(`Detected ${records.length} inventory rows`);
  return { records, warnings, errors, manualReview, notes };
}
