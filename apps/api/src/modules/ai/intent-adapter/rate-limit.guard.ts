import { CanActivate, ExecutionContext, HttpStatus, Injectable, HttpException } from '@nestjs/common';
import { CurrentUser } from '../../../common/types/current-user.type';
import { buildRateLimitedResponse } from './typed-responses';

function resolveMaxRequests(): number {
  const raw = process.env.INTENT_ADAPTER_RATE_LIMIT_MAX;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
}

function resolveWindowMs(): number {
  const raw = process.env.INTENT_ADAPTER_RATE_LIMIT_WINDOW_MS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
}

/**
 * Conservative, per-process, tenant+user-scoped fixed-window rate limiter
 * (Part 13). There is no rate-limiting infrastructure anywhere else in this
 * codebase (verified — no @nestjs/throttler, no existing guard), so this is
 * a small, dependency-free addition scoped ONLY to the new natural-language
 * route via @UseGuards on that one handler — it does not apply globally.
 *
 * Known limitation: in-memory only, so limits are per API instance, not
 * cluster-wide. Acceptable for V1's single-instance Railway deployment;
 * documented in docs/ai/READ_ONLY_LLM_ADAPTER.md as a scale-out follow-up.
 */
@Injectable()
export class IntentAdapterRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: CurrentUser }>();
    const user = request.user;
    if (!user) return true; // JwtAuthGuard (which runs first) already rejects unauthenticated requests.

    const key = `${user.tenantId}:${user.userId}`;
    const now = Date.now();
    const windowMs = resolveWindowMs();
    const max = resolveMaxRequests();

    const timestamps = (this.hits.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
    if (timestamps.length >= max) {
      this.hits.set(key, timestamps);
      throw new HttpException(buildRateLimitedResponse({ traceId: `nlmsg-ratelimit:${now}` }), HttpStatus.TOO_MANY_REQUESTS);
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);
    return true;
  }
}
