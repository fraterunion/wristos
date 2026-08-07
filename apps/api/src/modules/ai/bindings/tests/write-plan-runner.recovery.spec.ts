import { ConflictException } from '@nestjs/common';
import { AIActionRunStatus } from '@prisma/client';
import { WritePlanRunner, registerSaleIdempotencyKey } from '../write-plan-runner';

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
