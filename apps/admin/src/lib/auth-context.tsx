'use client';

import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { apiGet, apiPost, apiRequest } from '@/lib/api-client';
import { clearSession, readSession, writeSession } from '@/lib/auth-storage';
import { AuthUser, LoginResponse } from '@/types/auth';

type AuthContextValue = {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshCurrentUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const initialize = useCallback(async () => {
    const existing = readSession();
    if (!existing) {
      setIsLoading(false);
      return;
    }

    setAccessToken(existing.accessToken);
    setRefreshToken(existing.refreshToken);
    setUser(existing.user);

    try {
      await refreshCurrentUserInner(existing.accessToken, existing.refreshToken);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const persistAndSet = useCallback((payload: LoginResponse) => {
    writeSession(payload);
    setAccessToken(payload.accessToken);
    setRefreshToken(payload.refreshToken);
    setUser(payload.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // V1: ignore logout API errors.
    }
    clearSession();
    setAccessToken(null);
    setRefreshToken(null);
    setUser(null);
  }, []);

  const refreshCurrentUserInner = useCallback(
    async (candidateAccessToken?: string, candidateRefreshToken?: string) => {
      const token = candidateAccessToken ?? accessToken;
      const refresh = candidateRefreshToken ?? refreshToken;
      if (!token || !refresh) {
        throw new Error('Missing auth tokens');
      }

      try {
        const me = await apiGet<AuthUser>('/auth/me', {
          authenticated: true,
          accessToken: token,
        });
        const session = {
          accessToken: token,
          refreshToken: refresh,
          user: me,
        };
        writeSession(session);
        setAccessToken(session.accessToken);
        setRefreshToken(session.refreshToken);
        setUser(session.user);
        return;
      } catch {
        // try refresh next
      }

      const refreshed = await apiPost<LoginResponse, { refreshToken: string }>(
        '/auth/refresh',
        {
          refreshToken: refresh,
        },
      );

      const mePayload = await apiGet<AuthUser>('/auth/me', {
        authenticated: true,
        accessToken: refreshed.accessToken,
      });
      persistAndSet({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        user: mePayload,
      });
    },
    [accessToken, persistAndSet, refreshToken],
  );

  const refreshCurrentUser = useCallback(async () => {
    await refreshCurrentUserInner();
  }, [refreshCurrentUserInner]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const auth = await apiPost<
        LoginResponse,
        { identifier: string; password: string }
      >('/auth/login', { identifier, password });

      const mePayload = await apiGet<AuthUser>('/auth/me', {
        authenticated: true,
        accessToken: auth.accessToken,
      });
      persistAndSet({
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        user: mePayload,
      });
    },
    [persistAndSet],
  );

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      accessToken,
      isLoading,
      login,
      logout,
      refreshCurrentUser,
    }),
    [user, accessToken, isLoading, login, logout, refreshCurrentUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used inside AuthProvider');
  }
  return context;
}
