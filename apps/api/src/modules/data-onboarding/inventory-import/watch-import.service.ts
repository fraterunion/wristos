import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DataImportDuplicateStatus, DataImportEntityType, DataImportEventType, DataImportRecordStatus, DataImportStatus, DataImportTarget, Prisma, WatchOwnershipType, WatchStatus } from '@prisma/client';

import { FxService } from '../../fx/fx.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { escapeCsvCell } from './csv-report.util';
import { buildDryRunBase, buildMappingVersion, isDryRunVersionCurrent, mappingToLookup, proposeMapping, validateMappingEntries } from './watch-field-mapping';
import { detectExplicitCurrencyInText, normalizeWatchRow } from './watch-normalizer';
import { WARNING_CODES, markFirstSerialWarnings, normalizeSerial, validateNormalizedWatch } from './watch-validator';
import {
  CommitResult,
  DryRunContext,
  DryRunSummary,
  DuplicatePolicy,
  MappingEntry,
  MappingResponse,
  NormalizedWatchRow,
  SKIP_FIELD,
} from './watch-import.types';

const COMMIT_CHUNK_SIZE = 50;
const DRY_RUN_UPDATE_BATCH_SIZE = 200;

/** Session statuses from which a commit may be (re)claimed. FAILED enables idempotent retry. */
const COMMIT_CLAIMABLE: DataImportStatus[] = [DataImportStatus.READY_FOR_REVIEW, DataImportStatus.FAILED];

export function staleImportTimeoutMs(): number {
  const minutes = Number(process.env.IMPORT_STALE_TIMEOUT_MINUTES ?? '15');
  const safe = Number.isFinite(minutes) && minutes > 0 ? minutes : 15;
  return safe * 60_000;
}

export function errorReportMaxRows(): number {
  const rows = Number(process.env.IMPORT_ERROR_REPORT_MAX_ROWS ?? '1000');
  return Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 1000;
}

@Injectable()
export class WatchImportService {
  private readonly logger = new Logger(WatchImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fxService: FxService,
  ) {}

  async getMapping(tenantId: string, sessionId: string, fileId: string): Promise<MappingResponse> {
    const file = await this.requireFile(tenantId, sessionId, fileId);

    const firstRecords = await this.prisma.dataImportRecord.findMany({
      where: { tenantId, fileId, entityType: DataImportEntityType.INVENTORY },
      orderBy: { sourceRowNumber: 'asc' },
      take: 4,
      select: { rawData: true },
    });

    const sampleRows = firstRecords.map((r) => r.rawData as Record<string, string>);
    const headers = sampleRows.length > 0 ? Object.keys(sampleRows[0]) : [];
    const proposals = proposeMapping(headers, sampleRows.slice(1));

    if (file.fieldMapping) {
      const mapping = file.fieldMapping as MappingEntry[];
      return {
        fileId,
        mapping,
        mappingVersion: file.mappingVersion,
        proposals,
        isProposed: false,
      };
    }

    const autoMapping: MappingEntry[] = proposals.map((p) => ({
      sourceColumn: p.sourceColumn,
      targetField: p.confidence === 'HIGH' && p.suggested ? p.suggested : SKIP_FIELD,
    }));

    return {
      fileId,
      mapping: autoMapping,
      mappingVersion: null,
      proposals,
      isProposed: true,
    };
  }

  async saveMapping(tenantId: string, sessionId: string, fileId: string, mapping: MappingEntry[]): Promise<{ mappingVersion: string }> {
    const validationErrors = validateMappingEntries(mapping);
    if (validationErrors.length > 0) {
      throw new UnprocessableEntityException(validationErrors.join('; '));
    }

    const version = buildMappingVersion(mapping);

    await this.requireFile(tenantId, sessionId, fileId);

    await this.prisma.dataImportFile.updateMany({
      where: { id: fileId, tenantId, sessionId },
      data: {
        fieldMapping: mapping as unknown as Prisma.InputJsonValue,
        mappingVersion: version,
      },
    });

    // Remapping invalidates any existing dry-run.
    await this.prisma.dataImportSession.updateMany({
      where: { id: sessionId, tenantId },
      data: { dryRunVersion: null },
    });

    await this.logEvent(tenantId, sessionId, DataImportEventType.MAPPING_SAVED, 'Field mapping saved', { fileId, version });

    return { mappingVersion: version };
  }

