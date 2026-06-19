import { apiGet, apiPost } from '@/lib/api-client';
import type { Deal } from '@/types/domain';
import type { AccountEntry } from '@/lib/cuentas-api';

export type StorefrontReservationStatus = 'PENDING' | 'PAID' | 'CANCELLED' | 'PROCESSED';

export type StorefrontReservationWatch = {
  id: string;
  brand: string;
  model: string;
  reference: string | null;
  imageUrl: string | null;
  status: string;
  publicSlug: string | null;
};

export type StorefrontReservationClient = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

export type StorefrontReservation = {
  id: string;
  tenantId: string;
  watchId: string;
  clientId: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  reservationAmount: string;
  currency: string;
  status: StorefrontReservationStatus;
  webhookEventId: string | null;
  reservationExpiresAt: string | null;
  processedAt: string | null;
  expiredAt: string | null;
  cancelledAt: string | null;
  dealId: string | null;
  createdAt: string;
  updatedAt: string;
  watch: StorefrontReservationWatch;
  client: StorefrontReservationClient | null;
};

const AUTH = { authenticated: true } as const;

export function listStorefrontReservations(query?: {
  status?: StorefrontReservationStatus;
  search?: string;
  from?: string;
  to?: string;
}) {
  return apiGet<StorefrontReservation[]>('/storefront/reservations', { ...AUTH, query });
}

export function getStorefrontReservation(id: string) {
  return apiGet<StorefrontReservation>(`/storefront/reservations/${id}`, AUTH);
}

export type ConvertStorefrontReservationResponse = {
  reservation: StorefrontReservation;
  deal: Deal;
  accountEntry: AccountEntry | null;
};

export function convertStorefrontReservation(id: string) {
  return apiPost<ConvertStorefrontReservationResponse>(
    `/storefront/reservations/${id}/convert`,
    {},
    AUTH,
  );
}
