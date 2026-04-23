export type AnalyticsSummary = {
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
  brand: string;
  model: string;
  reference: string | null;
  serialNumber: string | null;
  condition: string;
  cost: string;
  priceMin: string;
  priceMax: string;
  effectiveCost: string;
  expenses: WatchExpense[];
  status: WatchStatus;
  ownershipType: WatchOwnershipType;
  consignmentOwnerName?: string | null;
  consignmentSplitPercentage?: string | null;
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
  watchId: string;
  stage: DealStage;
  expectedCloseAt?: string | null;
  agreedPrice: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type PaymentSummary = {
  totalAgreedPrice: string;
  totalPaid: string;
  pendingBalance: string;
};

export type PaymentMethod = 'TRANSFER' | 'CASH' | 'CARD' | 'OTHER';
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
