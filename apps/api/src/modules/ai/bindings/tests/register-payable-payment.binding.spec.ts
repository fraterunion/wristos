import { ConflictException } from '@nestjs/common';
import {
  AccountEntrySource,
  AccountEntryStatus,
  AccountEntryType,
  Currency,
  Prisma,
  TreasuryAccount,
  TreasuryDirection,
} from '@prisma/client';
import {
  RegisterPayablePaymentWriteBinding,
  registerPayablePaymentIdempotencyKey,
} from '../write/register-payable-payment.binding';

function d(n: number | string) {
  return new Prisma.Decimal(n);
}

describe('RegisterPayablePaymentWriteBinding', () => {
  function build(state: {
    entry: any;
    payments?: any[];
    treasury?: any[];
  }) {
    const payments = state.payments ?? [];
    const treasury = state.treasury ?? [];
    const prisma: any = {
      tenantUser: {
        findFirst: jest.fn(async () => ({ id: 'tu-1' })),
      },
      accountEntry: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.id !== state.entry.id) return null;
          if (where.tenantId && state.entry.tenantId !== where.tenantId) return null;
          if (where.deletedAt === null && state.entry.deletedAt) return null;
          return {
            ...state.entry,
            payments: payments.filter((p) => !p.deletedAt),
          };
        }),
      },
      accountPayment: {
        findFirst: jest.fn(async ({ where }: any) => {
          for (const p of payments) {
            if (
              where.registerIdempotencyKey &&
              p.registerIdempotencyKey !== where.registerIdempotencyKey
            ) {
              continue;
            }
            if (where.deletedAt === null && p.deletedAt) continue;
            return p;
          }
          return null;
        }),
      },
    };
    const payablePayments = {
      register: jest.fn(async (_tenantId: string, input: any) => {
        const payment = {
          id: 'pay-1',
          entryId: input.payableEntryId,
          amount: d(input.amount),
          currency: Currency.MXN,
          cashAccount: TreasuryAccount.BANK,
          paidAt: new Date('2026-08-08T12:00:00Z'),
          deletedAt: null,
          registerIdempotencyKey: input.registerIdempotencyKey,
        };
        payments.push(payment);
        const tre = {
          id: 'tre-1',
          accountPaymentId: payment.id,
          direction: TreasuryDirection.OUTFLOW,
          account: TreasuryAccount.BANK,
          deletedAt: null,
        };
        treasury.push(tre);
        const remaining = d(state.entry.totalAmount).minus(input.amount);
        return {
          payablePayment: payment,
          payableEntry: {
            ...state.entry,
            status:
              remaining.lessThanOrEqualTo(0)
                ? AccountEntryStatus.PAID
                : AccountEntryStatus.PARTIAL,
          },
          treasuryEntry: tre,
          remainingOutstanding: remaining.lessThan(0) ? d(0) : remaining,
          sourceAccount: input.sourceAccount,
          replayed: false,
        };
      }),
    };
    return {
      binding: new RegisterPayablePaymentWriteBinding(prisma, payablePayments as never),
      payablePayments,
      prisma,
    };
  }

  const openPayable = {
    id: 'ap-1',
    tenantId: 't1',
    type: AccountEntryType.PAYABLE,
    status: AccountEntryStatus.OPEN,
    source: AccountEntrySource.MANUAL,
    dealId: null,
    currency: Currency.MXN,
    totalAmount: d(100000),
    counterpartyName: 'Pepe',
    concept: 'Compra Rolex',
    deletedAt: null,
  };

  it('mapInput sets server-only ai-action-run idempotency key', () => {
    const { binding } = build({ entry: openPayable });
    const input = binding.mapInput(
      {
        capability: 'REGISTER_PAYABLE_PAYMENT',
        arguments: {
          accountId: 'ap-1',
          amount: 50000,
          sourceAccount: 'BANK',
          registerIdempotencyKey: 'client-forged',
        },
      } as never,
      { actionRunId: 'run-99', tenantId: 't1', userId: 'u1' } as never,
    );
    expect(input.registerIdempotencyKey).toBe(
      registerPayablePaymentIdempotencyKey('run-99'),
    );
    expect(input.registerIdempotencyKey).not.toBe('client-forged');
    expect(input.payableEntryId).toBe('ap-1');
    expect(input.sourceAccount).toBe('BANK');
  });

  it('execute registers one payment and returns payable receipt', async () => {
    const { binding, payablePayments } = build({ entry: openPayable });
    const mapped = binding.mapInput(
      {
        capability: 'REGISTER_PAYABLE_PAYMENT',
        arguments: { payableEntryId: 'ap-1', amount: 40000, sourceAccount: 'BANK' },
      } as never,
      { actionRunId: 'run-1', tenantId: 't1', userId: 'u1' } as never,
    );
    const result = await binding.execute(mapped, {
      actionRunId: 'run-1',
      tenantId: 't1',
      userId: 'u1',
    } as never);
    expect(result.success).toBe(true);
    expect(payablePayments.register).toHaveBeenCalledTimes(1);
    const receipt = result.receipt as any;
    expect(receipt.payableEntryId).toBe('ap-1');
    expect(receipt.paymentId).toBe('pay-1');
    expect(receipt.sourceAccount).toBe('BANK');
    expect(receipt.remainingOutstanding).toBe('60000.00');
  });

  it('freshness rejects overpay after outstanding shrinks', async () => {
    const { binding } = build({
      entry: openPayable,
      payments: [
        {
          id: 'prior',
          amount: d(80000),
          deletedAt: null,
          registerIdempotencyKey: null,
        },
      ],
    });
    const mapped = binding.mapInput(
      {
        capability: 'REGISTER_PAYABLE_PAYMENT',
        arguments: { payableEntryId: 'ap-1', amount: 40000, sourceAccount: 'CASH' },
      } as never,
      { actionRunId: 'run-stale', tenantId: 't1', userId: 'u1' } as never,
    );
    await expect(
      binding.execute(mapped, {
        actionRunId: 'run-stale',
        tenantId: 't1',
        userId: 'u1',
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reversed marker before recovery is not treated as success', async () => {
    const { binding } = build({
      entry: openPayable,
      payments: [
        {
          id: 'pay-rev',
          amount: d(10000),
          deletedAt: new Date(),
          registerIdempotencyKey: 'ai-action-run:run-rev',
        },
      ],
    });
    const mapped = binding.mapInput(
      {
        capability: 'REGISTER_PAYABLE_PAYMENT',
        arguments: { payableEntryId: 'ap-1', amount: 10000, sourceAccount: 'BANK' },
      } as never,
      { actionRunId: 'run-rev', tenantId: 't1', userId: 'u1' } as never,
    );
    await expect(
      binding.execute(mapped, {
        actionRunId: 'run-rev',
        tenantId: 't1',
        userId: 'u1',
      } as never),
    ).rejects.toThrow(/STALE_PAYABLE_PAYMENT_REVERSED/);
  });
});
