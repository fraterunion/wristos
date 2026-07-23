import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DataImportDuplicateStatus,
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
import { parseCsvBuffer } from './parsers/csv.parser';
import { parseJsonBuffer } from './parsers/json.parser';
import { PDF_PHASE1_MESSAGE, parsePdfBuffer } from './parsers/pdf.parser';
import { parseXlsxBuffer } from './parsers/xlsx.parser';
import { IMPORT_FILE_STORAGE } from './tokens';
import type { ImportFileStorage } from './storage/import-file-storage.interface';
import { sha256Checksum } from './storage/local-import-file.storage';
import type { MulterFile } from './types/multer-file.type';
import { classifyEntityFromHeaders } from './utils/entity-classification.util';
import { maxImportRows, sniffJson, sniffPdf, sniffXlsx, validateImportUpload } from './utils/file-validation.util';
import { CreateDataImportSessionDto, ListDataImportRecordsQueryDto } from './dto/data-onboarding.dto';

const UPLOADABLE: DataImportStatus[] = [
  DataImportStatus.CREATED,
  DataImportStatus.UPLOADING,
  DataImportStatus.READY_FOR_REVIEW,
  DataImportStatus.FAILED,
];

const PROCESSABLE: DataImportStatus[] = [
  DataImportStatus.CREATED,
  DataImportStatus.UPLOADING,
  DataImportStatus.READY_FOR_REVIEW,
  DataImportStatus.FAILED,
];

const DELETABLE: DataImportStatus[] = [
  DataImportStatus.CREATED,
  DataImportStatus.UPLOADING,
  DataImportStatus.READY_FOR_REVIEW,
  DataImportStatus.FAILED,
  DataImportStatus.CANCELLED,
];

const SALES_SHEET_HINTS = ['VENTAS', 'SALES', 'HISTORICO', 'HISTÓRICO'] as const;

/**
 * When a workbook has a VENTAS/SALES/HISTORICO sheet, prefer those rows for sales imports.
 */
export function preferSalesSheets<T extends { sourceSheet?: string }>(
  sheetNames: string[],
  rows: T[],
): T[] {
  const preferredNames = sheetNames.filter((name) => {
    const upper = name.toUpperCase();
    return SALES_SHEET_HINTS.some((hint) => upper.includes(hint));
  });
  if (preferredNames.length === 0) return rows;
  const preferred = new Set(preferredNames);
  const filtered = rows.filter((row) => row.sourceSheet && preferred.has(row.sourceSheet));
  return filtered.length > 0 ? filtered : rows;
}

/**
 * Server-side record filtering. `rowStatus` maps to:
 * - INVALID: isValid = false
 * - VALID:   isValid = true AND no validation warnings
 * - WARNING: isValid = true AND at least one validation warning
 * (AnyNull matches both DB NULL and JSON null representations.)
 */
export function buildRecordsWhere(
  tenantId: string,
  sessionId: string,
  query: Pick<ListDataImportRecordsQueryDto, 'fileId' | 'entityType' | 'valid' | 'rowStatus'>,
): Prisma.DataImportRecordWhereInput {
  const where: Prisma.DataImportRecordWhereInput = { tenantId, sessionId };
  if (query.fileId) where.fileId = query.fileId;
  if (query.entityType) where.entityType = query.entityType;
  if (query.valid === 'true') where.isValid = true;
  if (query.valid === 'false') where.isValid = false;

  if (query.rowStatus === 'INVALID') {
    where.isValid = false;
  } else if (query.rowStatus === 'VALID') {
    where.isValid = true;
    where.validationWarnings = { equals: Prisma.AnyNull };
  } else if (query.rowStatus === 'WARNING') {
    where.isValid = true;
    where.validationWarnings = { not: Prisma.AnyNull };
  }

  return where;
}

@Injectable()
export class DataOnboardingService {
  private readonly logger = new Logger(DataOnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(IMPORT_FILE_STORAGE) private readonly storage: ImportFileStorage,
  ) {}

