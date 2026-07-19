/**
 * Contract tests for PdfInvoiceImportService.
 *
 * Uses an in-memory Prisma stub (same pattern as watch-import.service.integration.spec.ts)
 * and the FakeExtractionProvider so no real DB or AI calls are made.
 */
import { ConflictException, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { DataImportEntityType, DataImportEventType, DataImportFileStatus, DataImportFileType, DataImportStatus } from '@prisma/client';

import { FakeExtractionProvider } from './providers/fake-extraction.provider';
import { PdfInvoiceImportService } from './pdf-invoice-import.service';

// ─── Real PDF buffers generated once per test run ────────────────────────────
// pdf-lib is now the inspection engine; tests need real PDFs, not fake byte strings.
// pdf-lib v1 cannot CREATE encrypted PDFs, so we craft the encrypted one from raw bytes.

let realPdfBuffer: Buffer;
let encryptedPdfBuffer: Buffer;

function buildMinimalEncryptedPdf(): Buffer {
  const obj1 = '1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n';
  const obj2 = '2 0 obj\n<</Type /Pages /Kids [] /Count 0>>\nendobj\n';
  const obj3 = '3 0 obj\n<</Filter /Standard>>\nendobj\n';
  const header = '%PDF-1.4\n';
  const off1 = header.length;
  const off2 = off1 + obj1.length;
  const off3 = off2 + obj2.length;
  const xrefOffset = off3 + obj3.length;
  const pad = (n: number) => n.toString().padStart(10, '0');
  const xref = `xref\n0 4\n0000000000 65535 f\r\n${pad(off1)} 00000 n\r\n${pad(off2)} 00000 n\r\n${pad(off3)} 00000 n\r\n`;
  const trailer = `trailer\n<</Size 4 /Root 1 0 R /Encrypt 3 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(header + obj1 + obj2 + obj3 + xref + trailer);
}

beforeAll(async () => {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage();
  realPdfBuffer = Buffer.from(await doc.save());
  encryptedPdfBuffer = buildMinimalEncryptedPdf();
});

// ─── Minimal in-memory fakes ──────────────────────────────────────────────────

let idSeq = 0;
function nextId() { return `id-${++idSeq}`; }

function makeSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: nextId(),
    tenantId: 'tenant-1',
    status: DataImportStatus.UPLOADING,
    totalFiles: 1,
    processedFiles: 0,
    totalRows: 0,
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
    ...overrides,
  };
}

function makePdfFile(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: nextId(),
    tenantId: 'tenant-1',
    sessionId: 'session-1',
    fileType: DataImportFileType.PDF,
    storageKey: 'test/key.pdf',
    originalFilename: 'invoice.pdf',
    mimeType: 'application/pdf',
    byteSize: 12345,
    status: DataImportFileStatus.UPLOADED,
    detectedEntityType: DataImportEntityType.UNKNOWN,
    rowCount: 0,
    extractionProvider: null,
    extractionModel: null,
    extractedDocumentData: null,
    extractionError: null,
    fieldMapping: null,
    mappingVersion: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePrismaStub(session: ReturnType<typeof makeSession>, pdfFile: ReturnType<typeof makePdfFile>) {
  const sessions = [session];
  const files = [pdfFile];
  const records: unknown[] = [];
  const events: unknown[] = [];
  const deleteMany = jest.fn(async () => ({ count: 0 }));

  return {
    _sessions: sessions,
    _files: files,
    _records: records,
    _events: events,

    dataImportSession: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        sessions.find((s) => s.id === where.id && s.tenantId === where.tenantId) ?? null,
      ),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const matched = sessions.filter((s) =>
          s.id === where.id &&
          s.tenantId === where.tenantId &&
          (where.status == null || (where.status as Record<string, unknown>).in == null
            ? s.status === where.status
            : ((where.status as Record<string, string[]>).in).includes(s.status as string)),
        );
        matched.forEach((s) => Object.assign(s, data));
        return { count: matched.length };
      }),
      update: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const s = sessions.find((x) => x.id === where.id);
        if (s) Object.assign(s, data);
        return s;
      }),
    },

    dataImportFile: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        files.find((f) =>
          (!where.tenantId || f.tenantId === where.tenantId) &&
          (!where.sessionId || f.sessionId === where.sessionId) &&
          (!where.fileType || f.fileType === where.fileType),
        ) ?? null,
      ),
      update: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const f = files.find((x) => x.id === where.id);
        if (f) Object.assign(f, data);
        return f;
      }),
    },

    dataImportRecord: {
      deleteMany,
      createMany: jest.fn(async ({ data }: { data: unknown[] }) => {
        records.push(...data);
        return { count: data.length };
      }),
    },

    dataImportEvent: {
      create: jest.fn(async ({ data }: { data: unknown }) => {
        events.push(data);
        return data;
      }),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        (events as Array<Record<string, unknown>>).find((e) =>
          (!where.tenantId || e.tenantId === where.tenantId) &&
          (!where.sessionId || e.sessionId === where.sessionId) &&
          (!where.eventType || e.eventType === where.eventType),
        ) ?? null,
      ),
    },

    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({
      dataImportRecord: {
        deleteMany,
        createMany: jest.fn(async ({ data }: { data: unknown[] }) => {
          records.push(...data);
          return { count: data.length };
        }),
      },
      dataImportFile: {
        update: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const f = files.find((x) => x.id === where.id);
          if (f) Object.assign(f, data);
          return f;
        }),
      },
      dataImportSession: {
        update: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const s = sessions.find((x) => x.id === where.id);
          if (s) Object.assign(s, data);
          return s;
        }),
      },
    })),
  };
}

function makeStorageStub() {
  return {
    // Use a real pdf-lib PDF so inspectPdf (now async/pdf-lib backed) passes inspection.
    read: jest.fn(async () => realPdfBuffer),
    save: jest.fn(),
    delete: jest.fn(),
    deleteSessionFiles: jest.fn(),
  };
}

// ─── Service factory ──────────────────────────────────────────────────────────

const USE_FAKE = Symbol('USE_FAKE');

function makeService(
  session: ReturnType<typeof makeSession>,
  pdfFile: ReturnType<typeof makePdfFile>,
  providerOverride: unknown = USE_FAKE,
) {
  const prisma = makePrismaStub(session, pdfFile);
  const storage = makeStorageStub();
  const provider = (providerOverride === USE_FAKE ? new FakeExtractionProvider() : providerOverride) as unknown;

  // Bypass NestJS DI: inject manually via the private field
  const service = new PdfInvoiceImportService(prisma as never, undefined as never);
  (service as unknown as Record<string, unknown>).storage = storage;
  (service as unknown as Record<string, unknown>).provider = provider;

  return { service, prisma, storage };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PdfInvoiceImportService.processDocument', () => {
  beforeEach(() => { idSeq = 0; });

  it('stages extracted watches as DataImportRecords and transitions session to READY_FOR_REVIEW', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.UPLOADING });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service, prisma } = makeService(session, file);

    const result = await service.processDocument('tenant-1', 'session-1');

    expect(result.watchCount).toBe(1);
    expect(prisma._records).toHaveLength(1);
    expect(session.status).toBe(DataImportStatus.READY_FOR_REVIEW);
  });

  it('rejects when session is in COMPLETED state', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.COMPLETED });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service } = makeService(session, file);

    await expect(service.processDocument('tenant-1', 'session-1'))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects when session not found', async () => {
    const session = makeSession({ id: 'other-session', status: DataImportStatus.UPLOADING });
    const file = makePdfFile({ sessionId: 'other-session' });
    const { service } = makeService(session, file);

    await expect(service.processDocument('tenant-1', 'session-1'))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 503 when provider is not configured (null)', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.UPLOADING });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service } = makeService(session, file, null);

    await expect(service.processDocument('tenant-1', 'session-1'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects when no PDF file is present in the session', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.UPLOADING });
    // Make the file a CSV to trigger the "no PDF file" path
    const csvFile = makePdfFile({ sessionId: 'session-1', fileType: DataImportFileType.CSV } as never);
    const { service } = makeService(session, csvFile);

    await expect(service.processDocument('tenant-1', 'session-1'))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('logs DOCUMENT_EXTRACTION_STARTED and DOCUMENT_EXTRACTION_COMPLETED events', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.UPLOADING });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service, prisma } = makeService(session, file);

    await service.processDocument('tenant-1', 'session-1');

    const eventTypes = (prisma._events as Array<{ eventType: string }>).map((e) => e.eventType);
    expect(eventTypes).toContain(DataImportEventType.DOCUMENT_EXTRACTION_STARTED);
    expect(eventTypes).toContain(DataImportEventType.DOCUMENT_EXTRACTION_COMPLETED);
  });

  it('stores provider and model name on the file after extraction', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.UPLOADING });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service } = makeService(session, file);

    await service.processDocument('tenant-1', 'session-1');

    expect(file.extractionProvider).toBe('fake');
    expect(file.extractionModel).toBe('fake-v1');
  });

  it('stores extracted document data on the file', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.UPLOADING });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service } = makeService(session, file);

    await service.processDocument('tenant-1', 'session-1');

    expect(file.extractedDocumentData).not.toBeNull();
    const data = file.extractedDocumentData as unknown as Record<string, unknown>;
    expect(data.watches).toBeDefined();
    expect(Array.isArray(data.watches)).toBe(true);
  });

  it('sets file status to PARSED after successful extraction', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.UPLOADING });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service } = makeService(session, file);

    await service.processDocument('tenant-1', 'session-1');

    expect(file.status).toBe(DataImportFileStatus.PARSED);
  });

  it('handles extraction error — sets session to FAILED and logs event', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.UPLOADING });
    const file = makePdfFile({ sessionId: 'session-1' });

    const errorProvider = { providerName: 'fake', modelId: 'fake-v1', extractInventoryInvoice: jest.fn(async () => { throw new Error('AI timeout'); }) };
    const { service, prisma } = makeService(session, file, errorProvider);

    await expect(service.processDocument('tenant-1', 'session-1'))
      .rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(session.status).toBe(DataImportStatus.FAILED);
    const eventTypes = (prisma._events as Array<{ eventType: string }>).map((e) => e.eventType);
    expect(eventTypes).toContain(DataImportEventType.DOCUMENT_EXTRACTION_FAILED);
    // F-02: error is sanitized — raw message must not appear in the stored record
    const safeRecord = JSON.parse(file.extractionError as unknown as string) as { code: string; safeMessage: string };
    expect(safeRecord.code).toBe('EXTRACTION_PROVIDER_ERROR');
    expect(safeRecord.safeMessage).not.toContain('AI timeout');
  });

  it('re-extraction (FAILED → UPLOADING) clears prior records and extracts again', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.FAILED });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service, prisma } = makeService(session, file);

    await service.processDocument('tenant-1', 'session-1');

    expect(prisma.dataImportRecord.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ sessionId: 'session-1' }) }),
    );
    expect(prisma._records).toHaveLength(1);
  });

  it('is tenant-isolated: cannot process a session from another tenant', async () => {
    const session = makeSession({ id: 'session-1', tenantId: 'tenant-X', status: DataImportStatus.UPLOADING });
    const file = makePdfFile({ sessionId: 'session-1', tenantId: 'tenant-X' });
    const { service } = makeService(session, file);

    await expect(service.processDocument('tenant-OTHER', 'session-1'))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PdfInvoiceImportService.getExtraction', () => {
  beforeEach(() => { idSeq = 0; });

  it('returns extraction data after a successful processDocument', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.UPLOADING });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service } = makeService(session, file);

    await service.processDocument('tenant-1', 'session-1');

    const resp = await service.getExtraction('tenant-1', 'session-1');
    expect(resp.extraction).not.toBeNull();
    expect(resp.extraction?.watches).toHaveLength(1);
    expect(resp.watchCount).toBe(1);
  });

  it('returns null extraction when PDF has not been processed yet', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.UPLOADING });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service } = makeService(session, file);

    const resp = await service.getExtraction('tenant-1', 'session-1');
    expect(resp.extraction).toBeNull();
  });
});

describe('PdfInvoiceImportService.updateExtraction', () => {
  beforeEach(() => { idSeq = 0; });

  it('updates extraction data and re-stages records', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.UPLOADING });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service, prisma } = makeService(session, file);

    await service.processDocument('tenant-1', 'session-1');
    // Session is now READY_FOR_REVIEW

    const updatedExtraction = {
      invoice: { supplierName: 'Edited Supplier' },
      watches: [
        { brand: 'Omega', model: 'Speedmaster', purchasePrice: 80000 },
        { brand: 'Patek', model: 'Nautilus', purchasePrice: 900000 },
      ],
      extractionVersion: 'v1',
    };

    const result = await service.updateExtraction('tenant-1', 'session-1', updatedExtraction);

    expect(result.watchCount).toBe(2);
    // Existing records deleted then new ones created
    expect(prisma.dataImportRecord.deleteMany).toHaveBeenCalledTimes(2);
    // dryRunVersion was cleared
    expect(session.dryRunVersion).toBeNull();
    // Event logged
    const eventTypes = (prisma._events as Array<{ eventType: string }>).map((e) => e.eventType);
    expect(eventTypes).toContain(DataImportEventType.DOCUMENT_EXTRACTION_EDITED);
  });

  it('rejects updateExtraction when session is not READY_FOR_REVIEW', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.UPLOADING });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service } = makeService(session, file);

    await expect(service.updateExtraction('tenant-1', 'session-1', {
      invoice: {},
      watches: [],
      extractionVersion: 'v1',
    })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('PdfInvoiceImportService.processDocument (stale recovery, F-06)', () => {
  beforeEach(() => { idSeq = 0; });

  it('resets a stale PROCESSING session and completes extraction', async () => {
    const staleStart = new Date(Date.now() - 20 * 60 * 1000); // 20 minutes ago
    const session = makeSession({ id: 'session-1', status: DataImportStatus.PROCESSING, startedAt: staleStart });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service, prisma } = makeService(session, file);

    await service.processDocument('tenant-1', 'session-1');

    // Session should end READY_FOR_REVIEW after recovery + re-extraction
    expect(session.status).toBe(DataImportStatus.READY_FOR_REVIEW);
    // First updateMany targets PROCESSING → FAILED (the stale recovery call)
    const firstCall = (prisma.dataImportSession.updateMany as jest.Mock).mock.calls[0][0];
    expect(firstCall.where.status).toBe(DataImportStatus.PROCESSING);
    expect(firstCall.data.status).toBe(DataImportStatus.FAILED);
  });
});

describe('PdfInvoiceImportService.reprocessDocument (F-05)', () => {
  beforeEach(() => { idSeq = 0; });

  it('succeeds when no manual edit event exists', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.READY_FOR_REVIEW });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service } = makeService(session, file);

    const result = await service.reprocessDocument('tenant-1', 'session-1');
    expect(result.watchCount).toBe(1);
  });

  it('throws ConflictException with MANUAL_EDITS_WOULD_BE_DISCARDED when an edit event exists', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.READY_FOR_REVIEW });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service, prisma } = makeService(session, file);

    (prisma._events as Record<string, unknown>[]).push({
      tenantId: 'tenant-1',
      sessionId: 'session-1',
      eventType: DataImportEventType.DOCUMENT_EXTRACTION_EDITED,
    });

    const caught = await service.reprocessDocument('tenant-1', 'session-1').catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ConflictException);
    const response = (caught as ConflictException).getResponse() as { code: string };
    expect(response.code).toBe('MANUAL_EDITS_WOULD_BE_DISCARDED');
  });

  it('skips the guard and succeeds when confirmDiscardEdits is true', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.READY_FOR_REVIEW });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service, prisma } = makeService(session, file);

    (prisma._events as Record<string, unknown>[]).push({
      tenantId: 'tenant-1',
      sessionId: 'session-1',
      eventType: DataImportEventType.DOCUMENT_EXTRACTION_EDITED,
    });

    const result = await service.reprocessDocument('tenant-1', 'session-1', { confirmDiscardEdits: true });
    expect(result.watchCount).toBe(1);
  });
});

describe('PdfInvoiceImportService.getExtraction (state machine, M-03)', () => {
  beforeEach(() => { idSeq = 0; });

  it('returns not_processed when no extraction data and no error are stored', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.UPLOADING });
    const file = makePdfFile({ sessionId: 'session-1', extractedDocumentData: null, extractionError: null });
    const { service } = makeService(session, file);

    const resp = await service.getExtraction('tenant-1', 'session-1');
    expect(resp.extractionState).toBe('not_processed');
    expect(resp.extraction).toBeNull();
  });

  it('returns processing without touching the file when session is PROCESSING', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.PROCESSING });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service, prisma } = makeService(session, file);

    const resp = await service.getExtraction('tenant-1', 'session-1');
    expect(resp.extractionState).toBe('processing');
    expect(prisma.dataImportFile.findFirst).not.toHaveBeenCalled();
  });

  it('returns ready with full extraction after a successful processDocument', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.UPLOADING });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service } = makeService(session, file);

    await service.processDocument('tenant-1', 'session-1');
    const resp = await service.getExtraction('tenant-1', 'session-1');
    expect(resp.extractionState).toBe('ready');
    expect(resp.extraction).not.toBeNull();
  });

  it('returns failed when extractionError is set but no document data', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.FAILED });
    const file = makePdfFile({
      sessionId: 'session-1',
      extractedDocumentData: null,
      extractionError: JSON.stringify({ code: 'EXTRACTION_TIMEOUT', safeMessage: 'Timeout' }),
    });
    const { service } = makeService(session, file);

    const resp = await service.getExtraction('tenant-1', 'session-1');
    expect(resp.extractionState).toBe('failed');
    expect(resp.extraction).toBeNull();
  });

  it('returns corrupt when stored data fails schema validation', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.READY_FOR_REVIEW });
    const file = makePdfFile({
      sessionId: 'session-1',
      // 'watches' must be an array; a string causes schema failure
      extractedDocumentData: { watches: 'not-an-array', extractionVersion: 'v1' },
    });
    const { service } = makeService(session, file);

    const resp = await service.getExtraction('tenant-1', 'session-1');
    expect(resp.extractionState).toBe('corrupt');
    expect(resp.extraction).toBeNull();
  });
});

describe('PdfInvoiceImportService.processDocument (PDF inspection, L-02)', () => {
  beforeEach(() => { idSeq = 0; });

  it('sets session FAILED with ENCRYPTED error message for a real password-protected PDF', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.UPLOADING });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service, storage } = makeService(session, file);

    // Real encrypted PDF generated by pdf-lib in beforeAll
    (storage.read as jest.Mock).mockResolvedValue(encryptedPdfBuffer);

    await expect(service.processDocument('tenant-1', 'session-1'))
      .rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(session.status).toBe(DataImportStatus.FAILED);
    const stored = JSON.parse(file.extractionError as unknown as string) as { code: string };
    expect(stored.code).toBe('EXTRACTION_PDF_ENCRYPTED');
  });

  it('sets session FAILED with CORRUPT error message for a non-PDF buffer', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.UPLOADING });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service, storage } = makeService(session, file);

    // No magic bytes → sniffPdf() catches it without even calling pdf-lib
    (storage.read as jest.Mock).mockResolvedValue(Buffer.from('NOT A PDF'));

    await expect(service.processDocument('tenant-1', 'session-1'))
      .rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(session.status).toBe(DataImportStatus.FAILED);
    const stored = JSON.parse(file.extractionError as unknown as string) as { code: string };
    expect(stored.code).toBe('EXTRACTION_PDF_CORRUPT');
  });

  it('allows through a valid real PDF (pdf-lib parses successfully)', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.UPLOADING });
    const file = makePdfFile({ sessionId: 'session-1' });
    const { service } = makeService(session, file);

    // Default storage stub already returns realPdfBuffer — no mock override needed
    const result = await service.processDocument('tenant-1', 'session-1');
    expect(result.watchCount).toBe(1);
    expect(session.status).toBe(DataImportStatus.READY_FOR_REVIEW);
  });
});

describe('PdfInvoiceImportService.processDocument (H-02: OUTPUT_TRUNCATED)', () => {
  beforeEach(() => { idSeq = 0; });

  it('sets session FAILED when provider throws OUTPUT_TRUNCATED (H-02)', async () => {
    const session = makeSession({ id: 'session-1', status: DataImportStatus.UPLOADING });
    const file = makePdfFile({ sessionId: 'session-1' });

    const { ExtractionError, ExtractionErrorCode } = await import('./providers/extraction-errors');
    const truncatedProvider = {
      providerName: 'fake',
      modelId: 'fake-v1',
      extractInventoryInvoice: jest.fn(async () => {
        throw new ExtractionError(
          ExtractionErrorCode.OUTPUT_TRUNCATED,
          'No se pudo completar la extracción porque la factura contiene demasiada información.',
        );
      }),
    };
    const { service } = makeService(session, file, truncatedProvider);

    await expect(service.processDocument('tenant-1', 'session-1'))
      .rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(session.status).toBe(DataImportStatus.FAILED);
    const stored = JSON.parse(file.extractionError as unknown as string) as { code: string; category: string };
    expect(stored.code).toBe('EXTRACTION_OUTPUT_TRUNCATED');
    expect(stored.category).toBe('capacity');
  });
});
