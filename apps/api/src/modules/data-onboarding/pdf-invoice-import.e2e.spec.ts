/**
 * Local end-to-end test for the AI PDF Invoice Importer.
 *
 * Uses @nestjs/testing with a stateful in-memory Prisma mock so the test runs
 * without a live database. Everything else is real:
 *   - NestJS HTTP server (Express + supertest = real HTTP calls)
 *   - JWT guard (validates real tokens)
 *   - DataOnboardingService, WatchImportService, PdfInvoiceImportService (real)
 *   - FakeExtractionProvider — no Anthropic API calls
 *   - inspectPdf (pdf-lib) — binary fixtures from test-fixtures/
 *   - LocalImportFileStorage — real file I/O in a temp dir
 *
 * Run:
 *   cd apps/api
 *   npx jest src/modules/data-onboarding/pdf-invoice-import.e2e.spec.ts --no-coverage
 *
 * Scenarios A–J:
 *   A  single-watch happy path
 *   B  multi-watch invoice (3 watches)
 *   C  no-watch invoice (0 watches)
 *   D  encrypted PDF rejected before AI call
 *   E  corrupt PDF rejected before AI call
 *   F  invoice total not per-watch (purchasePrice absent)
 *   G  duplicate serial numbers returned
 *   H  accessory lines excluded (1 watch extracted)
 *   I  prompt-injection text ignored (1 watch)
 *   J  extraction error — output truncated (422 + EXTRACTION_OUTPUT_TRUNCATED)
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import request from 'supertest';
import * as jwt from 'jsonwebtoken';
import {
  DataImportStatus,
  DataImportFileStatus,
  DataImportFileType,
  DataImportEntityType,
  DataImportRecordStatus,
  DataImportDuplicateStatus,
  DataImportEventType,
  DataImportTarget,
} from '@prisma/client';

import { JwtStrategy } from '../core/auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { DataOnboardingController } from './data-onboarding.controller';
import { DataOnboardingService } from './data-onboarding.service';
import { WatchImportService } from './inventory-import/watch-import.service';
import { PdfInvoiceImportService } from './pdf-invoice-import.service';
import { PdfSalesImportService } from './pdf-sales-import.service';
import { SalesImportService } from './sales-import/sales-import.service';
import { FxService } from '../fx/fx.service';
import { ReceivablesService } from '../receivables/receivables.service';
import { IMPORT_FILE_STORAGE } from './tokens';
import { LocalImportFileStorage } from './storage/local-import-file.storage';

// ─── Constants ────────────────────────────────────────────────────────────────

const E2E_JWT_SECRET = 'e2e-test-secret-do-not-use-in-prod';
const E2E_TENANT_ID = `e2e-test-${Date.now()}`;
const FIXTURES_DIR = path.join(__dirname, 'test-fixtures');

// ─── Stateful in-memory Prisma mock ──────────────────────────────────────────

type Session = {
  id: string;
  tenantId: string;
  createdByUserId: string;
  title: string | null;
  status: DataImportStatus;
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
};

type ImportFile = {
  id: string;
  tenantId: string;
  sessionId: string;
  originalFilename: string;
  storageKey: string;
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
  extractedDocumentData: unknown;
  extractionProvider: string | null;
  extractionModel: string | null;
  extractionError: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ImportRecord = {
  id: string;
  tenantId: string;
  sessionId: string;
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
  duplicateKey: string | null;
  createdAt: Date;
};

type ImportEvent = {
  id: string;
  tenantId: string;
  sessionId: string;
  eventType: DataImportEventType;
  message: string;
  metadata: unknown;
  createdAt: Date;
};

/** Resolve Prisma-style update data — handles `{ increment: N }` shorthands. */
function applyUpdate(
  current: Record<string, unknown>,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(data)) {
    if (val !== null && typeof val === 'object' && 'increment' in (val as object)) {
      result[key] = ((current[key] as number) ?? 0) + (val as { increment: number }).increment;
    } else {
      result[key] = val;
    }
  }
  return result;
}

/** Minimal Prisma `where` clause matcher — handles scalars, `{ in }`, `{ lt }`, `{ not }`. */
function matchesWhere(obj: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, val] of Object.entries(where)) {
    if (val === null || val === undefined) continue;
    if (typeof val === 'object' && !Array.isArray(val)) {
      const v = val as Record<string, unknown>;
      if ('in' in v) {
        if (!(v['in'] as unknown[]).includes(obj[key])) return false;
        continue;
      }
      if ('not' in v) {
        if (obj[key] === v['not']) return false;
        continue;
      }
      if ('equals' in v) {
        if (obj[key] !== v['equals']) return false;
        continue;
      }
      if ('lt' in v) {
        if (!((obj[key] as Date) < (v['lt'] as Date))) return false;
        continue;
      }
    }
    if (obj[key] !== val) return false;
  }
  return true;
}

