import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DataImportEntityType,
  DataImportEventType,
  DataImportFileStatus,
  DataImportFileType,
  DataImportRecordStatus,
  DataImportStatus,
  DataImportTarget,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import type { ExtractionState } from './inventory-import/inventory-invoice-extraction.types';
import {
  bridgeExtractedHistoricalSale,
  HistoricalSalesExtractionSchema,
  SALES_IDENTITY_MAPPING,
  type HistoricalSalesExtractionDocument,
} from './sales-import/historical-sale-extraction.types';
import type { SalesMappingEntry } from './sales-import/historical-sale.types';
import { buildSalesMappingVersion } from './sales-import/sales-field-mapping';
import type { DocumentExtractionProvider } from './providers/document-extraction.provider.interface';
import {
  ExtractionError,
  ExtractionErrorCode,
  buildSafeExtractionRecord,
  isExtractionError,
  serializeProviderErrorForDiagnostics,
} from './providers/extraction-errors';
import { createExtractionProvider } from './providers/extraction.provider.factory';
import { HISTORICAL_SALES_EXTRACTION_VERSION } from './providers/prompts/historical-sales-extraction-v1';
import { SalesChunkedExtractionService } from './sales-import/sales-chunked-extraction.service';
import type { ImportFileStorage } from './storage/import-file-storage.interface';
import { IMPORT_FILE_STORAGE } from './tokens';
import {
  PDF_INSPECTION_MESSAGES,
  inspectPdf,
  maxPdfPages,
} from './utils/file-validation.util';
import { SALES_PDF_CHUNKED_EXTRACTION_VERSION } from './sales-import/sales-pdf-chunking';
import {
  HistoricalSalesMergedExtractionSchema,
} from './sales-import/historical-sale-extraction.types';

const EXTRACTABLE_STATUSES: DataImportStatus[] = [
  DataImportStatus.UPLOADING,
  DataImportStatus.READY_FOR_REVIEW,
  DataImportStatus.FAILED,
];

function staleThresholdMs(): number {
  const minutes = parseInt(process.env.DOCUMENT_PROCESSING_STALE_TIMEOUT_MINUTES ?? '15', 10);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 15) * 60_000;
}

@Injectable()
export class PdfSalesImportService {
  private readonly logger = new Logger(PdfSalesImportService.name);

