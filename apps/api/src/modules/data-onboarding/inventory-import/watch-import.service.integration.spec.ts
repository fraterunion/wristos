import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  DataImportDuplicateStatus,
  DataImportEntityType,
  DataImportEventType,
  DataImportRecordStatus,
  DataImportStatus,
  Prisma,
} from '@prisma/client';

import { WatchImportService } from './watch-import.service';
import { buildMappingVersion } from './watch-field-mapping';
import { MappingEntry } from './watch-import.types';

// ─── In-memory Prisma fake ────────────────────────────────────────────────────
// Implements exactly the query shapes WatchImportService uses so the full
// dry-run/commit lifecycle can be exercised without a database.

type Row = Record<string, unknown> & { id: string };

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected !== null && typeof expected === 'object' && !(expected instanceof Date)) {
    const cond = expected as Record<string, unknown>;
    if ('in' in cond) return (cond.in as unknown[]).includes(actual);
    if ('lt' in cond) return actual instanceof Date && (cond.lt as Date) instanceof Date && actual < (cond.lt as Date);
    if ('not' in cond) return !matchValue(actual, cond.not);
    return false;
  }
  if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
  return actual === expected;
}

function matchesWhere(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => (value === undefined ? true : matchValue(row[key], value)));
}

function cleanData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === Prisma.DbNull || value === Prisma.JsonNull) {
      out[key] = null;
    } else {
      out[key] = value;
    }
  }
  return out;
}

let idSeq = 0;

class FakeModel {
  rows: Row[] = [];
  failWhen: ((data: Record<string, unknown>) => boolean) | null = null;

  async findFirst(args: { where: Record<string, unknown> }): Promise<Row | null> {
    const found = this.rows.find((r) => matchesWhere(r, args.where));
    return found ? { ...found } : null;
  }

  async findMany(args: { where?: Record<string, unknown>; orderBy?: Record<string, string>; take?: number } = {}): Promise<Row[]> {
    let out = this.rows.filter((r) => matchesWhere(r, args.where));
    if (args.orderBy) {
      const key = Object.keys(args.orderBy)[0];
      out = [...out].sort((a, b) => ((a[key] as number) ?? 0) < ((b[key] as number) ?? 0) ? -1 : 1);
    }
    if (args.take !== undefined) out = out.slice(0, args.take);
    return out.map((r) => ({ ...r }));
  }

  async count(args: { where?: Record<string, unknown> } = {}): Promise<number> {
    return this.rows.filter((r) => matchesWhere(r, args.where)).length;
  }

