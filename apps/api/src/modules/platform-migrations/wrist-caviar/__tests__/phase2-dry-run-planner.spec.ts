import { normalizeCustomerName } from '../normalization/customer-normalize';
import type { PrivateSnapshot } from '../review/overlay-engine';
import { buildDryRunPlan, computePlanFingerprint } from '../dry-run/planner';
import { PLANNER_VERSION } from '../dry-run/planner.constants';
import type { DestinationState } from '../dry-run/plan-types';
import { candidateFingerprint, sha256Hex } from '../dry-run/hash';

function emptyDestination(overrides?: Partial<DestinationState>): DestinationState {
  const fingerprintsByGroup = {
    CUSTOMERS: 'c',
    INVENTORY: 'i',
    SALES: 's',
    RECEIVABLES: 'r',
    PAYABLES: 'p',
    EXPENSES: 'e',
    CASH_LEDGER: 'cash',
    BANK_LEDGER: 'bank',
    PARTNER_LEDGER: 'partner',
    PROFIT_DISTRIBUTIONS: 'profit',
  };
  return {
    clients: [],
    watches: [],
    deals: [],
    accountEntries: [],
    expenses: [],
    treasury: [],
    investors: [],
    distributions: [],
    maps: [],
    counts: {
      clients: 0,
      watches: 0,
      deals: 0,
      receivables: 0,
      payables: 0,
      accountPayments: 0,
      expenses: 0,
      treasury: 0,
      investors: 0,
      distributions: 0,
      maps: 0,
    },
    balances: {
      cashMxn: 0,
      cashUsd: 0,
      bank: 0,
      receivableOutstanding: 0,
      payableOutstanding: 0,
      expenses: 0,
      dealRevenue: 0,
    },
    fingerprintsByGroup,
    overallFingerprint: sha256Hex(fingerprintsByGroup),
    ...overrides,
  };
}

