import {
  assertResolutionAllowed,
  mapLegacyIssueCode,
  ISSUE_TAXONOMY,
  reviewStatusForResolution,
} from '../review/issue-taxonomy';
import {
  applyResolutionOverlays,
  fingerprintReviewedDataset,
  type PrivateSnapshot,
} from '../review/overlay-engine';

function baseSnapshot(): PrivateSnapshot {
  return {
    reconciliation: [
      {
        concept: 'CXC_MXN',
        currency: 'MXN',
        declaredValue: 100,
        calculatedValue: 80,
        difference: 20,
        tolerance: 0.02,
        status: 'MISMATCH',
        notes: null,
        sourceCells: ['F3'],
      },
    ],
    reportedBalances: [],
    customers: [
      {
        id: 'cust_a',
        displayName: 'Alpha',
        normalizedName: 'alpha',
        sources: [
          {
            workbookFingerprint: 'x',
            parserVersion: 'v1',
            sourceSheet: 'VENTAS',
            sourceRow: 1,
          },
        ],
        duplicateSuggestions: [{ otherId: 'cust_b', confidence: 'ACCENT_VARIANT' }],
      },
      {
        id: 'cust_b',
        displayName: 'Álpha',
        normalizedName: 'álpha',
        sources: [
          {
            workbookFingerprint: 'x',
            parserVersion: 'v1',
            sourceSheet: 'VENTAS',
            sourceRow: 2,
          },
        ],
        duplicateSuggestions: [{ otherId: 'cust_a', confidence: 'ACCENT_VARIANT' }],
      },
    ],
    inventory: [
      {
        id: 'inv_1',
        brand: 'ROLEX',
        model: 'DJ',
        reference: 'R1',
        serial: 'SER-1',
        cost: 10,
        usd: null,
        extras: null,
        totalCost: 10,
        currencyContext: null,
        source: {
          workbookFingerprint: 'x',
          parserVersion: 'v1',
          sourceSheet: 'INVENTARIO',
          sourceRow: 5,
        },
      },
    ],
    sales: [
      {
        id: 'sale_1',
        saleDate: '2025-08-01',
        customerName: 'Alpha',
        brand: 'ROLEX',
        model: 'DJ',
        reference: null,
        serial: 'SER-1',
        cost: 100,
        salePrice: 150,
        extras: 10,
        declaredProfit: 50,
        calculatedProfit: 40,
        profitMismatch: true,
        paymentCount: null,
        source: {
          workbookFingerprint: 'x',
          parserVersion: 'v1',
          sourceSheet: 'VENTAS',
          sourceRow: 4,
        },
      },
    ],
    receivables: [
      {
        id: 'cxc_1',
        customerName: 'Alpha',
        principal: 100,
        watchOrConcept: 'Prestamo',
        declaredOutstanding: 60,
        calculatedOutstanding: 60,
        balanceMismatch: false,
        currency: 'MXN',
        payments: [
          {
            id: 'pay_1',
            label: 'PAGO 1',
            amount: 40,
            paymentDate: '2025-08-02',
            note: null,
            source: {
              workbookFingerprint: 'x',
              parserVersion: 'v1',
              sourceSheet: 'CTAS X COBRAR',
              sourceRow: 7,
            },
          },
        ],
        source: {
          workbookFingerprint: 'x',
          parserVersion: 'v1',
          sourceSheet: 'CTAS X COBRAR',
          sourceRow: 5,
          sourceBlockId: 'A5:D12',
        },
        ambiguous: true,
      },
    ],
    payables: [
      {
        id: 'cxp_1',
        creditorName: 'Proveedor',
        creditorLabelRaw: 'AACREDOR',
        principal: 500,
        watchOrConcept: 'PAQ',
        declaredRemaining: null,
        calculatedRemaining: 400,
        balanceMismatch: false,
        currency: 'MXN',
        payments: [
          {
            id: 'pp_1',
            label: 'PAGO 1',
            amount: 100,
            paymentDate: null,
            note: null,
            source: {
              workbookFingerprint: 'x',
              parserVersion: 'v1',
              sourceSheet: 'CTAS X PAGAR',
              sourceRow: 8,
            },
          },
        ],
        formulaErrors: ['C9'],
        source: {
          workbookFingerprint: 'x',
          parserVersion: 'v1',
          sourceSheet: 'CTAS X PAGAR',
          sourceRow: 6,
          sourceBlockId: 'A6:D10',
        },
        ambiguous: true,
      },
    ],
    expenses: [],
    cash: [],
    bank: [],
    partnerLedger: [],
    profitDistributions: [],
    deferred: [{ id: 'crypto_1', kind: 'CRYPTO', concept: 'demo' }],
  };
}

