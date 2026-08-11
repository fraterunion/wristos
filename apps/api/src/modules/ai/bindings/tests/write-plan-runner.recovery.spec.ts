import { ConflictException } from '@nestjs/common';
import { AIActionRunStatus } from '@prisma/client';
import { WritePlanRunner, registerSaleIdempotencyKey } from '../write-plan-runner';
import { registerPayablePaymentIdempotencyKey } from '../write/register-payable-payment.binding';

/**
 * Pre-fix crash window (Commit 12B @ 52b253b) — documented by code audit:
 *
 * 1. CAS owner sets ActionRun → EXECUTING
 * 2. SaleRegistrationService.register() commits Deal (+ Watch/Payment/Treasury/CXC)
 * 3. Process crashes / completeExecution throws BEFORE ActionRun → COMPLETED
 *
 * Pre-fix retry behavior:
 * - claimConfirmation saw EXECUTING → threw ConflictException immediately
 * - NEVER looked up Deal by ai-action-run:<id>
 * - ActionRun could remain EXECUTING forever (or wrongly FAILED if catch ran)
 * - User could be told "No se realizó ningún cambio" even though Deal committed
 *
 * These tests prove the FIXED recovery path.
 */

const fingerprint = 'a'.repeat(64);

const salePlan = {
  businessAction: 'REGISTER_SALE',
  state: 'READY_FOR_CONFIRMATION',
  missingEntities: [],
  clarificationQuestions: [],
  warnings: [],
  confirmationTier: 'HIGH',
  executionSteps: [
    {
      stepId: 'register-sale-1',
      capability: 'REGISTER_SALE',
      arguments: {
        watchId: 'watch-1',
        customerId: 'client-1',
        price: 350000,
        currency: 'MXN',
        paymentMode: 'CREDIT',
        watchLabel: 'Rolex Batman',
      },
      dependsOn: [],
      estimatedEffects: [],
      reversibility: 'NONE',
    },
  ],
  preview: { title: 'Register Sale', fields: [], warnings: [], estimatedEffects: [], confirmationTier: 'HIGH', category: 'SALES' },
  workspaceVersion: 1,
  entityVersions: {},
  fingerprint,
};

const businessResult = {
  actionId: 'REGISTER_SALE',
  executionState: 'EXECUTED',
  success: true,
  affectedEntities: [{ type: 'DEAL', id: 'hash', effect: 'CREATED' }],
  generatedEvents: [],
  receipt: {
    dealId: 'deal-1',
    watchLabel: 'Rolex Batman',
    amount: '350000.00',
    currency: 'MXN',
    paymentMode: 'CREDIT',
    amountReceived: '0.00',
    destination: null,
    remainingReceivable: '350000.00',
    replayed: true,
  },
  warnings: [],
  rollbackPossible: false,
};

function makeRunner(overrides: {
  findRun?: jest.Mock;
  updateMany?: jest.Mock;
  dealFind?: jest.Mock;
  bindingExecute?: jest.Mock;
  completeExecution?: jest.Mock;
  failExecution?: jest.Mock;
}) {
  const runBase = {
    id: 'run-1',
    tenantId: 't1',
    conversationId: 'c1',
    intent: 'REGISTER_SALE',
    status: AIActionRunStatus.READY_FOR_CONFIRMATION,
    planFingerprint: fingerprint,
    confirmedAt: null,
    proposedPlan: salePlan,
    result: null,
  };

  const prisma = {
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        aIActionRun: {
          findFirst: overrides.findRun ?? jest.fn(async () => ({ ...runBase })),
          findFirstOrThrow: jest.fn(async () => ({
            ...runBase,
            status: AIActionRunStatus.EXECUTING,
            confirmedAt: new Date(),
          })),
          updateMany: overrides.updateMany ?? jest.fn(async () => ({ count: 1 })),
        },
        deal: {
          findFirst: overrides.dealFind ?? jest.fn(async () => null),
        },
        aIAuditEvent: {
          create: jest.fn(async () => ({})),
        },
      };
      return fn(tx);
    }),
    aIActionRun: {
      findFirst: jest.fn(async () => ({
        ...runBase,
        status: AIActionRunStatus.EXECUTING,
        confirmedAt: new Date(),
      })),
    },
    aIRequest: { findFirst: jest.fn(async () => null) },
    deal: {
      findFirst: overrides.dealFind ?? jest.fn(async () => null),
    },
  };

  const runtime = {
    completeExecution:
      overrides.completeExecution ??
      jest.fn(async () => ({
        ...runBase,
        status: AIActionRunStatus.COMPLETED,
        result: { businessActionResult: businessResult },
      })),
    failExecution: overrides.failExecution ?? jest.fn(async () => ({})),
  };

  const planner = {
    validatePlanStillCurrent: jest.fn(() => ({ current: true, reasons: [] })),
  };

  const binding = {
    capability: 'REGISTER_SALE',
    version: '1.0.0',
    mode: 'WRITE',
    bindingName: 'register_sale_canonical@1.0.0',
    mapInput: jest.fn(() => ({
      watchId: 'watch-1',
      clientId: 'client-1',
      agreedPrice: 350000,
      currency: 'MXN',
      paymentMode: 'CREDIT',
      registerIdempotencyKey: registerSaleIdempotencyKey('run-1'),
    })),
    inputSchema: { parse: jest.fn((v) => v) },
    execute: overrides.bindingExecute ?? jest.fn(async () => businessResult),
  };

  const writeRegistry = {
    hasBinding: jest.fn((c: string) => c === 'REGISTER_SALE'),
    getBinding: jest.fn(() => binding),
    listBindings: jest.fn(() => [binding]),
  };

  const runner = new WritePlanRunner(
    prisma as never,
    runtime as never,
    planner as never,
    writeRegistry as never,
    { resolveTrustedId: jest.fn() } as never,
  );

  return { runner, prisma, runtime, binding, runBase };
}

