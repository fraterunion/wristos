import type ExcelJS from 'exceljs';

import { MONTH_BANNER_RE, PARSER_VERSION } from '../constants';
import type {
  MigrationError,
  MigrationManualReviewItem,
  MigrationWarning,
  SaleCandidate,
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

function isHeaderRow(a: string, b: string): boolean {
  const A = a.toUpperCase();
  const B = b.toUpperCase();
  return A.includes('FECHA') && (B.includes('CLIENTE') || A.includes('VENTA'));
}

function isSparseSerial(serial: string | null): boolean {
  if (!serial) return false;
  const s = serial.trim().toUpperCase();
  if (!s) return false;
  if (/^(DOLARES|PESOS|USD|MXN|CASH|EFECTIVO)$/i.test(s)) return true;
  if (/^\d{8,}$/.test(s) && Number(s) > 1_000_000) return true;
  return false;
}

export function parseVentasSheet(
  worksheet: ExcelJS.Worksheet,
  ctx: SheetParseContext,
): SheetParserResult<SaleCandidate> {
  const records: SaleCandidate[] = [];
  const warnings: MigrationWarning[] = [];
  const errors: MigrationError[] = [];
  const manualReview: MigrationManualReviewItem[] = [];
  const notes: string[] = [];
  const serialIndex = new Map<string, number[]>();

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const aVal = row.getCell(1).value;
    const aText = cellText(aVal).trim();
    const bText = cellText(row.getCell(2).value).trim();

    if (MONTH_BANNER_RE.test(aText)) return;
    if (isHeaderRow(aText, bText)) return;
    if (/^CTW$/i.test(aText)) return;

    if (!isExcelDateLike(aVal)) return;
    if (!bText) return;

    const cost = cellNumber(row.getCell(7).value);
    const salePrice = cellNumber(row.getCell(8).value);
    const extras = cellNumber(row.getCell(9).value);
    const declaredProfit = cellNumber(row.getCell(10).value);
    const paymentCount = cellNumber(row.getCell(11).value);

    const calculatedProfit =
      salePrice == null
        ? null
        : roundMoney(salePrice - (cost ?? 0) - (extras ?? 0));

    const profitMismatch =
      declaredProfit != null &&
      calculatedProfit != null &&
      !nearlyEqual(declaredProfit, calculatedProfit, 0.05);

    const serialRaw = cellText(row.getCell(6).value).trim() || null;
    const serial = isSparseSerial(serialRaw) ? serialRaw : serialRaw;

    const source = {
      workbookFingerprint: ctx.workbookFingerprint,
      parserVersion: ctx.parserVersion || PARSER_VERSION,
      sourceSheet: 'VENTAS',
      sourceRow: rowNumber,
      sourceColumnStart: 1,
      sourceColumnEnd: 11,
      sourceCellCoordinates: [cellCoord(rowNumber, 1), cellCoord(rowNumber, 11)],
    };

    if (serialRaw && isSparseSerial(serialRaw)) {
      warnings.push({
        code: 'SPARSE_OR_POLLUTED_SERIAL',
        message: 'Número de serie sospechoso en venta',
        severity: 'WARNING',
        category: 'serial',
        source,
      });
    }

    if (profitMismatch) {
      warnings.push({
        code: 'SALE_PROFIT_MISMATCH',
        message: 'Utilidad declarada ≠ precio − costo − extras',
        severity: 'WARNING',
        category: 'profit',
        source,
      });
    }

    if (cost == null && salePrice == null) {
      errors.push({
        code: 'INVALID_AMOUNT',
        message: 'Venta sin costo ni precio parseable',
        severity: 'CRITICAL',
        category: 'amount',
        source,
      });
    }

    const id = newCandidateId('sale');
    const candidate: SaleCandidate = {
      id,
      saleDate: cellDateIso(aVal),
      customerName: bText,
      brand: cellText(row.getCell(3).value).trim(),
      model: cellText(row.getCell(4).value).trim(),
      reference: cellText(row.getCell(5).value).trim() || null,
      serial,
      cost,
      salePrice,
      extras,
      declaredProfit,
      calculatedProfit,
      profitMismatch,
      paymentCount,
      source,
    };
    records.push(candidate);

    if (serial && !isSparseSerial(serial)) {
      const key = serial.trim().toUpperCase();
      const list = serialIndex.get(key) ?? [];
      list.push(rowNumber);
      serialIndex.set(key, list);
    }
  });

  for (const [, rows] of serialIndex) {
    if (rows.length > 1) {
      for (const r of rows) {
        warnings.push({
          code: 'DUPLICATE_SOLD_SERIAL',
          message: 'Número de serie duplicado en VENTAS',
          severity: 'WARNING',
          category: 'serial',
          source: {
            workbookFingerprint: ctx.workbookFingerprint,
            parserVersion: PARSER_VERSION,
            sourceSheet: 'VENTAS',
            sourceRow: r,
          },
        });
      }
    }
  }

  notes.push(`Detected ${records.length} sale rows`);
  return { records, warnings, errors, manualReview, notes };
}
