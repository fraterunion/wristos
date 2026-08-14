import { NaturalLanguageAssistantService } from '../../intent-adapter/natural-language-assistant.service';
import { IntentAdapterService } from '../../intent-adapter/intent-adapter.service';
import { ReferenceResolverService } from '../../context/reference-resolver.service';
import { OperationalIntentRouterService } from '../operational-intent-router.service';

/**
 * Proves the actual wiring inside NaturalLanguageAssistantService.handleMessage()
 * — not just the router in isolation. Uses the REAL OperationalIntentRouterService
 * (it's pure/synchronous, safe to use directly in tests) so this is a true
 * end-to-end check that a HIGH_CONFIDENCE_OPERATION message never reaches
 * IntentAdapterService.interpret() (the provider), and that everything else
 * still falls through to it exactly as before this feature existed.
 */
function buildService(overrides: {
  provider?: jest.Mock;
  executeClaimed?: jest.Mock;
  workingLoad?: jest.Mock;
  clearStalePickerCandidates?: jest.Mock;
} = {}) {
  const request = { id: 'ar-router-1', traceId: 'trace-router-1', receivedAt: new Date('2026-08-13T00:00:00Z') };
  const aiRequests = {
    claimText: jest.fn().mockResolvedValue({ kind: 'OWNED', request }),
    recordInterpretation: jest.fn().mockResolvedValue(undefined),
    recordProviderMetrics: jest.fn().mockResolvedValue(undefined),
    readInterpretation: jest.fn().mockReturnValue({ intent: null, entities: {} }),
    auditReplay: jest.fn().mockResolvedValue(undefined),
    failUnattached: jest.fn().mockImplementation((_request, _actor, _intent, response) => response),
  };
  const provider = overrides.provider ?? jest.fn();
  // Real IntentAdapterService (not a mock) — it's the class under test's
  // actual collaborator for both the LLM path (provider.interpret, mocked
  // here) and the router path (interpretDeterministic, exercised for real).
  const intentAdapter = new IntentAdapterService({ interpret: provider } as never);
  const executeClaimed =
    overrides.executeClaimed ??
    jest.fn().mockResolvedValue({
      requestId: 'ar-router-1',
      conversationId: 'c1',
      workspaceId: 'w1',
      interactionState: 'NEEDS_INPUT',
      responseType: 'MISSING_FIELDS_CARD',
      payload: { capability: 'REGISTER_SALE' },
      warnings: [],
      suggestedActions: [],
      traceId: 'trace-router-1',
      createdAt: '2026-08-13T00:00:00.000Z',
    });
  const assistant = { executeClaimed };
  const referenceResolver = new ReferenceResolverService();
  const workingContext = {
    load: overrides.workingLoad ?? jest.fn().mockResolvedValue({ working: null, version: null, resolvedContextRaw: null }),
    persistSelection: jest.fn().mockResolvedValue({ version: 2, working: {} }),
    persistClarificationTurn: jest.fn().mockResolvedValue({ conversationId: 'c1', workspaceId: 'w1', version: 2 }),
    persistEntityPickerTurn: jest.fn().mockResolvedValue({ conversationId: 'c1', workspaceId: 'w1', version: 2 }),
    clearStalePickerCandidates: overrides.clearStalePickerCandidates ?? jest.fn().mockResolvedValue(undefined),
    readConversationDraft: jest.fn(
      (raw: unknown) => (raw as { conversationDraft?: unknown } | null)?.conversationDraft ?? null,
    ),
    buildAuditFromResolution: jest.fn().mockReturnValue({ contextSchemaVersion: '1.1', contextVersion: 1, resolutionResult: 'RESOLVED' }),
  };
  const prisma = { aIRequest: { findFirst: jest.fn().mockResolvedValue(null) } };
  const compositionOrchestrator = {
    loadActive: jest.fn().mockResolvedValue({ composition: null, version: 1, resolvedContext: {} }),
  };
  const clarificationFieldLock = { resolve: jest.fn().mockResolvedValue({ kind: 'NO_MATCH' }) };

  const service = new NaturalLanguageAssistantService(
    aiRequests as never,
    intentAdapter as never,
    assistant as never,
    referenceResolver,
    workingContext as never,
    prisma as never,
    compositionOrchestrator as never,
    clarificationFieldLock as never,
    new OperationalIntentRouterService(),
  );
  return { service, provider, executeClaimed, aiRequests };
}

const actor = { tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: [] as string[] };