describe('WritePlanRunner post-commit recovery', () => {
  it('documents idempotency key shape', () => {
    expect(registerSaleIdempotencyKey('run-1')).toBe('ai-action-run:run-1');
  });

  it('happy path: sale + ActionRun completion → COMPLETED receipt', async () => {
    const { runner, runtime, binding } = makeRunner({});
    const result = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-1',
      expectedFingerprint: fingerprint,
    });
    expect(binding.execute).toHaveBeenCalledTimes(1);
    expect(runtime.completeExecution).toHaveBeenCalledTimes(1);
    expect(runtime.failExecution).not.toHaveBeenCalled();
    expect(result.interactionState).toBe('COMPLETED');
    expect(result.responseType).toBe('SUCCESS_RECEIPT');
    expect(result.receipt).toEqual(expect.objectContaining({ dealId: 'deal-1' }));
    expect(result.recovered).toBe(false);
  });

  it('pre-fix gap closed: EXECUTING + committed Deal recovers to COMPLETED (no second write race)', async () => {
    const executingRun = {
      id: 'run-1',
      tenantId: 't1',
      conversationId: 'c1',
      intent: 'REGISTER_SALE',
      status: AIActionRunStatus.EXECUTING,
      planFingerprint: fingerprint,
      confirmedAt: new Date(),
      proposedPlan: salePlan,
      result: null,
    };
    const dealFind = jest.fn(async () => ({ id: 'deal-1', watchId: 'watch-1', clientId: 'client-1' }));
    const { runner, runtime, binding } = makeRunner({
      findRun: jest.fn(async () => executingRun),
      dealFind,
      bindingExecute: jest.fn(async () => ({
        ...businessResult,
        receipt: { ...businessResult.receipt, replayed: true },
      })),
    });

    const result = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-1',
      expectedFingerprint: fingerprint,
    });

    expect(dealFind).toHaveBeenCalled();
    expect(binding.execute).toHaveBeenCalledTimes(1);
    expect(runtime.completeExecution).toHaveBeenCalledTimes(1);
    expect(runtime.failExecution).not.toHaveBeenCalled();
    expect(result.interactionState).toBe('COMPLETED');
    expect(result.recovered).toBe(true);
    expect(result.replayed).toBe(true);
    expect(result.message).toContain('ya estaba registrada');
    expect(result.receipt).toEqual(expect.objectContaining({ dealId: 'deal-1' }));
  });

  it('EXECUTING without Deal returns IN_PROGRESS (no fail, no second ownership)', async () => {
    const executingRun = {
      id: 'run-1',
      tenantId: 't1',
      conversationId: 'c1',
      intent: 'REGISTER_SALE',
      status: AIActionRunStatus.EXECUTING,
      planFingerprint: fingerprint,
      confirmedAt: new Date(),
      proposedPlan: salePlan,
      result: null,
    };
    const { runner, runtime, binding } = makeRunner({
      findRun: jest.fn(async () => executingRun),
      dealFind: jest.fn(async () => null),
    });

    const result = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-1',
      expectedFingerprint: fingerprint,
    });

    expect(binding.execute).not.toHaveBeenCalled();
    expect(runtime.completeExecution).not.toHaveBeenCalled();
    expect(runtime.failExecution).not.toHaveBeenCalled();
    expect(result.executionState).toBe('IN_PROGRESS');
    expect(result.interactionState).toBe('EXECUTING');
    expect(result.message).toMatch(/Reintenta la misma confirmación/);
    expect(result.message).not.toMatch(/No se realizó ningún cambio/);
  });

  it('sale commits then completeExecution throws → recover via Deal (never "no change")', async () => {
    const completeExecution = jest
      .fn()
      .mockRejectedValueOnce(new Error('runtime persistence crash'))
      .mockResolvedValueOnce({
        id: 'run-1',
        tenantId: 't1',
        conversationId: 'c1',
        intent: 'REGISTER_SALE',
        status: AIActionRunStatus.COMPLETED,
        planFingerprint: fingerprint,
        proposedPlan: salePlan,
        result: { businessActionResult: businessResult, recovered: true },
      });

    const dealFind = jest.fn(async () => ({ id: 'deal-1', watchId: 'watch-1', clientId: 'client-1' }));

    const { runner, runtime, binding } = makeRunner({
      completeExecution,
      dealFind,
      bindingExecute: jest
        .fn()
        .mockResolvedValueOnce({ ...businessResult, receipt: { ...businessResult.receipt, replayed: false } })
        .mockResolvedValueOnce({ ...businessResult, receipt: { ...businessResult.receipt, replayed: true } }),
    });

    const result = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-1',
      expectedFingerprint: fingerprint,
    });

    expect(binding.execute).toHaveBeenCalledTimes(2);
    expect(runtime.failExecution).not.toHaveBeenCalled();
    expect(result.interactionState).toBe('COMPLETED');
    expect(result.recovered).toBe(true);
    expect(result.message).not.toMatch(/No se realizó ningún cambio/);
  });

  it('FAILED runtime with committed Deal recovers to COMPLETED', async () => {
    const failedRun = {
      id: 'run-1',
      tenantId: 't1',
      conversationId: 'c1',
      intent: 'REGISTER_SALE',
      status: AIActionRunStatus.FAILED,
      planFingerprint: fingerprint,
      confirmedAt: new Date(),
      proposedPlan: salePlan,
      result: null,
      error: 'Error',
    };
    const { runner, runtime, binding } = makeRunner({
      findRun: jest.fn(async () => failedRun),
      dealFind: jest.fn(async () => ({ id: 'deal-1' })),
      bindingExecute: jest.fn(async () => ({
        ...businessResult,
        receipt: { ...businessResult.receipt, replayed: true },
      })),
    });

    const result = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-1',
      expectedFingerprint: fingerprint,
    });

    expect(result.interactionState).toBe('COMPLETED');
    expect(result.recovered).toBe(true);
    expect(runtime.completeExecution).toHaveBeenCalled();
    expect(binding.execute).toHaveBeenCalledTimes(1);
  });

  it('COMPLETED replay returns same stored receipt without re-executing binding', async () => {
    const completedRun = {
      id: 'run-1',
      tenantId: 't1',
      conversationId: 'c1',
      intent: 'REGISTER_SALE',
      status: AIActionRunStatus.COMPLETED,
      planFingerprint: fingerprint,
      confirmedAt: new Date(),
      proposedPlan: salePlan,
      result: { businessActionResult: businessResult },
    };
    const { runner, binding, runtime } = makeRunner({
      findRun: jest.fn(async () => completedRun),
    });

    const result = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-1',
      expectedFingerprint: fingerprint,
    });

    expect(binding.execute).not.toHaveBeenCalled();
    expect(runtime.completeExecution).not.toHaveBeenCalled();
    expect(result.executionState).toBe('REPLAYED');
    expect(result.receipt).toEqual(businessResult.receipt);
  });

  it('payload conflict under same actionRun key fails closed', async () => {
    const executingRun = {
      id: 'run-1',
      tenantId: 't1',
      conversationId: 'c1',
      intent: 'REGISTER_SALE',
      status: AIActionRunStatus.EXECUTING,
      planFingerprint: fingerprint,
      confirmedAt: new Date(),
      proposedPlan: salePlan,
      result: null,
    };
    const { runner, binding } = makeRunner({
      findRun: jest.fn(async () => executingRun),
      dealFind: jest.fn(async () => ({ id: 'deal-1' })),
      bindingExecute: jest.fn(async () => {
        throw new ConflictException('Idempotency key already used with a different sale price');
      }),
    });

    await expect(
      runner.confirmAndExecute({
        tenantId: 't1',
        userId: 'u1',
        actionRunId: 'run-1',
        expectedFingerprint: fingerprint,
      }),
    ).rejects.toThrow(/different sale price|Idempotency/);

    expect(binding.execute).toHaveBeenCalled();
  });

  it('domain rollback (no Deal) marks FAILED with truthful no-change copy', async () => {
    const { runner, runtime, binding } = makeRunner({
      bindingExecute: jest.fn(async () => {
        throw new Error('Treasury failure');
      }),
      dealFind: jest.fn(async () => null),
    });

    const result = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-1',
      expectedFingerprint: fingerprint,
    });

    expect(binding.execute).toHaveBeenCalled();
    expect(runtime.failExecution).toHaveBeenCalled();
    expect(result.interactionState).toBe('FAILED');
    expect(result.message).toMatch(/[Nn]o se realizó ningún cambio/);
  });

  it('concurrent losers: race to EXECUTING without Deal → IN_PROGRESS; with Deal → recover', async () => {
    const updateMany = jest.fn(async () => ({ count: 0 }));
    const againExecuting = {
      id: 'run-1',
      tenantId: 't1',
      conversationId: 'c1',
      intent: 'REGISTER_SALE',
      status: AIActionRunStatus.EXECUTING,
      planFingerprint: fingerprint,
      confirmedAt: new Date(),
      proposedPlan: salePlan,
      result: null,
    };
    const findRun = jest
      .fn()
      .mockResolvedValueOnce({
        ...againExecuting,
        status: AIActionRunStatus.READY_FOR_CONFIRMATION,
        confirmedAt: null,
      })
      .mockResolvedValueOnce(againExecuting);

    const { runner: runnerA, binding: bindingA } = makeRunner({
      updateMany,
      findRun,
      dealFind: jest.fn(async () => null),
    });
    const inProgress = await runnerA.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-1',
      expectedFingerprint: fingerprint,
    });
    expect(inProgress.executionState).toBe('IN_PROGRESS');
    expect(bindingA.execute).not.toHaveBeenCalled();

    const { runner: runnerB, binding: bindingB, runtime } = makeRunner({
      findRun: jest.fn(async () => againExecuting),
      dealFind: jest.fn(async () => ({ id: 'deal-1' })),
    });
    const recovered = await runnerB.confirmAndExecute({
      tenantId: 't1',
      userId: 'u2',
      actionRunId: 'run-1',
      expectedFingerprint: fingerprint,
    });
    expect(recovered.recovered).toBe(true);
    expect(recovered.interactionState).toBe('COMPLETED');
    expect(bindingB.execute).toHaveBeenCalledTimes(1);
    expect(runtime.completeExecution).toHaveBeenCalled();
  });
});

