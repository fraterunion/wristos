/**
 * Local end-to-end test for the AI PDF Invoice Importer.
 *
 * Boots a minimal NestJS HTTP server with:
 *   DOCUMENT_EXTRACTION_PROVIDER=fake  → real FakeExtractionProvider (no Anthropic calls)
 *   Real Prisma                         → DATABASE_URL from ../../.env
 *   Real LocalImportFileStorage         → tmp dir (cleaned up after run)
 *   Real inspectPdf (pdf-lib)           → binary fixtures in test-fixtures/
 *
 * Run from apps/api:
 *   npx ts-node --project tsconfig.json scripts/run-e2e-pdf-scenarios.ts
 *
 * Scenarios A–J:
 *   A  single watch happy path
 *   B  multi-watch invoice (3 watches)
 *   C  no-watch invoice (0 watches)
 *   D  encrypted PDF rejected before AI call
 *   E  corrupt PDF rejected before AI call
 *   F  invoice total not per-watch (purchasePrice absent on watches)
 *   G  duplicate serial numbers returned
 *   H  accessory lines excluded (1 watch extracted)
 *   I  prompt-injection text ignored (1 watch)
 *   J  extraction error — output truncated (422 + error code)
 */

import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load root .env for DATABASE_URL before NestJS module compilation.
// dotenv won't override vars that are already set, so our overrides below are safe.
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

import * as os from 'os';
import * as fs from 'fs';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import request from 'supertest';
import * as jwt from 'jsonwebtoken';

// Import DataOnboardingController FIRST among data-onboarding modules.
//
// Reason: DataOnboardingController imports IMPORT_FILE_STORAGE from
// data-onboarding.module, and data-onboarding.module imports the controller —
// a circular dependency. When the controller is required first, Node.js loads
// data-onboarding.module to completion (exporting IMPORT_FILE_STORAGE) before
// the controller's @Inject decorator evaluates. Any other order causes the
// controller's @Inject to receive `undefined` (partial export snapshot).
import { DataOnboardingController } from '../src/modules/data-onboarding/data-onboarding.controller';
import { PrismaModule } from '../src/prisma/prisma.module';
import { JwtStrategy } from '../src/modules/core/auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../src/modules/core/auth/guards/jwt-auth.guard';
import { FxService } from '../src/modules/fx/fx.service';
import { DataOnboardingService } from '../src/modules/data-onboarding/data-onboarding.service';
import { WatchImportService } from '../src/modules/data-onboarding/inventory-import/watch-import.service';
import { PdfInvoiceImportService } from '../src/modules/data-onboarding/pdf-invoice-import.service';
import { LocalImportFileStorage } from '../src/modules/data-onboarding/storage/local-import-file.storage';

const IMPORT_FILE_STORAGE = 'IMPORT_FILE_STORAGE';

// ─── Constants ────────────────────────────────────────────────────────────────

