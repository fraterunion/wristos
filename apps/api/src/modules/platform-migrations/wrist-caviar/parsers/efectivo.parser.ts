import type ExcelJS from 'exceljs';

import { MONTH_BANNER_RE, PARSER_VERSION } from '../constants';
import type {
  CashLedgerCandidate,
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

function parseLedgerBlock(
  worksheet: ExcelJS.Worksheet,
  opts: {
    currency: 'MXN' | 'USD';
    dateCol: number;
    conceptCol: number;
    entryCol: number;
    exitCol: number;
    balanceCol: number;
    rateCol?: number;
    ctx: SheetParseContext;
  },
): SheetParserResult<CashLedgerCandidate> {
  const records: CashLedgerCandidate[] = [];
  const warnings: MigrationWarning[] = [];
  const errors: MigrationError[] = [];
  const manualReview: MigrationManualReviewItem[] = [];
  const notes: string[] = [];
  let running: number | null = null;

  const lastRow = Math.max(worksheet.rowCount, worksheet.actualRowCount ?? 0);
  for (let rowNumber = 1; rowNumber <= lastRow; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const dateVal = row.getCell(opts.dateCol).value;
    const dateText = cellText(dateVal).trim();
    if (MONTH_BANNER_RE.test(dateText)) continue;
    if (/^FECHA$/i.test(dateText)) continue;
    if (/^CTW$/i.test(dateText)) continue;
    if (/^DOLARES$/i.test(dateText)) continue;
    if (!isExcelDateLike(dateVal)) continue;

    const concept = cellText(row.getCell(opts.conceptCol).value).trim();
    if (!concept) continue;

    const entryAmount = cellNumber(row.getCell(opts.entryCol).value);
    const exitAmount = cellNumber(row.getCell(opts.exitCol).value);
    const reportedBalance = cellNumber(row.getCell(opts.balanceCol).value);
    const exchangeRate =
      opts.rateCol != null ? cellNumber(row.getCell(opts.rateCol).value) : null;

    const delta = (entryAmount ?? 0) - (exitAmount ?? 0);
    if (running == null) {
      running =
        reportedBalance != null
          ? reportedBalance
          : roundMoney(delta);
    } else {
      running = roundMoney(running + delta);
    }
    const calculatedBalance = running;
    const balanceMismatch =
      reportedBalance != null && !nearlyEqual(reportedBalance, calculatedBalance, 0.05);

    const hidden = Boolean(row.hidden);
    const source = {
      workbookFingerprint: opts.ctx.workbookFingerprint,
      parserVersion: opts.ctx.parserVersion || PARSER_VERSION,
      sourceSheet: 'EFECTIVO',
      sourceRow: rowNumber,
      sourceColumnStart: opts.dateCol,
      sourceColumnEnd: opts.balanceCol,
      sourceCellCoordinates: [
        cellCoord(rowNumber, opts.dateCol),
        cellCoord(rowNumber, opts.balanceCol),
      ],
    };

    if (balanceMismatch) {
      warnings.push({
        code: 'CASH_RUNNING_BALANCE_MISMATCH',
        message: `Descuadre de saldo ${opts.currency}`,
        severity: 'WARNING',
        category: 'cash_balance',
        source,
      });
      // Resync to reported to avoid cascading false positives
      if (reportedBalance != null) running = reportedBalance;
    }

    records.push({
      id: newCandidateId(`cash_${opts.currency.toLowerCase()}`),
      currency: opts.currency,
      entryDate: cellDateIso(dateVal),
      concept,
      entryAmount,
      exitAmount,
      exchangeRate,
      reportedBalance,
      calculatedBalance,
      balanceMismatch,
      hidden,
      source,
    });
  }

  notes.push(`${opts.currency}: ${records.length} movements`);
  return { records, warnings, errors, manualReview, notes };
}

export function parseEfectivoSheet(
  worksheet: ExcelJS.Worksheet,
  ctx: SheetParseContext,
): SheetParserResult<CashLedgerCandidate> {
  const mxn = parseLedgerBlock(worksheet, {
    currency: 'MXN',
    dateCol: 1,
    conceptCol: 2,
    entryCol: 3,
    exitCol: 4,
    balanceCol: 5,
    ctx,
  });
  const usd = parseLedgerBlock(worksheet, {
    currency: 'USD',
    dateCol: 7,
    conceptCol: 8,
    entryCol: 9,
    rateCol: 10,
    exitCol: 11,
    balanceCol: 12,
    ctx,
  });

  return {
    records: [...mxn.records, ...usd.records],
    warnings: [...mxn.warnings, ...usd.warnings],
    errors: [...mxn.errors, ...usd.errors],
    manualReview: [...mxn.manualReview, ...usd.manualReview],
    notes: [...mxn.notes, ...usd.notes, `hiddenRowsParsed=${mxn.records.filter((r) => r.hidden).length}`],
  };
}
