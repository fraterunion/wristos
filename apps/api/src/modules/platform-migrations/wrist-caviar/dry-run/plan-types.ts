import type { WristCaviarDryRunAction } from '@prisma/client';

import type { DryRunConflictCode } from './planner.constants';

export type PlannedItem = {
  entityGroup: string;
  entityType: string;
  sourceCandidateId: string;
  sourceFingerprint: string;
  action: WristCaviarDryRunAction;
  confidence?: string | null;
  destinationId?: string | null;
  dependencyKeys?: string[];
  plannedPayload?: Record<string, unknown> | null;
  comparisonSnapshot?: Record<string, unknown> | null;
  conflictCode?: DryRunConflictCode | null;
  conflictDetails?: Record<string, unknown> | null;
  provenance: Record<string, unknown>;
  sequence: number;
};

export type DestinationClient = {
  id: string;
  name: string;
  normalizedName: string;
  deletedAt: Date | null;
};

export type DestinationWatch = {
  id: string;
  brand: string | null;
  model: string | null;
  reference: string | null;
  serialNumber: string | null;
  status: string;
  deletedAt: Date | null;
};

export type DestinationDeal = {
  id: string;
  clientId: string;
  importFingerprint: string | null;
  soldAt: Date | null;
  agreedPrice: number;
  historicalCost: number | null;
  extrasAmount: number | null;
  reportedProfit: number | null;
  deletedAt: Date | null;
};

export type DestinationAccountEntry = {
  id: string;
  type: 'RECEIVABLE' | 'PAYABLE';
  counterpartyName: string;
  concept: string;
  totalAmount: number;
  currency: string;
  notes: string | null;
  deletedAt: Date | null;
  paymentFingerprints: string[];
  paymentsSum: number;
};

export type DestinationExpense = {
  id: string;
  category: string;
  amount: number;
  expenseDate: string;
  notes: string | null;
};

export type DestinationTreasury = {
  id: string;
  account: string;
  direction: string;
  amount: number;
  currency: string;
  transactionDate: string;
  description: string | null;
};

export type DestinationInvestor = {
  id: string;
  name: string;
  ownershipPercent: number;
};

export type DestinationDistribution = {
  id: string;
  investorId: string;
  amount: number;
  paidAt: string;
  notes: string | null;
};

export type DestinationMapRow = {
  sourceCandidateId: string;
  entityType: string;
  destinationId: string;
  sourceFingerprint: string;
};

export type DestinationState = {
  clients: DestinationClient[];
  watches: DestinationWatch[];
  deals: DestinationDeal[];
  accountEntries: DestinationAccountEntry[];
  expenses: DestinationExpense[];
  treasury: DestinationTreasury[];
  investors: DestinationInvestor[];
  distributions: DestinationDistribution[];
  maps: DestinationMapRow[];
  counts: Record<string, number>;
  balances: Record<string, number>;
  fingerprintsByGroup: Record<string, string>;
  overallFingerprint: string;
};

export type ExplicitLink = {
  candidateId: string;
  entityType: string;
  destinationId: string;
};

export type FinancialSummary = {
  customersCreated: number;
  customersLinked: number;
  inventoryCreated: number;
  inventoryLinked: number;
  historicalDealsCreated: number;
  historicalRevenue: number;
  historicalCost: number;
  historicalExtras: number;
  historicalApprovedProfit: number;
  receivablePrincipal: number;
  receivablePayments: number;
  receivableEndingOutstanding: number;
  payablePrincipal: number;
  payablePayments: number;
  payableEndingOutstanding: number;
  expenses: number;
  cashMxnInflows: number;
  cashMxnOutflows: number;
  cashMxnEndingBalance: number;
  cashUsdInflows: number;
  cashUsdOutflows: number;
  cashUsdEndingBalance: number;
  bankDeposits: number;
  bankWithdrawals: number;
  bankCommissions: number;
  bankEndingBalance: number;
  partnerLedgerImpact: number;
  profitDistributionsImpact: number;
  current: Record<string, number>;
  projected: Record<string, number>;
  label: string;
};

export type PlanReconciliationRow = {
  concept: string;
  currency: string;
  approvedReporteValue: number | null;
  reviewedDatasetValue: number | null;
  dryRunPlannedValue: number | null;
  currentWristOsValue: number | null;
  projectedWristOsValue: number | null;
  difference: number | null;
  status:
    | 'MATCHED'
    | 'WITHIN_TOLERANCE'
    | 'MISMATCH'
    | 'DEFERRED'
    | 'NOT_REPRESENTABLE'
    | 'SCOPE_REVIEW_REQUIRED';
  notes: string | null;
};

export type PlannerResult = {
  items: PlannedItem[];
  sourceCounts: Record<string, number>;
  actionCounts: Record<string, number>;
  conflictCounts: Record<string, number>;
  financialSummary: FinancialSummary;
  reconciliationSummary: {
    rows: PlanReconciliationRow[];
    matched: number;
    mismatch: number;
    deferred: number;
    notRepresentable: number;
  };
  dependencySummary: {
    order: string[];
    unresolvedDependencies: number;
  };
  planFingerprint: string;
  planReadiness: 'READY_FOR_APPROVAL' | 'NEEDS_CONFLICT_RESOLUTION' | 'FAILED';
  blockingConflictCount: number;
};
