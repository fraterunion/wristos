import { createHash } from 'crypto';

import { normalizeCustomerName } from '../normalization/customer-normalize';
import type { ActiveResolution } from '../review/overlay-engine';
import type { PrivateSnapshot } from '../review/overlay-engine';
import type {
  BankLedgerCandidate,
  ExpenseCandidate,
  PartnerLedgerCandidate,
  ProfitDistributionCandidate,
  ReconciliationItem,
} from '../types/migration.types';
import { nearlyEqual, roundMoney } from '../workbook/cell.util';
import { buildConflict } from './conflicts';
import {
  candidateFingerprint,
  fingerprintPrefix,
  saleMigrationFingerprint,
  sha256Hex,
  stableStringify,
} from './hash';
import {
  EXPENSE_CATEGORY_MAP,
  PLANNER_VERSION,
  type DryRunConflictCode,
} from './planner.constants';
import type {
  DestinationState,
  ExplicitLink,
  FinancialSummary,
  PlannedItem,
  PlanReconciliationRow,
  PlannerResult,
} from './plan-types';

const DEPENDENCY_ORDER = [
  'CUSTOMERS',
  'INVENTORY',
  'SALES',
  'RECEIVABLES',
  'RECEIVABLE_PAYMENTS',
  'PAYABLES',
  'PAYABLE_PAYMENTS',
  'EXPENSES',
  'CASH_LEDGER',
  'BANK_LEDGER',
  'PARTNER_LEDGER',
  'PROFIT_DISTRIBUTIONS',
  'DEFERRED',
] as const;

function safeProvenance(source: {
  sourceSheet?: string;
  sourceRow?: number;
  sourceBlockId?: string;
}): Record<string, unknown> {
  return {
    sourceSheet: source.sourceSheet ?? null,
    sourceRow: source.sourceRow ?? null,
    sourceBlockId: source.sourceBlockId ?? null,
  };
}

function mapLookup(
  state: DestinationState,
  entityType: string,
  candidateId: string,
): { destinationId: string; sourceFingerprint: string } | null {
  const row = state.maps.find(
    (m) => m.entityType === entityType && m.sourceCandidateId === candidateId,
  );
  return row
    ? { destinationId: row.destinationId, sourceFingerprint: row.sourceFingerprint }
    : null;
}

function explicitLink(
  links: ExplicitLink[],
  entityType: string,
  candidateId: string,
): string | null {
  return (
    links.find((l) => l.entityType === entityType && l.candidateId === candidateId)
      ?.destinationId ?? null
  );
}

function extractExplicitLinks(resolutions: ActiveResolution[]): ExplicitLink[] {
  const links: ExplicitLink[] = [];
  for (const res of resolutions) {
    if (res.resolutionType !== 'MAP_ENTITY' || !res.candidateId) continue;
    const patch =
      res.resolvedValue && typeof res.resolvedValue === 'object'
        ? (res.resolvedValue as Record<string, unknown>)
        : {};
    const destinationId = String(
      patch.destinationId ?? patch.existingClientId ?? patch.clientId ?? '',
    );
    if (!destinationId) continue;
    const entityType =
      res.entityType === 'customer' || res.entityType === 'CLIENT'
        ? 'customer'
        : res.entityType === 'inventory' || res.entityType === 'watch'
          ? 'inventory'
          : (res.entityType ?? 'customer');
    links.push({ candidateId: res.candidateId, entityType, destinationId });
  }
  return links;
}

function mapExpenseCategory(concept: string): string | null {
  for (const rule of EXPENSE_CATEGORY_MAP) {
    if (rule.pattern.test(concept)) return rule.category;
  }
  return null;
}

function emptyFinancial(current: DestinationState): FinancialSummary {
  return {
    customersCreated: 0,
    customersLinked: 0,
    inventoryCreated: 0,
    inventoryLinked: 0,
    historicalDealsCreated: 0,
    historicalRevenue: 0,
    historicalCost: 0,
    historicalExtras: 0,
    historicalApprovedProfit: 0,
    receivablePrincipal: 0,
    receivablePayments: 0,
    receivableEndingOutstanding: 0,
    payablePrincipal: 0,
    payablePayments: 0,
    payableEndingOutstanding: 0,
    expenses: 0,
    cashMxnInflows: 0,
    cashMxnOutflows: 0,
    cashMxnEndingBalance: current.balances.cashMxn,
    cashUsdInflows: 0,
    cashUsdOutflows: 0,
    cashUsdEndingBalance: current.balances.cashUsd,
    bankDeposits: 0,
    bankWithdrawals: 0,
    bankCommissions: 0,
    bankEndingBalance: current.balances.bank,
    partnerLedgerImpact: 0,
    profitDistributionsImpact: 0,
    current: {
      clients: current.counts.clients,
      watches: current.counts.watches,
      deals: current.counts.deals,
      receivables: current.counts.receivables,
      payables: current.counts.payables,
      expenses: current.counts.expenses,
      cashMxn: current.balances.cashMxn,
      cashUsd: current.balances.cashUsd,
      bank: current.balances.bank,
      receivableOutstanding: current.balances.receivableOutstanding,
      payableOutstanding: current.balances.payableOutstanding,
    },
    projected: {},
    label: 'Simulación; ningún dato ha sido modificado.',
  };
}

export function computePlanFingerprint(input: {
  tenantId: string;
  datasetFingerprint: string;
  plannerVersion: string;
  destinationStateFingerprint: string;
  items: PlannedItem[];
}): string {
  const ordered = [...input.items].sort((a, b) => a.sequence - b.sequence);
  return sha256Hex({
    tenantId: input.tenantId,
    datasetFingerprint: input.datasetFingerprint,
    plannerVersion: input.plannerVersion,
    destinationStateFingerprint: input.destinationStateFingerprint,
    items: ordered.map((i) => ({
      entityType: i.entityType,
      sourceCandidateId: i.sourceCandidateId,
      action: i.action,
      destinationId: i.destinationId ?? null,
      plannedPayload: i.plannedPayload ?? null,
      sourceFingerprint: i.sourceFingerprint,
    })),
  });
}

