import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  DataImportEntityType,
  DataImportEventType,
  DataImportFileStatus,
  DataImportFileType,
  DataImportStatus,
  DataImportTarget,
} from '@prisma/client';

import { PdfSalesImportService } from './pdf-sales-import.service';
import {
  IMPORT_STORAGE_ERROR_CODE,
  IMPORT_STORAGE_READ_SAFE_MESSAGE,
  ImportStorageError,
} from './storage/import-storage.errors';

describe('PdfSalesImportService.requireSalesSession', () => {
  function makeService(session: Record<string, unknown> | null) {
    const prisma = {
      dataImportSession: {
        findFirst: jest.fn(async () => session),
      },
    };
    const storage = { read: jest.fn() };
    return new PdfSalesImportService(prisma as never, storage as never);
  }

  it('hard-requires importTarget=SALES (title VENTAS does not bypass)', async () => {
    const service = makeService({
      id: 'sess-1',
      tenantId: 't1',
      importTarget: DataImportTarget.INVENTORY,
      title: 'Importación VENTAS históricas',
      status: DataImportStatus.READY_FOR_REVIEW,
    });

    await expect(
      (service as unknown as { requireSalesSession: (a: string, b: string) => Promise<unknown> }).requireSalesSession(
        't1',
        'sess-1',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('accepts sessions with importTarget=SALES', async () => {
    const session = {
      id: 'sess-2',
      tenantId: 't1',
      importTarget: DataImportTarget.SALES,
      title: 'Anything',
      status: DataImportStatus.READY_FOR_REVIEW,
    };
    const service = makeService(session);

    await expect(
      (service as unknown as { requireSalesSession: (a: string, b: string) => Promise<unknown> }).requireSalesSession(
        't1',
        'sess-2',
      ),
    ).resolves.toMatchObject({ id: 'sess-2', importTarget: DataImportTarget.SALES });
  });

  it('throws NotFound when session is missing', async () => {
    const service = makeService(null);
    await expect(
      (service as unknown as { requireSalesSession: (a: string, b: string) => Promise<unknown> }).requireSalesSession(
        't1',
        'missing',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PdfSalesImportService storage failure classification', () => {
  it('persists IMPORT_STORAGE_ERROR when Cloudinary read fails (not EXTRACTION_PROVIDER_ERROR)', async () => {
    let sessionStatus: DataImportStatus = DataImportStatus.UPLOADING;
    let extractionError: string | null = null;
    const events: Array<{ eventType: string }> = [];
    const extractHistoricalSales = jest.fn();

    const prismaStub = {
      dataImportSession: {
        findFirst: jest.fn(async () => ({
          id: 'sess-sales',
          tenantId: 't1',
          importTarget: DataImportTarget.SALES,
          status: sessionStatus,
          errorMessage: null,
        })),
        updateMany: jest.fn(async ({ where, data }: {
          where: { status?: DataImportStatus | { in?: DataImportStatus[] }; startedAt?: unknown };
          data: { status?: DataImportStatus };
        }) => {
          const statusFilter = where.status;
          if (statusFilter === DataImportStatus.PROCESSING) {
            // stale recovery path — only match when currently PROCESSING
            if (sessionStatus !== DataImportStatus.PROCESSING) return { count: 0 };
            if (data.status) sessionStatus = data.status;
            return { count: 1 };
          }
          if (statusFilter && typeof statusFilter === 'object' && Array.isArray(statusFilter.in)) {
            if (!statusFilter.in.includes(sessionStatus)) return { count: 0 };
          }
          if (data.status) sessionStatus = data.status;
          return { count: 1 };
        }),
        update: jest.fn(async ({ data }: { data: { status?: DataImportStatus; errorMessage?: string } }) => {
          if (data.status) sessionStatus = data.status;
          return { id: 'sess-sales', ...data };
        }),
      },
      dataImportFile: {
        findFirst: jest.fn(async () => ({
          id: 'file-1',
          tenantId: 't1',
          sessionId: 'sess-sales',
          fileType: DataImportFileType.PDF,
          storageKey: 'cloudinary:wristos/imports/t1/sess-sales/x.pdf',
          status: DataImportFileStatus.UPLOADED,
          extractionError,
          detectedEntityType: DataImportEntityType.UNKNOWN,
        })),
        update: jest.fn(async ({ data }: { data: { extractionError?: string | null; status?: DataImportFileStatus } }) => {
          if ('extractionError' in data) extractionError = data.extractionError ?? null;
          return data;
        }),
      },
      dataImportEvent: {
        create: jest.fn(async ({ data }: { data: { eventType: string } }) => {
          events.push(data);
          return data;
        }),
      },
      dataImportRecord: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
        createMany: jest.fn(async () => ({ count: 0 })),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    };

    const storage = {
      read: jest.fn(async () => {
        throw new ImportStorageError(IMPORT_STORAGE_READ_SAFE_MESSAGE, { httpStatus: 401 });
      }),
    };

    const service = new PdfSalesImportService(prismaStub as never, storage as never);
    (service as unknown as { provider: unknown }).provider = {
      providerName: 'claude',
      modelId: 'claude-test',
      extractHistoricalSales,
    };

    await expect(service.processDocument('t1', 'sess-sales')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );

    const stored = JSON.parse(String(extractionError)) as {
      code: string;
      category: string;
      safeMessage: string;
    };
    expect(stored.code).toBe(IMPORT_STORAGE_ERROR_CODE);
    expect(stored.category).toBe('storage');
    expect(stored.safeMessage).toBe(IMPORT_STORAGE_READ_SAFE_MESSAGE);
    expect(events.some((e) => e.eventType === DataImportEventType.SALES_EXTRACTION_FAILED)).toBe(true);
    expect(storage.read).toHaveBeenCalled();
    expect(extractHistoricalSales).not.toHaveBeenCalled();
  });
});
