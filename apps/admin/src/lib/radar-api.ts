import { apiGet, apiPatch, apiPost, getApiBaseUrl } from '@/lib/api-client';
import { readSession } from '@/lib/auth-storage';
import type {
  ListRadarListingsParams,
  RadarContactProfile,
  RadarImportSummary,
  RadarListingDetail,
  RadarListingsResponse,
  RadarReviewQueueResponse,
  SearchRadarReferencesParams,
  UpdateRadarListingPayload,
  WatchReference,
} from '@/types/radar';

const AUTH = { authenticated: true } as const;

type QueryParams = Record<string, string | number | boolean | null | undefined>;

export async function uploadRadarImport(file: File): Promise<RadarImportSummary> {
  const form = new FormData();
  form.append('file', file);
  const session = readSession();
  const response = await fetch(`${getApiBaseUrl()}/radar/imports`, {
    method: 'POST',
    headers: session?.accessToken
      ? { Authorization: `Bearer ${session.accessToken}` }
      : {},
    body: form,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message ?? `Upload failed (${response.status})`);
  }
  return response.json() as Promise<RadarImportSummary>;
}

export function getRadarImport(id: string): Promise<RadarImportSummary> {
  return apiGet<RadarImportSummary>(`/radar/imports/${id}`, AUTH);
}

export function classifyRadarImport(id: string): Promise<RadarImportSummary> {
  return apiPost<RadarImportSummary>(`/radar/imports/${id}/classify`, undefined, AUTH);
}

export function listRadarListings(params: ListRadarListingsParams = {}): Promise<RadarListingsResponse> {
  return apiGet<RadarListingsResponse>('/radar/listings', {
    ...AUTH,
    query: params as QueryParams,
  });
}

export function getRadarListing(id: string): Promise<RadarListingDetail> {
  return apiGet<RadarListingDetail>(`/radar/listings/${id}`, AUTH);
}

export function updateRadarListing(
  id: string,
  payload: UpdateRadarListingPayload,
): Promise<RadarListingDetail> {
  return apiPatch<RadarListingDetail>(`/radar/listings/${id}`, payload, AUTH);
}

export function confirmRadarListing(
  id: string,
  payload?: UpdateRadarListingPayload,
): Promise<RadarListingDetail> {
  return apiPost<RadarListingDetail>(`/radar/listings/${id}/confirm`, payload ?? {}, AUTH);
}

export function dismissRadarListing(
  id: string,
  reason?: string,
): Promise<{ id: string; reviewStatus: string; dismissedAt: string }> {
  return apiPost(
    `/radar/listings/${id}/dismiss`,
    reason !== undefined ? { reason } : {},
    AUTH,
  );
}

export function getRadarReviewQueue(
  params: { page?: number; limit?: number } = {},
): Promise<RadarReviewQueueResponse> {
  return apiGet<RadarReviewQueueResponse>('/radar/listings/review', {
    ...AUTH,
    query: params as QueryParams,
  });
}

export function searchRadarReferences(
  params: SearchRadarReferencesParams = {},
): Promise<WatchReference[]> {
  return apiGet<WatchReference[]>('/radar/references', {
    ...AUTH,
    query: params as QueryParams,
  });
}

export function getRadarContact(id: string): Promise<RadarContactProfile> {
  return apiGet<RadarContactProfile>(`/radar/contacts/${id}`, AUTH);
}