const payableFingerprint = 'b'.repeat(64);
const payablePlan = {
  businessAction: 'REGISTER_PAYABLE_PAYMENT',
  state: 'READY_FOR_CONFIRMATION',
  missingEntities: [],
  clarificationQuestions: [],
  warnings: [],
  confirmationTier: 'HIGH',
  executionSteps: [
    {
      stepId: 'register-payable-payment-1',
      capability: 'REGISTER_PAYABLE_PAYMENT',
      arguments: {
        payableEntryId: 'ap-1',
        amount: 15000,
        sourceAccount: 'BANK',
      },
      dependsOn: [],
      estimatedEffects: [],
      reversibility: 'NONE',
    },
  ],
  preview: {
    title: 'Register Payable Payment',
    fields: [],
    warnings: [],
    estimatedEffects: [],
    confirmationTier: 'HIGH',
    category: 'ACCOUNTS',
  },
  workspaceVersion: 1,
  entityVersions: {},
  fingerprint: payableFingerprint,
};

const payableResult = {
  actionId: 'REGISTER_PAYABLE_PAYMENT',
  executionState: 'EXECUTED',
  success: true,
  affectedEntities: [],
  generatedEvents: [],
  receipt: {
    kind: 'PAYABLE_CASH_PAYMENT',
    paymentId: 'pay-1',
    payableEntryId: 'ap-1',
    amount: '15000.00',
    sourceAccount: 'BANK',
  },
  warnings: [],
  rollbackPossible: false,
};