  async create(args: { data: Record<string, unknown> }): Promise<Row> {
    if (this.failWhen && this.failWhen(args.data)) {
      throw new Error('Simulated DB failure');
    }
    const row: Row = {
      id: `gen-${++idSeq}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...cleanData(args.data),
    } as Row;
    this.rows.push(row);
    return { ...row };
  }

  async update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<Row> {
    const row = this.rows.find((r) => r.id === args.where.id);
    if (!row) throw new Error(`Row not found: ${args.where.id}`);
    Object.assign(row, cleanData(args.data), { updatedAt: new Date() });
    return { ...row };
  }

  async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }> {
    const targets = this.rows.filter((r) => matchesWhere(r, args.where));
    for (const target of targets) {
      Object.assign(target, cleanData(args.data), { updatedAt: new Date() });
    }
    return { count: targets.length };
  }
}

class FakePrisma {
  dataImportSession = new FakeModel();
  dataImportFile = new FakeModel();
  dataImportRecord = new FakeModel();
  dataImportEvent = new FakeModel();
  watch = new FakeModel();

  async $transaction(arg: unknown[] | ((tx: FakePrisma) => Promise<unknown>)): Promise<unknown> {
    if (Array.isArray(arg)) return Promise.all(arg);
    return arg(this);
  }
}

const fxServiceFake = { getUsdMxn: async () => ({ rate: 17.5, source: 'test', fetchedAt: new Date().toISOString() }) };

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';
const SESSION_ID = 'sess-1';
const FILE_ID = 'file-1';

const MAPPING: MappingEntry[] = [
  { sourceColumn: 'Marca', targetField: 'brand' },
  { sourceColumn: 'Modelo', targetField: 'model' },
  { sourceColumn: 'Costo', targetField: 'cost' },
  { sourceColumn: 'PrecioMin', targetField: 'priceMin' },
  { sourceColumn: 'PrecioMax', targetField: 'priceMax' },
  { sourceColumn: 'Condicion', targetField: 'condition' },
  { sourceColumn: 'Serie', targetField: 'serialNumber' },
];

function rawRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    Marca: 'Rolex',
    Modelo: 'Submariner',
    Costo: '15000',
    PrecioMin: '18000',
    PrecioMax: '22000',
    Condicion: 'Buena',
    Serie: '',
    ...overrides,
  };
}

function seed(prisma: FakePrisma, rows: Record<string, string>[], options: { status?: DataImportStatus } = {}) {
  prisma.dataImportSession.rows.push({
    id: SESSION_ID,
    tenantId: TENANT,
    createdByUserId: 'user-1',
    status: options.status ?? DataImportStatus.READY_FOR_REVIEW,
    title: null,
    totalFiles: 1,
    processedFiles: 1,
    totalRows: rows.length,
    validRows: 0,
    warningRows: 0,
    invalidRows: 0,
    importedRows: 0,
    dryRunVersion: null,
    importStartedAt: null,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  prisma.dataImportFile.rows.push({
    id: FILE_ID,
    tenantId: TENANT,
    sessionId: SESSION_ID,
    originalFilename: 'inventario.csv',
    detectedEntityType: DataImportEntityType.INVENTORY,
    fieldMapping: MAPPING,
    mappingVersion: buildMappingVersion(MAPPING),
    rowCount: rows.length,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  rows.forEach((raw, index) => {
    prisma.dataImportRecord.rows.push({
      id: `rec-${index + 1}`,
      tenantId: TENANT,
      sessionId: SESSION_ID,
      fileId: FILE_ID,
      entityType: DataImportEntityType.INVENTORY,
      sourceSheet: null,
      sourceRowNumber: index + 2,
      rawData: raw,
      normalizedData: null,
      validationErrors: null,
      validationWarnings: null,
      isValid: true,
      isSelected: true,
      duplicateKey: null,
      duplicateStatus: DataImportDuplicateStatus.NONE,
      importStatus: DataImportRecordStatus.STAGED,
      targetRecordId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });
}

function seedExistingWatch(prisma: FakePrisma, serialNumber: string, tenantId = TENANT) {
  prisma.watch.rows.push({
    id: `watch-existing-${serialNumber}`,
    tenantId,
    brand: 'Rolex',
    model: 'Existing',
    serialNumber,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function makeService(prisma: FakePrisma): WatchImportService {
  return new WatchImportService(prisma as never, fxServiceFake as never);
}

function eventsOfType(prisma: FakePrisma, type: DataImportEventType): Row[] {
  return prisma.dataImportEvent.rows.filter((e) => e.eventType === type);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WatchImportService (integration, in-memory prisma)', () => {
  let prisma: FakePrisma;
  let service: WatchImportService;

  beforeEach(() => {
    prisma = new FakePrisma();
    service = makeService(prisma);
  });

  describe('dry run', () => {
    it('validates rows, persists normalized data, and sets a dry-run version', async () => {
      seed(prisma, [rawRow({ Serie: 'SN-1' }), rawRow({ Serie: 'SN-2', Costo: '0' }), rawRow({ Marca: '' })]);

      const summary = await service.runDryRun(TENANT, SESSION_ID);

      expect(summary.total).toBe(3);
      expect(summary.valid).toBe(1);
      expect(summary.warnings).toBe(1); // zero cost
      expect(summary.invalid).toBe(1); // missing brand
      expect(summary.dryRunVersion).toMatch(/^[0-9a-f]{16}:/);

      const session = prisma.dataImportSession.rows[0];
      expect(session.dryRunVersion).toBe(summary.dryRunVersion);
      expect(session.validRows).toBe(1);
      expect(session.warningRows).toBe(1);
      expect(session.invalidRows).toBe(1);

      const rec1 = prisma.dataImportRecord.rows[0];
      expect((rec1.normalizedData as { brand?: string }).brand).toBe('Rolex');
      expect(rec1.isValid).toBe(true);

      const rec3 = prisma.dataImportRecord.rows[2];
      expect(rec3.isValid).toBe(false);

      expect(eventsOfType(prisma, DataImportEventType.DRY_RUN_COMPLETED)).toHaveLength(1);
    });

    it('marks DB serial conflicts as WARNING/CONFIRMED_DUPLICATE and in-file dups as INVALID', async () => {
      seedExistingWatch(prisma, 'SN-DB');
      seed(prisma, [
        rawRow({ Serie: 'SN-DB' }),
        rawRow({ Serie: 'SN-FILE' }),
        rawRow({ Serie: 'SN-FILE' }),
      ]);

      const summary = await service.runDryRun(TENANT, SESSION_ID);

      const [dbDup, firstFileDup, secondFileDup] = prisma.dataImportRecord.rows;
      expect(dbDup.isValid).toBe(true);
      expect(dbDup.duplicateStatus).toBe(DataImportDuplicateStatus.CONFIRMED_DUPLICATE);
      expect(firstFileDup.isValid).toBe(true);
      expect(firstFileDup.duplicateStatus).toBe(DataImportDuplicateStatus.POSSIBLE_DUPLICATE);
      expect(secondFileDup.isValid).toBe(false);
      expect(summary.invalid).toBe(1);
    });

    it('is tenant-isolated', async () => {
      seed(prisma, [rawRow()]);
      await expect(service.runDryRun(OTHER_TENANT, SESSION_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('commit — happy path and eligibility', () => {
    it('imports VALID and WARNING rows, excludes INVALID rows, persists targetRecordId', async () => {
      seed(prisma, [rawRow({ Serie: 'SN-1' }), rawRow({ Serie: 'SN-2', Costo: '0' }), rawRow({ Marca: '' })]);
      await service.runDryRun(TENANT, SESSION_ID);

      const result = await service.commitImport(TENANT, SESSION_ID, 'SKIP_DUPLICATES');

      expect(result.importedCount).toBe(2); // VALID + WARNING both eligible
      expect(result.skippedCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(prisma.watch.rows).toHaveLength(2);

      const imported = prisma.dataImportRecord.rows.filter((r) => r.importStatus === DataImportRecordStatus.IMPORTED);
      expect(imported).toHaveLength(2);
      for (const record of imported) {
        expect(record.targetRecordId).toBeTruthy();
        expect(prisma.watch.rows.some((w) => w.id === record.targetRecordId)).toBe(true);
      }

      const invalidRecord = prisma.dataImportRecord.rows[2];
      expect(invalidRecord.importStatus).toBe(DataImportRecordStatus.STAGED);
      expect(invalidRecord.targetRecordId).toBeNull();

      const session = prisma.dataImportSession.rows[0];
      expect(session.status).toBe(DataImportStatus.COMPLETED);
      expect(session.importedRows).toBe(2);

      expect(eventsOfType(prisma, DataImportEventType.IMPORT_STARTED)).toHaveLength(1);
      expect(eventsOfType(prisma, DataImportEventType.IMPORT_COMPLETED)).toHaveLength(1);
    });

    it('imported watches are never published and carry the tenant id', async () => {
      seed(prisma, [rawRow({ Serie: 'SN-1' })]);
      await service.runDryRun(TENANT, SESSION_ID);
      await service.commitImport(TENANT, SESSION_ID, 'SKIP_DUPLICATES');

      const watch = prisma.watch.rows[0];
      expect(watch.isPublished).toBe(false);
      expect(watch.tenantId).toBe(TENANT);
      expect(watch.consignmentOwnerName).toBeNull();
    });

    it('requires a dry run before commit', async () => {
      seed(prisma, [rawRow()]);
      await expect(service.commitImport(TENANT, SESSION_ID, 'SKIP_DUPLICATES')).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects commit when the mapping changed after the dry run (exact version)', async () => {
      seed(prisma, [rawRow()]);
      await service.runDryRun(TENANT, SESSION_ID);
      prisma.dataImportFile.rows[0].mappingVersion = 'changed-version';
      await expect(service.commitImport(TENANT, SESSION_ID, 'SKIP_DUPLICATES')).rejects.toThrow(UnprocessableEntityException);
    });

    it('is tenant-isolated', async () => {
      seed(prisma, [rawRow()]);
      await service.runDryRun(TENANT, SESSION_ID);
      await expect(service.commitImport(OTHER_TENANT, SESSION_ID, 'SKIP_DUPLICATES')).rejects.toThrow(NotFoundException);
    });
  });

  describe('commit — duplicate policies', () => {
    it('SKIP_DUPLICATES skips DB serial duplicates', async () => {
      seedExistingWatch(prisma, 'SN-DB');
      seed(prisma, [rawRow({ Serie: 'SN-DB' }), rawRow({ Serie: 'SN-NEW' })]);
      await service.runDryRun(TENANT, SESSION_ID);

      const result = await service.commitImport(TENANT, SESSION_ID, 'SKIP_DUPLICATES');

      expect(result.importedCount).toBe(1);
      expect(result.skippedCount).toBe(1);
      // Only the pre-existing watch + the new one; no duplicate serial created.
      expect(prisma.watch.rows.filter((w) => w.serialNumber === 'SN-DB')).toHaveLength(1);
      expect(prisma.dataImportRecord.rows[0].importStatus).toBe(DataImportRecordStatus.SKIPPED);
    });

    it('IMPORT_AS_NEW still never creates a second watch with an existing serial', async () => {
      seedExistingWatch(prisma, 'SN-DB');
      seed(prisma, [rawRow({ Serie: 'SN-DB' }), rawRow({ Serie: 'SN-NEW' })]);
      await service.runDryRun(TENANT, SESSION_ID);

      const result = await service.commitImport(TENANT, SESSION_ID, 'IMPORT_AS_NEW');

      expect(result.importedCount).toBe(1);
      expect(result.skippedCount).toBe(1);
      expect(prisma.watch.rows.filter((w) => w.serialNumber === 'SN-DB')).toHaveLength(1);
    });

    it('IMPORT_AS_NEW imports possible duplicates (first in-file occurrence) — exact conflicts still blocked', async () => {
      seed(prisma, [rawRow({ Serie: 'SN-X' }), rawRow({ Serie: 'SN-X' })]);
      await service.runDryRun(TENANT, SESSION_ID);

      const result = await service.commitImport(TENANT, SESSION_ID, 'IMPORT_AS_NEW');

      // First occurrence imports; second occurrence was INVALID at dry run.
      expect(result.importedCount).toBe(1);
      expect(prisma.watch.rows.filter((w) => w.serialNumber === 'SN-X')).toHaveLength(1);
    });

    it('SKIP_DUPLICATES also skips possible duplicates', async () => {
      seed(prisma, [rawRow({ Serie: 'SN-X' }), rawRow({ Serie: 'SN-X' }), rawRow({ Serie: 'SN-OK' })]);
      await service.runDryRun(TENANT, SESSION_ID);

      const result = await service.commitImport(TENANT, SESSION_ID, 'SKIP_DUPLICATES');

      expect(result.importedCount).toBe(1); // only SN-OK
      expect(result.skippedCount).toBe(1); // first SN-X occurrence
      expect(prisma.watch.rows.filter((w) => w.serialNumber === 'SN-X')).toHaveLength(0);
    });

    it('commit-time recheck skips serials added to inventory after the dry run', async () => {
      seed(prisma, [rawRow({ Serie: 'SN-LATE' })]);
      await service.runDryRun(TENANT, SESSION_ID);
      // Watch created by someone else between dry run and commit.
      seedExistingWatch(prisma, 'SN-LATE');

      const result = await service.commitImport(TENANT, SESSION_ID, 'IMPORT_AS_NEW');

      expect(result.importedCount).toBe(0);
      expect(result.skippedCount).toBe(1);
      expect(prisma.watch.rows.filter((w) => w.serialNumber === 'SN-LATE')).toHaveLength(1);
    });
  });

  describe('commit — concurrency, partial failure, retries, stale recovery', () => {
    it('a session already IMPORTING (not stale) rejects a second commit', async () => {
      seed(prisma, [rawRow()], { status: DataImportStatus.IMPORTING });
      prisma.dataImportSession.rows[0].importStartedAt = new Date();
      await expect(service.commitImport(TENANT, SESSION_ID, 'SKIP_DUPLICATES')).rejects.toThrow(ConflictException);
    });

    it('the loser of a concurrent claim race gets a conflict', async () => {
      seed(prisma, [rawRow()]);
      await service.runDryRun(TENANT, SESSION_ID);

      // Simulate a concurrent winner claiming the session right after this
      // request reads it: the CAS updateMany must then match 0 rows.
      const original = prisma.dataImportSession.findFirst.bind(prisma.dataImportSession);
      let firstRead = true;
      prisma.dataImportSession.findFirst = async (args) => {
        const result = await original(args);
        if (firstRead && result) {
          firstRead = false;
          const live = prisma.dataImportSession.rows.find((r) => r.id === result.id)!;
          live.status = DataImportStatus.IMPORTING;
          live.importStartedAt = new Date();
        }
        return result;
      };

      await expect(service.commitImport(TENANT, SESSION_ID, 'SKIP_DUPLICATES')).rejects.toThrow(ConflictException);
      expect(prisma.watch.rows).toHaveLength(0);
    });

    it('partial batch failure marks failed rows, leaves session FAILED (retryable)', async () => {
      seed(prisma, [rawRow({ Serie: 'SN-1' }), rawRow({ Serie: 'SN-2', Marca: 'FailBrand' })]);
      await service.runDryRun(TENANT, SESSION_ID);
      prisma.watch.failWhen = (data) => data.brand === 'FailBrand';

      const result = await service.commitImport(TENANT, SESSION_ID, 'SKIP_DUPLICATES');

      expect(result.importedCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(prisma.dataImportSession.rows[0].status).toBe(DataImportStatus.FAILED);
      expect(prisma.dataImportRecord.rows[1].importStatus).toBe(DataImportRecordStatus.FAILED);
      expect(eventsOfType(prisma, DataImportEventType.IMPORT_FAILED).length).toBeGreaterThanOrEqual(1);
    });

    it('retry after partial failure is idempotent — never recreates rows with targetRecordId', async () => {
      seed(prisma, [rawRow({ Serie: 'SN-1' }), rawRow({ Serie: 'SN-2', Marca: 'FailBrand' })]);
      await service.runDryRun(TENANT, SESSION_ID);
      prisma.watch.failWhen = (data) => data.brand === 'FailBrand';
      await service.commitImport(TENANT, SESSION_ID, 'SKIP_DUPLICATES');

      // Transient failure resolved; retry.
      prisma.watch.failWhen = null;
      const retry = await service.commitImport(TENANT, SESSION_ID, 'SKIP_DUPLICATES');

      expect(retry.importedCount).toBe(1); // only the previously failed row
      expect(prisma.watch.rows).toHaveLength(2);
      expect(prisma.watch.rows.filter((w) => w.serialNumber === 'SN-1')).toHaveLength(1);
      const session = prisma.dataImportSession.rows[0];
      expect(session.status).toBe(DataImportStatus.COMPLETED);
      expect(session.importedRows).toBe(2); // cumulative across runs
    });

    it('repeated commit after full success is rejected without duplicating watches', async () => {
      seed(prisma, [rawRow({ Serie: 'SN-1' })]);
      await service.runDryRun(TENANT, SESSION_ID);
      await service.commitImport(TENANT, SESSION_ID, 'SKIP_DUPLICATES');

      await expect(service.commitImport(TENANT, SESSION_ID, 'SKIP_DUPLICATES')).rejects.toThrow(ConflictException);
      expect(prisma.watch.rows).toHaveLength(1);
    });

    it('recovers a stale IMPORTING session (crash after claim) and resumes only pending rows', async () => {
      seed(prisma, [rawRow({ Serie: 'SN-1' }), rawRow({ Serie: 'SN-2' })]);
      await service.runDryRun(TENANT, SESSION_ID);

      // Simulate a crash mid-import: session stuck IMPORTING 20 minutes ago,
      // first row already imported with a persisted targetRecordId.
      const crashedWatch = await prisma.watch.create({
        data: { tenantId: TENANT, brand: 'Rolex', model: 'Submariner', serialNumber: 'SN-1', deletedAt: null },
      });
      const rec1 = prisma.dataImportRecord.rows[0];
      rec1.importStatus = DataImportRecordStatus.IMPORTED;
      rec1.targetRecordId = crashedWatch.id;
      const sessionRow = prisma.dataImportSession.rows[0];
      sessionRow.status = DataImportStatus.IMPORTING;
      sessionRow.importStartedAt = new Date(Date.now() - 20 * 60_000);

      const result = await service.commitImport(TENANT, SESSION_ID, 'SKIP_DUPLICATES');

      // Stale recovery logged a structured IMPORT_FAILED event.
      const staleEvents = eventsOfType(prisma, DataImportEventType.IMPORT_FAILED).filter(
        (e) => (e.metadata as { reason?: string })?.reason === 'STALE_IMPORT_TIMEOUT',
      );
      expect(staleEvents).toHaveLength(1);

      // Only the pending row was imported; SN-1 was not recreated.
      expect(result.importedCount).toBe(1);
      expect(prisma.watch.rows.filter((w) => w.serialNumber === 'SN-1')).toHaveLength(1);
      expect(prisma.watch.rows.filter((w) => w.serialNumber === 'SN-2')).toHaveLength(1);
      expect(prisma.dataImportSession.rows[0].status).toBe(DataImportStatus.COMPLETED);
      expect(prisma.dataImportSession.rows[0].importedRows).toBe(2);
    });

    it('a fresh IMPORTING session within the timeout is NOT recovered', async () => {
      seed(prisma, [rawRow()], { status: DataImportStatus.IMPORTING });
      prisma.dataImportSession.rows[0].importStartedAt = new Date(Date.now() - 60_000);
      await expect(service.commitImport(TENANT, SESSION_ID, 'SKIP_DUPLICATES')).rejects.toThrow(
        'Una importación ya está en curso para esta sesión.',
      );
      expect(prisma.dataImportSession.rows[0].status).toBe(DataImportStatus.IMPORTING);
    });
  });

  describe('error report', () => {
    it('only includes invalid rows, escapes cells, and is tenant-scoped', async () => {
      seed(prisma, [rawRow({ Serie: 'SN-1' }), rawRow({ Marca: '=HYPERLINK("http://evil")', Modelo: '' })]);
      await service.runDryRun(TENANT, SESSION_ID);

      const csv = await service.getErrorReport(TENANT, SESSION_ID);
      const lines = csv.split('\n');
      expect(lines[0]).toBe('Fila,Hoja,Marca,Modelo,Serie,Errores,Advertencias');
      expect(lines).toHaveLength(2); // header + the one invalid row (missing model)
      expect(lines[1]).toContain("'=HYPERLINK");

      await expect(service.getErrorReport(OTHER_TENANT, SESSION_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
