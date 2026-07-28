import {
  buildChunkFingerprint,
  mapWithConcurrency,
  planPageChunks,
  resolveSalesPdfPagesPerChunk,
  sha256Hex,
  splitPageRange,
} from './sales-pdf-chunking';
import { PDFDocument } from 'pdf-lib';
import { splitPdfPageRange } from './sales-pdf-split';
import {
  buildSaleRecordFingerprint,
  isHighConfidenceDuplicate,
  mergeChunkSales,
} from './sales-pdf-merge';

describe('sales-pdf-chunking', () => {
  it('plans deterministic 8-page chunks with a final partial chunk', () => {
    expect(planPageChunks(20, 8)).toEqual([
      { chunkIndex: 0, startPage: 1, endPage: 8, pageCount: 8 },
      { chunkIndex: 1, startPage: 9, endPage: 16, pageCount: 8 },
      { chunkIndex: 2, startPage: 17, endPage: 20, pageCount: 4 },
    ]);
  });

  it('falls back to 8 pages per chunk for invalid env', () => {
    const prev = process.env.SALES_PDF_PAGES_PER_CHUNK;
    process.env.SALES_PDF_PAGES_PER_CHUNK = 'bad';
    expect(resolveSalesPdfPagesPerChunk()).toBe(8);
    process.env.SALES_PDF_PAGES_PER_CHUNK = '0';
    expect(resolveSalesPdfPagesPerChunk()).toBe(8);
    process.env.SALES_PDF_PAGES_PER_CHUNK = '99';
    expect(resolveSalesPdfPagesPerChunk()).toBe(8);
    if (prev === undefined) delete process.env.SALES_PDF_PAGES_PER_CHUNK;
    else process.env.SALES_PDF_PAGES_PER_CHUNK = prev;
  });

  it('splits page ranges in half and refuses single-page split', () => {
    expect(splitPageRange(1, 8)).toEqual([
      { startPage: 1, endPage: 4 },
      { startPage: 5, endPage: 8 },
    ]);
    expect(splitPageRange(1, 1)).toBeNull();
  });

  it('builds stable fingerprints', () => {
    const a = sha256Hex(Buffer.from('pdf-bytes'));
    const b = sha256Hex(Buffer.from('pdf-bytes'));
    expect(a).toBe(b);
    const c1 = buildChunkFingerprint({
      sourceFingerprint: a,
      startPage: 1,
      endPage: 8,
      extractionVersion: 'sales-pdf-chunked-v1',
      modelId: 'claude',
    });
    const c2 = buildChunkFingerprint({
      sourceFingerprint: a,
      startPage: 1,
      endPage: 8,
      extractionVersion: 'sales-pdf-chunked-v1',
      modelId: 'claude',
    });
    const c3 = buildChunkFingerprint({
      sourceFingerprint: a,
      startPage: 1,
      endPage: 8,
      extractionVersion: 'sales-pdf-chunked-v2',
      modelId: 'claude',
    });
    expect(c1).toBe(c2);
    expect(c1).not.toBe(c3);
  });

  it('mapWithConcurrency respects bound and preserves order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = [1, 2, 3, 4, 5];
    const results = await mapWithConcurrency(items, 2, async (n) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
      return n * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});

describe('sales-pdf-split', () => {
  it('copies the requested page range into a new PDF', async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 5; i += 1) doc.addPage();
    const bytes = Buffer.from(await doc.save());
    const chunk = await splitPdfPageRange(bytes, 2, 4);
    const loaded = await PDFDocument.load(chunk);
    expect(loaded.getPageCount()).toBe(3);
  });
});

describe('sales-pdf-merge', () => {
  it('merges in source page order and attaches provenance', () => {
    const result = mergeChunkSales({
      fileId: 'file-1',
      chunks: [
        {
          chunkId: 'c1',
          chunkIndex: 1,
          startPage: 9,
          endPage: 16,
          sales: [{ brand: 'Omega', salePrice: 100, saleCurrency: 'MXN', saleDate: '2024-02-01', customerName: 'A' }],
        },
        {
          chunkId: 'c0',
          chunkIndex: 0,
          startPage: 1,
          endPage: 8,
          sales: [{ brand: 'Rolex', salePrice: 200, saleCurrency: 'MXN', saleDate: '2024-01-01', customerName: 'B' }],
        },
      ],
    });
    expect(result.sales).toHaveLength(2);
    expect(result.sales[0].brand).toBe('Rolex');
    expect(result.sales[0]._provenance?.[0]).toMatchObject({
      sourceFileId: 'file-1',
      chunkId: 'c0',
      sourcePageStart: 1,
      sourcePageEnd: 8,
    });
  });

  it('collapses high-confidence boundary duplicates and keeps ambiguous rows', () => {
    const same = {
      brand: 'Rolex',
      model: 'Sub',
      reference: '126610',
      serialNumber: 'ABC123',
      saleDate: '2024-01-01',
      customerName: 'Juan',
      salePrice: 100000,
      saleCurrency: 'MXN' as const,
    };
    const ambiguous = {
      brand: 'Rolex',
      model: 'Sub',
      salePrice: 100000,
      saleCurrency: 'MXN' as const,
    };
    const merged = mergeChunkSales({
      fileId: 'f',
      chunks: [
        { chunkId: 'a', chunkIndex: 0, startPage: 1, endPage: 8, sales: [same, ambiguous] },
        { chunkId: 'b', chunkIndex: 1, startPage: 9, endPage: 16, sales: [{ ...same }, { ...ambiguous, customerName: 'Other' }] },
      ],
    });
    // exact serial duplicate collapsed; ambiguous brand/model/price alone remains separate
    expect(merged.sales.filter((s) => s.serialNumber === 'ABC123')).toHaveLength(1);
    expect(merged.sales[0]._provenance?.length).toBe(2);
    expect(isHighConfidenceDuplicate(ambiguous, { ...ambiguous, customerName: 'Other' })).toBe(false);
    expect(buildSaleRecordFingerprint(same)).toEqual(expect.any(String));
  });
});
