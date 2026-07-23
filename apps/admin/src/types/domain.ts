export type AnalyticsSummary = {
  // ── Existing fields (kept for backwards compat) ──
  totalWatches: number;
  availableWatches: number;
  reservedWatches: number;
  soldWatches: number;
  consignmentWatches: number;
  totalInventoryValue: string;
  totalInventoryCost: string;
  activeClients: number;
  totalDeals: number;
  dealsByStage: Record<string, number>;
  totalAgreedRevenue: string;
  totalCollectedRevenue: string;
  totalPendingBalance: string;
  // ── New: financial-position KPIs ─────────────────
  cashBalance: string;
  bankBalance: string;
  cesarBalance: string;
  accountsPayable: string;
  salesThisMonthCount: number;
  salesThisMonthRevenue: string;
  costOfSoldThisMonth: string;
  bankFeesThisMonth: string;
  profitThisMonth: string;
};

export type InventoryAgingSummary = {
  days0to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
};

export type PipelineSummary = {
  countsByStage: Record<string, number>;
  totalAgreedByStage: Record<string, string>;
  openDeals: number;
  wonDeals: number;
  lostDeals: number;
};

export type AnalyticsPeriod = 'week' | 'month' | 'year';

export type RevenueOverTimePoint = {
  label: string;
  revenue: number;
};

export type SalesOverTimePoint = {
  label: string;
  count: number;
};

export type InventoryByBrandPoint = {
  brand: string;
  count: number;
  inventoryValue: string;
};

export type SalesByBrandPoint = {
  brand: string;
  count: number;
  revenue: string;
};

export type TopModelPoint = {
  model: string;
  count: number;
};

export type WatchStatus =
  | 'AVAILABLE'
  | 'RESERVED'
  | 'SOLD'
  | 'IN_TRANSIT'
  | 'IN_SERVICE';

export type WatchOwnershipType = 'OWNED' | 'CONSIGNMENT';

export type WatchExpenseCategory =
  | 'POLISHING'
  | 'REPAIR'
  | 'LINKS'
  | 'SHIPPING'
  | 'PARTS'
  | 'COMMISSIONS'
  | 'TRAVEL';

export type WatchExpense = {
  id: string;
  watchId: string;
  category: WatchExpenseCategory;
  amount: string;
  notes: string | null;
  createdAt: string;
};

