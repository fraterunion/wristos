import { buildIntentCandidate } from '../intent-candidate';
import { assertWithinTextLimit, decideConfidencePolicy, MAX_USER_TEXT_LENGTH, sanitizeConversationContext } from '../safety';

function candidateFor(output: unknown) {
  const result = buildIntentCandidate(output, '2026-07-15');
  if (result.kind !== 'VALID') throw new Error('expected a valid candidate in this test fixture');
  return result.candidate;
}

describe('safety: deterministic confidence policy (numeric confidence is advisory only)', () => {
  it('UNKNOWN never proceeds, regardless of confidence', () => {
    const candidate = candidateFor({ intent: 'UNKNOWN', confidence: 'HIGH' });
    expect(decideConfidencePolicy(candidate)).toEqual({ action: 'REJECT_UNKNOWN' });
  });

  it('LOW confidence never proceeds — for a read intent either', () => {
    const readCandidate = candidateFor({ intent: 'GET_LIQUIDITY', confidence: 'LOW' });
    expect(decideConfidencePolicy(readCandidate)).toEqual({ action: 'REJECT_LOW_CONFIDENCE' });

    const writeCandidate = candidateFor({ intent: 'REGISTER_SALE', confidence: 'LOW', entities: { watchQuery: 'Batman' } });
    expect(decideConfidencePolicy(writeCandidate)).toEqual({ action: 'REJECT_LOW_CONFIDENCE' });
  });

  it('a flagged ambiguity blocks silent proceeding even at HIGH confidence', () => {
    const candidate = candidateFor({
      intent: 'SEARCH_CLIENT',
      confidence: 'HIGH',
      entities: { query: 'José' },
      ambiguities: [{ field: 'amount', reason: '"35" could mean 35 or 35,000' }],
    });
    const decision = decideConfidencePolicy(candidate);
    expect(decision.action).toBe('CLARIFY_AMBIGUITY');
  });

  it('HIGH confidence with no ambiguity proceeds, even with missing entities (the planner clarifies those)', () => {
    const candidate = candidateFor({ intent: 'REGISTER_SALE', confidence: 'HIGH', entities: { watchQuery: 'Batman' }, missingEntities: ['watchId', 'customerId', 'price', 'currency'] });
    expect(decideConfidencePolicy(candidate)).toEqual({ action: 'PROCEED' });
  });

  it('MEDIUM confidence with no ambiguity proceeds (missing fields handled by the planner)', () => {
    const candidate = candidateFor({ intent: 'SEARCH_INVENTORY', confidence: 'MEDIUM', entities: { query: 'reloj' } });
    expect(decideConfidencePolicy(candidate)).toEqual({ action: 'PROCEED' });
  });

  it('never leaks the raw confidence value to the caller — only a decision', () => {
    const candidate = candidateFor({ intent: 'GET_LIQUIDITY', confidence: 'HIGH' });
    const decision = decideConfidencePolicy(candidate);
    expect(JSON.stringify(decision)).not.toMatch(/HIGH|MEDIUM|LOW|0\.\d/);
  });
});

describe('safety: text limits and bounded context', () => {
  it('rejects empty text', () => {
    expect(() => assertWithinTextLimit('')).toThrow();
  });

  it('rejects text over the configured limit', () => {
    expect(() => assertWithinTextLimit('a'.repeat(MAX_USER_TEXT_LENGTH + 1))).toThrow();
  });

  it('accepts text at the limit', () => {
    expect(() => assertWithinTextLimit('a'.repeat(MAX_USER_TEXT_LENGTH))).not.toThrow();
  });

  it('caps context list sizes and string lengths, never widening the input', () => {
    const sanitized = sanitizeConversationContext({
      lastIntent: 'SEARCH_CLIENT',
      lastPresentedCandidateIds: Array.from({ length: 50 }, (_, i) => `id-${i}`),
      pendingMissingFields: Array.from({ length: 50 }, (_, i) => `field-${i}`),
      lastResolvedEntities: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`key${i}`, 'x'.repeat(500)])),
    });
    expect(sanitized?.lastPresentedCandidateIds?.length).toBeLessThanOrEqual(5);
    expect(sanitized?.pendingMissingFields?.length).toBeLessThanOrEqual(5);
    expect(Object.keys(sanitized?.lastResolvedEntities ?? {}).length).toBeLessThanOrEqual(10);
    for (const value of Object.values(sanitized?.lastResolvedEntities ?? {})) {
      if (typeof value === 'string') expect(value.length).toBeLessThanOrEqual(120);
    }
  });

  it('passes through undefined context unchanged', () => {
    expect(sanitizeConversationContext(undefined)).toBeUndefined();
  });
});
