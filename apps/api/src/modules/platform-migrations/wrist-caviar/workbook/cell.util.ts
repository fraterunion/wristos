import type ExcelJS from 'exceljs';
import { createHash } from 'crypto';

const candidateSeq = new Map<string, number>();

/** Reset between workbook analyses so IDs are reproducible for the same parse order. */
export function resetCandidateIdCounters(): void {
  candidateSeq.clear();
}

/**
 * Deterministic candidate id for a single analysis run.
 * Relies on stable parser traversal order (same workbook → same sequence).
 */
export function newCandidateId(prefix: string): string {
  const n = (candidateSeq.get(prefix) ?? 0) + 1;
  candidateSeq.set(prefix, n);
  return `${prefix}_${String(n).padStart(6, '0')}`;
}

export function fingerprintBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function cellRaw(value: ExcelJS.CellValue): unknown {
  return value;
}

export function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((p) => p.text ?? '').join('');
    }
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('result' in value && value.result != null) {
      if (value.result instanceof Date) return value.result.toISOString().slice(0, 10);
      if (typeof value.result === 'object' && value.result && 'error' in value.result) return '';
      return String(value.result);
    }
    if ('error' in value) return '';
    if ('formula' in value) return '';
  }
  return String(value);
}

export function cellFormula(value: ExcelJS.CellValue): string | null {
  if (value && typeof value === 'object' && 'formula' in value && typeof value.formula === 'string') {
    return value.formula;
  }
  if (value && typeof value === 'object' && 'sharedFormula' in value && typeof (value as { sharedFormula?: string }).sharedFormula === 'string') {
    return (value as { sharedFormula: string }).sharedFormula;
  }
  return null;
}

export function hasFormulaError(value: ExcelJS.CellValue): boolean {
  if (!value || typeof value !== 'object') return false;
  if ('error' in value) return true;
  if ('result' in value && value.result && typeof value.result === 'object' && 'error' in value.result) {
    return true;
  }
  const formula = cellFormula(value);
  if (!formula) return false;
  // Nonsense absolute row refs seen in CTAS X PAGAR (e.g. C654847)
  if (/[A-Z]\$?6[0-9]{4,}/i.test(formula)) return true;
  return false;
}

export function cellNumber(value: ExcelJS.CellValue): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'object') {
    if ('result' in value) {
      if (value.result == null) return null;
      if (typeof value.result === 'number' && Number.isFinite(value.result)) return value.result;
      if (typeof value.result === 'object' && value.result && 'error' in value.result) return null;
      if (typeof value.result === 'string') {
        const n = Number(value.result.replace(/,/g, ''));
        return Number.isFinite(n) ? n : null;
      }
    }
    if ('formula' in value) {
      const formula = String(value.formula);
      const mul = formula.match(/^=\s*(-?\d+(?:\.\d+)?)\s*\*\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (mul) return Number(mul[1]) * Number(mul[2]);
      const div = formula.match(/^=\s*(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (div && Number(div[2]) !== 0) return Number(div[1]) / Number(div[2]);
    }
  }
  return null;
}

/** Excel serial date or Date object → ISO date (UTC calendar day). */
export function cellDateIso(value: ExcelJS.CellValue): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && value > 30000 && value < 80000) {
    // Excel epoch 1899-12-30
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  if (typeof value === 'object' && 'result' in value) {
    return cellDateIso(value.result as ExcelJS.CellValue);
  }
  if (typeof value === 'string') {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  }
  return null;
}

export function isExcelDateLike(value: ExcelJS.CellValue): boolean {
  return cellDateIso(value) != null;
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function nearlyEqual(a: number | null, b: number | null, tol = 0.02): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= tol;
}

export function colLetter(col: number): string {
  let n = col;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function cellCoord(row: number, col: number): string {
  return `${colLetter(col)}${row}`;
}

export function extractFxRateFromFormula(formula: string | null): number | null {
  if (!formula) return null;
  const mul = formula.match(/^=\s*(-?\d+(?:\.\d+)?)\s*\*\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (mul) return Number(mul[2]);
  const div = formula.match(/^=\s*(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (div) return Number(div[2]);
  return null;
}