function buildMockPrisma() {
  const sessions = new Map<string, Session>();
  const files = new Map<string, ImportFile>();
  const records: ImportRecord[] = [];
  const events: ImportEvent[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    dataImportSession: {
      create: async ({ data }: { data: Partial<Session> }) => {
        const s: Session = {
          id: randomUUID(),
          tenantId: data.tenantId!,
          createdByUserId: data.createdByUserId!,
          title: data.title ?? null,
          status: data.status ?? DataImportStatus.CREATED,
          importTarget: data.importTarget ?? DataImportTarget.INVENTORY,
          totalFiles: 0,
          processedFiles: 0,
          totalRows: 0,
          validRows: 0,
          warningRows: 0,
          invalidRows: 0,
          importedRows: 0,
          dryRunVersion: null,
          startedAt: null,
          completedAt: null,
          errorMessage: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        sessions.set(s.id, s);
        return s;
      },

      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        for (const s of sessions.values()) {
          if (matchesWhere(s as unknown as Record<string, unknown>, where)) return s;
        }
        return null;
      },

      findMany: async ({ where, take }: { where?: Record<string, unknown>; take?: number }) => {
        let result = Array.from(sessions.values());
        if (where) result = result.filter((s) => matchesWhere(s as unknown as Record<string, unknown>, where));
        if (take) result = result.slice(0, take);
        return result;
      },

      update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        for (const s of sessions.values()) {
          if (matchesWhere(s as unknown as Record<string, unknown>, where)) {
            Object.assign(s, applyUpdate(s as unknown as Record<string, unknown>, data), { updatedAt: new Date() });
            return s;
          }
        }
        throw new Error(`Session not found for update: ${JSON.stringify(where)}`);
      },

      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const s of sessions.values()) {
          if (matchesWhere(s as unknown as Record<string, unknown>, where)) {
            Object.assign(s, applyUpdate(s as unknown as Record<string, unknown>, data), { updatedAt: new Date() });
            count++;
          }
        }
        return { count };
      },

      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        let count = 0;
        for (const [id, s] of sessions.entries()) {
          if (matchesWhere(s as unknown as Record<string, unknown>, where)) {
            sessions.delete(id);
            // Cascade: remove associated files and records
            for (const [fid, f] of files.entries()) {
              if (f.sessionId === s.id) files.delete(fid);
            }
            for (let i = records.length - 1; i >= 0; i--) {
              if (records[i].sessionId === s.id) records.splice(i, 1);
            }
            count++;
          }
        }
        return { count };
      },
    },

    dataImportFile: {
      create: async ({ data }: { data: Partial<ImportFile> }) => {
        const f: ImportFile = {
          id: randomUUID(),
          tenantId: data.tenantId!,
          sessionId: data.sessionId!,
          originalFilename: data.originalFilename!,
          storageKey: data.storageKey!,
          mimeType: data.mimeType!,
          fileType: data.fileType!,
          byteSize: data.byteSize ?? 0,
          checksum: data.checksum ?? null,
          status: data.status ?? DataImportFileStatus.UPLOADED,
          detectedEntityType: DataImportEntityType.UNKNOWN,
          sheetNames: null,
          rowCount: 0,
          classificationMeta: null,
          fieldMapping: null,
          mappingVersion: null,
          extractedDocumentData: null,
          extractionProvider: null,
          extractionModel: null,
          extractionError: null,
          errorMessage: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        files.set(f.id, f);
        return f;
      },

      findFirst: async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
        for (const f of files.values()) {
          if (matchesWhere(f as unknown as Record<string, unknown>, where)) {
            if (!select) return f;
            const projection: Record<string, unknown> = {};
            for (const key of Object.keys(select)) {
              if (select[key]) projection[key] = (f as unknown as Record<string, unknown>)[key];
            }
            return projection;
          }
        }
        return null;
      },

      findMany: async ({ where }: { where?: Record<string, unknown> }) => {
        let result = Array.from(files.values());
        if (where) result = result.filter((f) => matchesWhere(f as unknown as Record<string, unknown>, where));
        return result;
      },

      update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        for (const f of files.values()) {
          if (matchesWhere(f as unknown as Record<string, unknown>, where)) {
            Object.assign(f, applyUpdate(f as unknown as Record<string, unknown>, data), { updatedAt: new Date() });
            return f;
          }
        }
        throw new Error(`File not found for update: ${JSON.stringify(where)}`);
      },
    },

    dataImportRecord: {
      count: async ({ where }: { where: Record<string, unknown> }) =>
        records.filter((r) => matchesWhere(r as unknown as Record<string, unknown>, where)).length,

      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        for (const row of data) {
          records.push({
            id: randomUUID(),
            tenantId: (row.tenantId ?? '') as string,
            sessionId: (row.sessionId ?? '') as string,
            fileId: (row.fileId ?? '') as string,
            entityType: (row.entityType ?? DataImportEntityType.UNKNOWN) as DataImportEntityType,
            sourceSheet: (row.sourceSheet ?? null) as string | null,
            sourceRowNumber: (row.sourceRowNumber ?? null) as number | null,
            rawData: row.rawData,
            normalizedData: null,
            validationErrors: null,
            validationWarnings: null,
            isValid: (row.isValid ?? true) as boolean,
            isSelected: false,
            duplicateStatus: DataImportDuplicateStatus.NONE,
            importStatus: (row.importStatus ?? DataImportRecordStatus.STAGED) as DataImportRecordStatus,
            duplicateKey: (row.duplicateKey ?? null) as string | null,
            createdAt: new Date(),
          });
        }
        return { count: data.length };
      },

      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const before = records.length;
        for (let i = records.length - 1; i >= 0; i--) {
          if (matchesWhere(records[i] as unknown as Record<string, unknown>, where)) records.splice(i, 1);
        }
        return { count: before - records.length };
      },

      findMany: async ({ where, skip, take }: {
        where?: Record<string, unknown>;
        skip?: number;
        take?: number;
      }) => {
        let result = where
          ? records.filter((r) => matchesWhere(r as unknown as Record<string, unknown>, where))
          : [...records];
        if (skip) result = result.slice(skip);
        if (take) result = result.slice(0, take);
        return result;
      },
    },

    dataImportEvent: {
      create: async ({ data }: { data: Partial<ImportEvent> }) => {
        const e: ImportEvent = {
          id: randomUUID(),
          tenantId: (data.tenantId ?? '') as string,
          sessionId: (data.sessionId ?? '') as string,
          eventType: data.eventType!,
          message: (data.message ?? '') as string,
          metadata: data.metadata ?? null,
          createdAt: new Date(),
        };
        events.push(e);
        return e;
      },

      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        events.find((e) => matchesWhere(e as unknown as Record<string, unknown>, where)) ?? null,
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: async (fnOrOps: unknown): Promise<any> => {
      if (typeof fnOrOps === 'function') {
        // Interactive transaction: pass `self` as the transaction client
        return (fnOrOps as (tx: typeof self) => Promise<unknown>)(self);
      }
      // Array of operations: resolve each in sequence
      const results = [];
      for (const op of fnOrOps as Promise<unknown>[]) {
        results.push(await op);
      }
      return results;
    },
  };

  return self;
}

