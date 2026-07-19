import { Module } from '@nestjs/common';

import { FxModule } from '../fx/fx.module';
import { DataOnboardingController } from './data-onboarding.controller';
import { DataOnboardingService } from './data-onboarding.service';
import { WatchImportService } from './inventory-import/watch-import.service';

@Module({
  imports: [FxModule],
  controllers: [DataOnboardingController],
  providers: [DataOnboardingService, WatchImportService],
})
export class DataOnboardingModule {}
