import { BadRequestException, ConflictException } from '@nestjs/common';
import { Currency, Prisma, TreasuryAccount, TreasuryDirection } from '@prisma/client';
import {
  RegisterTreasuryTransferWriteBinding,
  normalizeTreasuryTransferAccount,
  registerTreasuryTransferIdempotencyKey,
} from '../write/register-treasury-transfer.binding';

function d(n: number | string) {
  return new Prisma.Decimal(n);
}

describe('normalizeTreasuryTransferAccount', () => {
  it.each([
    ['efectivo', 'CASH'],
    ['caja', 'CASH'],
    ['cash', 'CASH'],
    ['CASH', 'CASH'],
    ['bancos', 'BANK'],
    ['banco', 'BANK'],
    ['cuenta bancaria', 'BANK'],
    ['BANK', 'BANK'],
    ['césar', 'CESAR'],
    ['cesar', 'CESAR'],
    ['cuenta césar', 'CESAR'],
    ['cuenta de césar', 'CESAR'],
    ['CESAR', 'CESAR'],
  ] as const)('maps %s → %s', (raw, expected) => {
    expect(normalizeTreasuryTransferAccount(raw)).toBe(expected);
  });

  it.each(['CRYPTO', 'crypto', 'usdt', 'arbitrary', 'cmnzph8dm0000qotapt94alxs', ''])(
    'rejects %s',
    (raw) => {
      expect(normalizeTreasuryTransferAccount(raw)).toBeNull();
    },
  );
});

