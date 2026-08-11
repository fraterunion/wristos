/**
 * Focused REVERSE_EXPENSE binding unit coverage (26C).
 */
import { ConflictException } from '@nestjs/common';
import { ReverseExpenseWriteBinding } from '../write/reverse-expense.binding';
import { reversalCommandKey } from '../../reversals/financial-reversal.types';

describe('ReverseExpenseWriteBinding', () => {
  const binding = new ReverseExpenseWriteBinding(
    {} as never,
    {
      reverse: jest.fn(async () => ({
        causality: 'APPLIED',
        expense: { id: 'exp-1' },
        treasuryEntry: { id: 'tr-1' },
      })),
    } as never,
    {
      resolveTrustedId: jest.fn(async () => ({
        kind: 'TRUSTED',
        target: {
          capability: 'REVERSE_EXPENSE',
          targetType: 'OPERATING_EXPENSE',
          targetId: 'exp-1',
          tenantId: 't1',
          targetFingerprint: 'fp-abc1234567890',
          targetSnapshot: {
            kind: 'OPERATING_EXPENSE',
            amount: '500.00',
            currency: 'MXN',
            category: 'GASOLINE',
            sourceAccount: 'BANK',
            expenseDate: '2026-08-10',
            conceptLabel: 'Gasolina',
            hasCanonicalTreasuryOutflow: true,
            active: true,
          },
          observedAt: new Date().toISOString(),
        },
      })),
    } as never,
  );

  const context = {
    tenantId: 't1',
    userId: 'u1',
    permissions: [],
    conversationId: 'c1',
    workspaceId: 'w1',
    actionRunId: 'run-rev-1',
    requestId: 'r1',
    locale: 'es-MX',
    timezone: 'UTC',
    now: new Date('2026-08-11T00:00:00Z'),
    planFingerprint: 'a'.repeat(64),
  };

  it('mapInput requires server-trusted targetId + fingerprint and stamps causal key', () => {
    const input = binding.mapInput(
      {
        stepId: 's1',
        capability: 'REVERSE_EXPENSE',
        arguments: {
          targetId: 'exp-1',
          targetFingerprint: 'fp-abc1234567890',
        },
        dependsOn: [],
        estimatedEffects: [],
        reversibility: 'NONE',
      },
      context as never,
    );
    expect(input.targetId).toBe('exp-1');
    expect(input.targetFingerprint).toBe('fp-abc1234567890');
    expect(input.reversalIdempotencyKey).toBe(reversalCommandKey('run-rev-1'));
  });

  it('mapInput rejects missing trusted target', () => {
    expect(() =>
      binding.mapInput(
        {
          stepId: 's1',
          capability: 'REVERSE_EXPENSE',
          arguments: { expenseId: 'provider-forged' },
          dependsOn: [],
          estimatedEffects: [],
          reversibility: 'NONE',
        },
        context as never,
      ),
    ).toThrow(/targetId|targetFingerprint/);
  });

  it('execute fails closed on EXTERNAL causality', async () => {
    const expenses = {
      reverse: jest.fn(async () => ({
        causality: 'EXTERNAL',
        expense: { id: 'exp-1' },
        treasuryEntry: null,
      })),
    };
    const prisma = {
      tenantUser: { findFirst: jest.fn(async () => ({ id: 'm1' })) },
      operatingExpense: { findFirst: jest.fn() },
    };
    const targets = {
      resolveTrustedId: jest.fn(async () => ({
        kind: 'TRUSTED',
        target: {
          capability: 'REVERSE_EXPENSE',
          targetType: 'OPERATING_EXPENSE',
          targetId: 'exp-1',
          tenantId: 't1',
          targetFingerprint: 'fp-abc1234567890',
          targetSnapshot: {
            kind: 'OPERATING_EXPENSE',
            amount: '500.00',
            currency: 'MXN',
            category: 'GASOLINE',
            sourceAccount: 'BANK',
            expenseDate: '2026-08-10',
            conceptLabel: 'Gasolina',
            hasCanonicalTreasuryOutflow: true,
            active: true,
          },
          observedAt: new Date().toISOString(),
        },
      })),
    };
    const local = new ReverseExpenseWriteBinding(
      prisma as never,
      expenses as never,
      targets as never,
    );
    await expect(
      local.execute(
        {
          targetId: 'exp-1',
          targetFingerprint: 'fp-abc1234567890',
          reversalIdempotencyKey: reversalCommandKey('run-rev-1'),
        },
        context as never,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
