import { OperatingExpenseCategory, Prisma } from '@prisma/client';
import {
  buildExpenseFingerprintInput,
  expenseReversalFingerprint,
  expenseReversalSnapshot,
} from './expense-reversal-fingerprint';
import {
  buildTransferFingerprintInput,
  transferReversalFingerprint,
} from './transfer-reversal-fingerprint';
import { classifyExpenseReversalRecovery } from './expense-reversal-recovery';
import { classifyTransferReversalRecovery } from './transfer-reversal-recovery';
import {
  buildExpenseReversalPreview,
  buildTransferReversalPreview,
} from './reversal-preview';
import { evaluateLastReversibleAction } from './last-reversible-action.policy';
import { FUTURE_REVERSAL_CAPABILITIES, reversalCommandKey } from './financial-reversal.types';
import { readFileSync } from 'fs';
import { join } from 'path';

function d(n: number) {
  return new Prisma.Decimal(n);
}

describe('Financial Reversal Safety Framework 26A', () => {
  const root = join(__dirname, '../../../../../..');

  it('keeps exactly thirteen WRITE bindings including REVERSE_EXPENSE only', () => {
    const registry = readFileSync(
      join(root, 'apps/api/src/modules/ai/bindings/write-capability-binding-registry.ts'),
      'utf8',
    );
    expect(registry).toMatch(/bindings\.size !== 13/);
    expect(registry).toContain('REVERSE_EXPENSE');
    expect(registry).toContain('ReverseExpenseWriteBinding');
    expect(registry).not.toContain('ReverseTreasuryTransferWriteBinding');
    expect(registry).not.toMatch(/!this\.bindings\.has\('REVERSE_TREASURY_TRANSFER'\)/);
    for (const cap of FUTURE_REVERSAL_CAPABILITIES) {
      expect(registry).not.toMatch(new RegExp(`!this\\.bindings\\.has\\('${cap}'\\)`));
    }
  });

  it('does not introduce a generic GenericReversalService mutation API', () => {
    const types = readFileSync(
      join(root, 'apps/api/src/modules/ai/reversals/financial-reversal.types.ts'),
      'utf8',
    );
    expect(types).not.toMatch(/GenericReversalService|reverseEntity\(/);
    expect(types).toContain('TrustedReversalTarget');
  });

  it('composition V1 remains purchase/sale → CREATE_CLIENT only', () => {
    const composition = readFileSync(
      join(root, 'apps/api/src/modules/ai/composition/composition.types.ts'),
      'utf8',
    );
    expect(composition).toContain('PURCHASE_SELLER');
    expect(composition).toContain('SALE_CUSTOMER');
    expect(composition).not.toMatch(/REVERSE_/);
  });

  it('expense fingerprint ignores notes and detects amount drift', () => {
    const base = {
      id: 'e1',
      amount: d(2500),
      category: OperatingExpenseCategory.GASOLINE,
      sourceAccount: 'CASH' as const,
      expenseDate: new Date('2026-08-10T00:00:00.000Z'),
      currency: 'MXN' as const,
      deletedAt: null,
      notes: 'gasolina centro',
    };
    const treasury = { id: 't1', deletedAt: null };
    const a = expenseReversalFingerprint(buildExpenseFingerprintInput(base, treasury));
    const b = expenseReversalFingerprint(
      buildExpenseFingerprintInput({ ...base, notes: 'edited notes' }, treasury),
    );
    expect(a).toBe(b);

    const c = expenseReversalFingerprint(
      buildExpenseFingerprintInput({ ...base, amount: d(3000) }, treasury),
    );
    expect(c).not.toBe(a);
  });

  it('legacy expense preview does not claim liquidity restore', () => {
    const snapshot = expenseReversalSnapshot(
      {
        amount: d(2500),
        category: OperatingExpenseCategory.GASOLINE,
        sourceAccount: null,
        expenseDate: new Date('2026-08-10T00:00:00.000Z'),
        currency: 'MXN',
        deletedAt: null,
        notes: 'legacy',
      },
      null,
    );
    const preview = buildExpenseReversalPreview(snapshot);
    expect(preview.legacyMode).toBe(true);
    expect(preview.restoresLiquidity).toBe(false);
    expect(preview.reversalEffects.some((e) => /Sin cambio/.test(e.description))).toBe(
      true,
    );
    expect(preview.riskTier).toBe('HIGH');
  });

  it('canonical expense preview restores source liquidity', () => {
    const snapshot = expenseReversalSnapshot(
      {
        amount: d(2500),
        category: OperatingExpenseCategory.GASOLINE,
        sourceAccount: 'CASH',
        expenseDate: new Date('2026-08-10T00:00:00.000Z'),
        currency: 'MXN',
        deletedAt: null,
        notes: 'gasolina',
      },
      { id: 't1' },
    );
    const preview = buildExpenseReversalPreview(snapshot);
    expect(preview.legacyMode).toBe(false);
    expect(preview.restoresLiquidity).toBe(true);
    expect(preview.changesPnl).toBe(true);
    expect(preview.changesCapital).toBe(false);
  });

  it('transfer fingerprint requires pair identity and preview is liquidity-neutral', () => {
    const outflow = {
      account: 'BANK' as const,
      amount: d(100000),
      transactionDate: new Date('2026-08-10T12:00:00.000Z'),
      deletedAt: null,
      direction: 'OUTFLOW' as const,
    };
    const inflow = {
      account: 'CASH' as const,
      amount: d(100000),
      transactionDate: new Date('2026-08-10T12:00:00.000Z'),
      deletedAt: null,
      direction: 'INFLOW' as const,
    };
    const fp = transferReversalFingerprint(
      buildTransferFingerprintInput({
        transferId: 'xfer-1',
        outflow,
        inflow,
      }),
    );
    expect(fp).toHaveLength(64);

    const preview = buildTransferReversalPreview({
      kind: 'TREASURY_TRANSFER',
      amount: '100000.00',
      currency: 'MXN',
      sourceAccount: 'BANK',
      destinationAccount: 'CASH',
      transferDate: '2026-08-10',
      active: true,
      pairComplete: true,
    });
    expect(preview.changesPnl).toBe(false);
    expect(preview.changesCapital).toBe(false);
    expect(preview.reversalEffects.some((e) => /Liquidez total: Sin cambio/.test(e.description))).toBe(
      true,
    );
  });

  it('expense recovery: SAME_COMMAND vs EXTERNAL vs MISSING', () => {
    const key = reversalCommandKey('ar-1');
    const fp = 'abc';

    expect(
      classifyExpenseReversalRecovery({
        commandKey: key,
        expense: { deletedAt: new Date(), reversalIdempotencyKey: key },
        plannedFingerprint: fp,
        currentFingerprint: fp,
      }).kind,
    ).toBe('MATCH');

    expect(
      classifyExpenseReversalRecovery({
        commandKey: key,
        expense: { deletedAt: new Date(), reversalIdempotencyKey: null },
        plannedFingerprint: fp,
        currentFingerprint: fp,
      }).kind,
    ).toBe('EXTERNAL_ALREADY_REVERSED');

    expect(
      classifyExpenseReversalRecovery({
        commandKey: key,
        expense: { deletedAt: null, reversalIdempotencyKey: null },
        plannedFingerprint: fp,
        currentFingerprint: fp,
      }).kind,
    ).toBe('MISSING');
  });

  it('transfer recovery: unpaired → INVARIANT; same key → MATCH', () => {
    const key = reversalCommandKey('ar-2');
    const fp = 'def';

    expect(
      classifyTransferReversalRecovery({
        commandKey: key,
        outflow: { deletedAt: new Date(), reversalIdempotencyKey: key },
        inflow: null,
        plannedFingerprint: fp,
        currentFingerprint: fp,
      }).kind,
    ).toBe('INVARIANT');

    expect(
      classifyTransferReversalRecovery({
        commandKey: key,
        outflow: { deletedAt: new Date(), reversalIdempotencyKey: key },
        inflow: { deletedAt: new Date(), reversalIdempotencyKey: key },
        plannedFingerprint: fp,
        currentFingerprint: fp,
      }).kind,
    ).toBe('MATCH');
  });

  it('last-action policy rejects cross-conversation and accepts same-session', () => {
    const base = {
      capability: 'REVERSE_EXPENSE' as const,
      targetType: 'OPERATING_EXPENSE' as const,
      targetId: 'e1',
      targetFingerprint: 'fp',
      actionRunId: 'ar',
      safeLabel: 'Gasto',
      completedAt: new Date().toISOString(),
      conversationId: 'c1',
      workspaceId: 'w1',
    };
    expect(
      evaluateLastReversibleAction({
        candidate: base,
        tenantId: 't1',
        conversationId: 'c1',
        workspaceId: 'w1',
      }).kind,
    ).toBe('USE');
    expect(
      evaluateLastReversibleAction({
        candidate: base,
        tenantId: 't1',
        conversationId: 'other',
        workspaceId: 'w1',
      }).kind,
    ).toBe('REJECT');
  });

  it('documents schema migration for reversal causality', () => {
    const sql = readFileSync(
      join(
        root,
        'prisma/migrations/20260810120000_financial_reversal_idempotency/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain('reversalIdempotencyKey');
    expect(sql).toContain('operating_expenses');
    expect(sql).toContain('treasury_entries');
    expect(sql).not.toMatch(/DROP |DELETE FROM|UPDATE\s/i);
  });
});
