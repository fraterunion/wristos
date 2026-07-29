import type ExcelJS from 'exceljs';

import { PARSER_VERSION } from '../constants';
import type {
  MigrationError,
  MigrationManualReviewItem,
  MigrationWarning,
  ReceivableCandidate,
  ReceivablePaymentCandidate,
  SheetParseContext,
  SheetParserResult,
} from '../types/migration.types';
import {
  cellCoord,
  cellDateIso,
  cellNumber,
  cellText,
  colLetter,
  hasFormulaError,
  nearlyEqual,
  newCandidateId,
  roundMoney,
} from '../workbook/cell.util';

type Region = {
  labelCol: number;
  valueCol: number;
  metaCol: number;
  dateCol: number;
  currency: 'MXN' | 'USD';
};

const LEFT: Region = { dateCol: 1, labelCol: 2, valueCol: 3, metaCol: 4, currency: 'MXN' };
const RIGHT: Region = { dateCol: 6, labelCol: 7, valueCol: 8, metaCol: 9, currency: 'USD' };

type CardDraft = {
  startRow: number;
  endRow: number;
  customerName: string;
  accountDate: string | null;
  principal: number | null;
  watchOrConcept: string | null;
  payments: ReceivablePaymentCandidate[];
  declaredOutstanding: number | null;
  formulaError: boolean;
  region: Region;
};

function labelOf(row: ExcelJS.Row, region: Region): string {
  return cellText(row.getCell(region.labelCol).value).trim().toUpperCase();
}

function isClientLabel(label: string): boolean {
  return /^CLIENTE\s*:?$/.test(label) || label === 'CLIENTE:';
}

function isMontoLabel(label: string): boolean {
  return /^MONTO(\s*\d+)?\s*:?$/.test(label);
}

function isPagoLabel(label: string): boolean {
  return /^PAGO\s*\d+\s*:?$/.test(label) || /^PAGO\s*\d+$/.test(label);
}

function isPorCobrar(label: string): boolean {
  return label.includes('POR COBRAR');
}

function isTemplateName(name: string): boolean {
  const n = name.trim().toUpperCase();
  return n === 'PEPE' || n === 'EJEMPLO' || n.startsWith('EJEMPLO');
}

function scanRegion(
  worksheet: ExcelJS.Worksheet,
  region: Region,
  ctx: SheetParseContext,
): { cards: CardDraft[]; issues: MigrationManualReviewItem[] } {
  const cards: CardDraft[] = [];
  const issues: MigrationManualReviewItem[] = [];
  const lastRow = Math.max(worksheet.rowCount, worksheet.actualRowCount ?? 0);
  let current: CardDraft | null = null;

  const flush = () => {
    if (!current) return;
    if (isTemplateName(current.customerName)) {
      current = null;
      return;
    }
    cards.push(current);
    current = null;
  };

  for (let r = 1; r <= lastRow; r++) {
    const row = worksheet.getRow(r);
    const label = labelOf(row, region);
    if (!label && !current) continue;

    if (isClientLabel(label)) {
      flush();
      const customerName = cellText(row.getCell(region.valueCol).value).trim();
      current = {
        startRow: r,
        endRow: r,
        customerName,
        accountDate: null,
        principal: null,
        watchOrConcept: cellText(row.getCell(region.metaCol).value).trim() || null,
        payments: [],
        declaredOutstanding: null,
        formulaError: false,
        region,
      };
      continue;
    }

    if (!current) continue;
    current.endRow = r;

    if (isMontoLabel(label)) {
      const val = row.getCell(region.valueCol).value;
      if (hasFormulaError(val)) current.formulaError = true;
      const amount = cellNumber(val);
      if (current.principal == null) current.principal = amount;
      else if (amount != null) current.principal = roundMoney((current.principal ?? 0) + amount);
      const dateFromLeft = cellDateIso(row.getCell(region.dateCol).value);
      if (dateFromLeft) current.accountDate = dateFromLeft;
      const concept = cellText(row.getCell(region.metaCol).value).trim();
      if (concept) current.watchOrConcept = concept;
      continue;
    }

    if (isPagoLabel(label)) {
      const val = row.getCell(region.valueCol).value;
      if (hasFormulaError(val)) current.formulaError = true;
      const amount = cellNumber(val);
      const note = cellText(row.getCell(region.metaCol).value).trim() || null;
      const paymentDate = cellDateIso(row.getCell(region.dateCol).value);
      // Never invent payment amounts
      if (amount == null && !note) continue;
      current.payments.push({
        id: newCandidateId('cxc_pay'),
        label: cellText(row.getCell(region.labelCol).value).trim(),
        amount,
        paymentDate,
        note,
        source: {
          workbookFingerprint: ctx.workbookFingerprint,
          parserVersion: PARSER_VERSION,
          sourceSheet: 'CTAS X COBRAR',
          sourceRow: r,
          sourceColumnStart: region.dateCol,
          sourceColumnEnd: region.metaCol,
          sourceCellCoordinates: [cellCoord(r, region.valueCol)],
        },
      });
      continue;
    }

    if (isPorCobrar(label)) {
      const val = row.getCell(region.valueCol).value;
      if (hasFormulaError(val)) current.formulaError = true;
      current.declaredOutstanding = cellNumber(val);
      continue;
    }
  }
  flush();

  return { cards, issues };
}

