import { Injectable, Logger } from '@nestjs/common';
import {
  DataImportTarget,
  DocumentExtractionChunkStatus,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import type { DocumentExtractionProvider } from '../providers/document-extraction.provider.interface';
import {
  ExtractionError,
  ExtractionErrorCode,
  isExtractionError,
} from '../providers/extraction-errors';
import type { ExtractedHistoricalSale, HistoricalSalesExtractionDocument } from './historical-sale-extraction.types';
import { historicalSaleFingerprint } from '../providers/prompts/historical-sales-extraction-v1';
import {
  buildChunkFingerprint,
  DENSE_PAGE_BATCH_SIZES,
  mapWithConcurrency,
  MAX_DENSE_PAGE_PASSES,
  planPageChunks,
  resolveSalesPdfChunkConcurrency,
  resolveSalesPdfChunkMaxTokens,
  resolveSalesPdfChunkStaleMinutes,
  resolveSalesPdfMaxChunks,
  resolveSalesPdfMaxPages,
  resolveSalesPdfMaxProviderCalls,
  resolveSalesPdfPagesPerChunk,
  SALES_PDF_CHUNK_MAX_TOKENS_CEILING,
  sha256Hex,
  splitPageRange,
  SALES_PDF_CHUNKED_EXTRACTION_VERSION,
} from './sales-pdf-chunking';
import {
  mergeChunkSales,
  toHistoricalSalesDocument,
  type MergeSalesResult,
} from './sales-pdf-merge';
import { splitPdfPageRange } from './sales-pdf-split';

const MAX_ATTEMPTS_PER_RANGE = 3;

type ChunkProvider = DocumentExtractionProvider & {
  extractHistoricalSalesChunk: NonNullable<DocumentExtractionProvider['extractHistoricalSalesChunk']>;
};

export type ChunkedExtractionOverallState =
  | 'PROCESSING'
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'FAILED';

export type ChunkedExtractionProgress = {
  overallState: ChunkedExtractionOverallState;
  extractionVersion: string;
  totalPages: number;
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  processingChunks: number;
  pendingChunks: number;
  supersededChunks: number;
  extractedRecordCount: number;
  progressPercent: number;
  failedPageRanges: Array<{ startPage: number; endPage: number; errorCode: string | null; safeMessage: string | null }>;
  providerCallCount: number;
  adaptiveSplitCount: number;
  sourceFingerprintPrefix: string;
};

type ChunkRow = {
  id: string;
  chunkIndex: number;
  startPage: number;
  endPage: number;
  pageCount: number;
  status: DocumentExtractionChunkStatus;
  attemptCount: number;
  chunkFingerprint: string;
  normalizedResult: Prisma.JsonValue | null;
  errorCode: string | null;
  safeErrorMessage: string | null;
};

@Injectable()
export class SalesChunkedExtractionService {
  private readonly logger = new Logger(SalesChunkedExtractionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(args: {
    tenantId: string;
    sessionId: string;
    fileId: string;
    pdfBuffer: Buffer;
    totalPages: number;
    provider: DocumentExtractionProvider;
    fullReset?: boolean;
  }): Promise<{
    document: HistoricalSalesExtractionDocument;
    merge: MergeSalesResult;
    progress: ChunkedExtractionProgress;
  }> {
    const {
      tenantId,
      sessionId,
      fileId,
      pdfBuffer,
      totalPages,
      provider,
      fullReset = false,
    } = args;

    if (!provider.extractHistoricalSalesChunk) {
      throw new ExtractionError(
        ExtractionErrorCode.PROVIDER_ERROR,
        'El proveedor de extracción no soporta extracción por bloques.',
      );
    }

    const maxPages = resolveSalesPdfMaxPages();
    if (totalPages > maxPages) {
      throw new ExtractionError(
        ExtractionErrorCode.PDF_PAGE_LIMIT_EXCEEDED,
        `El documento tiene demasiadas páginas (${totalPages}). El máximo permitido es ${maxPages}.`,
      );
    }

    const pagesPerChunk = resolveSalesPdfPagesPerChunk();
    const extractionVersion = SALES_PDF_CHUNKED_EXTRACTION_VERSION;
    const sourceFingerprint = sha256Hex(pdfBuffer);
    const modelId = provider.modelId;
    const maxChunks = resolveSalesPdfMaxChunks();
    const maxProviderCalls = resolveSalesPdfMaxProviderCalls();
    const concurrency = resolveSalesPdfChunkConcurrency();
    const chunkMaxTokens = resolveSalesPdfChunkMaxTokens();

    await this.recoverStaleChunks(tenantId, fileId, extractionVersion);

    if (fullReset) {
      await this.prisma.documentExtractionChunk.deleteMany({
        where: { tenantId, fileId, extractionVersion },
      });
    }

    const existing = await this.prisma.documentExtractionChunk.findMany({
      where: { tenantId, fileId, extractionVersion },
      orderBy: { chunkIndex: 'asc' },
    });

    const hasIncompatibleSource =
      existing.length > 0 && existing.some((c: { sourceFingerprint: string }) => c.sourceFingerprint !== sourceFingerprint);

    if (existing.length === 0 || hasIncompatibleSource) {
      if (hasIncompatibleSource) {
        await this.prisma.documentExtractionChunk.deleteMany({
          where: { tenantId, fileId, extractionVersion },
        });
      }

      const plans = planPageChunks(totalPages, pagesPerChunk);
      if (plans.length > maxChunks) {
        throw new ExtractionError(
          ExtractionErrorCode.CAPACITY_LIMIT,
          `El documento requeriría ${plans.length} bloques, por encima del límite de ${maxChunks}.`,
        );
      }

      await this.prisma.documentExtractionChunk.createMany({
        data: plans.map((plan) => ({
          tenantId,
          sessionId,
          fileId,
          importTarget: DataImportTarget.SALES,
          chunkIndex: plan.chunkIndex,
          startPage: plan.startPage,
          endPage: plan.endPage,
          pageCount: plan.pageCount,
          sourceFingerprint,
          chunkFingerprint: buildChunkFingerprint({
            sourceFingerprint,
            startPage: plan.startPage,
            endPage: plan.endPage,
            extractionVersion,
            modelId,
          }),
          status: DocumentExtractionChunkStatus.PENDING,
          extractionVersion,
        })),
        skipDuplicates: true,
      });
    }

    let providerCallCount = 0;
    let adaptiveSplitCount = 0;

    // Process until no PENDING/FAILED leaf work remains or capacity exhausted.
    for (let round = 0; round < maxProviderCalls; round += 1) {
      const leafs = await this.listActiveLeafChunks(tenantId, fileId, extractionVersion);
      const work = leafs.filter(
        (c) =>
          c.status === DocumentExtractionChunkStatus.PENDING ||
          c.status === DocumentExtractionChunkStatus.FAILED,
      );

      if (work.length === 0) break;

      if (providerCallCount >= maxProviderCalls) {
        this.logger.warn(
          `Provider call limit reached: ${JSON.stringify({
            tenantId,
            sessionId,
            fileId,
            providerCallCount,
            maxProviderCalls,
          })}`,
        );
        break;
      }

      await mapWithConcurrency(work, concurrency, async (chunk) => {
        if (providerCallCount >= maxProviderCalls) return;

        const claimed = await this.claimChunk(tenantId, chunk.id);
        if (!claimed) return;

        try {
          const fragment = await splitPdfPageRange(pdfBuffer, chunk.startPage, chunk.endPage);
          const chunkProvider = provider as ChunkProvider;

          const bumpCalls = () => {
            providerCallCount += 1;
            this.logger.log(
              `Sales chunk provider call: ${JSON.stringify({
                tenantId,
                sessionId,
                fileId,
                chunkId: chunk.id,
                chunkIndex: chunk.chunkIndex,
                startPage: chunk.startPage,
                endPage: chunk.endPage,
                attempt: chunk.attemptCount + 1,
                provider: provider.providerName,
                model: modelId,
                providerCallCount,
              })}`,
            );
            return providerCallCount <= maxProviderCalls;
          };

          let result: Awaited<ReturnType<ChunkProvider['extractHistoricalSalesChunk']>>;
          try {
            if (!bumpCalls()) {
              await this.failChunk(
                chunk.id,
                ExtractionErrorCode.CAPACITY_LIMIT,
                'capacity',
                'Se alcanzó el límite de llamadas al proveedor de extracción.',
              );
              return;
            }
            result = await chunkProvider.extractHistoricalSalesChunk({
              pdfBuffer: fragment,
              startPage: chunk.startPage,
              endPage: chunk.endPage,
              maxTokens: chunkMaxTokens,
            });
          } catch (err) {
            const code = isExtractionError(err) ? err.code : ExtractionErrorCode.PROVIDER_ERROR;
            const safeMessage = isExtractionError(err)
              ? err.safeMessage
              : 'Error al procesar un bloque del documento.';

            if (code !== ExtractionErrorCode.OUTPUT_TRUNCATED) {
              throw err;
            }

            // Multi-page truncation → adaptive page split (handled below via rethrow marker).
            if (chunk.pageCount > 1 && chunk.attemptCount + 1 < MAX_ATTEMPTS_PER_RANGE) {
              const split = splitPageRange(chunk.startPage, chunk.endPage);
              if (split) {
                const [left, right] = split;
                const nextIndexBase = await this.nextChunkIndex(tenantId, fileId, extractionVersion);
                if (nextIndexBase + 2 > maxChunks) {
                  await this.failChunk(chunk.id, code, 'capacity', safeMessage);
                  return;
                }

                adaptiveSplitCount += 1;
                await this.prisma.$transaction([
                  this.prisma.documentExtractionChunk.update({
                    where: { id: chunk.id },
                    data: {
                      status: DocumentExtractionChunkStatus.SUPERSEDED,
                      attemptCount: { increment: 1 },
                      errorCode: code,
                      errorCategory: 'capacity',
                      safeErrorMessage: safeMessage,
                      completedAt: new Date(),
                    },
                  }),
                  this.prisma.documentExtractionChunk.create({
                    data: {
                      tenantId,
                      sessionId,
                      fileId,
                      importTarget: DataImportTarget.SALES,
                      chunkIndex: nextIndexBase,
                      startPage: left.startPage,
                      endPage: left.endPage,
                      pageCount: left.endPage - left.startPage + 1,
                      sourceFingerprint,
                      chunkFingerprint: buildChunkFingerprint({
                        sourceFingerprint,
                        startPage: left.startPage,
                        endPage: left.endPage,
                        extractionVersion,
                        modelId,
                      }),
                      parentChunkId: chunk.id,
                      status: DocumentExtractionChunkStatus.PENDING,
                      extractionVersion,
                    },
                  }),
                  this.prisma.documentExtractionChunk.create({
                    data: {
                      tenantId,
                      sessionId,
                      fileId,
                      importTarget: DataImportTarget.SALES,
                      chunkIndex: nextIndexBase + 1,
                      startPage: right.startPage,
                      endPage: right.endPage,
                      pageCount: right.endPage - right.startPage + 1,
                      sourceFingerprint,
                      chunkFingerprint: buildChunkFingerprint({
                        sourceFingerprint,
                        startPage: right.startPage,
                        endPage: right.endPage,
                        extractionVersion,
                        modelId,
                      }),
                      parentChunkId: chunk.id,
                      status: DocumentExtractionChunkStatus.PENDING,
                      extractionVersion,
                    },
                  }),
                ]);

                this.logger.log(
                  `Sales chunk adaptive split: ${JSON.stringify({
                    parentChunkId: chunk.id,
                    from: `${chunk.startPage}-${chunk.endPage}`,
                    left: `${left.startPage}-${left.endPage}`,
                    right: `${right.startPage}-${right.endPage}`,
                    adaptiveSplitCount,
                  })}`,
                );
                return;
              }
            }

            // Single-page truncation → escalate tokens (if needed) then dense row batches.
            if (chunk.pageCount === 1) {
              result = await this.extractDenseSinglePage({
                provider: chunkProvider,
                fragment,
                chunk,
                preferredMaxTokens: chunkMaxTokens,
                bumpCalls,
              });
            } else {
              throw err;
            }
          }

          await this.prisma.documentExtractionChunk.update({
            where: { id: chunk.id },
            data: {
              status: DocumentExtractionChunkStatus.COMPLETED,
              attemptCount: { increment: 1 },
              provider: provider.providerName,
              model: modelId,
              stopReason: result.stopReason,
              rawResult: undefined,
              normalizedResult: result.document as unknown as Prisma.InputJsonValue,
              saleCount: result.document.sales.length,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              durationMs: result.durationMs,
              providerRequestId: result.requestId,
              errorCode: null,
              errorCategory: null,
              safeErrorMessage: null,
              completedAt: new Date(),
            },
          });

          this.logger.log(
            `Sales chunk completed: ${JSON.stringify({
              chunkId: chunk.id,
              chunkIndex: chunk.chunkIndex,
              startPage: chunk.startPage,
              endPage: chunk.endPage,
              saleCount: result.document.sales.length,
              durationMs: result.durationMs,
              stopReason: result.stopReason,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
            })}`,
          );
        } catch (err) {
          const code = isExtractionError(err) ? err.code : ExtractionErrorCode.PROVIDER_ERROR;
          const safeMessage = isExtractionError(err)
            ? err.safeMessage
            : 'Error al procesar un bloque del documento.';

          await this.failChunk(
            chunk.id,
            code,
            code === ExtractionErrorCode.OUTPUT_TRUNCATED ||
              code === ExtractionErrorCode.CAPACITY_LIMIT ||
              code === ExtractionErrorCode.PDF_PAGE_LIMIT_EXCEEDED
              ? 'capacity'
              : 'provider',
            safeMessage,
          );
        }
      });
    }

    const progress = await this.buildProgress(tenantId, fileId, extractionVersion, sourceFingerprint, {
      providerCallCount,
      adaptiveSplitCount,
    });

    const completed = await this.prisma.documentExtractionChunk.findMany({
      where: {
        tenantId,
        fileId,
        extractionVersion,
        status: DocumentExtractionChunkStatus.COMPLETED,
      },
      orderBy: [{ startPage: 'asc' }, { endPage: 'asc' }, { chunkIndex: 'asc' }],
    });

    const bundles = completed.map((c) => {
      const doc = c.normalizedResult as HistoricalSalesExtractionDocument | null;
      const sales: ExtractedHistoricalSale[] = Array.isArray(doc?.sales) ? doc!.sales : [];
      return {
        chunkId: c.id,
        chunkIndex: c.chunkIndex,
        startPage: c.startPage,
        endPage: c.endPage,
        sales,
      };
    });

    const merge = mergeChunkSales({ fileId, extractionVersion, chunks: bundles });
    const document = toHistoricalSalesDocument(merge.sales);

    this.logger.log(
      `Sales chunked extraction finished: ${JSON.stringify({
        tenantId,
        sessionId,
        fileId,
        sourceFingerprintPrefix: sourceFingerprint.slice(0, 12),
        totalPages,
        extractionVersion,
        overallState: progress.overallState,
        totalChunks: progress.totalChunks,
        completedChunks: progress.completedChunks,
        failedChunks: progress.failedChunks,
        extractedRecordCount: progress.extractedRecordCount,
        providerCallCount: progress.providerCallCount,
        adaptiveSplitCount: progress.adaptiveSplitCount,
      })}`,
    );

    return { document, merge, progress };
  }

  async getProgress(tenantId: string, fileId: string): Promise<ChunkedExtractionProgress | null> {
    const rows = await this.prisma.documentExtractionChunk.findMany({
      where: { tenantId, fileId, extractionVersion: SALES_PDF_CHUNKED_EXTRACTION_VERSION },
    });
    if (rows.length === 0) return null;
    const sourceFingerprint = rows[0]?.sourceFingerprint ?? '';
    return this.buildProgress(tenantId, fileId, SALES_PDF_CHUNKED_EXTRACTION_VERSION, sourceFingerprint, {
      providerCallCount: 0,
      adaptiveSplitCount: 0,
    });
  }

  private async listActiveLeafChunks(
    tenantId: string,
    fileId: string,
    extractionVersion: string,
  ): Promise<ChunkRow[]> {
    return this.prisma.documentExtractionChunk.findMany({
      where: {
        tenantId,
        fileId,
        extractionVersion,
        status: {
          in: [
            DocumentExtractionChunkStatus.PENDING,
            DocumentExtractionChunkStatus.FAILED,
            DocumentExtractionChunkStatus.PROCESSING,
            DocumentExtractionChunkStatus.COMPLETED,
          ],
        },
      },
      select: {
        id: true,
        chunkIndex: true,
        startPage: true,
        endPage: true,
        pageCount: true,
        status: true,
        attemptCount: true,
        chunkFingerprint: true,
        normalizedResult: true,
        errorCode: true,
        safeErrorMessage: true,
      },
      orderBy: { chunkIndex: 'asc' },
    });
  }

  private async extractDenseSinglePage(args: {
    provider: ChunkProvider;
    fragment: Buffer;
    chunk: ChunkRow;
    preferredMaxTokens: number;
    bumpCalls: () => boolean;
  }): Promise<Awaited<ReturnType<ChunkProvider['extractHistoricalSalesChunk']>>> {
    const { provider, fragment, chunk, preferredMaxTokens, bumpCalls } = args;
    const maxTokens = Math.max(preferredMaxTokens, SALES_PDF_CHUNK_MAX_TOKENS_CEILING);

    // Escalate to the token ceiling once before batching (covers env still at 8k).
    if (preferredMaxTokens < SALES_PDF_CHUNK_MAX_TOKENS_CEILING) {
      if (!bumpCalls()) {
        throw new ExtractionError(
          ExtractionErrorCode.CAPACITY_LIMIT,
          'Se alcanzó el límite de llamadas al proveedor de extracción.',
        );
      }
      try {
        this.logger.log(
          `Sales chunk token escalate: ${JSON.stringify({
            chunkId: chunk.id,
            pages: `${chunk.startPage}-${chunk.endPage}`,
            fromTokens: preferredMaxTokens,
            toTokens: maxTokens,
          })}`,
        );
        return await provider.extractHistoricalSalesChunk({
          pdfBuffer: fragment,
          startPage: chunk.startPage,
          endPage: chunk.endPage,
          maxTokens,
        });
      } catch (err) {
        if (!(isExtractionError(err) && err.code === ExtractionErrorCode.OUTPUT_TRUNCATED)) {
          throw err;
        }
        // fall through to dense batches
      }
    }

    const collected: ExtractedHistoricalSale[] = [];
    const seen = new Set<string>();
    let batchSizeIndex = 0;
    let batchSize: number = DENSE_PAGE_BATCH_SIZES[0];
    let totalIn = 0;
    let totalOut = 0;
    let lastStop: string | null = null;
    let lastRequestId: string | null = null;
    let totalDuration = 0;

    for (let pass = 1; pass <= MAX_DENSE_PAGE_PASSES; pass += 1) {
      if (!bumpCalls()) {
        throw new ExtractionError(
          ExtractionErrorCode.CAPACITY_LIMIT,
          'Se alcanzó el límite de llamadas al proveedor durante la extracción densa de una página.',
        );
      }

      const priors = [...seen].slice(-80);
      try {
        this.logger.log(
          `Sales chunk dense-page batch: ${JSON.stringify({
            chunkId: chunk.id,
            page: chunk.startPage,
            pass,
            batchSize,
            priorCount: seen.size,
          })}`,
        );

        const batch = await provider.extractHistoricalSalesChunk({
          pdfBuffer: fragment,
          startPage: chunk.startPage,
          endPage: chunk.endPage,
          maxTokens,
          maxSales: batchSize,
          batchPass: pass,
          priorSaleFingerprints: priors,
        });

        lastStop = batch.stopReason;
        lastRequestId = batch.requestId;
        totalDuration += batch.durationMs;
        totalIn += batch.inputTokens ?? 0;
        totalOut += batch.outputTokens ?? 0;

        let added = 0;
        for (const sale of batch.document.sales ?? []) {
          const fp = historicalSaleFingerprint(sale);
          if (seen.has(fp)) continue;
          seen.add(fp);
          collected.push(sale);
          added += 1;
        }

        if (added === 0 || (batch.document.sales?.length ?? 0) < batchSize) {
          break;
        }
      } catch (err) {
        if (isExtractionError(err) && err.code === ExtractionErrorCode.OUTPUT_TRUNCATED) {
          if (batchSizeIndex < DENSE_PAGE_BATCH_SIZES.length - 1) {
            batchSizeIndex += 1;
            batchSize = DENSE_PAGE_BATCH_SIZES[batchSizeIndex];
            this.logger.warn(
              `Sales chunk dense-page reduce batch: ${JSON.stringify({
                chunkId: chunk.id,
                page: chunk.startPage,
                nextBatchSize: batchSize,
              })}`,
            );
            continue;
          }
          throw new ExtractionError(
            ExtractionErrorCode.OUTPUT_TRUNCATED,
            `No se pudo completar la extracción de la página ${chunk.startPage} porque la respuesta se truncó incluso en lotes pequeños.`,
            { startPage: chunk.startPage, endPage: chunk.endPage, batchSize },
          );
        }
        throw err;
      }
    }

    if (collected.length === 0) {
      throw new ExtractionError(
        ExtractionErrorCode.OUTPUT_TRUNCATED,
        `No se pudo completar la extracción del bloque de páginas ${chunk.startPage}–${chunk.endPage} porque la respuesta se truncó.`,
        { startPage: chunk.startPage, endPage: chunk.endPage },
      );
    }

    return {
      document: {
        sales: collected,
        extractionVersion: SALES_PDF_CHUNKED_EXTRACTION_VERSION,
      },
      stopReason: lastStop,
      inputTokens: totalIn || null,
      outputTokens: totalOut || null,
      requestId: lastRequestId,
      durationMs: totalDuration,
    };
  }

  private async claimChunk(tenantId: string, chunkId: string): Promise<boolean> {
    const updated = await this.prisma.documentExtractionChunk.updateMany({
      where: {
        id: chunkId,
        tenantId,
        status: {
          in: [DocumentExtractionChunkStatus.PENDING, DocumentExtractionChunkStatus.FAILED],
        },
      },
      data: {
        status: DocumentExtractionChunkStatus.PROCESSING,
        startedAt: new Date(),
        errorCode: null,
        errorCategory: null,
        safeErrorMessage: null,
      },
    });
    return updated.count === 1;
  }

  private async failChunk(
    chunkId: string,
    errorCode: string,
    errorCategory: string,
    safeErrorMessage: string,
  ): Promise<void> {
    await this.prisma.documentExtractionChunk.update({
      where: { id: chunkId },
      data: {
        status: DocumentExtractionChunkStatus.FAILED,
        attemptCount: { increment: 1 },
        errorCode,
        errorCategory,
        safeErrorMessage,
        completedAt: new Date(),
      },
    });
  }

  private async nextChunkIndex(
    tenantId: string,
    fileId: string,
    extractionVersion: string,
  ): Promise<number> {
    const max = await this.prisma.documentExtractionChunk.aggregate({
      where: { tenantId, fileId, extractionVersion },
      _max: { chunkIndex: true },
    });
    return (max._max.chunkIndex ?? -1) + 1;
  }

  private async recoverStaleChunks(
    tenantId: string,
    fileId: string,
    extractionVersion: string,
  ): Promise<void> {
    const minutes = resolveSalesPdfChunkStaleMinutes();
    const threshold = new Date(Date.now() - minutes * 60_000);
    const recovered = await this.prisma.documentExtractionChunk.updateMany({
      where: {
        tenantId,
        fileId,
        extractionVersion,
        status: DocumentExtractionChunkStatus.PROCESSING,
        startedAt: { lt: threshold },
      },
      data: {
        status: DocumentExtractionChunkStatus.FAILED,
        errorCode: ExtractionErrorCode.TIMEOUT,
        errorCategory: 'timeout',
        safeErrorMessage: 'El bloque quedó incompleto. Se reintentará automáticamente.',
      },
    });
    if (recovered.count > 0) {
      this.logger.warn(
        `Recovered stale sales extraction chunks: ${JSON.stringify({ tenantId, fileId, count: recovered.count })}`,
      );
    }
  }

  private async buildProgress(
    tenantId: string,
    fileId: string,
    extractionVersion: string,
    sourceFingerprint: string,
    extras: { providerCallCount: number; adaptiveSplitCount: number },
  ): Promise<ChunkedExtractionProgress> {
    const rows = await this.prisma.documentExtractionChunk.findMany({
      where: { tenantId, fileId, extractionVersion },
    });

    const leafs = rows.filter((r) => r.status !== DocumentExtractionChunkStatus.SUPERSEDED);
    const completedChunks = leafs.filter((r) => r.status === DocumentExtractionChunkStatus.COMPLETED).length;
    const failedChunks = leafs.filter((r) => r.status === DocumentExtractionChunkStatus.FAILED).length;
    const processingChunks = leafs.filter((r) => r.status === DocumentExtractionChunkStatus.PROCESSING).length;
    const pendingChunks = leafs.filter((r) => r.status === DocumentExtractionChunkStatus.PENDING).length;
    const supersededChunks = rows.filter((r) => r.status === DocumentExtractionChunkStatus.SUPERSEDED).length;
    const totalChunks = leafs.length;
    const extractedRecordCount = leafs
      .filter((r) => r.status === DocumentExtractionChunkStatus.COMPLETED)
      .reduce((sum, r) => sum + (r.saleCount ?? 0), 0);

    const totalPages = Math.max(0, ...rows.map((r) => r.endPage));
    const done = completedChunks + failedChunks;
    const progressPercent = totalChunks === 0 ? 0 : Math.min(100, Math.round((done / totalChunks) * 100));

    let overallState: ChunkedExtractionOverallState = 'PROCESSING';
    if (processingChunks === 0 && pendingChunks === 0) {
      if (failedChunks === 0 && completedChunks > 0) overallState = 'COMPLETED';
      else if (completedChunks > 0 && failedChunks > 0) overallState = 'PARTIALLY_COMPLETED';
      else overallState = 'FAILED';
    }

    return {
      overallState,
      extractionVersion,
      totalPages,
      totalChunks,
      completedChunks,
      failedChunks,
      processingChunks,
      pendingChunks,
      supersededChunks,
      extractedRecordCount,
      progressPercent,
      failedPageRanges: leafs
        .filter((r) => r.status === DocumentExtractionChunkStatus.FAILED)
        .map((r) => ({
          startPage: r.startPage,
          endPage: r.endPage,
          errorCode: r.errorCode,
          safeMessage: r.safeErrorMessage,
        })),
      providerCallCount: extras.providerCallCount,
      adaptiveSplitCount: extras.adaptiveSplitCount,
      sourceFingerprintPrefix: sourceFingerprint.slice(0, 12),
    };
  }
}
