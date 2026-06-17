import { apiBaseUrl, tenantSlug } from './config';

export type PublicWatch = {
  id: string;
  brand: string;
  model: string;
  reference: string | null;
  imageUrl: string | null;
  condition: string;
  status: string;
  publicSlug: string;
  publicDescription: string | null;
  publicPrice: string;
  reservationAmount: string;
  createdAt: string;
  updatedAt: string;
};

export type ReservationCheckoutResponse = {
  reservationId: string;
  checkoutUrl: string;
};

export type ReservationCheckoutBody = {
  slug: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
};

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function publicPath(path: string): string {
  const base = apiBaseUrl.replace(/\/$/, '');
  return `${base}/public/${tenantSlug}${path}`;
}

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(data.message)) return data.message.join(', ');
    if (typeof data.message === 'string') return data.message;
  } catch {
    // ignore
  }
  return res.statusText || 'Request failed';
}

export async function listPublicWatches(): Promise<PublicWatch[]> {
  const res = await fetch(publicPath('/watches'), {
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }

  return res.json() as Promise<PublicWatch[]>;
}

export async function getPublicWatch(slug: string): Promise<PublicWatch | null> {
  const res = await fetch(publicPath(`/watches/${encodeURIComponent(slug)}`), {
    next: { revalidate: 60 },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }

  return res.json() as Promise<PublicWatch>;
}

export async function createReservationCheckout(
  body: ReservationCheckoutBody,
): Promise<ReservationCheckoutResponse> {
  const res = await fetch(publicPath('/checkout/reserve'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }

  return res.json() as Promise<ReservationCheckoutResponse>;
}

export { ApiError };
