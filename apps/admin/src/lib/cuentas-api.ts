import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import type { Client, PaymentMethod } from '@/types/domain';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AccountEntryType = 'RECEIVABLE' | 'PAYABLE';
export type AccountEntryStatus = 'OPEN' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'CANCELLED';
export type AccountEntryCategory =
  | 'SALE_BALANCE'
  | 'PURCHASE'
  | 'SERVICE'
  | 'COMMISSION'
  | 'REFUND'
  | 'LOAN'
  | 'OTHER';
export type CounterpartyType =
  | 'CLIENT'
  | 'SUPPLIER'
  | 'DEALER'
  | 'BROKER'
  | 'WORKSHOP'
  | 'LOGISTICS'
  | 'OTHER';
export type Currency = 'MXN' | 'USD';
export type AccountEntrySource = 'MANUAL' | 'DEAL_AUTO';
export type TreasuryAccount = 'CASH' | 'BANK' | 'CESAR';
export type AccountPaymentDestination = TreasuryAccount | 'APPLY_TO_PAYABLE';

export type AccountPaymentSettlement = {
  id: string;
  amount: string;
  currency: Currency;
  effectiveDate: string;
  role: 'RECEIVABLE_SIDE' | 'PAYABLE_SIDE';
  counterpartEntryId: string;
  counterpartName: string;
  counterpartConcept: string;
};

export type AccountPayment = {
  id: string;
  tenantId: string;
  entryId: string;
  amount: string;
  currency: Currency;
  method: string;
  paidAt: string;
  notes: string | null;
  cashAccount?: TreasuryAccount | null;
  exchangeRateUsed?: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  settlementId?: string | null;
  settlement?: AccountPaymentSettlement | null;
};

export type AccountEntry = {
  id: string;
  tenantId: string;
  type: AccountEntryType;
  status: AccountEntryStatus;
  category: AccountEntryCategory;
  source: AccountEntrySource;
  counterpartyName: string;
  counterpartyType: CounterpartyType;
  concept: string;
  totalAmount: string;
  currency: Currency;
  exchangeRate: string | null;
  reference: string | null;
  issuedAt: string | null;
  dueDate: string | null;
  closedAt: string | null;
  notes: string | null;
  clientId: string | null;
  dealId: string | null;
  watchId: string | null;
  expenseId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  paidTotal: string;
  balance: string;
  payments: AccountPayment[];
};

export type AccountSettlementResult = {
  settlementId: string;
  receivablePayment: AccountPayment;
  payablePayment: AccountPayment;
  receivable: AccountEntry;
  payable: AccountEntry;
};

export type CurrencyTotals = {
  MXN: string;
  USD: string;
};

export type CuentasSummary = {
  totalReceivable: string;
  totalPayable: string;
  overdueReceivableCount: number;
  overduePayableCount: number;
  overdueReceivableAmount: string;
  overduePayableAmount: string;
  totalReceivableByCurrency: CurrencyTotals;
  totalPayableByCurrency: CurrencyTotals;
  overdueReceivableByCurrency: CurrencyTotals;
  overduePayableByCurrency: CurrencyTotals;
  exchangeRateUsed: string | null;
  receivableStatusCounts?: Record<AccountEntryStatus, number>;
  payableStatusCounts?: Record<AccountEntryStatus, number>;
  expectedNetFlow?: string;
};

export type TopDebtor = {
  clientId: string | null;
  counterpartyName: string;
  currency: Currency;
  outstanding: string;
  openAccounts: number;
};

export type CustomerLedger = {
  customer: { id: string; name: string; email: string | null; phone: string | null };
  receivables: AccountEntry[];
  payables: AccountEntry[];
  receivableOutstandingByCurrency: CurrencyTotals;
  payableOutstandingByCurrency: CurrencyTotals;
};

// ─── API functions ────────────────────────────────────────────────────────────

const AUTH = { authenticated: true } as const;

export function getCuentasSummary() {
  return apiGet<CuentasSummary>('/cuentas/summary', AUTH);
}

export function getTopDebtors(limit = 10) {
  return apiGet<TopDebtor[]>('/cuentas/top-debtors', {
    ...AUTH,
    query: { limit },
  });
}

export function getCustomerLedger(clientId: string) {
  return apiGet<CustomerLedger>(`/cuentas/clients/${clientId}/ledger`, AUTH);
}

export function listClients() {
  return apiGet<Client[]>('/crm/clients', AUTH);
}

export function listAccountEntries(query?: {
  type?: AccountEntryType;
  status?: AccountEntryStatus;
  source?: AccountEntrySource;
  clientId?: string;
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}) {
  return apiGet<AccountEntry[]>('/cuentas/entries', { ...AUTH, query });
}

export function getAccountEntry(id: string) {
  return apiGet<AccountEntry>(`/cuentas/entries/${id}`, AUTH);
}

export function createAccountEntry(payload: {
  type: AccountEntryType;
  category?: AccountEntryCategory;
  counterpartyType?: CounterpartyType;
  counterpartyName: string;
  concept: string;
  totalAmount: number;
  currency?: Currency;
  exchangeRate?: number;
  reference?: string;
  issuedAt?: string;
  dueDate?: string;
  notes?: string;
  clientId?: string;
}) {
  return apiPost<AccountEntry>('/cuentas/entries', payload, AUTH);
}

export function updateAccountEntry(
  id: string,
  payload: {
    type?: AccountEntryType;
    status?: AccountEntryStatus;
    category?: AccountEntryCategory;
    counterpartyType?: CounterpartyType;
    counterpartyName?: string;
    concept?: string;
    totalAmount?: number;
    currency?: Currency;
    exchangeRate?: number;
    reference?: string;
    issuedAt?: string;
    dueDate?: string;
    notes?: string;
    clientId?: string | null;
  },
) {
  return apiPatch<AccountEntry>(`/cuentas/entries/${id}`, payload, AUTH);
}

export function deleteAccountEntry(id: string) {
  return apiDelete<void>(`/cuentas/entries/${id}`, AUTH);
}

export function createAccountPayment(
  entryId: string,
  payload: {
    amount: number;
    method?: PaymentMethod;
    paidAt: string;
    notes?: string;
    cashAccount?: TreasuryAccount;
    destination?: AccountPaymentDestination;
    payableEntryId?: string;
    idempotencyKey?: string;
    exchangeRateUsed?: number;
  },
) {
  return apiPost<AccountEntry | AccountSettlementResult>(
    `/cuentas/entries/${entryId}/payments`,
    payload,
    AUTH,
  );
}

export function reverseAccountSettlement(settlementId: string) {
  return apiDelete<{
    settlementId: string;
    reversed: boolean;
    receivable: AccountEntry;
    payable: AccountEntry;
  }>(`/cuentas/settlements/${settlementId}`, AUTH);
}

export function updateAccountPayment(
  entryId: string,
  paymentId: string,
  payload: {
    amount?: number;
    method?: PaymentMethod;
    paidAt?: string;
    notes?: string;
    cashAccount?: TreasuryAccount;
    exchangeRateUsed?: number;
  },
) {
  return apiPatch<AccountPayment>(
    `/cuentas/entries/${entryId}/payments/${paymentId}`,
    payload,
    AUTH,
  );
}

export function deleteAccountPayment(entryId: string, paymentId: string) {
  return apiDelete<void>(`/cuentas/entries/${entryId}/payments/${paymentId}`, AUTH);
}
