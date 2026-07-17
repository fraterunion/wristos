import { Module } from '@nestjs/common';

import { DataOnboardingController } from './data-onboarding.controller';
import { DataOnboardingService } from './data-onboarding.service';

@Module({
  controllers: [DataOnboardingController],
  providers: [DataOnboardingService],
})
export class DataOnboardingModule {}
