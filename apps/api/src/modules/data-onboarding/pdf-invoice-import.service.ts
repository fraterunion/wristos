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
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  ExtractionState,
  InventoryInvoiceExtraction,
  InventoryInvoiceExtractionSchema,
  PDF_IDENTITY_MAPPING,
  bridgeExtractedWatch,
} from './inventory-import/inventory-invoice-extraction.types';
import { buildMappingVersion } from './inventory-import/watch-field-mapping';
import type { MappingEntry } from './inventory-import/watch-import.types';
import { IMPORT_FILE_STORAGE } from './tokens';
import type { DocumentExtractionProvider } from './providers/document-extraction.provider.interface';
import { ExtractionError, ExtractionErrorCode, buildSafeExtractionRecord, isExtractionError } from './providers/extraction-errors';
import { createExtractionProvider } from './providers/extraction.provider.factory';
import type { ImportFileStorage } from './storage/import-file-storage.interface';
import {
  PDF_INSPECTION_MESSAGES,
  inspectPdf,
  maxPdfPages,
} from './utils/file-validation.util';
import { INVOICE_EXTRACTION_VERSION } from './providers/prompts/invoice-extraction-v1';

const EXTRACTABLE_STATUSES: DataImportStatus[] = [
  DataImportStatus.UPLOADING,
  DataImportStatus.READY_FOR_REVIEW,
  DataImportStatus.FAILED,
];

/** Sessions stuck in PROCESSING for this many minutes are considered stale and recovered. */
function staleThresholdMs(): number {
  const minutes = parseInt(process.env.DOCUMENT_PROCESSING_STALE_TIMEOUT_MINUTES ?? '15', 10);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 15) * 60_000;
}

@Injectable()
export class PdfInvoiceImportService {
  private readonly logger = new Logger(PdfInvoiceImportService.name);

