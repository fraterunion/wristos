'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuthContext } from '@/lib/auth-context';

const LOGIN_ROUTE = '/login';

export function useAuthGuard() {
  const { user, isLoading } = useAuthContext();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading) return;

    const isLoginRoute = pathname === LOGIN_ROUTE;
    if (!user && !isLoginRoute) {
      router.replace(LOGIN_ROUTE);
      return;
    }

    if (user && isLoginRoute) {
      router.replace('/dashboard');
    }
  }, [isLoading, pathname, router, user]);

  return { isLoading, user };
}
