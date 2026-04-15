import { clearSession, readSession, writeSession } from '@/lib/auth-storage';
import { LoginResponse } from '@/types/auth';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';

type QueryParamValue = string | number | boolean | null | undefined;

type ApiRequestOptions<TBody = unknown> = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: TBody;
  headers?: HeadersInit;
  query?: Record<string, QueryParamValue>;
  authenticated?: boolean;
  accessToken?: string;
  _retry401?: boolean;
};

export class ApiError extends Error {
  status: number;
  payload?: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export function getApiBaseUrl() {
  return API_BASE_URL;
}

function buildUrl(path: string, query?: Record<string, QueryParamValue>) {
  const url = new URL(`${API_BASE_URL}${path}`);
  if (!query) {
    return url.toString();
  }

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    url.searchParams.set(key, String(value));
  });

  return url.toString();
}

function redirectToLogin() {
  if (typeof window === 'undefined') return;
  window.location.href = '/login';
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function parseError(response: Response): Promise<ApiError> {
  let payload: unknown = undefined;
  let message = `Request failed (${response.status})`;

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
      if (
        payload &&
        typeof payload === 'object' &&
        'message' in payload &&
        typeof (payload as { message?: unknown }).message === 'string'
      ) {
        message = (payload as { message: string }).message;
      }
    } catch {
      // ignore parse errors
    }
  } else {
    try {
      const text = await response.text();
      if (text.trim()) {
        message = text;
      }
    } catch {
      // ignore parse errors
    }
  }

  return new ApiError(message, response.status, payload);
}

async function refreshAccessToken(): Promise<string | null> {
  const existing = readSession();
  if (!existing?.refreshToken) {
    return null;
  }

  const response = await fetch(buildUrl('/auth/refresh'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refreshToken: existing.refreshToken }),
  });

  if (!response.ok) {
    return null;
  }

  const refreshed = (await parseResponse<LoginResponse>(response)) as LoginResponse;
  writeSession({
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    user: existing.user,
  });

  return refreshed.accessToken;
}

export async function apiRequest<TResponse, TBody = unknown>(
  path: string,
  options: ApiRequestOptions<TBody> = {},
): Promise<TResponse> {
  const {
    method = 'GET',
    body,
    headers,
    query,
    authenticated = false,
    accessToken,
    _retry401 = false,
  } = options;

  const session = readSession();
  const bearerToken = accessToken ?? session?.accessToken ?? null;

  const response = await fetch(buildUrl(path, query), {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(authenticated && bearerToken
        ? { Authorization: `Bearer ${bearerToken}` }
        : {}),
      ...(headers ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.ok) {
    return parseResponse<TResponse>(response);
  }

  if (authenticated && response.status === 401 && !_retry401) {
    const refreshedAccessToken = await refreshAccessToken();
    if (!refreshedAccessToken) {
      clearSession();
      redirectToLogin();
      throw new ApiError('Session expired. Please login again.', 401);
    }

    return apiRequest<TResponse, TBody>(path, {
      ...options,
      accessToken: refreshedAccessToken,
      _retry401: true,
    });
  }

  throw await parseError(response);
}

export function apiGet<TResponse>(
  path: string,
  options: Omit<ApiRequestOptions, 'method' | 'body'> = {},
) {
  return apiRequest<TResponse>(path, { ...options, method: 'GET' });
}

export function apiPost<TResponse, TBody = unknown>(
  path: string,
  body?: TBody,
  options: Omit<ApiRequestOptions<TBody>, 'method' | 'body'> = {},
) {
  return apiRequest<TResponse, TBody>(path, { ...options, method: 'POST', body });
}

export function apiPatch<TResponse, TBody = unknown>(
  path: string,
  body?: TBody,
  options: Omit<ApiRequestOptions<TBody>, 'method' | 'body'> = {},
) {
  return apiRequest<TResponse, TBody>(path, { ...options, method: 'PATCH', body });
}

export function apiPut<TResponse, TBody = unknown>(
  path: string,
  body?: TBody,
  options: Omit<ApiRequestOptions<TBody>, 'method' | 'body'> = {},
) {
  return apiRequest<TResponse, TBody>(path, { ...options, method: 'PUT', body });
}

export function apiDelete<TResponse>(
  path: string,
  options: Omit<ApiRequestOptions, 'method' | 'body'> = {},
) {
  return apiRequest<TResponse>(path, { ...options, method: 'DELETE' });
}