export function buildDryRunPlan(params: {
  tenantId: string;
  datasetId: string;
  datasetFingerprint: string;
  snapshot: PrivateSnapshot;
  destination: DestinationState;
  resolutions: ActiveResolution[];
  deferredGroups: string[];
}): PlannerResult {
  const { snapshot, destination } = params;
  const links = extractExplicitLinks(params.resolutions);
  const items: PlannedItem[] = [];
  let seq = 0;
  const nextSeq = () => ++seq;

  const customerActionById = new Map<string, PlannedItem>();
  const financial = emptyFinancial(destination);

  const deferredGroupSet = new Set(params.deferredGroups);
  const sourceCounts: Record<string, number> = {
    customers: snapshot.customers.length,
    inventory: snapshot.inventory.length,
    sales: snapshot.sales.length,
    receivables: snapshot.receivables.length,
    receivablePayments: snapshot.receivables.reduce((s, r) => s + r.payments.length, 0),
    payables: snapshot.payables.length,
    payablePayments: snapshot.payables.reduce((s, p) => s + p.payments.length, 0),
    expenses: Array.isArray(snapshot.expenses) ? snapshot.expenses.length : 0,
    cash: snapshot.cash.length,
    bank: Array.isArray(snapshot.bank) ? snapshot.bank.length : 0,
    partnerLedger: Array.isArray(snapshot.partnerLedger) ? snapshot.partnerLedger.length : 0,
    profitDistributions: Array.isArray(snapshot.profitDistributions)
      ? snapshot.profitDistributions.length
      : 0,
    deferred: snapshot.deferred.length,
  };

  // ---- Customers ----
  const activeClients = destination.clients.filter((c) => !c.deletedAt);
  const clientsByNorm = new Map<string, typeof activeClients>();
  for (const c of activeClients) {
    const list = clientsByNorm.get(c.normalizedName) ?? [];
    list.push(c);
    clientsByNorm.set(c.normalizedName, list);
  }

  const saleCustomerDeps = new Map<string, string>(); // normalizedName -> customer:sourceId

  for (const cust of [...snapshot.customers].sort((a, b) => a.id.localeCompare(b.id))) {
    const fp = candidateFingerprint('customer', cust.id, {
      normalizedName: cust.normalizedName,
      displayName: cust.displayName,
    });
    const depKey = `customer:${cust.id}`;
    const mapped = mapLookup(destination, 'customer', cust.id);
    const explicit = explicitLink(links, 'customer', cust.id);
    const dependents =
      snapshot.sales.filter(
        (s) => normalizeCustomerName(s.customerName) === cust.normalizedName,
      ).length +
      snapshot.receivables.filter(
        (r) => normalizeCustomerName(r.customerName) === cust.normalizedName,
      ).length;

    let item: PlannedItem;

    if (mapped && mapped.sourceFingerprint === fp) {
      item = {
        entityGroup: 'CUSTOMERS',
        entityType: 'customer',
        sourceCandidateId: cust.id,
        sourceFingerprint: fp,
        action: 'SKIP',
        confidence: 'MIGRATION_MAP',
        destinationId: mapped.destinationId,
        dependencyKeys: [],
        plannedPayload: null,
        comparisonSnapshot: { destinationId: mapped.destinationId },
        provenance: {
          sourceCount: cust.sources.length,
          dependentRecordCount: dependents,
        },
        sequence: nextSeq(),
      };
    } else if (explicit) {
      item = {
        entityGroup: 'CUSTOMERS',
        entityType: 'customer',
        sourceCandidateId: cust.id,
        sourceFingerprint: fp,
        action: 'LINK',
        confidence: 'EXPLICIT_RESOLUTION',
        destinationId: explicit,
        dependencyKeys: [],
        plannedPayload: {
          displayName: cust.displayName,
          aliasCount: cust.sources.length,
        },
        comparisonSnapshot: { destinationId: explicit },
        provenance: {
          sourceCount: cust.sources.length,
          dependentRecordCount: dependents,
        },
        sequence: nextSeq(),
      };
      financial.customersLinked += 1;
    } else {
      const matches = clientsByNorm.get(cust.normalizedName) ?? [];
      if (matches.length > 1) {
        const conflict = buildConflict('CUSTOMER_MATCH_AMBIGUOUS', {
          sourceEntity: 'customer',
          provenance: { candidateId: cust.id },
          suggestedAction: 'Elija el cliente destino con MAP_ENTITY o cree uno nuevo tras revisión.',
        });
        item = {
          entityGroup: 'CUSTOMERS',
          entityType: 'customer',
          sourceCandidateId: cust.id,
          sourceFingerprint: fp,
          action: 'CONFLICT',
          conflictCode: conflict.code,
          conflictDetails: conflict as unknown as Record<string, unknown>,
          dependencyKeys: [],
          plannedPayload: { displayName: cust.displayName },
          provenance: {
            sourceCount: cust.sources.length,
            dependentRecordCount: dependents,
            matchCount: matches.length,
          },
          sequence: nextSeq(),
        };
      } else if (matches.length === 1) {
        item = {
          entityGroup: 'CUSTOMERS',
          entityType: 'customer',
          sourceCandidateId: cust.id,
          sourceFingerprint: fp,
          action: 'LINK',
          confidence: 'EXACT_NORMALIZED_MATCH',
          destinationId: matches[0].id,
          dependencyKeys: [],
          plannedPayload: {
            displayName: cust.displayName,
            aliasCount: cust.sources.length,
          },
          comparisonSnapshot: { destinationId: matches[0].id },
          provenance: {
            sourceCount: cust.sources.length,
            dependentRecordCount: dependents,
          },
          sequence: nextSeq(),
        };
        financial.customersLinked += 1;
      } else if (!cust.displayName?.trim()) {
        const conflict = buildConflict('DESTINATION_REQUIRED_FIELD_MISSING', {
          sourceEntity: 'customer',
          provenance: { candidateId: cust.id },
        });
        item = {
          entityGroup: 'CUSTOMERS',
          entityType: 'customer',
          sourceCandidateId: cust.id,
          sourceFingerprint: fp,
          action: 'CONFLICT',
          conflictCode: conflict.code,
          conflictDetails: conflict as unknown as Record<string, unknown>,
          dependencyKeys: [],
          plannedPayload: null,
          provenance: { sourceCount: cust.sources.length },
          sequence: nextSeq(),
        };
      } else {
        item = {
          entityGroup: 'CUSTOMERS',
          entityType: 'customer',
          sourceCandidateId: cust.id,
          sourceFingerprint: fp,
          action: 'CREATE',
          confidence: 'NO_SAFE_MATCH',
          dependencyKeys: [],
          plannedPayload: {
            name: cust.displayName,
            aliasCount: cust.sources.length,
            migrationSource: 'wrist-caviar',
            migrationDatasetId: params.datasetId,
            migrationCandidateId: cust.id,
            migrationFingerprint: fp,
          },
          provenance: {
            sourceCount: cust.sources.length,
            dependentRecordCount: dependents,
          },
          sequence: nextSeq(),
        };
        financial.customersCreated += 1;
      }
    }

    items.push(item);
    customerActionById.set(cust.id, item);
    saleCustomerDeps.set(cust.normalizedName, depKey);
  }

  // Index customers by normalized name for sales/CXC that may not have customer candidates
  for (const cust of snapshot.customers) {
    if (!saleCustomerDeps.has(cust.normalizedName)) {
      saleCustomerDeps.set(cust.normalizedName, `customer:${cust.id}`);
    }
  }

  // ---- Inventory ----
  const activeWatches = destination.watches.filter((w) => !w.deletedAt);
  const watchesBySerial = new Map<string, typeof activeWatches>();
  for (const w of activeWatches) {
    if (!w.serialNumber) continue;
    const key = w.serialNumber.trim().toUpperCase();
    const list = watchesBySerial.get(key) ?? [];
    list.push(w);
    watchesBySerial.set(key, list);
  }

  for (const inv of [...snapshot.inventory].sort((a, b) => a.id.localeCompare(b.id))) {
    const fp = candidateFingerprint('inventory', inv.id, {
      brand: inv.brand,
      model: inv.model,
      reference: inv.reference,
      serial: inv.serial,
      cost: inv.cost,
    });
    const mapped = mapLookup(destination, 'inventory', inv.id);
    const explicit = explicitLink(links, 'inventory', inv.id);
    const serialKey = inv.serial?.trim().toUpperCase() ?? null;

    let item: PlannedItem;
    if (mapped && mapped.sourceFingerprint === fp) {
      item = {
        entityGroup: 'INVENTORY',
        entityType: 'inventory',
        sourceCandidateId: inv.id,
        sourceFingerprint: fp,
        action: 'SKIP',
        confidence: 'MIGRATION_MAP',
        destinationId: mapped.destinationId,
        dependencyKeys: [],
        plannedPayload: null,
        provenance: safeProvenance(inv.source),
        sequence: nextSeq(),
      };
    } else if (explicit) {
      item = {
        entityGroup: 'INVENTORY',
        entityType: 'inventory',
        sourceCandidateId: inv.id,
        sourceFingerprint: fp,
        action: 'LINK',
        confidence: 'EXPLICIT_RESOLUTION',
        destinationId: explicit,
        dependencyKeys: [],
        plannedPayload: { brand: inv.brand, model: inv.model, reference: inv.reference },
        provenance: safeProvenance(inv.source),
        sequence: nextSeq(),
      };
      financial.inventoryLinked += 1;
    } else if (serialKey) {
      const matches = watchesBySerial.get(serialKey) ?? [];
      if (matches.length > 1) {
        const conflict = buildConflict('INVENTORY_SERIAL_CONFLICT', {
          sourceEntity: 'inventory',
          provenance: safeProvenance(inv.source),
        });
        item = {
          entityGroup: 'INVENTORY',
          entityType: 'inventory',
          sourceCandidateId: inv.id,
          sourceFingerprint: fp,
          action: 'CONFLICT',
          conflictCode: conflict.code,
          conflictDetails: conflict as unknown as Record<string, unknown>,
          dependencyKeys: [],
          plannedPayload: { brand: inv.brand, model: inv.model },
          provenance: safeProvenance(inv.source),
          sequence: nextSeq(),
        };
      } else if (matches.length === 1) {
        const w = matches[0];
        if (w.status === 'SOLD' || w.status === 'DELIVERED') {
          const conflict = buildConflict('INVENTORY_SERIAL_CONFLICT', {
            sourceEntity: 'inventory',
            provenance: { ...safeProvenance(inv.source), reason: 'sold_status' },
            suggestedAction:
              'El serial existe en un reloj vendido; no vincular stock actual automáticamente.',
          });
          item = {
            entityGroup: 'INVENTORY',
            entityType: 'inventory',
            sourceCandidateId: inv.id,
            sourceFingerprint: fp,
            action: 'CONFLICT',
            conflictCode: conflict.code,
            conflictDetails: conflict as unknown as Record<string, unknown>,
            dependencyKeys: [],
            plannedPayload: { brand: inv.brand, model: inv.model },
            provenance: safeProvenance(inv.source),
            sequence: nextSeq(),
          };
        } else {
          item = {
            entityGroup: 'INVENTORY',
            entityType: 'inventory',
            sourceCandidateId: inv.id,
            sourceFingerprint: fp,
            action: 'LINK',
            confidence: 'EXACT_SERIAL',
            destinationId: w.id,
            dependencyKeys: [],
            plannedPayload: { brand: inv.brand, model: inv.model, reference: inv.reference },
            comparisonSnapshot: { destinationId: w.id, status: w.status },
            provenance: safeProvenance(inv.source),
            sequence: nextSeq(),
          };
          financial.inventoryLinked += 1;
        }
      } else if (!inv.brand || !inv.model) {
        const conflict = buildConflict('DESTINATION_REQUIRED_FIELD_MISSING', {
          sourceEntity: 'inventory',
          provenance: safeProvenance(inv.source),
        });
        item = {
          entityGroup: 'INVENTORY',
          entityType: 'inventory',
          sourceCandidateId: inv.id,
          sourceFingerprint: fp,
          action: 'CONFLICT',
          conflictCode: conflict.code,
          conflictDetails: conflict as unknown as Record<string, unknown>,
          dependencyKeys: [],
          plannedPayload: null,
          provenance: safeProvenance(inv.source),
          sequence: nextSeq(),
        };
      } else {
        item = {
          entityGroup: 'INVENTORY',
          entityType: 'inventory',
          sourceCandidateId: inv.id,
          sourceFingerprint: fp,
          action: 'CREATE',
          confidence: 'NO_SAFE_MATCH',
          dependencyKeys: [],
          plannedPayload: {
            brand: inv.brand,
            model: inv.model,
            reference: inv.reference,
            serialNumber: inv.serial,
            cost: inv.cost,
            status: 'AVAILABLE',
            migrationSource: 'wrist-caviar',
            migrationDatasetId: params.datasetId,
            migrationCandidateId: inv.id,
            migrationFingerprint: fp,
          },
          provenance: safeProvenance(inv.source),
          sequence: nextSeq(),
        };
        financial.inventoryCreated += 1;
      }
    } else {
      // No serial — never auto-link by reference alone
      if (!inv.brand || !inv.model) {
        const conflict = buildConflict('DESTINATION_REQUIRED_FIELD_MISSING', {
          sourceEntity: 'inventory',
          provenance: safeProvenance(inv.source),
        });
        item = {
          entityGroup: 'INVENTORY',
          entityType: 'inventory',
          sourceCandidateId: inv.id,
          sourceFingerprint: fp,
          action: 'CONFLICT',
          conflictCode: conflict.code,
          conflictDetails: conflict as unknown as Record<string, unknown>,
          dependencyKeys: [],
          plannedPayload: null,
          provenance: safeProvenance(inv.source),
          sequence: nextSeq(),
        };
      } else {
        item = {
          entityGroup: 'INVENTORY',
          entityType: 'inventory',
          sourceCandidateId: inv.id,
          sourceFingerprint: fp,
          action: 'CREATE',
          confidence: 'NO_SERIAL',
          dependencyKeys: [],
          plannedPayload: {
            brand: inv.brand,
            model: inv.model,
            reference: inv.reference,
            serialNumber: null,
            cost: inv.cost,
            status: 'AVAILABLE',
            migrationSource: 'wrist-caviar',
            migrationDatasetId: params.datasetId,
            migrationCandidateId: inv.id,
            migrationFingerprint: fp,
          },
          provenance: safeProvenance(inv.source),
          sequence: nextSeq(),
        };
        financial.inventoryCreated += 1;
      }
    }
    items.push(item);
  }

  // ---- Sales (historical deals; watchId null — no inventory mutation) ----
  const dealsByImportFp = new Map<string, string>();
  for (const d of destination.deals) {
    if (d.importFingerprint && !d.deletedAt) {
      dealsByImportFp.set(d.importFingerprint, d.id);
    }
  }

  for (const sale of [...snapshot.sales].sort((a, b) => a.id.localeCompare(b.id))) {
    const custNorm = normalizeCustomerName(sale.customerName);
    const customerDep = saleCustomerDeps.get(custNorm) ?? null;
    const customerItem = customerDep
      ? customerActionById.get(customerDep.replace('customer:', ''))
      : undefined;

    // Also try finding customer plan by normalized name
    let customerPlan: PlannedItem | undefined = customerItem;
    if (!customerPlan) {
      for (const [id, plan] of customerActionById) {
        const c = snapshot.customers.find((x) => x.id === id);
        if (c && c.normalizedName === custNorm) {
          customerPlan = plan;
          break;
        }
      }
    }

    const approvedProfit =
      sale.declaredProfit != null && !sale.profitMismatch
        ? sale.declaredProfit
        : sale.calculatedProfit;

    const importFp = saleMigrationFingerprint({
      datasetId: params.datasetId,
      candidateId: sale.id,
      saleDate: sale.saleDate,
      customerNormalized: custNorm,
      brand: sale.brand,
      model: sale.model,
      reference: sale.reference,
      serial: sale.serial,
      cost: sale.cost,
      salePrice: sale.salePrice,
      extras: sale.extras,
      approvedProfit,
    });
    const sourceFp = candidateFingerprint('sale', sale.id, importFp);
    const mapped = mapLookup(destination, 'sale', sale.id);
    const deps = customerDep ? [customerDep] : [];

    let item: PlannedItem;
    if (mapped && mapped.sourceFingerprint === sourceFp) {
      item = {
        entityGroup: 'SALES',
        entityType: 'sale',
        sourceCandidateId: sale.id,
        sourceFingerprint: sourceFp,
        action: 'SKIP',
        confidence: 'MIGRATION_MAP',
        destinationId: mapped.destinationId,
        dependencyKeys: deps,
        plannedPayload: null,
        provenance: safeProvenance(sale.source),
        sequence: nextSeq(),
      };
    } else if (dealsByImportFp.has(importFp)) {
      item = {
        entityGroup: 'SALES',
        entityType: 'sale',
        sourceCandidateId: sale.id,
        sourceFingerprint: sourceFp,
        action: 'SKIP',
        confidence: 'IMPORT_FINGERPRINT',
        destinationId: dealsByImportFp.get(importFp)!,
        dependencyKeys: deps,
        plannedPayload: null,
        provenance: safeProvenance(sale.source),
        sequence: nextSeq(),
      };
    } else if (
      !customerPlan ||
      customerPlan.action === 'CONFLICT' ||
      customerPlan.action === 'DEFERRED'
    ) {
      const conflict = buildConflict('DEPENDENCY_UNRESOLVED', {
        sourceEntity: 'sale',
        provenance: safeProvenance(sale.source),
        suggestedAction: 'Resuelva primero el cliente asociado.',
      });
      item = {
        entityGroup: 'SALES',
        entityType: 'sale',
        sourceCandidateId: sale.id,
        sourceFingerprint: sourceFp,
        action: 'CONFLICT',
        conflictCode: conflict.code,
        conflictDetails: conflict as unknown as Record<string, unknown>,
        dependencyKeys: deps,
        plannedPayload: null,
        provenance: safeProvenance(sale.source),
        sequence: nextSeq(),
      };
    } else if (sale.salePrice == null || !sale.brand || !sale.model) {
      const conflict = buildConflict('DESTINATION_REQUIRED_FIELD_MISSING', {
        sourceEntity: 'sale',
        provenance: safeProvenance(sale.source),
      });
      item = {
        entityGroup: 'SALES',
        entityType: 'sale',
        sourceCandidateId: sale.id,
        sourceFingerprint: sourceFp,
        action: 'CONFLICT',
        conflictCode: conflict.code,
        conflictDetails: conflict as unknown as Record<string, unknown>,
        dependencyKeys: deps,
        plannedPayload: null,
        provenance: safeProvenance(sale.source),
        sequence: nextSeq(),
      };
    } else {
      // Detect ambiguous duplicate among planned creates with same fingerprint body sans candidateId
      const ambiguousDup = snapshot.sales.filter((other) => {
        if (other.id === sale.id) return false;
        const otherFp = saleMigrationFingerprint({
          datasetId: params.datasetId,
          candidateId: other.id,
          saleDate: other.saleDate,
          customerNormalized: normalizeCustomerName(other.customerName),
          brand: other.brand,
          model: other.model,
          reference: other.reference,
          serial: other.serial,
          cost: other.cost,
          salePrice: other.salePrice,
          extras: other.extras,
          approvedProfit:
            other.declaredProfit != null && !other.profitMismatch
              ? other.declaredProfit
              : other.calculatedProfit,
        });
        // Same business identity excluding candidate id
        const a = saleMigrationFingerprint({
          datasetId: params.datasetId,
          candidateId: '',
          saleDate: sale.saleDate,
          customerNormalized: custNorm,
          brand: sale.brand,
          model: sale.model,
          reference: sale.reference,
          serial: sale.serial,
          cost: sale.cost,
          salePrice: sale.salePrice,
          extras: sale.extras,
          approvedProfit,
        });
        const b = saleMigrationFingerprint({
          datasetId: params.datasetId,
          candidateId: '',
          saleDate: other.saleDate,
          customerNormalized: normalizeCustomerName(other.customerName),
          brand: other.brand,
          model: other.model,
          reference: other.reference,
          serial: other.serial,
          cost: other.cost,
          salePrice: other.salePrice,
          extras: other.extras,
          approvedProfit:
            other.declaredProfit != null && !other.profitMismatch
              ? other.declaredProfit
              : other.calculatedProfit,
        });
        void otherFp;
        return a === b;
      });

      if (ambiguousDup.length > 0 && sale.serial == null) {
        const conflict = buildConflict('HISTORICAL_SALE_DUPLICATE_AMBIGUOUS', {
          sourceEntity: 'sale',
          provenance: safeProvenance(sale.source),
        });
        item = {
          entityGroup: 'SALES',
          entityType: 'sale',
          sourceCandidateId: sale.id,
          sourceFingerprint: sourceFp,
          action: 'CONFLICT',
          conflictCode: conflict.code,
          conflictDetails: conflict as unknown as Record<string, unknown>,
          dependencyKeys: deps,
          plannedPayload: null,
          provenance: safeProvenance(sale.source),
          sequence: nextSeq(),
        };
      } else {
        item = {
          entityGroup: 'SALES',
          entityType: 'sale',
          sourceCandidateId: sale.id,
          sourceFingerprint: sourceFp,
          action: 'CREATE',
          confidence: 'HISTORICAL_DEAL',
          dependencyKeys: deps,
          plannedPayload: {
            watchId: null,
            stage: 'CLOSED_WON',
            soldAt: sale.saleDate,
            agreedPrice: sale.salePrice,
            historicalCost: sale.cost,
            extrasAmount: sale.extras,
            reportedProfit: approvedProfit,
            calculatedProfit: sale.calculatedProfit,
            paymentCount: sale.paymentCount,
            importFingerprint: importFp,
            brandSnapshot: sale.brand,
            modelSnapshot: sale.model,
            referenceSnapshot: sale.reference,
            serialSnapshot: sale.serial,
            mutatesInventory: false,
            migrationSource: 'wrist-caviar',
            migrationDatasetId: params.datasetId,
            migrationCandidateId: sale.id,
            migrationFingerprint: sourceFp,
          },
          provenance: safeProvenance(sale.source),
          sequence: nextSeq(),
        };
        financial.historicalDealsCreated += 1;
        financial.historicalRevenue += sale.salePrice ?? 0;
        financial.historicalCost += sale.cost ?? 0;
        financial.historicalExtras += sale.extras ?? 0;
        financial.historicalApprovedProfit += approvedProfit ?? 0;
      }
    }
    items.push(item);
  }

  // ---- Receivables + payments ----
  for (const card of [...snapshot.receivables].sort((a, b) => a.id.localeCompare(b.id))) {
    const custNorm = normalizeCustomerName(card.customerName);
    const customerDep = saleCustomerDeps.get(custNorm);
    let customerPlan: PlannedItem | undefined;
    if (customerDep) {
      customerPlan = customerActionById.get(customerDep.replace('customer:', ''));
    }
    const paid = roundMoney(card.payments.reduce((s, p) => s + (p.amount ?? 0), 0));
    const outstanding =
      card.declaredOutstanding != null
        ? card.declaredOutstanding
        : card.calculatedOutstanding;
    const fp = candidateFingerprint('receivable', card.id, {
      customer: custNorm,
      principal: card.principal,
      concept: card.watchOrConcept,
      outstanding,
      payments: card.payments.map((p) => ({ amount: p.amount, date: p.paymentDate })),
    });
    const deps = customerDep ? [customerDep] : [];
    const mapped = mapLookup(destination, 'receivable', card.id);

    let parent: PlannedItem;
    if (mapped && mapped.sourceFingerprint === fp) {
      parent = {
        entityGroup: 'RECEIVABLES',
        entityType: 'receivable',
        sourceCandidateId: card.id,
        sourceFingerprint: fp,
        action: 'SKIP',
        destinationId: mapped.destinationId,
        dependencyKeys: deps,
        plannedPayload: null,
        provenance: safeProvenance(card.source),
        sequence: nextSeq(),
      };
    } else if (
      !customerPlan ||
      customerPlan.action === 'CONFLICT' ||
      customerPlan.action === 'DEFERRED'
    ) {
      const conflict = buildConflict('DEPENDENCY_UNRESOLVED', {
        sourceEntity: 'receivable',
        provenance: safeProvenance(card.source),
      });
      parent = {
        entityGroup: 'RECEIVABLES',
        entityType: 'receivable',
        sourceCandidateId: card.id,
        sourceFingerprint: fp,
        action: 'CONFLICT',
        conflictCode: conflict.code,
        conflictDetails: conflict as unknown as Record<string, unknown>,
        dependencyKeys: deps,
        plannedPayload: null,
        provenance: safeProvenance(card.source),
        sequence: nextSeq(),
      };
    } else if (card.principal == null || card.balanceMismatch) {
      const conflict = buildConflict('RECEIVABLE_BALANCE_INVALID', {
        sourceEntity: 'receivable',
        provenance: safeProvenance(card.source),
        suggestedAction: 'Corrija o confirme el saldo CXC en la revisión Phase 1.5.',
      });
      parent = {
        entityGroup: 'RECEIVABLES',
        entityType: 'receivable',
        sourceCandidateId: card.id,
        sourceFingerprint: fp,
        action: 'CONFLICT',
        conflictCode: conflict.code,
        conflictDetails: conflict as unknown as Record<string, unknown>,
        dependencyKeys: deps,
        plannedPayload: null,
        provenance: safeProvenance(card.source),
        sequence: nextSeq(),
      };
    } else {
      parent = {
        entityGroup: 'RECEIVABLES',
        entityType: 'receivable',
        sourceCandidateId: card.id,
        sourceFingerprint: fp,
        action: 'CREATE',
        dependencyKeys: deps,
        plannedPayload: {
          type: 'RECEIVABLE',
          counterpartyName: card.customerName,
          counterpartyType: 'CLIENT',
          concept: card.watchOrConcept ?? 'CXC',
          totalAmount: card.principal,
          currency: card.currency === 'USD' ? 'USD' : 'MXN',
          plannedPaymentsSum: paid,
          plannedOutstanding: outstanding,
          migrationSource: 'wrist-caviar',
          migrationDatasetId: params.datasetId,
          migrationCandidateId: card.id,
          migrationFingerprint: fp,
        },
        provenance: safeProvenance(card.source),
        sequence: nextSeq(),
      };
      financial.receivablePrincipal += card.principal;
      financial.receivablePayments += paid;
      financial.receivableEndingOutstanding += outstanding ?? card.principal - paid;
    }
    items.push(parent);

    const parentKey = `receivable:${card.id}`;
    for (const pay of [...card.payments].sort((a, b) => a.id.localeCompare(b.id))) {
      const payFp = candidateFingerprint('receivable_payment', pay.id, {
        amount: pay.amount,
        date: pay.paymentDate,
        parent: card.id,
      });
      const payMapped = mapLookup(destination, 'receivable_payment', pay.id);
      if (payMapped && payMapped.sourceFingerprint === payFp) {
        items.push({
          entityGroup: 'RECEIVABLES',
          entityType: 'receivable_payment',
          sourceCandidateId: pay.id,
          sourceFingerprint: payFp,
          action: 'SKIP',
          destinationId: payMapped.destinationId,
          dependencyKeys: [parentKey, ...deps],
          plannedPayload: null,
          provenance: safeProvenance(pay.source),
          sequence: nextSeq(),
        });
      } else if (parent.action === 'CONFLICT') {
        const conflict = buildConflict('DEPENDENCY_UNRESOLVED', {
          sourceEntity: 'receivable_payment',
          provenance: safeProvenance(pay.source),
        });
        items.push({
          entityGroup: 'RECEIVABLES',
          entityType: 'receivable_payment',
          sourceCandidateId: pay.id,
          sourceFingerprint: payFp,
          action: 'CONFLICT',
          conflictCode: conflict.code,
          conflictDetails: conflict as unknown as Record<string, unknown>,
          dependencyKeys: [parentKey, ...deps],
          plannedPayload: null,
          provenance: safeProvenance(pay.source),
          sequence: nextSeq(),
        });
      } else if (pay.amount == null) {
        const conflict = buildConflict('DESTINATION_REQUIRED_FIELD_MISSING', {
          sourceEntity: 'receivable_payment',
          provenance: safeProvenance(pay.source),
        });
        items.push({
          entityGroup: 'RECEIVABLES',
          entityType: 'receivable_payment',
          sourceCandidateId: pay.id,
          sourceFingerprint: payFp,
          action: 'CONFLICT',
          conflictCode: conflict.code,
          conflictDetails: conflict as unknown as Record<string, unknown>,
          dependencyKeys: [parentKey, ...deps],
          plannedPayload: null,
          provenance: safeProvenance(pay.source),
          sequence: nextSeq(),
        });
      } else {
        items.push({
          entityGroup: 'RECEIVABLES',
          entityType: 'receivable_payment',
          sourceCandidateId: pay.id,
          sourceFingerprint: payFp,
          action: 'CREATE',
          dependencyKeys: [parentKey, ...deps],
          plannedPayload: {
            amount: pay.amount,
            paidAt: pay.paymentDate,
            notes: pay.label,
            migrationCandidateId: pay.id,
          },
          provenance: safeProvenance(pay.source),
          sequence: nextSeq(),
        });
      }
    }
  }

  // ---- Payables + payments (free-form creditorName on AccountEntry) ----
  for (const card of [...snapshot.payables].sort((a, b) => a.id.localeCompare(b.id))) {
    const paid = roundMoney(card.payments.reduce((s, p) => s + (p.amount ?? 0), 0));
    const remaining =
      card.declaredRemaining != null ? card.declaredRemaining : card.calculatedRemaining;
    const fp = candidateFingerprint('payable', card.id, {
      creditor: card.creditorName,
      principal: card.principal,
      concept: card.watchOrConcept,
      remaining,
      payments: card.payments.map((p) => ({ amount: p.amount, date: p.paymentDate })),
    });
    const mapped = mapLookup(destination, 'payable', card.id);
    let parent: PlannedItem;

    if (mapped && mapped.sourceFingerprint === fp) {
      parent = {
        entityGroup: 'PAYABLES',
        entityType: 'payable',
        sourceCandidateId: card.id,
        sourceFingerprint: fp,
        action: 'SKIP',
        destinationId: mapped.destinationId,
        dependencyKeys: [],
        plannedPayload: null,
        provenance: safeProvenance(card.source),
        sequence: nextSeq(),
      };
    } else if (
      (card.formulaErrors?.length ?? 0) > 0 ||
      card.balanceMismatch ||
      card.principal == null
    ) {
      const conflict = buildConflict('PAYABLE_BALANCE_INVALID', {
        sourceEntity: 'payable',
        provenance: safeProvenance(card.source),
        suggestedAction: 'Aplique CONFIRM_FORMULA_OVERRIDE o CORRECT_VALUE en Phase 1.5.',
      });
      parent = {
        entityGroup: 'PAYABLES',
        entityType: 'payable',
        sourceCandidateId: card.id,
        sourceFingerprint: fp,
        action: 'CONFLICT',
        conflictCode: conflict.code,
        conflictDetails: conflict as unknown as Record<string, unknown>,
        dependencyKeys: [],
        plannedPayload: null,
        provenance: safeProvenance(card.source),
        sequence: nextSeq(),
      };
    } else if (!card.creditorName?.trim()) {
      const conflict = buildConflict('DESTINATION_REQUIRED_FIELD_MISSING', {
        sourceEntity: 'payable',
        provenance: safeProvenance(card.source),
      });
      parent = {
        entityGroup: 'PAYABLES',
        entityType: 'payable',
        sourceCandidateId: card.id,
        sourceFingerprint: fp,
        action: 'CONFLICT',
        conflictCode: conflict.code,
        conflictDetails: conflict as unknown as Record<string, unknown>,
        dependencyKeys: [],
        plannedPayload: null,
        provenance: safeProvenance(card.source),
        sequence: nextSeq(),
      };
    } else {
      // Free-form counterpartyName supported — no vendor entity required
      parent = {
        entityGroup: 'PAYABLES',
        entityType: 'payable',
        sourceCandidateId: card.id,
        sourceFingerprint: fp,
        action: 'CREATE',
        dependencyKeys: [],
        plannedPayload: {
          type: 'PAYABLE',
          counterpartyName: card.creditorName,
          counterpartyType: 'SUPPLIER',
          concept: card.watchOrConcept ?? 'CXP',
          totalAmount: card.principal,
          currency: card.currency === 'USD' ? 'USD' : 'MXN',
          plannedPaymentsSum: paid,
          plannedOutstanding: remaining,
          migrationSource: 'wrist-caviar',
          migrationDatasetId: params.datasetId,
          migrationCandidateId: card.id,
          migrationFingerprint: fp,
        },
        provenance: safeProvenance(card.source),
        sequence: nextSeq(),
      };
      financial.payablePrincipal += card.principal;
      financial.payablePayments += paid;
      financial.payableEndingOutstanding += remaining ?? card.principal - paid;
    }
    items.push(parent);

    const parentKey = `payable:${card.id}`;
    for (const pay of [...card.payments].sort((a, b) => a.id.localeCompare(b.id))) {
      const payFp = candidateFingerprint('payable_payment', pay.id, {
        amount: pay.amount,
        date: pay.paymentDate,
        parent: card.id,
      });
      const payMapped = mapLookup(destination, 'payable_payment', pay.id);
      if (payMapped && payMapped.sourceFingerprint === payFp) {
        items.push({
          entityGroup: 'PAYABLES',
          entityType: 'payable_payment',
          sourceCandidateId: pay.id,
          sourceFingerprint: payFp,
          action: 'SKIP',
          destinationId: payMapped.destinationId,
          dependencyKeys: [parentKey],
          plannedPayload: null,
          provenance: safeProvenance(pay.source),
          sequence: nextSeq(),
        });
      } else if (parent.action === 'CONFLICT') {
        const conflict = buildConflict('DEPENDENCY_UNRESOLVED', {
          sourceEntity: 'payable_payment',
          provenance: safeProvenance(pay.source),
        });
        items.push({
          entityGroup: 'PAYABLES',
          entityType: 'payable_payment',
          sourceCandidateId: pay.id,
          sourceFingerprint: payFp,
          action: 'CONFLICT',
          conflictCode: conflict.code,
          conflictDetails: conflict as unknown as Record<string, unknown>,
          dependencyKeys: [parentKey],
          plannedPayload: null,
          provenance: safeProvenance(pay.source),
          sequence: nextSeq(),
        });
      } else if (pay.amount == null) {
        const conflict = buildConflict('DESTINATION_REQUIRED_FIELD_MISSING', {
          sourceEntity: 'payable_payment',
          provenance: safeProvenance(pay.source),
        });
        items.push({
          entityGroup: 'PAYABLES',
          entityType: 'payable_payment',
          sourceCandidateId: pay.id,
          sourceFingerprint: payFp,
          action: 'CONFLICT',
          conflictCode: conflict.code,
          conflictDetails: conflict as unknown as Record<string, unknown>,
          dependencyKeys: [parentKey],
          plannedPayload: null,
          provenance: safeProvenance(pay.source),
          sequence: nextSeq(),
        });
      } else {
        items.push({
          entityGroup: 'PAYABLES',
          entityType: 'payable_payment',
          sourceCandidateId: pay.id,
          sourceFingerprint: payFp,
          action: 'CREATE',
          dependencyKeys: [parentKey],
          plannedPayload: {
            amount: pay.amount,
            paidAt: pay.paymentDate,
            notes: pay.label,
            migrationCandidateId: pay.id,
          },
          provenance: safeProvenance(pay.source),
          sequence: nextSeq(),
        });
      }
    }
  }

  // ---- Expenses ----
  const expenses = (snapshot.expenses as ExpenseCandidate[]) ?? [];
  for (const exp of [...expenses].sort((a, b) => a.id.localeCompare(b.id))) {
    const category = mapExpenseCategory(exp.concept);
    const fp = candidateFingerprint('expense', exp.id, {
      date: exp.expenseDate,
      concept: exp.concept,
      amount: exp.amount,
      account: exp.account,
    });
    const mapped = mapLookup(destination, 'expense', exp.id);
    if (mapped && mapped.sourceFingerprint === fp) {
      items.push({
        entityGroup: 'EXPENSES',
        entityType: 'expense',
        sourceCandidateId: exp.id,
        sourceFingerprint: fp,
        action: 'SKIP',
        destinationId: mapped.destinationId,
        dependencyKeys: [],
        plannedPayload: null,
        provenance: safeProvenance(exp.source),
        sequence: nextSeq(),
      });
    } else if (!category) {
      const conflict = buildConflict('CATEGORY_MAPPING_REQUIRED', {
        sourceEntity: 'expense',
        provenance: safeProvenance(exp.source),
        suggestedAction: 'Defina un mapeo de categoría aprobado o excluya el gasto.',
      });
      items.push({
        entityGroup: 'EXPENSES',
        entityType: 'expense',
        sourceCandidateId: exp.id,
        sourceFingerprint: fp,
        action: 'CONFLICT',
        conflictCode: conflict.code,
        conflictDetails: conflict as unknown as Record<string, unknown>,
        dependencyKeys: [],
        plannedPayload: { conceptPresent: Boolean(exp.concept) },
        provenance: safeProvenance(exp.source),
        sequence: nextSeq(),
      });
    } else if (exp.amount == null || !exp.expenseDate) {
      const conflict = buildConflict('DESTINATION_REQUIRED_FIELD_MISSING', {
        sourceEntity: 'expense',
        provenance: safeProvenance(exp.source),
      });
      items.push({
        entityGroup: 'EXPENSES',
        entityType: 'expense',
        sourceCandidateId: exp.id,
        sourceFingerprint: fp,
        action: 'CONFLICT',
        conflictCode: conflict.code,
        conflictDetails: conflict as unknown as Record<string, unknown>,
        dependencyKeys: [],
        plannedPayload: null,
        provenance: safeProvenance(exp.source),
        sequence: nextSeq(),
      });
    } else {
      items.push({
        entityGroup: 'EXPENSES',
        entityType: 'expense',
        sourceCandidateId: exp.id,
        sourceFingerprint: fp,
        action: 'CREATE',
        dependencyKeys: [],
        plannedPayload: {
          category,
          amount: exp.amount,
          expenseDate: exp.expenseDate,
          notes: exp.concept,
          sourceAccount: exp.account,
          migrationCandidateId: exp.id,
        },
        provenance: safeProvenance(exp.source),
        sequence: nextSeq(),
      });
      financial.expenses += exp.amount;
    }
  }

  // ---- Cash ledger (MXN/USD separate; running balance validation only) ----
  if (deferredGroupSet.has('CASH_LEDGER')) {
    items.push({
      entityGroup: 'CASH_LEDGER',
      entityType: 'cash_group',
      sourceCandidateId: 'cash:group',
      sourceFingerprint: candidateFingerprint('cash_group', 'cash:group', {
        count: snapshot.cash.length,
      }),
      action: 'DEFERRED',
      dependencyKeys: [],
      plannedPayload: { count: snapshot.cash.length },
      provenance: { deferredGroup: 'CASH_LEDGER' },
      sequence: nextSeq(),
    });
  } else {
    let mxnBal = destination.balances.cashMxn;
    let usdBal = destination.balances.cashUsd;
    for (const row of [...snapshot.cash]
      .filter((c) => !c.hidden)
      .sort((a, b) => a.id.localeCompare(b.id))) {
      const fp = candidateFingerprint('cash', row.id, {
        currency: row.currency,
        date: row.entryDate,
        entry: row.entryAmount,
        exit: row.exitAmount,
        rate: row.exchangeRate,
      });
      const mapped = mapLookup(destination, 'cash', row.id);
      if (mapped && mapped.sourceFingerprint === fp) {
        items.push({
          entityGroup: 'CASH_LEDGER',
          entityType: 'cash',
          sourceCandidateId: row.id,
          sourceFingerprint: fp,
          action: 'SKIP',
          destinationId: mapped.destinationId,
          dependencyKeys: [],
          plannedPayload: null,
          provenance: safeProvenance(row.source),
          sequence: nextSeq(),
        });
        continue;
      }
      if (row.entryAmount == null && row.exitAmount == null) {
        const conflict = buildConflict('DESTINATION_REQUIRED_FIELD_MISSING', {
          sourceEntity: 'cash',
          provenance: safeProvenance(row.source),
        });
        items.push({
          entityGroup: 'CASH_LEDGER',
          entityType: 'cash',
          sourceCandidateId: row.id,
          sourceFingerprint: fp,
          action: 'CONFLICT',
          conflictCode: conflict.code,
          conflictDetails: conflict as unknown as Record<string, unknown>,
          dependencyKeys: [],
          plannedPayload: null,
          provenance: safeProvenance(row.source),
          sequence: nextSeq(),
        });
        continue;
      }
      const entry = row.entryAmount ?? 0;
      const exit = row.exitAmount ?? 0;
      if (row.currency === 'USD') {
        financial.cashUsdInflows += entry;
        financial.cashUsdOutflows += exit;
        usdBal += entry - exit;
      } else {
        financial.cashMxnInflows += entry;
        financial.cashMxnOutflows += exit;
        mxnBal += entry - exit;
      }
      items.push({
        entityGroup: 'CASH_LEDGER',
        entityType: 'cash',
        sourceCandidateId: row.id,
        sourceFingerprint: fp,
        action: 'CREATE',
        dependencyKeys: [],
        plannedPayload: {
          account: 'CASH',
          currency: row.currency,
          entryAmount: row.entryAmount,
          exitAmount: row.exitAmount,
          exchangeRate: row.exchangeRate,
          transactionDate: row.entryDate,
          // reportedBalance used only for validation notes, not as a money movement
          reportedBalanceForValidation: row.reportedBalance,
          migrationCandidateId: row.id,
        },
        provenance: safeProvenance(row.source),
        sequence: nextSeq(),
      });
    }
    financial.cashMxnEndingBalance = roundMoney(mxnBal);
    financial.cashUsdEndingBalance = roundMoney(usdBal);
  }

  // ---- Bank ----
  const bankRows = (snapshot.bank as BankLedgerCandidate[]) ?? [];
  if (deferredGroupSet.has('BANK_LEDGER')) {
    items.push({
      entityGroup: 'BANK_LEDGER',
      entityType: 'bank_group',
      sourceCandidateId: 'bank:group',
      sourceFingerprint: candidateFingerprint('bank_group', 'bank:group', {
        count: bankRows.length,
      }),
      action: 'DEFERRED',
      dependencyKeys: [],
      plannedPayload: { count: bankRows.length },
      provenance: { deferredGroup: 'BANK_LEDGER' },
      sequence: nextSeq(),
    });
  } else {
    let bankBal = destination.balances.bank;
    for (const row of [...bankRows].sort((a, b) => a.id.localeCompare(b.id))) {
      const fp = candidateFingerprint('bank', row.id, {
        date: row.entryDate,
        deposit: row.deposit,
        withdrawal: row.withdrawal,
        commission: row.commission,
        reference: row.reference,
      });
      const mapped = mapLookup(destination, 'bank', row.id);
      if (mapped && mapped.sourceFingerprint === fp) {
        items.push({
          entityGroup: 'BANK_LEDGER',
          entityType: 'bank',
          sourceCandidateId: row.id,
          sourceFingerprint: fp,
          action: 'SKIP',
          destinationId: mapped.destinationId,
          dependencyKeys: [],
          plannedPayload: null,
          provenance: safeProvenance(row.source),
          sequence: nextSeq(),
        });
        continue;
      }
      const deposit = row.deposit ?? 0;
      const withdrawal = row.withdrawal ?? 0;
      const commission = row.commission ?? 0;
      financial.bankDeposits += deposit;
      financial.bankWithdrawals += withdrawal;
      financial.bankCommissions += commission;
      bankBal += deposit - withdrawal - commission;
      items.push({
        entityGroup: 'BANK_LEDGER',
        entityType: 'bank',
        sourceCandidateId: row.id,
        sourceFingerprint: fp,
        action: 'CREATE',
        dependencyKeys: [],
        plannedPayload: {
          account: 'BANK',
          deposit,
          withdrawal,
          commission,
          reference: row.reference,
          comment: row.comment,
          transactionDate: row.entryDate,
          reportedBalanceForValidation: row.reportedBalance,
          migrationCandidateId: row.id,
        },
        provenance: safeProvenance(row.source),
        sequence: nextSeq(),
      });
    }
    financial.bankEndingBalance = roundMoney(bankBal);
  }

  // ---- Partner ledger (CUENTA CESAR) ----
  const partnerRows = (snapshot.partnerLedger as PartnerLedgerCandidate[]) ?? [];
  if (deferredGroupSet.has('PARTNER_LEDGER')) {
    items.push({
      entityGroup: 'PARTNER_LEDGER',
      entityType: 'partner_group',
      sourceCandidateId: 'partner:group',
      sourceFingerprint: candidateFingerprint('partner_group', 'partner:group', {
        count: partnerRows.length,
      }),
      action: 'DEFERRED',
      dependencyKeys: [],
      plannedPayload: { count: partnerRows.length },
      provenance: { deferredGroup: 'PARTNER_LEDGER' },
      sequence: nextSeq(),
    });
  } else {
    for (const row of [...partnerRows].sort((a, b) => a.id.localeCompare(b.id))) {
      const fp = candidateFingerprint('partner', row.id, {
        date: row.entryDate,
        entry: row.entryAmount,
        exit: row.exitAmount,
        classification: row.classification,
      });
      if (row.classification === 'UNCLASSIFIED') {
        const conflict = buildConflict('CAPITAL_SEMANTICS_UNSUPPORTED', {
          sourceEntity: 'partner',
          provenance: safeProvenance(row.source),
          suggestedAction:
            'Clasifique el movimiento o diferirlo; no inventar contribución/distribución.',
        });
        items.push({
          entityGroup: 'PARTNER_LEDGER',
          entityType: 'partner',
          sourceCandidateId: row.id,
          sourceFingerprint: fp,
          action: 'CONFLICT',
          conflictCode: conflict.code,
          conflictDetails: conflict as unknown as Record<string, unknown>,
          dependencyKeys: [],
          plannedPayload: null,
          provenance: safeProvenance(row.source),
          sequence: nextSeq(),
        });
        continue;
      }
      const impact = (row.entryAmount ?? 0) - (row.exitAmount ?? 0);
      financial.partnerLedgerImpact += impact;
      items.push({
        entityGroup: 'PARTNER_LEDGER',
        entityType: 'partner',
        sourceCandidateId: row.id,
        sourceFingerprint: fp,
        action: 'CREATE',
        dependencyKeys: [],
        plannedPayload: {
          account: 'CESAR',
          classification: row.classification,
          entryAmount: row.entryAmount,
          exitAmount: row.exitAmount,
          transactionDate: row.entryDate,
          migrationCandidateId: row.id,
        },
        provenance: safeProvenance(row.source),
        sequence: nextSeq(),
      });
    }
  }

  // ---- Profit distributions (75/25) ----
  const profitRows = (snapshot.profitDistributions as ProfitDistributionCandidate[]) ?? [];
  if (deferredGroupSet.has('PROFIT_DISTRIBUTIONS')) {
    items.push({
      entityGroup: 'PROFIT_DISTRIBUTIONS',
      entityType: 'profit_group',
      sourceCandidateId: 'profit:group',
      sourceFingerprint: candidateFingerprint('profit_group', 'profit:group', {
        count: profitRows.length,
      }),
      action: 'DEFERRED',
      dependencyKeys: [],
      plannedPayload: { count: profitRows.length },
      provenance: { deferredGroup: 'PROFIT_DISTRIBUTIONS' },
      sequence: nextSeq(),
    });
  } else {
    for (const row of [...profitRows].sort((a, b) => a.id.localeCompare(b.id))) {
      const fp = candidateFingerprint('profit', row.id, {
        partner: row.partner,
        month: row.monthLabel,
        accrued: row.accrued,
        collected: row.collected,
      });
      const expectedShare = row.partner === 'CESAR' ? 0.75 : row.partner === 'EDGAR' ? 0.25 : null;
      if (row.partner === 'UNKNOWN' || expectedShare == null) {
        const conflict = buildConflict('CAPITAL_SEMANTICS_UNSUPPORTED', {
          sourceEntity: 'profit',
          provenance: safeProvenance(row.source),
        });
        items.push({
          entityGroup: 'PROFIT_DISTRIBUTIONS',
          entityType: 'profit',
          sourceCandidateId: row.id,
          sourceFingerprint: fp,
          action: 'CONFLICT',
          conflictCode: conflict.code,
          conflictDetails: conflict as unknown as Record<string, unknown>,
          dependencyKeys: [],
          plannedPayload: null,
          provenance: safeProvenance(row.source),
          sequence: nextSeq(),
        });
        continue;
      }
      if (row.shareMismatch) {
        const conflict = buildConflict('CAPITAL_SEMANTICS_UNSUPPORTED', {
          sourceEntity: 'profit',
          provenance: { ...safeProvenance(row.source), reason: 'share_mismatch' },
          suggestedAction: 'Confirme el split 75/25 en Phase 1.5 antes de planificar.',
        });
        items.push({
          entityGroup: 'PROFIT_DISTRIBUTIONS',
          entityType: 'profit',
          sourceCandidateId: row.id,
          sourceFingerprint: fp,
          action: 'CONFLICT',
          conflictCode: conflict.code,
          conflictDetails: conflict as unknown as Record<string, unknown>,
          dependencyKeys: [],
          plannedPayload: null,
          provenance: safeProvenance(row.source),
          sequence: nextSeq(),
        });
        continue;
      }
      const investor = destination.investors.find(
        (i) =>
          i.name.toLowerCase().includes(row.partner.toLowerCase()) ||
          nearlyEqual(i.ownershipPercent, expectedShare * 100, 0.5),
      );
      if (!investor && row.collected != null && row.collected > 0) {
        // Can still plan CREATE against InvestorDistribution if investors exist later;
        // missing investor → conflict rather than inventing ownership.
        const conflict = buildConflict('DESTINATION_MODEL_UNSUPPORTED', {
          sourceEntity: 'profit',
          provenance: safeProvenance(row.source),
          suggestedAction: 'Asegure inversores César/Edgar con ownership 75/25 en Capital.',
        });
        items.push({
          entityGroup: 'PROFIT_DISTRIBUTIONS',
          entityType: 'profit',
          sourceCandidateId: row.id,
          sourceFingerprint: fp,
          action: 'CONFLICT',
          conflictCode: conflict.code,
          conflictDetails: conflict as unknown as Record<string, unknown>,
          dependencyKeys: [],
          plannedPayload: {
            expectedShare,
            partner: row.partner,
          },
          provenance: safeProvenance(row.source),
          sequence: nextSeq(),
        });
        continue;
      }
      items.push({
        entityGroup: 'PROFIT_DISTRIBUTIONS',
        entityType: 'profit',
        sourceCandidateId: row.id,
        sourceFingerprint: fp,
        action: 'CREATE',
        destinationId: investor?.id,
        dependencyKeys: [],
        plannedPayload: {
          partner: row.partner,
          expectedShare,
          monthLabel: row.monthLabel,
          accrued: row.accrued,
          collected: row.collected,
          outstanding: row.outstanding,
          investorId: investor?.id ?? null,
          migrationCandidateId: row.id,
        },
        provenance: safeProvenance(row.source),
        sequence: nextSeq(),
      });
      financial.profitDistributionsImpact += row.collected ?? 0;
    }
  }

  // ---- Deferred groups (CRIPTO / OSCAR etc.) ----
  for (const d of [...snapshot.deferred].sort((a, b) =>
    String(a.id).localeCompare(String(b.id)),
  )) {
    const id = String(d.id);
    const fp = candidateFingerprint('deferred', id, {
      label: d.label ?? d.destination ?? null,
    });
    items.push({
      entityGroup: 'DEFERRED',
      entityType: 'deferred',
      sourceCandidateId: id,
      sourceFingerprint: fp,
      action: 'DEFERRED',
      dependencyKeys: [],
      plannedPayload: {
        countHint: 1,
        destination: d.destination ?? 'DEFERRED',
      },
      provenance: {
        sourceSheet:
          typeof d.source === 'object' && d.source
            ? (d.source as { sourceSheet?: string }).sourceSheet
            : null,
      },
      sequence: nextSeq(),
    });
  }

  // Ensure deferred groups appear even if snapshot.deferred empty but approval deferred sheets
  for (const g of ['CRIPTO_CESAR', 'OSCAR_PAPA_CAMI']) {
    if (!deferredGroupSet.has('DEFERRED') && !deferredGroupSet.has(g)) continue;
    const already = items.some(
      (i) => i.entityGroup === 'DEFERRED' && i.sourceCandidateId.includes(g.toLowerCase()),
    );
    if (already) continue;
    // Group-level deferred summary if approvals deferred DEFERRED entity group
  }
  if (deferredGroupSet.has('DEFERRED') || deferredGroupSet.has('CRYPTO_LEDGER')) {
    const hasDeferredItems = items.some((i) => i.entityGroup === 'DEFERRED');
    if (!hasDeferredItems) {
      items.push({
        entityGroup: 'DEFERRED',
        entityType: 'deferred_group',
        sourceCandidateId: 'deferred:group',
        sourceFingerprint: candidateFingerprint('deferred_group', 'deferred:group', {
          count: sourceCounts.deferred,
        }),
        action: 'DEFERRED',
        dependencyKeys: [],
        plannedPayload: { count: sourceCounts.deferred },
        provenance: { deferredGroup: 'DEFERRED' },
        sequence: nextSeq(),
      });
    }
  }

  const actionCounts: Record<string, number> = {
    CREATE: 0,
    LINK: 0,
    SKIP: 0,
    CONFLICT: 0,
    DEFERRED: 0,
  };
  const conflictCounts: Record<string, number> = {};
  let blockingConflictCount = 0;
  for (const i of items) {
    actionCounts[i.action] = (actionCounts[i.action] ?? 0) + 1;
    if (i.action === 'CONFLICT' && i.conflictCode) {
      conflictCounts[i.conflictCode] = (conflictCounts[i.conflictCode] ?? 0) + 1;
      const blocking = (i.conflictDetails as { blocking?: boolean } | null)?.blocking !== false;
      if (blocking) blockingConflictCount += 1;
    }
  }

  financial.projected = {
    clients: financial.current.clients + financial.customersCreated,
    watches: financial.current.watches + financial.inventoryCreated,
    deals: financial.current.deals + financial.historicalDealsCreated,
    receivables:
      financial.current.receivables +
      items.filter((i) => i.entityType === 'receivable' && i.action === 'CREATE').length,
    payables:
      financial.current.payables +
      items.filter((i) => i.entityType === 'payable' && i.action === 'CREATE').length,
    expenses:
      financial.current.expenses +
      items.filter((i) => i.entityType === 'expense' && i.action === 'CREATE').length,
    cashMxn: financial.cashMxnEndingBalance,
    cashUsd: financial.cashUsdEndingBalance,
    bank: financial.bankEndingBalance,
    receivableOutstanding:
      financial.current.receivableOutstanding + financial.receivableEndingOutstanding,
    payableOutstanding:
      financial.current.payableOutstanding + financial.payableEndingOutstanding,
  };

  const reconRows = buildPlanReconciliation(snapshot.reconciliation ?? [], financial, destination);
  const reconciliationSummary = {
    rows: reconRows,
    matched: reconRows.filter((r) => r.status === 'MATCHED' || r.status === 'WITHIN_TOLERANCE')
      .length,
    mismatch: reconRows.filter((r) => r.status === 'MISMATCH').length,
    deferred: reconRows.filter((r) => r.status === 'DEFERRED').length,
    notRepresentable: reconRows.filter((r) => r.status === 'NOT_REPRESENTABLE').length,
  };

  const unresolvedDependencies = items.filter(
    (i) => i.conflictCode === 'DEPENDENCY_UNRESOLVED',
  ).length;

  const planFingerprint = computePlanFingerprint({
    tenantId: params.tenantId,
    datasetFingerprint: params.datasetFingerprint,
    plannerVersion: PLANNER_VERSION,
    destinationStateFingerprint: destination.overallFingerprint,
    items,
  });

  return {
    items,
    sourceCounts,
    actionCounts,
    conflictCounts,
    financialSummary: financial,
    reconciliationSummary,
    dependencySummary: {
      order: [...DEPENDENCY_ORDER],
      unresolvedDependencies,
    },
    planFingerprint,
    planReadiness:
      blockingConflictCount > 0 ? 'NEEDS_CONFLICT_RESOLUTION' : 'READY_FOR_APPROVAL',
    blockingConflictCount,
  };
}

