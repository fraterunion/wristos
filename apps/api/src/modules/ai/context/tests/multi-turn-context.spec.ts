import { ReferenceResolverService } from '../reference-resolver.service';
import { detectDeterministicReference, isPureReferentialUtterance, looksLikeAccountsContinuation } from '../ordinal-reference';
import { toProviderConversationContext } from '../provider-context';
import { stripUntrustedEntityIds, mergeTrustedIds } from '../trusted-entities';
import {
  AssistantWorkingContext,
  CANDIDATE_CONTEXT_TTL_MS,
  applyPresentedCandidates,
  applySelectedEntity,
  emptyWorkingContext,
  extractPresentedCandidatesFromEntityList,
  isCandidateContextFresh,
  mergePlanCheckpointIntoResolvedContext,
  readWorkingContext,
  writeWorkingContext,
} from '../working-context';
import { buildUserPrompt } from '../../intent-adapter/prompt-policy';
import { sanitizeConversationContext } from '../../intent-adapter/safety';

function clientsContext(count: number, presentedAt = new Date().toISOString()): AssistantWorkingContext {
  const base = emptyWorkingContext();
  return applyPresentedCandidates(
    base,
    {
      type: 'CLIENT',
      candidates: Array.from({ length: count }, (_, i) => ({
        id: `client-${i + 1}`,
        label: `José ${String.fromCharCode(65 + i)}`,
        ordinal: i + 1,
      })),
    },
    { lastIntent: 'SEARCH_CLIENT', lastResponseType: 'ENTITY_LIST', now: new Date(presentedAt) },
  );
}