  private readonly provider: DocumentExtractionProvider | null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(IMPORT_FILE_STORAGE) private readonly storage: ImportFileStorage,
    private readonly chunkedExtraction: SalesChunkedExtractionService,
  ) {
    this.provider = createExtractionProvider();
    if (this.provider) {
      this.logger.log(`Sales document extraction provider: ${this.provider.providerName} / ${this.provider.modelId}`);
    } else {
      this.logger.log('Document extraction is disabled (DOCUMENT_EXTRACTION_PROVIDER not set)');
    }
  }

  async processDocument(tenantId: string, sessionId: string): Promise<{ fileId: string; saleCount: number }> {
    if (!this.provider) {
      throw new ServiceUnavailableException(
        'La extracción de documentos PDF no está habilitada en este servidor.',
      );
    }

    await this.recoverStaleProcessing(tenantId, sessionId);

    const session = await this.requireSalesSession(tenantId, sessionId);

    if (!EXTRACTABLE_STATUSES.includes(session.status)) {
      throw new ConflictException(
        `No se puede procesar el documento en estado ${session.status}`,
      );
    }

    const file = await this.prisma.dataImportFile.findFirst({
      where: { tenantId, sessionId, fileType: DataImportFileType.PDF },
    });
    if (!file) {
      throw new UnprocessableEntityException(
        'No hay un archivo PDF en esta sesión. Suba un archivo PDF primero.',
      );
    }

    const claimed = await this.prisma.dataImportSession.updateMany({
      where: { id: sessionId, tenantId, status: { in: EXTRACTABLE_STATUSES } },
      data: {
        status: DataImportStatus.PROCESSING,
        startedAt: new Date(),
        errorMessage: null,
        dryRunVersion: null,
        warningRows: 0,
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException('La sesión ya está siendo procesada. Intente de nuevo en un momento.');
    }

    await this.prisma.dataImportFile.update({
      where: { id: file.id },
      data: { status: DataImportFileStatus.PROCESSING, extractionError: null },
    });

    const providerName = this.provider.providerName;
    const modelId = this.provider.modelId;

    await this.logEvent(tenantId, sessionId, DataImportEventType.SALES_EXTRACTION_STARTED, 'Sales PDF extraction started', {
      fileId: file.id,
      provider: providerName,
      model: modelId,
      promptVersion: HISTORICAL_SALES_EXTRACTION_VERSION,
    });

    const startedAt = Date.now();

    try {
      const buffer = await this.storage.read(file.storageKey);

      const inspection = await inspectPdf(buffer);

      if (inspection.parseStatus === 'ENCRYPTED') {
        throw new ExtractionError(
          ExtractionErrorCode.PDF_ENCRYPTED,
          PDF_INSPECTION_MESSAGES.ENCRYPTED,
        );
      }

      if (inspection.parseStatus === 'CORRUPT') {
        throw new ExtractionError(
          ExtractionErrorCode.PDF_CORRUPT,
          PDF_INSPECTION_MESSAGES.CORRUPT,
        );
      }

      const pageCount = inspection.pageCount ?? 0;
      const pageLimit = maxPdfPages();
      // Prefer the higher sales-specific page guard inside chunked service; keep legacy guard as soft check.
      if (pageCount > 0 && pageCount > Math.max(pageLimit, 500)) {
        throw new ExtractionError(
          ExtractionErrorCode.PAGE_LIMIT_EXCEEDED,
          `El documento tiene demasiadas páginas (${pageCount}). El máximo permitido es ${Math.max(pageLimit, 500)}.`,
        );
      }
      if (inspection.parseStatus === 'UNKNOWN_PAGE_COUNT' || pageCount <= 0) {
        throw new ExtractionError(
          ExtractionErrorCode.INVALID_PDF,
          'No se pudo determinar el número de páginas del PDF. Verifica el archivo e inténtalo nuevamente.',
        );
      }

      const { document: extraction, merge, progress } = await this.chunkedExtraction.run({
        tenantId,
        sessionId,
        fileId: file.id,
        pdfBuffer: buffer,
        totalPages: pageCount,
        provider: this.provider,
        fullReset: false,
      });

      if (progress.overallState === 'FAILED') {
        throw new ExtractionError(
          ExtractionErrorCode.PARTIAL_FAILURE,
          'No se pudo extraer ningún bloque del documento. Revisa el archivo o reintenta.',
          { progress },
        );
      }

      const identityMapping = SALES_IDENTITY_MAPPING as unknown as SalesMappingEntry[];
      const mappingVersion = buildSalesMappingVersion(identityMapping);

      const recordRows = merge.sales.map((sale, i) => {
        const bridged = bridgeExtractedHistoricalSale(sale);
        const provenance = sale._provenance?.[0];
        return {
          tenantId,
          sessionId,
          fileId: file.id,
          entityType: DataImportEntityType.SALES,
          sourceSheet: provenance
            ? `PDF p.${provenance.sourcePageStart}-${provenance.sourcePageEnd}`
            : 'PDF',
          sourceRowNumber: sale.sourceRow ?? i + 1,
          rawData: {
            ...bridged,
            _provenance: sale._provenance,
            _recordFingerprint: sale._recordFingerprint,
          } as unknown as Prisma.InputJsonValue,
          isValid: true,
          importStatus: DataImportRecordStatus.STAGED,
          duplicateKey: sale._recordFingerprint ?? null,
        };
      });

      const isPartial = progress.overallState === 'PARTIALLY_COMPLETED';
      const extractedPayload = {
        ...extraction,
        extractionVersion: SALES_PDF_CHUNKED_EXTRACTION_VERSION,
        chunkProgress: progress,
        duplicateWarnings: merge.duplicateWarnings,
        provenanceByIndex: merge.sales.map((s) => s._provenance ?? []),
      };

      await this.prisma.$transaction(async (tx) => {
        await tx.dataImportRecord.deleteMany({ where: { tenantId, sessionId } });
        if (recordRows.length > 0) {
          await tx.dataImportRecord.createMany({ data: recordRows });
        }
        await tx.dataImportFile.update({
          where: { id: file.id },
          data: {
            status: DataImportFileStatus.PARSED,
            rowCount: recordRows.length,
            detectedEntityType: DataImportEntityType.SALES,
            fieldMapping: identityMapping as unknown as Prisma.InputJsonValue,
            mappingVersion,
            extractedDocumentData: extractedPayload as unknown as Prisma.InputJsonValue,
            extractionProvider: providerName,
            extractionModel: modelId,
            extractionError: isPartial
              ? JSON.stringify({
                  code: ExtractionErrorCode.PARTIAL_FAILURE,
                  category: 'partial',
                  safeMessage:
                    'Se extrajeron algunos bloques, pero uno o más bloques requieren revisión o reintento.',
                  provider: providerName,
                  model: modelId,
                  occurredAt: new Date().toISOString(),
                  progress,
                })
              : null,
            errorMessage: null,
          },
        });
        await tx.dataImportSession.update({
          where: { id: sessionId },
          data: {
            status: DataImportStatus.READY_FOR_REVIEW,
            totalFiles: 1,
            processedFiles: 1,
            totalRows: recordRows.length,
            validRows: recordRows.length,
            completedAt: new Date(),
            errorMessage: isPartial
              ? 'Se extrajeron algunos bloques, pero uno o más bloques requieren revisión o reintento.'
              : null,
          },
        });
      });

      const durationMs = Date.now() - startedAt;
      await this.logEvent(
        tenantId,
        sessionId,
        isPartial
          ? DataImportEventType.SALES_EXTRACTION_FAILED
          : DataImportEventType.SALES_EXTRACTION_COMPLETED,
        isPartial ? 'Sales PDF chunked extraction partially completed' : 'Sales PDF chunked extraction completed',
        {
          fileId: file.id,
          saleCount: recordRows.length,
          durationMs,
          pageCount,
          extractionVersion: SALES_PDF_CHUNKED_EXTRACTION_VERSION,
          progress,
        },
      );

      return { fileId: file.id, saleCount: recordRows.length };
    } catch (err) {
      const safeRecord = buildSafeExtractionRecord(err, providerName, modelId);
      const durationMs = Date.now() - startedAt;

      // Log complete original error for ops. Nest Logger.error(msg, stack?) treats
      // the 2nd arg as a string stack; embed JSON in msg.
      // Storage failures are classified as IMPORT_STORAGE_ERROR (not provider).
      this.logger.error(
        `Sales PDF extraction failed — diagnostics: ${JSON.stringify({
          errorCode: safeRecord.code,
          errorCategory: safeRecord.category,
          provider: providerName,
          model: modelId,
          sessionId,
          tenantId,
          durationMs,
          error: serializeProviderErrorForDiagnostics(err),
        })}`,
      );

      if (isExtractionError(err) && err.debugInfo) {
        this.logger.debug(`Sales extraction schema error [${sessionId}]: ${JSON.stringify(err.debugInfo)}`);
      }

      await this.prisma.dataImportFile.update({
        where: { id: file.id },
        data: {
          status: DataImportFileStatus.FAILED,
          extractionError: JSON.stringify(safeRecord),
        },
      });
      await this.prisma.dataImportSession.update({
        where: { id: sessionId },
        data: { status: DataImportStatus.FAILED, errorMessage: safeRecord.safeMessage },
      });

      await this.logEvent(tenantId, sessionId, DataImportEventType.SALES_EXTRACTION_FAILED, 'Sales PDF extraction failed', {
        fileId: file.id,
        errorCode: safeRecord.code,
        errorCategory: safeRecord.category,
        durationMs,
      });

      throw new UnprocessableEntityException(safeRecord.safeMessage);
    }
  }

  async getExtraction(tenantId: string, sessionId: string): Promise<{
    fileId: string;
    extractionState: ExtractionState;
    extraction: HistoricalSalesExtractionDocument | null;
    extractionProvider: string | null;
    extractionModel: string | null;
    extractionError: string | null;
    saleCount: number;
    chunkProgress?: Record<string, unknown> | null;
  }> {
    const session = await this.requireSalesSession(tenantId, sessionId);

    if (session.status === DataImportStatus.PROCESSING) {
      const file = await this.prisma.dataImportFile.findFirst({
        where: { tenantId, sessionId, fileType: DataImportFileType.PDF },
        select: { id: true },
      });
      const progress = file
        ? await this.chunkedExtraction.getProgress(tenantId, file.id)
        : null;
      return {
        fileId: file?.id ?? '',
        extractionState: 'processing',
        extraction: null,
        extractionProvider: null,
        extractionModel: null,
        extractionError: null,
        saleCount: 0,
        chunkProgress: progress as unknown as Record<string, unknown> | null,
      };
    }

    const file = await this.prisma.dataImportFile.findFirst({
      where: { tenantId, sessionId, fileType: DataImportFileType.PDF },
      select: {
        id: true,
        rowCount: true,
        extractedDocumentData: true,
        extractionProvider: true,
        extractionModel: true,
        extractionError: true,
      },
    });
    if (!file) {
      throw new NotFoundException('No hay un archivo PDF en esta sesión.');
    }

    const liveProgress = await this.chunkedExtraction.getProgress(tenantId, file.id);

    if (!file.extractedDocumentData) {
      const state: ExtractionState = file.extractionError ? 'failed' : 'not_processed';
      return {
        fileId: file.id,
        extractionState: state,
        extraction: null,
        extractionProvider: file.extractionProvider,
        extractionModel: file.extractionModel,
        extractionError: file.extractionError,
        saleCount: file.rowCount,
        chunkProgress: liveProgress as unknown as Record<string, unknown> | null,
      };
    }

    const parsed = HistoricalSalesMergedExtractionSchema.safeParse(file.extractedDocumentData);
    if (!parsed.success) {
      // Backward compatible with single-pass v1 payloads.
      const legacy = HistoricalSalesExtractionSchema.safeParse(file.extractedDocumentData);
      if (!legacy.success) {
        this.logger.warn(
          `Stored sales extraction for session ${sessionId} failed re-validation ` +
          `(${parsed.error.issues.length} issue(s)). Returning 'corrupt' state.`,
        );
        return {
          fileId: file.id,
          extractionState: 'corrupt',
          extraction: null,
          extractionProvider: file.extractionProvider,
          extractionModel: file.extractionModel,
          extractionError: 'Los datos de extracción almacenados no son compatibles con la versión actual del esquema.',
          saleCount: file.rowCount,
          chunkProgress: liveProgress as unknown as Record<string, unknown> | null,
        };
      }
    }

    const payload = (parsed.success ? parsed.data : file.extractedDocumentData) as HistoricalSalesExtractionDocument & {
      chunkProgress?: Record<string, unknown>;
    };

    const isPartial =
      liveProgress?.overallState === 'PARTIALLY_COMPLETED' ||
      (typeof file.extractionError === 'string' && file.extractionError.includes('EXTRACTION_PARTIAL_FAILURE'));

    return {
      fileId: file.id,
      extractionState: isPartial ? 'partially_completed' : 'ready',
      extraction: {
        sales: payload.sales,
        extractionVersion: payload.extractionVersion,
        overallConfidence: payload.overallConfidence,
      },
      extractionProvider: file.extractionProvider,
      extractionModel: file.extractionModel,
      extractionError: file.extractionError,
      saleCount: file.rowCount,
      chunkProgress: (liveProgress ?? payload.chunkProgress ?? null) as unknown as Record<string, unknown> | null,
    };
  }

  async updateExtraction(
    tenantId: string,
    sessionId: string,
    extraction: HistoricalSalesExtractionDocument,
  ): Promise<{ saleCount: number }> {
    const session = await this.requireSalesSession(tenantId, sessionId);

    if (session.status !== DataImportStatus.READY_FOR_REVIEW) {
      throw new ConflictException(
        `Solo se puede editar la extracción cuando la sesión está en READY_FOR_REVIEW (actual: ${session.status})`,
      );
    }

    const file = await this.prisma.dataImportFile.findFirst({
      where: { tenantId, sessionId, fileType: DataImportFileType.PDF },
    });
    if (!file) {
      throw new NotFoundException('No hay un archivo PDF en esta sesión.');
    }

    const identityMapping = SALES_IDENTITY_MAPPING as unknown as SalesMappingEntry[];
    const mappingVersion = buildSalesMappingVersion(identityMapping);

    const recordRows = extraction.sales.map((sale, i) => ({
      tenantId,
      sessionId,
      fileId: file.id,
      entityType: DataImportEntityType.SALES,
      sourceSheet: 'PDF',
      sourceRowNumber: sale.sourceRow ?? i + 1,
      rawData: bridgeExtractedHistoricalSale(sale) as unknown as Prisma.InputJsonValue,
      isValid: true,
      importStatus: DataImportRecordStatus.STAGED,
    }));

    const sanitizedExtraction = {
      ...extraction,
      extractionVersion: HISTORICAL_SALES_EXTRACTION_VERSION,
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.dataImportRecord.deleteMany({ where: { tenantId, sessionId } });
      if (recordRows.length > 0) {
        await tx.dataImportRecord.createMany({ data: recordRows });
      }
      await tx.dataImportFile.update({
        where: { id: file.id },
        data: {
          rowCount: recordRows.length,
          extractedDocumentData: sanitizedExtraction as unknown as Prisma.InputJsonValue,
          fieldMapping: identityMapping as unknown as Prisma.InputJsonValue,
          mappingVersion,
        },
      });
      await tx.dataImportSession.update({
        where: { id: sessionId },
        data: {
          totalRows: recordRows.length,
          validRows: recordRows.length,
          warningRows: 0,
          invalidRows: 0,
          dryRunVersion: null,
        },
      });
    });

    await this.logEvent(tenantId, sessionId, DataImportEventType.SALES_EXTRACTION_EDITED, 'Sales extraction edited by user', {
      fileId: file.id,
      saleCount: recordRows.length,
    });

    return { saleCount: recordRows.length };
  }

  async reprocessDocument(
    tenantId: string,
    sessionId: string,
    opts: { confirmDiscardEdits?: boolean } = {},
  ): Promise<{ fileId: string; saleCount: number }> {
    if (!opts.confirmDiscardEdits) {
      const editEvent = await this.prisma.dataImportEvent.findFirst({
        where: { tenantId, sessionId, eventType: DataImportEventType.SALES_EXTRACTION_EDITED },
      });
      if (editEvent) {
        throw new ConflictException({
          code: 'MANUAL_EDITS_WOULD_BE_DISCARDED',
          message: 'Se encontraron ediciones manuales. Confirma que deseas descartarlas para volver a procesar.',
        });
      }
    }

    if (opts.confirmDiscardEdits) {
      await this.logEvent(
        tenantId,
        sessionId,
        DataImportEventType.SALES_EXTRACTION_STARTED,
        'Sales reprocess requested — manual edits discarded',
        { confirmDiscardEdits: true },
      );
    }

    return this.processDocument(tenantId, sessionId);
  }

  private async requireSalesSession(tenantId: string, sessionId: string) {
    const session = await this.prisma.dataImportSession.findFirst({
      where: { id: sessionId, tenantId },
    });
    if (!session) throw new NotFoundException('Import session not found');

    if (session.importTarget !== DataImportTarget.SALES) {
      throw new UnprocessableEntityException(
        'Esta sesión no está configurada para importación de ventas (importTarget=SALES).',
      );
    }

    return session;
  }

  private async recoverStaleProcessing(tenantId: string, sessionId: string): Promise<void> {
    const threshold = new Date(Date.now() - staleThresholdMs());
    const recovered = await this.prisma.dataImportSession.updateMany({
      where: {
        id: sessionId,
        tenantId,
        status: DataImportStatus.PROCESSING,
        startedAt: { lt: threshold },
      },
      data: {
        status: DataImportStatus.FAILED,
        errorMessage: 'La extracción anterior no completó en el tiempo esperado. Intente de nuevo.',
      },
    });

    if (recovered.count > 0) {
      this.logger.warn(`stale-recovery: sales session ${sessionId} (tenant ${tenantId}) reset PROCESSING → FAILED`);
      await this.logEvent(
        tenantId,
        sessionId,
        DataImportEventType.SALES_EXTRACTION_FAILED,
        'Stale sales extraction session recovered automatically',
        { reason: 'STALE_DOCUMENT_PROCESSING_TIMEOUT' },
      );
    }
  }

  private async logEvent(
    tenantId: string,
    sessionId: string,
    eventType: DataImportEventType,
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    await this.prisma.dataImportEvent.create({
      data: {
        tenantId,
        sessionId,
        eventType,
        message,
        metadata: metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
