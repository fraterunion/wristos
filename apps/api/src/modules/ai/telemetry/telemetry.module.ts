import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PlatformAdminGuard } from '../../platform-migrations/guards/platform-admin.guard';
import { DurableTelemetrySource } from './durable-telemetry.source';
import { TelemetryAggregator } from './telemetry-aggregator.service';
import { TelemetryController } from './telemetry.controller';
import { TelemetryEmitter } from './telemetry-emitter.service';
import { createTelemetryStore } from './telemetry-store';

@Module({
  imports: [ConfigModule],
  controllers: [TelemetryController],
  providers: [
    PlatformAdminGuard,
    DurableTelemetrySource,
    {
      provide: TelemetryEmitter,
      useFactory: () => new TelemetryEmitter(createTelemetryStore()),
    },
    TelemetryAggregator,
  ],
  exports: [TelemetryEmitter, TelemetryAggregator, DurableTelemetrySource],
})
export class TelemetryModule {}