// ─── Test infrastructure ──────────────────────────────────────────────────────

let app: INestApplication;
let storageDir: string;

function makeToken(): string {
  return jwt.sign(
    { userId: 'e2e-user-1', email: 'e2e@test.com', tenantId: E2E_TENANT_ID, role: 'ADMIN' },
    E2E_JWT_SECRET,
    { expiresIn: '1h' },
  );
}

function loadFixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES_DIR, name));
}

function setFakeScenario(s: string | undefined): void {
  if (s) {
    process.env.DOCUMENT_EXTRACTION_FAKE_SCENARIO = s;
  } else {
    delete process.env.DOCUMENT_EXTRACTION_FAKE_SCENARIO;
  }
}

beforeAll(async () => {
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wristos-e2e-'));

  process.env.NODE_ENV = 'test';
  process.env.DOCUMENT_EXTRACTION_PROVIDER = 'fake';
  process.env.JWT_SECRET = E2E_JWT_SECRET;

  const storage = new LocalImportFileStorage(storageDir);
  const mockPrisma = buildMockPrisma();

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      PassportModule.register({ defaultStrategy: 'jwt' }),
    ],
    controllers: [DataOnboardingController],
    providers: [
      JwtStrategy,
      JwtAuthGuard,
      FxService,
      DataOnboardingService,
      WatchImportService,
      SalesImportService,
      PdfInvoiceImportService,
      PdfSalesImportService,
      {
        provide: ReceivablesService,
        useValue: { ensureForDeal: jest.fn(async () => null) },
      },
      { provide: IMPORT_FILE_STORAGE, useValue: storage },
      // Provide PrismaService class as the DI token for the stateful in-memory mock.
      // All three services inject PrismaService by class type, so this correctly
      // intercepts all three injection points without touching the real database.
      { provide: PrismaService, useValue: mockPrisma },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
}, 30_000);

