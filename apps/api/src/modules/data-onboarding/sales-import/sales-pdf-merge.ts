import { createHash } from 'crypto';

import type { ExtractedHistoricalSale, HistoricalSalesExtractionDocument } from './historical-sale-extraction.types';
import { SALES_PDF_CHUNKED_EXTRACTION_VERSION } from './sales-pdf-chunking';

export type SaleProvenance = {
  sourceFileId: string;
  chunkId: string;
  chunkIndex: number;
  sourcePageStart: number;
  sourcePageEnd: number;
  extractionVersion: string;
};

export type MergedHistoricalSale = ExtractedHistoricalSale & {
  _provenance?: SaleProvenance[];
  _recordFingerprint?: string;
  _duplicateOf?: string;
};

export type ChunkSaleBundle = {
  chunkId: string;
  chunkIndex: number;
  startPage: number;
  endPage: number;
  sales: ExtractedHistoricalSale[];
};

function norm(value: unknown): string {
  if (value == null) return '';
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function moneyKey(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return value.toFixed(2);
}

/** Conservative exact-ish fingerprint for boundary dedupe. */
export function buildSaleRecordFingerprint(sale: ExtractedHistoricalSale): string {
  const material = [
    norm(sale.saleDate),
    norm(sale.brand),
    norm(sale.model),
    norm(sale.reference),
    norm(sale.serialNumber),
    norm(sale.customerName),
    moneyKey(sale.salePrice),
    norm(sale.saleCurrency),
  ].join('|');
  return createHash('sha256').update(material).digest('hex');
}

/**
 * Strong identity: serial present, or full set of date+brand+ref+customer+price.
 * Ambiguous brand/model+price alone never collapses.
 */
export function isHighConfidenceDuplicate(a: ExtractedHistoricalSale, b: ExtractedHistoricalSale): boolean {
  const serialA = norm(a.serialNumber);
  const serialB = norm(b.serialNumber);
  if (serialA && serialB && serialA === serialB) {
    // Same serial is enough when brand/model also match or are missing on one side.
    const brandOk = !norm(a.brand) || !norm(b.brand) || norm(a.brand) === norm(b.brand);
    return brandOk;
  }

  // Require several strong fields — never collapse on brand/model/price alone.
  const required = [
    [norm(a.saleDate), norm(b.saleDate)],
    [norm(a.brand), norm(b.brand)],
    [norm(a.reference) || norm(a.model), norm(b.reference) || norm(b.model)],
    [norm(a.customerName), norm(b.customerName)],
    [moneyKey(a.salePrice), moneyKey(b.salePrice)],
    [norm(a.saleCurrency) || 'mxn', norm(b.saleCurrency) || 'mxn'],
  ];
  return required.every(([x, y]) => Boolean(x) && Boolean(y) && x === y);
}

export type MergeSalesResult = {
  sales: MergedHistoricalSale[];
  duplicateWarnings: Array<{ fingerprint: string; keptIndex: number; droppedChunkIds: string[] }>;
};

/**
 * Deterministic merge: sort by startPage, flatten, conservative dedupe across chunk boundaries.
 */
export function mergeChunkSales(args: {
  fileId: string;
  extractionVersion?: string;
  chunks: ChunkSaleBundle[];
}): MergeSalesResult {
  const extractionVersion = args.extractionVersion ?? SALES_PDF_CHUNKED_EXTRACTION_VERSION;
  const ordered = [...args.chunks].sort((a, b) => {
    if (a.startPage !== b.startPage) return a.startPage - b.startPage;
    if (a.endPage !== b.endPage) return a.endPage - b.endPage;
    return a.chunkIndex - b.chunkIndex;
  });

  const merged: MergedHistoricalSale[] = [];
  const duplicateWarnings: MergeSalesResult['duplicateWarnings'] = [];

  for (const chunk of ordered) {
    for (const sale of chunk.sales) {
      const fingerprint = buildSaleRecordFingerprint(sale);
      const provenance: SaleProvenance = {
        sourceFileId: args.fileId,
        chunkId: chunk.chunkId,
        chunkIndex: chunk.chunkIndex,
        sourcePageStart: chunk.startPage,
        sourcePageEnd: chunk.endPage,
        extractionVersion,
      };

      const existingIndex = merged.findIndex(
        (row) =>
          row._recordFingerprint === fingerprint ||
          isHighConfidenceDuplicate(row, sale),
      );

      if (existingIndex >= 0) {
        const existing = merged[existingIndex];
        const prov = existing._provenance ?? [];
        // Adjacent/boundary duplicate: merge provenance, keep first occurrence.
        if (!prov.some((p) => p.chunkId === chunk.chunkId)) {
          existing._provenance = [...prov, provenance];
        }
        duplicateWarnings.push({
          fingerprint,
          keptIndex: existingIndex,
          droppedChunkIds: [chunk.chunkId],
        });
        continue;
      }

      merged.push({
        ...sale,
        _recordFingerprint: fingerprint,
        _provenance: [provenance],
      });
    }
  }

  return { sales: merged, duplicateWarnings };
}

export function toHistoricalSalesDocument(
  sales: MergedHistoricalSale[],
  overallConfidence?: number,
): HistoricalSalesExtractionDocument {
  return {
    sales: sales.map(({ _provenance: _p, _recordFingerprint: _f, _duplicateOf: _d, ...rest }) => rest),
    extractionVersion: SALES_PDF_CHUNKED_EXTRACTION_VERSION,
    overallConfidence,
  };
}