export function parseCuentasPorCobrarSheet(
  worksheet: ExcelJS.Worksheet,
  ctx: SheetParseContext,
): SheetParserResult<ReceivableCandidate> {
  const records: ReceivableCandidate[] = [];
  const warnings: MigrationWarning[] = [];
  const errors: MigrationError[] = [];
  const manualReview: MigrationManualReviewItem[] = [];
  const notes: string[] = [];

  for (const region of [LEFT, RIGHT]) {
    const { cards } = scanRegion(worksheet, region, ctx);
    for (const card of cards) {
      if (!card.customerName) {
        const blockId = `${colLetter(region.dateCol)}${card.startRow}:${colLetter(region.metaCol)}${card.endRow}`;
        const source = {
          workbookFingerprint: ctx.workbookFingerprint,
          parserVersion: PARSER_VERSION,
          sourceSheet: 'CTAS X COBRAR',
          sourceRow: card.startRow,
          sourceColumnStart: region.dateCol,
          sourceColumnEnd: region.metaCol,
          sourceBlockId: blockId,
          sourceCellCoordinates: [
            `${colLetter(region.dateCol)}${card.startRow}`,
            `${colLetter(region.metaCol)}${card.endRow}`,
          ],
        };
        manualReview.push({
          code: 'AMBIGUOUS_CXC_BLOCK',
          message: 'Bloque CXC sin cliente identificable',
          severity: 'MANUAL_REVIEW',
          category: 'cxc',
          source,
        });
        records.push({
          id: newCandidateId('cxc'),
          customerName: '(sin cliente)',
          principal: card.principal,
          watchOrConcept: card.watchOrConcept,
          declaredOutstanding: card.declaredOutstanding,
          calculatedOutstanding: null,
          balanceMismatch: false,
          currency: region.currency,
          payments: card.payments,
          source,
          ambiguous: true,
        });
        continue;
      }

      const paid = roundMoney(
        card.payments.reduce((sum, p) => sum + (p.amount ?? 0), 0),
      );
      const calculatedOutstanding =
        card.principal == null ? null : roundMoney(card.principal - paid);
      const balanceMismatch =
        card.declaredOutstanding != null &&
        calculatedOutstanding != null &&
        !nearlyEqual(card.declaredOutstanding, calculatedOutstanding, 0.05);

      const ambiguous =
        card.principal == null ||
        card.formulaError ||
        (card.declaredOutstanding == null && card.payments.some((p) => p.amount == null));

      const blockId = `${colLetter(region.dateCol)}${card.startRow}:${colLetter(region.metaCol)}${card.endRow}`;
      const source = {
        workbookFingerprint: ctx.workbookFingerprint,
        parserVersion: PARSER_VERSION,
        sourceSheet: 'CTAS X COBRAR',
        sourceRow: card.startRow,
        sourceColumnStart: region.dateCol,
        sourceColumnEnd: region.metaCol,
        sourceBlockId: blockId,
        sourceCellCoordinates: [
          `${colLetter(region.dateCol)}${card.startRow}`,
          `${colLetter(region.metaCol)}${card.endRow}`,
        ],
      };

      if (balanceMismatch) {
        warnings.push({
          code: 'RECEIVABLE_BALANCE_MISMATCH',
          message: 'Saldo CXC declarado ≠ principal − pagos',
          severity: 'WARNING',
          category: 'cxc_balance',
          source,
        });
      }
      if (card.formulaError) {
        errors.push({
          code: 'FORMULA_ERROR',
          message: 'Fórmula rota en bloque CXC',
          severity: 'CRITICAL',
          category: 'formula',
          source,
        });
      }
      if (ambiguous) {
        manualReview.push({
          code: 'AMBIGUOUS_CXC_BLOCK',
          message: 'Bloque CXC ambiguo — revisión manual',
          severity: 'MANUAL_REVIEW',
          category: 'cxc',
          source,
        });
      }

      records.push({
        id: newCandidateId('cxc'),
        customerName: card.customerName,
        principal: card.principal,
        watchOrConcept: card.watchOrConcept,
        declaredOutstanding: card.declaredOutstanding,
        calculatedOutstanding,
        balanceMismatch,
        currency: region.currency,
        payments: card.payments,
        source,
        ambiguous,
      });
    }
  }

  notes.push(`Detected ${records.length} receivable cards`);
  return { records, warnings, errors, manualReview, notes };
}