afterAll(async () => {
  setFakeScenario(undefined);
  if (app) await app.close();
  if (storageDir) {
    try { fs.rmSync(storageDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

type HttpResult = { status: number; body: Record<string, unknown> };

async function createSession(token: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/data-onboarding/sessions')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'e2e-test' });
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

async function uploadPdf(token: string, sessionId: string, filename: string, buf: Buffer): Promise<void> {
  const res = await request(app.getHttpServer())
    .post(`/api/data-onboarding/sessions/${sessionId}/files`)
    .set('Authorization', `Bearer ${token}`)
    .attach('file', buf, { filename, contentType: 'application/pdf' });
  expect(res.status).toBe(201);
}

async function processDocument(token: string, sessionId: string): Promise<HttpResult> {
  const res = await request(app.getHttpServer())
    .post(`/api/data-onboarding/sessions/${sessionId}/process-document`)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body as Record<string, unknown> };
}

async function getExtraction(token: string, sessionId: string): Promise<HttpResult> {
  const res = await request(app.getHttpServer())
    .get(`/api/data-onboarding/sessions/${sessionId}/document-extraction`)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body as Record<string, unknown> };
}

async function deleteSession(token: string, sessionId: string): Promise<void> {
  await request(app.getHttpServer())
    .delete(`/api/data-onboarding/sessions/${sessionId}`)
    .set('Authorization', `Bearer ${token}`);
}

// ─── Scenario runner ──────────────────────────────────────────────────────────

async function runScenario(
  fixtureName: string,
  fakeScenario: string | undefined,
  check: (token: string, sessionId: string, proc: HttpResult) => Promise<void>,
): Promise<void> {
  const token = makeToken();
  const sessionId = await createSession(token);
  try {
    await uploadPdf(token, sessionId, fixtureName, loadFixture(fixtureName));
    setFakeScenario(fakeScenario);
    const proc = await processDocument(token, sessionId);
    await check(token, sessionId, proc);
  } finally {
    setFakeScenario(undefined);
    await deleteSession(token, sessionId).catch(() => undefined);
  }
}

// ─── Scenarios A–J ───────────────────────────────────────────────────────────

describe('PDF Invoice Importer — local E2E (scenarios A–J)', () => {
  const timeout = 15_000;

  it(
    'A — single-watch happy path',
    async () => {
      await runScenario('single-watch-digital.pdf', 'single-watch', async (token, sessionId, proc) => {
        expect(proc.status).toBe(201);
        expect(proc.body.watchCount).toBe(1);

        const ext = await getExtraction(token, sessionId);
        expect(ext.status).toBe(200);
        expect(ext.body.extractionState).toBe('ready');
        const watches = (ext.body.extraction as { watches: unknown[] }).watches;
        expect(watches).toHaveLength(1);
        expect((watches[0] as { brand: string }).brand).toBe('Rolex');
      });
    },
    timeout,
  );

  it(
    'B — multi-watch invoice (3 watches)',
    async () => {
      await runScenario('multi-watch-digital.pdf', 'multi-watch', async (token, sessionId, proc) => {
        expect(proc.status).toBe(201);
        expect(proc.body.watchCount).toBe(3);

        const ext = await getExtraction(token, sessionId);
        expect(ext.status).toBe(200);
        const watches = (ext.body.extraction as { watches: unknown[] }).watches;
        expect(watches).toHaveLength(3);
        const brands = (watches as Array<{ brand: string }>).map((w) => w.brand);
        expect(brands).toContain('Rolex');
        expect(brands).toContain('Omega');
        expect(brands).toContain('Patek Philippe');
      });
    },
    timeout,
  );

  it(
    'C — no-watch invoice (0 watches)',
    async () => {
      await runScenario('no-watch-invoice.pdf', 'no-watch', async (token, sessionId, proc) => {
        expect(proc.status).toBe(201);
        expect(proc.body.watchCount).toBe(0);

        const ext = await getExtraction(token, sessionId);
        expect(ext.status).toBe(200);
        const watches = (ext.body.extraction as { watches: unknown[] }).watches;
        expect(watches).toHaveLength(0);
      });
    },
    timeout,
  );

  it(
    'D — encrypted PDF rejected before AI call',
    async () => {
      await runScenario('encrypted.pdf', undefined, async (token, sessionId, proc) => {
        expect(proc.status).toBe(422);

        const ext = await getExtraction(token, sessionId);
        expect(ext.status).toBe(200);
        expect(ext.body.extractionState).toBe('failed');
        const parsed = JSON.parse(ext.body.extractionError as string) as { code: string };
        expect(parsed.code).toBe('EXTRACTION_PDF_ENCRYPTED');
      });
    },
    timeout,
  );

  it(
    'E — corrupt PDF rejected before AI call',
    async () => {
      await runScenario('corrupt.pdf', undefined, async (token, sessionId, proc) => {
        expect(proc.status).toBe(422);

        const ext = await getExtraction(token, sessionId);
        expect(ext.status).toBe(200);
        expect(ext.body.extractionState).toBe('failed');
        const parsed = JSON.parse(ext.body.extractionError as string) as { code: string };
        expect(parsed.code).toBe('EXTRACTION_PDF_CORRUPT');
      });
    },
    timeout,
  );

  it(
    'F — invoice total not assigned per-watch (purchasePrice absent)',
    async () => {
      await runScenario('invoice-with-total-tax-shipping.pdf', 'invoice-total-only', async (token, sessionId, proc) => {
        expect(proc.status).toBe(201);
        expect(proc.body.watchCount).toBe(2);

        const ext = await getExtraction(token, sessionId);
        expect(ext.status).toBe(200);
        const watches = (ext.body.extraction as { watches: Array<{ purchasePrice?: number }> }).watches;
        expect(watches).toHaveLength(2);
        watches.forEach((w) => {
          expect(w.purchasePrice).toBeUndefined();
        });
      });
    },
    timeout,
  );

  it(
    'G — duplicate serial numbers returned',
    async () => {
      await runScenario('repeated-serial.pdf', 'duplicate-serial', async (token, sessionId, proc) => {
        expect(proc.status).toBe(201);
        expect(proc.body.watchCount).toBe(2);

        const ext = await getExtraction(token, sessionId);
        expect(ext.status).toBe(200);
        const watches = (ext.body.extraction as { watches: Array<{ serialNumber: string }> }).watches;
        expect(watches).toHaveLength(2);
        expect(watches[0].serialNumber).toBe(watches[1].serialNumber);
        expect(watches[0].serialNumber).toBe('DUPLICATE-001');
      });
    },
    timeout,
  );

  it(
    'H — accessory lines excluded (1 watch extracted)',
    async () => {
      await runScenario('accessory-and-watch-lines.pdf', 'accessory-lines', async (token, sessionId, proc) => {
        expect(proc.status).toBe(201);
        expect(proc.body.watchCount).toBe(1);

        const ext = await getExtraction(token, sessionId);
        expect(ext.status).toBe(200);
        const watches = (ext.body.extraction as { watches: Array<{ brand: string }> }).watches;
        expect(watches).toHaveLength(1);
        expect(watches[0].brand).toBe('Rolex');
      });
    },
    timeout,
  );

  it(
    'I — prompt-injection text ignored (1 watch extracted)',
    async () => {
      await runScenario('prompt-injection-invoice.pdf', 'prompt-injection', async (token, sessionId, proc) => {
        expect(proc.status).toBe(201);
        expect(proc.body.watchCount).toBe(1);

        const ext = await getExtraction(token, sessionId);
        expect(ext.status).toBe(200);
        const watches = (ext.body.extraction as { watches: Array<{ brand: string; serialNumber: string }> }).watches;
        expect(watches).toHaveLength(1);
        expect(watches[0].brand).toBe('Omega');
        expect(watches[0].serialNumber).toBe('LEGIT-SN-001');
      });
    },
    timeout,
  );

  it(
    'J — extraction error: output truncated (422 + EXTRACTION_OUTPUT_TRUNCATED)',
    async () => {
      await runScenario('single-watch-digital.pdf', 'truncated', async (token, sessionId, proc) => {
        expect(proc.status).toBe(422);

        const ext = await getExtraction(token, sessionId);
        expect(ext.status).toBe(200);
        expect(ext.body.extractionState).toBe('failed');
        const parsed = JSON.parse(ext.body.extractionError as string) as { code: string; category: string };
        expect(parsed.code).toBe('EXTRACTION_OUTPUT_TRUNCATED');
        expect(parsed.category).toBe('capacity');
      });
    },
    timeout,
  );
});
