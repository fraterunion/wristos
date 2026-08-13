import {
  applyDraftPatch,
  draftToEntities,
  emptyDraft,
  entitiesToDraftPatch,
} from '../conversation-draft';

describe('conversation-draft: the typed Draft and its patch semantics', () => {
  describe('applyDraftPatch', () => {
    it('starts an empty ACTIVE draft when none exists', () => {
      const draft = applyDraftPatch(null, { watch: { raw: 'Bruce Wayne' } }, 'REGISTER_SALE');
      expect(draft.capability).toBe('REGISTER_SALE');
      expect(draft.status).toBe('ACTIVE');
      expect(draft.watch).toEqual({ raw: 'Bruce Wayne' });
    });

    it('PATCHes one field, leaving every other field untouched — the golden rule', () => {
      let draft = emptyDraft('REGISTER_SALE');
      draft = applyDraftPatch(draft, { watch: { raw: 'Bruce Wayne', resolvedId: 'watch-1', confidence: 'RESOLVED' } }, 'REGISTER_SALE');
      draft = applyDraftPatch(draft, { amount: { value: '500000.00', currency: 'MXN' } }, 'REGISTER_SALE');
      draft = applyDraftPatch(draft, { customer: { raw: 'Abraham', resolvedId: 'client-valdez', confidence: 'RESOLVED' } }, 'REGISTER_SALE');

      // The customer patch must not have touched watch or amount at all.
      expect(draft.watch).toEqual({ raw: 'Bruce Wayne', resolvedId: 'watch-1', confidence: 'RESOLVED' });
      expect(draft.amount).toEqual({ value: '500000.00', currency: 'MXN' });
      expect(draft.customer).toEqual({ raw: 'Abraham', resolvedId: 'client-valdez', confidence: 'RESOLVED' });
    });

    it('a correction replaces the whole sub-object it targets, not a partial merge within it', () => {
      let draft = emptyDraft('REGISTER_SALE');
      draft = applyDraftPatch(draft, { watch: { raw: 'Bruce Wayne', resolvedId: 'watch-1' } }, 'REGISTER_SALE');
      draft = applyDraftPatch(draft, { watch: { raw: 'Batman', resolvedId: 'watch-2' } }, 'REGISTER_SALE');
      expect(draft.watch).toEqual({ raw: 'Batman', resolvedId: 'watch-2' });
    });

    it('metadata merges key-by-key instead of replacing wholesale', () => {
      let draft = emptyDraft('REGISTER_EXPENSE');
      draft = applyDraftPatch(draft, { metadata: { category: 'GASOLINE' } }, 'REGISTER_EXPENSE');
      draft = applyDraftPatch(draft, { metadata: { description: 'Fill-up' } }, 'REGISTER_EXPENSE');
      expect(draft.metadata).toEqual({ category: 'GASOLINE', description: 'Fill-up' });
    });

    it('a capability change starts a brand-new Draft — an abandoned draft never leaks into an unrelated one', () => {
      let draft = emptyDraft('REGISTER_SALE');
      draft = applyDraftPatch(draft, { watch: { raw: 'Bruce Wayne' } }, 'REGISTER_SALE');
      const next = applyDraftPatch(draft, { watch: { raw: 'Panda' } }, 'REGISTER_PURCHASE');
      expect(next.capability).toBe('REGISTER_PURCHASE');
      expect(next.watch).toEqual({ raw: 'Panda' });
      // No trace of the abandoned REGISTER_SALE draft's own fields survives.
      expect(next.customer).toBeUndefined();
    });

    it('updatedAt advances on every patch', () => {
      const t0 = new Date('2026-01-01T00:00:00Z');
      const t1 = new Date('2026-01-01T00:05:00Z');
      const draft = applyDraftPatch(null, { watch: { raw: 'Bruce Wayne' } }, 'REGISTER_SALE', t0);
      const patched = applyDraftPatch(draft, { amount: { value: 100 } }, 'REGISTER_SALE', t1);
      expect(patched.updatedAt).toBe(t1.toISOString());
    });
  });

  describe('entitiesToDraftPatch + draftToEntities round-trip for REGISTER_SALE', () => {
    it('converts a full first-turn extraction into a patch with all sub-objects, and back losslessly', () => {
      const entities = {
        watchQuery: 'Bruce Wayne',
        price: '500000.00',
        currency: 'MXN',
        customerQuery: 'Abraham',
        paymentMode: 'PAID',
      };
      const patch = entitiesToDraftPatch('REGISTER_SALE', entities);
      expect(patch.watch).toEqual({ raw: 'Bruce Wayne', confidence: 'RAW' });
      expect(patch.amount).toEqual({ value: '500000.00', currency: 'MXN' });
      expect(patch.customer).toEqual({ raw: 'Abraham', confidence: 'RAW' });
      expect(patch.payment).toEqual({ account: undefined, mode: 'PAID' });

      const draft = applyDraftPatch(null, patch, 'REGISTER_SALE');
      const roundTripped = draftToEntities(draft);
      expect(roundTripped).toMatchObject(entities);
    });

    it('a resolver BOUND result (trusted id + label) round-trips with RESOLVED confidence', () => {
      const patch = entitiesToDraftPatch('REGISTER_SALE', {
        customerId: 'client-abraham-valdez',
        clientId: 'client-abraham-valdez',
        customerName: 'Abraham Valdez',
      });
      expect(patch.customer).toEqual({ raw: undefined, resolvedId: 'client-abraham-valdez', label: 'Abraham Valdez', confidence: 'RESOLVED' });

      const draft = applyDraftPatch(emptyDraft('REGISTER_SALE'), patch, 'REGISTER_SALE');
      const entities = draftToEntities(draft);
      expect(entities.customerId).toBe('client-abraham-valdez');
      expect(entities.clientId).toBe('client-abraham-valdez');
      expect(entities.customerName).toBe('Abraham Valdez');
    });

    it('unmapped fields fall through to metadata and round-trip losslessly', () => {
      const patch = entitiesToDraftPatch('REGISTER_SALE', { watchQuery: 'Bruce Wayne', someFutureField: 'x' });
      expect(patch.metadata).toEqual({ someFutureField: 'x' });
      const draft = applyDraftPatch(null, patch, 'REGISTER_SALE');
      expect(draftToEntities(draft).someFutureField).toBe('x');
    });

    it('a capability with no explicit mapping (e.g. REGISTER_EXPENSE) still round-trips everything via metadata', () => {
      const entities = { amount: '500.00', currency: 'MXN', category: 'GASOLINE', source: 'BANK' };
      const patch = entitiesToDraftPatch('REGISTER_EXPENSE', entities);
      const draft = applyDraftPatch(null, patch, 'REGISTER_EXPENSE');
      expect(draftToEntities(draft)).toEqual(entities);
    });
  });

  describe('entitiesToDraftPatch + draftToEntities round-trip for REGISTER_PURCHASE', () => {
    it('uses cost/sourceAccount/sellerClientId — the purchase-specific field names, not sale\'s', () => {
      const entities = {
        watchQuery: 'Pepsi',
        cost: '280000.00',
        currency: 'MXN',
        sellerQuery: 'José',
        sourceAccount: 'BANK',
        paymentMode: 'PAID',
      };
      const patch = entitiesToDraftPatch('REGISTER_PURCHASE', entities);
      expect(patch.seller).toEqual({ raw: 'José', confidence: 'RAW' });
      expect(patch.amount).toEqual({ value: '280000.00', currency: 'MXN' });
      expect(patch.payment).toEqual({ account: 'BANK', mode: 'PAID' });

      const draft = applyDraftPatch(null, patch, 'REGISTER_PURCHASE');
      expect(draftToEntities(draft)).toMatchObject(entities);
    });
  });

  describe('the correction pattern: leaf-level patch preserves siblings within the same sub-object', () => {
    it('correcting only currency preserves the previously-known amount value', () => {
      let draft = emptyDraft('REGISTER_SALE');
      draft = applyDraftPatch(draft, { amount: { value: '500000.00', currency: 'MXN' } }, 'REGISTER_SALE');
      // A correction handler spreads the CURRENT sub-object and overrides just the one leaf.
      draft = applyDraftPatch(draft, { amount: { ...draft.amount, currency: 'USD' } }, 'REGISTER_SALE');
      expect(draft.amount).toEqual({ value: '500000.00', currency: 'USD' });
    });

    it('correcting only the payment account preserves paymentMode', () => {
      let draft = emptyDraft('REGISTER_SALE');
      draft = applyDraftPatch(draft, { payment: { account: 'CASH', mode: 'PAID' } }, 'REGISTER_SALE');
      draft = applyDraftPatch(draft, { payment: { ...draft.payment, account: 'BANCOS' } }, 'REGISTER_SALE');
      expect(draft.payment).toEqual({ account: 'BANCOS', mode: 'PAID' });
    });
  });
});
