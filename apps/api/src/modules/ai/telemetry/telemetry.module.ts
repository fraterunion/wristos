import { Module } from '@nestjs/common';
import { TelemetryAggregator } from './telemetry-aggregator.service';
import { TelemetryController } from './telemetry.controller';
import { TelemetryEmitter } from './telemetry-emitter.service';
import { createTelemetryStore } from './telemetry-store';

@Module({
  controllers: [TelemetryController],
  providers: [
    {
      provide: TelemetryEmitter,
      useFactory: () => new TelemetryEmitter(createTelemetryStore()),
    },
    TelemetryAggregator,
  ],
  exports: [TelemetryEmitter, TelemetryAggregator],
})
export class TelemetryModule {}
