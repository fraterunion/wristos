import { apiGet, apiPost } from '@/lib/api-client';
import type {
  AddPaymentPayload,
  AddPaymentResponse,
  Client,
  RegisterSalePayload,
  RegisterSaleResponse,
  Watch,
} from '@/types/domain';

const AUTH = { authenticated: true } as const;

// FX types and helper live in fx-api.ts so they can be used outside Ventas.
export type { FxRateResult } from './fx-api';
export { getFxUsdMxn } from './fx-api';

export function registerSale(payload: RegisterSalePayload): Promise<RegisterSaleResponse> {
  return apiPost<RegisterSaleResponse>('/deals/register-sale', payload, AUTH);
}

export function addPaymentToSale(
  dealId: string,
  payload: AddPaymentPayload,
): Promise<AddPaymentResponse> {
  return apiPost<AddPaymentResponse>(`/deals/${dealId}/payments`, payload, AUTH);
}

export function listSellableWatches(): Promise<Watch[]> {
  return apiGet<Watch[]>('/inventory', AUTH);
}

export function listClients(): Promise<Client[]> {
  return apiGet<Client[]>('/crm/clients', AUTH);
}

export type SoldItem = {
  dealId: string;
  watch: {
    id: string;
    brand: string;
    model: string;
    reference?: string | null;
    serialNumber: string | null;
    condition: string;
    cost: string;
    effectiveCost: string;
    ownershipType: string;
    consignmentOwnerName: string | null;
    consignmentSplitPercentage: string | null;
  };
  buyer: { id: string; name: string; email: string | null; phone: string | null };
  agreedPrice: string;
  originalCurrency: 'MXN' | 'USD' | null;
  originalAmount: string | null;
  exchangeRate: string | null;
  // Bank fee is the sum of all BANK_FEES OperatingExpenses linked to this deal
  bankFee: string | null;
  // netReceived = agreedPrice − bankFee
  netReceived: string;
  // Payment accounting — computed by /history/sold
  paidTotal: string;
  pendingAmount: string;
  computedStatus: 'PAGADO' | 'PARCIAL' | 'PENDIENTE';
  paymentMethods: string[];
  notes: string | null;
  soldAt: string;
  createdAt: string;
  payments: {
    id: string;
    amount: string;
    method: string;
    status: string;
    paidAt: string | null;
    notes?: string | null;
  }[];
};

export function listRecentSales(): Promise<SoldItem[]> {
  return apiGet<SoldItem[]>('/history/sold', AUTH);
}
