import { apiGet } from '@/lib/api-client';
import { apiPost } from '@/lib/api-client';
import type {
  Client,
  RegisterSalePayload,
  RegisterSaleResponse,
  Watch,
} from '@/types/domain';

const AUTH = { authenticated: true } as const;

export function registerSale(payload: RegisterSalePayload): Promise<RegisterSaleResponse> {
  return apiPost<RegisterSaleResponse>('/deals/register-sale', payload, AUTH);
}

export function listSellableWatches(): Promise<Watch[]> {
  return apiGet<Watch[]>('/inventory', AUTH);
}

export function listClients(): Promise<Client[]> {
  return apiGet<Client[]>('/crm/clients', AUTH);
}

// Re-export history/sold for the recent sales table
export type SoldItem = {
  dealId: string;
  watch: {
    id: string;
    brand: string;
    model: string;
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
  notes: string | null;
  soldAt: string;
  createdAt: string;
  payments: {
    id: string;
    amount: string;
    method: string;
    status: string;
    paidAt: string | null;
  }[];
};

export function listRecentSales(): Promise<SoldItem[]> {
  return apiGet<SoldItem[]>('/history/sold', AUTH);
}
