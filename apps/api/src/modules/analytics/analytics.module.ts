import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [TreasuryModule, CryptoModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
