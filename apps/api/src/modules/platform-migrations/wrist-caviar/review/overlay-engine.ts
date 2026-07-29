import { createHash } from 'crypto';

import { reconcileAgainstReporte } from '../reconciliation/reporte.reconciliation';
import type {
  CashLedgerCandidate,
  CustomerCandidate,
  InventoryCandidate,
  PayableCandidate,
  ReceivableCandidate,
  ReconciliationItem,
  SaleCandidate,
} from '../types/migration.types';
import { nearlyEqual, roundMoney } from '../workbook/cell.util';
import type { ResolutionType } from './issue-taxonomy';

export type PrivateSnapshot = {
  reconciliation: ReconciliationItem[];
  reportedBalances?: import('../types/migration.types').ReportedBalance[];
  customers: CustomerCandidate[];
  inventory: InventoryCandidate[];
  sales: SaleCandidate[];
  receivables: ReceivableCandidate[];
  payables: PayableCandidate[];
  expenses: unknown[];
  cash: CashLedgerCandidate[];
  bank: unknown[];
  partnerLedger: unknown[];
  profitDistributions: unknown[];
  deferred: Array<Record<string, unknown>>;
};

export type ActiveResolution = {
  id: string;
  issueId?: string | null;
  entityType?: string | null;
  candidateId?: string | null;
  resolutionType: ResolutionType;
  originalValue?: unknown;
  resolvedValue?: unknown;
  reason?: string | null;
};

export type ReviewedDatasetState = {
  snapshot: PrivateSnapshot;
  reconciliation: ReconciliationItem[];
  excludedCandidateIds: string[];
  deferredCandidateIds: string[];
  customerMerges: Array<{ fromIds: string[]; intoId: string; canonicalName?: string }>;
  effects: string[];
};

function cloneSnapshot(snapshot: PrivateSnapshot): PrivateSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as PrivateSnapshot;
}

function patchCandidate(
  list: Array<Record<string, unknown>>,
  candidateId: string,
  patch: Record<string, unknown>,
): boolean {
  const idx = list.findIndex((c) => c.id === candidateId);
  if (idx < 0) return false;
  list[idx] = { ...list[idx], ...patch, reviewed: true };
  return true;
}

function recalculateReceivable(card: ReceivableCandidate): ReceivableCandidate {
  const paid = roundMoney(card.payments.reduce((s, p) => s + (p.amount ?? 0), 0));
  const calculated =
    card.principal == null ? null : roundMoney(card.principal - paid);
  const balanceMismatch =
    card.declaredOutstanding != null &&
    calculated != null &&
    !nearlyEqual(card.declaredOutstanding, calculated, 0.05);
  return { ...card, calculatedOutstanding: calculated, balanceMismatch };
}

function recalculatePayable(card: PayableCandidate): PayableCandidate {
  const paid = roundMoney(card.payments.reduce((s, p) => s + (p.amount ?? 0), 0));
  const calculated =
    card.principal == null ? null : roundMoney(card.principal - paid);
  const balanceMismatch =
    card.declaredRemaining != null &&
    calculated != null &&
    !nearlyEqual(card.declaredRemaining, calculated, 0.05);
  return { ...card, calculatedRemaining: calculated, balanceMismatch };
}

/**
 * Deterministic reviewed dataset = immutable original snapshot + active overlays.
 * Never mutates the input snapshot object in place for the caller's reference —
 * returns a deep clone.
 */