function makePayableRunner(overrides: {
  status?: AIActionRunStatus;
  payment?: { id: string; deletedAt: Date | null } | null;
  treasury?: { id: string } | null;
  bindingExecute?: jest.Mock;
}) {
  const run = {
    id: 'run-pay-1',
    tenantId: 't1',
    conversationId: 'c1',
    intent: 'REGISTER_PAYABLE_PAYMENT',
    status: overrides.status ?? AIActionRunStatus.EXECUTING,
    planFingerprint: payableFingerprint,
    confirmedAt: new Date(),
    proposedPlan: payablePlan,
    result: null,
  };

  const prisma = {
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        aIActionRun: {
          findFirst: jest.fn(async () => ({ ...run })),
          findFirstOrThrow: jest.fn(async () => ({ ...run })),
          updateMany: jest.fn(async () => ({ count: 0 })),
        },
        accountPayment: {
          findFirst: jest.fn(async () => overrides.payment ?? null),
        },
        treasuryEntry: {
          findFirst: jest.fn(async () => {
            if (!overrides.payment || overrides.payment.deletedAt) return null;
            return overrides.treasury === undefined ? { id: 'tre-1' } : overrides.treasury;
          }),
        },
        aIAuditEvent: { create: jest.fn(async () => ({})) },
      };
      return fn(tx);
    }),
    aIActionRun: {
      findFirst: jest.fn(async () => ({ ...run })),
    },
    aIRequest: { findFirst: jest.fn(async () => null) },
    accountPayment: {
      findFirst: jest.fn(async () => overrides.payment ?? null),
    },
    treasuryEntry: {
      findFirst: jest.fn(async () => {
        if (!overrides.payment || overrides.payment.deletedAt) return null;
        return overrides.treasury === undefined ? { id: 'tre-1' } : overrides.treasury;
      }),
    },
  };

  const runtime = {
    completeExecution: jest.fn(async () => ({
      ...run,
      status: AIActionRunStatus.COMPLETED,
      result: { businessActionResult: payableResult, recovered: true },
    })),
    failExecution: jest.fn(async () => ({})),
  };

  const planner = {
    validatePlanStillCurrent: jest.fn(() => ({ current: true, reasons: [] })),
  };

  const binding = {
    capability: 'REGISTER_PAYABLE_PAYMENT',
    version: '1.0.0',
    mode: 'WRITE',
    bindingName: 'register_payable_payment_canonical@1.0.0',
    mapInput: jest.fn(() => ({
      payableEntryId: 'ap-1',
      amount: 15000,
      sourceAccount: 'BANK',
      registerIdempotencyKey: registerPayablePaymentIdempotencyKey('run-pay-1'),
    })),
    inputSchema: { parse: jest.fn((v) => v) },
    execute: overrides.bindingExecute ?? jest.fn(async () => payableResult),
  };

  const writeRegistry = {
    hasBinding: jest.fn((c: string) => c === 'REGISTER_PAYABLE_PAYMENT'),
    getBinding: jest.fn(() => binding),
    listBindings: jest.fn(() => [binding]),
  };

  const runner = new WritePlanRunner(
    prisma as never,
    runtime as never,
    planner as never,
    writeRegistry as never,
    { resolveTrustedId: jest.fn() } as never,
  );

  return { runner, runtime, binding, prisma };
}

