import type ExcelJS from 'exceljs';

import { PARSER_VERSION } from '../constants';
import type {
  MigrationError,
  MigrationManualReviewItem,
  MigrationWarning,
  PayableCandidate,
  PayablePaymentCandidate,
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

function labelOf(row: ExcelJS.Row, region: Region): string {
  return cellText(row.getCell(region.labelCol).value).trim().toUpperCase();
}

function isCreditorLabel(label: string): boolean {
  // Preserve AACREDOR typo as valid creditor marker
  const compact = label.replace(/\s+/g, '');
  return /A+CREDOR:?$/.test(compact) || compact.includes('ACREDOR');
}

function isMontoLabel(label: string): boolean {
  return /^MONTO(\s*\d+)?\s*:?$/.test(label);
}

function isPagoLabel(label: string): boolean {
  return /^PAGO\s*\d+\s*:?$/.test(label) || /^PAGO\s*\d+$/.test(label);
}

function isResidualLabel(label: string): boolean {
  // Source reuses POR COBRAR wording for payable residual
  return label.includes('POR COBRAR') || label.includes('POR PAGAR') || label.includes('RESTA');
}

type CardDraft = {
  startRow: number;
  endRow: number;
  creditorName: string;
  creditorLabelRaw: string;
  principal: number | null;
  watchOrConcept: string | null;
  payments: PayablePaymentCandidate[];
  declaredRemaining: number | null;
  formulaErrors: string[];
  region: Region;
};

function scanRegion(
  worksheet: ExcelJS.Worksheet,
  region: Region,
  ctx: SheetParseContext,
): CardDraft[] {
  const cards: CardDraft[] = [];
  const lastRow = Math.max(worksheet.rowCount, worksheet.actualRowCount ?? 0);
  let current: CardDraft | null = null;

  const flush = () => {
    if (current) cards.push(current);
    current = null;
  };

  for (let r = 1; r <= lastRow; r++) {
    const row = worksheet.getRow(r);
    const rawLabel = cellText(row.getCell(region.labelCol).value).trim();
    const label = rawLabel.toUpperCase();
    if (!label && !current) continue;

    if (isCreditorLabel(label)) {
      flush();
      current = {
        startRow: r,
        endRow: r,
        creditorName: cellText(row.getCell(region.valueCol).value).trim(),
        creditorLabelRaw: rawLabel,
        principal: null,
        watchOrConcept: cellText(row.getCell(region.metaCol).value).trim() || null,
        payments: [],
        declaredRemaining: null,
        formulaErrors: [],
        region,
      };
      continue;
    }

    if (!current) continue;
    current.endRow = r;

    if (isMontoLabel(label)) {
      const val = row.getCell(region.valueCol).value;
      if (hasFormulaError(val)) {
        current.formulaErrors.push(cellCoord(r, region.valueCol));
      }
      const amount = cellNumber(val);
      if (current.principal == null) current.principal = amount;
      else if (amount != null) current.principal = roundMoney((current.principal ?? 0) + amount);
      const concept = cellText(row.getCell(region.metaCol).value).trim();
      if (concept) current.watchOrConcept = concept;
      continue;
    }

    if (isPagoLabel(label)) {
      const val = row.getCell(region.valueCol).value;
      if (hasFormulaError(val)) current.formulaErrors.push(cellCoord(r, region.valueCol));
      const amount = cellNumber(val);
      const note = cellText(row.getCell(region.metaCol).value).trim() || null;
      if (amount == null && !note) continue;
      current.payments.push({
        id: newCandidateId('cxp_pay'),
        label: rawLabel,
        amount,
        paymentDate: cellDateIso(row.getCell(region.dateCol).value),
        note,
        source: {
          workbookFingerprint: ctx.workbookFingerprint,
          parserVersion: PARSER_VERSION,
          sourceSheet: 'CTAS X PAGAR',
          sourceRow: r,
          sourceColumnStart: region.dateCol,
          sourceColumnEnd: region.metaCol,
          sourceCellCoordinates: [cellCoord(r, region.valueCol)],
        },
      });
      continue;
    }

    if (isResidualLabel(label)) {
      const val = row.getCell(region.valueCol).value;
      if (hasFormulaError(val)) current.formulaErrors.push(cellCoord(r, region.valueCol));
      current.declaredRemaining = cellNumber(val);
    }
  }
  flush();
  return cards;
}

export function parseCuentasPorPagarSheet(
  worksheet: ExcelJS.Worksheet,
  ctx: SheetParseContext,
): SheetParserResult<PayableCandidate> {
  const records: PayableCandidate[] = [];
  const warnings: MigrationWarning[] = [];
  const errors: MigrationError[] = [];
  const manualReview: MigrationManualReviewItem[] = [];
  const notes: string[] = [];

  for (const region of [LEFT, RIGHT]) {
    for (const card of scanRegion(worksheet, region, ctx)) {
      if (!card.creditorName) {
        const blockId = `${colLetter(region.dateCol)}${card.startRow}:${colLetter(region.metaCol)}${card.endRow}`;
        const source = {
          workbookFingerprint: ctx.workbookFingerprint,
          parserVersion: PARSER_VERSION,
          sourceSheet: 'CTAS X PAGAR',
          sourceRow: card.startRow,
          sourceColumnStart: region.dateCol,
          sourceColumnEnd: region.metaCol,
          sourceBlockId: blockId,
        };
        manualReview.push({
          code: 'AMBIGUOUS_CXP_BLOCK',
          message: 'Bloque CXP sin acreedor',
          severity: 'MANUAL_REVIEW',
          category: 'cxp',
          source,
        });
        records.push({
          id: newCandidateId('cxp'),
          creditorName: '(sin acreedor)',
          creditorLabelRaw: card.creditorLabelRaw,
          principal: card.principal,
          watchOrConcept: card.watchOrConcept,
          declaredRemaining: card.declaredRemaining,
          calculatedRemaining: null,
          balanceMismatch: false,
          currency: region.currency,
          payments: card.payments,
          formulaErrors: card.formulaErrors,
          source,
          ambiguous: true,
        });
        continue;
      }

      const paid = roundMoney(card.payments.reduce((s, p) => s + (p.amount ?? 0), 0));
      const calculatedRemaining =
        card.principal == null ? null : roundMoney(card.principal - paid);
      const balanceMismatch =
        card.declaredRemaining != null &&
        calculatedRemaining != null &&
        !nearlyEqual(card.declaredRemaining, calculatedRemaining, 0.05);

      const blockId = `${colLetter(region.dateCol)}${card.startRow}:${colLetter(region.metaCol)}${card.endRow}`;
      const source = {
        workbookFingerprint: ctx.workbookFingerprint,
        parserVersion: PARSER_VERSION,
        sourceSheet: 'CTAS X PAGAR',
        sourceRow: card.startRow,
        sourceColumnStart: region.dateCol,
        sourceColumnEnd: region.metaCol,
        sourceBlockId: blockId,
        sourceCellCoordinates: [
          `${colLetter(region.dateCol)}${card.startRow}`,
          `${colLetter(region.metaCol)}${card.endRow}`,
        ],
      };

      if (card.formulaErrors.length) {
        errors.push({
          code: 'FORMULA_ERROR',
          message: 'Fórmula rota en CXP (no se confía en el valor)',
          severity: 'CRITICAL',
          category: 'formula',
          source,
        });
      }
      if (balanceMismatch) {
        warnings.push({
          code: 'PAYABLE_BALANCE_MISMATCH',
          message: 'Saldo CXP declarado ≠ principal − pagos',
          severity: 'WARNING',
          category: 'cxp_balance',
          source,
        });
      }
      const ambiguous = card.principal == null || card.formulaErrors.length > 0;
      if (ambiguous) {
        manualReview.push({
          code: 'AMBIGUOUS_CXP_BLOCK',
          message: 'Bloque CXP ambiguo — revisión manual',
          severity: 'MANUAL_REVIEW',
          category: 'cxp',
          source,
        });
      }

      records.push({
        id: newCandidateId('cxp'),
        creditorName: card.creditorName,
        creditorLabelRaw: card.creditorLabelRaw,
        principal: card.principal,
        watchOrConcept: card.watchOrConcept,
        declaredRemaining: card.declaredRemaining,
        calculatedRemaining,
        balanceMismatch,
        currency: region.currency,
        payments: card.payments,
        formulaErrors: card.formulaErrors,
        source,
        ambiguous,
      });
    }
  }

  notes.push(`Detected ${records.length} payable cards`);
  return { records, warnings, errors, manualReview, notes };
}
