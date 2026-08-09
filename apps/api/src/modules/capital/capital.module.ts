import { Module } from '@nestjs/common';
import { CapitalContributionService } from './capital-contribution.service';
import { CapitalController } from './capital.controller';
import { CapitalDistributionService } from './capital-distribution.service';
import { CapitalService } from './capital.service';

@Module({
  controllers: [CapitalController],
  providers: [CapitalService, CapitalContributionService, CapitalDistributionService],
  exports: [CapitalService, CapitalContributionService, CapitalDistributionService],
})
export class CapitalModule {}