describe('WritePlanRunner REGISTER_PAYABLE_PAYMENT reversed recovery', () => {
  it('EXECUTING + active payment + Treasury recovers COMPLETED', async () => {
    const { runner, runtime, binding } = makePayableRunner({
      status: AIActionRunStatus.EXECUTING,
      payment: { id: 'pay-1', deletedAt: null },
      treasury: { id: 'tre-1' },
    });
    const result = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-pay-1',
      expectedFingerprint: payableFingerprint,
    });
    expect(binding.execute).toHaveBeenCalledTimes(1);
    expect(runtime.completeExecution).toHaveBeenCalled();
    expect(runtime.failExecution).not.toHaveBeenCalled();
    expect(result.interactionState).toBe('COMPLETED');
    expect(result.recovered).toBe(true);
  });

  it('FAILED + active payment + Treasury recovers COMPLETED', async () => {
    const { runner, runtime, binding } = makePayableRunner({
      status: AIActionRunStatus.FAILED,
      payment: { id: 'pay-1', deletedAt: null },
      treasury: { id: 'tre-1' },
    });
    const result = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-pay-1',
      expectedFingerprint: payableFingerprint,
    });
    expect(binding.execute).toHaveBeenCalledTimes(1);
    expect(result.interactionState).toBe('COMPLETED');
    expect(result.recovered).toBe(true);
    expect(runtime.failExecution).not.toHaveBeenCalled();
  });

  it('EXECUTING + reversed payment → STALE_PAYABLE_PAYMENT_REVERSED (no re-apply)', async () => {
    const { runner, runtime, binding } = makePayableRunner({
      status: AIActionRunStatus.EXECUTING,
      payment: { id: 'pay-1', deletedAt: new Date() },
    });
    const result = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-pay-1',
      expectedFingerprint: payableFingerprint,
    });
    expect(binding.execute).not.toHaveBeenCalled();
    expect(runtime.completeExecution).not.toHaveBeenCalled();
    expect(runtime.failExecution).toHaveBeenCalledWith(
      't1',
      'u1',
      'run-pay-1',
      'STALE_PAYABLE_PAYMENT_REVERSED',
      expect.anything(),
    );
    expect(result.executionState).toBe('FAILED');
    expect(result.interactionState).toBe('STALE_PLAN');
    expect(result.message).toMatch(/revertido en Cuentas/);
    expect(result.message).not.toMatch(/se está registrando/);
    expect(result.receipt).toBeNull();
  });

  it('FAILED + reversed payment → same typed stale (no re-apply)', async () => {
    const { runner, runtime, binding } = makePayableRunner({
      status: AIActionRunStatus.FAILED,
      payment: { id: 'pay-1', deletedAt: new Date() },
    });
    const result = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-pay-1',
      expectedFingerprint: payableFingerprint,
    });
    expect(binding.execute).not.toHaveBeenCalled();
    expect(runtime.failExecution).not.toHaveBeenCalled();
    expect(result.interactionState).toBe('STALE_PLAN');
    expect(result.message).toMatch(/revertido en Cuentas/);
  });

  it('EXECUTING + no marker → IN_PROGRESS', async () => {
    const { runner, runtime, binding } = makePayableRunner({
      status: AIActionRunStatus.EXECUTING,
      payment: null,
    });
    const result = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-pay-1',
      expectedFingerprint: payableFingerprint,
    });
    expect(binding.execute).not.toHaveBeenCalled();
    expect(runtime.failExecution).not.toHaveBeenCalled();
    expect(result.executionState).toBe('IN_PROGRESS');
    expect(result.interactionState).toBe('EXECUTING');
  });

  it('EXECUTING + active payment missing Treasury → invariant failure, no success', async () => {
    const { runner, runtime, binding } = makePayableRunner({
      status: AIActionRunStatus.EXECUTING,
      payment: { id: 'pay-1', deletedAt: null },
      treasury: null,
    });
    const result = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-pay-1',
      expectedFingerprint: payableFingerprint,
    });
    expect(binding.execute).not.toHaveBeenCalled();
    expect(runtime.completeExecution).not.toHaveBeenCalled();
    expect(runtime.failExecution).toHaveBeenCalledWith(
      't1',
      'u1',
      'run-pay-1',
      'STALE_PAYABLE_PAYMENT_MISSING_TREASURY',
      expect.anything(),
    );
    expect(result.interactionState).toBe('FAILED');
    expect(result.receipt).toBeNull();
  });

  it('reversed payment retry is stable non-success', async () => {
    const { runner, binding } = makePayableRunner({
      status: AIActionRunStatus.FAILED,
      payment: { id: 'pay-1', deletedAt: new Date() },
    });
    const a = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-pay-1',
      expectedFingerprint: payableFingerprint,
    });
    const b = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-pay-1',
      expectedFingerprint: payableFingerprint,
    });
    expect(binding.execute).not.toHaveBeenCalled();
    expect(a.message).toBe(b.message);
    expect(a.interactionState).toBe('STALE_PLAN');
    expect(b.interactionState).toBe('STALE_PLAN');
  });
});

