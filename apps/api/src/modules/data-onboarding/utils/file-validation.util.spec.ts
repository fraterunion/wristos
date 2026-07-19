import { BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';

import {
  PDF_INSPECTION_MESSAGES,
  detectFileType,
  estimatePdfPageCount,
  inspectPdf,
  maxImportFileSizeBytes,
  maxPdfPages,
  sniffPdf,
  validateImportUpload,
} from '../utils/file-validation.util';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Builds a minimal but syntactically valid PDF that has /Encrypt in its trailer.
 * pdf-lib cannot CREATE encrypted PDFs; this constructs the raw binary manually.
 * The structure is valid enough for pdf-lib to parse the trailer and detect encryption.
 */
function buildMinimalEncryptedPdf(): Buffer {
  // Build objects first so we can compute byte offsets
  const obj1 = '1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n';
  const obj2 = '2 0 obj\n<</Type /Pages /Kids [] /Count 0>>\nendobj\n';
  const obj3 = '3 0 obj\n<</Filter /Standard>>\nendobj\n';

  const header = '%PDF-1.4\n';
  const off1 = header.length;                  // offset of obj 1
  const off2 = off1 + obj1.length;             // offset of obj 2
  const off3 = off2 + obj2.length;             // offset of obj 3
  const xrefOffset = off3 + obj3.length;       // offset of xref table

  const pad = (n: number) => n.toString().padStart(10, '0');
  const xref = [
    'xref',
    '0 4',
    `0000000000 65535 f\r`,
    `${pad(off1)} 00000 n\r`,
    `${pad(off2)} 00000 n\r`,
    `${pad(off3)} 00000 n\r`,
    '',
  ].join('\n');

  const trailer = `trailer\n<</Size 4 /Root 1 0 R /Encrypt 3 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(header + obj1 + obj2 + obj3 + xref + trailer);
}

describe('file validation', () => {
  it('detects allowed file types by extension', () => {
    expect(detectFileType('inventory.csv')).toBe('CSV');
    expect(detectFileType('clients.xlsx')).toBe('XLSX');
    expect(detectFileType('notes.pdf')).toBe('PDF');
    expect(detectFileType('data.json')).toBe('JSON');
    expect(detectFileType('archive.zip')).toBeNull();
  });

  it('rejects empty files', () => {
    expect(() => validateImportUpload('data.csv', 'text/csv', 0)).toThrow(BadRequestException);
  });

  it('rejects unsupported extensions', () => {
    expect(() => validateImportUpload('run.exe', 'application/octet-stream', 100)).toThrow(BadRequestException);
  });

  it('rejects PDF MIME mismatch', () => {
    expect(() => validateImportUpload('doc.pdf', 'text/plain', 100)).toThrow(BadRequestException);
  });

  it('rejects oversized files', () => {
    const tooBig = maxImportFileSizeBytes() + 1;
    expect(() => validateImportUpload('data.csv', 'text/csv', tooBig)).toThrow(BadRequestException);
  });
});

describe('sniffPdf', () => {
  it('returns true for a valid PDF header (%PDF-)', () => {
    expect(sniffPdf(Buffer.from('%PDF-1.4 rest of file'))).toBe(true);
  });

  it('returns false for a buffer shorter than 5 bytes', () => {
    expect(sniffPdf(Buffer.from('%PDF'))).toBe(false);
  });

  it('returns false for non-PDF content', () => {
    expect(sniffPdf(Buffer.from('Not a PDF file'))).toBe(false);
  });

  it('returns false for an empty buffer', () => {
    expect(sniffPdf(Buffer.alloc(0))).toBe(false);
  });
});

describe('estimatePdfPageCount', () => {
  it('returns the largest /Count value found in the buffer', () => {
    const buf = Buffer.from('%PDF-1.4\n/Count 3\nother /Count 1');
    expect(estimatePdfPageCount(buf)).toBe(3);
  });

  it('returns 0 when no /Count entry is present', () => {
    expect(estimatePdfPageCount(Buffer.from('%PDF-1.4'))).toBe(0);
  });

  it('handles extra whitespace between /Count and the number', () => {
    expect(estimatePdfPageCount(Buffer.from('/Count  10'))).toBe(10);
  });

  it('returns 0 for an empty buffer', () => {
    expect(estimatePdfPageCount(Buffer.alloc(0))).toBe(0);
  });
});

describe('maxPdfPages', () => {
  const savedEnv = process.env.IMPORT_MAX_PDF_PAGES;

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.IMPORT_MAX_PDF_PAGES;
    } else {
      process.env.IMPORT_MAX_PDF_PAGES = savedEnv;
    }
  });

  it('returns 50 when IMPORT_MAX_PDF_PAGES is not set', () => {
    delete process.env.IMPORT_MAX_PDF_PAGES;
    expect(maxPdfPages()).toBe(50);
  });

  it('returns the configured value when IMPORT_MAX_PDF_PAGES is valid', () => {
    process.env.IMPORT_MAX_PDF_PAGES = '20';
    expect(maxPdfPages()).toBe(20);
  });

  it('falls back to 50 for a non-numeric env value', () => {
    process.env.IMPORT_MAX_PDF_PAGES = 'bad';
    expect(maxPdfPages()).toBe(50);
  });
});

// ─── inspectPdf (L-02) ────────────────────────────────────────────────────────

describe('inspectPdf (pdf-lib backed)', () => {
  let realTwoPagePdf: Buffer;

  beforeAll(async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    realTwoPagePdf = Buffer.from(await doc.save());
  });

  it('returns CORRUPT for a buffer without PDF magic bytes', async () => {
    const result = await inspectPdf(Buffer.from('This is not a PDF'));
    expect(result.parseStatus).toBe('CORRUPT');
    expect(result.validSignature).toBe(false);
    expect(result.encrypted).toBeNull();
    expect(result.pageCount).toBeNull();
  });

  it('returns CORRUPT for an empty buffer', async () => {
    const result = await inspectPdf(Buffer.alloc(0));
    expect(result.parseStatus).toBe('CORRUPT');
    expect(result.validSignature).toBe(false);
  });

  it('returns CORRUPT for a syntactically invalid PDF (pdf-lib throws parse error)', async () => {
    const truncatedPdf = Buffer.from('%PDF-1.4\n\x00\x01\x02garbage-body-that-cannot-be-parsed');
    const result = await inspectPdf(truncatedPdf);
    expect(result.validSignature).toBe(true);
    expect(['CORRUPT', 'ENCRYPTED']).toContain(result.parseStatus);
  });

  it('returns VALID with correct page count for a real pdf-lib generated PDF', async () => {
    const result = await inspectPdf(realTwoPagePdf);
    expect(result.parseStatus).toBe('VALID');
    expect(result.validSignature).toBe(true);
    expect(result.encrypted).toBe(false);
    expect(result.pageCount).toBe(2);
  });

  it('returns ENCRYPTED for a minimal PDF with /Encrypt in trailer', async () => {
    // pdf-lib v1 cannot create encrypted PDFs; we craft the raw bytes manually.
    // pdf-lib detects /Encrypt in the trailer before doing deeper parsing.
    const encryptedPdf = buildMinimalEncryptedPdf();
    const result = await inspectPdf(encryptedPdf);
    expect(result.parseStatus).toBe('ENCRYPTED');
    expect(result.validSignature).toBe(true);
    expect(result.encrypted).toBe(true);
    expect(result.pageCount).toBeNull();
  });

  it('never throws — always returns a PdfInspectionResult', async () => {
    // Completely random garbage bytes after PDF header
    const chaos = Buffer.concat([
      Buffer.from('%PDF-'),
      Buffer.from(Array.from({ length: 200 }, () => Math.floor(Math.random() * 256))),
    ]);
    await expect(inspectPdf(chaos)).resolves.toBeDefined();
  });

  it('PDF_INSPECTION_MESSAGES has Spanish messages for ENCRYPTED and CORRUPT', () => {
    expect(typeof PDF_INSPECTION_MESSAGES.ENCRYPTED).toBe('string');
    expect(typeof PDF_INSPECTION_MESSAGES.CORRUPT).toBe('string');
    expect(PDF_INSPECTION_MESSAGES.ENCRYPTED.length).toBeGreaterThan(10);
    expect(PDF_INSPECTION_MESSAGES.CORRUPT.length).toBeGreaterThan(10);
  });
});
