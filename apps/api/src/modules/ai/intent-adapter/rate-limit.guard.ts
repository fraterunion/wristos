import { CanActivate, ExecutionContext, HttpStatus, Injectable, HttpException, Logger } from '@nestjs/common';
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
 * codebase (verified — no @nestjs/throttler, no Redis/shared-cache client),
 * so this is a small, dependency-free addition scoped ONLY to the new
 * natural-language route via @UseGuards on that one handler — it does not
 * apply globally.
 *
 * Known limitation — read before scaling Railway horizontally: this limiter
 * is in-memory and process-local, NOT cluster-wide. If the API ever runs as
 * more than one Railway replica, each replica enforces this limit
 * independently against its own memory, so the effective limit silently
 * becomes N× the configured value. This is not detected or prevented here —
 * intentionally: introducing Redis or another shared store solely for this
 * guard was explicitly out of scope for this commit. See
 * docs/ai/READ_ONLY_LLM_ADAPTER.md §7 for the full audit and the required
 * follow-up (move to a shared store) before scaling to multiple replicas.
 */
@Injectable()
export class IntentAdapterRateLimitGuard implements CanActivate {
  private static warnedProcessLocal = false;
  private readonly logger = new Logger(IntentAdapterRateLimitGuard.name);
  private readonly hits = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    if (!IntentAdapterRateLimitGuard.warnedProcessLocal) {
      IntentAdapterRateLimitGuard.warnedProcessLocal = true;
      this.logger.warn('IntentAdapterRateLimitGuard enforces its limit in-memory, per API process — it is NOT cluster-wide. If this API ever runs more than one Railway replica, the effective limit becomes (replica count × configured max) silently. See docs/ai/READ_ONLY_LLM_ADAPTER.md §7 before scaling horizontally.');
    }
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