  async runDryRun(tenantId: string, sessionId: string): Promise<DryRunSummary> {
    const session = await this.requireSession(tenantId, sessionId);

    if (session.status !== DataImportStatus.READY_FOR_REVIEW) {
      throw new UnprocessableEntityException(`La sesión debe estar en READY_FOR_REVIEW para ejecutar dry-run (actual: ${session.status})`);
    }

    // Load all INVENTORY files and their mappings
    const files = await this.prisma.dataImportFile.findMany({
      where: { tenantId, sessionId, detectedEntityType: DataImportEntityType.INVENTORY },
    });

    if (files.length === 0) {
      throw new UnprocessableEntityException('No hay archivos de inventario en esta sesión');
    }

    const unmappedFiles = files.filter((f) => !f.fieldMapping || !f.mappingVersion);
    if (unmappedFiles.length > 0) {
      throw new UnprocessableEntityException(`Los siguientes archivos no tienen mapping configurado: ${unmappedFiles.map((f) => f.originalFilename).join(', ')}`);
    }

    // Rows are bounded by IMPORT_MAX_ROWS at staging time (processFile), so
    // this in-memory pass is bounded too.
    const allRecords = await this.prisma.dataImportRecord.findMany({
      where: { tenantId, sessionId, entityType: DataImportEntityType.INVENTORY },
      orderBy: { sourceRowNumber: 'asc' },
    });

    let fxRate: number | null = null;
    const fileMappings = new Map<string, MappingEntry[]>();
    for (const file of files) {
      fileMappings.set(file.id, file.fieldMapping as MappingEntry[]);
    }

    // Pre-scan for explicit USD (column or embedded label). Bare "$" does not count.
    const needsFx = allRecords.some((record) => {
      const mapping = fileMappings.get(record.fileId);
      if (!mapping) return false;
      const row = record.rawData as Record<string, unknown>;
      const lookup = mappingToLookup(mapping);
      const currencyCol = [...lookup.entries()].find(([, v]) => v === 'costCurrency')?.[0];
      if (currencyCol) {
        const raw = String(row[currencyCol] ?? '').trim().toUpperCase();
        if (['USD', 'US', 'DOLLAR', 'DOLLARS', 'DOLARES', 'DÓLARES', 'US$'].includes(raw)) return true;
      }
      for (const field of ['cost', 'priceMin', 'priceMax'] as const) {
        const col = [...lookup.entries()].find(([, v]) => v === field)?.[0];
        if (!col) continue;
        if (detectExplicitCurrencyInText(row[col]) === 'USD') return true;
      }
      return false;
    });

    if (needsFx) {
      try {
        const fx = await this.fxService.getUsdMxn();
        fxRate = fx.rate;
      } catch {
        throw new UnprocessableEntityException('No se pudo obtener el tipo de cambio USD/MXN. Intente de nuevo.');
      }
    }

    // Batch serial number lookup against DB
    const potentialSerials = allRecords
      .map((r) => {
        const mapping = fileMappings.get(r.fileId);
        if (!mapping) return null;
        const row = r.rawData as Record<string, unknown>;
        const lookup = mappingToLookup(mapping);
        const snCol = [...lookup.entries()].find(([, v]) => v === 'serialNumber')?.[0];
        if (!snCol) return null;
        return normalizeSerial(String(row[snCol] ?? ''));
      })
      .filter((s): s is string => s !== null);

    const existingSerials = await this.findExistingSerials(tenantId, potentialSerials);
    const ctx: DryRunContext = { existingSerials, fileSerialsSeen: new Map(), fxRate };

    // Normalize + validate each record
    const processedRows: Array<{ recordId: string; normalized: NormalizedWatchRow; result: ReturnType<typeof validateNormalizedWatch> }> = [];

    for (const record of allRecords) {
      const mapping = fileMappings.get(record.fileId);
      if (!mapping) continue;

      const normalized = normalizeWatchRow(record.rawData as Record<string, unknown>, mapping, fxRate);
      const result = validateNormalizedWatch(normalized, ctx, record.id);
      processedRows.push({ recordId: record.id, normalized, result });
    }

    // Add first-serial-in-file warnings
    markFirstSerialWarnings(processedRows, ctx);

    let validCount = 0;
    let warningCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;

    const updates = processedRows.map(({ recordId, normalized, result }) => {
      const isValid = result.state !== 'INVALID';

      // Duplicate taxonomy:
      // - CONFIRMED_DUPLICATE: exact serial conflict (in DB, or 2nd+ occurrence in file)
      // - POSSIBLE_DUPLICATE:  first occurrence of an in-file duplicated serial
      const isExactDuplicate =
        result.warnings.some((w) => w.code === WARNING_CODES.SERIAL_EXISTS_IN_DB) ||
        result.errors.some((e) => e.code === 'SERIAL_DUPLICATE_IN_FILE');
      const isPossibleDuplicate = result.warnings.some((w) => w.code === WARNING_CODES.SERIAL_FIRST_DUPLICATE_IN_FILE);

      if (result.state === 'VALID') validCount++;
      else if (result.state === 'WARNING') warningCount++;
      else invalidCount++;
      if (isExactDuplicate || isPossibleDuplicate) duplicateCount++;

      const duplicateStatus: DataImportDuplicateStatus = isExactDuplicate
        ? DataImportDuplicateStatus.CONFIRMED_DUPLICATE
        : isPossibleDuplicate
          ? DataImportDuplicateStatus.POSSIBLE_DUPLICATE
          : DataImportDuplicateStatus.NONE;

      return this.prisma.dataImportRecord.update({
        where: { id: recordId },
        data: {
          normalizedData: normalized as unknown as Prisma.InputJsonValue,
          validationErrors: result.errors.length > 0 ? (result.errors as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          validationWarnings: result.warnings.length > 0 ? (result.warnings as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          isValid,
          isSelected: isValid,
          duplicateStatus,
          importStatus: DataImportRecordStatus.STAGED,
          targetRecordId: null,
        },
      });
    });

    // Bounded batches instead of a single N-statement transaction.
    for (let i = 0; i < updates.length; i += DRY_RUN_UPDATE_BATCH_SIZE) {
      await this.prisma.$transaction(updates.slice(i, i + DRY_RUN_UPDATE_BATCH_SIZE));
    }

    const dryRunBase = buildDryRunBase(
      sessionId,
      files.map((f) => ({ id: f.id, mappingVersion: f.mappingVersion, rowCount: f.rowCount })),
    );
    if (!dryRunBase) {
      throw new UnprocessableEntityException('No se pudo calcular la versión del dry-run (mapping incompleto).');
    }
    const dryRunVersion = `${dryRunBase}:${new Date().toISOString()}`;

    await this.prisma.dataImportSession.update({
      where: { id: sessionId },
      data: {
        validRows: validCount,
        warningRows: warningCount,
        invalidRows: invalidCount,
        totalRows: allRecords.length,
        dryRunVersion,
      },
    });

    await this.logEvent(tenantId, sessionId, DataImportEventType.DRY_RUN_COMPLETED, 'Dry run completed', {
      valid: validCount,
      warnings: warningCount,
      invalid: invalidCount,
      duplicates: duplicateCount,
      fxRate,
      dryRunVersion,
    });

    return {
      sessionId,
      dryRunVersion,
      total: allRecords.length,
      valid: validCount,
      warnings: warningCount,
      invalid: invalidCount,
      duplicates: duplicateCount,
    };
  }

  async commitImport(tenantId: string, sessionId: string, duplicatePolicy: DuplicatePolicy): Promise<CommitResult> {
    let session = await this.requireSession(tenantId, sessionId);

    // ── Stale IMPORTING recovery ─────────────────────────────────────────────
    if (session.status === DataImportStatus.IMPORTING) {
      const startedAt = session.importStartedAt ?? session.updatedAt;
      const staleCutoff = new Date(Date.now() - staleImportTimeoutMs());
      if (startedAt > staleCutoff) {
        throw new ConflictException('Una importación ya está en curso para esta sesión.');
      }
      const recovered = await this.prisma.dataImportSession.updateMany({
        where: {
          id: sessionId,
          tenantId,
          status: DataImportStatus.IMPORTING,
          ...(session.importStartedAt ? { importStartedAt: { lt: staleCutoff } } : {}),
        },
        data: {
          status: DataImportStatus.FAILED,
          errorMessage: 'Importación interrumpida (timeout). Puede reintentar.',
        },
      });
      if (recovered.count > 0) {
        await this.logEvent(tenantId, sessionId, DataImportEventType.IMPORT_FAILED, 'Stale import recovered', {
          reason: 'STALE_IMPORT_TIMEOUT',
          importStartedAt: startedAt.toISOString(),
          timeoutMs: staleImportTimeoutMs(),
        });
      }
      session = await this.requireSession(tenantId, sessionId);
    }

    if (!COMMIT_CLAIMABLE.includes(session.status)) {
      if (session.status === DataImportStatus.COMPLETED) {
        throw new ConflictException('Esta sesión ya fue importada');
      }
      throw new ConflictException(`No se puede importar en estado ${session.status}`);
    }

    if (!session.dryRunVersion) {
      throw new UnprocessableEntityException('Debe ejecutar el dry-run antes de importar');
    }

    // Exact deterministic dry-run version check against current file state.
    const files = await this.prisma.dataImportFile.findMany({
      where: { tenantId, sessionId, detectedEntityType: DataImportEntityType.INVENTORY },
      select: { id: true, mappingVersion: true, rowCount: true },
    });
    const currentBase = buildDryRunBase(sessionId, files);
    if (!isDryRunVersionCurrent(session.dryRunVersion, currentBase)) {
      throw new UnprocessableEntityException('El dry-run está desactualizado. Ejecute el dry-run nuevamente antes de importar.');
    }

    // ── Atomic claim (CAS on status AND exact dryRunVersion) ─────────────────
    const claimed = await this.prisma.dataImportSession.updateMany({
      where: { id: sessionId, tenantId, status: session.status, dryRunVersion: session.dryRunVersion },
      data: {
        status: DataImportStatus.IMPORTING,
        importStartedAt: new Date(),
        errorMessage: null,
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException('La sesión cambió de estado. Intente de nuevo.');
    }

    await this.logEvent(tenantId, sessionId, DataImportEventType.IMPORT_STARTED, 'Import started', {
      duplicatePolicy,
      retry: session.status === DataImportStatus.FAILED,
    });

    let importedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let warningCount = 0;

    try {
      // Retry idempotency: rows already imported (targetRecordId set) are never
      // reprocessed. SKIPPED/FAILED rows are re-evaluated under the new policy.
      const eligibleRecords = await this.prisma.dataImportRecord.findMany({
        where: {
          tenantId,
          sessionId,
          entityType: DataImportEntityType.INVENTORY,
          isValid: true,
          targetRecordId: null,
        },
        orderBy: { sourceRowNumber: 'asc' },
      });

      // Commit-time serial recheck against live inventory (dry-run data can be
      // stale if inventory changed since validation).
      const eligibleSerials = eligibleRecords
        .map((r) => normalizeSerial((r.normalizedData as NormalizedWatchRow | null)?.serialNumber))
        .filter((s): s is string => s !== null);
      const liveDbSerials = await this.findExistingSerials(tenantId, eligibleSerials);
      const createdSerialsThisRun = new Set<string>();

      for (let i = 0; i < eligibleRecords.length; i += COMMIT_CHUNK_SIZE) {
        const chunk = eligibleRecords.slice(i, i + COMMIT_CHUNK_SIZE);

        for (const record of chunk) {
          const normalized = record.normalizedData as NormalizedWatchRow | null;
          // Soft identity: brand OR model OR any price. Optional fields may be null.
          const hasIdentity =
            Boolean(normalized?.brand) ||
            Boolean(normalized?.model) ||
            normalized?.cost != null ||
            normalized?.priceMin != null ||
            normalized?.priceMax != null;
          if (!normalized || !hasIdentity) {
            await this.prisma.dataImportRecord.update({
              where: { id: record.id },
              data: { importStatus: DataImportRecordStatus.FAILED },
            });
            failedCount++;
            continue;
          }

          const serial = normalizeSerial(normalized.serialNumber);

          // Rule 1 (authoritative, policy-independent): an exact serial conflict
          // against live inventory — or against a row imported earlier in this
          // same run — is ALWAYS skipped. IMPORT_AS_NEW never duplicates a
          // non-empty serial.
          const hasExactSerialConflict =
            serial !== null && (liveDbSerials.has(serial) || createdSerialsThisRun.has(serial));

          // Rule 2: SKIP_DUPLICATES also skips possible duplicates (first
          // occurrence of an in-file duplicated serial). IMPORT_AS_NEW imports them.
          const skipPossibleDuplicate =
            duplicatePolicy === 'SKIP_DUPLICATES' &&
            record.duplicateStatus !== DataImportDuplicateStatus.NONE;

          if (hasExactSerialConflict || skipPossibleDuplicate) {
            await this.prisma.dataImportRecord.update({
              where: { id: record.id },
              data: { importStatus: DataImportRecordStatus.SKIPPED },
            });
            skippedCount++;
            continue;
          }

          if (record.validationWarnings) warningCount++;

          const isConsignment = normalized.ownershipType === WatchOwnershipType.CONSIGNMENT;

          try {
            await this.prisma.$transaction(async (tx) => {
              const watch = await tx.watch.create({
                data: {
                  tenantId,
                  brand: normalized.brand ?? null,
                  model: normalized.model ?? null,
                  reference: normalized.reference ?? null,
                  serialNumber: serial,
                  condition: normalized.condition ?? null,
                  cost: normalized.cost != null ? new Prisma.Decimal(normalized.cost) : null,
                  costCurrency: normalized.costCurrency ?? 'MXN',
                  costOriginalAmount: normalized.costOriginalAmount != null ? new Prisma.Decimal(normalized.costOriginalAmount) : null,
                  costExchangeRate: normalized.costExchangeRate != null ? new Prisma.Decimal(normalized.costExchangeRate) : null,
                  priceMin: normalized.priceMin != null ? new Prisma.Decimal(normalized.priceMin) : null,
                  priceMax: normalized.priceMax != null ? new Prisma.Decimal(normalized.priceMax) : null,
                  status: normalized.status ?? WatchStatus.AVAILABLE,
                  ownershipType: normalized.ownershipType ?? WatchOwnershipType.OWNED,
                  // Invariant (mirrors InventoryService.create): consignment
                  // fields are null unless ownership is CONSIGNMENT.
                  consignmentOwnerName: isConsignment ? normalized.consignmentOwnerName ?? null : null,
                  consignmentSplitPercentage:
                    isConsignment && normalized.consignmentSplitPercentage != null
                      ? new Prisma.Decimal(normalized.consignmentSplitPercentage)
                      : null,
                  imageUrl: normalized.imageUrl ?? null,
                  // Invariant: imported watches are never auto-published.
                  isPublished: false,
                },
              });

              await tx.dataImportRecord.update({
                where: { id: record.id },
                data: {
                  importStatus: DataImportRecordStatus.IMPORTED,
                  targetRecordId: watch.id,
                },
              });
            });
            importedCount++;
            if (serial) createdSerialsThisRun.add(serial);
          } catch (err) {
            this.logger.warn(`Failed to import record ${record.id}: ${err instanceof Error ? err.message : String(err)}`);
            await this.prisma.dataImportRecord.update({
              where: { id: record.id },
              data: { importStatus: DataImportRecordStatus.FAILED },
            });
            failedCount++;
          }
        }
      }

      // Total imported across all runs (retries included) for the session.
      const totalImported = await this.prisma.dataImportRecord.count({
        where: { tenantId, sessionId, importStatus: DataImportRecordStatus.IMPORTED },
      });

      // Any failed row leaves the session FAILED (retryable); retry only
      // reprocesses rows without targetRecordId, so repeats are idempotent.
      const finalStatus = failedCount > 0 ? DataImportStatus.FAILED : DataImportStatus.COMPLETED;
      await this.prisma.dataImportSession.update({
        where: { id: sessionId },
        data: {
          status: finalStatus,
          importedRows: totalImported,
          completedAt: new Date(),
          errorMessage:
            failedCount > 0 ? `${failedCount} fila(s) fallaron al importar. Puede reintentar.` : null,
        },
      });

      await this.logEvent(
        tenantId,
        sessionId,
        failedCount > 0 ? DataImportEventType.IMPORT_FAILED : DataImportEventType.IMPORT_COMPLETED,
        failedCount > 0 ? 'Import finished with failed rows' : 'Import completed',
        {
          importedCount,
          skippedCount,
          failedCount,
          warningCount,
          totalImported,
          duplicatePolicy,
        },
      );

      return { importedCount, skippedCount, failedCount, warningCount };
    } catch (err) {
      await this.prisma.dataImportSession.update({
        where: { id: sessionId },
        data: { status: DataImportStatus.FAILED, errorMessage: err instanceof Error ? err.message : 'Unknown error' },
      });
      await this.logEvent(tenantId, sessionId, DataImportEventType.IMPORT_FAILED, 'Import failed', {
        reason: 'UNEXPECTED_ERROR',
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async getErrorReport(tenantId: string, sessionId: string): Promise<string> {
    await this.requireSession(tenantId, sessionId);

    const maxRows = errorReportMaxRows();
    const where = {
      tenantId,
      sessionId,
      entityType: DataImportEntityType.INVENTORY,
      isValid: false,
    };

    const [totalInvalid, records] = await Promise.all([
      this.prisma.dataImportRecord.count({ where }),
      this.prisma.dataImportRecord.findMany({
        where,
        orderBy: { sourceRowNumber: 'asc' },
        take: maxRows,
        select: {
          sourceSheet: true,
          sourceRowNumber: true,
          rawData: true,
          validationErrors: true,
          validationWarnings: true,
          duplicateStatus: true,
        },
      }),
    ]);

    const lines: string[] = [
      'Fila,Hoja,Marca,Modelo,Serie,Errores,Advertencias',
    ];

    for (const record of records) {
      const raw = record.rawData as Record<string, unknown>;
      const errors = (record.validationErrors as Array<{ code: string; field: string; message: string }> | null) ?? [];
      const warnings = (record.validationWarnings as Array<{ code: string; field: string; message: string }> | null) ?? [];

      // Best-effort extract common fields from raw data
      const brand = this.extractAny(raw, ['Marca', 'Brand', 'marca', 'brand']) ?? '';
      const model = this.extractAny(raw, ['Modelo', 'Model', 'modelo', 'model']) ?? '';
      const serial = this.extractAny(raw, ['Serie', 'Serial', 'serie', 'serial']) ?? '';

      const errStr = errors.map((e) => `[${e.code}] ${e.message}`).join(' | ');
      const warnStr = warnings.map((w) => `[${w.code}] ${w.message}`).join(' | ');

      lines.push(
        [
          record.sourceRowNumber ?? '',
          record.sourceSheet ?? '',
          escapeCsvCell(brand),
          escapeCsvCell(model),
          escapeCsvCell(serial),
          escapeCsvCell(errStr),
          escapeCsvCell(warnStr),
        ].join(','),
      );
    }

    if (totalInvalid > records.length) {
      lines.push(
        escapeCsvCell(
          `Reporte truncado: mostrando ${records.length} de ${totalInvalid} filas inválidas`,
        ),
      );
    }

    return lines.join('\n');
  }

  private async findExistingSerials(tenantId: string, serials: string[]): Promise<Set<string>> {
    if (serials.length === 0) return new Set();
    const watches = await this.prisma.watch.findMany({
      where: { tenantId, serialNumber: { in: serials }, deletedAt: null },
      select: { serialNumber: true },
    });
    return new Set(
      watches
        .map((w) => normalizeSerial(w.serialNumber))
        .filter((s): s is string => s !== null),
    );
  }

  private extractAny(obj: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      if (obj[key] !== undefined && obj[key] !== null) return String(obj[key]);
    }
    return null;
  }

  private async requireSession(tenantId: string, sessionId: string) {
    const session = await this.prisma.dataImportSession.findFirst({ where: { id: sessionId, tenantId } });
    if (!session) throw new NotFoundException('Import session not found');
    if (session.importTarget !== DataImportTarget.INVENTORY) {
      throw new UnprocessableEntityException(
        'Esta sesión no está configurada para importación de inventario (importTarget=INVENTORY).',
      );
    }
    return session;
  }

  private async requireFile(tenantId: string, sessionId: string, fileId: string) {
    const file = await this.prisma.dataImportFile.findFirst({ where: { id: fileId, tenantId, sessionId } });
    if (!file) throw new NotFoundException('Import file not found');
    return file;
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