const transferFingerprint = 'c'.repeat(64);
const transferPlan = {
  businessAction: 'REGISTER_TREASURY_TRANSFER',
  state: 'READY_FOR_CONFIRMATION',
  missingEntities: [],
  clarificationQuestions: [],
  warnings: [],
  confirmationTier: 'HIGH',
  executionSteps: [
    {
      stepId: 'register-treasury-transfer-1',
      capability: 'REGISTER_TREASURY_TRANSFER',
      arguments: {
        sourceAccount: 'BANK',
        destinationAccount: 'CASH',
        amount: 200000,
      },
      dependsOn: [],
      estimatedEffects: [],
      reversibility: 'NONE',
    },
  ],
  preview: {
    title: 'Register Treasury Transfer',
    fields: [],
    warnings: [],
    estimatedEffects: [],
    confirmationTier: 'HIGH',
    category: 'TREASURY',
  },
  workspaceVersion: 1,
  entityVersions: {},
  fingerprint: transferFingerprint,
};

const transferResult = {
  actionId: 'REGISTER_TREASURY_TRANSFER',
  executionState: 'EXECUTED',
  success: true,
  affectedEntities: [],
  generatedEvents: [],
  receipt: {
    kind: 'TREASURY_TRANSFER',
    transferId: 'ai-action-run:run-tt-1',
    sourceAccount: 'BANK',
    destinationAccount: 'CASH',
    amount: '200000.00',
    currency: 'MXN',
  },
  warnings: [],
  rollbackPossible: false,
};

