import { HttpException, HttpStatus } from '@nestjs/common';
import { IntentAdapterRateLimitGuard } from '../rate-limit.guard';

function contextFor(user: { tenantId: string; userId: string } | undefined) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

describe('IntentAdapterRateLimitGuard', () => {
  const originalMax = process.env.INTENT_ADAPTER_RATE_LIMIT_MAX;
  const originalWindow = process.env.INTENT_ADAPTER_RATE_LIMIT_WINDOW_MS;

  afterEach(() => {
    process.env.INTENT_ADAPTER_RATE_LIMIT_MAX = originalMax;
    process.env.INTENT_ADAPTER_RATE_LIMIT_WINDOW_MS = originalWindow;
  });

  it('allows requests under the configured limit and blocks the one that exceeds it', () => {
    process.env.INTENT_ADAPTER_RATE_LIMIT_MAX = '3';
    process.env.INTENT_ADAPTER_RATE_LIMIT_WINDOW_MS = '60000';
    const guard = new IntentAdapterRateLimitGuard();
    const user = { tenantId: 't1', userId: 'u1' };

    expect(guard.canActivate(contextFor(user))).toBe(true);
    expect(guard.canActivate(contextFor(user))).toBe(true);
    expect(guard.canActivate(contextFor(user))).toBe(true);
    expect(() => guard.canActivate(contextFor(user))).toThrow(HttpException);
    try {
      guard.canActivate(contextFor(user));
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });

  it('scopes the limit per tenant+user — one user hitting the limit does not affect another', () => {
    process.env.INTENT_ADAPTER_RATE_LIMIT_MAX = '1';
    process.env.INTENT_ADAPTER_RATE_LIMIT_WINDOW_MS = '60000';
    const guard = new IntentAdapterRateLimitGuard();

    expect(guard.canActivate(contextFor({ tenantId: 't1', userId: 'u1' }))).toBe(true);
    expect(() => guard.canActivate(contextFor({ tenantId: 't1', userId: 'u1' }))).toThrow(HttpException);
    expect(guard.canActivate(contextFor({ tenantId: 't1', userId: 'u2' }))).toBe(true);
  });

  it('does not block when no authenticated user is present (JwtAuthGuard already handles that)', () => {
    const guard = new IntentAdapterRateLimitGuard();
    expect(guard.canActivate(contextFor(undefined))).toBe(true);
  });
});
