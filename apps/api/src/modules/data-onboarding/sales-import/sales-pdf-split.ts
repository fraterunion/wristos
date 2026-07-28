import { PDFDocument } from 'pdf-lib';

/**
 * Copy a 1-based inclusive page range from a source PDF into a new in-memory PDF.
 * Does not write to disk.
 */
export async function splitPdfPageRange(
  sourcePdf: Buffer,
  startPage: number,
  endPage: number,
): Promise<Buffer> {
  const src = await PDFDocument.load(sourcePdf, { updateMetadata: false });
  const total = src.getPageCount();
  if (startPage < 1 || endPage < startPage || endPage > total) {
    throw new Error(`Invalid page range ${startPage}-${endPage} for PDF with ${total} pages`);
  }

  const out = await PDFDocument.create();
  // pdf-lib uses 0-based page indices
  const indices = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage - 1 + i);
  const copied = await out.copyPages(src, indices);
  for (const page of copied) out.addPage(page);
  const bytes = await out.save({ useObjectStreams: false });
  return Buffer.from(bytes);
}