function baseSnapshot(overrides?: Partial<PrivateSnapshot>): PrivateSnapshot {
  return {
    reconciliation: [
      {
        concept: 'BANCOS',
        currency: 'MXN',
        declaredValue: 0,
        calculatedValue: 0,
        difference: 0,
        tolerance: 0.05,
        status: 'MATCHED',
        notes: null,
        sourceCells: [],
      },
    ],
    customers: [
      {
        id: 'cust_1',
        displayName: 'Cliente Alpha',
        normalizedName: normalizeCustomerName('Cliente Alpha'),
        sources: [
          {
            workbookFingerprint: 'wb',
            parserVersion: 'wrist-caviar-master-xlsx-v1',
            sourceSheet: 'VENTAS',
            sourceRow: 4,
          },
        ],
        duplicateSuggestions: [],
      },
    ],
    inventory: [
      {
        id: 'inv_1',
        brand: 'ROLEX',
        model: 'Submariner',
        reference: '126610',
        serial: 'SERIAL-UNIQUE-1',
        cost: 100,
        usd: null,
        extras: null,
        totalCost: 100,
        currencyContext: 'MXN',
        source: {
          workbookFingerprint: 'wb',
          parserVersion: 'v1',
          sourceSheet: 'INVENTARIO',
          sourceRow: 2,
        },
      },
    ],
    sales: [
      {
        id: 'sale_1',
        saleDate: '2025-08-01',
        customerName: 'Cliente Alpha',
        brand: 'ROLEX',
        model: 'Submariner',
        reference: '126610',
        serial: 'SERIAL-SALE-1',
        cost: 100,
        salePrice: 150,
        extras: 10,
        declaredProfit: 40,
        calculatedProfit: 40,
        profitMismatch: false,
        paymentCount: 1,
        source: {
          workbookFingerprint: 'wb',
          parserVersion: 'v1',
          sourceSheet: 'VENTAS',
          sourceRow: 4,
        },
      },
    ],
    receivables: [
      {
        id: 'cxc_1',
        customerName: 'Cliente Alpha',
        principal: 200,
        watchOrConcept: 'Rolex',
        declaredOutstanding: 150,
        calculatedOutstanding: 150,
        balanceMismatch: false,
        currency: 'MXN',
        payments: [
          {
            id: 'cxc_1_p1',
            label: 'Abono 1',
            amount: 50,
            paymentDate: '2025-08-10',
            note: null,
            source: {
              workbookFingerprint: 'wb',
              parserVersion: 'v1',
              sourceSheet: 'CTAS X COBRAR',
              sourceRow: 5,
            },
          },
        ],
        source: {
          workbookFingerprint: 'wb',
          parserVersion: 'v1',
          sourceSheet: 'CTAS X COBRAR',
          sourceRow: 4,
        },
        ambiguous: false,
      },
    ],
    payables: [
      {
        id: 'cxp_1',
        creditorName: 'Proveedor X',
        creditorLabelRaw: 'Proveedor X',
        principal: 80,
        watchOrConcept: 'AP',
        declaredRemaining: 80,
        calculatedRemaining: 80,
        balanceMismatch: false,
        currency: 'MXN',
        payments: [],
        formulaErrors: [],
        source: {
          workbookFingerprint: 'wb',
          parserVersion: 'v1',
          sourceSheet: 'CTAS X PAGAR',
          sourceRow: 4,
        },
        ambiguous: false,
      },
    ],
    expenses: [
      {
        id: 'exp_1',
        expenseDate: '2025-08-01',
        concept: 'Gasolina pemex',
        account: 'EFECTIVO',
        amount: 25,
        source: {
          workbookFingerprint: 'wb',
          parserVersion: 'v1',
          sourceSheet: 'GASTOS',
          sourceRow: 2,
        },
      },
    ],
    cash: [
      {
        id: 'cash_mxn_1',
        currency: 'MXN',
        entryDate: '2025-08-01',
        concept: 'Ingreso',
        entryAmount: 100,
        exitAmount: null,
        exchangeRate: null,
        reportedBalance: 100,
        calculatedBalance: 100,
        balanceMismatch: false,
        hidden: false,
        source: {
          workbookFingerprint: 'wb',
          parserVersion: 'v1',
          sourceSheet: 'EFECTIVO',
          sourceRow: 2,
        },
      },
      {
        id: 'cash_usd_1',
        currency: 'USD',
        entryDate: '2025-08-01',
        concept: 'Ingreso USD',
        entryAmount: 10,
        exitAmount: null,
        exchangeRate: 20,
        reportedBalance: 10,
        calculatedBalance: 10,
        balanceMismatch: false,
        hidden: false,
        source: {
          workbookFingerprint: 'wb',
          parserVersion: 'v1',
          sourceSheet: 'EFECTIVO',
          sourceRow: 3,
        },
      },
    ],
    bank: [
      {
        id: 'bank_1',
        entryDate: '2025-08-01',
        reference: 'REF-1',
        concept: 'Deposito',
        deposit: 500,
        commission: 5,
        withdrawal: null,
        reportedBalance: 495,
        calculatedBalance: 495,
        balanceMismatch: false,
        comment: 'ok',
        onePercentRuleStatus: 'NOT_APPLICABLE',
        source: {
          workbookFingerprint: 'wb',
          parserVersion: 'v1',
          sourceSheet: 'CONTROL BANCOS',
          sourceRow: 2,
        },
      },
    ],
    partnerLedger: [
      {
        id: 'partner_1',
        entryDate: '2025-08-01',
        concept: 'Aporte',
        entryAmount: 50,
        exitAmount: null,
        reportedBalance: 50,
        calculatedBalance: 50,
        balanceMismatch: false,
        classification: 'CONTRIBUTION',
        source: {
          workbookFingerprint: 'wb',
          parserVersion: 'v1',
          sourceSheet: 'CUENTA CESAR',
          sourceRow: 2,
        },
      },
      {
        id: 'partner_u',
        entryDate: '2025-08-02',
        concept: 'Sin clasificar',
        entryAmount: 10,
        exitAmount: null,
        reportedBalance: 60,
        calculatedBalance: 60,
        balanceMismatch: false,
        classification: 'UNCLASSIFIED',
        source: {
          workbookFingerprint: 'wb',
          parserVersion: 'v1',
          sourceSheet: 'CUENTA CESAR',
          sourceRow: 3,
        },
      },
    ],
    profitDistributions: [
      {
        id: 'profit_1',
        partner: 'CESAR',
        monthLabel: 'AGOSTO',
        accrued: 75,
        collected: 75,
        outstanding: 0,
        expectedShare: 0.75,
        shareMismatch: false,
        source: {
          workbookFingerprint: 'wb',
          parserVersion: 'v1',
          sourceSheet: 'COBRO UTILIDADES',
          sourceRow: 2,
        },
      },
    ],
    deferred: [
      {
        id: 'deferred_cripto_1',
        label: 'CRIPTO CESAR',
        destination: 'DEFERRED',
        source: { sourceSheet: 'CRIPTO CESAR', sourceRow: 1 },
      },
      {
        id: 'deferred_oscar_1',
        label: 'OSCAR PAPA CAMI',
        destination: 'DEFERRED',
        source: { sourceSheet: 'OSCAR PAPA CAMI', sourceRow: 1 },
      },
    ],
    ...overrides,
  };
}

