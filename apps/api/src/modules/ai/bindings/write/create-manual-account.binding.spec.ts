import { ConflictException } from '@nestjs/common';
import { AccountEntryStatus, AccountEntryType, Currency, Prisma } from '@prisma/client';
import { CreateReceivableWriteBinding } from './create-receivable.binding';
import { CreatePayableWriteBinding } from './create-payable.binding';
import { createReceivableIdempotencyKey } from './create-manual-account.shared';

function d(n: number | string) {
  return new Prisma.Decimal(n);
}

describe('CreateReceivableWriteBinding', () => {
  const actionRunId = 'ar-recv-1';
  const context = {
    tenantId: 't1',
    userId: 'u1',
    actionRunId,
    conversationId: 'c1',
  };

  function build(opts?: { deletedAt?: Date | null; status?: AccountEntryStatus }) {
    const entry = {
      id: 'ae1',
      tenantId: 't1',
      type: AccountEntryType.RECEIVABLE,
      status: opts?.status ?? AccountEntryStatus.OPEN,
      source: 'MANUAL',
      counterpartyName: 'José',
      concept: 'Préstamo',
      totalAmount: d(180000),
      currency: Currency.MXN,
      clientId: null,
      issuedAt: null,
      dueDate: null,
      deletedAt: opts?.deletedAt ?? null,
      registerIdempotencyKey: createReceivableIdempotencyKey(actionRunId),
    };
    const prisma = {
      tenantUser: {
        findFirst: jest.fn(async () => ({ id: 'tu1' })),
      },
      client: { findFirst: jest.fn() },
      accountPayment: {
        count: jest.fn(async () => 0),
      },
    };
    const manualAccounts = {
      createReceivable: jest.fn(async () => ({ entry, replayed: false })),
      createPayable: jest.fn(),
    };
    const binding = new CreateReceivableWriteBinding(
      prisma as never,
      manualAccounts as never,
    );
    return { binding, prisma, manualAccounts, entry };
  }

  it('maps input and injects server idempotency key', () => {
    const { binding } = build();
    const input = binding.mapInput(
      {
        capability: 'CREATE_RECEIVABLE',
        arguments: {
          counterpartyName: 'José',
          amount: 180000,
          currency: 'MXN',
          concept: 'Préstamo',
        },
      } as never,
      context as never,
    );
    expect(input.registerIdempotencyKey).toBe(`ai-action-run:${actionRunId}`);
    expect(input.amount).toBe(180000);
    expect(input.counterpartyName).toBe('José');
  });

  it('executes createReceivable with Treasury Δ0 receipt', async () => {
    const { binding, manualAccounts } = build();
    const result = await binding.execute(
      {
        counterpartyName: 'José',
        concept: 'Préstamo',
        amount: 180000,
        currency: Currency.MXN,
        clientId: null,
        issuedAt: null,
        dueDate: null,
        notes: null,
        registerIdempotencyKey: createReceivableIdempotencyKey(actionRunId),
      },
      context as never,
    );
    expect(manualAccounts.createReceivable).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect((result.receipt as any).treasuryChanged).toBe(false);
    expect((result.receipt as any).pnlChanged).toBe(false);
    expect((result.receipt as any).type).toBe('RECEIVABLE');
    expect((result.receipt as any).outstanding).toBe('180000.00');
  });

  it('maps cancelled conflict to STALE_CREATE_RECEIVABLE_CANCELLED', async () => {
    const { binding, manualAccounts } = build();
    manualAccounts.createReceivable.mockRejectedValueOnce(
      new ConflictException(
        'registerIdempotencyKey already used by a cancelled/deleted account entry; use a new key',
      ),
    );
    await expect(
      binding.execute(
        {
          counterpartyName: 'José',
          concept: 'Préstamo',
          amount: 180000,
          currency: Currency.MXN,
          registerIdempotencyKey: createReceivableIdempotencyKey(actionRunId),
        } as never,
        context as never,
      ),
    ).rejects.toThrow(/STALE_CREATE_RECEIVABLE_CANCELLED/);
  });
});

describe('CreatePayableWriteBinding', () => {
  const actionRunId = 'ar-pay-1';
  const context = {
    tenantId: 't1',
    userId: 'u1',
    actionRunId,
    conversationId: 'c1',
  };

  it('executes createPayable with liability-only receipt', async () => {
    const entry = {
      id: 'ae2',
      tenantId: 't1',
      type: AccountEntryType.PAYABLE,
      status: AccountEntryStatus.OPEN,
      source: 'MANUAL',
      counterpartyName: 'Pepe',
      concept: 'Relojero',
      totalAmount: d(90000),
      currency: Currency.MXN,
      clientId: null,
      issuedAt: null,
      dueDate: null,
      deletedAt: null,
    };
    const prisma = {
      tenantUser: { findFirst: jest.fn(async () => ({ id: 'tu1' })) },
      client: { findFirst: jest.fn() },
      accountPayment: { count: jest.fn(async () => 0) },
    };
    const manualAccounts = {
      createReceivable: jest.fn(),
      createPayable: jest.fn(async () => ({ entry, replayed: false })),
    };
    const binding = new CreatePayableWriteBinding(prisma as never, manualAccounts as never);
    const result = await binding.execute(
      {
        counterpartyName: 'Pepe',
        concept: 'Relojero',
        amount: 90000,
        currency: Currency.MXN,
        clientId: null,
        issuedAt: null,
        dueDate: null,
        notes: null,
        registerIdempotencyKey: `ai-action-run:${actionRunId}`,
      },
      context as never,
    );
    expect(manualAccounts.createPayable).toHaveBeenCalled();
    expect((result.receipt as any).type).toBe('PAYABLE');
    expect((result.receipt as any).treasuryChanged).toBe(false);
    expect((result.receipt as any).pnlChanged).toBe(false);
  });
});
