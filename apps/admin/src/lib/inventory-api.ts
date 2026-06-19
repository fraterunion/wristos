import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';

export type WatchImage = {
  id: string;
  watchId: string;
  url: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateWatchImagePayload = {
  url: string;
  altText?: string;
  sortOrder?: number;
  isPrimary?: boolean;
};

export type UpdateWatchImagePayload = {
  url?: string;
  altText?: string | null;
  sortOrder?: number;
  isPrimary?: boolean;
};

const AUTH = { authenticated: true } as const;

export function listWatchImages(watchId: string) {
  return apiGet<WatchImage[]>(`/inventory/${watchId}/images`, AUTH);
}

export function createWatchImage(watchId: string, payload: CreateWatchImagePayload) {
  return apiPost<WatchImage>(`/inventory/${watchId}/images`, payload, AUTH);
}

export function updateWatchImage(
  watchId: string,
  imageId: string,
  payload: UpdateWatchImagePayload,
) {
  return apiPatch<WatchImage>(`/inventory/${watchId}/images/${imageId}`, payload, AUTH);
}

export function deleteWatchImage(watchId: string, imageId: string) {
  return apiDelete(`/inventory/${watchId}/images/${imageId}`, AUTH);
}

export function setPrimaryWatchImage(watchId: string, imageId: string) {
  return apiPost<WatchImage>(
    `/inventory/${watchId}/images/${imageId}/set-primary`,
    {},
    AUTH,
  );
}
