import type ExcelJS from 'exceljs';

import { MONTH_BANNER_RE, PARSER_VERSION } from '../constants';
import type {
  ExpenseCandidate,
  MigrationError,
  MigrationManualReviewItem,
  MigrationWarning,
  SheetParseContext,
  SheetParserResult,
} from '../types/migration.types';
import {
  cellCoord,
  cellDateIso,
  cellNumber,
  cellText,
  isExcelDateLike,
  newCandidateId,
} from '../workbook/cell.util';

export function parseGastosSheet(
  worksheet: ExcelJS.Worksheet,
  ctx: SheetParseContext,
): SheetParserResult<ExpenseCandidate> {
  const records: ExpenseCandidate[] = [];
  const warnings: MigrationWarning[] = [];
  const errors: MigrationError[] = [];
  const manualReview: MigrationManualReviewItem[] = [];
  const notes: string[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const aVal = row.getCell(1).value;
    const aText = cellText(aVal).trim();
    const concept = cellText(row.getCell(2).value).trim();

    if (MONTH_BANNER_RE.test(aText)) return;
    if (/^FECHA$/i.test(aText)) return;
    if (/^CTW$/i.test(aText)) return;
    if (/total/i.test(concept) && !isExcelDateLike(aVal)) return;

    if (!isExcelDateLike(aVal)) return;
    if (!concept) return;

    const account = cellText(row.getCell(3).value).trim() || null;
    const amount = cellNumber(row.getCell(4).value);
    const source = {
      workbookFingerprint: ctx.workbookFingerprint,
      parserVersion: ctx.parserVersion || PARSER_VERSION,
      sourceSheet: 'GASTOS',
      sourceRow: rowNumber,
      sourceColumnStart: 1,
      sourceColumnEnd: 4,
      sourceCellCoordinates: [cellCoord(rowNumber, 1), cellCoord(rowNumber, 4)],
    };

    if (amount == null) {
      errors.push({
        code: 'INVALID_AMOUNT',
        message: 'Gasto con monto no parseable',
        severity: 'CRITICAL',
        category: 'amount',
        source,
      });
    }
    if (!cellDateIso(aVal)) {
      errors.push({
        code: 'INVALID_DATE',
        message: 'Gasto con fecha inválida',
        severity: 'CRITICAL',
        category: 'date',
        source,
      });
    }

    records.push({
      id: newCandidateId('exp'),
      expenseDate: cellDateIso(aVal),
      concept,
      account,
      amount,
      source,
    });
  });

  notes.push(`Detected ${records.length} expense rows`);
  return { records, warnings, errors, manualReview, notes };
}