export type Watch = {
  id: string;
  tenantId: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  imageUrl?: string | null;
  condition: string | null;
  cost: string | null;
  costCurrency?: string | null;
  costOriginalAmount?: string | null;
  costExchangeRate?: string | null;
  priceMin: string | null;
  priceMax: string | null;
  effectiveCost: string;
  expenses: WatchExpense[];
  status: WatchStatus;
  ownershipType: WatchOwnershipType;
  consignmentOwnerName?: string | null;
  consignmentSplitPercentage?: string | null;
  isPublished?: boolean;
  publicSlug?: string | null;
  publicDescription?: string | null;
  publicPrice?: string | null;
  reservationAmount?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type Client = {
  id: string;
  tenantId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  tags?: string[];
  budgetRange?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type ClientInteractionType = 'CALL' | 'MESSAGE' | 'MEETING' | 'NOTE';

export type ClientInteraction = {
  id: string;
  tenantId: string;
  clientId: string;
  type: ClientInteractionType;
  notes: string;
  occurredAt: string;
  createdAt: string;
};

export type ClientPreference = {
  id: string;
  tenantId: string;
  clientId: string;
  preferredBrands: string[];
  preferredModels: string[];
  budgetMin: string | null;
  budgetMax: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DealStage =
  | 'LEAD'
  | 'INTERESTED'
  | 'NEGOTIATING'
  | 'PENDING_PAYMENT'
  | 'CLOSED_WON'
  | 'CLOSED_LOST';

export type Deal = {
  id: string;
  tenantId: string;
  clientId: string;
  watchId: string | null;
  stage: DealStage;
  expectedCloseAt?: string | null;
  agreedPrice: string;
  notes?: string | null;
  sourceTag?: string | null;
  importSessionId?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type PaymentSummary = {
  totalAgreedPrice: string;
  totalPaid: string;
  pendingBalance: string;
};

export type PaymentMethod = 'TRANSFER' | 'CASH' | 'CARD' | 'OTHER' | 'BANCOS' | 'CESAR';
export type PaymentStatus = 'PENDING' | 'PAID' | 'OVERDUE';

export type Payment = {
  id: string;
  tenantId: string;
  dealId: string;
  amount: string;
  method: PaymentMethod;
  status: PaymentStatus;
  dueDate: string | null;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MatchSuggestion = {
  id: string;
  tenantId: string;
  clientId: string;
  watchId: string;
  score: number;
  reason: string;
  dismissedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AutomationRuleType = 'STALE_DEAL' | 'OVERDUE_PAYMENT' | 'AGING_INVENTORY';

export type AutomationRule = {
  id: string;
  tenantId: string;
  type: AutomationRuleType;
  isEnabled: boolean;
  thresholdDays: number;
  createdAt: string;
  updatedAt: string;
};

export type OperatingExpenseCategory =
  | 'GASOLINE'
  | 'TOLLS'
  | 'WATCHMAKER'
  | 'PARKING'
  | 'MEALS'
  | 'FLIGHTS'
  | 'TRAVEL'
  | 'MARKETING'
  | 'COMMISSIONS'
  | 'BANK_FEES';

export type VentaPaymentMethod = 'CASH' | 'BANCOS' | 'CESAR';
export type VentaBankChannel = 'JOSE' | 'MAYTE';
export type SaleCurrency = 'MXN' | 'USD';

export type RegisterSalePayload = {
  watchId: string;
  clientId: string;
  salePrice: number;
  currency?: SaleCurrency;
  saleDate?: string;
  notes?: string;
  // Partial payment fields (new)
  initialPaymentAmount?: number;
  initialPaymentMethod?: VentaPaymentMethod;
  initialPaymentDate?: string;
  bankChannel?: VentaBankChannel;
  // Legacy: kept for backwards-compat callers; new UI sends initialPaymentMethod
  paymentMethod?: VentaPaymentMethod;
};

export type RegisterSaleResponse = {
  id: string;
  watchId: string;
  clientId: string;
  salePrice: string;
  originalCurrency: string | null;
  originalAmount: string | null;
  exchangeRate: string | null;
  paymentMethod: VentaPaymentMethod | null;
  bankChannel: VentaBankChannel | null;
  bankFee: string | null;
  netReceived: string;
  paidAt: string | null;
  paidTotal: string;
  pendingAmount: string;
  computedStatus: 'PAGADO' | 'PARCIAL' | 'PENDIENTE';
  notes: string | null;
  createdAt: string;
};

export type AddPaymentPayload = {
  amount: number;
  method: VentaPaymentMethod;
  paidAt?: string;
  bankChannel?: VentaBankChannel;
  notes?: string;
};

export type AddPaymentResponse = {
  payment: {
    id: string;
    amount: string;
    method: string;
    status: string;
    paidAt: string | null;
    notes: string | null;
  };
  bankFee: string | null;
  paidTotal: string;
  pendingAmount: string;
  computedStatus: 'PAGADO' | 'PARCIAL' | 'PENDIENTE';
};

export type OperatingExpense = {
  id: string;
  tenantId: string;
  category: OperatingExpenseCategory;
  amount: string;
  notes: string | null;
  expenseDate: string;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseCategorySummary = {
  category: string;
  total: string;
  count: number;
  percentage: string;
  isCommission: boolean;
};

export type ExpensesSummary = {
  totalOperatingExpenses: string;
  totalCommissions: string;
  totalBankFees: string;
  totalSpend: string;
  expenseCount: number;
  biggestCategory: string | null;
  byCategory: ExpenseCategorySummary[];
};
