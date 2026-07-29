import type ExcelJS from 'exceljs';

import { PARSER_VERSION } from '../constants';
import type {
  MigrationError,
  MigrationManualReviewItem,
  MigrationWarning,
  PartnerLedgerCandidate,
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

export function parseCuentaCesarSheet(
  worksheet: ExcelJS.Worksheet,
  ctx: SheetParseContext,
): SheetParserResult<PartnerLedgerCandidate> {
  const records: PartnerLedgerCandidate[] = [];
  const warnings: MigrationWarning[] = [];
  const errors: MigrationError[] = [];
  const manualReview: MigrationManualReviewItem[] = [];
  const notes: string[] = [];
  let running: number | null = null;

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const dateVal = row.getCell(1).value;
    const dateText = cellText(dateVal).trim();
    if (/^FECHA$/i.test(dateText) || /^CTW$/i.test(dateText)) return;
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
      parserVersion: ctx.parserVersion || PARSER_VERSION,
      sourceSheet: 'CUENTA CESAR',
      sourceRow: rowNumber,
      sourceColumnStart: 1,
      sourceColumnEnd: 5,
      sourceCellCoordinates: [cellCoord(rowNumber, 1), cellCoord(rowNumber, 5)],
    };

    if (balanceMismatch) {
      warnings.push({
        code: 'PARTNER_LEDGER_MISMATCH',
        message: 'Descuadre en CUENTA CESAR',
        severity: 'WARNING',
        category: 'partner_ledger',
        source,
      });
      if (reportedBalance != null) running = reportedBalance;
    }

    records.push({
      id: newCandidateId('cesar'),
      entryDate: cellDateIso(dateVal),
      concept,
      entryAmount,
      exitAmount,
      reportedBalance,
      calculatedBalance,
      balanceMismatch,
      classification: 'UNCLASSIFIED',
      source,
    });
  });

  if (records.length > 0) {
    manualReview.push({
      code: 'UNCLASSIFIED_CESAR_MOVEMENT',
      message: `${records.length} movimientos de CUENTA CESAR sin clasificación determinística`,
      severity: 'MANUAL_REVIEW',
      category: 'partner_ledger',
      source: records[0]?.source,
    });
  }

  notes.push(`Detected ${records.length} Cesar ledger movements`);
  return { records, warnings, errors, manualReview, notes };
}
