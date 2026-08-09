import { ConflictException } from '@nestjs/common';
import { CapitalAccount, Prisma } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  registerCapitalDistributionIdempotencyKey,
  RegisterCapitalDistributionWriteBinding,
} from '../write/register-capital-distribution.binding';
import { normalizeCapitalContributionAccount } from '../write/register-capital-contribution.binding';

describe('RegisterCapitalDistributionWriteBinding', () => {
  const prisma = {
    tenantUser: { findFirst: jest.fn() },
    investor: { findFirst: jest.fn() },
    treasuryEntry: { findFirst: jest.fn() },
  };
  const capitalDistributions = {
    register: jest.fn(),
  };
  const capital = {
    getSummary: jest.fn(),
  };
  const binding = new RegisterCapitalDistributionWriteBinding(
    prisma as never,
    capitalDistributions as never,
    capital as never,
  );
  const context = {
    tenantId: 't1',
    userId: 'u1',
    role: 'OWNER',
    permissions: [] as string[],
    conversationId: 'c1',
    workspaceId: null as string | null,
    actionRunId: 'run-dist-1',
    requestId: 'req-1',
    locale: 'es-MX',
    timezone: 'UTC',
    now: new Date('2026-08-09T12:00:00.000Z'),
    planFingerprint: 'fp',
    workspaceVersion: 1,
    entityVersions: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.tenantUser.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.investor.findFirst.mockResolvedValue({ id: 'inv-1', name: 'CESAR' });
    prisma.treasuryEntry.findFirst.mockResolvedValue(null);
    capital.getSummary.mockResolvedValue({
      investors: [{ id: 'inv-1', pendingProfit: '50000.00' }],
    });
  });

  it('reuses CapitalAccount normalization (ledger metadata only)', () => {
    expect(normalizeCapitalContributionAccount('bancos')).toBe(CapitalAccount.BANK);
    expect(normalizeCapitalContributionAccount('Cuenta César')).toBe(
      CapitalAccount.CESAR_ACCOUNT,
    );
  });

  it('mapInput uses server-owned idempotency key and rejects provider key', () => {
    const input = binding.mapInput(
      {
        stepId: 's1',
        capability: 'REGISTER_CAPITAL_DISTRIBUTION',
        arguments: {
          investorId: 'inv-1',
          amount: 100000,
          account: 'BANK',
          paidAt: '2026-08-09',
          notes: 'qa',
          registerIdempotencyKey: 'forged-from-provider',
        },
        dependsOn: [],
        estimatedEffects: [],
        reversibility: 'NONE',
      },
      context,
    );
    expect(input.registerIdempotencyKey).toBe(
      registerCapitalDistributionIdempotencyKey('run-dist-1'),
    );
    expect(input.registerIdempotencyKey).toBe('ai-action-run:run-dist-1');
    expect(input.account).toBe(CapitalAccount.BANK);
    expect(input.amount).toBe(100000);
  });

  it('mapInput rejects missing trusted investor and non-positive amount', () => {
    expect(() =>
      binding.mapInput(
        {
          stepId: 's1',
          capability: 'REGISTER_CAPITAL_DISTRIBUTION',
          arguments: { amount: 100, account: 'BANK', paidAt: '2026-08-09' },
          dependsOn: [],
          estimatedEffects: [],
          reversibility: 'NONE',
        },
        context,
      ),
    ).toThrow(/trusted investorId/);
    expect(() =>
      binding.mapInput(
        {
          stepId: 's1',
          capability: 'REGISTER_CAPITAL_DISTRIBUTION',
          arguments: {
            investorId: 'inv-1',
            amount: -50,
            account: 'BANK',
            paidAt: '2026-08-09',
          },
          dependsOn: [],
          estimatedEffects: [],
          reversibility: 'NONE',
        },
        context,
      ),
    ).toThrow(/positive amount/);
  });

  it('execute returns ledger-only receipt with ownership/treasury/P&L unchanged and over-distribution allowed', async () => {
    capitalDistributions.register.mockResolvedValue({
      replayed: false,
      distribution: {
        id: 'dist-1',
        amount: new Prisma.Decimal(100000),
        account: CapitalAccount.BANK,
        paidAt: new Date('2026-08-09T00:00:00.000Z'),
        deletedAt: null,
      },
    });
    const result = await binding.execute(
      {
        investorId: 'inv-1',
        amount: 100000,
        account: CapitalAccount.BANK,
        paidAt: new Date('2026-08-09T00:00:00.000Z'),
        notes: null,
        registerIdempotencyKey: 'ai-action-run:run-dist-1',
      },
      context,
    );
    expect(result.success).toBe(true);
    expect(result.actionId).toBe('REGISTER_CAPITAL_DISTRIBUTION');
    const receipt = result.receipt as Record<string, unknown>;
    expect(receipt.kind).toBe('CAPITAL_DISTRIBUTION');
    expect(receipt.distributionId).toBe('dist-1');
    expect(receipt.ownershipChanged).toBe(false);
    expect(receipt.treasuryChanged).toBe(false);
    expect(receipt.businessProfitChanged).toBe(false);
    expect(receipt.previousPending).toBe('50000.00');
    expect(receipt.remainingPending).toBe('-50000.00');
    expect(receipt.overDistribution).toBe(true);
    expect(receipt.treasury).toBe('Sin cambio');
    expect(capitalDistributions.register).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        investorId: 'inv-1',
        amount: 100000,
        account: CapitalAccount.BANK,
        registerIdempotencyKey: 'ai-action-run:run-dist-1',
      }),
    );
    expect(prisma.treasuryEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ distributionId: 'dist-1' }),
      }),
    );
  });

  it('maps reversed distribution conflict to STALE_CAPITAL_DISTRIBUTION_REVERSED', async () => {
    capitalDistributions.register.mockRejectedValue(
      new ConflictException(
        'registerIdempotencyKey already used by a reversed distribution; use a new key',
      ),
    );
    try {
      await binding.execute(
        {
          investorId: 'inv-1',
          amount: 100000,
          account: CapitalAccount.BANK,
          paidAt: new Date('2026-08-09T00:00:00.000Z'),
          registerIdempotencyKey: 'ai-action-run:run-dist-1',
        },
        context,
      );
      throw new Error('expected ConflictException');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      const body = (error as ConflictException).getResponse();
      const msg =
        typeof body === 'string'
          ? body
          : typeof body === 'object' && body && 'message' in body
            ? String((body as { message: unknown }).message)
            : '';
      expect(msg).toBe('STALE_CAPITAL_DISTRIBUTION_REVERSED');
    }
  });

  it('does not import Treasury services', () => {
    const src = readFileSync(
      join(__dirname, '../write/register-capital-distribution.binding.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/TreasuryService|TreasuryTransferService/);
    expect(src).toContain('CapitalDistributionService');
  });
});
