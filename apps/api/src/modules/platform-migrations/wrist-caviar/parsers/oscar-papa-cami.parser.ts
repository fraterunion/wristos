import type ExcelJS from 'exceljs';

import { PARSER_VERSION } from '../constants';
import type {
  ExternalFloatCandidate,
  MigrationError,
  MigrationManualReviewItem,
  MigrationWarning,
  SheetParseContext,
  SheetParserResult,
} from '../types/migration.types';
import {
  cellCoord,
  cellNumber,
  cellText,
  newCandidateId,
} from '../workbook/cell.util';

export function parseOscarPapaCamiSheet(
  worksheet: ExcelJS.Worksheet,
  ctx: SheetParseContext,
): SheetParserResult<ExternalFloatCandidate> {
  const records: ExternalFloatCandidate[] = [];
  const warnings: MigrationWarning[] = [];
  const errors: MigrationError[] = [];
  const manualReview: MigrationManualReviewItem[] = [];
  const notes: string[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const concept = cellText(row.getCell(1).value).trim() || cellText(row.getCell(2).value).trim();
    if (!concept || /^CTW$/i.test(concept)) return;

    let amount: number | null = null;
    let balance: number | null = null;
    for (let c = 1; c <= 12; c++) {
      const n = cellNumber(row.getCell(c).value);
      if (n == null) continue;
      if (amount == null) amount = n;
      balance = n;
    }
    if (amount == null && balance == null) return;

    const source = {
      workbookFingerprint: ctx.workbookFingerprint,
      parserVersion: PARSER_VERSION,
      sourceSheet: 'OSCAR PAPA CAMI',
      sourceRow: rowNumber,
      sourceColumnStart: 1,
      sourceColumnEnd: 8,
      sourceCellCoordinates: [cellCoord(rowNumber, 1)],
    };

    records.push({
      id: newCandidateId('oscar'),
      label: 'OSCAR_PAPA_CAMI',
      concept,
      amount,
      reportedBalance: balance,
      destination: 'DEFERRED',
      source,
    });
  });

  if (records.length > 0) {
    manualReview.push({
      code: 'DEFERRED_EXTERNAL_FLOAT',
      message: 'OSCAR PAPA CAMI tratado como float externo diferido',
      severity: 'MANUAL_REVIEW',
      category: 'deferred',
      source: records[0]?.source,
    });
  }

  notes.push(`Detected ${records.length} external float rows (DEFERRED)`);
  return { records, warnings, errors, manualReview, notes };
}
