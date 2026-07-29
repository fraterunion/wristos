import type { CardOverride } from './business-owner-overrides';
import { PARTNER_DECISION_IDS } from './generate-final-packet';

const ACTOR = 'Wrist Caviar Business Owner';
const DATE = '2026-07-29';

/**
 * Confirmed human resolutions (V3). Original workbook is unchanged;
 * these are immutable migration overlays.
 */
export function buildV3CardOverrides(): CardOverride[] {
  return [
    {
      decisionId: 'CXC-001',
      sourceCandidateId: 'cxc_000002',
      resolutionType: 'BUSINESS_OWNER_CARD_OVERRIDE',
      actor: ACTOR,
      date: DATE,
      reason:
        'Business owner confirmed Land-Dweller receivable: principal 368000, no payments, outstanding 368000',
      resolved: {
        principal: 368000,
        outstanding: 368000,
        watchOrConcept: 'Land-Dweller',
        currency: 'MXN',
        payments: [],
        chargeLines: [{ date: null, amount: 368000, concept: 'Land-Dweller' }],
      },
    },
    {
      decisionId: 'CXC-002',
      sourceCandidateId: 'cxc_000009',
      resolutionType: 'BUSINESS_OWNER_CARD_OVERRIDE',
      actor: ACTOR,
      date: DATE,
      reason:
        'Business owner confirmed two watch principals 980000 + 978000 = 1958000 with zero payments',
      resolved: {
        principal: 1958000,
        outstanding: 1958000,
        watchOrConcept: 'AP Lady 37mm diamonds + AP 37 diamonds',
        currency: 'MXN',
        payments: [],
        chargeLines: [
          { date: null, amount: 980000, concept: 'AP Lady 37mm diamonds' },
          { date: null, amount: 978000, concept: 'AP 37 diamonds' },
        ],
      },
    },
    {
      decisionId: 'CXC-003',
      sourceCandidateId: 'cxc_000012',
      resolutionType: 'BUSINESS_OWNER_CARD_OVERRIDE',
      actor: ACTOR,
      date: DATE,
      reason: 'Business owner confirmed principal 375000 with payment 150000 → outstanding 225000',
      resolved: {
        principal: 375000,
        outstanding: 225000,
        currency: 'MXN',
        payments: [{ date: null, amount: 150000, label: 'PAGO 1' }],
        chargeLines: [{ date: null, amount: 375000, concept: 'JOSÉ' }],
      },
    },
    {
      decisionId: 'CXC-004',
      sourceCandidateId: 'cxc_000034',
      resolutionType: 'BUSINESS_OWNER_CARD_OVERRIDE',
      actor: ACTOR,
      date: DATE,
      reason:
        'Business owner confirmed 4 charges (1732000) and 6 payments (1137000) → outstanding 595000',
      resolved: {
        principal: 1732000,
        outstanding: 595000,
        watchOrConcept:
          'Pepsi GMT 2021 + Daytona Ghost + Datejust 41mm Azurro + Datejust 36mm Azurro',
        currency: 'MXN',
        chargeLines: [
          { date: '2026-06-02', amount: 440000, concept: 'Pepsi GMT 2021' },
          { date: '2026-06-02', amount: 720000, concept: 'Daytona Ghost' },
          { date: '2026-07-06', amount: 300000, concept: 'Datejust 41mm Azurro' },
          { date: '2026-07-06', amount: 272000, concept: 'Datejust 36mm Azurro' },
        ],
        payments: [
          { date: '2026-07-01', amount: 110000, label: 'MAYTE' },
          { date: '2026-07-13', amount: 305000, label: 'bancos' },
          { date: '2026-07-13', amount: 250000, label: 'bancos jose' },
          { date: '2026-07-15', amount: 22000, label: 'BANCOS' },
          { date: '2026-06-02', amount: 440000, label: 'bancos' },
          { date: '2026-06-10', amount: 10000, label: 'Anticipo ghost Roberto cxc' },
        ],
      },
    },
    {
      decisionId: 'CXC-005',
      sourceCandidateId: 'cxc_000041',
      resolutionType: 'BUSINESS_OWNER_CARD_OVERRIDE',
      actor: ACTOR,
      date: DATE,
      reason:
        'Business owner confirmed Aquanaut 1196000 is MONTO not PAGO; principal 3254500 − payments 2650000 = 604500',
      resolved: {
        principal: 3254500,
        outstanding: 604500,
        watchOrConcept:
          'Junta 40 abril + Aquanaut + AP Royal Oak Gold + Datejust 41mm grey motif + Sprite 2023',
        currency: 'MXN',
        chargeLines: [
          { date: '2026-03-09', amount: 75500, concept: 'Junta 40 abril' },
          { date: '2026-05-04', amount: 1196000, concept: 'Aquanaut' },
          { date: '2026-05-29', amount: 1300000, concept: 'AP Royal Oak Gold' },
          { date: '2026-06-23', amount: 358000, concept: 'Datejust 41mm grey motif' },
          { date: '2026-07-02', amount: 325000, concept: 'Sprite 2023' },
        ],
        payments: [
          { date: '2026-05-04', amount: 400000, label: 'Sky-Dweller azul' },
          { date: '2026-05-04', amount: 300000, label: 'directo a compra de Bruce Wayne' },
          { date: '2026-05-06', amount: 200000, label: 'BANCOS' },
          { date: '2026-05-29', amount: 1100000, label: 'AP Royal Oak 15400 oro inventario' },
          { date: '2026-06-13', amount: 150000, label: 'CASH' },
          { date: '2026-06-17', amount: 350000, label: 'paga con Bruce 2025' },
          { date: '2026-06-29', amount: 150000, label: 'BANCOS MAYTE' },
        ],
      },
    },
    {
      decisionId: 'CXC-006',
      sourceCandidateId: 'cxc_000046',
      resolutionType: 'BUSINESS_OWNER_CARD_OVERRIDE',
      actor: ACTOR,
      date: DATE,
      reason: 'Business owner confirmed principal 49500 fully paid → outstanding 0',
      resolved: {
        principal: 49500,
        outstanding: 0,
        currency: 'USD',
        payments: [
          { date: '2026-06-16', amount: 8000, label: 'CASH' },
          { date: '2026-06-29', amount: 30000, label: 'AP' },
          { date: '2026-07-06', amount: 11500, label: 'directo a compras de USA' },
        ],
      },
    },
    {
      decisionId: 'CXP-002',
      sourceCandidateId: 'cxp_000005',
      resolutionType: 'BUSINESS_OWNER_CARD_OVERRIDE',
      actor: ACTOR,
      date: DATE,
      reason:
        'Business owner confirmed PRESTAMO 394000 with 4 payments totaling 192100 → remaining 201900; keep as CXP not capital',
      resolved: {
        principal: 394000,
        remaining: 201900,
        watchOrConcept: 'PRESTAMO',
        currency: 'MXN',
        payments: [
          { date: '2025-12-01', amount: 58600, label: 'PAPA CAMI' },
          { date: '2025-12-01', amount: 70000, label: 'PAPA CAMI' },
          { date: '2026-01-20', amount: 60000, label: 'PAGO RELOJ CARTIER' },
          { date: '2026-03-18', amount: 3500, label: 'PULIDA CARTIER' },
        ],
      },
    },
    {
      decisionId: 'SALE-001',
      sourceCandidateId: 'sale_000041',
      resolutionType: 'BUSINESS_OWNER_CARD_OVERRIDE',
      actor: ACTOR,
      date: DATE,
      reason:
        'USD 1450 sale with cost 0; realized profit MXN 27042 using historical FX ≈ 18.6496551724; not a 1450 MXN sale',
      resolved: {
        salePrice: 27042,
        cost: 0,
        extras: 0,
        declaredProfit: 27042,
        calculatedProfit: 27042,
        profitMismatch: false,
        originalCurrency: 'USD',
        originalAmount: 1450,
        exchangeRate: 27042 / 1450,
      },
    },
    {
      decisionId: 'SALE-002',
      sourceCandidateId: 'sale_000176',
      resolutionType: 'BUSINESS_OWNER_CARD_OVERRIDE',
      actor: ACTOR,
      date: DATE,
      reason:
        'Cost 712000 sale 918000; realized profit 200000; 6000 FX timing adjustment via extras',
      resolved: {
        salePrice: 918000,
        cost: 712000,
        extras: 6000,
        declaredProfit: 200000,
        calculatedProfit: 200000,
        profitMismatch: false,
        originalCurrency: 'MXN',
        originalAmount: 918000,
        exchangeRate: 1,
        extrasNote: 'FX timing difference between sale date and payment date (6000 MXN)',
      },
    },
  ];
}

