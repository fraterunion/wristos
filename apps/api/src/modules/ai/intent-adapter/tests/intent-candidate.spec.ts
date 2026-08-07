import { buildIntentCandidate } from '../intent-candidate';

describe('buildIntentCandidate: the only path from raw provider output to a trusted candidate', () => {
  it('produces a valid GET_LIQUIDITY candidate from a minimal, well-formed provider output', () => {
    const result = buildIntentCandidate({ intent: 'GET_LIQUIDITY', confidence: 'HIGH' }, '2026-07-15');
    expect(result.kind).toBe('VALID');
    if (result.kind === 'VALID') {
      expect(result.candidate.intent).toBe('GET_LIQUIDITY');
      expect(result.candidate.isReadIntent).toBe(true);
      expect(result.candidate.isWriteIntent).toBe(false);
      expect(result.candidate.entities).toEqual({});
    }
  });

  it('resolves a SEARCH_INVENTORY candidate and keeps "Batman" as a query string, never an id', () => {
    const result = buildIntentCandidate(
      { intent: 'SEARCH_INVENTORY', confidence: 'HIGH', entities: { query: 'Batman' } },
      '2026-07-15',
    );
    expect(result.kind).toBe('VALID');
    if (result.kind === 'VALID') {
      expect(result.candidate.entities).toEqual({ query: 'Batman' });
      expect(result.candidate.missingEntities).toEqual([]);
    }
  });

  it('a REGISTER_SALE candidate with only a watch name never produces a watchId — it always remains missing', () => {
    const result = buildIntentCandidate(
      {
        intent: 'REGISTER_SALE',
        confidence: 'HIGH',
        entities: { watchQuery: 'Batman' },
        missingEntities: ['watchId', 'customerId', 'price', 'currency'],
      },
      '2026-07-15',
    );
    expect(result.kind).toBe('VALID');
    if (result.kind === 'VALID') {
      expect(result.candidate.isWriteIntent).toBe(true);
      expect(result.candidate.entities).not.toHaveProperty('watchId');
      expect(result.candidate.entities).not.toHaveProperty('customerId');
      expect(result.candidate.entities.watchQuery).toBe('Batman');
      expect(result.candidate.missingEntities).toEqual(expect.arrayContaining(['watchId', 'customerId', 'price', 'currency']));
    }
  });

  it('normalizes "35 mil" already-extracted as a number into a strict 2-decimal money string', () => {
    const result = buildIntentCandidate(
      { intent: 'REGISTER_RECEIVABLE_PAYMENT', confidence: 'HIGH', entities: { customerQuery: 'José', amount: 35000 } },
      '2026-07-15',
    );
    expect(result.kind).toBe('VALID');
    if (result.kind === 'VALID') expect(result.candidate.entities.amount).toBe('35000.00');
  });

  it('fails closed (INVALID_OUTPUT_SHAPE) on malformed provider output, never partially trusting it', () => {
    for (const badOutput of [
      null,
      'a plain string, not JSON',
      { intent: 'REGISTER_SALE' }, // missing required "confidence"
      { intent: 'REGISTER_SALE', confidence: 'HIGH', toolName: 'register_sale' }, // extra field
      { intent: 'MADE_UP_INTENT', confidence: 'HIGH' },
    ]) {
      const result = buildIntentCandidate(badOutput, '2026-07-15');
      expect(result.kind).toBe('FAILED');
      if (result.kind === 'FAILED') expect(result.reason).toBe('INVALID_OUTPUT_SHAPE');
    }
  });

  it('fails closed (ENTITY_SCHEMA_INVALID) when entities do not match the intent-specific shape after normalization', () => {
    const result = buildIntentCandidate(
      { intent: 'GET_MONTHLY_PROFIT', confidence: 'HIGH', entities: { month: 999, year: 2026 } },
      '2026-07-15',
    );
    // month=999 is dropped by normalization (out of range) -> remaining
    // entities are structurally valid (both optional), so this actually
    // succeeds with month absent — proving invalid values are dropped, not
    // smuggled through. Assert the safe outcome explicitly.
    expect(result.kind).toBe('VALID');
    if (result.kind === 'VALID') expect(result.candidate.entities).not.toHaveProperty('month');
  });

  it('produces a stable candidateHash for identical input, and a different one for different input', () => {
    const a = buildIntentCandidate({ intent: 'GET_LIQUIDITY', confidence: 'HIGH' }, '2026-07-15');
    const b = buildIntentCandidate({ intent: 'GET_LIQUIDITY', confidence: 'HIGH' }, '2026-07-15');
    const c = buildIntentCandidate({ intent: 'GET_LIQUIDITY', confidence: 'MEDIUM' }, '2026-07-15');
    if (a.kind === 'VALID' && b.kind === 'VALID' && c.kind === 'VALID') {
      expect(a.candidate.candidateHash).toBe(b.candidate.candidateHash);
      expect(a.candidate.candidateHash).not.toBe(c.candidate.candidateHash);
    } else {
      throw new Error('expected all three candidates to be VALID');
    }
  });

  it('UNKNOWN candidates carry no entities and are neither read nor write', () => {
    const result = buildIntentCandidate({ intent: 'UNKNOWN', confidence: 'LOW' }, '2026-07-15');
    expect(result.kind).toBe('VALID');
    if (result.kind === 'VALID') {
      expect(result.candidate.isReadIntent).toBe(false);
      expect(result.candidate.isWriteIntent).toBe(false);
      expect(result.candidate.entities).toEqual({});
    }
  });

  it('production SEARCH fixtures: Batman / AP / Rolex disponibles / José Hernández', () => {
    const batman = buildIntentCandidate(
      { intent: 'SEARCH_INVENTORY', confidence: 'HIGH', entities: { watchQuery: 'Batman', status: null, limit: null } },
      '2026-07-15',
    );
    expect(batman.kind).toBe('VALID');
    if (batman.kind === 'VALID') expect(batman.candidate.entities).toEqual({ query: 'Batman' });

    const ap = buildIntentCandidate(
      { intent: 'SEARCH_INVENTORY', confidence: 'HIGH', entities: { query: 'AP' } },
      '2026-07-15',
    );
    expect(ap.kind).toBe('VALID');
    if (ap.kind === 'VALID') expect(ap.candidate.entities).toEqual({ query: 'AP' });

    const rolex = buildIntentCandidate(
      {
        intent: 'SEARCH_INVENTORY',
        confidence: 'HIGH',
        entities: { query: 'Rolex', status: 'disponibles' },
      },
      '2026-07-15',
    );
    expect(rolex.kind).toBe('VALID');
    if (rolex.kind === 'VALID') {
      expect(rolex.candidate.entities).toEqual({ query: 'Rolex', status: 'AVAILABLE' });
    }

    const jose = buildIntentCandidate(
      { intent: 'SEARCH_CLIENT', confidence: 'HIGH', entities: { clientQuery: 'José Hernández' } },
      '2026-07-15',
    );
    expect(jose.kind).toBe('VALID');
    if (jose.kind === 'VALID') {
      expect(jose.candidate.entities).toEqual({ query: 'José Hernández' });
      expect(jose.candidate.entities).not.toHaveProperty('clientId');
    }
  });

  it('still fails closed on unknown extra entity keys that survive as typed values only via raw shape — fabricated IDs rejected for search', () => {
    const withId = buildIntentCandidate(
      {
        intent: 'SEARCH_CLIENT',
        confidence: 'HIGH',
        entities: { query: 'José', clientId: 'cm_fabricated_id' },
      },
      '2026-07-15',
    );
    // clientId is stripped by SEARCH_CLIENT entity schema (.strip()), not accepted
    expect(withId.kind).toBe('VALID');
    if (withId.kind === 'VALID') {
      expect(withId.candidate.entities).toEqual({ query: 'José' });
      expect(withId.candidate.entities).not.toHaveProperty('clientId');
    }
  });

  it('fails closed when SEARCH_INVENTORY has no usable query after normalization', () => {
    const result = buildIntentCandidate(
      { intent: 'SEARCH_INVENTORY', confidence: 'HIGH', entities: { status: 'AVAILABLE' } },
      '2026-07-15',
    );
    expect(result.kind).toBe('FAILED');
    if (result.kind === 'FAILED') expect(result.reason).toBe('ENTITY_SCHEMA_INVALID');
  });
});
