/**
 * Focused REVERSE_TREASURY_TRANSFER binding unit coverage (26D).
 */
import { ConflictException } from '@nestjs/common';
import { ReverseTreasuryTransferWriteBinding } from '../write/reverse-treasury-transfer.binding';

describe('ReverseTreasuryTransferWriteBinding', () => {
  const prisma = {
    tenantUser: { findFirst: jest.fn().mockResolvedValue({ id: 'tu1' }) },
    treasuryEntry: { findFirst: jest.fn() },
  };
  const transfers = { reverse: jest.fn() };
  const targetResolver = {
    resolveTrustedTransferId: jest.fn(),
  };

  const binding = new ReverseTreasuryTransferWriteBinding(
    prisma as never,
    transfers as never,
    targetResolver as never,
  );

  const ctx = {
    tenantId: 'tenant1',
    userId: 'user1',
    actionRunId: 'run1',
    conversationId: 'conv1',
    workspaceId: 'ws1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.tenantUser.findFirst.mockResolvedValue({ id: 'tu1' });
  });

  it('mapInput rejects provider-only ids and builds server causal key', () => {
    expect(() =>
      binding.mapInput(
        {
          stepId: 's1',
          capability: 'REVERSE_TREASURY_TRANSFER',
          arguments: { transferId: 'raw-provider-id' },
          dependsOn: [],
          reversibility: 'NONE',
          estimatedEffects: [],
        },
        ctx as never,
      ),
    ).toThrow(/server-resolved/);

    const input = binding.mapInput(
      {
        stepId: 's1',
        capability: 'REVERSE_TREASURY_TRANSFER',
        arguments: {
          targetId: 'logical-key-1',
          targetFingerprint: 'a'.repeat(32),
        },
        dependsOn: [],
        reversibility: 'NONE',
        estimatedEffects: [],
      },
      ctx as never,
    );
    expect(input.targetId).toBe('logical-key-1');
    expect(input.reversalIdempotencyKey).toBe('ai-action-run:run1');
  });

  it('execute fails closed on INVARIANT / EXTERNAL', async () => {
    targetResolver.resolveTrustedTransferId.mockResolvedValue({
      kind: 'INVARIANT',
      code: 'STALE_TREASURY_TRANSFER_INVARIANT',
    });
    await expect(
      binding.execute(
        {
          targetId: 't1',
          targetFingerprint: 'a'.repeat(32),
          reversalIdempotencyKey: 'ai-action-run:run1',
        },
        ctx as never,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    targetResolver.resolveTrustedTransferId.mockResolvedValue({
      kind: 'TRUSTED',
      target: {
        capability: 'REVERSE_TREASURY_TRANSFER',
        targetType: 'TREASURY_TRANSFER',
        targetId: 't1',
        tenantId: 'tenant1',
        targetFingerprint: 'a'.repeat(32),
        targetSnapshot: {
          kind: 'TREASURY_TRANSFER',
          amount: '100000.00',
          currency: 'MXN',
          sourceAccount: 'BANK',
          destinationAccount: 'CASH',
          transferDate: '2026-08-11',
          active: true,
          pairComplete: true,
        },
        observedAt: new Date().toISOString(),
      },
    });
    transfers.reverse.mockResolvedValue({
      causality: 'EXTERNAL',
      reversed: false,
      alreadyReversed: true,
      outflowEntry: null,
      inflowEntry: null,
    });
    await expect(
      binding.execute(
        {
          targetId: 't1',
          targetFingerprint: 'a'.repeat(32),
          reversalIdempotencyKey: 'ai-action-run:run1',
        },
        ctx as never,
      ),
    ).rejects.toThrow(/EXTERNALLY/);
  });

  it('execute APPLIED returns transfer reversal receipt without technical jargon', async () => {
    targetResolver.resolveTrustedTransferId.mockResolvedValue({
      kind: 'TRUSTED',
      target: {
        capability: 'REVERSE_TREASURY_TRANSFER',
        targetType: 'TREASURY_TRANSFER',
        targetId: 't1',
        tenantId: 'tenant1',
        targetFingerprint: 'a'.repeat(32),
        targetSnapshot: {
          kind: 'TREASURY_TRANSFER',
          amount: '100000.00',
          currency: 'MXN',
          sourceAccount: 'BANK',
          destinationAccount: 'CASH',
          transferDate: '2026-08-11',
          active: true,
          pairComplete: true,
        },
        observedAt: new Date().toISOString(),
      },
    });
    transfers.reverse.mockResolvedValue({
      causality: 'APPLIED',
      reversed: true,
      alreadyReversed: false,
      outflowEntry: { id: 'out1' },
      inflowEntry: { id: 'in1' },
    });
    const result = await binding.execute(
      {
        targetId: 't1',
        targetFingerprint: 'a'.repeat(32),
        reversalIdempotencyKey: 'ai-action-run:run1',
      },
      ctx as never,
    );
    expect(result.success).toBe(true);
    const receipt = result.receipt as Record<string, unknown>;
    expect(receipt.kind).toBe('TREASURY_TRANSFER_REVERSAL');
    expect(String(receipt.message)).toMatch(/Revertí la transferencia/);
    expect(String(receipt.message)).not.toMatch(/APPLIED|SAME_COMMAND|provenance/i);
  });
});
