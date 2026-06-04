import { Module } from '@nestjs/common';
import { CapitalController } from './capital.controller';
import { CapitalService } from './capital.service';

@Module({
  controllers: [CapitalController],
  providers: [CapitalService],
})
export class CapitalModule {}