describe('V1.1 multi-turn working context', () => {
  const resolver = new ReferenceResolverService();

  it('context builder extracts candidates only from trusted ENTITY_LIST payloads', () => {
    const presented = extractPresentedCandidatesFromEntityList({
      intent: 'SEARCH_CLIENT',
      data: {
        items: [
          { id: 'id1', name: 'José A' },
          { id: 'id2', name: 'José B' },
          { id: 'id3', name: 'José C' },
        ],
      },
    });
    expect(presented?.candidates.map((c) => c.id)).toEqual(['id1', 'id2', 'id3']);
    expect(presented?.candidates[0]?.ordinal).toBe(1);
  });

  it('provider context never includes trusted entity IDs or raw conversation history', () => {
    const working = applySelectedEntity(clientsContext(3), {
      type: 'CLIENT',
      id: 'client-1',
      label: 'José A',
    });
    const provider = toProviderConversationContext(working, 'es');
    const sanitized = sanitizeConversationContext(provider);
    const prompt = buildUserPrompt({
      userText: 'El primero.',
      locale: 'es-MX',
      timezone: 'UTC',
      allowedIntents: ['SEARCH_CLIENT'],
      currentDate: '2026-07-15',
      requestTraceId: 't1',
      conversationContext: sanitized,
    });
    expect(prompt).not.toContain('client-1');
    expect(prompt).not.toContain('id1');
    expect(prompt).not.toMatch(/raw conversation|message history/i);
    expect(JSON.stringify(sanitized)).not.toContain('client-1');
    expect(sanitized?.presentedCandidates?.[0]).toEqual(
      expect.objectContaining({ ordinal: 1, label: 'José A', type: 'CLIENT' }),
    );
  });

  it('ordinal first and second resolve to trusted candidates', () => {
    const ctx = clientsContext(3);
    const first = resolver.resolve({ kind: 'ORDINAL', ordinal: 1 }, ctx);
    const second = resolver.resolve({ kind: 'ORDINAL', ordinal: 2 }, ctx);
    expect(first).toMatchObject({ kind: 'RESOLVED', id: 'client-1', ordinal: 1 });
    expect(second).toMatchObject({ kind: 'RESOLVED', id: 'client-2', ordinal: 2 });
  });

  it('out-of-range ordinal fails safely', () => {
    const result = resolver.resolve({ kind: 'ORDINAL', ordinal: 3 }, clientsContext(2));
    expect(result).toMatchObject({ kind: 'CLARIFY', failureType: 'OUT_OF_RANGE' });
  });

  it('"ese" with a single candidate resolves; with multiple clarifies', () => {
    const single = resolver.resolve({ kind: 'LAST_SELECTED' }, clientsContext(1));
    expect(single).toMatchObject({ kind: 'RESOLVED', id: 'client-1', referenceKind: 'SINGLE_PRESENTED' });
    const multi = resolver.resolve({ kind: 'LAST_SELECTED' }, clientsContext(3));
    expect(multi).toMatchObject({ kind: 'CLARIFY', failureType: 'AMBIGUOUS' });
  });

  it('lastSelected client supports GET_CLIENT_ACCOUNTS continuation', () => {
    const selected = applySelectedEntity(clientsContext(1), {
      type: 'CLIENT',
      id: 'client-1',
      label: 'José Hernández',
    });
    expect(selected.lastResolvedEntities?.clientId).toBe('client-1');
    expect(looksLikeAccountsContinuation('Ahora sus cuentas.')).toBe(true);
    const ref = detectDeterministicReference('Ahora sus cuentas.');
    const resolved = resolver.resolve(ref!, selected);
    expect(resolved).toMatchObject({ kind: 'RESOLVED', id: 'client-1', entityType: 'CLIENT' });
  });

  it('no-context and expired context fail safely', () => {
    expect(resolver.resolve({ kind: 'ORDINAL', ordinal: 1 }, null)).toMatchObject({
      kind: 'CLARIFY',
      failureType: 'NO_CONTEXT',
    });
    const staleAt = new Date(Date.now() - CANDIDATE_CONTEXT_TTL_MS - 1000).toISOString();
    const stale = clientsContext(2, staleAt);
    expect(isCandidateContextFresh(stale)).toBe(false);
    expect(resolver.resolve({ kind: 'ORDINAL', ordinal: 1 }, stale)).toMatchObject({
      kind: 'CLARIFY',
      failureType: 'EXPIRED',
    });
  });

  it('workspace reset clears referential context (resolvedContext wiped)', () => {
    const shell = writeWorkingContext({}, clientsContext(2));
    expect(readWorkingContext(shell)).not.toBeNull();
    expect(readWorkingContext(null)).toBeNull();
    expect(readWorkingContext({})).toBeNull();
  });

  it('plan checkpoint merge preserves workingContext (no lost candidate list)', () => {
    const withCandidates = writeWorkingContext({}, clientsContext(3));
    const merged = mergePlanCheckpointIntoResolvedContext(withCandidates, {
      entityVersions: { client: 1 },
      planFingerprint: 'fp-1',
    });
    expect(merged.planFingerprint).toBe('fp-1');
    expect(readWorkingContext(merged)?.lastPresentedCandidates?.candidates).toHaveLength(3);
  });

  it('user-provided fake IDs are stripped; LLM cannot inject entity IDs', () => {
    const stripped = stripUntrustedEntityIds({
      query: 'José',
      clientId: 'abc123',
      watchId: 'xyz',
      price: '350000.00',
    });
    expect(stripped).toEqual({ query: 'José', price: '350000.00' });
    const merged = mergeTrustedIds(stripped, { clientId: 'client-1' });
    expect(merged.clientId).toBe('client-1');
    expect(merged).not.toHaveProperty('watchId');
  });

  it('write intent may receive trusted watchId for preview preparation', () => {
    const selected = applySelectedEntity(emptyWorkingContext(), {
      type: 'WATCH',
      id: 'watch-batman',
      label: 'Batman',
    });
    const entities = mergeTrustedIds(
      stripUntrustedEntityIds({ price: '350000.00', currency: 'MXN', watchId: 'forged' }),
      { watchId: selected.lastResolvedEntities!.watchId! },
    );
    expect(entities.watchId).toBe('watch-batman');
    expect(entities).not.toEqual(expect.objectContaining({ watchId: 'forged' }));
  });

  it('Spanish ordinal/deictic detection stays closed-form', () => {
    expect(detectDeterministicReference('El primero.')).toEqual({ kind: 'ORDINAL', ordinal: 1 });
    expect(detectDeterministicReference('el segundo')).toEqual({ kind: 'ORDINAL', ordinal: 2 });
    expect(detectDeterministicReference('Ese.')).toEqual({ kind: 'LAST_SELECTED' });
    expect(isPureReferentialUtterance('El primero.')).toBe(true);
    expect(isPureReferentialUtterance('Busca el primero')).toBe(false);
  });

  it('reference schema rejects arbitrary IDs inside reference objects', () => {
    const { intentReferenceSchema } = require('../reference-schema');
    expect(intentReferenceSchema.safeParse({ kind: 'ORDINAL', ordinal: 1, id: 'abc' }).success).toBe(false);
    expect(intentReferenceSchema.safeParse({ kind: 'ORDINAL', ordinal: 1 }).success).toBe(true);
  });
});