  async createSession(tenantId: string, userId: string, dto: CreateDataImportSessionDto) {
    const importTarget =
      dto.importTarget === 'SALES' ? DataImportTarget.SALES : DataImportTarget.INVENTORY;
    const session = await this.prisma.dataImportSession.create({
      data: {
        tenantId,
        createdByUserId: userId,
        title: dto.title?.trim() || null,
        importTarget,
        status: DataImportStatus.CREATED,
      },
    });
    await this.logEvent(tenantId, session.id, DataImportEventType.SESSION_CREATED, 'Import session created', {
      importTarget,
    });
    return this.serializeSession(session);
  }

  async listSessions(tenantId: string) {
    const rows = await this.prisma.dataImportSession.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((row) => this.serializeSession(row));
  }

  async getSession(tenantId: string, sessionId: string) {
    const session = await this.requireSession(tenantId, sessionId);
    const files = await this.prisma.dataImportFile.findMany({
      where: { tenantId, sessionId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...this.serializeSession(session),
      files: files.map((file) => this.serializeFile(file)),
    };
  }

  async listFiles(tenantId: string, sessionId: string) {
    await this.requireSession(tenantId, sessionId);
    const files = await this.prisma.dataImportFile.findMany({
      where: { tenantId, sessionId },
      orderBy: { createdAt: 'asc' },
    });
    return files.map((file) => this.serializeFile(file));
  }

  async uploadFile(tenantId: string, sessionId: string, file: MulterFile) {
    if (!file?.buffer || !file.originalname) {
      throw new BadRequestException('Archivo requerido. Use el campo multipart "file".');
    }

    const session = await this.requireSession(tenantId, sessionId);
    if (!UPLOADABLE.includes(session.status)) {
      throw new ConflictException('La sesión no acepta archivos en su estado actual.');
    }

    // V1 rule: exactly one file per import session. Additional files are
    // rejected explicitly instead of silently ignored downstream.
    if (session.totalFiles >= 1) {
      throw new ConflictException(
        'Esta versión permite un solo archivo por sesión. Cree una nueva sesión para importar otro archivo.',
      );
    }

    const fileType = validateImportUpload(file.originalname, file.mimetype, file.size);
    if (fileType === DataImportFileType.JSON && !sniffJson(file.buffer)) {
      throw new BadRequestException('El contenido no parece ser JSON válido.');
    }
    if (fileType === DataImportFileType.XLSX && !sniffXlsx(file.buffer)) {
      throw new BadRequestException('El contenido no parece ser un archivo Excel XLSX válido.');
    }
    if (fileType === DataImportFileType.PDF && !sniffPdf(file.buffer)) {
      throw new BadRequestException('El archivo no contiene una firma PDF válida (%PDF-). Verifique que sea un PDF real.');
    }

    const checksum = sha256Checksum(file.buffer);
    const duplicate = await this.prisma.dataImportFile.findFirst({
      where: { tenantId, sessionId, checksum },
    });
    if (duplicate) {
      throw new ConflictException('Este archivo ya fue subido en la sesión actual.');
    }

    const { storageKey } = await this.storage.save({
      tenantId,
      sessionId,
      filename: file.originalname,
      buffer: file.buffer,
    });

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.dataImportFile.create({
          data: {
            tenantId,
            sessionId,
            originalFilename: file.originalname,
            storageKey,
            mimeType: file.mimetype || 'application/octet-stream',
            fileType,
            byteSize: file.size,
            checksum,
            status: DataImportFileStatus.UPLOADED,
          },
        });
        await tx.dataImportSession.update({
          where: { id: sessionId },
          data: {
            totalFiles: { increment: 1 },
            status: DataImportStatus.UPLOADING,
          },
        });
        await tx.dataImportEvent.create({
          data: {
            tenantId,
            sessionId,
            eventType: DataImportEventType.FILE_UPLOADED,
            message: `Uploaded ${file.originalname}`,
            metadata: { fileId: row.id, fileType, byteSize: file.size },
          },
        });
        return row;
      });

      return this.serializeFile(created);
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async listRecords(tenantId: string, sessionId: string, query: ListDataImportRecordsQueryDto) {
    await this.requireSession(tenantId, sessionId);
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 25) || 25));
    const where = buildRecordsWhere(tenantId, sessionId, query);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.dataImportRecord.count({ where }),
      this.prisma.dataImportRecord.findMany({
        where,
        orderBy: [{ fileId: 'asc' }, { sourceRowNumber: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      page,
      limit,
      total,
      records: rows.map((row) => this.serializeRecord(row)),
    };
  }

  async processSession(tenantId: string, sessionId: string) {
    const session = await this.requireSession(tenantId, sessionId);
    if (!PROCESSABLE.includes(session.status)) {
      throw new ConflictException('La sesión no puede procesarse en su estado actual.');
    }

    const files = await this.prisma.dataImportFile.findMany({
      where: { tenantId, sessionId },
      orderBy: { createdAt: 'asc' },
    });
    if (files.length === 0) {
      throw new BadRequestException('Sube al menos un archivo antes de procesar.');
    }

    // Claim processing atomically to reject concurrent process requests.
    const claimed = await this.prisma.dataImportSession.updateMany({
      where: {
        id: sessionId,
        tenantId,
        status: { in: PROCESSABLE },
      },
      data: {
        status: DataImportStatus.PROCESSING,
        startedAt: new Date(),
        errorMessage: null,
        // Reprocessing the source invalidates any prior dry-run.
        dryRunVersion: null,
        warningRows: 0,
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException('La sesión ya se está procesando o cambió de estado.');
    }

    await this.logEvent(tenantId, sessionId, DataImportEventType.PROCESSING_STARTED, 'Processing started');

    await this.prisma.dataImportRecord.deleteMany({ where: { tenantId, sessionId } });

    let totalRows = 0;
    let validRows = 0;
    let invalidRows = 0;
    let processedFiles = 0;

    for (const file of files) {
      try {
        const result = await this.processFile(tenantId, sessionId, file, session.importTarget);
        totalRows += result.totalRows;
        validRows += result.validRows;
        invalidRows += result.invalidRows;
        processedFiles += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Processing failed';
        this.logger.warn(
          `Import file failed tenant=${tenantId} session=${sessionId} file=${file.id} category=parser`,
        );
        await this.prisma.dataImportFile.update({
          where: { id: file.id },
          data: { status: DataImportFileStatus.FAILED, errorMessage: message },
        });
        await this.logEvent(tenantId, sessionId, DataImportEventType.FILE_FAILED, message, {
          fileId: file.id,
        });
      }
    }

    const finalStatus =
      processedFiles === 0 ? DataImportStatus.FAILED : DataImportStatus.READY_FOR_REVIEW;

    const updated = await this.prisma.dataImportSession.update({
      where: { id: sessionId },
      data: {
        status: finalStatus,
        processedFiles,
        totalRows,
        validRows,
        invalidRows,
        completedAt: new Date(),
        errorMessage: processedFiles === 0 ? 'No files could be processed.' : null,
      },
    });

    await this.logEvent(
      tenantId,
      sessionId,
      processedFiles === 0 ? DataImportEventType.SESSION_FAILED : DataImportEventType.PROCESSING_COMPLETED,
      processedFiles === 0 ? 'Processing failed' : 'Processing completed',
      { totalRows, validRows, invalidRows, processedFiles },
    );

    return this.serializeSession(updated);
  }

  async getFileRecord(tenantId: string, sessionId: string, fileId: string) {
    const file = await this.prisma.dataImportFile.findFirst({
      where: { id: fileId, tenantId, sessionId },
    });
    if (!file) throw new NotFoundException('Import file not found');
    return file;
  }

  async deleteSession(tenantId: string, sessionId: string) {
    const session = await this.requireSession(tenantId, sessionId);
    if (!DELETABLE.includes(session.status)) {
      throw new ConflictException('No se puede eliminar la sesión mientras se procesa o importa.');
    }
    const deleted = await this.prisma.dataImportSession.deleteMany({
      where: { id: sessionId, tenantId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException('Import session not found');
    }
    // Best-effort cleanup after DB cascade; orphaned local files are safer than DB rows
    // pointing at missing blobs.
    await this.storage.deleteSessionFiles(tenantId, sessionId).catch((error) => {
      this.logger.warn(
        `Storage cleanup failed tenant=${tenantId} session=${sessionId} category=storage`,
      );
    });
  }

  private async processFile(
    tenantId: string,
    sessionId: string,
    file: { id: string; storageKey: string; fileType: DataImportFileType; originalFilename: string },
    importTarget: DataImportTarget = DataImportTarget.INVENTORY,
  ) {
    await this.prisma.dataImportFile.update({
      where: { id: file.id },
      data: { status: DataImportFileStatus.PROCESSING, errorMessage: null },
    });
    await this.logEvent(tenantId, sessionId, DataImportEventType.FILE_PROCESSING, `Processing ${file.originalFilename}`, {
      fileId: file.id,
    });

    const buffer = await this.storage.read(file.storageKey);

    if (file.fileType === DataImportFileType.PDF) {
      const pdf = parsePdfBuffer(buffer);
      await this.prisma.dataImportFile.update({
        where: { id: file.id },
        data: {
          status: DataImportFileStatus.PARSED,
          rowCount: 0,
          detectedEntityType:
            importTarget === DataImportTarget.SALES
              ? DataImportEntityType.SALES
              : DataImportEntityType.UNKNOWN,
          classificationMeta: pdf,
          // Expected Phase 1 limitation — not a failure.
          errorMessage: null,
        },
      });
      await this.logEvent(tenantId, sessionId, DataImportEventType.FILE_PARSED, pdf.message, {
        fileId: file.id,
        pdf: true,
      });
      return { totalRows: 0, validRows: 0, invalidRows: 0 };
    }

    let parsedRows: Array<{
      sourceSheet?: string;
      sourceRowNumber: number;
      rawData: Record<string, unknown>;
      headers: string[];
    }> = [];
    let sheetNames: string[] = [];

    if (file.fileType === DataImportFileType.CSV) {
      const parsed = parseCsvBuffer(buffer);
      sheetNames = parsed.sheetNames;
      parsedRows = parsed.rows;
    } else if (file.fileType === DataImportFileType.XLSX) {
      const parsed = await parseXlsxBuffer(buffer);
      sheetNames = parsed.sheetNames;
      parsedRows = parsed.rows;
    } else if (file.fileType === DataImportFileType.JSON) {
      const parsed = parseJsonBuffer(buffer);
      sheetNames = ['JSON'];
      parsedRows = parsed.rows;
    }

    if (importTarget === DataImportTarget.SALES) {
      parsedRows = preferSalesSheets(sheetNames, parsedRows);
    }

    if (parsedRows.length === 0) {
      throw new BadRequestException('El archivo no contiene filas de datos.');
    }

    const rowLimit = maxImportRows();
    if (parsedRows.length > rowLimit) {
      throw new BadRequestException(
        `El archivo contiene ${parsedRows.length} filas y excede el máximo permitido de ${rowLimit}. Divida el archivo en partes más pequeñas.`,
      );
    }

    const classification = classifyEntityFromHeaders(parsedRows[0]?.headers ?? []);
    const entityType =
      importTarget === DataImportTarget.SALES
        ? DataImportEntityType.SALES
        : classification.entityType;
    const duplicateKeys = new Map<string, number>();

    const recordRows = parsedRows.map((row) => {
      const duplicateKey = `${entityType}:${JSON.stringify(row.rawData)}`;
      const seen = duplicateKeys.get(duplicateKey) ?? 0;
      duplicateKeys.set(duplicateKey, seen + 1);
      const isDuplicate = seen > 0;
      const validationWarnings: string[] = [];
      if (isDuplicate) {
        validationWarnings.push('Possible duplicate row within file');
      }
      return {
        tenantId,
        sessionId,
        fileId: file.id,
        entityType,
        sourceSheet: row.sourceSheet ?? null,
        sourceRowNumber: row.sourceRowNumber,
        rawData: row.rawData as Prisma.InputJsonValue,
        // Duplicates remain valid staging rows; warnings are informational only.
        isValid: true,
        ...(validationWarnings.length
          ? { validationWarnings: validationWarnings as Prisma.InputJsonValue }
          : {}),
        duplicateKey,
        duplicateStatus: isDuplicate
          ? DataImportDuplicateStatus.POSSIBLE_DUPLICATE
          : DataImportDuplicateStatus.NONE,
        importStatus: DataImportRecordStatus.STAGED,
      };
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.dataImportRecord.createMany({ data: recordRows });
      await tx.dataImportFile.update({
        where: { id: file.id },
        data: {
          status: DataImportFileStatus.PARSED,
          rowCount: recordRows.length,
          sheetNames,
          detectedEntityType: entityType,
          classificationMeta: {
            score: classification.score,
            evidence: classification.evidence,
            ...(importTarget === DataImportTarget.SALES
              ? { forcedByImportTarget: 'SALES' }
              : {}),
          },
          errorMessage: null,
        },
      });
    });

    await this.logEvent(tenantId, sessionId, DataImportEventType.FILE_PARSED, `Parsed ${file.originalFilename}`, {
      fileId: file.id,
      rowCount: recordRows.length,
      entityType,
    });

    return {
      totalRows: recordRows.length,
      validRows: recordRows.length,
      // Phase 1: invalidRows reserved for rows that fail validation (none yet).
      // Duplicate warnings are tracked on records via duplicateStatus, not invalidRows.
      invalidRows: 0,
    };
  }

  private async requireSession(tenantId: string, sessionId: string) {
    const session = await this.prisma.dataImportSession.findFirst({
      where: { id: sessionId, tenantId },
    });
    if (!session) throw new NotFoundException('Import session not found');
    return session;
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

  private serializeSession(row: {
    id: string;
    tenantId: string;
    createdByUserId: string;
    status: DataImportStatus;
    title: string | null;
    importTarget: DataImportTarget;
    totalFiles: number;
    processedFiles: number;
    totalRows: number;
    validRows: number;
    warningRows: number;
    invalidRows: number;
    importedRows: number;
    dryRunVersion: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      tenantId: row.tenantId,
      createdByUserId: row.createdByUserId,
      status: row.status,
      title: row.title,
      importTarget: row.importTarget,
      totalFiles: row.totalFiles,
      processedFiles: row.processedFiles,
      totalRows: row.totalRows,
      validRows: row.validRows,
      warningRows: row.warningRows,
      invalidRows: row.invalidRows,
      importedRows: row.importedRows,
      dryRunVersion: row.dryRunVersion,
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private serializeFile(row: {
    id: string;
    sessionId: string;
    originalFilename: string;
    mimeType: string;
    fileType: DataImportFileType;
    byteSize: number;
    checksum: string | null;
    status: DataImportFileStatus;
    detectedEntityType: DataImportEntityType;
    sheetNames: unknown;
    rowCount: number;
    classificationMeta: unknown;
    fieldMapping: unknown;
    mappingVersion: string | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      sessionId: row.sessionId,
      originalFilename: row.originalFilename,
      mimeType: row.mimeType,
      fileType: row.fileType,
      byteSize: row.byteSize,
      checksum: row.checksum,
      status: row.status,
      detectedEntityType: row.detectedEntityType,
      sheetNames: row.sheetNames,
      rowCount: row.rowCount,
      classificationMeta: row.classificationMeta,
      fieldMapping: row.fieldMapping ?? null,
      mappingVersion: row.mappingVersion,
      errorMessage: row.errorMessage,
      pdfPhase1Message:
        row.fileType === DataImportFileType.PDF ? PDF_PHASE1_MESSAGE : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private serializeRecord(row: {
    id: string;
    fileId: string;
    entityType: DataImportEntityType;
    sourceSheet: string | null;
    sourceRowNumber: number | null;
    rawData: unknown;
    normalizedData: unknown;
    validationErrors: unknown;
    validationWarnings: unknown;
    isValid: boolean;
    isSelected: boolean;
    duplicateStatus: DataImportDuplicateStatus;
    importStatus: DataImportRecordStatus;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      fileId: row.fileId,
      entityType: row.entityType,
      sourceSheet: row.sourceSheet,
      sourceRowNumber: row.sourceRowNumber,
      rawData: row.rawData,
      normalizedData: row.normalizedData,
      validationErrors: row.validationErrors,
      validationWarnings: row.validationWarnings,
      isValid: row.isValid,
      isSelected: row.isSelected,
      duplicateStatus: row.duplicateStatus,
      importStatus: row.importStatus,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
