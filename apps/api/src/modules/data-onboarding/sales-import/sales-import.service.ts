import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DataImportDuplicateStatus,
  DataImportEntityType,
  DataImportEventType,
  DataImportRecordStatus,
  DataImportStatus,
  DataImportTarget,
  DealStage,
  Prisma,
} from '@prisma/client';

import { FxService } from '../../fx/fx.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { escapeCsvCell } from '../inventory-import/csv-report.util';
import { errorReportMaxRows, staleImportTimeoutMs } from '../inventory-import/watch-import.service';
import {
  NormalizedHistoricalSale,
  SalesCommitResult,
  SalesDryRunContext,
  SalesDryRunSummary,
  SalesMappingEntry,
  SalesMappingResponse,
  SKIP_FIELD,
  WARNING_CODES,
} from './historical-sale.types';
import {
  buildSalesDryRunBase,
  buildSalesMappingVersion,
  isSalesDryRunVersionCurrent,
  proposeSalesMapping,
  salesMappingToLookup,
  validateSalesMappingEntries,
} from './sales-field-mapping';
import { detectExplicitCurrency } from './sales-money';
import { normalizeHistoricalSaleRow } from './sales-normalizer';
import {
  hasMinimumSaleIdentity,
  looseClientName,
  normalizeClientName,
  normalizeSerial,
  referenceModelKey,
  validateNormalizedSale,
} from './sales-validator';

const COMMIT_CHUNK_SIZE = 50;
const DRY_RUN_UPDATE_BATCH_SIZE = 200;

const COMMIT_CLAIMABLE: DataImportStatus[] = [DataImportStatus.READY_FOR_REVIEW, DataImportStatus.FAILED];

const HISTORICAL_CLIENT_NOTES = 'Cliente creado desde importación de ventas históricas';
const HISTORICAL_SOURCE_TAG = 'HISTORICAL_SALES_IMPORT';

@Injectable()
export class SalesImportService {
  private readonly logger = new Logger(SalesImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fxService: FxService,
  ) {}

