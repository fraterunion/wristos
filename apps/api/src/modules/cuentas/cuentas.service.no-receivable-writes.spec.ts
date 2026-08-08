/**
 * Guardrail: operational deal sync must never touch Receivable / ReceivablePayment.
 * Canonical AR lives only on AccountEntry via CuentasService.syncDealReceivable.
 */
import { DealStage, Prisma } from '@prisma/client';
import { CuentasService } from './cuentas.service';

describe('legacy Receivable write guardrail', () => {
  it('syncDealReceivable only writes accountEntry — never receivable models', async () => {
    const receivable = {
      create: jest.fn(),
      upsert: jest.fn(),
      findFirst: jest.fn(),
    };
    const receivablePayment = {
      create: jest.fn(),
      upsert: jest.fn(),
    };
    const accountEntry = {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({
          id: 'ae1',
          dealId: 'deal-op',
          tenantId: 't1',
          totalAmount: new Prisma.Decimal(100),
          dueDate: null,
          status: 'OPEN',
        }),
      create: jest.fn(async () => ({ id: 'ae1' })),
      update: jest.fn(),
      findMany: jest.fn(async () => []),
    };
    const prisma = {
      deal: {
        findFirst: jest.fn(async () => ({
          id: 'deal-op',
          tenantId: 't1',
          deletedAt: null,
          stage: DealStage.CLOSED_WON,
          sourceTag: null,
          agreedPrice: new Prisma.Decimal(100),
          clientId: 'c1',
          watchId: 'w1',
          client: { name: 'Ops' },
          watch: { brand: 'Rolex', model: 'DJ' },
          updatedAt: new Date(),
          exchangeRate: null,
        })),
      },
      accountEntry,
      accountPayment: {
        findMany: jest.fn(async () => []),
      },
      receivable,
      receivablePayment,
      payment: {
        groupBy: jest.fn(async () => []),
        aggregate: jest.fn(async () => ({ _sum: { amount: new Prisma.Decimal(0) } })),
      },
    };

    const service = new CuentasService(
      prisma as never,
      { getUsdMxn: jest.fn() } as never,
      {
        createFromAccountPayment: jest.fn(),
        updateFromAccountPayment: jest.fn(),
        deleteByAccountPaymentId: jest.fn(),
      } as never,
      { register: jest.fn() } as never,
    );

    await service.syncDealReceivable('deal-op', 't1');

    expect(accountEntry.create).toHaveBeenCalled();
    expect(receivable.create).not.toHaveBeenCalled();
    expect(receivable.upsert).not.toHaveBeenCalled();
    expect(receivablePayment.create).not.toHaveBeenCalled();
  });
});
