export function postLoginRoute(isMobile: boolean): '/assistant' | '/dashboard' {
  return isMobile ? '/assistant' : '/dashboard';
}

export function browserPostLoginRoute(): '/assistant' | '/dashboard' {
  if (typeof window === 'undefined') return '/dashboard';
  return postLoginRoute(window.matchMedia('(max-width: 767px)').matches);
}