  async getSalesMapping(tenantId: string, sessionId: string, fileId: string): Promise<SalesMappingResponse> {
    const file = await this.requireFile(tenantId, sessionId, fileId);

    const firstRecords = await this.prisma.dataImportRecord.findMany({
      where: { tenantId, fileId, entityType: DataImportEntityType.SALES },
      orderBy: { sourceRowNumber: 'asc' },
      take: 4,
      select: { rawData: true },
    });

    const sampleRows = firstRecords.map((r) => r.rawData as Record<string, string>);
    const headers = sampleRows.length > 0 ? Object.keys(sampleRows[0]) : [];
    const proposals = proposeSalesMapping(headers, sampleRows.slice(1));

    if (file.fieldMapping) {
      const mapping = file.fieldMapping as SalesMappingEntry[];
      return {
        fileId,
        mapping,
        mappingVersion: file.mappingVersion,
        proposals,
        isProposed: false,
      };
    }

    const autoMapping: SalesMappingEntry[] = proposals.map((p) => ({
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

  async saveSalesMapping(
    tenantId: string,
    sessionId: string,
    fileId: string,
    mapping: SalesMappingEntry[],
  ): Promise<{ mappingVersion: string }> {
    const validationErrors = validateSalesMappingEntries(mapping);
    if (validationErrors.length > 0) {
      throw new UnprocessableEntityException(validationErrors.join('; '));
    }

    const version = buildSalesMappingVersion(mapping);
    await this.requireFile(tenantId, sessionId, fileId);

    await this.prisma.dataImportFile.updateMany({
      where: { id: fileId, tenantId, sessionId },
      data: {
        fieldMapping: mapping as unknown as Prisma.InputJsonValue,
        mappingVersion: version,
      },
    });

    await this.prisma.dataImportSession.updateMany({
      where: { id: sessionId, tenantId },
      data: { dryRunVersion: null },
    });

    await this.logEvent(tenantId, sessionId, DataImportEventType.MAPPING_SAVED, 'Sales field mapping saved', {
      fileId,
      version,
    });

    return { mappingVersion: version };
  }

  async runSalesDryRun(tenantId: string, sessionId: string): Promise<SalesDryRunSummary> {
    const session = await this.requireSession(tenantId, sessionId);

    if (session.status !== DataImportStatus.READY_FOR_REVIEW) {
      throw new UnprocessableEntityException(
        `La sesión debe estar en READY_FOR_REVIEW para ejecutar dry-run (actual: ${session.status})`,
      );
    }

    const files = await this.prisma.dataImportFile.findMany({
      where: { tenantId, sessionId, detectedEntityType: DataImportEntityType.SALES },
    });

    if (files.length === 0) {
      throw new UnprocessableEntityException('No hay archivos de ventas en esta sesión');
    }

    const unmappedFiles = files.filter((f) => !f.fieldMapping || !f.mappingVersion);
    if (unmappedFiles.length > 0) {
      throw new UnprocessableEntityException(
        `Los siguientes archivos no tienen mapping configurado: ${unmappedFiles.map((f) => f.originalFilename).join(', ')}`,
      );
    }

    const allRecords = await this.prisma.dataImportRecord.findMany({
      where: { tenantId, sessionId, entityType: DataImportEntityType.SALES },
      orderBy: { sourceRowNumber: 'asc' },
    });

    const fileMappings = new Map<string, SalesMappingEntry[]>();
    const fileChecksums = new Map<string, string | undefined>();
    for (const file of files) {
      fileMappings.set(file.id, file.fieldMapping as SalesMappingEntry[]);
      fileChecksums.set(file.id, file.checksum ?? undefined);
    }

    let fxRate: number | null = null;
    const needsFx = allRecords.some((record) => this.rowNeedsFx(record.rawData as Record<string, unknown>, fileMappings.get(record.fileId)));
    if (needsFx) {
      try {
        const fx = await this.fxService.getUsdMxn();
        fxRate = fx.rate;
      } catch {
        throw new UnprocessableEntityException('No se pudo obtener el tipo de cambio USD/MXN. Intente de nuevo.');
      }
    }

    const ctx = await this.buildDryRunContext(tenantId, allRecords, fileMappings, fileChecksums, fxRate);

    const processedRows: Array<{
      recordId: string;
      normalized: NormalizedHistoricalSale;
      result: ReturnType<typeof validateNormalizedSale>;
    }> = [];

    for (const record of allRecords) {
      const mapping = fileMappings.get(record.fileId);
      if (!mapping) continue;

      const normalized = normalizeHistoricalSaleRow(record.rawData as Record<string, unknown>, mapping, fxRate, {
        tenantId,
        fileChecksum: fileChecksums.get(record.fileId),
        sourceRow: record.sourceRowNumber,
      });
      const result = validateNormalizedSale(normalized, ctx, record.id);
      processedRows.push({ recordId: record.id, normalized, result });
    }

    let validCount = 0;
    let warningCount = 0;
    let invalidCount = 0;
    let clientsMatched = 0;
    let clientsProposed = 0;
    let exactSerialMatches = 0;
    let possibleWatchMatches = 0;
    let duplicates = 0;
    let totalHistoricalRevenue = 0;
    let totalHistoricalCost = 0;
    let totalReportedProfit = 0;
    let totalCalculatedProfit = 0;
    let fxConversions = 0;
    const currenciesFound = new Set<'MXN' | 'USD'>();

    const updates = processedRows.map(({ recordId, normalized, result }) => {
      const isValid = result.state !== 'INVALID';

      if (result.state === 'VALID') validCount++;
      else if (result.state === 'WARNING') warningCount++;
      else invalidCount++;

      if (result.warnings.some((w) => w.code === WARNING_CODES.CLIENT_MATCHED)) clientsMatched++;
      if (result.warnings.some((w) => w.code === WARNING_CODES.CLIENT_WILL_BE_CREATED)) clientsProposed++;
      if (result.warnings.some((w) => w.code === WARNING_CODES.WATCH_SERIAL_MATCH)) exactSerialMatches++;
      if (result.warnings.some((w) => w.code === WARNING_CODES.WATCH_REFERENCE_MATCH)) possibleWatchMatches++;
      if (
        result.errors.some((e) => e.code === 'DUPLICATE_IN_FILE') ||
        result.warnings.some((w) => w.code === WARNING_CODES.DUPLICATE_IN_DB)
      ) {
        duplicates++;
      }

      if (isValid) {
        if (normalized.salePrice != null) totalHistoricalRevenue += normalized.salePrice;
        if (normalized.cost != null) totalHistoricalCost += normalized.cost;
        if (normalized.reportedProfit != null) totalReportedProfit += normalized.reportedProfit;
        if (normalized.calculatedProfit != null) totalCalculatedProfit += normalized.calculatedProfit;
      }

      for (const c of [normalized.costCurrency, normalized.saleCurrency, normalized.extrasCurrency]) {
        if (c) currenciesFound.add(c);
      }
      if (
        normalized.costExchangeRate != null ||
        normalized.saleExchangeRate != null ||
        normalized.extrasExchangeRate != null
      ) {
        fxConversions++;
      }

      const isExactDuplicate =
        result.errors.some((e) => e.code === 'DUPLICATE_IN_FILE') ||
        result.warnings.some((w) => w.code === WARNING_CODES.DUPLICATE_IN_DB);
      const isPossibleDuplicate = result.warnings.some(
        (w) =>
          w.code === WARNING_CODES.CLIENT_POSSIBLE_DUPLICATE ||
          w.code === WARNING_CODES.WATCH_REFERENCE_MATCH,
      );

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
          validationWarnings:
            result.warnings.length > 0 ? (result.warnings as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          isValid,
          isSelected: isValid,
          duplicateStatus,
          importStatus: DataImportRecordStatus.STAGED,
          targetRecordId: null,
        },
      });
    });

    for (let i = 0; i < updates.length; i += DRY_RUN_UPDATE_BATCH_SIZE) {
      await this.prisma.$transaction(updates.slice(i, i + DRY_RUN_UPDATE_BATCH_SIZE));
    }

    const dryRunBase = buildSalesDryRunBase(
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

    const salesProposed = processedRows.filter((r) => r.result.state !== 'INVALID').length;

    await this.logEvent(tenantId, sessionId, DataImportEventType.SALES_DRY_RUN_COMPLETED, 'Sales dry run completed', {
      valid: validCount,
      warnings: warningCount,
      invalid: invalidCount,
      clientsMatched,
      clientsProposed,
      salesProposed,
      exactSerialMatches,
      possibleWatchMatches,
      duplicates,
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
      clientsMatched,
      clientsProposed,
      salesProposed,
      exactSerialMatches,
      possibleWatchMatches,
      duplicates,
      totalHistoricalRevenue: Math.round(totalHistoricalRevenue * 100) / 100,
      totalHistoricalCost: Math.round(totalHistoricalCost * 100) / 100,
      totalReportedProfit: Math.round(totalReportedProfit * 100) / 100,
      totalCalculatedProfit: Math.round(totalCalculatedProfit * 100) / 100,
      currenciesFound: [...currenciesFound],
      fxConversions,
    };
  }

  async commitSalesImport(tenantId: string, sessionId: string): Promise<SalesCommitResult> {
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
        await this.logEvent(tenantId, sessionId, DataImportEventType.IMPORT_FAILED, 'Stale sales import recovered', {
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

    const files = await this.prisma.dataImportFile.findMany({
      where: { tenantId, sessionId, detectedEntityType: DataImportEntityType.SALES },
      select: { id: true, mappingVersion: true, rowCount: true, checksum: true },
    });
    const currentBase = buildSalesDryRunBase(sessionId, files);
    if (!isSalesDryRunVersionCurrent(session.dryRunVersion, currentBase)) {
      throw new UnprocessableEntityException(
        'El dry-run está desactualizado. Ejecute el dry-run nuevamente antes de importar.',
      );
    }

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

    await this.logEvent(tenantId, sessionId, DataImportEventType.IMPORT_STARTED, 'Sales import started', {
      retry: session.status === DataImportStatus.FAILED,
    });

    let importedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let warningCount = 0;
    let clientsCreated = 0;

    try {
      const eligibleRecords = await this.prisma.dataImportRecord.findMany({
        where: {
          tenantId,
          sessionId,
          entityType: DataImportEntityType.SALES,
          isValid: true,
          targetRecordId: null,
        },
        orderBy: { sourceRowNumber: 'asc' },
      });

      // Recheck fingerprints already in DB
      const fingerprints = eligibleRecords
        .map((r) => (r.normalizedData as NormalizedHistoricalSale | null)?.importFingerprint)
        .filter((fp): fp is string => Boolean(fp));
      const existingDeals = fingerprints.length
        ? await this.prisma.deal.findMany({
            where: { tenantId, importFingerprint: { in: fingerprints }, deletedAt: null },
            select: { id: true, importFingerprint: true },
          })
        : [];
      const fingerprintToDealId = new Map(
        existingDeals
          .filter((d) => d.importFingerprint)
          .map((d) => [d.importFingerprint as string, d.id]),
      );

      // Client cache by exact normalized name
      const clientNameCache = new Map<string, string>();
      const existingClients = await this.prisma.client.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, name: true },
      });
      for (const c of existingClients) {
        const key = normalizeClientName(c.name);
        if (key && !clientNameCache.has(key)) clientNameCache.set(key, c.id);
      }

      for (let i = 0; i < eligibleRecords.length; i += COMMIT_CHUNK_SIZE) {
        const chunk = eligibleRecords.slice(i, i + COMMIT_CHUNK_SIZE);

        for (const record of chunk) {
          const normalized = record.normalizedData as NormalizedHistoricalSale | null;
          if (
            !normalized ||
            !hasMinimumSaleIdentity(normalized) ||
            normalized.salePrice === undefined ||
            normalized.salePrice === null
          ) {
            await this.prisma.dataImportRecord.update({
              where: { id: record.id },
              data: { importStatus: DataImportRecordStatus.FAILED },
            });
            failedCount++;
            continue;
          }

          const fp = normalized.importFingerprint;
          if (fp && fingerprintToDealId.has(fp)) {
            // Idempotent: already imported under this fingerprint
            await this.prisma.dataImportRecord.update({
              where: { id: record.id },
              data: {
                importStatus: DataImportRecordStatus.IMPORTED,
                targetRecordId: fingerprintToDealId.get(fp)!,
              },
            });
            importedCount++;
            continue;
          }

          if (record.duplicateStatus === DataImportDuplicateStatus.CONFIRMED_DUPLICATE && fp && fingerprintToDealId.has(fp)) {
            await this.prisma.dataImportRecord.update({
              where: { id: record.id },
              data: { importStatus: DataImportRecordStatus.SKIPPED },
            });
            skippedCount++;
            continue;
          }

          if (record.validationWarnings) warningCount++;

          const salePrice = normalized.salePrice;

          try {
            await this.prisma.$transaction(async (tx) => {
              const clientId = await this.resolveOrCreateClient(
                tx,
                tenantId,
                normalized,
                record,
                clientNameCache,
              );
              if (clientId.created) clientsCreated++;

              // Serial matches stay in dry-run warnings/metadata only — never link watches on commit.
              const watchId = null;

              const soldAt = normalized.saleDate ? new Date(`${normalized.saleDate}T12:00:00.000Z`) : null;

              const deal = await tx.deal.create({
                data: {
                  tenantId,
                  clientId: clientId.id,
                  watchId,
                  stage: DealStage.CLOSED_WON,
                  soldAt,
                  expectedCloseAt: soldAt,
                  agreedPrice: new Prisma.Decimal(salePrice),
                  originalCurrency: normalized.saleCurrency ?? 'MXN',
                  originalAmount:
                    normalized.salePriceOriginalAmount != null
                      ? new Prisma.Decimal(normalized.salePriceOriginalAmount)
                      : new Prisma.Decimal(salePrice),
                  exchangeRate:
                    normalized.saleExchangeRate != null ? new Prisma.Decimal(normalized.saleExchangeRate) : null,
                  notes: normalized.notes ?? null,
                  historicalCost:
                    normalized.cost != null ? new Prisma.Decimal(normalized.cost) : null,
                  historicalCostCurrency: normalized.costCurrency ?? null,
                  historicalCostOriginalAmount:
                    normalized.costOriginalAmount != null
                      ? new Prisma.Decimal(normalized.costOriginalAmount)
                      : null,
                  historicalCostExchangeRate:
                    normalized.costExchangeRate != null
                      ? new Prisma.Decimal(normalized.costExchangeRate)
                      : null,
                  extrasAmount: normalized.extras != null ? new Prisma.Decimal(normalized.extras) : null,
                  extrasCurrency: normalized.extrasCurrency ?? null,
                  extrasOriginalAmount:
                    normalized.extrasOriginalAmount != null
                      ? new Prisma.Decimal(normalized.extrasOriginalAmount)
                      : null,
                  extrasExchangeRate:
                    normalized.extrasExchangeRate != null
                      ? new Prisma.Decimal(normalized.extrasExchangeRate)
                      : null,
                  reportedProfit:
                    normalized.reportedProfit != null ? new Prisma.Decimal(normalized.reportedProfit) : null,
                  calculatedProfit:
                    normalized.calculatedProfit != null
                      ? new Prisma.Decimal(normalized.calculatedProfit)
                      : null,
                  paymentCount: normalized.paymentCount ?? null,
                  importSessionId: sessionId,
                  importFingerprint: fp ?? null,
                  importSourceRow: record.sourceRowNumber ?? null,
                  sourceTag: HISTORICAL_SOURCE_TAG,
                },
              });

              // Intentionally NO Payment create and NO watch.status update.

              await tx.dataImportRecord.update({
                where: { id: record.id },
                data: {
                  importStatus: DataImportRecordStatus.IMPORTED,
                  targetRecordId: deal.id,
                },
              });

              if (fp) fingerprintToDealId.set(fp, deal.id);
            });
            importedCount++;
          } catch (err) {
            this.logger.warn(
              `Failed to import sales record ${record.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
            await this.prisma.dataImportRecord.update({
              where: { id: record.id },
              data: { importStatus: DataImportRecordStatus.FAILED },
            });
            failedCount++;
          }
        }
      }

      const totalImported = await this.prisma.dataImportRecord.count({
        where: { tenantId, sessionId, importStatus: DataImportRecordStatus.IMPORTED },
      });

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
        failedCount > 0 ? DataImportEventType.IMPORT_FAILED : DataImportEventType.SALES_IMPORT_COMMITTED,
        failedCount > 0 ? 'Sales import finished with failed rows' : 'Sales import committed',
        {
          importedCount,
          skippedCount,
          failedCount,
          warningCount,
          clientsCreated,
          totalImported,
        },
      );

      return { importedCount, skippedCount, failedCount, warningCount, clientsCreated };
    } catch (err) {
      await this.prisma.dataImportSession.update({
        where: { id: sessionId },
        data: { status: DataImportStatus.FAILED, errorMessage: err instanceof Error ? err.message : 'Unknown error' },
      });
      await this.logEvent(tenantId, sessionId, DataImportEventType.IMPORT_FAILED, 'Sales import failed', {
        reason: 'UNEXPECTED_ERROR',
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private rowNeedsFx(row: Record<string, unknown>, mapping: SalesMappingEntry[] | undefined): boolean {
    if (!mapping) return false;
    const lookup = salesMappingToLookup(mapping);
    const currencyFields = ['currency', 'saleCurrency', 'costCurrency', 'extrasCurrency', 'reportedProfitCurrency'] as const;
    for (const field of currencyFields) {
      const col = [...lookup.entries()].find(([, v]) => v === field)?.[0];
      if (!col) continue;
      if (detectExplicitCurrency(row[col]) === 'USD') return true;
    }
    for (const field of ['cost', 'salePrice', 'extras', 'reportedProfit'] as const) {
      const col = [...lookup.entries()].find(([, v]) => v === field)?.[0];
      if (!col) continue;
      if (detectExplicitCurrency(row[col]) === 'USD') return true;
    }
    return false;
  }

  private async buildDryRunContext(
    tenantId: string,
    records: Array<{ id: string; fileId: string; rawData: unknown; sourceRowNumber: number | null }>,
    fileMappings: Map<string, SalesMappingEntry[]>,
    fileChecksums: Map<string, string | undefined>,
    fxRate: number | null,
  ): Promise<SalesDryRunContext> {
    const clients = await this.prisma.client.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    const existingClientsByName = new Map<string, string>();
    const existingClientsByLooseName = new Map<string, string>();
    for (const c of clients) {
      const exact = normalizeClientName(c.name);
      if (exact && !existingClientsByName.has(exact)) existingClientsByName.set(exact, c.id);
      const loose = looseClientName(c.name);
      if (loose && !existingClientsByLooseName.has(loose)) existingClientsByLooseName.set(loose, c.id);
    }

    const potentialSerials: string[] = [];
    const refModelKeys: string[] = [];
    const fingerprints: string[] = [];

    for (const record of records) {
      const mapping = fileMappings.get(record.fileId);
      if (!mapping) continue;
      const normalized = normalizeHistoricalSaleRow(record.rawData as Record<string, unknown>, mapping, fxRate, {
        tenantId,
        fileChecksum: fileChecksums.get(record.fileId),
        sourceRow: record.sourceRowNumber,
      });
      const sn = normalizeSerial(normalized.serialNumber);
      if (sn) potentialSerials.push(sn);
      const key = referenceModelKey(normalized.reference, normalized.model);
      if (key) refModelKeys.push(key);
      if (normalized.importFingerprint) fingerprints.push(normalized.importFingerprint);
    }

    const existingSerials = new Map<string, string>();
    if (potentialSerials.length > 0) {
      const watches = await this.prisma.watch.findMany({
        where: { tenantId, serialNumber: { in: [...new Set(potentialSerials)] }, deletedAt: null },
        select: { id: true, serialNumber: true },
      });
      for (const w of watches) {
        const sn = normalizeSerial(w.serialNumber);
        if (sn) existingSerials.set(sn, w.id);
      }
    }

    const existingByReferenceModel = new Map<string, string[]>();
    if (refModelKeys.length > 0) {
      const uniqueKeys = [...new Set(refModelKeys)];
      const watches = await this.prisma.watch.findMany({
        where: {
          tenantId,
          deletedAt: null,
          OR: uniqueKeys.map((k) => {
            const [reference, model] = k.split('|');
            return {
              reference: { equals: reference, mode: 'insensitive' as const },
              model: { equals: model, mode: 'insensitive' as const },
            };
          }),
        },
        select: { id: true, reference: true, model: true },
      });
      for (const w of watches) {
        const key = referenceModelKey(w.reference, w.model);
        if (!key) continue;
        const list = existingByReferenceModel.get(key) ?? [];
        list.push(w.id);
        existingByReferenceModel.set(key, list);
      }
    }

    const existingFingerprints = new Set<string>();
    if (fingerprints.length > 0) {
      const deals = await this.prisma.deal.findMany({
        where: { tenantId, importFingerprint: { in: [...new Set(fingerprints)] }, deletedAt: null },
        select: { importFingerprint: true },
      });
      for (const d of deals) {
        if (d.importFingerprint) existingFingerprints.add(d.importFingerprint);
      }
    }

    return {
      existingClientsByName,
      existingClientsByLooseName,
      existingSerials,
      existingByReferenceModel,
      existingFingerprints,
      fileFingerprintsSeen: new Map(),
      fxRate,
    };
  }

  async getErrorReport(tenantId: string, sessionId: string): Promise<string> {
    await this.requireSession(tenantId, sessionId);

    const maxRows = errorReportMaxRows();
    const where = {
      tenantId,
      sessionId,
      entityType: DataImportEntityType.SALES,
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

    const lines: string[] = ['Fila,Hoja,Cliente,Marca,Modelo,Serie,Precio,Errores,Advertencias'];

    for (const record of records) {
      const raw = record.rawData as Record<string, unknown>;
      const errors =
        (record.validationErrors as Array<{ code: string; field: string; message: string }> | null) ?? [];
      const warnings =
        (record.validationWarnings as Array<{ code: string; field: string; message: string }> | null) ??
        [];

      const customer =
        this.extractAny(raw, ['Cliente', 'Customer', 'cliente', 'customer', 'customerName']) ?? '';
      const brand = this.extractAny(raw, ['Marca', 'Brand', 'marca', 'brand']) ?? '';
      const model = this.extractAny(raw, ['Modelo', 'Model', 'modelo', 'model']) ?? '';
      const serial = this.extractAny(raw, ['Serie', 'Serial', 'serie', 'serial', 'serialNumber']) ?? '';
      const price =
        this.extractAny(raw, ['Precio', 'Price', 'precio', 'salePrice', 'Sale Price']) ?? '';

      const errStr = errors.map((e) => `[${e.code}] ${e.message}`).join(' | ');
      const warnStr = warnings.map((w) => `[${w.code}] ${w.message}`).join(' | ');

      lines.push(
        [
          record.sourceRowNumber ?? '',
          record.sourceSheet ?? '',
          escapeCsvCell(customer),
          escapeCsvCell(brand),
          escapeCsvCell(model),
          escapeCsvCell(serial),
          escapeCsvCell(price),
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

  private extractAny(obj: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      if (obj[key] !== undefined && obj[key] !== null) return String(obj[key]);
    }
    return null;
  }

  /** @internal Exported for unit tests via prototype access patterns in specs. */
  async resolveOrCreateClient(
    tx: Prisma.TransactionClient,
    tenantId: string,
    normalized: NormalizedHistoricalSale,
    record: { id: string; sourceRowNumber: number | null },
    cache: Map<string, string>,
  ): Promise<{ id: string; created: boolean }> {
    const name =
      normalized.customerName?.trim() ||
      [normalized.brand, normalized.model, normalized.serialNumber].filter(Boolean).join(' ').trim() ||
      `Cliente histórico (fila ${record.sourceRowNumber ?? record.id})`;

    const key = normalizeClientName(name);
    if (key && cache.has(key)) {
      return { id: cache.get(key)!, created: false };
    }

    // Re-query inside the transaction before create (concurrent import safety).
    if (key) {
      const candidates = await tx.client.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, name: true },
      });
      const matched = candidates.find((c) => normalizeClientName(c.name) === key);
      if (matched) {
        cache.set(key, matched.id);
        return { id: matched.id, created: false };
      }
    }

    const client = await tx.client.create({
      data: {
        tenantId,
        name,
        email: null,
        phone: null,
        notes: HISTORICAL_CLIENT_NOTES,
        tags: ['historical-import'],
      },
    });
    if (key) cache.set(key, client.id);
    return { id: client.id, created: true };
  }

  private async requireSession(tenantId: string, sessionId: string) {
    const session = await this.prisma.dataImportSession.findFirst({ where: { id: sessionId, tenantId } });
    if (!session) throw new NotFoundException('Import session not found');
    if (session.importTarget !== DataImportTarget.SALES) {
      throw new UnprocessableEntityException(
        'Esta sesión no está configurada para importación de ventas (importTarget=SALES).',
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
