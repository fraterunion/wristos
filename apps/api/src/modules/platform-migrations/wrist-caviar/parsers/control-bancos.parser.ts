import type ExcelJS from 'exceljs';

import { MONTH_BANNER_RE, PARSER_VERSION } from '../constants';
import type {
  BankLedgerCandidate,
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

export function parseControlBancosSheet(
  worksheet: ExcelJS.Worksheet,
  ctx: SheetParseContext,
): SheetParserResult<BankLedgerCandidate> {
  const records: BankLedgerCandidate[] = [];
  const warnings: MigrationWarning[] = [];
  const errors: MigrationError[] = [];
  const manualReview: MigrationManualReviewItem[] = [];
  const notes: string[] = [];
  let running: number | null = null;
  let totalCellPointer: number | null = null;

  // Detect drifting TOTAL SIN COMISION pointer cells in side columns
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    for (let c = 8; c <= 15; c++) {
      const t = cellText(row.getCell(c).value).toUpperCase();
      if (t.includes('TOTAL') && t.includes('COMISION')) {
        const next = cellNumber(row.getCell(c + 1).value) ?? cellNumber(worksheet.getRow(rowNumber + 1).getCell(c).value);
        if (next != null) totalCellPointer = next;
        notes.push(`Detected total-cell pointer near row ${rowNumber}`);
      }
    }
  });

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const dateVal = row.getCell(1).value;
    const dateText = cellText(dateVal).trim();
    if (MONTH_BANNER_RE.test(dateText)) return;
    if (/^FECHA$/i.test(dateText)) return;
    if (/^CTW$/i.test(dateText)) return;
    if (!isExcelDateLike(dateVal)) return;

    const reference = cellText(row.getCell(2).value).trim() || null;
    const concept = cellText(row.getCell(3).value).trim();
    if (!concept && cellNumber(row.getCell(4).value) == null && cellNumber(row.getCell(6).value) == null) {
      return;
    }

    const deposit = cellNumber(row.getCell(4).value);
    const commission = cellNumber(row.getCell(5).value);
    const withdrawal = cellNumber(row.getCell(6).value);
    const reportedBalance = cellNumber(row.getCell(7).value);
    const comment = cellText(row.getCell(8).value).trim() || null;

    let onePercentRuleStatus: BankLedgerCandidate['onePercentRuleStatus'] = 'NOT_APPLICABLE';
    if (deposit != null && deposit > 0) {
      const expected = roundMoney(deposit * 0.01);
      if (commission == null) onePercentRuleStatus = 'UNAVAILABLE';
      else if (nearlyEqual(commission, expected, 0.05)) onePercentRuleStatus = 'MATCHED';
      else {
        onePercentRuleStatus = 'MISMATCH';
        warnings.push({
          code: 'BANK_ONE_PERCENT_MISMATCH',
          message: 'Comisión no coincide con 1% del depósito',
          severity: 'WARNING',
          category: 'bank_commission',
          source: {
            workbookFingerprint: ctx.workbookFingerprint,
            parserVersion: PARSER_VERSION,
            sourceSheet: 'CONTROL BANCOS',
            sourceRow: rowNumber,
          },
        });
      }
    }

    const delta = (deposit ?? 0) - (commission ?? 0) - (withdrawal ?? 0);
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
      sourceSheet: 'CONTROL BANCOS',
      sourceRow: rowNumber,
      sourceColumnStart: 1,
      sourceColumnEnd: 8,
      sourceCellCoordinates: [cellCoord(rowNumber, 1), cellCoord(rowNumber, 7)],
    };

    if (balanceMismatch) {
      warnings.push({
        code: 'BANK_RUNNING_BALANCE_MISMATCH',
        message: 'Descuadre de saldo bancario',
        severity: 'WARNING',
        category: 'bank_balance',
        source,
      });
      if (reportedBalance != null) running = reportedBalance;
    }

    records.push({
      id: newCandidateId('bank'),
      entryDate: cellDateIso(dateVal),
      reference,
      concept: concept || '(sin concepto)',
      deposit,
      commission,
      withdrawal,
      reportedBalance,
      calculatedBalance,
      balanceMismatch,
      comment,
      onePercentRuleStatus,
      source,
    });
  });

  if (records.length > 0 && totalCellPointer != null) {
    const last = records[records.length - 1]?.reportedBalance ?? null;
    if (last != null && !nearlyEqual(last, totalCellPointer, 1)) {
      warnings.push({
        code: 'BANK_TOTAL_CELL_DRIFT',
        message: 'Celda TOTAL apunta a un saldo distinto del último movimiento del ledger',
        severity: 'WARNING',
        category: 'bank_total_drift',
      });
      notes.push('total-cell drift detected; reconciliation uses ledger sequence');
    }
  }

  notes.push(`Detected ${records.length} bank movements`);
  return { records, warnings, errors, manualReview, notes };
}