describe('RegisterTreasuryTransferWriteBinding', () => {
  function build() {
    const prisma: any = {
      tenantUser: {
        findFirst: jest.fn(async () => ({ id: 'tu-1' })),
      },
    };
    const treasuryTransfers = {
      register: jest.fn(async (_tenantId: string, input: any) => {
        const transferId = input.registerIdempotencyKey;
        return {
          transferId,
          sourceAccount: input.sourceAccount,
          destinationAccount: input.destinationAccount,
          amount: d(input.amount),
          currency: Currency.MXN,
          replayed: false,
          outflowEntry: {
            id: 'out-1',
            account: input.sourceAccount as TreasuryAccount,
            direction: TreasuryDirection.OUTFLOW,
            amountMxn: d(input.amount),
            transactionDate: input.transferDate ?? new Date('2026-08-08T12:00:00Z'),
            deletedAt: null,
          },
          inflowEntry: {
            id: 'in-1',
            account: input.destinationAccount as TreasuryAccount,
            direction: TreasuryDirection.INFLOW,
            amountMxn: d(input.amount),
            transactionDate: input.transferDate ?? new Date('2026-08-08T12:00:00Z'),
            deletedAt: null,
          },
        };
      }),
    };
    return {
      binding: new RegisterTreasuryTransferWriteBinding(prisma, treasuryTransfers as never),
      treasuryTransfers,
      prisma,
    };
  }

  it('mapInput sets server-only ai-action-run idempotency key', () => {
    const { binding } = build();
    const input = binding.mapInput(
      {
        capability: 'REGISTER_TREASURY_TRANSFER',
        arguments: {
          sourceAccount: 'BANK',
          destinationAccount: 'CASH',
          amount: 200000,
          registerIdempotencyKey: 'client-forged',
        },
      } as never,
      { actionRunId: 'run-99', tenantId: 't1', userId: 'u1' } as never,
    );
    expect(input.registerIdempotencyKey).toBe(
      registerTreasuryTransferIdempotencyKey('run-99'),
    );
    expect(input.registerIdempotencyKey).not.toBe('client-forged');
    expect(input.sourceAccount).toBe('BANK');
    expect(input.destinationAccount).toBe('CASH');
    expect(input.amount).toBe(200000);
  });

  it('mapInput normalizes Spanish account aliases', () => {
    const { binding } = build();
    const input = binding.mapInput(
      {
        capability: 'REGISTER_TREASURY_TRANSFER',
        arguments: {
          source: 'Bancos',
          destination: 'Cuenta César',
          amount: 50000,
        },
      } as never,
      { actionRunId: 'run-alias', tenantId: 't1', userId: 'u1' } as never,
    );
    expect(input.sourceAccount).toBe('BANK');
    expect(input.destinationAccount).toBe('CESAR');
  });

  it('mapInput rejects CRYPTO / arbitrary accounts', () => {
    const { binding } = build();
    expect(() =>
      binding.mapInput(
        {
          capability: 'REGISTER_TREASURY_TRANSFER',
          arguments: {
            sourceAccount: 'CRYPTO',
            destinationAccount: 'CASH',
            amount: 1000,
          },
        } as never,
        { actionRunId: 'run-x', tenantId: 't1', userId: 'u1' } as never,
      ),
    ).toThrow(BadRequestException);
  });

  it('mapInput rejects same account', () => {
    const { binding } = build();
    expect(() =>
      binding.mapInput(
        {
          capability: 'REGISTER_TREASURY_TRANSFER',
          arguments: {
            sourceAccount: 'BANK',
            destinationAccount: 'BANK',
            amount: 1000,
          },
        } as never,
        { actionRunId: 'run-same', tenantId: 't1', userId: 'u1' } as never,
      ),
    ).toThrow(/misma cuenta/);
  });

  it('mapInput rejects non-MXN currency', () => {
    const { binding } = build();
    expect(() =>
      binding.mapInput(
        {
          capability: 'REGISTER_TREASURY_TRANSFER',
          arguments: {
            sourceAccount: 'CASH',
            destinationAccount: 'BANK',
            amount: 1000,
            currency: 'USD',
          },
        } as never,
        { actionRunId: 'run-usd', tenantId: 't1', userId: 'u1' } as never,
      ),
    ).toThrow(/MXN only/);
  });

  it('mapInput rejects zero / negative amount', () => {
    const { binding } = build();
    expect(() =>
      binding.mapInput(
        {
          capability: 'REGISTER_TREASURY_TRANSFER',
          arguments: { sourceAccount: 'CASH', destinationAccount: 'BANK', amount: 0 },
        } as never,
        { actionRunId: 'run-0', tenantId: 't1', userId: 'u1' } as never,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      binding.mapInput(
        {
          capability: 'REGISTER_TREASURY_TRANSFER',
          arguments: { sourceAccount: 'CASH', destinationAccount: 'BANK', amount: -5 },
        } as never,
        { actionRunId: 'run-neg', tenantId: 't1', userId: 'u1' } as never,
      ),
    ).toThrow(BadRequestException);
  });

  it('execute registers via TreasuryTransferService and returns transfer receipt', async () => {
    const { binding, treasuryTransfers } = build();
    const mapped = binding.mapInput(
      {
        capability: 'REGISTER_TREASURY_TRANSFER',
        arguments: {
          sourceAccount: 'BANK',
          destinationAccount: 'CASH',
          amount: 200000,
        },
      } as never,
      { actionRunId: 'run-1', tenantId: 't1', userId: 'u1' } as never,
    );
    const result = await binding.execute(mapped, {
      actionRunId: 'run-1',
      tenantId: 't1',
      userId: 'u1',
    } as never);
    expect(result.success).toBe(true);
    expect(result.executionState).toBe('EXECUTED');
    expect(result.rollbackPossible).toBe(false);
    expect(treasuryTransfers.register).toHaveBeenCalledTimes(1);
    expect(treasuryTransfers.register).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        sourceAccount: 'BANK',
        destinationAccount: 'CASH',
        amount: 200000,
        registerIdempotencyKey: registerTreasuryTransferIdempotencyKey('run-1'),
      }),
    );
    const receipt = result.receipt as any;
    expect(receipt.kind).toBe('TREASURY_TRANSFER');
    expect(receipt.sourceAccount).toBe('BANK');
    expect(receipt.destinationAccount).toBe('CASH');
    expect(receipt.amount).toBe('200000.00');
    expect(receipt.currency).toBe('MXN');
    expect(receipt.totalLiquidity).toBe('Sin cambio');
    expect(receipt.profit).toBe('Sin cambio');
    expect(receipt.capital).toBe('Sin cambio');
  });

  it('execute surfaces reversed transfer as ConflictException', async () => {
    const { binding, treasuryTransfers } = build();
    treasuryTransfers.register.mockRejectedValueOnce(
      new ConflictException('STALE_TREASURY_TRANSFER_REVERSED'),
    );
    const mapped = binding.mapInput(
      {
        capability: 'REGISTER_TREASURY_TRANSFER',
        arguments: {
          sourceAccount: 'CASH',
          destinationAccount: 'BANK',
          amount: 1000,
        },
      } as never,
      { actionRunId: 'run-rev', tenantId: 't1', userId: 'u1' } as never,
    );
    await expect(
      binding.execute(mapped, {
        actionRunId: 'run-rev',
        tenantId: 't1',
        userId: 'u1',
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
