import { NaturalLanguageAssistantService } from '../natural-language-assistant.service';
import { ReferenceResolverService } from '../../context/reference-resolver.service';
import { applyDraftPatch, entitiesToDraftPatch } from '../../context/conversation-draft';

/**
 * Regression coverage for the "expired picker hijacks a fresh operational
 * message" defect: a stale/irrelevant candidate list (ENTITY_PICKER) left
 * over from an abandoned clarification must never intercept — and must
 * never silently truncate the entities of — an unrelated, self-contained
 * new command. See NaturalLanguageAssistantService's picker-relevance gate
 * (top of handleMessage()) and the discardStaleReferenceContext flag.
 *
 * Test harness matches natural-language-assistant.service.spec.ts's own
 * convention: NaturalLanguageAssistantService is exercised directly with
 * its real ReferenceResolverService and real ConversationDraft helpers
 * (applyDraftPatch/entitiesToDraftPatch — never mocked), while
 * StructuredAssistantService/WorkingContextService/AIRequestService are
 * mocked at the same boundary every other test in this file mocks them —
 * StructuredAssistantService (Watch Intelligence, CRM resolution, the
 * planner) has its own dedicated spec files elsewhere in this module.
 */

function draftFromFlatEntities(capability: string, entities: Record<string, string | number | boolean>) {
  return applyDraftPatch(null, entitiesToDraftPatch(capability, entities), capability);
}

function buildService(overrides: {
  claimText?: jest.Mock;
  provider?: jest.Mock;
  executeClaimed?: jest.Mock;
  workingLoad?: jest.Mock;
  clearStalePickerCandidates?: jest.Mock;
  clarificationFieldLockResolve?: jest.Mock;
} = {}) {
  const request = { id: 'ar-1', traceId: 'trace-1', receivedAt: new Date('2026-08-13T00:00:00Z') };
  const aiRequests = {
    claimText: overrides.claimText ?? jest.fn().mockResolvedValue({ kind: 'OWNED', request }),
    recordInterpretation: jest.fn().mockResolvedValue(undefined),
    recordProviderMetrics: jest.fn().mockResolvedValue(undefined),
    readInterpretation: jest.fn().mockReturnValue({ intent: null, entities: {} }),
    auditReplay: jest.fn().mockResolvedValue(undefined),
    failUnattached: jest.fn().mockImplementation((_request, _actor, _intent, response) => response),
  };
  const intentAdapter = { interpret: overrides.provider ?? jest.fn() };
  const assistant = { executeClaimed: overrides.executeClaimed ?? jest.fn() };
  const referenceResolver = new ReferenceResolverService();
  const workingContext = {
    load: overrides.workingLoad ?? jest.fn().mockResolvedValue({ working: null, version: null, resolvedContextRaw: null }),
    persistSelection: jest.fn().mockResolvedValue({ version: 2, working: {} }),
    persistClarificationTurn: jest.fn().mockResolvedValue({ conversationId: 'c-new', workspaceId: 'w-new', version: 2 }),
    persistEntityPickerTurn: jest.fn().mockResolvedValue({ conversationId: 'c-new', workspaceId: 'w-new', version: 2 }),
    clearStalePickerCandidates: overrides.clearStalePickerCandidates ?? jest.fn().mockResolvedValue(undefined),
    readConversationDraft: jest.fn(
      (raw: unknown) => (raw as { conversationDraft?: unknown } | null)?.conversationDraft ?? null,
    ),
    buildAuditFromResolution: jest.fn().mockReturnValue({
      contextSchemaVersion: '1.1',
      contextVersion: 1,
      resolutionResult: 'RESOLVED',
    }),
  };
  const prisma = { aIRequest: { findFirst: jest.fn().mockResolvedValue(null) } };
  const compositionOrchestrator = {
    loadActive: jest.fn().mockResolvedValue({ composition: null, version: 1, resolvedContext: {} }),
    cancelComposition: jest.fn(),
    resumeParentAfterClient: jest.fn(),
  };
  const clarificationFieldLock = {
    resolve: overrides.clarificationFieldLockResolve ?? jest.fn().mockResolvedValue({ kind: 'NO_MATCH' }),
  };
  const service = new NaturalLanguageAssistantService(
    aiRequests as never,
    intentAdapter as never,
    assistant as never,
    referenceResolver,
    workingContext as never,
    prisma as never,
    compositionOrchestrator as never,
    clarificationFieldLock as never,
  );
  return { service, request, aiRequests, intentAdapter, assistant, workingContext, prisma, clarificationFieldLock };
}

