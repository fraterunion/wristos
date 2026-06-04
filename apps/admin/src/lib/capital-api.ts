import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CapitalAccount = 'CASH' | 'BANK' | 'CESAR_ACCOUNT';

export type CapitalInvestorBalance = {
  id: string;
  name: string;
  ownershipPercent: string;
  isActive: boolean;
  capitalContributed: string;
  profitEntitlement: string;
  distributionsPaid: string;
  pendingProfit: string;
};

export type CapitalInvestorFull = CapitalInvestorBalance & {
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CapitalSummary = {
  totalCapitalContributed: string;
  totalBusinessProfit: string;
  totalDistributionsPaid: string;
  totalPendingToPartners: string;
  capitalNeto: string;
  investors: CapitalInvestorBalance[];
};

export type CapitalContribution = {
  id: string;
  tenantId: string;
  investorId: string;
  investorName: string;
  amount: string;
  account: CapitalAccount;
  notes: string | null;
  contributedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CapitalDistribution = {
  id: string;
  tenantId: string;
  investorId: string;
  investorName: string;
  amount: string;
  account: CapitalAccount;
  notes: string | null;
  paidAt: string;
  createdAt: string;
  updatedAt: string;
};

// ─── API functions ────────────────────────────────────────────────────────────

const AUTH = { authenticated: true } as const;

export function getCapitalSummary() {
  return apiGet<CapitalSummary>('/capital/summary', AUTH);
}

export function listCapitalInvestors() {
  return apiGet<CapitalInvestorFull[]>('/capital/investors', AUTH);
}

export function createCapitalInvestor(body: {
  name: string;
  ownershipPercent: number;
  notes?: string;
}) {
  return apiPost<CapitalInvestorFull>('/capital/investors', body, AUTH);
}

export function updateCapitalInvestor(
  id: string,
  body: { name?: string; ownershipPercent?: number; isActive?: boolean; notes?: string },
) {
  return apiPatch<CapitalInvestorFull>(`/capital/investors/${id}`, body, AUTH);
}

export function listCapitalContributions(query?: {
  investorId?: string;
  startDate?: string;
  endDate?: string;
}) {
  return apiGet<CapitalContribution[]>('/capital/contributions', { ...AUTH, query });
}

export function createCapitalContribution(body: {
  investorId: string;
  amount: number;
  account: CapitalAccount;
  contributedAt: string;
  notes?: string;
}) {
  return apiPost<CapitalContribution>('/capital/contributions', body, AUTH);
}

export function updateCapitalContribution(
  id: string,
  body: { amount?: number; account?: CapitalAccount; contributedAt?: string; notes?: string },
) {
  return apiPatch<CapitalContribution>(`/capital/contributions/${id}`, body, AUTH);
}

export function deleteCapitalContribution(id: string) {
  return apiDelete<void>(`/capital/contributions/${id}`, AUTH);
}

export function listCapitalDistributions(query?: {
  investorId?: string;
  startDate?: string;
  endDate?: string;
}) {
  return apiGet<CapitalDistribution[]>('/capital/distributions', { ...AUTH, query });
}

export function createCapitalDistribution(body: {
  investorId: string;
  amount: number;
  account: CapitalAccount;
  paidAt: string;
  notes?: string;
}) {
  return apiPost<CapitalDistribution>('/capital/distributions', body, AUTH);
}

export function updateCapitalDistribution(
  id: string,
  body: { amount?: number; account?: CapitalAccount; paidAt?: string; notes?: string },
) {
  return apiPatch<CapitalDistribution>(`/capital/distributions/${id}`, body, AUTH);
}

export function deleteCapitalDistribution(id: string) {
  return apiDelete<void>(`/capital/distributions/${id}`, AUTH);
}
