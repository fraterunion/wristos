import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DataImportStatus, DataImportTarget } from '@prisma/client';

import { PdfSalesImportService } from './pdf-sales-import.service';

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
