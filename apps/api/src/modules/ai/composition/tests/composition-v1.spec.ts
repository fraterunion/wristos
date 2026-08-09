import {
  ALLOWED_COMPOSITION_EDGES,
  COMPOSITION_MAX_DEPTH,
  COMPOSITION_CANCEL_ID,
  COMPOSITION_SEARCH_ID,
  compositionCreateSentinel,
  compositionStateSchema,
  hashParentDraft,
  isAllowedCompositionEdge,
  parseCompositionCreateSentinel,
} from '../composition.types';

describe('Controlled Action Composition V1', () => {
  it('composition graph is a closed allowlist', () => {
    expect(ALLOWED_COMPOSITION_EDGES).toEqual([
      { parent: 'REGISTER_PURCHASE', reason: 'PURCHASE_SELLER', child: 'CREATE_CLIENT' },
      { parent: 'REGISTER_SALE', reason: 'SALE_CUSTOMER', child: 'CREATE_CLIENT' },
    ]);
    expect(COMPOSITION_MAX_DEPTH).toBe(1);
  });

  it('rejects non-allowlisted edges including receivable payment', () => {
    expect(isAllowedCompositionEdge('REGISTER_PURCHASE', 'PURCHASE_SELLER', 'CREATE_CLIENT')).toBe(true);
    expect(isAllowedCompositionEdge('REGISTER_SALE', 'SALE_CUSTOMER', 'CREATE_CLIENT')).toBe(true);
    expect(
      isAllowedCompositionEdge('REGISTER_RECEIVABLE_PAYMENT', 'PURCHASE_SELLER', 'CREATE_CLIENT'),
    ).toBe(false);
    expect(
      isAllowedCompositionEdge('REGISTER_RECEIVABLE_PAYMENT', 'SALE_CUSTOMER', 'CREATE_CLIENT'),
    ).toBe(false);
    expect(isAllowedCompositionEdge('REGISTER_EXPENSE', 'PURCHASE_SELLER', 'CREATE_CLIENT')).toBe(false);
    expect(isAllowedCompositionEdge('CREATE_CLIENT', 'PURCHASE_SELLER', 'REGISTER_PURCHASE')).toBe(
      false,
    );
    expect(isAllowedCompositionEdge('REGISTER_PURCHASE', 'PURCHASE_SELLER', 'REGISTER_SALE')).toBe(
      false,
    );
  });

  it('parent draft hash is deterministic', () => {
    const a = hashParentDraft({ brand: 'Rolex', cost: 300000, sellerQuery: 'Pepe' });
    const b = hashParentDraft({ sellerQuery: 'Pepe', cost: 300000, brand: 'Rolex' });
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
  });

  it('composition state schema accepts bounded parent draft only', () => {
    const now = new Date().toISOString();
    const parsed = compositionStateSchema.safeParse({
      schemaVersion: '1.0',
      compositionId: 'abcdef1234567890abcd',
      state: 'DEPENDENCY_REQUIRED',
      parentCapability: 'REGISTER_PURCHASE',
      dependencyReason: 'PURCHASE_SELLER',
      dependencyQuery: 'Pepe',
      parentDraftEntities: { brand: 'Rolex', model: 'Daytona', cost: 300000, paymentMode: 'CREDIT' },
      parentDraftHash: hashParentDraft({
        brand: 'Rolex',
        model: 'Daytona',
        cost: 300000,
        paymentMode: 'CREDIT',
      }),
      childCapability: 'CREATE_CLIENT',
      createdAt: now,
      updatedAt: now,
    });
    expect(parsed.success).toBe(true);
  });

  it('composition create sentinels round-trip without looking like CRM ids', () => {
    const id = compositionCreateSentinel('Pepe');
    expect(id.startsWith('__COMPOSITION_CREATE_CLIENT__|')).toBe(true);
    expect(parseCompositionCreateSentinel(id)).toBe('Pepe');
    expect(COMPOSITION_SEARCH_ID).toBe('__COMPOSITION_SEARCH_CLIENT__');
    expect(COMPOSITION_CANCEL_ID).toBe('__COMPOSITION_CANCEL__');
  });

  it('one confirmation authorizes at most one mutation capability (architectural invariant)', () => {
    // V1 composition never lists a multi-write edge.
    for (const edge of ALLOWED_COMPOSITION_EDGES) {
      expect(edge.child).toBe('CREATE_CLIENT');
      expect(edge.parent).not.toBe(edge.child);
    }
    expect(COMPOSITION_MAX_DEPTH).toBe(1);
  });
});
