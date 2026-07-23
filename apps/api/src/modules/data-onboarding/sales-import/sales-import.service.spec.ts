import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
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

import { SalesImportService } from './sales-import.service';
import { buildSalesMappingVersion } from './sales-field-mapping';
import { SalesMappingEntry } from './historical-sale.types';

// ─── In-memory Prisma fake ────────────────────────────────────────────────────

type Row = Record<string, unknown> & { id: string };

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected !== null && typeof expected === 'object' && !(expected instanceof Date)) {
    const cond = expected as Record<string, unknown>;
    if ('in' in cond) return (cond.in as unknown[]).includes(actual);
    if ('lt' in cond) return actual instanceof Date && (cond.lt as Date) instanceof Date && actual < (cond.lt as Date);
    if ('equals' in cond) {
      const eq = String(cond.equals);
      const mode = cond.mode;
      if (mode === 'insensitive') {
        return String(actual ?? '').toLowerCase() === eq.toLowerCase();
      }
      return actual === cond.equals;
    }
    if ('not' in cond) return !matchValue(actual, cond.not);
    // Nested AND of field conditions (reference + model)
    return Object.entries(cond).every(([k, v]) => matchValue((actual as Row)?.[k], v));
  }
  if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
  return actual === expected;
}

function matchesWhere(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  if ('OR' in where && Array.isArray(where.OR)) {
    const { OR, ...rest } = where;
    return matchesWhere(row, rest) && OR.some((clause) => matchesWhere(row, clause as Record<string, unknown>));
  }
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === 'OR') return true;
    return matchValue(row[key], value);
  });
}

function cleanData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === Prisma.DbNull || value === Prisma.JsonNull) out[key] = null;
    else out[key] = value;
  }
  return out;
}

let idSeq = 0;

class FakeModel {
  rows: Row[] = [];

  async findFirst(args: { where: Record<string, unknown> }): Promise<Row | null> {
    const found = this.rows.find((r) => matchesWhere(r, args.where));
    return found ? { ...found } : null;
  }

