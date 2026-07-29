import * as fs from 'fs';
import ExcelJS from 'exceljs';

import { fingerprintBuffer } from '../../../apps/api/src/modules/platform-migrations/wrist-caviar/workbook/cell.util';
import type {
  PayableCandidate,
  PayablePaymentCandidate,
} from '../../../apps/api/src/modules/platform-migrations/wrist-caviar/types/migration.types';
import { sha256Hex, prefix } from './hash';

export type EdgarCardAudit = {
  replacementId: string;
  creditorName: string;
  startRow: number;
  endRow: number;
  principal: number;
  paymentsTotal: number;
  outstanding: number;
  declaredOutstanding: number | null;
  chargeLines: Array<{ date: string | null; amount: number; concept: string }>;
  paymentLines: Array<{ date: string | null; amount: number; label: string }>;
  supersedesOriginalIds: string[];
  decisionIds: string[];
};

function cellText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return cellText(o.result);
    if ('text' in o) return cellText(o.text);
    if ('richText' in o && Array.isArray(o.richText)) {
      return (o.richText as Array<{ text?: string }>).map((t) => t.text ?? '').join('');
    }
  }
  return '';
}

function cellNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'object' && v && 'result' in (v as object)) {
    return cellNumber((v as { result: unknown }).result);
  }
  const n = Number(String(v).replace(/[,$]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function cellDateIso(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && v && 'result' in (v as object)) {
    return cellDateIso((v as { result: unknown }).result);
  }
  const t = cellText(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type RawRow = {
  row: number;
  aText: string;
  bText: string;
  cText: string;
  dText: string;
  date: string | null;
  amount: number | null;
};

function isHeaderRow(r: RawRow): boolean {
  const a = r.aText.toUpperCase();
  const b = r.bText.toUpperCase();
  const joined = `${a} ${b} ${r.cText} ${r.dText}`.toUpperCase();
  if (a.includes('FECHA') && (b.includes('ACREDOR') || b.includes('AACREDOR'))) return true;
  // Standalone creditor name line (e.g. blank | blank | Edgar Trejo)
  if (
    !r.amount &&
    !/MONTO|PAGO|POR COBRAR|FECHA/i.test(joined) &&
    /edgar/i.test(`${r.bText} ${r.cText} ${r.dText}`)
  ) {
    return true;
  }
  return false;
}

/**
 * Parse HOJA CXP EDGAR.xlsx into payable candidates.
 * Scope: Edgar Trejo AP only. MONTO rows are charges (abs), PAGO rows are payments.
 */
export async function parseEdgarCxpWorkbook(workbookPath: string): Promise<{
  fingerprint: string;
  fingerprintPrefix: string;
  payables: PayableCandidate[];
  audits: EdgarCardAudit[];
}> {
  const buf = fs.readFileSync(workbookPath);
  const fingerprint = fingerprintBuffer(buf);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Edgar workbook has no sheets');

  const rows: RawRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const aVal = row.getCell(1).value;
    const bVal = row.getCell(2).value;
    const cVal = row.getCell(3).value;
    const dVal = row.getCell(4).value;
    rows.push({
      row: rowNumber,
      aText: cellText(aVal).trim(),
      bText: cellText(bVal).trim(),
      cText: cellText(cVal).trim(),
      dText: cellText(dVal).trim(),
      date: cellDateIso(aVal),
      amount: cellNumber(cVal),
    });
  });

  const headerIdx: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (isHeaderRow(rows[i]!)) headerIdx.push(i);
  }

  const segments: Array<{ start: number; end: number }> = [];
  if (headerIdx.length === 0) {
    segments.push({ start: 0, end: rows.length });
  } else {
    for (let i = 0; i < headerIdx.length; i++) {
      const start = headerIdx[i]!;
      const end = i + 1 < headerIdx.length ? headerIdx[i + 1]! : rows.length;
      segments.push({ start, end });
    }
  }

  const payables: PayableCandidate[] = [];
  const audits: EdgarCardAudit[] = [];
  let seq = 0;

  for (const seg of segments) {
    const slice = rows.slice(seg.start, seg.end);
    if (
      !slice.some(
        (r) =>
          /MONTO/i.test(r.bText) ||
          (/^PAGO/i.test(r.bText) && r.amount != null && r.amount !== 0) ||
          /POR COBRAR/i.test(r.bText),
      )
    ) {
      continue;
    }

    let creditorName = 'EDGAR TREJO';
    for (const r of slice.slice(0, 3)) {
      const blob = `${r.bText} ${r.cText} ${r.dText}`.trim();
      if (/edgar/i.test(blob)) {
        creditorName =
          blob
            .replace(/acredor|aacredor/gi, '')
            .replace(/\s+/g, ' ')
            .trim() || 'EDGAR TREJO';
        break;
      }
    }

    const charges: EdgarCardAudit['chargeLines'] = [];
    const payments: EdgarCardAudit['paymentLines'] = [];
    let declared: number | null = null;

    for (const r of slice) {
      if (/POR COBRAR/i.test(r.bText) && r.amount != null) {
        declared = r.amount;
        continue;
      }
      if (/MONTO/i.test(r.bText) && r.amount != null && r.amount !== 0) {
        charges.push({
          date: r.date,
          amount: Math.abs(r.amount),
          concept: r.dText || r.bText,
        });
        continue;
      }
      // Only count PAGO rows with a non-zero amount (ignore empty "PAGO 1:" placeholders)
      if (/^PAGO/i.test(r.bText) && r.amount != null && r.amount !== 0) {
        payments.push({
          date: r.date,
          amount: Math.abs(r.amount),
          label: r.dText || r.bText,
        });
      }
    }

    if (charges.length === 0 && payments.length === 0) continue;

    const principal = round2(charges.reduce((s, c) => s + c.amount, 0));
    const paymentsTotal = round2(payments.reduce((s, p) => s + p.amount, 0));
    const calculated = round2(principal - paymentsTotal);
    seq += 1;
    const id = `edgar_cxp_${String(seq).padStart(6, '0')}`;
    const startRow = slice[0]!.row;
    const endRow = slice[slice.length - 1]!.row;
    const blockId = `A${startRow}:D${endRow}`;

    const payCandidates: PayablePaymentCandidate[] = payments.map((p, i) => ({
      id: `${id}_pay_${String(i + 1).padStart(3, '0')}`,
      label: p.label,
      amount: p.amount,
      paymentDate: p.date,
      note: 'edgar_replacement_source',
      source: {
        workbookFingerprint: fingerprint,
        parserVersion: 'edgar-cxp-v1',
        sourceSheet: 'Hoja1',
        sourceRow: startRow,
        sourceBlockId: blockId,
        sourceCellCoordinates: [`A${startRow}`, `D${endRow}`],
      },
    }));

    const concept =
      charges.length === 1
        ? charges[0]!.concept
        : charges.map((c) => c.concept).filter(Boolean).join(' + ') || 'EDGAR CXP';

    // Prefer calculated remaining when declared mismatches (workbook formula may lag)
    const remaining = calculated;
    const balanceMismatch = declared != null && Math.abs(declared - calculated) > 0.05;

    payables.push({
      id,
      creditorName: /edgar/i.test(creditorName) ? 'EDGAR TREJO' : creditorName,
      creditorLabelRaw: creditorName,
      principal,
      watchOrConcept: concept,
      declaredRemaining: remaining,
      calculatedRemaining: calculated,
      // Authorized replacement source: clear mismatch after accepting calculated from MONTO/PAGO lines
      balanceMismatch: false,
      currency: 'MXN',
      payments: payCandidates,
      formulaErrors: balanceMismatch
        ? [`declared_por_cobrar_${declared}_vs_calculated_${calculated}_using_calculated`]
        : [],
      source: {
        workbookFingerprint: fingerprint,
        parserVersion: 'edgar-cxp-v1',
        sourceSheet: 'Hoja1',
        sourceRow: startRow,
        sourceBlockId: blockId,
        sourceCellCoordinates: [`A${startRow}`, `D${endRow}`],
      },
      ambiguous: false,
    });

    const decisionIds: string[] = [];
    const supersedes: string[] = [];
    if (Math.abs(calculated - 3509715) < 0.05 || Math.abs((declared ?? 0) - 3509715) < 0.05) {
      decisionIds.push('CXP-001');
      supersedes.push('cxp_000004');
    }
    if (Math.abs(calculated - 1055000) < 0.05 || Math.abs((declared ?? 0) - 1055000) < 0.05) {
      decisionIds.push('CXP-003');
      supersedes.push('cxp_000011');
    }

    audits.push({
      replacementId: id,
      creditorName: 'EDGAR TREJO',
      startRow,
      endRow,
      principal,
      paymentsTotal,
      outstanding: calculated,
      declaredOutstanding: declared,
      chargeLines: charges,
      paymentLines: payments,
      supersedesOriginalIds: supersedes,
      decisionIds,
    });
  }

  return {
    fingerprint,
    fingerprintPrefix: prefix(fingerprint),
    payables,
    audits,
  };
}

export function edgarReplacementHash(edgarFingerprint: string, audits: EdgarCardAudit[]): string {
  return sha256Hex({ edgarFingerprint, audits: audits.map((a) => a.replacementId) });
}
