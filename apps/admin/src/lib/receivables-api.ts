import { apiDelete, apiGet, apiPost } from '@/lib/api-client';

// ─── Enums / unions ───────────────────────────────────────────────────────────

export type ReceivableStatus =
  | 'PENDING'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'OVERDUE'
  | 'WRITTEN_OFF';

export type ReceivablePaymentMethod =
  | 'WIRE'
  | 'BANK_TRANSFER'
  | 'CASH'
  | 'CHECK'
  | 'CRYPTO'
  | 'CARD'
  | 'OTHER';

export type AgingBucket = 'CURRENT' | 'D1_30' | 'D31_60' | 'D61_90' | 'D90_PLUS';

export type ReceivableCurrency = 'MXN' | 'USD';

export type ReceivableSort =
  | 'issueDate_asc'
  | 'issueDate_desc'
  | 'dueDate_asc'
  | 'dueDate_desc'
  | 'amount_asc'
  | 'amount_desc'
  | 'remaining_asc'
  | 'remaining_desc';

// ─── Labels ───────────────────────────────────────────────────────────────────

export const RECEIVABLE_STATUS_LABELS: Record<ReceivableStatus, string> = {
  PENDING: 'Pendiente',
  PARTIALLY_PAID: 'Parcial',
  PAID: 'Pagada',
  OVERDUE: 'Vencida',
  WRITTEN_OFF: 'Castigada',
};

export const RECEIVABLE_PAYMENT_METHOD_LABELS: Record<ReceivablePaymentMethod, string> = {
  WIRE: 'Transferencia int.',
  BANK_TRANSFER: 'Transferencia',
  CASH: 'Efectivo',
  CHECK: 'Cheque',
  CRYPTO: 'Cripto',
  CARD: 'Tarjeta',
  OTHER: 'Otro',
};

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  CURRENT: 'Al corriente',
  D1_30: '1–30 días',
  D31_60: '31–60 días',
  D61_90: '61–90 días',
  D90_PLUS: '+90 días',
};

export const RECEIVABLE_PAYMENT_METHODS: ReceivablePaymentMethod[] = [
  'WIRE',
  'BANK_TRANSFER',
  'CASH',
  'CHECK',
  'CRYPTO',
  'CARD',
  'OTHER',
];

export const RECEIVABLE_STATUSES: ReceivableStatus[] = [
  'PENDING',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'WRITTEN_OFF',
];

export const AGING_BUCKETS: AgingBucket[] = [
  'CURRENT',
  'D1_30',
  'D31_60',
  'D61_90',
  'D90_PLUS',
];

// ─── Response shapes (from receivables.service serialize*) ────────────────────

export type ReceivableCustomerSummary = {
  id: string;
  name: string;
  email: string | null;
  phone?: string | null;
};

export type ReceivableDealSummary = {
  id: string;
  stage?: string;
  agreedPrice?: string;
  soldAt: string | null;
  sourceTag: string | null;
  notes?: string | null;
};

export type ReceivableBase = {
  id: string;
  tenantId: string;
  dealId: string;
  customerId: string;
  originalAmount: string;
  currency: ReceivableCurrency;
  fxRate: string | null;
  normalizedAmount: string;
  issueDate: string;
  dueDate: string | null;
  status: ReceivableStatus;
  notes: string | null;
  sourceTag: string | null;
  writtenOffAt: string | null;
  writtenOffReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReceivablePayment = {
  id: string;
  receivableId: string;
  amount: string;
  currency: ReceivableCurrency;
  fxRate: string | null;
  normalizedAmount: string;
  paymentDate: string;
  method: ReceivablePaymentMethod;
  reference: string | null;
  notes: string | null;
  createdByUserId: string | null;
  reversesPaymentId: string | null;
  createdAt: string;
};

export type ReceivableListItem = ReceivableBase & {
  collected: string;
  remaining: string;
  ageDays: number;
  aging: AgingBucket;
  customer: Pick<ReceivableCustomerSummary, 'id' | 'name' | 'email'> | null;
  deal: Pick<ReceivableDealSummary, 'id' | 'stage' | 'soldAt' | 'sourceTag'> | null;
};

export type ReceivableDetail = ReceivableBase & {
  collected: string;
  remaining: string;
  ageDays: number;
  aging: AgingBucket;
  customer: ReceivableCustomerSummary | null;
  deal: ReceivableDealSummary | null;
  payments: ReceivablePayment[];
};

export type ReceivablesListResponse = {
  data: ReceivableListItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type ReceivablesDashboard = {
  totalAR: string;
  collectedThisMonth: string;
  outstanding: string;
  overdue: string;
  current: string;
  averageDaysOutstanding: number;
  collectionRate: string;
  largestOutstandingCustomers: Array<{
    customerId: string;
    customerName: string;
    outstanding: string;
  }>;
  upcomingDue: Array<{
    id: string;
    customerName: string;
    dueDate: string;
    remaining: string;
  }>;
  aging: Record<AgingBucket, string>;
};

export type CustomerLedger = {
  customer: ReceivableCustomerSummary;
  outstanding: string;
  lifetimeCollected: string;
  averagePaymentDays: number | null;
  receivables: Array<
    ReceivableBase & {
      collected: string;
      remaining: string;
      ageDays: number;
      deal: Pick<ReceivableDealSummary, 'id' | 'soldAt' | 'sourceTag'> | null;
      payments: ReceivablePayment[];
    }
  >;
};

export type ListReceivablesQuery = {
  status?: ReceivableStatus;
  customerId?: string;
  currency?: ReceivableCurrency;
  search?: string;
  aging?: AgingBucket;
  sort?: ReceivableSort;
  page?: number;
  limit?: number;
};

export type AddReceivablePaymentPayload = {
  amount: number;
  currency?: ReceivableCurrency;
  method: ReceivablePaymentMethod;
  paymentDate: string;
  reference?: string;
  notes?: string;
  allowOverpayment?: boolean;
  syncDealPayment?: boolean;
};

// ─── API ──────────────────────────────────────────────────────────────────────

const AUTH = { authenticated: true } as const;

export function getReceivablesDashboard() {
  return apiGet<ReceivablesDashboard>('/receivables/dashboard', AUTH);
}

export function listReceivables(query?: ListReceivablesQuery) {
  return apiGet<ReceivablesListResponse>('/receivables', { ...AUTH, query });
}

export function getReceivable(id: string) {
  return apiGet<ReceivableDetail>(`/receivables/${id}`, AUTH);
}

export function getCustomerLedger(customerId: string) {
  return apiGet<CustomerLedger>(`/receivables/customers/${customerId}/ledger`, AUTH);
}

export function addReceivablePayment(id: string, payload: AddReceivablePaymentPayload) {
  return apiPost<ReceivablePayment, AddReceivablePaymentPayload>(
    `/receivables/${id}/payments`,
    payload,
    AUTH,
  );
}

export function deleteReceivablePayment(id: string, paymentId: string) {
  return apiDelete<void>(`/receivables/${id}/payments/${paymentId}`, AUTH);
}

export function reverseReceivablePayment(id: string, paymentId: string) {
  return apiPost<ReceivablePayment>(
    `/receivables/${id}/payments/${paymentId}/reverse`,
    undefined,
    AUTH,
  );
}

export function writeOffReceivable(id: string, reason: string) {
  return apiPost<ReceivableBase, { reason: string }>(
    `/receivables/${id}/write-off`,
    { reason },
    AUTH,
  );
}