  async findMany(
    args: { where?: Record<string, unknown>; orderBy?: Record<string, string>; take?: number; select?: Record<string, boolean> } = {},
  ): Promise<Row[]> {
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
    const row: Row = {
      id: `gen-${++idSeq}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
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
  client = new FakeModel();
  watch = new FakeModel();
  deal = new FakeModel();
  payment = new FakeModel();

  async $transaction(arg: unknown[] | ((tx: FakePrisma) => Promise<unknown>)): Promise<unknown> {
    if (Array.isArray(arg)) return Promise.all(arg);
    return arg(this);
  }
}

const fxServiceFake = { getUsdMxn: async () => ({ rate: 17.5, source: 'test', fetchedAt: new Date().toISOString() }) };

const TENANT = 'tenant-1';
const SESSION_ID = 'sess-sales-1';
const FILE_ID = 'file-sales-1';

const MAPPING: SalesMappingEntry[] = [
  { sourceColumn: 'Fecha', targetField: 'saleDate' },
  { sourceColumn: 'Cliente', targetField: 'customerName' },
  { sourceColumn: 'Marca', targetField: 'brand' },
  { sourceColumn: 'Modelo', targetField: 'model' },
  { sourceColumn: 'Serie', targetField: 'serialNumber' },
  { sourceColumn: 'Costo', targetField: 'cost' },
  { sourceColumn: 'Precio', targetField: 'salePrice' },
  { sourceColumn: 'Extras', targetField: 'extras' },
  { sourceColumn: 'Utilidad', targetField: 'reportedProfit' },
  { sourceColumn: 'Moneda', targetField: 'currency' },
];

function seedSession(db: FakePrisma, status: DataImportStatus = DataImportStatus.READY_FOR_REVIEW) {
  db.dataImportSession.rows.push({
    id: SESSION_ID,
    tenantId: TENANT,
    status,
    importTarget: DataImportTarget.SALES,
    dryRunVersion: null,
    importStartedAt: null,
    updatedAt: new Date(),
    validRows: 0,
    warningRows: 0,
    invalidRows: 0,
    totalRows: 0,
    importedRows: 0,
  } as Row);
}

function seedFile(db: FakePrisma) {
  const mappingVersion = buildSalesMappingVersion(MAPPING);
  db.dataImportFile.rows.push({
    id: FILE_ID,
    tenantId: TENANT,
    sessionId: SESSION_ID,
    originalFilename: 'ventas.csv',
    fieldMapping: MAPPING,
    mappingVersion,
    rowCount: 1,
    checksum: 'chk-1',
    detectedEntityType: DataImportEntityType.SALES,
  } as Row);
  return mappingVersion;
}

function seedRecord(db: FakePrisma, raw: Record<string, string>, rowNumber = 1) {
  const id = `rec-${rowNumber}`;
  db.dataImportRecord.rows.push({
    id,
    tenantId: TENANT,
    sessionId: SESSION_ID,
    fileId: FILE_ID,
    entityType: DataImportEntityType.SALES,
    sourceRowNumber: rowNumber,
    rawData: raw,
    normalizedData: null,
    isValid: false,
    isSelected: false,
    duplicateStatus: DataImportDuplicateStatus.NONE,
    importStatus: DataImportRecordStatus.STAGED,
    targetRecordId: null,
    validationErrors: null,
    validationWarnings: null,
  } as Row);
  return id;
}

describe('SalesImportService — dry-run / commit happy paths', () => {
  let db: FakePrisma;
  let service: SalesImportService;

  beforeEach(() => {
    idSeq = 0;
    db = new FakePrisma();
    service = new SalesImportService(db as unknown as never, fxServiceFake as never);
    seedSession(db);
    seedFile(db);
  });

  it('runSalesDryRun normalizes, matches client by exact name, and sets dryRunVersion', async () => {
    db.client.rows.push({
      id: 'client-existing',
      tenantId: TENANT,
      name: 'Juan Pérez',
      deletedAt: null,
    } as Row);

    seedRecord(db, {
      Fecha: '15/03/2024',
      Cliente: 'Juan Pérez',
      Marca: 'Rolex',
      Modelo: 'Submariner',
      Serie: '',
      Costo: '200000',
      Precio: '298000',
      Extras: '5000',
      Utilidad: '93000',
      Moneda: 'MXN',
    });

    const summary = await service.runSalesDryRun(TENANT, SESSION_ID);

    expect(summary.valid + summary.warnings).toBeGreaterThan(0);
    expect(summary.invalid).toBe(0);
    expect(summary.clientsMatched).toBe(1);
    expect(summary.dryRunVersion).toContain(':');
    expect(db.dataImportSession.rows[0].dryRunVersion).toBe(summary.dryRunVersion);
    expect(db.dataImportEvent.rows.some((e) => e.eventType === DataImportEventType.SALES_DRY_RUN_COMPLETED)).toBe(
      true,
    );

    const record = db.dataImportRecord.rows[0];
    expect(record.isValid).toBe(true);
    expect(record.isSelected).toBe(true);
    expect((record.normalizedData as { matchedClientId?: string }).matchedClientId).toBe('client-existing');
  });

  it('runSalesDryRun proposes new client and exact serial watch match without mutating watches', async () => {
    db.watch.rows.push({
      id: 'watch-1',
      tenantId: TENANT,
      serialNumber: 'SN-999',
      status: 'AVAILABLE',
      deletedAt: null,
      reference: '126610LN',
      model: 'Submariner',
    } as Row);

    seedRecord(db, {
      Fecha: '01/01/2024',
      Cliente: 'Nuevo Comprador',
      Marca: 'Rolex',
      Modelo: 'Submariner',
      Serie: 'SN-999',
      Costo: '100',
      Precio: '200',
      Extras: '0',
      Utilidad: '100',
      Moneda: 'MXN',
    });

    const summary = await service.runSalesDryRun(TENANT, SESSION_ID);
    expect(summary.clientsProposed).toBe(1);
    expect(summary.exactSerialMatches).toBe(1);
    expect(db.watch.rows[0].status).toBe('AVAILABLE');
  });

  it('commitSalesImport creates Client + CLOSED_WON Deal with watchId null, no Payment, no watch status change', async () => {
    db.watch.rows.push({
      id: 'watch-1',
      tenantId: TENANT,
      serialNumber: 'SN-1',
      status: 'AVAILABLE',
      deletedAt: null,
    } as Row);

    seedRecord(db, {
      Fecha: '10/02/2024',
      Cliente: 'María López',
      Marca: 'Omega',
      Modelo: 'Speedmaster',
      Serie: 'SN-1',
      Costo: '50000',
      Precio: '80000',
      Extras: '1000',
      Utilidad: '29000',
      Moneda: 'MXN',
    });

    const dry = await service.runSalesDryRun(TENANT, SESSION_ID);
    expect(dry.invalid).toBe(0);
    expect(dry.exactSerialMatches).toBe(1);

    const record = db.dataImportRecord.rows[0];
    expect((record.normalizedData as { matchedWatchId?: string }).matchedWatchId).toBe('watch-1');

    const result = await service.commitSalesImport(TENANT, SESSION_ID);

    expect(result.importedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.clientsCreated).toBe(1);

    expect(db.client.rows).toHaveLength(1);
    expect(db.client.rows[0].name).toBe('María López');
    expect(db.client.rows[0].notes).toContain('histórica');

    expect(db.deal.rows).toHaveLength(1);
    const deal = db.deal.rows[0];
    expect(deal.stage).toBe(DealStage.CLOSED_WON);
    expect(deal.watchId).toBeNull();
    expect(Number(deal.agreedPrice)).toBe(80000);
    expect(deal.importSessionId).toBe(SESSION_ID);
    expect(deal.sourceTag).toBe('HISTORICAL_SALES_IMPORT');
    expect(deal.importFingerprint).toBeTruthy();

    expect(db.payment.rows).toHaveLength(0);
    expect(db.watch.rows[0].status).toBe('AVAILABLE');

    expect(db.dataImportRecord.rows[0].importStatus).toBe(DataImportRecordStatus.IMPORTED);
    expect(db.dataImportRecord.rows[0].targetRecordId).toBe(deal.id);
    expect(db.dataImportSession.rows[0].status).toBe(DataImportStatus.COMPLETED);
    expect(
      db.dataImportEvent.rows.some((e) => e.eventType === DataImportEventType.SALES_IMPORT_COMMITTED),
    ).toBe(true);
  });

  it('missing sale price is invalid and cannot commit', async () => {
    seedRecord(db, {
      Fecha: '10/02/2024',
      Cliente: 'Sin Precio',
      Marca: 'Rolex',
      Modelo: 'Sub',
      Serie: '',
      Costo: '50000',
      Precio: '',
      Extras: '0',
      Utilidad: '',
      Moneda: 'MXN',
    });

    const dry = await service.runSalesDryRun(TENANT, SESSION_ID);
    expect(dry.invalid).toBe(1);
    expect(db.dataImportRecord.rows[0].isValid).toBe(false);

    await expect(service.commitSalesImport(TENANT, SESSION_ID)).resolves.toMatchObject({
      importedCount: 0,
    });
    expect(db.deal.rows).toHaveLength(0);
  });

  it('resolveOrCreateClient re-queries exact name before create (concurrent second find)', async () => {
    const cache = new Map<string, string>();
    // Simulate: initial cache load missed this client; re-query inside the transaction finds it.
    const findManySpy = jest.spyOn(db.client, 'findMany').mockResolvedValueOnce([
      { id: 'client-raced', tenantId: TENANT, name: 'Concurrent Buyer', deletedAt: null } as Row,
    ]);

    const result = await service.resolveOrCreateClient(
      db as unknown as never,
      TENANT,
      { customerName: 'Concurrent Buyer', salePrice: 1000 },
      { id: 'rec-x', sourceRowNumber: 1 },
      cache,
    );

    expect(result).toEqual({ id: 'client-raced', created: false });
    expect(cache.get('concurrent buyer')).toBe('client-raced');
    expect(findManySpy).toHaveBeenCalledTimes(1);
    expect(db.client.rows.some((r) => r.name === 'Concurrent Buyer')).toBe(false);
    findManySpy.mockRestore();
  });

  it('rejects sales operations on INVENTORY sessions', async () => {
    db.dataImportSession.rows[0].importTarget = DataImportTarget.INVENTORY;
    await expect(service.runSalesDryRun(TENANT, SESSION_ID)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('commit is idempotent on fingerprint + targetRecordId', async () => {
    seedRecord(db, {
      Fecha: '10/02/2024',
      Cliente: 'Idempotent',
      Marca: 'Rolex',
      Precio: '1000',
      Costo: '400',
      Extras: '0',
      Utilidad: '600',
      Moneda: 'MXN',
      Serie: '',
      Modelo: '',
    });

    await service.runSalesDryRun(TENANT, SESSION_ID);
    const first = await service.commitSalesImport(TENANT, SESSION_ID);
    expect(first.importedCount).toBe(1);
    expect(db.deal.rows).toHaveLength(1);

    // Simulate retry: session FAILED, record still has targetRecordId so skipped by eligibility filter
    db.dataImportSession.rows[0].status = DataImportStatus.FAILED;
    const second = await service.commitSalesImport(TENANT, SESSION_ID);
    expect(second.importedCount).toBe(0);
    expect(db.deal.rows).toHaveLength(1);
  });

  it('rejects dry-run when session is not READY_FOR_REVIEW', async () => {
    db.dataImportSession.rows[0].status = DataImportStatus.PROCESSING;
    await expect(service.runSalesDryRun(TENANT, SESSION_ID)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects commit without dry-run', async () => {
    await expect(service.commitSalesImport(TENANT, SESSION_ID)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects concurrent non-stale IMPORTING commit', async () => {
    seedRecord(db, {
      Cliente: 'X',
      Marca: 'Rolex',
      Precio: '100',
      Costo: '40',
      Extras: '0',
      Utilidad: '60',
      Fecha: '01/01/2024',
      Moneda: 'MXN',
      Serie: '',
      Modelo: '',
    });
    await service.runSalesDryRun(TENANT, SESSION_ID);
    db.dataImportSession.rows[0].status = DataImportStatus.IMPORTING;
    db.dataImportSession.rows[0].importStartedAt = new Date();
    await expect(service.commitSalesImport(TENANT, SESSION_ID)).rejects.toBeInstanceOf(ConflictException);
  });
});