const E2E_JWT_SECRET = 'e2e-test-secret-do-not-use-in-prod';
const E2E_TENANT_ID = `e2e-test-${Date.now()}`;
const FIXTURES_DIR = path.join(
  __dirname, '..', 'src', 'modules', 'data-onboarding', 'test-fixtures',
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function setFakeScenario(scenario: string | undefined): void {
  if (scenario) {
    process.env.DOCUMENT_EXTRACTION_FAKE_SCENARIO = scenario;
  } else {
    delete process.env.DOCUMENT_EXTRACTION_FAKE_SCENARIO;
  }
}

// ─── App bootstrap ────────────────────────────────────────────────────────────

async function buildApp(storagePath: string): Promise<INestApplication> {
  // Set BEFORE module compilation — DI constructors read these at instantiation time
  process.env.NODE_ENV = 'test';
  process.env.DOCUMENT_EXTRACTION_PROVIDER = 'fake';
  process.env.JWT_SECRET = E2E_JWT_SECRET;

  const storage = new LocalImportFileStorage(storagePath);

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      PrismaModule,
      PassportModule.register({ defaultStrategy: 'jwt' }),
    ],
    controllers: [DataOnboardingController],
    providers: [
      JwtStrategy,
      JwtAuthGuard,
      FxService,
      DataOnboardingService,
      WatchImportService,
      PdfInvoiceImportService,
      { provide: IMPORT_FILE_STORAGE, useValue: storage },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

// ─── HTTP wrappers ────────────────────────────────────────────────────────────

type HttpResult = { status: number; body: Record<string, unknown> };

async function createSession(srv: ReturnType<INestApplication['getHttpServer']>, token: string): Promise<string> {
  const res = await request(srv)
    .post('/api/data-onboarding/sessions')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'e2e-test' });
  if (res.status !== 201) throw new Error(`createSession HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  return (res.body as { id: string }).id;
}

async function uploadPdf(
  srv: ReturnType<INestApplication['getHttpServer']>,
  token: string,
  sessionId: string,
  filename: string,
  buf: Buffer,
): Promise<void> {
  const res = await request(srv)
    .post(`/api/data-onboarding/sessions/${sessionId}/files`)
    .set('Authorization', `Bearer ${token}`)
    .attach('file', buf, { filename, contentType: 'application/pdf' });
  if (res.status !== 201) throw new Error(`uploadPdf HTTP ${res.status}: ${JSON.stringify(res.body)}`);
}

async function processDocument(
  srv: ReturnType<INestApplication['getHttpServer']>,
  token: string,
  sessionId: string,
): Promise<HttpResult> {
  const res = await request(srv)
    .post(`/api/data-onboarding/sessions/${sessionId}/process-document`)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body as Record<string, unknown> };
}

async function getExtraction(
  srv: ReturnType<INestApplication['getHttpServer']>,
  token: string,
  sessionId: string,
): Promise<HttpResult> {
  const res = await request(srv)
    .get(`/api/data-onboarding/sessions/${sessionId}/document-extraction`)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body as Record<string, unknown> };
}

async function deleteSession(
  srv: ReturnType<INestApplication['getHttpServer']>,
  token: string,
  sessionId: string,
): Promise<void> {
  await request(srv)
    .delete(`/api/data-onboarding/sessions/${sessionId}`)
    .set('Authorization', `Bearer ${token}`);
}

// ─── Result tracking ──────────────────────────────────────────────────────────

type Result = { label: string; pass: boolean; note: string };
const results: Result[] = [];

function pass(label: string, note = ''): void {
  results.push({ label, pass: true, note });
  console.log(`  ✓  ${label}${note ? '  (' + note + ')' : ''}`);
}

function fail(label: string, note: string): void {
  results.push({ label, pass: false, note });
  console.error(`  ✗  ${label}  — ${note}`);
}

// ─── Scenario runner ──────────────────────────────────────────────────────────

type ScenarioDef = {
  label: string;
  fixtureName: string;
  fakeScenario?: string;
  verify: (proc: HttpResult, ext: HttpResult) => void;
};

async function runScenario(
  srv: ReturnType<INestApplication['getHttpServer']>,
  token: string,
  def: ScenarioDef,
): Promise<void> {
  let sessionId: string | undefined;
  try {
    sessionId = await createSession(srv, token);
    await uploadPdf(srv, token, sessionId, def.fixtureName, loadFixture(def.fixtureName));
    setFakeScenario(def.fakeScenario);
    const proc = await processDocument(srv, token, sessionId);
    const ext = await getExtraction(srv, token, sessionId);
    def.verify(proc, ext);
  } catch (err) {
    fail(def.label, err instanceof Error ? err.message : String(err));
  } finally {
    setFakeScenario(undefined);
    if (sessionId) {
      await deleteSession(srv, token, sessionId).catch(() => undefined);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  WristOS · AI PDF Importer · Local E2E Test (Fake Provider)');
  console.log(`  Tenant:  ${E2E_TENANT_ID}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wristos-e2e-'));
  let app: INestApplication | undefined;

  try {
    process.stdout.write('Bootstrapping NestJS app… ');
    app = await buildApp(storageDir);
    console.log('ready.\n');
    const srv = app.getHttpServer();
    const token = makeToken();

    // ── Scenarios ────────────────────────────────────────────────────────────

    const scenarios: ScenarioDef[] = [
      {
        label: 'A  single-watch happy path',
        fixtureName: 'single-watch-digital.pdf',
        fakeScenario: 'single-watch',
        verify(proc, ext) {
          if (proc.status !== 201) { fail(this.label, `processDocument returned ${proc.status}`); return; }
          const wc = proc.body.watchCount as number;
          if (wc !== 1) { fail(this.label, `expected watchCount=1, got ${wc}`); return; }
          if (ext.status !== 200) { fail(this.label, `getExtraction returned ${ext.status}`); return; }
          if ((ext.body.extractionState as string) !== 'ready') { fail(this.label, `extractionState=${ext.body.extractionState}`); return; }
          pass(this.label, `watchCount=${wc} extractionState=ready`);
        },
      },
      {
        label: 'B  multi-watch invoice (3 watches)',
        fixtureName: 'multi-watch-digital.pdf',
        fakeScenario: 'multi-watch',
        verify(proc, ext) {
          if (proc.status !== 201) { fail(this.label, `processDocument returned ${proc.status}`); return; }
          const wc = proc.body.watchCount as number;
          if (wc !== 3) { fail(this.label, `expected watchCount=3, got ${wc}`); return; }
          if (ext.status !== 200) { fail(this.label, `getExtraction returned ${ext.status}`); return; }
          const watches = (ext.body.extraction as { watches?: unknown[] })?.watches;
          if (!watches || watches.length !== 3) { fail(this.label, `extraction.watches.length=${watches?.length}`); return; }
          pass(this.label, `watchCount=${wc} watches=[${(watches as Array<{ brand: string }>).map((w) => w.brand).join(', ')}]`);
        },
      },
      {
        label: 'C  no-watch invoice (0 watches)',
        fixtureName: 'no-watch-invoice.pdf',
        fakeScenario: 'no-watch',
        verify(proc, ext) {
          if (proc.status !== 201) { fail(this.label, `processDocument returned ${proc.status}`); return; }
          const wc = proc.body.watchCount as number;
          if (wc !== 0) { fail(this.label, `expected watchCount=0, got ${wc}`); return; }
          if (ext.status !== 200) { fail(this.label, `getExtraction returned ${ext.status}`); return; }
          const watches = (ext.body.extraction as { watches?: unknown[] })?.watches;
          if (!watches || watches.length !== 0) { fail(this.label, `extraction.watches.length=${watches?.length}`); return; }
          pass(this.label, `watchCount=0 watches=[]`);
        },
      },
      {
        label: 'D  encrypted PDF rejected before AI call',
        fixtureName: 'encrypted.pdf',
        verify(proc, ext) {
          if (proc.status !== 422) { fail(this.label, `expected 422, got ${proc.status}`); return; }
          if (ext.status !== 200) { fail(this.label, `getExtraction returned ${ext.status}`); return; }
          const errJson = ext.body.extractionError as string | null;
          if (!errJson) { fail(this.label, 'extractionError is null'); return; }
          let code = '';
          try { code = (JSON.parse(errJson) as { code: string }).code; } catch { /* ignore */ }
          if (code !== 'EXTRACTION_PDF_ENCRYPTED') { fail(this.label, `expected code=EXTRACTION_PDF_ENCRYPTED, got "${code}"`); return; }
          pass(this.label, `status=422 code=EXTRACTION_PDF_ENCRYPTED`);
        },
      },
      {
        label: 'E  corrupt PDF rejected before AI call',
        fixtureName: 'corrupt.pdf',
        verify(proc, ext) {
          if (proc.status !== 422) { fail(this.label, `expected 422, got ${proc.status}`); return; }
          if (ext.status !== 200) { fail(this.label, `getExtraction returned ${ext.status}`); return; }
          const errJson = ext.body.extractionError as string | null;
          if (!errJson) { fail(this.label, 'extractionError is null'); return; }
          let code = '';
          try { code = (JSON.parse(errJson) as { code: string }).code; } catch { /* ignore */ }
          if (code !== 'EXTRACTION_PDF_CORRUPT') { fail(this.label, `expected code=EXTRACTION_PDF_CORRUPT, got "${code}"`); return; }
          pass(this.label, `status=422 code=EXTRACTION_PDF_CORRUPT`);
        },
      },
      {
        label: 'F  invoice total not assigned per-watch',
        fixtureName: 'invoice-with-total-tax-shipping.pdf',
        fakeScenario: 'invoice-total-only',
        verify(proc, ext) {
          if (proc.status !== 201) { fail(this.label, `processDocument returned ${proc.status}`); return; }
          const wc = proc.body.watchCount as number;
          if (wc !== 2) { fail(this.label, `expected watchCount=2, got ${wc}`); return; }
          if (ext.status !== 200) { fail(this.label, `getExtraction returned ${ext.status}`); return; }
          const watches = (ext.body.extraction as { watches?: Array<{ purchasePrice?: number }> })?.watches;
          if (!watches || watches.length !== 2) { fail(this.label, `watches.length=${watches?.length}`); return; }
          // Neither watch should have a purchasePrice (invoice-total-only scenario omits per-watch prices)
          const hasPrices = watches.some((w) => w.purchasePrice !== undefined);
          if (hasPrices) { fail(this.label, 'some watches unexpectedly have purchasePrice'); return; }
          pass(this.label, `watchCount=2 no per-watch prices`);
        },
      },
      {
        label: 'G  duplicate serial numbers returned',
        fixtureName: 'repeated-serial.pdf',
        fakeScenario: 'duplicate-serial',
        verify(proc, ext) {
          if (proc.status !== 201) { fail(this.label, `processDocument returned ${proc.status}`); return; }
          const wc = proc.body.watchCount as number;
          if (wc !== 2) { fail(this.label, `expected watchCount=2, got ${wc}`); return; }
          if (ext.status !== 200) { fail(this.label, `getExtraction returned ${ext.status}`); return; }
          const watches = (ext.body.extraction as { watches?: Array<{ serialNumber?: string }> })?.watches;
          if (!watches || watches.length !== 2) { fail(this.label, `watches.length=${watches?.length}`); return; }
          const serials = watches.map((w) => w.serialNumber);
          if (serials[0] !== serials[1]) { fail(this.label, `serial[0]=${serials[0]} serial[1]=${serials[1]} (expected same)`); return; }
          pass(this.label, `watchCount=2 both serial=${serials[0]}`);
        },
      },
      {
        label: 'H  accessory lines excluded (1 watch)',
        fixtureName: 'accessory-and-watch-lines.pdf',
        fakeScenario: 'accessory-lines',
        verify(proc, ext) {
          if (proc.status !== 201) { fail(this.label, `processDocument returned ${proc.status}`); return; }
          const wc = proc.body.watchCount as number;
          if (wc !== 1) { fail(this.label, `expected watchCount=1, got ${wc}`); return; }
          if (ext.status !== 200) { fail(this.label, `getExtraction returned ${ext.status}`); return; }
          const watches = (ext.body.extraction as { watches?: Array<{ brand?: string }> })?.watches;
          if (!watches || watches.length !== 1) { fail(this.label, `watches.length=${watches?.length}`); return; }
          pass(this.label, `watchCount=1 brand=${watches[0].brand}`);
        },
      },
      {
        label: 'I  prompt-injection text ignored',
        fixtureName: 'prompt-injection-invoice.pdf',
        fakeScenario: 'prompt-injection',
        verify(proc, ext) {
          if (proc.status !== 201) { fail(this.label, `processDocument returned ${proc.status}`); return; }
          const wc = proc.body.watchCount as number;
          if (wc !== 1) { fail(this.label, `expected watchCount=1, got ${wc}`); return; }
          if (ext.status !== 200) { fail(this.label, `getExtraction returned ${ext.status}`); return; }
          const watches = (ext.body.extraction as { watches?: Array<{ brand?: string }> })?.watches;
          if (!watches || watches.length !== 1) { fail(this.label, `watches.length=${watches?.length}`); return; }
          // Injection would have produced empty array; real data = 1 watch
          pass(this.label, `watchCount=1 brand=${watches[0].brand} (injection ignored)`);
        },
      },
      {
        label: 'J  extraction error — output truncated (422)',
        fixtureName: 'single-watch-digital.pdf',
        fakeScenario: 'truncated',
        verify(proc, ext) {
          if (proc.status !== 422) { fail(this.label, `expected 422, got ${proc.status}`); return; }
          if (ext.status !== 200) { fail(this.label, `getExtraction returned ${ext.status}`); return; }
          const errJson = ext.body.extractionError as string | null;
          if (!errJson) { fail(this.label, 'extractionError is null'); return; }
          let code = '';
          try { code = (JSON.parse(errJson) as { code: string }).code; } catch { /* ignore */ }
          if (code !== 'EXTRACTION_OUTPUT_TRUNCATED') { fail(this.label, `expected code=EXTRACTION_OUTPUT_TRUNCATED, got "${code}"`); return; }
          pass(this.label, `status=422 code=EXTRACTION_OUTPUT_TRUNCATED`);
        },
      },
    ];

    for (const s of scenarios) {
      await runScenario(srv, token, s);
    }

  } catch (err) {
    console.error('\n✗ Fatal error during E2E run:', err);
    process.exitCode = 1;
  } finally {
    if (app) await app.close();
    try { fs.rmSync(storageDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  // ─── Summary ─────────────────────────────────────────────────────────────

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;

  console.log('\n───────────────────────────────────────────────────────────────');
  console.log(`  ${passed}/${results.length} scenarios passed  (${failed} failed)`);
  console.log('───────────────────────────────────────────────────────────────');

  for (const r of results) {
    const icon = r.pass ? '✓' : '✗';
    const note = r.note ? `  (${r.note})` : '';
    console.log(`  ${icon}  ${r.label}${note}`);
  }

  console.log('');

  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Unhandled:', err);
  process.exitCode = 1;
});