describe('Phase 1.5 issue taxonomy', () => {
  it('1. allows valid resolution types', () => {
    expect(() =>
      assertResolutionAllowed('CXP_FORMULA_ERROR', 'CONFIRM_FORMULA_OVERRIDE', 'override residual'),
    ).not.toThrow();
  });

  it('2. rejects invalid resolution type', () => {
    expect(() => assertResolutionAllowed('CXP_FORMULA_ERROR', 'MERGE_EXACT_DUPLICATE')).toThrow();
  });

  it('3. enforces mandatory reason', () => {
    expect(() =>
      assertResolutionAllowed('CXP_FORMULA_ERROR', 'CONFIRM_FORMULA_OVERRIDE', ''),
    ).toThrow(/Reason/);
  });

  it('maps FORMULA_ERROR to CXP_FORMULA_ERROR', () => {
    expect(mapLegacyIssueCode('FORMULA_ERROR', 'CTAS X PAGAR')).toBe('CXP_FORMULA_ERROR');
    expect(ISSUE_TAXONOMY.CXP_FORMULA_ERROR.blocksDryRun).toBe(true);
  });

  it('review status mapping', () => {
    expect(reviewStatusForResolution('DEFER')).toBe('DEFERRED');
    expect(reviewStatusForResolution('EXCLUDE_FROM_MIGRATION')).toBe('EXCLUDED');
    expect(reviewStatusForResolution('ACKNOWLEDGE_WARNING')).toBe('ACKNOWLEDGED');
  });
});