const actor = { tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: [] as string[] };
const baseDto = { surface: 'MOBILE' as const, workspaceId: 'w1', conversationId: 'c1' };

/** A zero-match/ambiguous-CLIENT-style picker for "Abraham", exactly like the reported production evidence. */
const abrahamCandidates = {
  type: 'CLIENT' as const,
  candidates: [
    { id: 'client-abraham-diaz', label: 'Abraham Díaz', ordinal: 1 },
    { id: 'client-abraham-valdez', label: 'Abraham Valdez', ordinal: 2 },
    { id: 'client-abraham-bosquez', label: 'Abraham Bosquez', ordinal: 3 },
  ],
};

function stalePickerWorking(ageMs: number, opts: { pendingField?: boolean } = { pendingField: true }) {
  return {
    schemaVersion: '1.1' as const,
    contextUpdatedAt: new Date().toISOString(),
    lastIntent: 'REGISTER_SALE' as const,
    ...(opts.pendingField ? { pendingMissingFields: ['customerId'] } : {}),
    lastPresentedCandidates: {
      ...abrahamCandidates,
      presentedAt: new Date(Date.now() - ageMs).toISOString(),
    },
  };
}

function previewResponse() {
  return {
    requestId: 'ar-1',
    conversationId: 'c1',
    workspaceId: 'w1',
    interactionState: 'READY_FOR_CONFIRMATION' as const,
    responseType: 'ACTION_PREVIEW_CARD' as const,
    payload: {},
    warnings: [],
    suggestedActions: [],
    traceId: 'trace-1',
    createdAt: '2026-08-13T00:00:00.000Z',
  };
}

const STALE_MS = 60 * 60 * 1000; // 1h — past the 30 min TTL
const FRESH_MS = 60 * 1000; // 1 min — well within TTL

