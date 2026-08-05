import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';

export type CryptoPriceStatus = 'FRESH' | 'STALE' | 'VERY_STALE' | 'MISSING';

export type CryptoSummary = {
  totalCurrentValueMxn: string;
  totalCostBasisMxn: string;
  unrealizedPnlMxn: string;
  unrealizedPnlPercent: string | null;
  activeHoldingCount: number;
  pricedHoldingCount: number;
  unpricedHoldingCount: number;
  missingPriceTickers: string[];
  oldestPriceCapturedAt: string | null;
  newestPriceCapturedAt: string | null;
  cryptoPriceStatus: CryptoPriceStatus;
};

export type CryptoHolding = {
  id: string;
  tenantId: string;
  assetType: 'CRYPTO';
  ticker: string;
  name: string;
  quantity: string;
  averageCostMxn: string;
  location: string;
  custodian: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  latestPriceMxn: string | null;
  priceCapturedAt: string | null;
  priceSource: string | null;
  currentValueMxn: string | null;
  costBasisMxn: string;
  unrealizedPnlMxn: string | null;
  unrealizedPnlPercent: string | null;
  priceStatus: CryptoPriceStatus;
};

export type CryptoLatestPrice = {
  ticker: string;
  priceMxn: string | null;
  capturedAt: string | null;
  source: string | null;
  priceStatus: CryptoPriceStatus;
  ageHours: number | null;
};

export type CryptoPriceSnapshot = {
  id: string;
  tenantId: string;
  assetType: 'CRYPTO';
  ticker: string;
  priceMxn: string;
  capturedAt: string;
  source: string;
  notes: string | null;
  createdByUserId: string | null;
  createdAt: string;
};

export type CreateHoldingInput = {
  ticker: string;
  name: string;
  quantity: number;
  averageCostMxn: number;
  location: string;
  custodian?: string;
  notes?: string;
};

export type UpdateHoldingInput = Partial<CreateHoldingInput> & {
  custodian?: string | null;
  notes?: string | null;
};

export type CreatePriceInput = {
  ticker: string;
  priceMxn: number;
  capturedAt: string;
  source: string;
  notes?: string;
};

export function getCryptoSummary() {
  return apiGet<CryptoSummary>('/crypto/summary');
}

export function listCryptoHoldings() {
  return apiGet<CryptoHolding[]>('/crypto/holdings');
}

export function createCryptoHolding(body: CreateHoldingInput) {
  return apiPost<CryptoHolding>('/crypto/holdings', body);
}

export function updateCryptoHolding(id: string, body: UpdateHoldingInput) {
  return apiPatch<CryptoHolding>(`/crypto/holdings/${id}`, body);
}

export function deleteCryptoHolding(id: string) {
  return apiDelete<void>(`/crypto/holdings/${id}`);
}

export function listCryptoPrices() {
  return apiGet<CryptoLatestPrice[]>('/crypto/prices');
}

export function createCryptoPrice(body: CreatePriceInput) {
  return apiPost<CryptoPriceSnapshot>('/crypto/prices', body);
}

export function getCryptoPriceHistory(ticker: string, limit = 50) {
  return apiGet<{ ticker: string; items: CryptoPriceSnapshot[] }>(
    `/crypto/prices/${encodeURIComponent(ticker)}/history`,
    { query: { limit } },
  );
}
