import { ConflictException } from '@nestjs/common';
import { CapitalAccount } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  normalizeCapitalContributionAccount,
  registerCapitalContributionIdempotencyKey,
  RegisterCapitalContributionWriteBinding,
} from '../write/register-capital-contribution.binding';

describe('RegisterCapitalContributionWriteBinding', () => {
  const prisma = {
    tenantUser: { findFirst: jest.fn() },
    investor: { findFirst: jest.fn() },
    treasuryEntry: { findFirst: jest.fn() },
  };
  const capitalContributions = {
    register: jest.fn(),
  };
  const binding = new RegisterCapitalContributionWriteBinding(
    prisma as never,
    capitalContributions as never,
  );
  const context = {
    tenantId: 't1',
    userId: 'u1',
    role: 'OWNER',
    permissions: [] as string[],
    conversationId: 'c1',
    workspaceId: null as string | null,
    actionRunId: 'run-1',
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
  });

  it('normalizes CapitalAccount aliases including CESAR_ACCOUNT', () => {
    expect(normalizeCapitalContributionAccount('bancos')).toBe(CapitalAccount.BANK);
    expect(normalizeCapitalContributionAccount('efectivo')).toBe(CapitalAccount.CASH);
    expect(normalizeCapitalContributionAccount('Cuenta César')).toBe(
      CapitalAccount.CESAR_ACCOUNT,
    );
    expect(normalizeCapitalContributionAccount('CESAR')).toBe(CapitalAccount.CESAR_ACCOUNT);
    expect(normalizeCapitalContributionAccount('CRYPTO')).toBeNull();
  });

  it('mapInput uses server-owned idempotency key and rejects provider key', () => {
    const input = binding.mapInput(
      {
        stepId: 's1',
        capability: 'REGISTER_CAPITAL_CONTRIBUTION',
        arguments: {
          investorId: 'inv-1',
          amount: 300000,
          account: 'BANK',
          contributedAt: '2026-08-09',
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
      registerCapitalContributionIdempotencyKey('run-1'),
    );
    expect(input.registerIdempotencyKey).toBe('ai-action-run:run-1');
    expect(input.account).toBe(CapitalAccount.BANK);
    expect(input.amount).toBe(300000);
  });

  it('mapInput rejects missing trusted investor and non-positive amount', () => {
    expect(() =>
      binding.mapInput(
        {
          stepId: 's1',
          capability: 'REGISTER_CAPITAL_CONTRIBUTION',
          arguments: { amount: 100, account: 'BANK', contributedAt: '2026-08-09' },
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
          capability: 'REGISTER_CAPITAL_CONTRIBUTION',
          arguments: {
            investorId: 'inv-1',
            amount: 0,
            account: 'BANK',
            contributedAt: '2026-08-09',
          },
          dependsOn: [],
          estimatedEffects: [],
          reversibility: 'NONE',
        },
        context,
      ),
    ).toThrow(/positive amount/);
  });

  it('execute returns ledger-only receipt with ownership/treasury unchanged', async () => {
    capitalContributions.register.mockResolvedValue({
      replayed: false,
      contribution: {
        id: 'contrib-1',
        amount: new Prisma.Decimal(300000),
        account: CapitalAccount.BANK,
        contributedAt: new Date('2026-08-09T00:00:00.000Z'),
        deletedAt: null,
      },
    });
    const result = await binding.execute(
      {
        investorId: 'inv-1',
        amount: 300000,
        account: CapitalAccount.BANK,
        contributedAt: new Date('2026-08-09T00:00:00.000Z'),
        notes: null,
        registerIdempotencyKey: 'ai-action-run:run-1',
      },
      context,
    );
    expect(result.success).toBe(true);
    expect(result.actionId).toBe('REGISTER_CAPITAL_CONTRIBUTION');
    const receipt = result.receipt as Record<string, unknown>;
    expect(receipt.kind).toBe('CAPITAL_CONTRIBUTION');
    expect(receipt.contributionId).toBe('contrib-1');
    expect(receipt.ownershipChanged).toBe(false);
    expect(receipt.treasuryChanged).toBe(false);
    expect(receipt.treasury).toBe('Sin cambio');
    expect(capitalContributions.register).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        investorId: 'inv-1',
        amount: 300000,
        account: CapitalAccount.BANK,
        registerIdempotencyKey: 'ai-action-run:run-1',
      }),
    );
    expect(prisma.treasuryEntry.findFirst).toHaveBeenCalled();
  });

  it('maps reversed contribution conflict to STALE_CAPITAL_CONTRIBUTION_REVERSED', async () => {
    capitalContributions.register.mockRejectedValue(
      new ConflictException(
        'registerIdempotencyKey already used by a reversed contribution; use a new key',
      ),
    );
    try {
      await binding.execute(
        {
          investorId: 'inv-1',
          amount: 300000,
          account: CapitalAccount.BANK,
          contributedAt: new Date('2026-08-09T00:00:00.000Z'),
          registerIdempotencyKey: 'ai-action-run:run-1',
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
      expect(msg).toBe('STALE_CAPITAL_CONTRIBUTION_REVERSED');
    }
  });

  it('does not import Treasury services (architecture)', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../write/register-capital-contribution.binding.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/TreasuryTransferService|TreasuryService/);
    expect(src).toMatch(/CapitalContributionService/);
  });
});