function buildPlanReconciliation(
  reviewed: ReconciliationItem[],
  financial: FinancialSummary,
  destination: DestinationState,
): PlanReconciliationRow[] {
  const plannedByConcept: Record<string, number | null> = {
    BANCOS: financial.bankEndingBalance,
    'EFECTIVO PESOS': financial.cashMxnEndingBalance,
    EFECTIVO_MXN: financial.cashMxnEndingBalance,
    'EFECTIVO DOLARES': financial.cashUsdEndingBalance,
    EFECTIVO_USD: financial.cashUsdEndingBalance,
    CXC: financial.current.receivableOutstanding + financial.receivableEndingOutstanding,
    CXC_MXN: financial.current.receivableOutstanding + financial.receivableEndingOutstanding,
    CXP: financial.current.payableOutstanding + financial.payableEndingOutstanding,
    CXP_MXN: financial.current.payableOutstanding + financial.payableEndingOutstanding,
    UTILIDADES: financial.historicalApprovedProfit,
    'CUENTA CESAR': financial.partnerLedgerImpact,
    CRIPTO: null,
    'DINERO OSCAR': null,
  };

  const currentByConcept: Record<string, number | null> = {
    BANCOS: destination.balances.bank,
    'EFECTIVO PESOS': destination.balances.cashMxn,
    EFECTIVO_MXN: destination.balances.cashMxn,
    'EFECTIVO DOLARES': destination.balances.cashUsd,
    EFECTIVO_USD: destination.balances.cashUsd,
    CXC: destination.balances.receivableOutstanding,
    CXC_MXN: destination.balances.receivableOutstanding,
    CXP: destination.balances.payableOutstanding,
    CXP_MXN: destination.balances.payableOutstanding,
    UTILIDADES: destination.balances.dealRevenue,
    'CUENTA CESAR': 0,
    CRIPTO: null,
    'DINERO OSCAR': null,
  };

  return reviewed.map((r) => {
    const key = r.concept;
    const planned = plannedByConcept[key] ?? plannedByConcept[key.toUpperCase()] ?? null;
    const current = currentByConcept[key] ?? currentByConcept[key.toUpperCase()] ?? null;
    if (key.toUpperCase().includes('CRIPTO') || key.toUpperCase().includes('OSCAR')) {
      return {
        concept: r.concept,
        currency: r.currency,
        approvedReporteValue: r.declaredValue,
        reviewedDatasetValue: r.calculatedValue,
        dryRunPlannedValue: null,
        currentWristOsValue: current,
        projectedWristOsValue: current,
        difference: null,
        status: 'DEFERRED' as const,
        notes: 'Grupo diferido; fuera del alcance operativo de esta simulación.',
      };
    }
    if (planned == null && (r.status === 'SCOPE_REVIEW_REQUIRED' || r.declaredValue == null)) {
      return {
        concept: r.concept,
        currency: r.currency,
        approvedReporteValue: r.declaredValue,
        reviewedDatasetValue: r.calculatedValue,
        dryRunPlannedValue: planned,
        currentWristOsValue: current,
        projectedWristOsValue: planned ?? current,
        difference: null,
        status: (r.status === 'SCOPE_REVIEW_REQUIRED'
          ? 'SCOPE_REVIEW_REQUIRED'
          : 'NOT_REPRESENTABLE') as PlanReconciliationRow['status'],
        notes: r.notes,
      };
    }
    const projected = planned;
    const approved = r.declaredValue;
    let status: PlanReconciliationRow['status'] = 'MISMATCH';
    let difference: number | null = null;
    if (approved != null && projected != null) {
      difference = roundMoney(projected - approved);
      if (nearlyEqual(projected, approved, r.tolerance || 0.05)) status = 'MATCHED';
      else if (Math.abs(difference) <= Math.max(r.tolerance || 0.05, 1))
        status = 'WITHIN_TOLERANCE';
      else status = 'MISMATCH';
    } else if (approved == null) {
      status = 'NOT_REPRESENTABLE';
    }
    return {
      concept: r.concept,
      currency: r.currency,
      approvedReporteValue: approved,
      reviewedDatasetValue: r.calculatedValue,
      dryRunPlannedValue: planned,
      currentWristOsValue: current,
      projectedWristOsValue: projected,
      difference,
      status,
      notes: r.notes,
    };
  });
}

/** Pure helper exported for unit tests — fuzzy customer names must not LINK. */
export function wouldFuzzyLinkCustomer(aNorm: string, bNorm: string): boolean {
  if (aNorm === bNorm) return false; // exact is not fuzzy
  // Accent / abbreviation / typo are fuzzy — planner must not LINK on these alone
  return aNorm !== bNorm;
}

export function planFingerprintPrefix(fp: string): string {
  return fingerprintPrefix(fp);
}

export function auditSafeHash(parts: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(parts)).digest('hex').slice(0, 16);
}

export type { DryRunConflictCode };
