'use client';

import { useAuthContext } from '@/lib/auth-context';

export function useCurrentUser() {
  const { user, isLoading, refreshCurrentUser } = useAuthContext();
  return {
    user,
    isLoading,
    refreshCurrentUser,
  };
}