function makeTransferRunner(overrides: {
  status?: AIActionRunStatus;
  outflow?: { id: string; deletedAt: Date | null } | null;
  inflow?: { id: string; deletedAt: Date | null } | null;
  bindingExecute?: jest.Mock;
}) {
  const run = {
    id: 'run-tt-1',
    tenantId: 't1',
    conversationId: 'c1',
    intent: 'REGISTER_TREASURY_TRANSFER',
    status: overrides.status ?? AIActionRunStatus.EXECUTING,
    planFingerprint: transferFingerprint,
    confirmedAt: new Date(),
    proposedPlan: transferPlan,
    result: null,
  };

  const outflowKey = 'treasury-transfer:ai-action-run:run-tt-1:outflow';
  const inflowKey = 'treasury-transfer:ai-action-run:run-tt-1:inflow';

  const findTreasury = async ({ where }: any) => {
    if (where.provenanceKey === outflowKey) {
      return overrides.outflow === undefined
        ? { id: 'out-1', deletedAt: null }
        : overrides.outflow;
    }
    if (where.provenanceKey === inflowKey) {
      return overrides.inflow === undefined
        ? { id: 'in-1', deletedAt: null }
        : overrides.inflow;
    }
    return null;
  };

  const prisma = {
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        aIActionRun: {
          findFirst: jest.fn(async () => ({ ...run })),
          findFirstOrThrow: jest.fn(async () => ({ ...run })),
          updateMany: jest.fn(async () => ({ count: 0 })),
        },
        treasuryEntry: { findFirst: jest.fn(findTreasury) },
        aIAuditEvent: { create: jest.fn(async () => ({})) },
      };
      return fn(tx);
    }),
    aIActionRun: {
      findFirst: jest.fn(async () => ({ ...run })),
    },
    aIRequest: { findFirst: jest.fn(async () => null) },
    treasuryEntry: { findFirst: jest.fn(findTreasury) },
  };

  const runtime = {
    completeExecution: jest.fn(async () => ({
      ...run,
      status: AIActionRunStatus.COMPLETED,
      result: { businessActionResult: transferResult, recovered: true },
    })),
    failExecution: jest.fn(async () => ({})),
  };

  const planner = {
    validatePlanStillCurrent: jest.fn(() => ({ current: true, reasons: [] })),
  };

  const binding = {
    capability: 'REGISTER_TREASURY_TRANSFER',
    version: '1.0.0',
    mode: 'WRITE',
    bindingName: 'register_treasury_transfer_canonical@1.0.0',
    mapInput: jest.fn(() => ({
      sourceAccount: 'BANK',
      destinationAccount: 'CASH',
      amount: 200000,
      registerIdempotencyKey: 'ai-action-run:run-tt-1',
    })),
    inputSchema: { parse: jest.fn((v) => v) },
    execute: overrides.bindingExecute ?? jest.fn(async () => transferResult),
  };

  const writeRegistry = {
    hasBinding: jest.fn((c: string) => c === 'REGISTER_TREASURY_TRANSFER'),
    getBinding: jest.fn(() => binding),
    listBindings: jest.fn(() => [binding]),
  };

  const runner = new WritePlanRunner(
    prisma as never,
    runtime as never,
    planner as never,
    writeRegistry as never,
    { resolveTrustedId: jest.fn() } as never,
  );

  return { runner, runtime, binding, prisma };
}

