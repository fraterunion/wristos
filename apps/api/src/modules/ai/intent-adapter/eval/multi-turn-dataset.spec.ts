/**
 * Multi-turn conversational evaluation scenarios (deterministic, no live provider).
 * These exercise ReferenceResolver + working-context contracts used by V1.1.
 */
import { ReferenceResolverService } from '../../context/reference-resolver.service';
import { detectDeterministicReference, looksLikeAccountsContinuation } from '../../context/ordinal-reference';
import { stripUntrustedEntityIds, mergeTrustedIds } from '../../context/trusted-entities';
import {
  applyPresentedCandidates,
  applySelectedEntity,
  emptyWorkingContext,
} from '../../context/working-context';
import { trustedIdsFromResolution } from '../../context/reference-resolver.service';

const resolver = new ReferenceResolverService();

describe('multi-turn evaluation scenarios A–H', () => {
  it('A: Busca a José → 3 candidates → El primero → first trusted candidate', () => {
    const ctx = applyPresentedCandidates(emptyWorkingContext(), {
      type: 'CLIENT',
      candidates: [
        { id: 'j1', label: 'José A', ordinal: 1 },
        { id: 'j2', label: 'José B', ordinal: 2 },
        { id: 'j3', label: 'José C', ordinal: 3 },
      ],
    }, { lastIntent: 'SEARCH_CLIENT' });
    const ref = detectDeterministicReference('El primero.');
    const resolved = resolver.resolve(ref!, ctx);
    expect(resolved).toMatchObject({ kind: 'RESOLVED', id: 'j1' });
  });

  it('B: Busca Batman → one candidate → Ese → candidate', () => {
    const ctx = applyPresentedCandidates(emptyWorkingContext(), {
      type: 'WATCH',
      candidates: [{ id: 'w1', label: 'Batman', ordinal: 1 }],
    }, { lastIntent: 'SEARCH_INVENTORY' });
    const resolved = resolver.resolve(detectDeterministicReference('Ese.')!, ctx);
    expect(resolved).toMatchObject({ kind: 'RESOLVED', id: 'w1' });
  });

  it('C: selected José Hernández → Ahora sus cuentas → GET_CLIENT_ACCOUNTS ids', () => {
    const selected = applySelectedEntity(emptyWorkingContext(), {
      type: 'CLIENT',
      id: 'jh-1',
      label: 'José Hernández',
    });
    expect(looksLikeAccountsContinuation('Ahora sus cuentas.')).toBe(true);
    const resolved = resolver.resolve({ kind: 'LAST_SELECTED', entityType: 'CLIENT' }, selected);
    expect(resolved.kind).toBe('RESOLVED');
    if (resolved.kind === 'RESOLVED') {
      expect(trustedIdsFromResolution(resolved)).toEqual({ clientId: 'jh-1' });
    }
  });

  it('D: three watches + Ese → clarify', () => {
    const ctx = applyPresentedCandidates(emptyWorkingContext(), {
      type: 'WATCH',
      candidates: [
        { id: 'w1', label: 'A', ordinal: 1 },
        { id: 'w2', label: 'B', ordinal: 2 },
        { id: 'w3', label: 'C', ordinal: 3 },
      ],
    }, { lastIntent: 'SEARCH_INVENTORY' });
    expect(resolver.resolve(detectDeterministicReference('Ese.')!, ctx)).toMatchObject({
      kind: 'CLARIFY',
      failureType: 'AMBIGUOUS',
    });
  });

  it('E: two clients + El tercero → clarify', () => {
    const ctx = applyPresentedCandidates(emptyWorkingContext(), {
      type: 'CLIENT',
      candidates: [
        { id: 'c1', label: 'A', ordinal: 1 },
        { id: 'c2', label: 'B', ordinal: 2 },
      ],
    }, { lastIntent: 'SEARCH_CLIENT' });
    expect(resolver.resolve(detectDeterministicReference('El tercero.')!, ctx)).toMatchObject({
      kind: 'CLARIFY',
      failureType: 'OUT_OF_RANGE',
    });
  });

  it('F: fresh conversation + El primero → safe failure', () => {
    expect(resolver.resolve(detectDeterministicReference('El primero.')!, null)).toMatchObject({
      kind: 'CLARIFY',
      failureType: 'NO_CONTEXT',
    });
  });

  it('G: selected Batman + Lo vendí en 350 mil → trusted watchId for REGISTER_SALE preview only', () => {
    const selected = applySelectedEntity(emptyWorkingContext(), {
      type: 'WATCH',
      id: 'batman-id',
      label: 'Batman',
    });
    const entities = mergeTrustedIds(
      stripUntrustedEntityIds({ price: '350000.00', currency: 'MXN', watchId: 'user-forged' }),
      { watchId: selected.lastResolvedEntities!.watchId! },
    );
    expect(entities.watchId).toBe('batman-id');
    // Preview preparation only — execution still requires confirmation + WritePlanRunner.
  });

  it('H: malicious user-provided fake IDs are never trusted', () => {
    const stripped = stripUntrustedEntityIds({
      clientId: 'abc123',
      watchId: 'xyz',
      query: 'José',
    });
    expect(stripped).toEqual({ query: 'José' });
    expect(stripped).not.toHaveProperty('clientId');
  });
});
