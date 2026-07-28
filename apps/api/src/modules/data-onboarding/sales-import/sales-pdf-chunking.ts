import { createHash } from 'crypto';

import { SALES_PDF_CHUNKED_EXTRACTION_VERSION } from '../providers/prompts/historical-sales-extraction-v1';

export { SALES_PDF_CHUNKED_EXTRACTION_VERSION };

export type PageChunkPlan = {
  chunkIndex: number;
  /** 1-based inclusive */
  startPage: number;
  /** 1-based inclusive */
  endPage: number;
  pageCount: number;
};

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

export function resolveSalesPdfPagesPerChunk(): number {
  return clampInt(process.env.SALES_PDF_PAGES_PER_CHUNK, 8, 1, 20);
}

export function resolveSalesPdfMaxPages(): number {
  return clampInt(process.env.SALES_PDF_MAX_PAGES, 500, 1, 5000);
}

export function resolveSalesPdfChunkConcurrency(): number {
  return clampInt(process.env.SALES_PDF_CHUNK_CONCURRENCY, 2, 1, 4);
}

export function resolveSalesPdfChunkMaxTokens(): number {
  // Prefer a completion-friendly budget; dense pages escalate via row batches,
  // not by forcing the model to fill a huge max_tokens window under a short timeout.
  return clampInt(process.env.SALES_PDF_CHUNK_MAX_TOKENS, 8192, 2048, 16384);
}

/** Absolute ceiling for a single Claude chunk call (matches env clamp max). */
export const SALES_PDF_CHUNK_MAX_TOKENS_CEILING = 16384;

/** Preferred token budget for dense single-page row batches (faster than ceiling). */
export const SALES_PDF_DENSE_BATCH_MAX_TOKENS = 8192;

/** Row caps tried when a single page still truncates at the token ceiling. */
export const DENSE_PAGE_BATCH_SIZES = [25, 15, 10, 6] as const;

/** Hard stop for within-page continuation passes (prevents unbounded cost). */
export const MAX_DENSE_PAGE_PASSES = 12;

/** Max provider attempts per leaf chunk range before leaving it FAILED. */
export const MAX_ATTEMPTS_PER_RANGE = 3;

export function resolveSalesPdfMaxChunks(): number {
  return clampInt(process.env.SALES_PDF_MAX_CHUNKS, 100, 1, 1000);
}

export function resolveSalesPdfMaxProviderCalls(): number {
  return clampInt(process.env.SALES_PDF_MAX_PROVIDER_CALLS, 150, 1, 5000);
}

export function resolveSalesPdfChunkStaleMinutes(): number {
  return clampInt(process.env.SALES_PDF_CHUNK_STALE_MINUTES, 15, 1, 240);
}

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function buildChunkFingerprint(input: {
  sourceFingerprint: string;
  startPage: number;
  endPage: number;
  extractionVersion: string;
  modelId: string;
}): string {
  const material = [
    input.sourceFingerprint,
    String(input.startPage),
    String(input.endPage),
    input.extractionVersion,
    input.modelId,
  ].join('|');
  return createHash('sha256').update(material).digest('hex');
}

/**
 * Deterministic non-overlapping page ranges (1-based inclusive).
 * Example for 20 pages / size 8 → [1-8], [9-16], [17-20].
 */
export function planPageChunks(totalPages: number, pagesPerChunk: number): PageChunkPlan[] {
  if (!Number.isFinite(totalPages) || totalPages <= 0) {
    throw new Error('totalPages must be a positive integer');
  }
  if (!Number.isFinite(pagesPerChunk) || pagesPerChunk <= 0) {
    throw new Error('pagesPerChunk must be a positive integer');
  }

  const plans: PageChunkPlan[] = [];
  let chunkIndex = 0;
  for (let start = 1; start <= totalPages; start += pagesPerChunk) {
    const end = Math.min(totalPages, start + pagesPerChunk - 1);
    plans.push({
      chunkIndex,
      startPage: start,
      endPage: end,
      pageCount: end - start + 1,
    });
    chunkIndex += 1;
  }
  return plans;
}

/** Split a page range into two non-empty halves (1-based inclusive). */
export function splitPageRange(
  startPage: number,
  endPage: number,
): [{ startPage: number; endPage: number }, { startPage: number; endPage: number }] | null {
  const pageCount = endPage - startPage + 1;
  if (pageCount <= 1) return null;
  const mid = startPage + Math.floor(pageCount / 2) - 1;
  return [
    { startPage, endPage: mid },
    { startPage: mid + 1, endPage },
  ];
}

/**
 * Run async tasks with bounded concurrency. Preserves input order of results.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, concurrency);
  const results: R[] = new Array(items.length);
  let next = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(runners);
  return results;
}
