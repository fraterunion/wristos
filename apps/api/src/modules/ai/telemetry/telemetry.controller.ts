import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../../common/types/current-user.type';
import { JwtAuthGuard } from '../../core/auth/guards/jwt-auth.guard';
import { TelemetryAggregator } from './telemetry-aggregator.service';
import { TelemetryEmitter } from './telemetry-emitter.service';
import { hashId } from './telemetry-privacy';

/**
 * Internal Assistant Health telemetry API.
 * Read-only. Never influences Assistant execution.
 */
@Controller('ai/telemetry')
@UseGuards(JwtAuthGuard)
export class TelemetryController {
  constructor(
    private readonly aggregator: TelemetryAggregator,
    private readonly emitter: TelemetryEmitter,
  ) {}

  @Get('health')
  health(@CurrentUser() user: CurrentUserType, @Query('limit') limit?: string) {
    const n = Math.min(10_000, Math.max(1, Number(limit) || 5_000));
    const th = hashId(user.tenantId);
    const events = this.emitter.list(n).filter((e) => !e.tenantHash || e.tenantHash === th);
    const report = this.aggregator.aggregate(events);
    return {
      ...report,
      tenantHash: th,
      passive: true,
      note: 'Telemetry is best-effort per API replica. It never changes Assistant behavior.',
    };
  }

  @Get('events')
  events(@CurrentUser() user: CurrentUserType, @Query('limit') limit?: string) {
    const n = Math.min(500, Math.max(1, Number(limit) || 100));
    const th = hashId(user.tenantId);
    return {
      events: this.emitter
        .list(n * 4)
        .filter((e) => !e.tenantHash || e.tenantHash === th)
        .slice(-n),
    };
  }
}
