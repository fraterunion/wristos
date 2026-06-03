import { apiGet } from '@/lib/api-client';

export type FxRateResult = {
  pair: string;
  rate: number;
  source: string;
  fetchedAt: string;
  stale?: boolean;
};

export function getFxUsdMxn(): Promise<FxRateResult> {
  return apiGet<FxRateResult>('/fx/usd-mxn', { authenticated: true });
}