export function applyResolutionOverlays(
  original: PrivateSnapshot,
  resolutions: ActiveResolution[],
): ReviewedDatasetState {
  const snapshot = cloneSnapshot(original);
  const excludedCandidateIds: string[] = [];
  const deferredCandidateIds: string[] = [];
  const customerMerges: ReviewedDatasetState['customerMerges'] = [];
  const effects: string[] = [];

  for (const res of resolutions) {
    const patch =
      res.resolvedValue && typeof res.resolvedValue === 'object'
        ? (res.resolvedValue as Record<string, unknown>)
        : {};

    if (res.resolutionType === 'EXCLUDE_FROM_MIGRATION' && res.candidateId) {
      excludedCandidateIds.push(res.candidateId);
      effects.push(`exclude:${res.candidateId}`);
      continue;
    }
    if (res.resolutionType === 'DEFER' && res.candidateId) {
      deferredCandidateIds.push(res.candidateId);
      effects.push(`defer:${res.candidateId}`);
      continue;
    }

    if (res.resolutionType === 'MERGE_EXACT_DUPLICATE') {
      const fromIds = Array.isArray(patch.fromIds)
        ? (patch.fromIds as string[])
        : res.candidateId
          ? [res.candidateId]
          : [];
      const intoId = String(patch.intoId ?? res.candidateId ?? '');
      if (intoId && fromIds.length) {
        customerMerges.push({
          fromIds,
          intoId,
          canonicalName:
            typeof patch.canonicalName === 'string' ? patch.canonicalName : undefined,
        });
        const into = snapshot.customers.find((c) => c.id === intoId);
        if (into) {
          for (const fromId of fromIds) {
            if (fromId === intoId) continue;
            const from = snapshot.customers.find((c) => c.id === fromId);
            if (!from) continue;
            into.sources = [...into.sources, ...from.sources];
            excludedCandidateIds.push(fromId);
          }
          if (typeof patch.canonicalName === 'string') {
            into.displayName = patch.canonicalName;
          }
        }
        effects.push(`merge_customers:${intoId}`);
      }
      continue;
    }

    if (res.resolutionType === 'CHOOSE_CANONICAL_NAME' && res.candidateId) {
      patchCandidate(
        snapshot.customers as unknown as Array<Record<string, unknown>>,
        res.candidateId,
        { displayName: patch.canonicalName ?? patch.displayName },
      );
      effects.push(`canonical_name:${res.candidateId}`);
      continue;
    }

    if (res.candidateId && res.entityType === 'receivable') {
      const list = snapshot.receivables as unknown as Array<Record<string, unknown>>;
      if (res.resolutionType === 'CORRECT_VALUE') {
        if (Array.isArray(patch.payments)) {
          patchCandidate(list, res.candidateId, {
            payments: patch.payments,
            principal: patch.principal,
            customerName: patch.customerName,
            watchOrConcept: patch.watchOrConcept,
            declaredOutstanding: patch.declaredOutstanding,
            ambiguous: false,
          });
        } else {
          patchCandidate(list, res.candidateId, patch);
        }
        const idx = snapshot.receivables.findIndex((r) => r.id === res.candidateId);
        if (idx >= 0) snapshot.receivables[idx] = recalculateReceivable(snapshot.receivables[idx]);
        effects.push(`cxc_correct:${res.candidateId}`);
      } else if (res.resolutionType === 'ACCEPT_AS_IS') {
        patchCandidate(list, res.candidateId, { ambiguous: false, acceptedAsIs: true });
        effects.push(`cxc_accept:${res.candidateId}`);
      } else if (res.resolutionType === 'CONFIRM_FORMULA_OVERRIDE') {
        patchCandidate(list, res.candidateId, {
          ...patch,
          formulaOverride: true,
          ambiguous: false,
        });
        effects.push(`cxc_formula_override:${res.candidateId}`);
      }
      continue;
    }

    if (res.candidateId && res.entityType === 'payable') {
      const list = snapshot.payables as unknown as Array<Record<string, unknown>>;
      if (res.resolutionType === 'CORRECT_VALUE') {
        if (Array.isArray(patch.payments)) {
          patchCandidate(list, res.candidateId, {
            payments: patch.payments,
            principal: patch.principal,
            creditorName: patch.creditorName,
            watchOrConcept: patch.watchOrConcept,
            declaredRemaining: patch.declaredRemaining,
            formulaErrors: [],
            ambiguous: false,
          });
        } else {
          patchCandidate(list, res.candidateId, { ...patch, formulaErrors: [], ambiguous: false });
        }
        const idx = snapshot.payables.findIndex((p) => p.id === res.candidateId);
        if (idx >= 0) snapshot.payables[idx] = recalculatePayable(snapshot.payables[idx]);
        effects.push(`cxp_correct:${res.candidateId}`);
      } else if (res.resolutionType === 'ACCEPT_AS_IS') {
        patchCandidate(list, res.candidateId, { ambiguous: false, acceptedAsIs: true });
        effects.push(`cxp_accept:${res.candidateId}`);
      } else if (res.resolutionType === 'CONFIRM_FORMULA_OVERRIDE') {
        patchCandidate(list, res.candidateId, {
          ...patch,
          formulaErrors: [],
          formulaOverride: true,
          ambiguous: false,
        });
        const idx = snapshot.payables.findIndex((p) => p.id === res.candidateId);
        if (idx >= 0 && patch.declaredRemaining != null) {
          snapshot.payables[idx] = {
            ...snapshot.payables[idx],
            declaredRemaining: Number(patch.declaredRemaining),
            formulaErrors: [],
            ambiguous: false,
          };
        }
        effects.push(`cxp_formula_override:${res.candidateId}`);
      }
      continue;
    }

    if (res.candidateId && res.entityType === 'sale') {
      const list = snapshot.sales as unknown as Array<Record<string, unknown>>;
      if (res.resolutionType === 'ACCEPT_AS_IS') {
        patchCandidate(list, res.candidateId, { profitMismatch: false, acceptedDeclaredProfit: true });
      } else if (res.resolutionType === 'CORRECT_VALUE') {
        const sale = snapshot.sales.find((s) => s.id === res.candidateId);
        if (sale) {
          const cost = patch.cost != null ? Number(patch.cost) : sale.cost;
          const salePrice = patch.salePrice != null ? Number(patch.salePrice) : sale.salePrice;
          const extras = patch.extras != null ? Number(patch.extras) : sale.extras;
          const declaredProfit =
            patch.declaredProfit != null ? Number(patch.declaredProfit) : sale.declaredProfit;
          const useCalculated = patch.useCalculated === true;
          const calculatedProfit =
            salePrice == null ? null : roundMoney(salePrice - (cost ?? 0) - (extras ?? 0));
          patchCandidate(list, res.candidateId, {
            cost,
            salePrice,
            extras,
            declaredProfit: useCalculated ? calculatedProfit : declaredProfit,
            calculatedProfit,
            profitMismatch: false,
            serial:
              patch.serial === null
                ? null
                : typeof patch.serial === 'string'
                  ? patch.serial
                  : sale.serial,
          });
        }
      } else if (res.resolutionType === 'MARK_SERIAL_UNKNOWN') {
        patchCandidate(list, res.candidateId, { serial: null, serialUnknown: true });
      }
      effects.push(`sale:${res.resolutionType}:${res.candidateId}`);
      continue;
    }

    if (res.candidateId && res.entityType === 'inventory') {
      const list = snapshot.inventory as unknown as Array<Record<string, unknown>>;
      if (res.resolutionType === 'CORRECT_VALUE') {
        patchCandidate(list, res.candidateId, patch);
      } else if (res.resolutionType === 'MARK_SERIAL_UNKNOWN') {
        patchCandidate(list, res.candidateId, { serial: null, serialUnknown: true });
      } else if (res.resolutionType === 'CONFIRM_INVENTORY_OVERLAP') {
        patchCandidate(list, res.candidateId, {
          overlapConfirmed: true,
          overlapReason: res.reason,
        });
      } else if (res.resolutionType === 'ACCEPT_AS_IS') {
        patchCandidate(list, res.candidateId, { acceptedAsIs: true });
      }
      effects.push(`inventory:${res.resolutionType}:${res.candidateId}`);
      continue;
    }

    if (res.resolutionType === 'CONFIRM_SCOPE_DIFFERENCE' || res.resolutionType === 'ACKNOWLEDGE_WARNING') {
      effects.push(`ack:${res.issueId ?? res.id}`);
      continue;
    }

    if (res.resolutionType === 'CORRECT_VALUE' && res.entityType === 'reconciliation') {
      // Patch a reconciliation override marker into deferred notes
      effects.push(`recon_correct:${String(patch.concept ?? '')}`);
      continue;
    }
  }

  // Filter excluded from migration entities (except customers already merged)
  const exclude = new Set(excludedCandidateIds);
  snapshot.receivables = snapshot.receivables.filter((r) => !exclude.has(r.id));
  snapshot.payables = snapshot.payables.filter((p) => !exclude.has(p.id));
  snapshot.sales = snapshot.sales.filter((s) => !exclude.has(s.id));
  snapshot.inventory = snapshot.inventory.filter((i) => !exclude.has(i.id));
  snapshot.customers = snapshot.customers.filter((c) => !exclude.has(c.id));
  snapshot.deferred = snapshot.deferred.filter((d) => !exclude.has(String(d.id)));

  // Mark deferred destination items
  const defer = new Set(deferredCandidateIds);
  snapshot.deferred = snapshot.deferred.map((d) =>
    defer.has(String(d.id)) ? { ...d, explicitlyDeferred: true } : d,
  );

  const reconciliation = reconcileAgainstReporte({
    reportedBalances: original.reportedBalances ?? [],
    sales: snapshot.sales,
    inventory: snapshot.inventory,
    receivables: snapshot.receivables,
    payables: snapshot.payables,
    expenses: snapshot.expenses as never[],
    cash: snapshot.cash,
    bank: snapshot.bank as never[],
    partnerLedger: snapshot.partnerLedger as never[],
    crypto: snapshot.deferred
      .filter((d) => d.kind === 'CRYPTO')
      .map((d) => d as never),
    externalFloat: snapshot.deferred
      .filter((d) => d.kind === 'EXTERNAL_FLOAT')
      .map((d) => d as never),
    profitDistributions: snapshot.profitDistributions as never[],
  });

  // Prefer declared values from original REPORTE when recalculation lacks them
  const originalByConcept = new Map(
    (original.reconciliation ?? []).map((r) => [`${r.concept}|${r.currency}`, r]),
  );
  for (const item of reconciliation) {
    const orig = originalByConcept.get(`${item.concept}|${item.currency}`);
    if (orig && item.declaredValue == null && orig.declaredValue != null) {
      item.declaredValue = orig.declaredValue;
      item.sourceCells = orig.sourceCells;
    }
  }

  // Apply acknowledgement overlays on reconciliation concepts
  for (const res of resolutions) {
    if (
      res.resolutionType !== 'CONFIRM_SCOPE_DIFFERENCE' &&
      res.resolutionType !== 'ACKNOWLEDGE_WARNING' &&
      res.resolutionType !== 'ACCEPT_AS_IS'
    ) {
      continue;
    }
    const concept =
      res.resolvedValue &&
      typeof res.resolvedValue === 'object' &&
      'concept' in (res.resolvedValue as object)
        ? String((res.resolvedValue as { concept: string }).concept)
        : null;
    if (!concept) continue;
    for (const item of reconciliation) {
      if (item.concept === concept) {
        item.notes = `${item.notes ?? ''} | reviewed:${res.resolutionType}`.trim();
        if (res.resolutionType === 'CONFIRM_SCOPE_DIFFERENCE') {
          item.status = 'SCOPE_REVIEW_REQUIRED';
          item.notes = `${item.notes} (acknowledged scope difference)`;
        } else if (item.status === 'MISMATCH') {
          item.notes = `${item.notes} (acknowledged)`;
        }
      }
    }
  }

  snapshot.reconciliation = reconciliation;
  return {
    snapshot,
    reconciliation,
    excludedCandidateIds,
    deferredCandidateIds,
    customerMerges,
    effects,
  };
}

export function fingerprintReviewedDataset(payload: unknown): string {
  const canonical = stableCanonicalStringify(payload);
  return createHash('sha256').update(canonical).digest('hex');
}

/** Deterministic JSON for fingerprints (jsonb round-trips reorder keys). */
function stableCanonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalizeForFingerprint(value));
}

function canonicalizeForFingerprint(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalizeForFingerprint);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = canonicalizeForFingerprint(obj[key]);
  }
  return out;
}

export const DATASET_VERSION_PREFIX = 'wrist-caviar-reviewed-v';
