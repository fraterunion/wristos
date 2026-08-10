import { AIRequestStatus } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { StructuredAssistantService } from './structured-assistant.service';

describe('StructuredAssistantService', () => {
  const request = { id: 'request-1', traceId: 'trace-1', receivedAt: new Date('2026-08-06T00:00:00Z') };
  const requests = { claim: jest.fn(), transition: jest.fn(), failUnattached: jest.fn() };
  const persistence = { prepare: jest.fn(), checkpointPlan: jest.fn(), complete: jest.fn(), currentWorkspaceVersion: jest.fn() };
  const planner = { plan: jest.fn() };
  const readRunner = { run: jest.fn() };
  const receivablePaymentResolver = {
    resolve: jest.fn(async (_tenantId: string, entities: Record<string, unknown>) => ({
      entities,
      clarify: null,
      uniqueReceivableSelected: false,
      uniquePayableSelected: false,
    })),
  };
  const purchaseEntityResolver = {
    resolve: jest.fn(async (_tenantId: string, entities: Record<string, unknown>) => ({
      entities,
      clarify: null,
      dependencyRequired: null,
    })),
  };
  const saleCustomerEntityResolver = {
    resolve: jest.fn(async (_tenantId: string, entities: Record<string, unknown>) => ({
      entities,
      clarify: null,
      dependencyRequired: null,
    })),
  };
  const createClientEntityResolver = {
    resolve: jest.fn(async (_tenantId: string, entities: Record<string, unknown>) => ({
      kind: 'READY' as const,
      entities,
    })),
  };
  const updateClientEntityResolver = {
    resolve: jest.fn(async (_tenantId: string, entities: Record<string, unknown>) => ({
      kind: 'READY' as const,
      entities,
    })),
  };
  const capitalInvestorEntityResolver = {
    resolve: jest.fn(async (_tenantId: string, entities: Record<string, unknown>) => ({
      kind: 'READY' as const,
      entities,
    })),
  };
  const createManualAccountEntityResolver = {
    resolve: jest.fn(async (_tenantId: string, entities: Record<string, unknown>) => ({
      kind: 'READY' as const,
      entities,
    })),
  };
  const compositionOrchestrator = {
    loadActive: jest.fn(async () => ({ composition: null, version: 1, resolvedContext: {} })),
    recoverPendingResume: jest.fn(async () => null),
    pausePurchaseSellerMissing: jest.fn(),
    pauseSaleCustomerMissing: jest.fn(),
    attachChildPreview: jest.fn(),
    resumeParentAfterClient: jest.fn(),
    read: jest.fn(() => null),
  };
  const payablePaymentResolver = { resolve: jest.fn() };
  const service = new StructuredAssistantService(
    requests as never,
    persistence as never,
    planner as never,
    readRunner as never,
    receivablePaymentResolver as never,
    payablePaymentResolver as never,
    purchaseEntityResolver as never,
    saleCustomerEntityResolver as never,
    createClientEntityResolver as never,
    updateClientEntityResolver as never,
    capitalInvestorEntityResolver as never,
    createManualAccountEntityResolver as never,
    { getSummary: jest.fn(async () => ({ investors: [] })) } as never,
    compositionOrchestrator as never,
  );
  const actor = { tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: [] };
  const prepared = { conversationId: 'c1', workspaceId: 'w1', workspaceVersion: 1 };
  const basePlan = { businessAction: 'GET_LIQUIDITY', state: 'READY_FOR_CONFIRMATION', missingEntities: [], clarificationQuestions: [], warnings: [], confirmationTier: 'NONE', executionSteps: [{ stepId: 's1', capability: 'GET_LIQUIDITY', arguments: {}, dependsOn: [], estimatedEffects: [], reversibility: 'FULL' }], preview: {}, workspaceVersion: 1, entityVersions: {}, fingerprint: 'a'.repeat(64) };

  beforeEach(() => {
    jest.clearAllMocks();
    requests.claim.mockResolvedValue({ kind: 'OWNED', request });
    persistence.prepare.mockResolvedValue(prepared);
    persistence.checkpointPlan.mockResolvedValue({ actionRun: { id: 'run1' }, workspaceVersion: 2 });
    persistence.complete.mockImplementation((_id, _actor, response) => response);
    planner.plan.mockReturnValue(basePlan);
    readRunner.run.mockResolvedValue({ executionState: 'COMPLETED', stepResults: [{ stepId: 's1', result: { data: { total: '100.00' }, summary: 'bounded' } }], warnings: [], traceId: 'trace-1', durationMs: 1 });
  });

  it.each(['GET_LIQUIDITY', 'GET_MONTHLY_PROFIT', 'SEARCH_INVENTORY', 'SEARCH_CLIENT', 'GET_CLIENT_ACCOUNTS'] as const)('executes approved Tier 0 read %s end to end', async (intent) => {
    const plan = { ...basePlan, businessAction: intent, executionSteps: [{ ...basePlan.executionSteps[0], capability: intent }] };
    planner.plan.mockReturnValue(plan);
    const response = await service.execute(actor, { intent, entities: intent === 'GET_MONTHLY_PROFIT' ? { year: 2026, month: 8 } : intent === 'GET_CLIENT_ACCOUNTS' ? { clientId: 'client-1' } : intent.startsWith('SEARCH') ? { query: 'x' } : {}, surface: 'API', clientRequestId: `req-${intent}` });
    expect(readRunner.run).toHaveBeenCalledTimes(1);
    expect(response.interactionState).toBe('COMPLETED');
    expect(response.responseType).toBe(intent.startsWith('GET_') && intent !== 'GET_CLIENT_ACCOUNTS' ? 'METRIC_BREAKDOWN' : 'ENTITY_LIST');
  });

  it('persists grouped clarification and never executes a read', async () => {
    planner.plan.mockReturnValue({ ...basePlan, state: 'NEEDS_CLARIFICATION', missingEntities: [{ entity: 'year', question: 'Which year?' }, { entity: 'month', question: 'Which month?' }], executionSteps: [] });
    const response = await service.execute(actor, { intent: 'GET_MONTHLY_PROFIT', entities: {}, surface: 'API', clientRequestId: 'clarify' });
    expect(response.responseType).toBe('MISSING_FIELDS_CARD');
    expect(response.payload.groups).toHaveLength(1);
    expect(readRunner.run).not.toHaveBeenCalled();
    expect(persistence.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      2,
      expect.anything(),
      AIRequestStatus.NEEDS_CLARIFICATION,
      expect.objectContaining({ intent: 'GET_MONTHLY_PROFIT' }),
    );
  });

  it('marks REGISTER_PURCHASE preview as executable for confirmation without executing yet', async () => {
    planner.plan.mockReturnValue({
      ...basePlan,
      businessAction: 'REGISTER_PURCHASE',
      confirmationTier: 'HIGH',
      executionSteps: [{ ...basePlan.executionSteps[0], capability: 'REGISTER_PURCHASE' }],
    });
    const response = await service.execute(actor, {
      intent: 'REGISTER_PURCHASE',
      entities: {
        brand: 'Rolex',
        model: 'Daytona',
        cost: '350000',
        currency: 'MXN',
        paymentMode: 'CREDIT',
        sellerCounterpartyName: 'José',
      },
      surface: 'API',
      clientRequestId: 'write-purchase',
    });
    expect(response.responseType).toBe('ACTION_PREVIEW_CARD');
    expect(response.payload.executable).toBe(true);
    expect(response.payload.message).toBe('Revisa el resumen y confirma para registrar la compra.');
    expect(purchaseEntityResolver.resolve).toHaveBeenCalled();
    expect(readRunner.run).not.toHaveBeenCalled();
  });

  it('returns a truthful write preview without resolving or executing a binding for unbound writes', async () => {
    planner.plan.mockReturnValue({
      ...basePlan,
      businessAction: 'REGISTER_SETTLEMENT',
      confirmationTier: 'HIGH',
      executionSteps: [{ ...basePlan.executionSteps[0], capability: 'REGISTER_SETTLEMENT' }],
    });
    const response = await service.execute(actor, {
      intent: 'REGISTER_SETTLEMENT',
      entities: { amount: '1.00', currency: 'MXN' },
      surface: 'API',
      clientRequestId: 'write-unbound',
    });
    expect(response.responseType).toBe('ACTION_PREVIEW_CARD');
    expect(response.payload.message).toBe(
      'Esta acción todavía no está habilitada para ejecución desde el asistente.',
    );
    expect(response.payload.executable).toBe(false);
    expect(readRunner.run).not.toHaveBeenCalled();
  });

  it('marks REGISTER_EXPENSE preview as executable for confirmation without executing yet', async () => {
    planner.plan.mockReturnValue({
      ...basePlan,
      businessAction: 'REGISTER_EXPENSE',
      confirmationTier: 'MEDIUM',
      executionSteps: [{ ...basePlan.executionSteps[0], capability: 'REGISTER_EXPENSE' }],
    });
    const response = await service.execute(actor, {
      intent: 'REGISTER_EXPENSE',
      entities: { concept: 'gasolina', amount: '2500', currency: 'MXN', source: 'CASH' },
      surface: 'API',
      clientRequestId: 'write-expense',
    });
    expect(response.responseType).toBe('ACTION_PREVIEW_CARD');
    expect(response.payload.executable).toBe(true);
    expect(response.payload.message).toBe('Revisa el resumen y confirma para registrar el gasto.');
    expect(readRunner.run).not.toHaveBeenCalled();
  });

  it('marks REGISTER_SALE preview as executable for confirmation without executing yet', async () => {
    planner.plan.mockReturnValue({ ...basePlan, businessAction: 'REGISTER_SALE', confirmationTier: 'HIGH', executionSteps: [{ ...basePlan.executionSteps[0], capability: 'REGISTER_SALE' }] });
    const response = await service.execute(actor, { intent: 'REGISTER_SALE', entities: { watchId: 'w', customerId: 'c', price: '1.00', currency: 'USD', paymentMode: 'CREDIT' }, surface: 'API', clientRequestId: 'write-sale' });
    expect(response.responseType).toBe('ACTION_PREVIEW_CARD');
    expect(response.payload.executable).toBe(true);
    expect(response.payload.message).toBe('Revisa el resumen y confirma para registrar la venta.');
    expect(readRunner.run).not.toHaveBeenCalled();
  });

  it('marks REGISTER_RECEIVABLE_PAYMENT preview as executable for confirmation without executing yet', async () => {
    planner.plan.mockReturnValue({
      ...basePlan,
      businessAction: 'REGISTER_RECEIVABLE_PAYMENT',
      confirmationTier: 'HIGH',
      executionSteps: [{ ...basePlan.executionSteps[0], capability: 'REGISTER_RECEIVABLE_PAYMENT' }],
    });
    const response = await service.execute(actor, {
      intent: 'REGISTER_RECEIVABLE_PAYMENT',
      entities: { accountId: 'a1', amount: '35000.00', destination: 'BANK' },
      surface: 'API',
      clientRequestId: 'write-payment',
    });
    expect(receivablePaymentResolver.resolve).toHaveBeenCalled();
    expect(response.responseType).toBe('ACTION_PREVIEW_CARD');
    expect(response.payload.executable).toBe(true);
    expect(response.payload.message).toBe('Revisa el resumen y confirma para registrar el pago.');
    expect(readRunner.run).not.toHaveBeenCalled();
  });

  it('returns an exact durable replay without planning or persistence', async () => {
    const replay = { requestId: 'request-1', conversationId: 'c1', workspaceId: 'w1', interactionState: 'COMPLETED', responseType: 'METRIC_BREAKDOWN', payload: {}, warnings: [], suggestedActions: [], traceId: 'trace-1', createdAt: '2026-08-06T00:00:00Z' };
    requests.claim.mockResolvedValue({ kind: 'REPLAY', request, response: replay });
    await expect(service.execute(actor, { intent: 'GET_LIQUIDITY', entities: {}, surface: 'API', clientRequestId: 'replay' })).resolves.toBe(replay);
    expect(planner.plan).not.toHaveBeenCalled();
    expect(persistence.prepare).not.toHaveBeenCalled();
  });

  it('executeClaimed continues an already-claimed request WITHOUT calling claim() a second time', async () => {
    const response = await service.executeClaimed(actor, { intent: 'GET_LIQUIDITY', entities: {}, surface: 'MOBILE', clientRequestId: 'nl-1' }, request as never);
    expect(requests.claim).not.toHaveBeenCalled();
    expect(readRunner.run).toHaveBeenCalledTimes(1);
    expect(response.interactionState).toBe('COMPLETED');
  });

  it.each(['cross-tenant conversation', 'cross-tenant workspace', 'missing reference', 'soft-deleted reference'])('returns the same typed NOT_FOUND failure for %s', async () => {
    persistence.prepare.mockRejectedValue(new NotFoundException('AI resource not found'));
    requests.failUnattached.mockImplementation((_request, _actor, _intent, response) => response);
    const response = await service.execute(actor, { intent: 'GET_LIQUIDITY', entities: {}, surface: 'API', clientRequestId: 'not-found' });
    expect(response).toEqual(expect.objectContaining({ interactionState: 'FAILED', responseType: 'ERROR_RECOVERY_CARD', payload: expect.objectContaining({ errorType: 'NOT_FOUND', code: 'NOT_FOUND', message: 'No se encontró el recurso solicitado.' }) }));
    expect(planner.plan).not.toHaveBeenCalled();
    expect(readRunner.run).not.toHaveBeenCalled();
  });
});
