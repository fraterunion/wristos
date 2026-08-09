import { apiGet, apiPost } from '@/lib/api-client';

export type TreasuryAccount = 'CASH' | 'BANK' | 'CESAR';

export type TreasuryBalances = {
  CASH: string;
  BANK: string;
  CESAR: string;
};

export type TreasuryTransferResponse = {
  transferId: string;
  sourceAccount: TreasuryAccount;
  destinationAccount: TreasuryAccount;
  amount: string;
  currency: 'MXN';
  replayed: boolean;
  outflowEntry: {
    id: string;
    account: TreasuryAccount;
    direction: 'OUTFLOW';
    amountMxn: string;
    transactionDate: string;
    provenanceKey: string | null;
    deletedAt: string | null;
  };
  inflowEntry: {
    id: string;
    account: TreasuryAccount;
    direction: 'INFLOW';
    amountMxn: string;
    transactionDate: string;
    provenanceKey: string | null;
    deletedAt: string | null;
  };
};

export type RegisterTreasuryTransferBody = {
  sourceAccount: TreasuryAccount;
  destinationAccount: TreasuryAccount;
  amount: number;
  transferDate?: string;
  notes?: string;
  registerIdempotencyKey?: string;
};

export function getTreasuryBalances() {
  return apiGet<TreasuryBalances>('/treasury/balances');
}

export function registerTreasuryTransfer(body: RegisterTreasuryTransferBody) {
  return apiPost<TreasuryTransferResponse>('/treasury/transfers', body);
}

export function reverseTreasuryTransfer(transferId: string) {
  return apiPost<{
    transferId: string;
    reversed: boolean;
    alreadyReversed: boolean;
    outflowEntryId: string | null;
    inflowEntryId: string | null;
  }>(`/treasury/transfers/${encodeURIComponent(transferId)}/reverse`);
}
