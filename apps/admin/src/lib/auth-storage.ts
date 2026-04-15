import { AuthSession, AuthUser } from '@/types/auth';

const ACCESS_TOKEN_KEY = 'wristos.accessToken';
const REFRESH_TOKEN_KEY = 'wristos.refreshToken';
const USER_KEY = 'wristos.user';

export function readSession(): AuthSession | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  const userRaw = localStorage.getItem(USER_KEY);

  if (!accessToken || !refreshToken || !userRaw) {
    return null;
  }

  try {
    const user = JSON.parse(userRaw) as AuthUser;
    return { accessToken, refreshToken, user };
  } catch {
    return null;
  }
}

export function writeSession(payload: AuthSession) {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.setItem(ACCESS_TOKEN_KEY, payload.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, payload.refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
}

export function clearSession() {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
