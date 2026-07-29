import type ExcelJS from 'exceljs';

import { CESAR_PROFIT_SHARE, EDGAR_PROFIT_SHARE, PARSER_VERSION } from '../constants';
import type {
  MigrationError,
  MigrationManualReviewItem,
  MigrationWarning,
  ProfitDistributionCandidate,
  SheetParseContext,
  SheetParserResult,
} from '../types/migration.types';
import {
  cellCoord,
  cellNumber,
  cellText,
  nearlyEqual,
  newCandidateId,
  roundMoney,
} from '../workbook/cell.util';

/**
 * COBRO UTILIDADES: month columns with CESAR 75% / EDGAR 25% matrices.
 * Structure varies; we parse numeric month cells under partner labels.
 */
export function parseCobroUtilidadesSheet(
  worksheet: ExcelJS.Worksheet,
  ctx: SheetParseContext,
): SheetParserResult<ProfitDistributionCandidate> {
  const records: ProfitDistributionCandidate[] = [];
  const warnings: MigrationWarning[] = [];
  const errors: MigrationError[] = [];
  const manualReview: MigrationManualReviewItem[] = [];
  const notes: string[] = [];

  let currentPartner: 'CESAR' | 'EDGAR' | 'UNKNOWN' = 'UNKNOWN';
  let monthHeaders: Array<{ col: number; label: string }> = [];
  let section: 'ACCRUED' | 'COLLECTED' | 'OUTSTANDING' | null = null;

  const lastRow = Math.max(worksheet.rowCount, worksheet.actualRowCount ?? 0);
  for (let r = 1; r <= Math.min(lastRow, 40); r++) {
    const row = worksheet.getRow(r);
    const a = cellText(row.getCell(1).value).trim().toUpperCase();

    if (a.includes('CESAR')) currentPartner = 'CESAR';
    if (a.includes('EDGAR')) currentPartner = 'EDGAR';

    const headers: Array<{ col: number; label: string }> = [];
    for (let c = 1; c <= 20; c++) {
      const t = cellText(row.getCell(c).value).trim();
      if (
        t &&
        /^(AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE|ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO)$/i.test(
          t,
        )
      ) {
        headers.push({ col: c, label: t.toUpperCase() });
      }
    }
    if (headers.length >= 2) monthHeaders = headers;

    if (a.includes('COBRADO') || a.includes('COBRADA')) section = 'COLLECTED';
    else if (a.includes('POR COBRAR')) section = 'OUTSTANDING';
    else if (a.includes('UTILIDAD') || a.includes('ACUMUL')) section = 'ACCRUED';

    if (!monthHeaders.length || currentPartner === 'UNKNOWN') continue;

    // Header-only rows: skip emitting amounts when the row itself is month labels
    if (headers.length >= 2) continue;

    for (const mh of monthHeaders) {
      const amount = cellNumber(row.getCell(mh.col).value);
      if (amount == null) continue;
      // Skip pure header rows
      if (/^(AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE|ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO)$/i.test(
        cellText(row.getCell(mh.col).value).trim(),
      )) {
        continue;
      }

      const expectedShare =
        currentPartner === 'CESAR'
          ? CESAR_PROFIT_SHARE
          : currentPartner === 'EDGAR'
            ? EDGAR_PROFIT_SHARE
            : null;

      const source = {
        workbookFingerprint: ctx.workbookFingerprint,
        parserVersion: PARSER_VERSION,
        sourceSheet: 'COBRO UTILIDADES',
        sourceRow: r,
        sourceColumnStart: mh.col,
        sourceColumnEnd: mh.col,
        sourceCellCoordinates: [cellCoord(r, mh.col)],
      };

      records.push({
        id: newCandidateId('util'),
        partner: currentPartner,
        monthLabel: mh.label,
        accrued: section === 'ACCRUED' ? amount : null,
        collected: section === 'COLLECTED' ? amount : null,
        outstanding: section === 'OUTSTANDING' ? amount : null,
        expectedShare,
        shareMismatch: false,
        source,
      });
    }
  }

  // Validate 75/25 across paired month accrued totals when both partners present
  const byMonth = new Map<string, { cesar?: number; edgar?: number }>();
  for (const rec of records) {
    if (rec.accrued == null || !rec.monthLabel) continue;
    const slot = byMonth.get(rec.monthLabel) ?? {};
    if (rec.partner === 'CESAR') slot.cesar = rec.accrued;
    if (rec.partner === 'EDGAR') slot.edgar = rec.accrued;
    byMonth.set(rec.monthLabel, slot);
  }
  for (const [month, pair] of byMonth) {
    if (pair.cesar == null || pair.edgar == null) continue;
    const total = pair.cesar + pair.edgar;
    if (total === 0) continue;
    const cesarShare = pair.cesar / total;
    const edgarShare = pair.edgar / total;
    if (!nearlyEqual(cesarShare, CESAR_PROFIT_SHARE, 0.02) || !nearlyEqual(edgarShare, EDGAR_PROFIT_SHARE, 0.02)) {
      warnings.push({
        code: 'PROFIT_SPLIT_MISMATCH',
        message: `Split 75/25 no cuadra en ${month}`,
        severity: 'WARNING',
        category: 'profit_split',
      });
      for (const rec of records) {
        if (rec.monthLabel === month && rec.accrued != null) rec.shareMismatch = true;
      }
    }
  }

  notes.push(`Detected ${records.length} utility cells; validated 75/25 where paired`);
  void roundMoney;
  return { records, warnings, errors, manualReview, notes };
}
