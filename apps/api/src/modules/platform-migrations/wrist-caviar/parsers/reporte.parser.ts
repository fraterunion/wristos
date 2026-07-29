import type { CellValue, Worksheet } from 'exceljs';

import { PARSER_VERSION } from '../constants';
import type {
  MigrationError,
  MigrationManualReviewItem,
  MigrationWarning,
  ReportedBalance,
  SheetParseContext,
  SheetParserResult,
} from '../types/migration.types';
import {
  cellCoord,
  cellFormula,
  cellNumber,
  cellText,
  hasFormulaError,
} from '../workbook/cell.util';

export function parseReporteSheet(
  worksheet: Worksheet,
  ctx: SheetParseContext,
): SheetParserResult<ReportedBalance> {
  const records: ReportedBalance[] = [];
  const warnings: MigrationWarning[] = [];
  const errors: MigrationError[] = [];
  const manualReview: MigrationManualReviewItem[] = [];
  const notes: string[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const label = cellText(row.getCell(1).value).trim();
    const mxnVal = row.getCell(2).value;
    const usdVal = row.getCell(3).value;
    const mxn = cellNumber(mxnVal);
    const usd = cellNumber(usdVal);

    if (!label && mxn == null && usd == null) return;
    if (/^PESOS$/i.test(label) || /^DOLARES$/i.test(label)) return;

    const push = (
      concept: string,
      currency: 'MXN' | 'USD',
      value: number | null,
      cellValue: CellValue,
      col: number,
    ) => {
      if (value == null && !cellFormula(cellValue) && cellValue == null) return;
      const formulaError = hasFormulaError(cellValue);
      const source = {
        workbookFingerprint: ctx.workbookFingerprint,
        parserVersion: PARSER_VERSION,
        sourceSheet: 'REPORTE',
        sourceRow: rowNumber,
        sourceColumnStart: col,
        sourceColumnEnd: col,
        sourceCellCoordinates: [cellCoord(rowNumber, col)],
      };
      if (formulaError) {
        errors.push({
          code: 'FORMULA_ERROR',
          message: `Fórmula con error en REPORTE ${concept}`,
          severity: 'CRITICAL',
          category: 'formula',
          source,
        });
      }
      records.push({
        concept: concept || `ROW_${rowNumber}_${currency}`,
        currency,
        value,
        formula: cellFormula(cellValue),
        formulaError,
        sourceCells: [cellCoord(rowNumber, col)],
        source,
      });
    };

    const concept = label || `ROW_${rowNumber}`;
    if (mxn != null || cellFormula(mxnVal)) push(concept, 'MXN', mxn, mxnVal, 2);
    if (usd != null || cellFormula(usdVal)) push(concept, 'USD', usd, usdVal, 3);

    // Combined check column
    const dVal = row.getCell(4).value;
    const d = cellNumber(dVal);
    if (d != null || cellFormula(dVal)) {
      push(`${concept}_COMBINED`, 'MXN', d, dVal, 4);
    }
  });

  notes.push(`Detected ${records.length} reported balances`);
  return { records, warnings, errors, manualReview, notes };
}
