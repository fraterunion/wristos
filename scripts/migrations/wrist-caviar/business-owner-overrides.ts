import type {
  PayableCandidate,
  PayablePaymentCandidate,
  ReceivableCandidate,
  ReceivablePaymentCandidate,
  SaleCandidate,
  WorkbookAnalysis,
} from '../../../apps/api/src/modules/platform-migrations/wrist-caviar/types/migration.types';

export type CardOverride = {
  decisionId: string;
  sourceCandidateId: string;
  resolutionType: 'BUSINESS_OWNER_CARD_OVERRIDE';
  actor: string;
  date: string;
  reason: string;
  originalSnapshot?: Record<string, unknown>;
  resolved: {
    principal?: number;
    outstanding?: number;
    remaining?: number;
    watchOrConcept?: string;
    currency?: 'MXN' | 'USD';
    chargeLines?: Array<{ date: string | null; amount: number; concept: string }>;
    payments?: Array<{
      date: string | null;
      amount: number;
      label: string;
    }>;
    // sale fields
    salePrice?: number;
    cost?: number | null;
    extras?: number | null;
    declaredProfit?: number;
    calculatedProfit?: number;
    originalCurrency?: string;
    originalAmount?: number;
    exchangeRate?: number;
    extrasNote?: string;
    profitMismatch?: boolean;
  };
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function mapReceivablePayments(
  parentId: string,
  payments: NonNullable<CardOverride['resolved']['payments']>,
  base: ReceivableCandidate,
): ReceivablePaymentCandidate[] {
  return payments.map((p, i) => ({
    id: `${parentId}_res_pay_${String(i + 1).padStart(3, '0')}`,
    label: p.label,
    amount: p.amount,
    paymentDate: p.date,
    note: `business_owner_override:${base.id}`,
    source: {
      ...base.source,
      sourceRow: base.source.sourceRow,
    },
  }));
}

function mapPayablePayments(
  parentId: string,
  payments: NonNullable<CardOverride['resolved']['payments']>,
  base: PayableCandidate,
): PayablePaymentCandidate[] {
  return payments.map((p, i) => ({
    id: `${parentId}_res_pay_${String(i + 1).padStart(3, '0')}`,
    label: p.label,
    amount: p.amount,
    paymentDate: p.date,
    note: `business_owner_override:${base.id}`,
    source: {
      ...base.source,
      sourceRow: base.source.sourceRow,
    },
  }));
}

/**
 * Apply explicit business-owner card overrides. Does not mutate workbook files.
 * Clears conflict flags when invariants hold.
 */
export function applyBusinessOwnerOverrides(
  analysis: WorkbookAnalysis,
  overrides: CardOverride[],
): WorkbookAnalysis {
  const snap = JSON.parse(JSON.stringify(analysis)) as WorkbookAnalysis;

  for (const ov of overrides) {
    const r = snap.receivables.find((x) => x.id === ov.sourceCandidateId);
    if (r && ov.decisionId.startsWith('CXC')) {
      const principal = ov.resolved.principal ?? r.principal ?? 0;
      const payments = ov.resolved.payments ?? [];
      const paid = round2(payments.reduce((s, p) => s + p.amount, 0));
      const outstanding = ov.resolved.outstanding ?? round2(principal - paid);
      if (Math.abs(principal - paid - outstanding) > 0.05) {
        throw new Error(
          `${ov.decisionId}: invariant fail principal(${principal}) - payments(${paid}) != outstanding(${outstanding})`,
        );
      }
      r.principal = principal;
      r.watchOrConcept = ov.resolved.watchOrConcept ?? r.watchOrConcept;
      r.declaredOutstanding = outstanding;
      r.calculatedOutstanding = outstanding;
      r.balanceMismatch = false;
      r.ambiguous = false;
      r.currency = ov.resolved.currency ?? r.currency;
      r.payments = mapReceivablePayments(r.id, payments, r);
      continue;
    }

    const p = snap.payables.find((x) => x.id === ov.sourceCandidateId);
    if (p && ov.decisionId.startsWith('CXP')) {
      const principal = ov.resolved.principal ?? p.principal ?? 0;
      const payments = ov.resolved.payments ?? [];
      const paid = round2(payments.reduce((s, x) => s + x.amount, 0));
      const remaining = ov.resolved.remaining ?? ov.resolved.outstanding ?? round2(principal - paid);
      if (Math.abs(principal - paid - remaining) > 0.05) {
        throw new Error(
          `${ov.decisionId}: invariant fail principal(${principal}) - payments(${paid}) != remaining(${remaining})`,
        );
      }
      p.principal = principal;
      p.watchOrConcept = ov.resolved.watchOrConcept ?? p.watchOrConcept;
      p.declaredRemaining = remaining;
      p.calculatedRemaining = remaining;
      p.balanceMismatch = false;
      p.ambiguous = false;
      p.formulaErrors = [];
      p.payments = mapPayablePayments(p.id, payments, p);
      continue;
    }

    const s = snap.sales.find((x) => x.id === ov.sourceCandidateId) as
      | (SaleCandidate & Record<string, unknown>)
      | undefined;
    if (s && ov.decisionId.startsWith('SALE')) {
      if (ov.resolved.salePrice != null) s.salePrice = ov.resolved.salePrice;
      if (ov.resolved.cost !== undefined) s.cost = ov.resolved.cost;
      if (ov.resolved.extras !== undefined) s.extras = ov.resolved.extras;
      if (ov.resolved.declaredProfit != null) s.declaredProfit = ov.resolved.declaredProfit;
      if (ov.resolved.calculatedProfit != null) s.calculatedProfit = ov.resolved.calculatedProfit;
      s.profitMismatch = ov.resolved.profitMismatch ?? false;
      (s as unknown as Record<string, unknown>).originalCurrency = ov.resolved.originalCurrency ?? null;
      (s as unknown as Record<string, unknown>).originalAmount = ov.resolved.originalAmount ?? null;
      (s as unknown as Record<string, unknown>).exchangeRate = ov.resolved.exchangeRate ?? null;
      (s as unknown as Record<string, unknown>).extrasNote = ov.resolved.extrasNote ?? null;
      (s as unknown as Record<string, unknown>).businessOwnerOverride = ov.decisionId;
    }
  }

  return snap;
}

export function isEdgarCreditor(name: string | null | undefined): boolean {
  return /edgar/i.test(name ?? '');
}