describe('WritePlanRunner REGISTER_TREASURY_TRANSFER dual-leg recovery', () => {
  it('EXECUTING + both active legs recovers COMPLETED', async () => {
    const { runner, runtime, binding } = makeTransferRunner({
      status: AIActionRunStatus.EXECUTING,
      outflow: { id: 'out-1', deletedAt: null },
      inflow: { id: 'in-1', deletedAt: null },
    });
    const result = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-tt-1',
      expectedFingerprint: transferFingerprint,
    });
    expect(binding.execute).toHaveBeenCalledTimes(1);
    expect(runtime.completeExecution).toHaveBeenCalled();
    expect(runtime.failExecution).not.toHaveBeenCalled();
    expect(result.interactionState).toBe('COMPLETED');
    expect(result.recovered).toBe(true);
  });

  it('EXECUTING + both reversed → STALE_TREASURY_TRANSFER_REVERSED (no re-apply)', async () => {
    const deleted = new Date();
    const { runner, runtime, binding } = makeTransferRunner({
      status: AIActionRunStatus.EXECUTING,
      outflow: { id: 'out-1', deletedAt: deleted },
      inflow: { id: 'in-1', deletedAt: deleted },
    });
    const result = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-tt-1',
      expectedFingerprint: transferFingerprint,
    });
    expect(binding.execute).not.toHaveBeenCalled();
    expect(runtime.completeExecution).not.toHaveBeenCalled();
    expect(runtime.failExecution).toHaveBeenCalledWith(
      't1',
      'u1',
      'run-tt-1',
      'STALE_TREASURY_TRANSFER_REVERSED',
      expect.anything(),
    );
    expect(result.interactionState).toBe('STALE_PLAN');
    expect(result.message).toMatch(/revertida en Tesorería/);
    expect(result.receipt).toBeNull();
  });

  it('FAILED + both reversed → typed stale without re-apply', async () => {
    const deleted = new Date();
    const { runner, runtime, binding } = makeTransferRunner({
      status: AIActionRunStatus.FAILED,
      outflow: { id: 'out-1', deletedAt: deleted },
      inflow: { id: 'in-1', deletedAt: deleted },
    });
    const result = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-tt-1',
      expectedFingerprint: transferFingerprint,
    });
    expect(binding.execute).not.toHaveBeenCalled();
    expect(runtime.failExecution).not.toHaveBeenCalled();
    expect(result.interactionState).toBe('STALE_PLAN');
  });

  it('EXECUTING + one leg missing → invariant failure', async () => {
    const { runner, runtime, binding } = makeTransferRunner({
      status: AIActionRunStatus.EXECUTING,
      outflow: { id: 'out-1', deletedAt: null },
      inflow: null,
    });
    const result = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-tt-1',
      expectedFingerprint: transferFingerprint,
    });
    expect(binding.execute).not.toHaveBeenCalled();
    expect(runtime.completeExecution).not.toHaveBeenCalled();
    expect(runtime.failExecution).toHaveBeenCalledWith(
      't1',
      'u1',
      'run-tt-1',
      'CANONICAL_TREASURY_TRANSFER_INVARIANT',
      expect.anything(),
    );
    expect(result.receipt).toBeNull();
    expect(result.message).toMatch(/transferencia/);
    expect(result.message).toMatch(/estado interno quedó incompleto/);
    expect(result.message).not.toMatch(/venta/);
    expect(result.message).not.toMatch(/compra/);
    expect(result.message).not.toMatch(/pago/);
  });

  it('EXECUTING + neither leg → IN_PROGRESS', async () => {
    const { runner, runtime, binding } = makeTransferRunner({
      status: AIActionRunStatus.EXECUTING,
      outflow: null,
      inflow: null,
    });
    const result = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-tt-1',
      expectedFingerprint: transferFingerprint,
    });
    expect(binding.execute).not.toHaveBeenCalled();
    expect(runtime.failExecution).not.toHaveBeenCalled();
    expect(result.executionState).toBe('IN_PROGRESS');
    expect(result.message).toMatch(/transferencia se está registrando/);
  });

  it('reversed transfer recovery retry is stable', async () => {
    const deleted = new Date();
    const { runner, binding } = makeTransferRunner({
      status: AIActionRunStatus.FAILED,
      outflow: { id: 'out-1', deletedAt: deleted },
      inflow: { id: 'in-1', deletedAt: deleted },
    });
    const a = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-tt-1',
      expectedFingerprint: transferFingerprint,
    });
    const b = await runner.confirmAndExecute({
      tenantId: 't1',
      userId: 'u1',
      actionRunId: 'run-tt-1',
      expectedFingerprint: transferFingerprint,
    });
    expect(binding.execute).not.toHaveBeenCalled();
    expect(a.message).toBe(b.message);
    expect(a.interactionState).toBe('STALE_PLAN');
    expect(b.interactionState).toBe('STALE_PLAN');
  });
});