/** Shape IntentAdapterProvider.interpret() actually returns (IntentInterpretationRawResult), not IntentAdapterOutcome. */
function fakeProviderResult(rawOutput: Record<string, unknown>) {
  return { output: rawOutput, provider: 'fake', model: 'fake', latencyMs: 1 };
}

describe('NaturalLanguageAssistantService + OperationalIntentRouterService — real integration', () => {
  it('a HIGH_CONFIDENCE_OPERATION message never calls the provider — the router candidate flows straight to executeClaimed', async () => {
    const { service, provider, executeClaimed } = buildService();

    await service.handleMessage(actor, {
      text: 'Vendí Bruce Wayne en 500k.',
      surface: 'DESKTOP',
      clientRequestId: 'router-msg-1',
    });

    expect(provider).not.toHaveBeenCalled();
    expect(executeClaimed).toHaveBeenCalledTimes(1);
    const [, structuredRequest] = executeClaimed.mock.calls[0];
    expect(structuredRequest.intent).toBe('REGISTER_SALE');
    expect(structuredRequest.entities.watchQuery).toBe('Bruce Wayne');
    expect(structuredRequest.entities.price).toBe('500000.00');
  });

  it('an AMBIGUOUS_OPERATION message ("Pagué 50 mil.") still calls the provider, unchanged from today', async () => {
    const provider = jest.fn().mockResolvedValue(
      fakeProviderResult({
        intent: 'UNKNOWN',
        entities: {},
        missingEntities: [],
        ambiguities: [],
        confidence: 'LOW',
        language: 'es',
      }),
    );
    const { service } = buildService({ provider });

    await service.handleMessage(actor, {
      text: 'Pagué 50 mil.',
      surface: 'DESKTOP',
      clientRequestId: 'router-msg-2',
    });

    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('a NO_OPERATION_MATCH message (plain READ query) still calls the provider, unchanged from today', async () => {
    const provider = jest.fn().mockResolvedValue(
      fakeProviderResult({
        intent: 'GET_LIQUIDITY',
        entities: {},
        missingEntities: [],
        ambiguities: [],
        confidence: 'HIGH',
        language: 'es',
      }),
    );
    const { service } = buildService({ provider });

    await service.handleMessage(actor, {
      text: 'Muéstrame mi liquidez',
      surface: 'DESKTOP',
      clientRequestId: 'router-msg-3',
    });

    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('a negated message ("No vendí el Bruce Wayne.") never produces a write — falls to the provider', async () => {
    const provider = jest.fn().mockResolvedValue(
      fakeProviderResult({
        intent: 'UNKNOWN',
        entities: {},
        missingEntities: [],
        ambiguities: [],
        confidence: 'LOW',
        language: 'es',
      }),
    );
    const { service } = buildService({ provider });

    await service.handleMessage(actor, {
      text: 'No vendí el Bruce Wayne.',
      surface: 'DESKTOP',
      clientRequestId: 'router-msg-4',
    });

    expect(provider).toHaveBeenCalledTimes(1);
  });
});

describe('NaturalLanguageAssistantService + OperationalIntentRouterService — PR #80 stale-picker precedence (hard integration gate)', () => {
  const staleAbrahamCandidates = {
    type: 'CLIENT' as const,
    presentedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h — past the 30 min TTL
    candidates: [
      { id: 'client-abraham-diaz', label: 'Abraham Díaz', ordinal: 1 },
      { id: 'client-abraham-valdez', label: 'Abraham Valdez', ordinal: 2 },
      { id: 'client-abraham-bosquez', label: 'Abraham Bosquez', ordinal: 3 },
    ],
  };

  it('[Part 19] a stale/expired picker is discarded, then the router — not the provider — resolves the fresh rich sale, with no EXPIRED and every rich slot intact', async () => {
    const provider = jest.fn();
    const executeClaimed = jest.fn().mockResolvedValue({
      requestId: 'ar-router-1', conversationId: 'c1', workspaceId: 'w1',
      interactionState: 'READY_FOR_CONFIRMATION', responseType: 'ACTION_PREVIEW_CARD',
      payload: {}, warnings: [], suggestedActions: [], traceId: 'trace-router-1', createdAt: '2026-08-13T00:00:00.000Z',
    });
    const workingLoad = jest.fn().mockResolvedValue({
      working: {
        schemaVersion: '1.1',
        contextUpdatedAt: new Date().toISOString(),
        lastIntent: 'REGISTER_SALE',
        pendingMissingFields: ['customerId'],
        lastPresentedCandidates: staleAbrahamCandidates,
      },
      version: 7,
      resolvedContextRaw: {},
    });
    const { service } = buildService({ provider, executeClaimed, workingLoad });

    const result = await service.handleMessage(actor, {
      text: 'Vendí Bruce Wayne en 500 mil a Abraham y me pagó por bancos.',
      surface: 'DESKTOP',
      clientRequestId: 'router-stale-1',
      workspaceId: 'w1',
      conversationId: 'c1',
    });

    expect(provider).not.toHaveBeenCalled();
    expect(result.resolvedIntent).toBe('REGISTER_SALE');
    expect(String(result.response.payload?.code ?? '')).not.toBe('EXPIRED');
    expect(String(result.response.payload?.message ?? '')).not.toMatch(/elijas nuevamente/i);
    const [, structuredRequest] = executeClaimed.mock.calls[0];
    expect(structuredRequest.entities.watchQuery).toBe('Bruce Wayne');
    expect(structuredRequest.entities.price).toBe('500000.00');
    expect(structuredRequest.entities.customerQuery).toBe('Abraham');
    expect(structuredRequest.entities.destination).toBe('BANCOS');
    expect(structuredRequest.entities.currency).toBeUndefined();
  });

  it('[Part 20] a FRESH picker still yields to a clearly new high-confidence operation — the router resolves REGISTER_EXPENSE, no picker error', async () => {
    const provider = jest.fn();
    const executeClaimed = jest.fn().mockResolvedValue({
      requestId: 'ar-router-1', conversationId: 'c1', workspaceId: 'w1',
      interactionState: 'READY_FOR_CONFIRMATION', responseType: 'ACTION_PREVIEW_CARD',
      payload: {}, warnings: [], suggestedActions: [], traceId: 'trace-router-1', createdAt: '2026-08-13T00:00:00.000Z',
    });
    const workingLoad = jest.fn().mockResolvedValue({
      working: {
        schemaVersion: '1.1',
        contextUpdatedAt: new Date().toISOString(),
        lastIntent: 'REGISTER_SALE',
        pendingMissingFields: ['customerId'],
        lastPresentedCandidates: { ...staleAbrahamCandidates, presentedAt: new Date().toISOString() },
      },
      version: 7,
      resolvedContextRaw: {},
    });
    const { service } = buildService({ provider, executeClaimed, workingLoad });

    const result = await service.handleMessage(actor, {
      text: 'Gasté 500 pesos en gasolina.',
      surface: 'DESKTOP',
      clientRequestId: 'router-fresh-topic-switch',
      workspaceId: 'w1',
      conversationId: 'c1',
    });

    expect(provider).not.toHaveBeenCalled();
    expect(result.resolvedIntent).toBe('REGISTER_EXPENSE');
    expect(String(result.response.payload?.code ?? '')).not.toBe('EXPIRED');
  });

  it('[Part 21] a genuine fresh-picker selection (typed exact candidate label) resumes the Draft directly — the router never intercepts it', async () => {
    const provider = jest.fn();
    const executeClaimed = jest.fn().mockResolvedValue({
      requestId: 'ar-router-1', conversationId: 'c1', workspaceId: 'w1',
      interactionState: 'READY_FOR_CONFIRMATION', responseType: 'ACTION_PREVIEW_CARD',
      payload: {}, warnings: [], suggestedActions: [], traceId: 'trace-router-1', createdAt: '2026-08-13T00:00:00.000Z',
    });
    const workingLoad = jest.fn().mockResolvedValue({
      working: {
        schemaVersion: '1.1',
        contextUpdatedAt: new Date().toISOString(),
        lastIntent: 'REGISTER_SALE',
        lastPresentedCandidates: { ...staleAbrahamCandidates, presentedAt: new Date().toISOString() },
      },
      version: 4,
      resolvedContextRaw: {},
    });
    const { service } = buildService({ provider, executeClaimed, workingLoad });

    const result = await service.handleMessage(actor, {
      text: 'Valdez',
      surface: 'DESKTOP',
      clientRequestId: 'router-picker-resume',
      workspaceId: 'w1',
      conversationId: 'c1',
    });

    expect(provider).not.toHaveBeenCalled();
    expect(result.resolvedIntent).toBe('REGISTER_SALE');
    const [, structuredRequest] = executeClaimed.mock.calls[0];
    expect(structuredRequest.entities.customerId).toBe('client-abraham-valdez');
  });

  it('[Part 15 companion] an explicit selection attempt against a genuinely dead list still fails closed, router never reached', async () => {
    const provider = jest.fn();
    const executeClaimed = jest.fn();
    const workingLoad = jest.fn().mockResolvedValue({
      working: {
        schemaVersion: '1.1',
        contextUpdatedAt: new Date().toISOString(),
        lastIntent: 'REGISTER_SALE',
        lastPresentedCandidates: staleAbrahamCandidates,
      },
      version: 4,
      resolvedContextRaw: {},
    });
    const { service } = buildService({ provider, executeClaimed, workingLoad });

    const result = await service.handleMessage(actor, {
      text: 'Valdez',
      surface: 'DESKTOP',
      clientRequestId: 'router-stale-selection',
      workspaceId: 'w1',
      conversationId: 'c1',
    });

    expect(provider).not.toHaveBeenCalled();
    expect(executeClaimed).not.toHaveBeenCalled();
    expect(result.response.payload?.code).toBe('EXPIRED');
  });
});

describe('NaturalLanguageAssistantService + OperationalIntentRouterService — [Part 18] reversal precedence untouched', () => {
  /**
   * The closed reversal allowlist (detectExpenseCorrectionLanguage /
   * detectTransferCorrectionLanguage) runs earlier in handleMessage() than
   * the router call site — structurally unreachable for the router to
   * intercept. The router also has no reversal-capable lexicon at all
   * (expense.lexicon.ts only matches gasté/gastamos/pagué-style verbs, never
   * "revierte"/"deshaz"/"borra"), so even a hypothetical ordering change
   * couldn't make it claim these phrases. Both guarantees verified live here.
   */
  it('"Deshaz eso." routes through the existing last-action reversal allowlist, never the router/provider', async () => {
    const provider = jest.fn();
    const executeClaimed = jest.fn();
    const workingLoad = jest.fn().mockResolvedValue({ working: null, version: null, resolvedContextRaw: null });
    const { service } = buildService({ provider, executeClaimed, workingLoad });

    const result = await service.handleMessage(actor, {
      text: 'Deshaz eso.',
      surface: 'DESKTOP',
      clientRequestId: 'router-reversal-1',
    });

    expect(provider).not.toHaveBeenCalled();
    // No last reversible action recorded in this fresh workspace -> fails
    // closed with a "nothing to undo" clarification, never a router/provider write.
    expect(result.resolvedIntent).toBe('UNKNOWN');
    expect(executeClaimed).not.toHaveBeenCalled();
  });

  it('"Revierte ese gasto." is caught by the existing deterministic expense-reversal detector — never reaches the router OR the provider', async () => {
    const provider = jest.fn();
    const executeClaimed = jest.fn().mockResolvedValue({
      requestId: 'ar-router-1', conversationId: 'c1', workspaceId: 'w1',
      interactionState: 'READY_FOR_CONFIRMATION', responseType: 'ACTION_PREVIEW_CARD',
      payload: {}, warnings: [], suggestedActions: [], traceId: 'trace-router-1', createdAt: '2026-08-13T00:00:00.000Z',
    });
    const { service } = buildService({ provider, executeClaimed });

    await service.handleMessage(actor, {
      text: 'Revierte ese gasto.',
      surface: 'DESKTOP',
      clientRequestId: 'router-reversal-2',
    });

    expect(provider).not.toHaveBeenCalled();
    const [, structuredRequest] = executeClaimed.mock.calls[0];
    expect(structuredRequest.intent).toBe('REVERSE_EXPENSE');
  });

  it('"Borra esa transferencia." is caught by the existing deterministic transfer-reversal detector — never reaches the router OR the provider', async () => {
    const provider = jest.fn();
    const executeClaimed = jest.fn().mockResolvedValue({
      requestId: 'ar-router-1', conversationId: 'c1', workspaceId: 'w1',
      interactionState: 'READY_FOR_CONFIRMATION', responseType: 'ACTION_PREVIEW_CARD',
      payload: {}, warnings: [], suggestedActions: [], traceId: 'trace-router-1', createdAt: '2026-08-13T00:00:00.000Z',
    });
    const { service } = buildService({ provider, executeClaimed });

    await service.handleMessage(actor, {
      text: 'Borra esa transferencia.',
      surface: 'DESKTOP',
      clientRequestId: 'router-reversal-3',
    });

    expect(provider).not.toHaveBeenCalled();
    const [, structuredRequest] = executeClaimed.mock.calls[0];
    expect(structuredRequest.intent).toBe('REVERSE_TREASURY_TRANSFER');
  });
});
