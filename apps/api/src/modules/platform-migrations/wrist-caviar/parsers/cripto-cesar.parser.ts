import type ExcelJS from 'exceljs';

import { PARSER_VERSION } from '../constants';
import type {
  CryptoLedgerCandidate,
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
  nearlyEqual,
  newCandidateId,
  roundMoney,
} from '../workbook/cell.util';

export function parseCriptoCesarSheet(
  worksheet: ExcelJS.Worksheet,
  ctx: SheetParseContext,
): SheetParserResult<CryptoLedgerCandidate> {
  const records: CryptoLedgerCandidate[] = [];
  const warnings: MigrationWarning[] = [];
  const errors: MigrationError[] = [];
  const manualReview: MigrationManualReviewItem[] = [];
  const notes: string[] = [];
  let running: number | null = null;

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const dateVal = row.getCell(1).value;
    if (!isExcelDateLike(dateVal)) return;
    const concept = cellText(row.getCell(2).value).trim();
    if (!concept) return;
    const entryAmount = cellNumber(row.getCell(3).value);
    const exitAmount = cellNumber(row.getCell(4).value);
    const reportedBalance = cellNumber(row.getCell(5).value);
    const delta = (entryAmount ?? 0) - (exitAmount ?? 0);
    if (running == null) {
      running = reportedBalance != null ? reportedBalance : roundMoney(delta);
    } else {
      running = roundMoney(running + delta);
    }
    const calculatedBalance = running;
    const balanceMismatch =
      reportedBalance != null && !nearlyEqual(reportedBalance, calculatedBalance, 0.05);
    const source = {
      workbookFingerprint: ctx.workbookFingerprint,
      parserVersion: PARSER_VERSION,
      sourceSheet: 'CRIPTO CESAR',
      sourceRow: rowNumber,
      sourceColumnStart: 1,
      sourceColumnEnd: 5,
      sourceCellCoordinates: [cellCoord(rowNumber, 1), cellCoord(rowNumber, 5)],
    };
    if (balanceMismatch && reportedBalance != null) running = reportedBalance;
    records.push({
      id: newCandidateId('crypto'),
      entryDate: cellDateIso(dateVal),
      concept,
      entryAmount,
      exitAmount,
      reportedBalance,
      calculatedBalance,
      balanceMismatch,
      destination: 'DEFERRED',
      source,
    });
  });

  if (records.length > 0) {
    manualReview.push({
      code: 'DEFERRED_CRYPTO_DESTINATION',
      message: 'CRIPTO CESAR sin destino WristOS exacto — diferido',
      severity: 'MANUAL_REVIEW',
      category: 'deferred',
      source: records[0]?.source,
    });
  }

  notes.push(`Detected ${records.length} crypto ledger rows (DEFERRED)`);
  return { records, warnings, errors, manualReview, notes };
}