export function buildV3PartnerDefers(): Array<{
  decisionId: string;
  sourceCandidateId: string;
  resolutionType: 'DEFER_FOR_LATER';
  actor: string;
  date: string;
  reason: string;
}> {
  // Candidate IDs sorted — must match PARTNER-001..013 order from package
  const ids = [
    'cesar_000001',
    'cesar_000002',
    'cesar_000030',
    'cesar_000106',
    'cesar_000109',
    'cesar_000123',
    'cesar_000136',
    'cesar_000156',
    'cesar_000158',
    'cesar_000170',
    'cesar_000173',
    'cesar_000180',
    'cesar_000207',
  ];
  return PARTNER_DECISION_IDS.map((decisionId, i) => ({
    decisionId,
    sourceCandidateId: ids[i]!,
    resolutionType: 'DEFER_FOR_LATER' as const,
    actor: ACTOR,
    date: DATE,
    reason:
      'Destination semantics cannot faithfully represent loan/advance/reimbursement/profit-inflow; defer for later',
  }));
}

export const EDGAR_ORIGINAL_EXCLUDE_IDS = [
  'cxp_000001', // EDGAR TREJO CAJA CHICA
  'cxp_000004', // CXP-001
  'cxp_000008', // EDGAR
  'cxp_000009', // EDGAR
  'cxp_000011', // CXP-003 orphan PAQ 144
  'cxp_000012', // EDGAR TREJO
  'cxp_000013', // EDGAR TREJO
] as const;