describe('Stale/expired picker never hijacks a fresh operational message', () => {
  // --- Part 21 / A — the exact reported production evidence ---
  it('[A] production evidence: a stale Abraham picker + a brand-new rich sale sentence never returns EXPIRED, and every extracted slot survives untouched', async () => {
    const provider = jest.fn().mockResolvedValue({
      kind: 'CANDIDATE',
      candidate: {
        intent: 'REGISTER_SALE',
        entities: {
          watchQuery: 'Bruce Wayne',
          price: '500000',
          customerQuery: 'Abraham',
          destination: 'BANCOS',
        },
        // Even if the provider itself still emits a reference (e.g. it saw
        // stale presented_candidates before this turn's context was
        // cleaned), it must never be honored once the picker-relevance
        // gate already decided this message doesn't engage that picker.
        reference: { kind: 'SINGLE_PRESENTED', entityType: 'CLIENT' },
        missingEntities: [],
        ambiguities: [],
        confidence: 'HIGH',
        language: 'es',
        isReadIntent: false,
        isWriteIntent: true,
        candidateHash: 'hash-rich-sale',
      },
      provider: 'claude',
      model: 'claude-x',
      latencyMs: 400,
      schemaVersion: '1.0.0',
    });
    const executeClaimed = jest.fn().mockResolvedValue(previewResponse());
    const workingLoad = jest.fn().mockResolvedValue({
      working: stalePickerWorking(STALE_MS),
      version: 7,
      resolvedContextRaw: {},
    });
    const { service } = buildService({ provider, executeClaimed, workingLoad });

    const result = await service.handleMessage(actor, {
      ...baseDto,
      text: 'Vendí Bruce Wayne en 500 mil a Abraham y me pagó por bancos.',
      clientRequestId: 'evidence-1',
    });

    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.resolvedIntent).toBe('REGISTER_SALE');
    expect(result.response.responseType).not.toBe('MISSING_FIELDS_CARD');
    expect(String(result.response.payload?.code ?? '')).not.toBe('EXPIRED');
    expect(executeClaimed).toHaveBeenCalledTimes(1);
    const [, structuredRequest] = executeClaimed.mock.calls[0];
    expect(structuredRequest.entities.watchQuery).toBe('Bruce Wayne');
    expect(structuredRequest.entities.price).toBe('500000');
    expect(structuredRequest.entities.customerQuery).toBe('Abraham');
    expect(structuredRequest.entities.destination).toBe('BANCOS');
  });

  // --- B — stale picker + a different-capability fresh command ---
  it('[B] stale picker + a fresh expense sentence routes to REGISTER_EXPENSE, not picker failure', async () => {
    const provider = jest.fn().mockResolvedValue({
      kind: 'CANDIDATE',
      candidate: {
        intent: 'REGISTER_EXPENSE',
        entities: { amount: '500', currency: 'MXN', category: 'gasolina' },
        missingEntities: [],
        ambiguities: [],
        confidence: 'HIGH',
        language: 'es',
        isReadIntent: false,
        isWriteIntent: true,
        candidateHash: 'hash-expense',
      },
      provider: 'claude',
      model: 'claude-x',
      latencyMs: 200,
      schemaVersion: '1.0.0',
    });
    const executeClaimed = jest.fn().mockResolvedValue(previewResponse());
    const workingLoad = jest.fn().mockResolvedValue({
      working: stalePickerWorking(STALE_MS),
      version: 7,
      resolvedContextRaw: {},
    });
    const { service } = buildService({ provider, executeClaimed, workingLoad });

    const result = await service.handleMessage(actor, {
      ...baseDto,
      text: 'Gasté 500 pesos en gasolina.',
      clientRequestId: 'evidence-2',
    });

    expect(result.resolvedIntent).toBe('REGISTER_EXPENSE');
    expect(String(result.response.payload?.code ?? '')).not.toBe('EXPIRED');
  });

  // --- F — a still-FRESH (not expired) picker also yields to a fresh high-confidence command ---
  it('[F] a FRESH, still-active picker still yields to a clearly new high-confidence operation (topic switch, not picker noise)', async () => {
    const provider = jest.fn().mockResolvedValue({
      kind: 'CANDIDATE',
      candidate: {
        intent: 'REGISTER_EXPENSE',
        entities: { amount: '500', currency: 'MXN', category: 'gasolina' },
        missingEntities: [],
        ambiguities: [],
        confidence: 'HIGH',
        language: 'es',
        isReadIntent: false,
        isWriteIntent: true,
        candidateHash: 'hash-expense-2',
      },
      provider: 'claude',
      model: 'claude-x',
      latencyMs: 200,
      schemaVersion: '1.0.0',
    });
    const executeClaimed = jest.fn().mockResolvedValue(previewResponse());
    const workingLoad = jest.fn().mockResolvedValue({
      working: stalePickerWorking(FRESH_MS),
      version: 7,
      resolvedContextRaw: {},
    });
    const { service } = buildService({ provider, executeClaimed, workingLoad });

    const result = await service.handleMessage(actor, {
      ...baseDto,
      text: 'Gasté 500 pesos en gasolina.',
      clientRequestId: 'evidence-3',
    });

    expect(result.resolvedIntent).toBe('REGISTER_EXPENSE');
    expect(String(result.response.payload?.code ?? '')).not.toBe('EXPIRED');
  });

  // --- G / H — currency policy: absent unless stated, retained when explicit ---
  it('[G] a rich sale WITHOUT explicit currency leaves currency absent — never forces MXN', async () => {
    const provider = jest.fn().mockResolvedValue({
      kind: 'CANDIDATE',
      candidate: {
        intent: 'REGISTER_SALE',
        entities: { watchQuery: 'Bruce Wayne', price: '500000', customerQuery: 'Abraham', destination: 'BANCOS' },
        missingEntities: [],
        ambiguities: [],
        confidence: 'HIGH',
        language: 'es',
        isReadIntent: false,
        isWriteIntent: true,
        candidateHash: 'hash-g',
      },
      provider: 'claude',
      model: 'claude-x',
      latencyMs: 300,
      schemaVersion: '1.0.0',
    });
    const executeClaimed = jest.fn().mockResolvedValue(previewResponse());
    const workingLoad = jest.fn().mockResolvedValue({ working: null, version: null, resolvedContextRaw: null });
    const { service } = buildService({ provider, executeClaimed, workingLoad });

    await service.handleMessage(actor, {
      ...baseDto,
      text: 'Vendí Bruce Wayne en 500 mil a Abraham y me pagó por bancos.',
      clientRequestId: 'evidence-4',
    });

    const [, structuredRequest] = executeClaimed.mock.calls[0];
    expect(structuredRequest.entities.currency).toBeUndefined();
  });

  it('[H] a rich sale WITH explicit MXN retains it — no clarification forced', async () => {
    const provider = jest.fn().mockResolvedValue({
      kind: 'CANDIDATE',
      candidate: {
        intent: 'REGISTER_SALE',
        entities: {
          watchQuery: 'Bruce Wayne',
          price: '500000',
          currency: 'MXN',
          customerQuery: 'Abraham',
          destination: 'BANCOS',
        },
        missingEntities: [],
        ambiguities: [],
        confidence: 'HIGH',
        language: 'es',
        isReadIntent: false,
        isWriteIntent: true,
        candidateHash: 'hash-h',
      },
      provider: 'claude',
      model: 'claude-x',
      latencyMs: 300,
      schemaVersion: '1.0.0',
    });
    const executeClaimed = jest.fn().mockResolvedValue(previewResponse());
    const workingLoad = jest.fn().mockResolvedValue({ working: null, version: null, resolvedContextRaw: null });
    const { service } = buildService({ provider, executeClaimed, workingLoad });

    await service.handleMessage(actor, {
      ...baseDto,
      text: 'Vendí Bruce Wayne en 500 mil pesos a Abraham y me pagó por bancos.',
      clientRequestId: 'evidence-5',
    });

    const [, structuredRequest] = executeClaimed.mock.calls[0];
    expect(structuredRequest.entities.currency).toBe('MXN');
  });

  // --- D — a FRESH picker with an exact/positive typed match still resolves directly, no NLP ---
  it('[D] a FRESH picker + a positively-matching typed label resolves directly through the picker-relevance gate — no provider call', async () => {
    const provider = jest.fn();
    const executeClaimed = jest.fn().mockResolvedValue(previewResponse());
    const workingLoad = jest.fn().mockResolvedValue({
      working: stalePickerWorking(FRESH_MS, { pendingField: false }),
      version: 4,
      resolvedContextRaw: {
        conversationDraft: draftFromFlatEntities('REGISTER_SALE', {
          watchQuery: 'Bruce Wayne',
          price: '500000.00',
          currency: 'MXN',
          customerQuery: 'Abraham',
        }),
      },
    });
    const { service } = buildService({ provider, executeClaimed, workingLoad });

    const result = await service.handleMessage(actor, { ...baseDto, text: 'Valdez', clientRequestId: 'evidence-6' });

    expect(provider).not.toHaveBeenCalled();
    expect(result.resolvedIntent).toBe('REGISTER_SALE');
    const [, structuredRequest] = executeClaimed.mock.calls[0];
    expect(structuredRequest.entities.customerId).toBe('client-abraham-valdez');
    expect(structuredRequest.entities.watchQuery).toBe('Bruce Wayne');
  });

  // --- Part 15 companion (typed match against an EXPIRED list, no pendingField at all) ---
  it('a typed match against an EXPIRED picker with NO pendingField still fails closed (Part 15 applies independently of the pendingField gate)', async () => {
    const provider = jest.fn();
    const executeClaimed = jest.fn();
    const workingLoad = jest.fn().mockResolvedValue({
      working: stalePickerWorking(STALE_MS, { pendingField: false }),
      version: 7,
      resolvedContextRaw: {},
    });
    const { service } = buildService({ provider, executeClaimed, workingLoad });

    const result = await service.handleMessage(actor, { ...baseDto, text: 'Valdez', clientRequestId: 'evidence-7' });

    expect(provider).not.toHaveBeenCalled();
    expect(executeClaimed).not.toHaveBeenCalled();
    expect(result.resolvedIntent).toBe('UNKNOWN');
    expect(String(result.response.payload.message)).toMatch(/elijas nuevamente/i);
  });

  // --- Part 16 — fresh picker + no positive match + not a recognizable command either ---
  it('[Part 16] fresh picker + unrecognizable, non-matching text falls through to the normal safe fallback — never forces an arbitrary candidate', async () => {
    const provider = jest.fn().mockResolvedValue({
      kind: 'CANDIDATE',
      candidate: {
        intent: 'UNKNOWN',
        entities: {},
        missingEntities: [],
        ambiguities: [],
        confidence: 'LOW',
        language: 'es',
        isReadIntent: false,
        isWriteIntent: false,
        candidateHash: 'hash-gibberish',
      },
      provider: 'claude',
      model: 'claude-x',
      latencyMs: 100,
      schemaVersion: '1.0.0',
    });
    const executeClaimed = jest.fn();
    const workingLoad = jest.fn().mockResolvedValue({
      working: stalePickerWorking(FRESH_MS, { pendingField: false }),
      version: 4,
      resolvedContextRaw: {},
    });
    const { service } = buildService({ provider, executeClaimed, workingLoad });

    const result = await service.handleMessage(actor, {
      ...baseDto,
      text: 'eh no sé, qué tal todo',
      clientRequestId: 'evidence-8',
    });

    expect(provider).toHaveBeenCalledTimes(1);
    expect(executeClaimed).not.toHaveBeenCalled();
    expect(result.resolvedIntent).toBe('UNKNOWN');
  });

  // --- O — stale/irrelevant candidates are cleared from storage on a fresh command ---
  it('[O] a no-match message against a stale picker best-effort clears the stored candidate list so it cannot hijack the next turn', async () => {
    const provider = jest.fn().mockResolvedValue({
      kind: 'CANDIDATE',
      candidate: {
        intent: 'REGISTER_EXPENSE',
        entities: { amount: '500' },
        missingEntities: [],
        ambiguities: [],
        confidence: 'HIGH',
        language: 'es',
        isReadIntent: false,
        isWriteIntent: true,
        candidateHash: 'hash-o',
      },
      provider: 'claude',
      model: 'claude-x',
      latencyMs: 100,
      schemaVersion: '1.0.0',
    });
    const executeClaimed = jest.fn().mockResolvedValue(previewResponse());
    const clearStalePickerCandidates = jest.fn().mockResolvedValue(undefined);
    const workingLoad = jest.fn().mockResolvedValue({
      working: stalePickerWorking(STALE_MS),
      version: 7,
      resolvedContextRaw: {},
    });
    const { service } = buildService({ provider, executeClaimed, workingLoad, clearStalePickerCandidates });

    await service.handleMessage(actor, { ...baseDto, text: 'Gasté 500 pesos en gasolina.', clientRequestId: 'evidence-9' });

    expect(clearStalePickerCandidates).toHaveBeenCalledWith('t1', 'u1', 'w1', 7);
  });

  // --- Same-capability restart must not silently re-merge the abandoned draft's stale fields ---
  it('a same-capability restart (stale REGISTER_SALE clarification, fresh REGISTER_SALE sentence) never re-merges the old draft — only the provider\'s own fresh extraction is used', async () => {
    const provider = jest.fn().mockResolvedValue({
      kind: 'CANDIDATE',
      candidate: {
        intent: 'REGISTER_SALE',
        entities: { watchQuery: 'Nautilus', price: '900000', customerQuery: 'Marcela', destination: 'CASH' },
        missingEntities: [],
        ambiguities: [],
        confidence: 'HIGH',
        language: 'es',
        isReadIntent: false,
        isWriteIntent: true,
        candidateHash: 'hash-restart',
      },
      provider: 'claude',
      model: 'claude-x',
      latencyMs: 300,
      schemaVersion: '1.0.0',
    });
    const executeClaimed = jest.fn().mockResolvedValue(previewResponse());
    const workingLoad = jest.fn().mockResolvedValue({
      working: stalePickerWorking(STALE_MS),
      version: 7,
      resolvedContextRaw: {
        // An OLD, abandoned Bruce Wayne / Abraham draft the fresh Nautilus
        // sale must never leak fields from.
        conversationDraft: draftFromFlatEntities('REGISTER_SALE', {
          watchQuery: 'Bruce Wayne',
          price: '500000.00',
          currency: 'MXN',
          customerQuery: 'Abraham',
        }),
      },
    });
    const { service } = buildService({ provider, executeClaimed, workingLoad });

    await service.handleMessage(actor, {
      ...baseDto,
      text: 'Vendí un Nautilus en 900 mil a Marcela y me pagó en efectivo.',
      clientRequestId: 'evidence-10',
    });

    const [, structuredRequest] = executeClaimed.mock.calls[0];
    expect(structuredRequest.entities.watchQuery).toBe('Nautilus');
    expect(structuredRequest.entities.customerQuery).toBe('Marcela');
    expect(structuredRequest.entities.price).toBe('900000');
    // The abandoned draft's currency must never bleed into an unrelated sale.
    expect(structuredRequest.entities.currency).toBeUndefined();
  });
});
