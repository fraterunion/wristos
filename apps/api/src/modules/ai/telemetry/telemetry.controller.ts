import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../../common/types/current-user.type';
import { JwtAuthGuard } from '../../core/auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../platform-migrations/guards/platform-admin.guard';
import { TelemetryAggregator, HealthWindow } from './telemetry-aggregator.service';
import { TelemetryEmitter } from './telemetry-emitter.service';
import { hashId } from './telemetry-privacy';

/**
 * Internal Assistant Health telemetry API (PLATFORM_ADMIN only).
 * Read-only. Never influences Assistant execution.
 * Source of truth: durable AIRequest / AIActionRun / AIAuditEvent (shared DB).
 */
@Controller('ai/telemetry')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class TelemetryController {
  constructor(
    private readonly aggregator: TelemetryAggregator,
    private readonly emitter: TelemetryEmitter,
  ) {}

  @Get('health')
  async health(
    @CurrentUser() user: CurrentUserType,
    @Query('window') window?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    const w = normalizeWindow(window);
    // Global by default for platform admins. Optional tenant filter is hashed in response.
    const report = await this.aggregator.aggregateDurable({
      window: w,
      tenantId: tenantId?.trim() || undefined,
    });
    return {
      ...report,
      access: 'PLATFORM_ADMIN',
      requestedByUserHash: hashId(user.userId),
      privacyRejectionsThisProcess: this.emitter.privacyRejectionCount(),
      note:
        'Durable shared DB aggregation. In-memory/JSONL are NOT production source of truth. Never changes Assistant behavior.',
    };
  }

  /** Ephemeral debug listing — platform admin only; not authoritative. */
  @Get('events')
  events(@Query('limit') limit?: string) {
    const n = Math.min(500, Math.max(1, Number(limit) || 100));
    return {
      authoritative: false,
      note: 'Process-local ephemeral buffer for debug only.',
      events: this.emitter.list(n),
      privacyRejectionsThisProcess: this.emitter.privacyRejectionCount(),
    };
  }
}

function normalizeWindow(raw: string | undefined): HealthWindow {
  if (raw === 'today' || raw === '7d' || raw === '30d') return raw;
  return '7d';
}
