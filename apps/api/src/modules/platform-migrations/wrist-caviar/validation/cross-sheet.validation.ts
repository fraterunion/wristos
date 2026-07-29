import { classifyNameSimilarity, normalizeCustomerName } from '../normalization/customer-normalize';
import type {
  CustomerCandidate,
  InventoryCandidate,
  MigrationError,
  MigrationManualReviewItem,
  MigrationWarning,
  ReceivableCandidate,
  SaleCandidate,
  WorkbookAnalysis,
} from '../types/migration.types';
import { newCandidateId } from '../workbook/cell.util';

export function buildCustomerCandidates(input: {
  sales: SaleCandidate[];
  receivables: ReceivableCandidate[];
  fingerprint: string;
  parserVersion: string;
}): {
  customers: CustomerCandidate[];
  warnings: MigrationWarning[];
  manualReview: MigrationManualReviewItem[];
} {
  const byNorm = new Map<string, CustomerCandidate>();
  const warnings: MigrationWarning[] = [];
  const manualReview: MigrationManualReviewItem[] = [];

  const ingest = (name: string, source: SaleCandidate['source'] | ReceivableCandidate['source']) => {
    const displayName = name.trim();
    if (!displayName) return;
    const normalizedName = normalizeCustomerName(displayName);
    const existing = byNorm.get(normalizedName);
    if (existing) {
      existing.sources.push(source);
      if (!existing.displayName && displayName) existing.displayName = displayName;
      return;
    }
    byNorm.set(normalizedName, {
      id: newCandidateId('cust'),
      displayName,
      normalizedName,
      sources: [source],
      groupKey: normalizedName,
      duplicateSuggestions: [],
    });
  };

  for (const s of input.sales) ingest(s.customerName, s.source);
  for (const r of input.receivables) ingest(r.customerName, r.source);

  const customers = [...byNorm.values()];

  for (let i = 0; i < customers.length; i++) {
    for (let j = i + 1; j < customers.length; j++) {
      const conf = classifyNameSimilarity(customers[i].normalizedName, customers[j].normalizedName);
      if (!conf || conf === 'EXACT_NORMALIZED_MATCH') continue;
      customers[i].duplicateSuggestions.push({ otherId: customers[j].id, confidence: conf });
      customers[j].duplicateSuggestions.push({ otherId: customers[i].id, confidence: conf });
      manualReview.push({
        code: 'AMBIGUOUS_CUSTOMER_DUPLICATE',
        message: `Posible duplicado de cliente (${conf})`,
        severity: 'MANUAL_REVIEW',
        category: 'customer_duplicate',
      });
    }
  }

  for (const c of customers) {
    if (c.sources.length > 1) {
      warnings.push({
        code: 'CUSTOMER_EXACT_DUPLICATE_GROUP',
        message: 'Cliente agrupado por nombre normalizado exacto',
        severity: 'INFORMATIONAL',
        category: 'customer',
      });
    }
  }

  return { customers, warnings, manualReview };
}

export function runCrossSheetValidations(input: {
  sales: SaleCandidate[];
  inventory: InventoryCandidate[];
  receivables: ReceivableCandidate[];
  customers: CustomerCandidate[];
}): {
  warnings: MigrationWarning[];
  errors: MigrationError[];
  manualReview: MigrationManualReviewItem[];
} {
  const warnings: MigrationWarning[] = [];
  const errors: MigrationError[] = [];
  const manualReview: MigrationManualReviewItem[] = [];

  const soldSerials = new Map<string, SaleCandidate[]>();
  for (const s of input.sales) {
    if (!s.serial) continue;
    const key = s.serial.trim().toUpperCase();
    if (!key) continue;
    const list = soldSerials.get(key) ?? [];
    list.push(s);
    soldSerials.set(key, list);
  }

  for (const inv of input.inventory) {
    if (!inv.serial) continue;
    const key = inv.serial.trim().toUpperCase();
    if (soldSerials.has(key)) {
      warnings.push({
        code: 'SOLD_SERIAL_IN_INVENTORY',
        message: 'Serie vendida aparece en inventario actual',
        severity: 'WARNING',
        category: 'cross_sheet',
        source: inv.source,
      });
    }
  }

  const customerNorms = new Set(input.customers.map((c) => c.normalizedName));
  for (const r of input.receivables) {
    const norm = normalizeCustomerName(r.customerName);
    if (!customerNorms.has(norm)) {
      // Still created from CXC itself — check if only from CXC without ventas
      const fromSales = input.sales.some(
        (s) => normalizeCustomerName(s.customerName) === norm,
      );
      if (!fromSales) {
        warnings.push({
          code: 'RECEIVABLE_CUSTOMER_ONLY_CXC',
          message: 'Cliente de CXC sin ventas asociadas',
          severity: 'INFORMATIONAL',
          category: 'cross_sheet',
          source: r.source,
        });
      }
    }
  }

  return { warnings, errors, manualReview };
}

export function computeReadiness(input: {
  blockedIdentity: boolean;
  missingCoreSheets: string[];
  parserCrashed: boolean;
  errors: MigrationError[];
  warnings: MigrationWarning[];
  manualReview: MigrationManualReviewItem[];
  coreParsed: boolean;
  reconciliationDone: boolean;
}): WorkbookAnalysis['readiness'] {
  if (
    input.blockedIdentity ||
    input.missingCoreSheets.length > 0 ||
    input.parserCrashed ||
    !input.coreParsed
  ) {
    return 'BLOCKED';
  }

  const blockingCodes = new Set([
    'DUPLICATE_INVENTORY_SERIAL',
    'INVALID_AMOUNT',
    'INVALID_DATE',
    'FORMULA_ERROR',
    'PARSER_CRASH',
    'STRUCTURAL_AMBIGUITY',
  ]);
  const criticalBlocking = input.errors.filter((e) => blockingCodes.has(e.code));
  // Formula errors in CXP are expected in real workbook — treat volume threshold
  const formulaErrors = input.errors.filter((e) => e.code === 'FORMULA_ERROR');
  const otherCritical = criticalBlocking.filter((e) => e.code !== 'FORMULA_ERROR');
  if (otherCritical.length > 0) return 'BLOCKED';
  if (formulaErrors.length > 25) return 'BLOCKED';

  if (
    input.warnings.length > 0 ||
    input.manualReview.length > 0 ||
    formulaErrors.length > 0 ||
    !input.reconciliationDone
  ) {
    return 'NEEDS_REVIEW';
  }

  return 'READY_FOR_DRY_RUN';
}