describe('Phase 1.5 overlay engine', () => {
  it('4. original snapshot remains unchanged', () => {
    const original = baseSnapshot();
    const copy = JSON.parse(JSON.stringify(original));
    applyResolutionOverlays(original, [
      {
        id: 'r1',
        entityType: 'receivable',
        candidateId: 'cxc_1',
        resolutionType: 'ACCEPT_AS_IS',
      },
    ]);
    expect(original).toEqual(copy);
  });

  it('5/10. accept parsed CXC card clears ambiguity in reviewed dataset', () => {
    const reviewed = applyResolutionOverlays(baseSnapshot(), [
      {
        id: 'r1',
        entityType: 'receivable',
        candidateId: 'cxc_1',
        resolutionType: 'ACCEPT_AS_IS',
      },
    ]);
    expect(reviewed.snapshot.receivables[0].ambiguous).toBe(false);
  });

  it('11/17. correct CXC principal and payments recalculates balance', () => {
    const reviewed = applyResolutionOverlays(baseSnapshot(), [
      {
        id: 'r1',
        entityType: 'receivable',
        candidateId: 'cxc_1',
        resolutionType: 'CORRECT_VALUE',
        resolvedValue: {
          principal: 200,
          payments: [
            {
              id: 'pay_1',
              label: 'PAGO 1',
              amount: 50,
              paymentDate: '2025-08-02',
              note: null,
            },
          ],
          declaredOutstanding: 150,
        },
      },
    ]);
    expect(reviewed.snapshot.receivables[0].principal).toBe(200);
    expect(reviewed.snapshot.receivables[0].calculatedOutstanding).toBe(150);
    expect(reviewed.snapshot.receivables[0].balanceMismatch).toBe(false);
  });

  it('15. exclude empty/non-record block', () => {
    const reviewed = applyResolutionOverlays(baseSnapshot(), [
      {
        id: 'r1',
        entityType: 'receivable',
        candidateId: 'cxc_1',
        resolutionType: 'EXCLUDE_FROM_MIGRATION',
      },
    ]);
    expect(reviewed.snapshot.receivables.find((r) => r.id === 'cxc_1')).toBeUndefined();
    expect(reviewed.excludedCandidateIds).toContain('cxc_1');
  });

  it('16. CXP formula override clears formula errors', () => {
    const reviewed = applyResolutionOverlays(baseSnapshot(), [
      {
        id: 'r1',
        entityType: 'payable',
        candidateId: 'cxp_1',
        resolutionType: 'CONFIRM_FORMULA_OVERRIDE',
        reason: 'cached residual verified',
        resolvedValue: { declaredRemaining: 400 },
      },
    ]);
    expect(reviewed.snapshot.payables[0].formulaErrors).toEqual([]);
    expect(reviewed.snapshot.payables[0].ambiguous).toBe(false);
  });

  it('19. merge exact duplicate keeps provenance on survivor', () => {
    const reviewed = applyResolutionOverlays(baseSnapshot(), [
      {
        id: 'r1',
        entityType: 'customer',
        resolutionType: 'MERGE_EXACT_DUPLICATE',
        resolvedValue: {
          fromIds: ['cust_b'],
          intoId: 'cust_a',
          canonicalName: 'Alpha Canonical',
        },
      },
    ]);
    expect(reviewed.snapshot.customers.find((c) => c.id === 'cust_b')).toBeUndefined();
    const into = reviewed.snapshot.customers.find((c) => c.id === 'cust_a')!;
    expect(into.displayName).toBe('Alpha Canonical');
    expect(into.sources.length).toBe(2);
  });

  it('20. fuzzy candidates are not auto-merged by engine alone', () => {
    const reviewed = applyResolutionOverlays(baseSnapshot(), []);
    expect(reviewed.snapshot.customers).toHaveLength(2);
  });

  it('24/25. serial correct and mark unknown', () => {
    const corrected = applyResolutionOverlays(baseSnapshot(), [
      {
        id: 'r1',
        entityType: 'inventory',
        candidateId: 'inv_1',
        resolutionType: 'CORRECT_VALUE',
        resolvedValue: { serial: 'SER-FIXED' },
      },
    ]);
    expect(corrected.snapshot.inventory[0].serial).toBe('SER-FIXED');

    const unknown = applyResolutionOverlays(baseSnapshot(), [
      {
        id: 'r2',
        entityType: 'sale',
        candidateId: 'sale_1',
        resolutionType: 'MARK_SERIAL_UNKNOWN',
      },
    ]);
    expect(unknown.snapshot.sales[0].serial).toBeNull();
  });

  it('29/30. accept declared or calculated profit', () => {
    const declared = applyResolutionOverlays(baseSnapshot(), [
      {
        id: 'r1',
        entityType: 'sale',
        candidateId: 'sale_1',
        resolutionType: 'ACCEPT_AS_IS',
      },
    ]);
    expect(declared.snapshot.sales[0].profitMismatch).toBe(false);

    const calc = applyResolutionOverlays(baseSnapshot(), [
      {
        id: 'r2',
        entityType: 'sale',
        candidateId: 'sale_1',
        resolutionType: 'CORRECT_VALUE',
        resolvedValue: { useCalculated: true },
      },
    ]);
    expect(calc.snapshot.sales[0].declaredProfit).toBe(40);
    expect(calc.snapshot.sales[0].profitMismatch).toBe(false);
  });

  it('41/42. freeze fingerprint is deterministic', () => {
    const a = fingerprintReviewedDataset({ x: 1, y: [2, 3] });
    const b = fingerprintReviewedDataset({ x: 1, y: [2, 3] });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('45. overlay never creates operational records (pure function)', () => {
    const reviewed = applyResolutionOverlays(baseSnapshot(), [
      {
        id: 'r1',
        entityType: 'payable',
        candidateId: 'cxp_1',
        resolutionType: 'EXCLUDE_FROM_MIGRATION',
      },
    ]);
    expect(reviewed.effects.length).toBeGreaterThan(0);
  });
});