describe('Phase 2 dry-run planner', () => {
  it('11. exact unique customer match → LINK', () => {
    const dest = emptyDestination({
      clients: [
        {
          id: 'client_existing',
          name: 'Cliente Alpha',
          normalizedName: normalizeCustomerName('Cliente Alpha'),
          deletedAt: null,
        },
      ],
      counts: { ...emptyDestination().counts, clients: 1 },
    });
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot(),
      destination: dest,
      resolutions: [],
      deferredGroups: [],
    });
    const cust = plan.items.find((i) => i.sourceCandidateId === 'cust_1')!;
    expect(cust.action).toBe('LINK');
    expect(cust.destinationId).toBe('client_existing');
  });

  it('12. explicit MAP_ENTITY → LINK', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot(),
      destination: emptyDestination({
        clients: [
          {
            id: 'mapped',
            name: 'Other',
            normalizedName: 'other',
            deletedAt: null,
          },
        ],
      }),
      resolutions: [
        {
          id: 'r1',
          candidateId: 'cust_1',
          entityType: 'customer',
          resolutionType: 'MAP_ENTITY',
          resolvedValue: { destinationId: 'mapped' },
        },
      ],
      deferredGroups: [],
    });
    expect(plan.items.find((i) => i.sourceCandidateId === 'cust_1')!.action).toBe('LINK');
  });

  it('13. no match → CREATE', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot(),
      destination: emptyDestination(),
      resolutions: [],
      deferredGroups: [],
    });
    expect(plan.items.find((i) => i.sourceCandidateId === 'cust_1')!.action).toBe('CREATE');
  });

  it('14. multiple exact matches → CONFLICT', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot(),
      destination: emptyDestination({
        clients: [
          {
            id: 'a',
            name: 'Cliente Alpha',
            normalizedName: normalizeCustomerName('Cliente Alpha'),
            deletedAt: null,
          },
          {
            id: 'b',
            name: 'Cliente Alpha',
            normalizedName: normalizeCustomerName('Cliente Alpha'),
            deletedAt: null,
          },
        ],
      }),
      resolutions: [],
      deferredGroups: [],
    });
    const cust = plan.items.find((i) => i.sourceCandidateId === 'cust_1')!;
    expect(cust.action).toBe('CONFLICT');
    expect(cust.conflictCode).toBe('CUSTOMER_MATCH_AMBIGUOUS');
  });

  it('15. fuzzy accent variant does not LINK', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot({
        customers: [
          {
            id: 'cust_jose',
            displayName: 'Jose',
            normalizedName: normalizeCustomerName('Jose'),
            sources: [],
            duplicateSuggestions: [],
          },
        ],
        sales: [],
        receivables: [],
      }),
      destination: emptyDestination({
        clients: [
          {
            id: 'c1',
            name: 'José',
            normalizedName: normalizeCustomerName('José'),
            deletedAt: null,
          },
        ],
      }),
      resolutions: [],
      deferredGroups: [],
    });
    // Jose vs José normalize differently under es-MX (accent preserved in toLocaleLowerCase)
    const item = plan.items.find((i) => i.sourceCandidateId === 'cust_jose')!;
    expect(item.action).not.toBe('LINK');
  });

  it('16. previously imported candidate → SKIP', () => {
    const snap = baseSnapshot();
    const fp = candidateFingerprint('customer', 'cust_1', {
      normalizedName: snap.customers[0].normalizedName,
      displayName: snap.customers[0].displayName,
    });
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: snap,
      destination: emptyDestination({
        maps: [
          {
            sourceCandidateId: 'cust_1',
            entityType: 'customer',
            destinationId: 'already',
            sourceFingerprint: fp,
          },
        ],
      }),
      resolutions: [],
      deferredGroups: [],
    });
    expect(plan.items.find((i) => i.sourceCandidateId === 'cust_1')!.action).toBe('SKIP');
  });

  it('17. unique exact serial → LINK', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot(),
      destination: emptyDestination({
        watches: [
          {
            id: 'w1',
            brand: 'ROLEX',
            model: 'Sub',
            reference: '126610',
            serialNumber: 'SERIAL-UNIQUE-1',
            status: 'AVAILABLE',
            deletedAt: null,
          },
        ],
      }),
      resolutions: [],
      deferredGroups: [],
    });
    expect(plan.items.find((i) => i.sourceCandidateId === 'inv_1')!.action).toBe('LINK');
  });

  it('18. no serial match → CREATE', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot(),
      destination: emptyDestination(),
      resolutions: [],
      deferredGroups: [],
    });
    expect(plan.items.find((i) => i.sourceCandidateId === 'inv_1')!.action).toBe('CREATE');
  });

  it('19. duplicate destination serial → CONFLICT', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot(),
      destination: emptyDestination({
        watches: [
          {
            id: 'w1',
            brand: 'A',
            model: 'B',
            reference: null,
            serialNumber: 'SERIAL-UNIQUE-1',
            status: 'AVAILABLE',
            deletedAt: null,
          },
          {
            id: 'w2',
            brand: 'A',
            model: 'B',
            reference: null,
            serialNumber: 'SERIAL-UNIQUE-1',
            status: 'AVAILABLE',
            deletedAt: null,
          },
        ],
      }),
      resolutions: [],
      deferredGroups: [],
    });
    expect(plan.items.find((i) => i.sourceCandidateId === 'inv_1')!.action).toBe('CONFLICT');
  });

  it('20. reference-only match does not LINK', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot({
        inventory: [
          {
            id: 'inv_ref',
            brand: 'ROLEX',
            model: 'Submariner',
            reference: '126610',
            serial: null,
            cost: 100,
            usd: null,
            extras: null,
            totalCost: 100,
            currencyContext: null,
            source: {
              workbookFingerprint: 'wb',
              parserVersion: 'v1',
              sourceSheet: 'INVENTARIO',
              sourceRow: 9,
            },
          },
        ],
      }),
      destination: emptyDestination({
        watches: [
          {
            id: 'w1',
            brand: 'ROLEX',
            model: 'Submariner',
            reference: '126610',
            serialNumber: 'OTHER',
            status: 'AVAILABLE',
            deletedAt: null,
          },
        ],
      }),
      resolutions: [],
      deferredGroups: [],
    });
    expect(plan.items.find((i) => i.sourceCandidateId === 'inv_ref')!.action).toBe('CREATE');
  });

  it('22. historical sale → CREATE without inventory mutation', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot(),
      destination: emptyDestination(),
      resolutions: [],
      deferredGroups: [],
    });
    const sale = plan.items.find((i) => i.sourceCandidateId === 'sale_1')!;
    expect(sale.action).toBe('CREATE');
    expect(sale.plannedPayload?.watchId).toBeNull();
    expect(sale.plannedPayload?.mutatesInventory).toBe(false);
  });

  it('25. unresolved customer dependency → CONFLICT', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot({
        customers: [
          {
            id: 'cust_1',
            displayName: '',
            normalizedName: '',
            sources: [],
            duplicateSuggestions: [],
          },
        ],
        sales: [
          {
            id: 'sale_x',
            saleDate: '2025-08-01',
            customerName: 'Unknown Person',
            brand: 'ROLEX',
            model: 'X',
            reference: null,
            serial: null,
            cost: 1,
            salePrice: 2,
            extras: 0,
            declaredProfit: 1,
            calculatedProfit: 1,
            profitMismatch: false,
            paymentCount: 1,
            source: {
              workbookFingerprint: 'wb',
              parserVersion: 'v1',
              sourceSheet: 'VENTAS',
              sourceRow: 9,
            },
          },
        ],
      }),
      destination: emptyDestination(),
      resolutions: [],
      deferredGroups: [],
    });
    const sale = plan.items.find((i) => i.sourceCandidateId === 'sale_x')!;
    expect(sale.action).toBe('CONFLICT');
    expect(sale.conflictCode).toBe('DEPENDENCY_UNRESOLVED');
  });

  it('27-28. CXC parent + payments and planned outstanding', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot(),
      destination: emptyDestination(),
      resolutions: [],
      deferredGroups: [],
    });
    const parent = plan.items.find((i) => i.sourceCandidateId === 'cxc_1')!;
    const pay = plan.items.find((i) => i.sourceCandidateId === 'cxc_1_p1')!;
    expect(parent.action).toBe('CREATE');
    expect(pay.action).toBe('CREATE');
    expect(pay.dependencyKeys).toContain('receivable:cxc_1');
    expect(plan.financialSummary.receivableEndingOutstanding).toBe(150);
  });

  it('29. invalid receivable balance → CONFLICT', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot({
        receivables: [
          {
            ...baseSnapshot().receivables[0],
            balanceMismatch: true,
          },
        ],
      }),
      destination: emptyDestination(),
      resolutions: [],
      deferredGroups: [],
    });
    expect(plan.items.find((i) => i.sourceCandidateId === 'cxc_1')!.action).toBe('CONFLICT');
  });

  it('31. free-form creditor CREATE for CXP', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot(),
      destination: emptyDestination(),
      resolutions: [],
      deferredGroups: [],
    });
    const cxp = plan.items.find((i) => i.sourceCandidateId === 'cxp_1')!;
    expect(cxp.action).toBe('CREATE');
    expect(cxp.plannedPayload?.counterpartyName).toBe('Proveedor X');
  });

  it('33. expense CREATE with mapped category', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot(),
      destination: emptyDestination(),
      resolutions: [],
      deferredGroups: [],
    });
    expect(plan.items.find((i) => i.sourceCandidateId === 'exp_1')!.action).toBe('CREATE');
  });

  it('34. unresolved category mapping → CONFLICT', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot({
        expenses: [
          {
            id: 'exp_x',
            expenseDate: '2025-08-01',
            concept: 'concepto misterioso xyz',
            account: null,
            amount: 10,
            source: {
              workbookFingerprint: 'wb',
              parserVersion: 'v1',
              sourceSheet: 'GASTOS',
              sourceRow: 9,
            },
          },
        ],
      }),
      destination: emptyDestination(),
      resolutions: [],
      deferredGroups: [],
    });
    expect(plan.items.find((i) => i.sourceCandidateId === 'exp_x')!.conflictCode).toBe(
      'CATEGORY_MAPPING_REQUIRED',
    );
  });

  it('35. MXN/USD cash separation', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot(),
      destination: emptyDestination(),
      resolutions: [],
      deferredGroups: [],
    });
    expect(plan.financialSummary.cashMxnInflows).toBe(100);
    expect(plan.financialSummary.cashUsdInflows).toBe(10);
  });

  it('38. bank commission preserved', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot(),
      destination: emptyDestination(),
      resolutions: [],
      deferredGroups: [],
    });
    expect(plan.financialSummary.bankCommissions).toBe(5);
    const bank = plan.items.find((i) => i.sourceCandidateId === 'bank_1')!;
    expect(bank.plannedPayload?.commission).toBe(5);
  });

  it('40. unclassified partner movement CONFLICT', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot(),
      destination: emptyDestination(),
      resolutions: [],
      deferredGroups: [],
    });
    expect(plan.items.find((i) => i.sourceCandidateId === 'partner_u')!.action).toBe('CONFLICT');
  });

  it('42-44. deferred groups appear and do not block', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot(),
      destination: emptyDestination({
        investors: [
          { id: 'inv_cesar', name: 'Cesar', ownershipPercent: 75 },
        ],
      }),
      resolutions: [],
      deferredGroups: ['DEFERRED'],
    });
    const deferred = plan.items.filter((i) => i.action === 'DEFERRED');
    expect(deferred.length).toBeGreaterThan(0);
    expect(plan.actionCounts.DEFERRED).toBeGreaterThan(0);
    // Deferred alone should not force FAILED readiness if other conflicts exist from partner_u
    expect(plan.actionCounts.DEFERRED).toBeGreaterThanOrEqual(2);
  });

  it('7. unchanged dataset/database → same plan fingerprint', () => {
    const snap = baseSnapshot();
    const dest = emptyDestination({
      investors: [{ id: 'inv_cesar', name: 'Cesar', ownershipPercent: 75 }],
    });
    const a = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: snap,
      destination: dest,
      resolutions: [],
      deferredGroups: [],
    });
    const b = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: snap,
      destination: dest,
      resolutions: [],
      deferredGroups: [],
    });
    expect(a.planFingerprint).toBe(b.planFingerprint);
    expect(a.planFingerprint).toBe(
      computePlanFingerprint({
        tenantId: 't1',
        datasetFingerprint: 'fp1',
        plannerVersion: PLANNER_VERSION,
        destinationStateFingerprint: dest.overallFingerprint,
        items: a.items,
      }),
    );
  });

  it('8. no duplicate dry-run items by entityType+candidate', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot(),
      destination: emptyDestination({
        investors: [{ id: 'inv_cesar', name: 'Cesar', ownershipPercent: 75 }],
      }),
      resolutions: [],
      deferredGroups: [],
    });
    const keys = plan.items.map((i) => `${i.entityType}:${i.sourceCandidateId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('45-46. financial totals and current+plan=projected', () => {
    const dest = emptyDestination({
      counts: { ...emptyDestination().counts, clients: 2, watches: 1, deals: 3 },
      balances: { ...emptyDestination().balances, cashMxn: 10 },
      investors: [{ id: 'inv_cesar', name: 'Cesar', ownershipPercent: 75 }],
    });
    // Fix current counts in emptyFinancial via destination
    dest.counts.clients = 2;
    dest.counts.watches = 1;
    dest.counts.deals = 3;
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot(),
      destination: dest,
      resolutions: [],
      deferredGroups: [],
    });
    expect(plan.financialSummary.projected.clients).toBe(
      plan.financialSummary.current.clients + plan.financialSummary.customersCreated,
    );
    expect(plan.financialSummary.label).toContain('Simulación');
  });

  it('66. deterministic ordering by sequence', () => {
    const plan = buildDryRunPlan({
      tenantId: 't1',
      datasetId: 'ds1',
      datasetFingerprint: 'fp1',
      snapshot: baseSnapshot(),
      destination: emptyDestination({
        investors: [{ id: 'inv_cesar', name: 'Cesar', ownershipPercent: 75 }],
      }),
      resolutions: [],
      deferredGroups: [],
    });
    const seqs = plan.items.map((i) => i.sequence);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });
});
