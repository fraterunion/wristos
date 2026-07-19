import { BadRequestException } from '@nestjs/common';
import { DataImportFileType } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.xlsx', '.csv', '.json']);
const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.sh',
  '.bat',
  '.cmd',
  '.js',
  '.mjs',
  '.ts',
  '.php',
  '.py',
  '.dll',
  '.so',
  '.zip',
  '.rar',
  '.7z',
]);

const MIME_BY_TYPE: Record<DataImportFileType, string[]> = {
  [DataImportFileType.PDF]: ['application/pdf'],
  [DataImportFileType.XLSX]: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/octet-stream',
  ],
  [DataImportFileType.CSV]: ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'],
  [DataImportFileType.JSON]: ['application/json', 'text/json', 'text/plain'],
};

export function maxImportFileSizeBytes(): number {
  const mb = Number(process.env.IMPORT_MAX_FILE_SIZE_MB ?? '25');
  if (!Number.isFinite(mb) || mb <= 0) return 25 * 1024 * 1024;
  return mb * 1024 * 1024;
}

/** Hard cap on staged rows per file (V1 default: 5,000). */
export function maxImportRows(): number {
  const rows = Number(process.env.IMPORT_MAX_ROWS ?? '5000');
  if (!Number.isFinite(rows) || rows <= 0) return 5000;
  return Math.floor(rows);
}

export function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx <= 0) return '';
  return filename.slice(idx).toLowerCase();
}

export function detectFileType(filename: string): DataImportFileType | null {
  const ext = extensionOf(filename);
  switch (ext) {
    case '.pdf':
      return DataImportFileType.PDF;
    case '.xlsx':
      return DataImportFileType.XLSX;
    case '.csv':
      return DataImportFileType.CSV;
    case '.json':
      return DataImportFileType.JSON;
    default:
      return null;
  }
}

export function validateImportUpload(filename: string, mimeType: string, size: number): DataImportFileType {
  const ext = extensionOf(filename);
  if (!ext || BLOCKED_EXTENSIONS.has(ext) || !ALLOWED_EXTENSIONS.has(ext)) {
    throw new BadRequestException('Tipo de archivo no soportado. Use PDF, XLSX, CSV o JSON.');
  }

  const fileType = detectFileType(filename);
  if (!fileType) {
    throw new BadRequestException('Extensión de archivo no reconocida.');
  }

  if (size <= 0) {
    throw new BadRequestException('El archivo está vacío.');
  }

  const maxSize = maxImportFileSizeBytes();
  if (size > maxSize) {
    throw new BadRequestException(
      `El archivo excede el tamaño máximo permitido (${Math.round(maxSize / (1024 * 1024))} MB).`,
    );
  }

  const allowedMimes = MIME_BY_TYPE[fileType];
  if (mimeType && !allowedMimes.includes(mimeType)) {
    // Extension wins; MIME is advisory only for CSV/JSON/plain variants.
    if (fileType === DataImportFileType.PDF && mimeType !== 'application/pdf') {
      throw new BadRequestException('El archivo PDF no tiene un tipo MIME válido.');
    }
  }

  return fileType;
}

export function sniffJson(buffer: Buffer): boolean {
  const start = buffer.toString('utf8', 0, Math.min(buffer.length, 32)).trim();
  return start.startsWith('{') || start.startsWith('[');
}

export function sniffXlsx(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/** Returns true only when the buffer starts with the PDF magic bytes %PDF-. */
export function sniffPdf(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.slice(0, 5).toString('ascii') === '%PDF-';
}

/**
 * Estimates PDF page count by scanning the raw bytes for the /Count N entry
 * in the Pages dictionary tree.
 *
 * Returns the largest /Count value found, or 0 when the count is unreadable
 * (e.g. compressed cross-reference streams). Callers should only reject when
 * the returned value is > 0 and exceeds the limit; 0 means "unknown".
 */
export function estimatePdfPageCount(buffer: Buffer): number {
  const text = buffer.toString('latin1');
  let max = 0;
  const pattern = /\/Count\s+(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const n = parseInt(match[1], 10);
    if (n > max) max = n;
  }
  return max;
}

/** Maximum PDF pages allowed per extraction request. Configurable via IMPORT_MAX_PDF_PAGES. */
export function maxPdfPages(): number {
  const raw = process.env.IMPORT_MAX_PDF_PAGES;
  if (!raw) return 50;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 50;
}

// ─── PDF inspection (L-02) ────────────────────────────────────────────────────

export type PdfInspectionResult = {
  validSignature: boolean;
  pageCount: number | null;
  encrypted: boolean | null;
  parseStatus: 'VALID' | 'UNKNOWN_PAGE_COUNT' | 'ENCRYPTED' | 'CORRUPT';
};

/**
 * Performs a robust inspection of a PDF buffer using pdf-lib.
 *
 * Detects:
 *  - Missing/corrupt magic bytes → CORRUPT (cheap sniff first, no pdf-lib overhead)
 *  - Password-protected PDFs → ENCRYPTED (pdf-lib throws with encryption message)
 *  - Parse failures (truncated, malformed structure) → CORRUPT
 *  - Readable page count → VALID
 *
 * Does NOT decrypt, render, or log document contents.
 * Never throws — all errors are mapped to PdfInspectionResult.
 */
export async function inspectPdf(buffer: Buffer): Promise<PdfInspectionResult> {
  if (!sniffPdf(buffer)) {
    return { validSignature: false, pageCount: null, encrypted: null, parseStatus: 'CORRUPT' };
  }

  try {
    const doc = await PDFDocument.load(buffer, { updateMetadata: false });
    const pageCount = doc.getPageCount();
    return { validSignature: true, pageCount, encrypted: false, parseStatus: 'VALID' };
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : '';
    if (message.includes('encrypt') || message.includes('password')) {
      return { validSignature: true, pageCount: null, encrypted: true, parseStatus: 'ENCRYPTED' };
    }
    // Any other parse failure: corrupt or unsupported structure
    return { validSignature: true, pageCount: null, encrypted: false, parseStatus: 'CORRUPT' };
  }
}

/** User-facing error messages for PDF inspection failures (Spanish). */
export const PDF_INSPECTION_MESSAGES = {
  ENCRYPTED: 'Este PDF está protegido con contraseña. Descarga una copia sin protección y vuelve a intentarlo.',
  CORRUPT:   'El archivo PDF está dañado o no se puede leer. Verifica el archivo e inténtalo nuevamente.',
} as const;
