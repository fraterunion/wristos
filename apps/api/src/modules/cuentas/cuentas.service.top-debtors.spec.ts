import { AccountEntryType, Prisma } from '@prisma/client';
import { CuentasService } from './cuentas.service';

function d(n: number) {
  return new Prisma.Decimal(n);
}

describe('CuentasService — top debtors tenant scope', () => {
  it('aggregates open receivable balances per counterparty and currency', async () => {
    const entries = [
      {
        id: 'e1',
        tenantId: 't1',
        type: AccountEntryType.RECEIVABLE,
        status: 'OPEN',
        category: 'OTHER',
        source: 'MANUAL',
        counterpartyName: 'Alice',
        counterpartyType: 'CLIENT',
        concept: 'a',
        totalAmount: d(1000),
        currency: 'MXN',
        exchangeRate: null,
        reference: null,
        issuedAt: null,
        dueDate: null,
        closedAt: null,
        notes: null,
        clientId: 'c1',
        dealId: null,
        watchId: null,
        expenseId: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        payments: [],
        client: { id: 'c1', name: 'Alice' },
      },
      {
        id: 'e2',
        tenantId: 't1',
        type: AccountEntryType.RECEIVABLE,
        status: 'PARTIAL',
        category: 'OTHER',
        source: 'MANUAL',
        counterpartyName: 'Alice',
        counterpartyType: 'CLIENT',
        concept: 'b',
        totalAmount: d(500),
        currency: 'MXN',
        exchangeRate: null,
        reference: null,
        issuedAt: null,
        dueDate: null,
        closedAt: null,
        notes: null,
        clientId: 'c1',
        dealId: null,
        watchId: null,
        expenseId: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        payments: [
          {
            id: 'pay1',
            tenantId: 't1',
            entryId: 'e2',
            amount: d(200),
            deletedAt: null,
            paidAt: new Date(),
            method: 'TRANSFER',
            currency: 'MXN',
            notes: null,
            cashAccount: null,
            exchangeRateUsed: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        client: { id: 'c1', name: 'Alice' },
      },
      {
        id: 'e3',
        tenantId: 't1',
        type: AccountEntryType.RECEIVABLE,
        status: 'OPEN',
        category: 'OTHER',
        source: 'MANUAL',
        counterpartyName: 'Bob USD',
        counterpartyType: 'CLIENT',
        concept: 'c',
        totalAmount: d(100),
        currency: 'USD',
        exchangeRate: null,
        reference: null,
        issuedAt: null,
        dueDate: null,
        closedAt: null,
        notes: null,
        clientId: 'c2',
        dealId: null,
        watchId: null,
        expenseId: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        payments: [],
        client: { id: 'c2', name: 'Bob USD' },
      },
    ];

    const prisma = {
      accountEntry: {
        findMany: jest.fn(async ({ where }: { where: { tenantId: string } }) => {
          expect(where.tenantId).toBe('t1');
          return entries;
        }),
      },
      payment: { groupBy: jest.fn(async () => []) },
    };

    const service = new CuentasService(
      prisma as never,
      { getUsdMxn: jest.fn() } as never,
      {
        createFromAccountPayment: jest.fn(),
        updateFromAccountPayment: jest.fn(),
        deleteByAccountPaymentId: jest.fn(),
      } as never,
    );

    const top = await service.getTopDebtors('t1', 10);
    expect(top).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientId: 'c1',
          counterpartyName: 'Alice',
          currency: 'MXN',
          outstanding: '1300.00',
          openAccounts: 2,
        }),
        expect.objectContaining({
          clientId: 'c2',
          currency: 'USD',
          outstanding: '100.00',
          openAccounts: 1,
        }),
      ]),
    );
    // MXN and USD stay separate — Alice MXN is not mixed with Bob USD
    expect(top.every((row) => row.currency === 'MXN' || row.currency === 'USD')).toBe(
      true,
    );
  });
});