  /**
   * Loaded once at module init. Null means the feature is disabled
   * (no DOCUMENT_EXTRACTION_PROVIDER env var). PDF import attempts return 503.
   */
  private readonly provider: DocumentExtractionProvider | null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(IMPORT_FILE_STORAGE) private readonly storage: ImportFileStorage,
  ) {
    this.provider = createExtractionProvider();
    if (this.provider) {
      this.logger.log(`Document extraction provider: ${this.provider.providerName} / ${this.provider.modelId}`);
    } else {
      this.logger.log('Document extraction is disabled (DOCUMENT_EXTRACTION_PROVIDER not set)');
    }
  }

  // ─── processDocument ────────────────────────────────────────────────────────

  async processDocument(tenantId: string, sessionId: string): Promise<{ fileId: string; watchCount: number }> {
    if (!this.provider) {
      throw new ServiceUnavailableException(
        'La extracción de documentos PDF no está habilitada en este servidor.',
      );
    }

    // Atomically recover any session stuck in PROCESSING past the stale threshold.
    await this.recoverStaleProcessing(tenantId, sessionId);

    const session = await this.requireSession(tenantId, sessionId);

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

    // Atomic claim: prevent concurrent extraction on the same session.
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

    await this.logEvent(tenantId, sessionId, DataImportEventType.DOCUMENT_EXTRACTION_STARTED, 'PDF extraction started', {
      fileId: file.id,
      provider: providerName,
      model: modelId,
      promptVersion: INVOICE_EXTRACTION_VERSION,
    });

    const startedAt = Date.now();

    try {
      const buffer = await this.storage.read(file.storageKey);

      // L-02: robust PDF inspection before sending to AI provider.
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

      // Page count check (UNKNOWN_PAGE_COUNT → allow through with a warning).
      const pageCount = inspection.pageCount ?? 0;
      const pageLimit = maxPdfPages();
      if (pageCount > 0 && pageCount > pageLimit) {
        throw new ExtractionError(
          ExtractionErrorCode.PAGE_LIMIT_EXCEEDED,
          `El documento tiene demasiadas páginas (${pageCount}). El máximo permitido es ${pageLimit}.`,
        );
      }
      if (inspection.parseStatus === 'UNKNOWN_PAGE_COUNT') {
        this.logger.warn(`Could not determine page count for session ${sessionId} (compressed PDF?) — allowing through`);
      }

      const extraction = await this.provider.extractInventoryInvoice(buffer);

      const identityMapping = PDF_IDENTITY_MAPPING as unknown as MappingEntry[];
      const mappingVersion = buildMappingVersion(identityMapping);

      const recordRows = extraction.watches.map((watch, i) => ({
        tenantId,
        sessionId,
        fileId: file.id,
        entityType: DataImportEntityType.INVENTORY,
        sourceSheet: 'PDF',
        sourceRowNumber: i + 1,
        rawData: bridgeExtractedWatch(watch) as unknown as Prisma.InputJsonValue,
        isValid: true,
        importStatus: DataImportRecordStatus.STAGED,
        duplicateKey: null as string | null,
      }));

      await this.prisma.$transaction(async (tx) => {
        // Delete any previously staged records (re-extraction case).
        await tx.dataImportRecord.deleteMany({ where: { tenantId, sessionId } });
        if (recordRows.length > 0) {
          await tx.dataImportRecord.createMany({ data: recordRows });
        }
        await tx.dataImportFile.update({
          where: { id: file.id },
          data: {
            status: DataImportFileStatus.PARSED,
            rowCount: recordRows.length,
            detectedEntityType: DataImportEntityType.INVENTORY,
            fieldMapping: identityMapping as unknown as Prisma.InputJsonValue,
            mappingVersion,
            // M-03: always store server-assigned extractionVersion
            extractedDocumentData: {
              ...extraction as unknown as Record<string, unknown>,
              extractionVersion: INVOICE_EXTRACTION_VERSION,
            } as Prisma.InputJsonValue,
            extractionProvider: providerName,
            extractionModel: modelId,
            extractionError: null,
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
          },
        });
      });

      const durationMs = Date.now() - startedAt;
      await this.logEvent(tenantId, sessionId, DataImportEventType.DOCUMENT_EXTRACTION_COMPLETED, 'PDF extraction completed', {
        fileId: file.id,
        watchCount: recordRows.length,
        overallConfidence: extraction.overallConfidence,
        durationMs,
        pageCount: pageCount > 0 ? pageCount : null,
      });

      return { fileId: file.id, watchCount: recordRows.length };

    } catch (err) {
      // Build a sanitized error record — never persist raw AI content or Zod values.
      const safeRecord = buildSafeExtractionRecord(err, providerName, modelId);
      const durationMs = Date.now() - startedAt;

      // Extract safe Anthropic API metadata — never log err.error (raw body) or err.headers.
      const anthropicMeta: Record<string, unknown> = {};
      if (err instanceof Error && 'status' in err) {
        const apiErr = err as { status?: unknown; type?: unknown; requestID?: unknown };
        if (typeof apiErr.status === 'number') anthropicMeta.httpStatus = apiErr.status;
        if (typeof apiErr.type === 'string') anthropicMeta.errorType = apiErr.type;
        if (typeof apiErr.requestID === 'string') anthropicMeta.requestId = apiErr.requestID;
      }

      this.logger.error('PDF extraction failed', {
        errorCode: safeRecord.code,
        errorCategory: safeRecord.category,
        provider: providerName,
        model: modelId,
        sessionId,
        tenantId,
        errorClass: err instanceof Error ? err.constructor.name : typeof err,
        durationMs,
        ...anthropicMeta,
      });

      if (isExtractionError(err) && err.debugInfo) {
        this.logger.debug(`Extraction schema error [${sessionId}]: ${JSON.stringify(err.debugInfo)}`);
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

      await this.logEvent(tenantId, sessionId, DataImportEventType.DOCUMENT_EXTRACTION_FAILED, 'PDF extraction failed', {
        fileId: file.id,
        errorCode: safeRecord.code,
        errorCategory: safeRecord.category,
        durationMs,
      });

      throw new UnprocessableEntityException(safeRecord.safeMessage);
    }
  }

  // ─── getExtraction ───────────────────────────────────────────────────────────

  async getExtraction(tenantId: string, sessionId: string): Promise<{
    fileId: string;
    extractionState: ExtractionState;
    extraction: InventoryInvoiceExtraction | null;
    extractionProvider: string | null;
    extractionModel: string | null;
    extractionError: string | null;
    watchCount: number;
  }> {
    const session = await this.requireSession(tenantId, sessionId);

    // Derive basic state from session status before touching the file
    if (session.status === DataImportStatus.PROCESSING) {
      return {
        fileId: '',
        extractionState: 'processing',
        extraction: null,
        extractionProvider: null,
        extractionModel: null,
        extractionError: null,
        watchCount: 0,
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

    // No data stored yet
    if (!file.extractedDocumentData) {
      const state: ExtractionState = file.extractionError ? 'failed' : 'not_processed';
      return {
        fileId: file.id,
        extractionState: state,
        extraction: null,
        extractionProvider: file.extractionProvider,
        extractionModel: file.extractionModel,
        extractionError: file.extractionError,
        watchCount: file.rowCount,
      };
    }

    // Re-validate stored data against current schema (guard against schema drift)
    const parsed = InventoryInvoiceExtractionSchema.safeParse(file.extractedDocumentData);
    if (!parsed.success) {
      this.logger.warn(
        `Stored extraction for session ${sessionId} failed re-validation ` +
        `(${parsed.error.issues.length} issue(s) on paths: ` +
        `${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}). ` +
        `Returning 'corrupt' state.`,
      );
      return {
        fileId: file.id,
        extractionState: 'corrupt',
        extraction: null,
        extractionProvider: file.extractionProvider,
        extractionModel: file.extractionModel,
        extractionError: 'Los datos de extracción almacenados no son compatibles con la versión actual del esquema.',
        watchCount: file.rowCount,
      };
    }

    return {
      fileId: file.id,
      extractionState: 'ready',
      extraction: parsed.data,
      extractionProvider: file.extractionProvider,
      extractionModel: file.extractionModel,
      extractionError: file.extractionError,
      watchCount: file.rowCount,
    };
  }

  // ─── updateExtraction ────────────────────────────────────────────────────────

  async updateExtraction(
    tenantId: string,
    sessionId: string,
    extraction: InventoryInvoiceExtraction,
  ): Promise<{ watchCount: number }> {
    const session = await this.requireSession(tenantId, sessionId);

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

    const identityMapping = PDF_IDENTITY_MAPPING as unknown as MappingEntry[];
    const mappingVersion = buildMappingVersion(identityMapping);

    const recordRows = extraction.watches.map((watch, i) => ({
      tenantId,
      sessionId,
      fileId: file.id,
      entityType: DataImportEntityType.INVENTORY,
      sourceSheet: 'PDF',
      sourceRowNumber: i + 1,
      rawData: bridgeExtractedWatch(watch) as unknown as Prisma.InputJsonValue,
      isValid: true,
      importStatus: DataImportRecordStatus.STAGED,
    }));

    // M-03: always enforce server-assigned extractionVersion when persisting edits
    const sanitizedExtraction = {
      ...extraction,
      extractionVersion: INVOICE_EXTRACTION_VERSION,
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

    await this.logEvent(tenantId, sessionId, DataImportEventType.DOCUMENT_EXTRACTION_EDITED, 'Extraction edited by user', {
      fileId: file.id,
      watchCount: recordRows.length,
    });

    return { watchCount: recordRows.length };
  }

  // ─── reprocessDocument ───────────────────────────────────────────────────────

  /**
   * Re-runs AI extraction. If the user has made manual edits (DOCUMENT_EXTRACTION_EDITED
   * event exists), the caller must pass confirmDiscardEdits: true — otherwise returns 409.
   */
  async reprocessDocument(
    tenantId: string,
    sessionId: string,
    opts: { confirmDiscardEdits?: boolean } = {},
  ): Promise<{ fileId: string; watchCount: number }> {
    if (!opts.confirmDiscardEdits) {
      const editEvent = await this.prisma.dataImportEvent.findFirst({
        where: { tenantId, sessionId, eventType: DataImportEventType.DOCUMENT_EXTRACTION_EDITED },
      });
      if (editEvent) {
        throw new ConflictException({
          code: 'MANUAL_EDITS_WOULD_BE_DISCARDED',
          message: 'Se encontraron ediciones manuales. Confirma que deseas descartarlas para volver a procesar.',
        });
      }
    }

    if (opts.confirmDiscardEdits) {
      await this.logEvent(tenantId, sessionId, DataImportEventType.DOCUMENT_EXTRACTION_STARTED,
        'Reprocess requested — manual edits discarded', { confirmDiscardEdits: true },
      );
    }

    return this.processDocument(tenantId, sessionId);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async requireSession(tenantId: string, sessionId: string) {
    const session = await this.prisma.dataImportSession.findFirst({
      where: { id: sessionId, tenantId },
    });
    if (!session) throw new NotFoundException('Import session not found');
    return session;
  }

  /**
   * Atomically reset any session that is stuck in PROCESSING past the stale threshold.
   * Safe to call concurrently — Prisma updateMany is atomic; only one caller gets count > 0.
   */
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
      this.logger.warn(`stale-recovery: session ${sessionId} (tenant ${tenantId}) reset PROCESSING → FAILED`);
      await this.logEvent(tenantId, sessionId, DataImportEventType.DOCUMENT_EXTRACTION_FAILED,
        'Stale extraction session recovered automatically',
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
